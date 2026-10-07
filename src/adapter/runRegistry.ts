// src/adapter/runRegistry.ts
// 运行登记表（2026-10-03 定时任务轮抽出）：**手动运行与定时触发共用同一份**。
//
// 为什么必须共享：GET /run/status?name=<工作流名> 是客户端画布「待运行/运行中/完成」逐节点点亮的唯一数据源，
// 而它原来只查 api.ts 内部那张表 —— 定时任务是宿主调度器直接调 runWorkflow，压根不进那张表，于是
// **定时跑的时候画布什么都不会变**（用户 2026-10-03 真机反馈：「定时任务执行，工作流的状态不会变化」）。
// 现在两边都登记到这份注册表：定时触发与手动点运行在界面上完全同构。
//
// 另外补一条：运行结束后 activeRuns 会被摘掉（同名互斥锁释放），客户端最后一次轮询会拿到 404 而无法收敛到
// 终态 —— 所以这里按工作流名留一份「最近一次完成的运行」（lastCompleted），/run/status?name= 查不到在跑的
// 实例时回退给它，客户端据此把节点点亮成最终态（进程内保留、dsh 重启即清空）。

import type { RunSummary } from '../executor/run.js';

/** 单节点在 /run/status 里的形状（客户端 runProgress.progressToStatusMap 消费） */
export interface RunNodeResult {
  status: string;
  durationMs?: number;
  /** 节点输出（超过 RESULT_OUT_MAX 字会裁剪成字符串 + 结尾省略号） */
  out?: unknown;
  error?: { code?: string; message?: string };
  tolerated?: boolean;
  /** loop 迭代次数（out 被裁剪成字符串后，客户端仍要能显示「循环 N 次」徽标） */
  count?: number;
}

export interface ActiveRun {
  name: string;
  runId: string;
  ac: AbortController;
  status: 'running' | 'awaiting' | 'completed';
  promise: Promise<{ summary: RunSummary }>;
  awaiting?: { nodeId: string; prompt: string; createdAt: string };
  summary?: RunSummary;
  results: Record<string, RunNodeResult>;
  /** 正在执行的节点 id（/run/status 供画布依次显示「运行中」） */
  running: string[];
  finishedAt?: number;
  /** 谁发起的这次运行（面板文案/诊断用） */
  origin?: 'manual' | 'schedule';
  /** ★ 运行日志（2026-10-04 用户需求「工作流执行是黑盒，要能看到节点之间的交互」）：
   *  节点 id → 一条合并记录（入参/引用/出参/错误/耗时），与 /run/status 同一份登记表 ⇒ 手动与定时都能看 */
  log: Record<string, NodeLogEntry>;
  logOrder: string[];
}

/** 单节点运行日志：执行器的 onNodeLog 发两次（resolved=入参/引用、done=出参/错误），这里合并成一条 */
export interface NodeLogEntry {
  id: string;
  type?: string;
  /** 模板**已展开**的入参（节点真正收到的东西） */
  params?: unknown;
  /** 原始入参（保留 {{}} 引用），便于对照「引用 → 实际值」 */
  rawParams?: unknown;
  /** 本节点引用了哪些上游（节点间数据流） */
  refs?: { nodeRefs: string[]; varsUsed: string[]; inputsUsed: string[] };
  status?: string;
  out?: unknown;
  error?: { code?: string; message?: string; stack?: string };
  tolerated?: boolean;
  /** ★ 节点调试信息（2026-10-04）：AI 节点的 prompt／模型／token 用量／结束原因（超长会被裁剪） */
  debug?: unknown;
  durationMs?: number;
  startedAt?: string;
  endedAt?: string;
  /** 被截断的字段名（UI 上标注"已截断"） */
  truncated?: string[];
}

/** 日志单字段上限：日志弹窗要看内容，但也不能让响应无限大 */
export const LOG_FIELD_MAX = 4000;

function clipLogField(key: string, v: unknown, truncated: string[]): unknown {
  if (v === undefined) return undefined;
  let s: string;
  try { s = typeof v === 'string' ? v : JSON.stringify(v) ?? ''; } catch { return '（无法序列化）'; }
  if (s.length <= LOG_FIELD_MAX) return v;
  if (!truncated.includes(key)) truncated.push(key);
  return `${s.slice(0, LOG_FIELD_MAX)}\n…（日志已截断：原始 ${s.length} 字，仅显示前 ${LOG_FIELD_MAX} 字）`;
}

/** 把执行器发来的两条通知合并进该次运行的日志（resolved 先到、done 后到） */
export function mergeNodeLog(rec: ActiveRun, d: {
  id: string; type?: string; phase: 'resolved' | 'done';
  status?: string; params?: unknown; rawParams?: unknown;
  refs?: NodeLogEntry['refs']; out?: unknown;
  error?: NodeLogEntry['error']; tolerated?: boolean; debug?: unknown;
  durationMs?: number; startedAt?: string; endedAt?: string;
}): void {
  if (!rec.log) { rec.log = {}; rec.logOrder = []; }
  const cur: NodeLogEntry = rec.log[d.id] ?? { id: String(d.id) };
  if (d.type) cur.type = String(d.type);
  const truncated: string[] = cur.truncated ?? [];
  if (d.phase === 'resolved') {
    if (d.rawParams !== undefined) cur.rawParams = clipLogField('rawParams', d.rawParams, truncated);
    if (d.params !== undefined) cur.params = clipLogField('params', d.params, truncated);
    if (d.refs) cur.refs = d.refs;
  } else {
    if (d.status) cur.status = String(d.status);
    if (d.out !== undefined) cur.out = clipLogField('out', d.out, truncated);
    if (d.error) cur.error = d.error;
    if (d.debug !== undefined) cur.debug = clipLogField('debug', d.debug, truncated);
    if (d.tolerated) cur.tolerated = true;
    if (typeof d.durationMs === 'number') cur.durationMs = d.durationMs;
    if (d.startedAt) cur.startedAt = String(d.startedAt);
    if (d.endedAt) cur.endedAt = String(d.endedAt);
  }
  if (truncated.length) cur.truncated = truncated;
  rec.log[d.id] = cur;
  if (!rec.logOrder.includes(String(d.id))) rec.logOrder.push(String(d.id));
}

/** 找日志的目标运行：优先**在跑的**，其次按 runId，最后回退「该工作流最近一次完成」 */
export function getLogTarget(opts: { name?: string; runId?: string }): ActiveRun | undefined {
  const { name = '', runId = '' } = opts;
  if (runId) return runsById.get(runId) ?? lastCompleted.get(runsById.get(runId)?.name ?? '');
  if (name) return activeRuns.get(name) ?? lastCompleted.get(name);
  return undefined;
}

/** 单节点输出上限：/run/status 轮询频繁，逐节点全量输出会让响应随节点数膨胀；
 *  悬浮卡自身预览也只到 800 字，所以每节点保留 1200 字足够（完整内容仍以最终 summary 为准）。 */
export const RESULT_OUT_MAX = 1200;

/** 裁剪节点输出：小输出原样保留类型（对象/数组/标量），超长转字符串 + 尾注 */
export function clipNodeOut(v: unknown): { out?: unknown } {
  if (v === undefined) return {};
  let s: string;
  try { s = typeof v === 'string' ? v : JSON.stringify(v) ?? ''; } catch { return { out: '（无法序列化）' }; }
  if (s.length <= RESULT_OUT_MAX) return { out: v };
  return { out: `${s.slice(0, RESULT_OUT_MAX)}…（输出较长，已截断预览；完整内容见最终运行结果）` };
}

/** 把执行器的单节点结果转成 /run/status 的形状（手动与定时两条路径共用，避免两份实现漂移） */
export function nodeResultOf(r: {
  status: string;
  durationMs?: number;
  out?: unknown;
  error?: { code?: string; message?: string };
  tolerated?: boolean;
}): RunNodeResult {
  const outCount = (r.out as { count?: number } | undefined)?.count;
  return {
    status: r.status,
    durationMs: r.durationMs,
    ...clipNodeOut(r.out),
    ...(r.error ? { error: { code: r.error.code, message: String(r.error.message ?? '').slice(0, 800) } } : {}),
    ...(r.tolerated ? { tolerated: true } : {}),
    ...(typeof outCount === 'number' ? { count: outCount } : {}),
  };
}

const activeRuns = new Map<string, ActiveRun>();      // 按工作流名互斥（保持既有语义）
const runsById = new Map<string, ActiveRun>();        // 按 runId 供 status/resume 定位
const lastCompleted = new Map<string, ActiveRun>();   // 按工作流名留最近一次完成（供客户端收敛终态）

/** 登记一次新运行（同名会被调用方先拦——互斥判据仍由调用方给出文案） */
export function registerRun(rec: ActiveRun): void {
  activeRuns.set(rec.name, rec);
  runsById.set(rec.runId, rec);
}

export function getRunByName(name: string): ActiveRun | undefined {
  return name ? activeRuns.get(name) : undefined;
}

export function getRunById(runId: string): ActiveRun | undefined {
  return runId ? runsById.get(runId) : undefined;
}

/** 最近一次完成的运行（/run/status?name= 的兜底：让画布能收敛到终态） */
export function getLastCompleted(name: string): ActiveRun | undefined {
  return name ? lastCompleted.get(name) : undefined;
}

export function isRunActive(name: string): boolean {
  return !!name && activeRuns.has(name);
}

/** 运行结束：标完成、写 summary、释放同名互斥、记入 lastCompleted、顺手裁剪 */
export function finishRun(rec: ActiveRun, summary?: RunSummary): void {
  rec.status = 'completed';
  if (summary) rec.summary = summary;
  rec.finishedAt = Date.now();
  rec.running = [];
  if (activeRuns.get(rec.name) === rec) activeRuns.delete(rec.name);
  lastCompleted.set(rec.name, rec);
  pruneRuns();
}

/** 已完成的运行只留最近 20 条（等待中的永不淘汰）；lastCompleted 同样只留最近 20 个工作流 */
export function pruneRuns(): void {
  const done = [...runsById.values()].filter((r) => r.status === 'completed');
  if (done.length > 20) {
    done.sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
    for (const r of done.slice(0, done.length - 20)) runsById.delete(r.runId);
  }
  if (lastCompleted.size > 20) {
    const entries = [...lastCompleted.entries()].sort((a, b) => (a[1].finishedAt ?? 0) - (b[1].finishedAt ?? 0));
    for (const [name] of entries.slice(0, entries.length - 20)) lastCompleted.delete(name);
  }
}

/** 仅供测试：清空登记 */
export function __resetRunRegistry(): void {
  activeRuns.clear();
  runsById.clear();
  lastCompleted.clear();
}
