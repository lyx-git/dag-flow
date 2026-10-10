// src/adapter/schedules.ts
// 定时任务配置存储（2026-10-03 用户拍板方案 v1，见 docs/SCHEDULE-PLAN.md §3）：
//   落盘位置 = `<DSH_HOME>/.dag-flow/schedules.json`（与 workflow/ 同级；2026-10-11 起固定随 DSH_HOME，不随工作区走）
//   结构     = { version: 1, items: ScheduleItem[] }
//   语义要点（用户已拍板）：
//     · 原子写：先写 `${file}.tmp` 再 rename（同盘替换，沿用 workflow 保存的既有做法）
//     · 文件损坏 → 降级为空列表 + 把原因交回调用方记日志，**不阻塞插件加载**
//     · 工作流改名 → 联动更新 items[].workflow；工作流不存在 → 标 orphan 提示，**不自动删**（不碰用户配置）
//     · cron 非法 → 写入前拒绝（中文原因），不落盘
// 本模块只负责「配置」这件事；到点执行 / 并发跳过在 scheduler.ts。

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createStorage } from './storage.js';
import { isWorkflowRunning } from './running.js';
import { cronError, nextRunAt } from './cron.js';
import type { JsonValue } from '../types.js';

export type ScheduleStatus = 'success' | 'failed' | 'skipped' | 'error';

export interface ScheduleItem {
  /** sch_xxxxxxxx */
  id: string;
  /** 绑定的工作流名（改名时联动更新） */
  workflow: string;
  /** 5 字段 cron：分 时 日 月 周 */
  cron: string;
  enabled: boolean;
  /** 定时运行时的输入（缺省 = 不传，等价于工作流参数默认值） */
  inputs?: Record<string, JsonValue>;
  timeoutMs?: number;
  /** 上一轮没跑完时的行为（用户拍板 B：默认 skip） */
  concurrency?: 'skip';
  createdAt?: string;
  lastRun?: { at: string; status: ScheduleStatus; durationMs?: number; runId?: string; error?: string };
  /** 最近一次**开始**执行的时间（面板显示「正在运行…」用；是否真在跑以 API 返回的 live `running` 为准） */
  lastStartedAt?: string;
  /** 下次触发时间（ISO，本机时区语义）；由写入 / 调度器维护 */
  nextRunAt?: string;
  /** 只读派生：工作流已不存在（面板黄字提示；不落盘、不自动删） */
  orphan?: boolean;
  /** 只读派生：该工作流此刻是否正在运行（来自 running.ts 共享登记） */
  running?: boolean;
}

export interface ScheduleFile { version: 1; items: ScheduleItem[] }

// ★ 每次都造一个新的空结构：早期版本用浅拷贝共享了同一个 items 数组，
//   于是 upsert 的 push 把「空列表」永久污染成 1 条（test/schedules.test.mjs 的 G1/G4 抓到的真实 bug）。
const empty = (): ScheduleFile => ({ version: 1, items: [] });

/** schedules.json 的绝对路径（与 .dag-flow/workflow 同级） */
export async function schedulesPath(): Promise<string> {
  const info = await createStorage().describe();
  return path.join(path.dirname(info.dir), 'schedules.json');
}

/** 生成定时项 id（sch_ + 6 位 base36） */
export function newScheduleId(): string {
  return 'sch_' + Math.random().toString(36).slice(2, 8);
}

/** 读配置；文件不存在 → 空列表；文件损坏 → 空列表 + error（原因交回调用方，不抛） */
export async function readSchedules(): Promise<{ file: ScheduleFile; error?: string }> {
  const file = await schedulesPath();
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as ScheduleFile;
    if (!parsed || !Array.isArray(parsed.items)) {
      return { file: empty(), error: 'schedules.json 结构不合法（items 不是数组），已按空列表处理' };
    }
    return { file: { version: 1, items: parsed.items } };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { file: empty() };
    return { file: empty(), error: `schedules.json 读取失败（${(e as Error).message}），已按空列表处理` };
  }
}

/** 原子写配置（tmp + rename） */
export async function writeSchedules(file: ScheduleFile): Promise<void> {
  const target = await schedulesPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ version: 1, items: file.items }, null, 2), 'utf8');
  await fs.rename(tmp, target);
}

/** 现有工作流名集合；列不出时返回 null（此时不标 orphan，避免把用户配置误标） */
async function existingWorkflows(): Promise<Set<string> | null> {
  try {
    return new Set(await createStorage().listWorkflows());
  } catch {
    return null;
  }
}

/** 列表（可按工作流过滤）：orphan / running 为**派生**字段，不落盘；nextRunAt 过期时给一个新鲜的下次时间预览 */
export async function listSchedules(workflow?: string): Promise<{ items: ScheduleItem[]; error?: string; dir: string }> {
  const { file, error } = await readSchedules();
  const names = await existingWorkflows();
  const now = new Date();
  const dir = await schedulesPath();
  const items = file.items
    .filter((it) => !workflow || it.workflow === workflow)
    .map((it) => {
      const stale = !it.nextRunAt || Date.parse(it.nextRunAt) <= now.getTime();
      let nextRunAt = it.nextRunAt;
      if (stale && !cronError(it.cron)) {
        try { nextRunAt = nextRunAtOf(it.cron, now).toISOString(); } catch { /* 保持原值 */ }
      }
      return { ...it, nextRunAt, orphan: names ? !names.has(it.workflow) : false, running: isWorkflowRunning(it.workflow) };
    });
  return { items, error, dir };
}

/** 新增 / 更新一条（带 id 则更新）；cron 非法或缺 workflow → 抛中文错误且**不落盘** */
export async function upsertSchedule(input: Partial<ScheduleItem>): Promise<ScheduleItem> {
  const workflow = String(input.workflow ?? '').trim();
  if (!workflow) throw new Error('缺少 workflow（定时项必须绑定一个工作流）');
  const cron = String(input.cron ?? '').trim();
  const bad = cronError(cron);
  if (bad) throw new Error(bad);
  const { file } = await readSchedules();
  const idx = input.id ? file.items.findIndex((it) => it.id === input.id) : -1;
  const base: ScheduleItem = idx >= 0 ? file.items[idx] : {
    id: newScheduleId(), workflow, cron, enabled: true, createdAt: new Date().toISOString(),
  };
  const next: ScheduleItem = {
    ...base,
    workflow,
    cron,
    enabled: input.enabled === undefined ? base.enabled !== false : !!input.enabled,
    inputs: input.inputs === undefined ? base.inputs : input.inputs,
    timeoutMs: input.timeoutMs === undefined ? base.timeoutMs : input.timeoutMs,
    concurrency: 'skip',
    nextRunAt: nextRunAtOf(cron, new Date()).toISOString(),
  };
  if (idx >= 0) file.items[idx] = next; else file.items.push(next);
  await writeSchedules(file);
  return next;
}

/** 删除一条；返回是否删到了 */
export async function deleteSchedule(id: string): Promise<boolean> {
  const { file } = await readSchedules();
  const before = file.items.length;
  file.items = file.items.filter((it) => it.id !== id);
  if (file.items.length === before) return false;
  await writeSchedules(file);
  return true;
}

/** 工作流改名联动：把指向 from 的定时项改成 to；返回改动条数 */
export async function renameScheduleWorkflow(from: string, to: string): Promise<number> {
  if (!from || !to || from === to) return 0;
  const { file } = await readSchedules();
  let n = 0;
  for (const it of file.items) if (it.workflow === from) { it.workflow = to; n++; }
  if (n) await writeSchedules(file);
  return n;
}

/** 更新某条的 lastRun / nextRunAt / lastStartedAt（调度器跑完回写用） */
export async function patchSchedule(id: string, patch: Partial<ScheduleItem>): Promise<void> {
  const { file } = await readSchedules();
  const it = file.items.find((x) => x.id === id);
  if (!it) return;
  Object.assign(it, patch);
  await writeSchedules(file);
}

/** 计算下次触发时间；表达式非法会抛（调用方需先用 cronError 校验） */
export function nextRunAtOf(cron: string, from: Date): Date {
  return nextRunAt(cron, from);
}
