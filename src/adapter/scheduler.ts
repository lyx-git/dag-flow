// src/adapter/scheduler.ts
// 定时调度器（2026-10-03 用户拍板方案 v1，见 docs/SCHEDULE-PLAN.md §5）：
//   · 载体 = 插件内 tick（跑在 dsh web 宿主进程里），setInterval 20s；ctx.effect 挂 disposer
//   · 到点 → 调既有 runWorkflow(name, { inputs, interactive:false })（无交互：manual 节点自动通过）
//   · 独立执行：每次触发独立 runId，不继承上一次运行状态
//   · 并发（用户拍板 B）：同一工作流上一轮没跑完 → 本次记 `skipped`，不排队、不并发
//   · 错过补偿（用户拍板 C）：**不补跑**；启动时把已过期的 nextRunAt 直接重算
//   · 单个条目异常只记日志，**tick 永不崩**
// 可测性：tick 的全部外部依赖（时钟/存储/执行器/运行登记/日志）都可注入，假时钟单测见 test/scheduler.test.mjs。
// 注意：tick 的 interval 用 unref()——它不该成为进程存活的原因（dsh web 自己有 server handle 撑住），
//      否则测试进程/插件卸载后会因为这个定时器迟迟不退。

import { createLogger } from './logger.js';
import { newRunId } from '../executor/awaiting.js';
import { runWorkflow, type RunSummary, type NodeRunDetail } from '../executor/run.js';
import { isWorkflowRunning, markRunning, unmarkRunning } from './running.js';
import { registerRun, finishRun, nodeResultOf, mergeNodeLog, type ActiveRun } from './runRegistry.js';
import { cronError } from './cron.js';
import {
  readSchedules, writeSchedules, patchSchedule, nextRunAtOf,
  type ScheduleFile, type ScheduleItem,
} from './schedules.js';
import type { WorkflowDef, JsonValue } from '../types.js';
import { createStorage } from './storage.js';

export const TICK_MS = 20_000;

/** 一次 tick 的结果（供单测断言） */
export interface TickReport {
  /** 本次真正触发的工作流（含定时项 id） */
  triggered: { id: string; workflow: string }[];
  /** 到点但因「上一轮还在跑」被跳过 */
  skipped: { id: string; workflow: string }[];
  /** 执行中的 promise（单测 await 用；生产 fire-and-forget） */
  inflight: Promise<void>[];
  /** 无法执行（cron 非法/工作流不存在）被记下的条目 */
  invalid: { id: string; reason: string }[];
}

export interface SchedulerDeps {
  /** 当前时间（毫秒）；默认 Date.now */
  now?: () => number;
  /** 读配置（默认读 .dag-flow/schedules.json） */
  read?: () => Promise<{ file: ScheduleFile; error?: string }>;
  /** 写配置（默认原子写盘） */
  write?: (file: ScheduleFile) => Promise<void>;
  /** 回写单条（默认 patchSchedule） */
  patch?: (id: string, patch: Partial<ScheduleItem>) => Promise<void>;
  /** 执行器（默认 runWorkflow） */
  run?: (def: WorkflowDef, opts: Record<string, unknown>) => Promise<{ summary: RunSummary }>;
  /** 读取工作流定义（默认从存储读；返回 null = 不存在） */
  loadDef?: (name: string) => Promise<WorkflowDef | null>;
  /** 该工作流是否正在运行（默认查共享登记 running.ts） */
  isRunning?: (name: string) => boolean;
  logger?: { info: (m: string) => void; warn: (m: string, ...a: unknown[]) => void };
}

/** 调度器心跳状态（面板显示「● 调度器运行中（心跳 12s 前）」用） */
let heartbeat: { lastTickAt: number; ticks: number; running: boolean } = { lastTickAt: 0, ticks: 0, running: false };

export function schedulerInfo(): { running: boolean; lastTickAt: string | null; ticks: number; tickMs: number } {
  return {
    running: heartbeat.running,
    lastTickAt: heartbeat.lastTickAt ? new Date(heartbeat.lastTickAt).toISOString() : null,
    ticks: heartbeat.ticks,
    tickMs: TICK_MS,
  };
}

/** 仅供测试：重置心跳 */
export function __resetSchedulerInfo(): void {
  heartbeat = { lastTickAt: 0, ticks: 0, running: false };
}

async function defaultLoadDef(name: string): Promise<WorkflowDef | null> {
  try {
    return await createStorage().readWorkflow(name);
  } catch {
    return null;
  }
}

/**
 * 一次调度检查（可单测）：挑出「enabled && nextRunAt<=now」的条目执行。
 * @param opts.catchUp false 时（启动场景）只重算过期的 nextRunAt，**不触发**（用户拍板：不补跑）
 */
export async function tickScheduler(deps: SchedulerDeps = {}, opts: { catchUp?: boolean } = {}): Promise<TickReport> {
  const catchUp = opts.catchUp !== false;
  const now = deps.now ? deps.now() : Date.now();
  const log = deps.logger ?? createLogger();
  const read = deps.read ?? readSchedules;
  const write = deps.write ?? writeSchedules;
  const patch = deps.patch ?? patchSchedule;
  const isRunning = deps.isRunning ?? isWorkflowRunning;
  const loadDef = deps.loadDef ?? defaultLoadDef;
  const run = deps.run ?? ((def, o) => runWorkflow(def, o as never));

  const report: TickReport = { triggered: [], skipped: [], inflight: [], invalid: [] };
  // ★ 回写策略：**按条 patch**（读-改-写单条），不整文件写 —— 否则 tick 期间用户在面板新增的定时项
  //   会被这次回写整份覆盖掉（丢配置）。patch 只动本条的 nextRunAt/lastRun/lastStartedAt。
  const persist: { id: string; patch: Partial<ScheduleItem> }[] = [];
  let file: ScheduleFile;
  try {
    const r = await read();
    file = r.file;
    if (r.error) log.warn('[dag-flow] 定时配置读取异常：' + r.error);
  } catch (e) {
    log.warn('[dag-flow] 定时配置不可读，本次 tick 跳过：' + (e as Error).message);
    heartbeat = { lastTickAt: now, ticks: heartbeat.ticks + 1, running: true };
    return report;
  }

  for (const it of file.items) {
    try {
      if (!it.enabled) continue;
      // cron 非法（手工改文件/升级残留）→ 记一次不执行，并尝试修正 nextRunAt
      const bad = cronError(it.cron);
      if (bad) { report.invalid.push({ id: it.id, reason: bad }); continue; }

      let due = it.nextRunAt ? Date.parse(it.nextRunAt) : NaN;
      if (!Number.isFinite(due)) {
        // 没有下次时间（新建/损坏）→ 补算，不触发
        it.nextRunAt = nextRunAtOf(it.cron, new Date(now)).toISOString();
        persist.push({ id: it.id, patch: { nextRunAt: it.nextRunAt } });
        continue;
      }
      if (due > now) continue;
      if (!catchUp) {
        // 启动场景：过期项只重算下次时间（不补跑）
        it.nextRunAt = nextRunAtOf(it.cron, new Date(now)).toISOString();
        persist.push({ id: it.id, patch: { nextRunAt: it.nextRunAt } });
        continue;
      }
      if (isRunning(it.workflow)) {
        report.skipped.push({ id: it.id, workflow: it.workflow });
        it.lastRun = { at: new Date(now).toISOString(), status: 'skipped', error: '上一次运行还没结束，本次跳过（并发策略：skip）' };
        it.nextRunAt = nextRunAtOf(it.cron, new Date(now)).toISOString();
        persist.push({ id: it.id, patch: { lastRun: it.lastRun, nextRunAt: it.nextRunAt } });
        continue;
      }
      const def = await loadDef(it.workflow);
      if (!def) {
        report.invalid.push({ id: it.id, reason: `工作流「${it.workflow}」不存在（定时项保留，等它回来；面板会标 orphan）` });
        it.nextRunAt = nextRunAtOf(it.cron, new Date(now)).toISOString();
        persist.push({ id: it.id, patch: { nextRunAt: it.nextRunAt } });
        continue;
      }
      // 到点：先落盘新的 nextRunAt（避免同一分钟被重复触发），再 fire-and-forget 执行
      const runId = newRunId();
      const startedAt = Date.now();
      it.nextRunAt = nextRunAtOf(it.cron, new Date(now)).toISOString();
      it.lastStartedAt = new Date(now).toISOString();
      await patch(it.id, { nextRunAt: it.nextRunAt, lastStartedAt: it.lastStartedAt });
      report.triggered.push({ id: it.id, workflow: it.workflow });
      // ★ 2026-10-03 用户真机反馈「定时任务执行，工作流的状态不会变化」：
      //   定时运行也要登记到**与手动运行同一张表**（runRegistry）——否则 GET /run/status?name= 查不到，
      //   客户端画布既不会点亮「运行中/完成」，头部也不会显示运行态。ac 一并建好，
      //   这样「⏹ 取消」对定时运行同样有效（DELETE /run?name= 走同一张表）。
      const ac = new AbortController();
      const rec: ActiveRun = {
        name: it.workflow, runId, ac, status: 'running', origin: 'schedule',
        promise: Promise.resolve({ summary: undefined as unknown as RunSummary }),
        results: {}, running: [], log: {}, logOrder: [],
      };
      const p = (async () => {
        markRunning(it.workflow);
        registerRun(rec);
        try {
          const r = await run(def, {
            logger: log, cwd: process.cwd(),
            runId, interactive: false, signal: ac.signal,
            inputs: (it.inputs ?? {}) as Record<string, JsonValue>,
            onNodeStart: (id: string) => { if (!rec.running.includes(id)) rec.running.push(id); },
            // ★ 运行日志（2026-10-04）：定时运行也要能看到节点之间的交互（写入同一份登记表）
            onNodeLog: (d: NodeRunDetail) => { try { mergeNodeLog(rec, d); } catch { /* 日志采集失败不影响运行 */ } },
            onNodeDone: (id: string, res: { status: string }) => {
              rec.results[id] = nodeResultOf(res as never);
              rec.running = rec.running.filter((x) => x !== id);
            },
            ...(it.timeoutMs ? { timeoutMs: it.timeoutMs } : {}),
          });
          const s = r.summary;
          finishRun(rec, s);
          await patch(it.id, {
            lastRun: {
              at: new Date(now).toISOString(),
              status: s?.status === 'success' ? 'success' : 'failed',
              durationMs: s?.totalDurationMs ?? Date.now() - startedAt,
              runId,
              ...(s?.status === 'success' ? {} : { error: s?.error?.message ?? '运行失败' }),
            },
          });
          log.info(`[dag-flow] 定时执行完成：${it.workflow}（${s?.status ?? 'unknown'}，runId=${runId}）`);
        } catch (e) {
          finishRun(rec);
          try {
            await patch(it.id, {
              lastRun: { at: new Date(now).toISOString(), status: 'error', durationMs: Date.now() - startedAt, runId, error: (e as Error).message },
            });
          } catch { /* 回写失败不阻塞 */ }
          log.warn(`[dag-flow] 定时执行异常：${it.workflow} — ${(e as Error).message}`);
        } finally {
          unmarkRunning(it.workflow);
        }
      })();
      report.inflight.push(p);
    } catch (e) {
      // 单条异常只记日志，tick 继续（永不崩）
      log.warn(`[dag-flow] 定时项处理异常（id=${it?.id}）：${(e as Error).message}`);
    }
  }

  // 逐条回写（单条读-改-写；失败只记日志，不影响其它条目）
  for (const p of persist) {
    try { await patch(p.id, p.patch); } catch (e) { log.warn(`[dag-flow] 定时项回写失败（id=${p.id}）：${(e as Error).message}`); }
  }
  heartbeat = { lastTickAt: now, ticks: heartbeat.ticks + 1, running: true };
  return report;
}

/** 启动调度器：立刻做一次「不补跑」的过期重算，然后每 20s tick 一次；返回 disposer */
export function startScheduler(deps: SchedulerDeps = {}): { registered: boolean; reason?: string; dispose?: () => void } {
  const log = deps.logger ?? createLogger();
  const timer = setInterval(() => {
    void tickScheduler(deps).catch((e) => {
      try { log.warn('[dag-flow] 调度 tick 异常（已吞掉，不影响宿主）: ' + (e as Error).message); } catch { /* */ }
    });
  }, TICK_MS);
  // 定时器不该成为进程存活的原因（dsh web 有自己的 handle；测试进程也不该被它拖住）
  (timer as unknown as { unref?: () => void }).unref?.();
  heartbeat = { lastTickAt: Date.now(), ticks: 0, running: true };
  // 启动即重算过期项（不补跑）
  void tickScheduler(deps, { catchUp: false }).catch(() => { /* 启动失败不阻塞插件加载 */ });
  log.info(`[dag-flow] 定时调度器已启动（tick ${TICK_MS / 1000}s；dsh web 需常驻才会触发）`);
  return {
    registered: true,
    dispose: () => {
      clearInterval(timer);
      heartbeat = { ...heartbeat, running: false };
      log.info('[dag-flow] 定时调度器已停止');
    },
  };
}
