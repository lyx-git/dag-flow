// src/registry/nodes/control.ts — 控制流节点：start / end / set_var / if / switch / loop / log / manual / merge / subflow
// loop 循环体与 subflow 都走「函数内动态 import 执行器」调子工作流（防与执行器循环依赖）；
// 表达式求值在 ../expr.js。拆分自 builtin.ts（2026-10-14 重构轮 1，纯搬运）。

import type { Context, NodeDefinition, NodeResult, JsonValue } from '../../types.js';
import { ctxToScope, makeResult, safeNodeRun } from '../external.js';
import { evaluateBool, evaluateExpr } from '../expr.js';
import { waitForManual } from '../../executor/awaiting.js';
import { resolveParams } from '../../executor/dataflow.js';
import { startedEnded, finish } from './shared.js';

/** 从子工作流的 results 里挑第一个失败节点，供父层把「谁失败了、为什么」带上来。
 *  ★ 2026-10-19（用户原话「父子工作流，如果子工作流失败了，看不到是哪个节点失败了，失败的原因是啥」）：
 *    此前父层只有「子工作流以 failed 结束」这类整句，用户必须自己翻子工作流的运行记录才知道根因。
 *    这里只做**摘要**：message 压成单行并截断（429 这类错误会带一整块 JSON，不截会把浮窗撑爆）。
 *    完整明细仍在子工作流自己的运行记录里（`runs/<子工作流名>/`）。 */
const firstFailure = (results: Record<string, NodeResult>): { id: string; code: string; message: string } | null => {
  for (const [id, r] of Object.entries(results ?? {})) {
    if (r?.status !== 'failed') continue;
    const code = String(r.error?.code ?? 'UNKNOWN');
    const flat = String(r.error?.message ?? '').replace(/\s+/g, ' ').trim();
    return { id, code, message: flat.length > 200 ? `${flat.slice(0, 200)}…` : flat };
  }
  return null;
};

/** 失败原因后缀：`：节点「ai_dir」失败 —— SUBAGENT_UNAVAILABLE：…`；找不到失败节点时返回空串（文案回退原样）。 */
const failSuffix = (f: ReturnType<typeof firstFailure>): string =>
  f ? `：节点「${f.id}」失败 —— ${f.code}${f.message ? `：${f.message}` : ''}` : '';

// ---------- 1. start ----------
export const startDef: NodeDefinition = {
  type: 'start',
  schema: { type: 'object', additionalProperties: false, properties: {} },
  run: async (_ctx, params) => {
    const { startedAt, t0 } = startedEnded();
    return finish(t0, startedAt, { out: (params as unknown as JsonValue | null) ?? null });
  },
  describe: () => ({ label: '开始', category: 'control' }),
};

// ---------- 2. end ----------
export const endDef: NodeDefinition = {
  type: 'end',
  schema: { type: 'object', additionalProperties: false, properties: { outputs: { type: 'object' } } },
  run: async (ctx, params) => {
    const { startedAt, t0 } = startedEnded();
    const outputs = (params as { outputs?: Record<string, JsonValue> })?.outputs ?? {};
    return finish(t0, startedAt, { out: { ...ctx.vars, ...(outputs as Record<string, JsonValue>) } });
  },
  describe: () => ({ label: '结束', category: 'control' }),
};

// ---------- 7. set_var ----------
interface SetVarParams { vars: Record<string, JsonValue> }
export const setVarDef: NodeDefinition<SetVarParams> = {
  type: 'set_var',
  schema: {
    type: 'object', required: ['vars'], additionalProperties: false,
    properties: { vars: { type: 'object', additionalProperties: true } },
  },
  run: async (ctx, p) => {
    const { startedAt, t0 } = startedEnded();
    Object.assign(ctx.vars, p.vars);
    return finish(t0, startedAt, { out: { ...p.vars } });
  },
  describe: () => ({ label: '设置变量', category: 'data' }),
};

// ---------- 8. if ----------
interface IfParams { condition: string }
export const ifDef: NodeDefinition<IfParams> = {
  type: 'if',
  schema: { type: 'object', required: ['condition'], additionalProperties: false, properties: { condition: { type: 'string', minLength: 1 } } },
  run: async (ctx, p) => {
    const { startedAt, t0 } = startedEnded();
    const v = evaluateBool(p.condition, ctxToScope(ctx));
    return finish(t0, startedAt, { out: v });
  },
  describe: () => ({ label: '条件分支', category: 'control' }),
};

// ---------- 9. switch ----------
interface SwitchParams { value: string; cases: Record<string, string> }
export const switchDef: NodeDefinition<SwitchParams> = {
  type: 'switch',
  schema: {
    type: 'object', required: ['value', 'cases'], additionalProperties: false,
    properties: {
      value: { type: 'string', minLength: 1 },
      cases: { type: 'object', additionalProperties: { type: 'string' } },
    },
  },
  run: async (ctx, p) => {
    const { startedAt, t0 } = startedEnded();
    // ★ value 兼容两种写法（2026-10-02 用户反馈「无法按条件分支」）：表达式（'"b"'、'{{x}}'）
    //   与裸字面量（'A' 直接当值匹配）。此前裸字面量经 evaluateExpr 求值为 undefined →
    //   matched='' → 所有分支都不激活且无报错。现：求值失败/undefined → 回退原始字符串字面量。
    let v: unknown;
    try {
      v = evaluateExpr(p.value, ctxToScope(ctx));
    } catch { v = undefined; }
    const matched = v === undefined || v === null ? String(p.value ?? '') : String(v);
    const target = p.cases[matched] ?? p.cases['*'] ?? null;
    return finish(t0, startedAt, { out: { matched, target } });
  },
  describe: () => ({ label: '多路分支', category: 'control' }),
};

// ---------- 10. loop ----------
/** 循环体规格（2026-10-03 用户拍板方案 A：子工作流当循环体） */
/** ★ 2026-10-20 用户要求「子工作流如果被多个父工作流并发执行了，需要解决一下这个问题」：
 *  同一个**运行目录**里并发调用**同一个子工作流** ⇒ 按 `<runDir>|<子工作流名>` 串行排队。
 *  · 为什么不换目录：一次运行内整棵树共用父 runDir（父节点的 python 就是靠 glob 这个目录读子工作流产物的），
 *    换成子目录会直接切断既有数据流；
 *  · 为什么不按工作流名全局排队：不同父运行各有自己的 runDir，本来就互不影响，全局排队只会白白串行；
 *  · 只在内存排队、进程重启即清空；排队不改变任何产物路径与语义，只是不并发写同一批文件。
 *  · 运行记录（run.json）只有顶层运行写 ⇒ 并发子工作流不会在 `tmp/<子名>/` 互相覆盖。 */
const subflowQueues = new Map<string, Promise<unknown>>();
export function runSubflowSerialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = subflowQueues.get(key) ?? Promise.resolve();
  const task = prev.then(fn, fn);
  const tail: Promise<unknown> = task.then(() => undefined, () => undefined);
  subflowQueues.set(key, tail);
  void tail.then(() => { if (subflowQueues.get(key) === tail) subflowQueues.delete(key); });
  return task;
}

interface LoopBodySpec { workflowName?: string; inputs?: Record<string, JsonValue> }
interface LoopParams {
  count?: number; over?: JsonValue[]; maxIterations?: number;
  /** ★ 2026-10-19（用户拍板 A）：「每轮条件」—— 每轮开始前求值，为真才执行本轮循环体，
   *  为假就跳过这一轮（不写 out.items）继续下一轮。要"满足条件就整体结束"请用循环体里的 break。 */
  roundIf?: string;
  body?: LoopBodySpec;
  /** 某轮循环体失败时的策略：stop（默认，整节点失败但保留已完成轮次）/ continue（该轮写占位继续跑） */
  onIterationError?: 'stop' | 'continue';
}
// 防无限嵌套：loop 节点内部不再"递归调用自身 run"（旧实现 def.run 会无限递归爆炸）。
// ★ 2026-10-03：支持 body=子工作流当循环体——只扩本节点 run、复用 subflow 的调用机制，
//   不动 topoSort/DAG、不需要画布回边。每轮结果依次进 out.items，下游写法与无 body 时完全一致。
/** ★ 2026-10-19（用户拍板 A「子工作流怎么配置，打断循环节点执行」）：约定的**控制信号** ——
 *  子工作流 end 的输出里带 `break: true` 就表示「本轮跑完别再跑下一轮」。只认这一个键，
 *  end 的其它输出照旧原样进 out.items；不写这个键的老循环一字不变（纯加法）。 */
function isBreakOutput(v: JsonValue): boolean {
  return !!v && typeof v === 'object' && !Array.isArray(v) && (v as Record<string, JsonValue>)['break'] === true;
}
async function runLoop(p: LoopParams, ctx: Context): Promise<NodeResult> {
  const { startedAt, t0 } = startedEnded();
  /** schema 里的硬保护上限：任何模式都不会超过它（count / over 留空时唯一的限制） */
  const HARD_CAP = 100_000;
  /** 用户**显式填了** maxIterations（夹到硬保护内）；没填＝null */
  const explicitCap = typeof p.maxIterations === 'number' ? Math.min(p.maxIterations, HARD_CAP) : null;
  /** ★ 2026-10-19（用户拍板 A：「不填应该是按照数组实际有多少数据执行的」）：
   *  count / over **留空＝不设上限**，按数据实际长度 / count 实际值执行，只受 HARD_CAP 保护（被它截断时照旧标 truncated）；
   *  填了才按填的值截断。（while 已移除，那段"留空＝1000 保险丝"的特例随之消失。） */
  const countOverCap = explicitCap ?? HARD_CAP;
  const iterations: JsonValue[] = [];
  /** ★ 2026-10-19（用户拍板 A：让「超上限」可见）：count / over 的轮数超过上限时，
   *  以前只处理前 N 个、**不报错也不提示**（out.count 只显示上限数，看不出还有几千项没跑）。
   *  现在把这次截断记下来，落进 out（truncated / requested / processed）——只在**真发生截断**时出现，
   *  没截断时 out 形态与以前一字不差，既有下游引用零影响。 */
  let truncation: { requested: number; processed: number } | null = null;
  /** ★ 2026-10-19（用户拍板 A：每轮条件）：配置了才生效，out 里补 rounds（共经过几轮）/ skipped（跳过几轮）——
   *  没配时不出现这两个字段，既有循环的 out 形态与以前一字不差。 */
  const gateOn = typeof p.roundIf === 'string' && p.roundIf.trim() !== '';
  const gateInfo = gateOn ? { rounds: 0, skipped: 0 } : null;
  /** out 的公共形态：count / items（既有形态）；**只在真发生截断时**追加 truncated / requested / processed */
  const loopOut = (count: number, items: JsonValue[], withGate = true): Record<string, JsonValue> => ({
    ...(truncation
      ? { count, items, truncated: true, requested: truncation.requested, processed: truncation.processed }
      : { count, items }),
    ...(gateInfo && withGate ? { rounds: gateInfo.rounds, skipped: gateInfo.skipped } : {}),
  });

  if (Array.isArray(p.over)) {
    // 数组迭代（A6-lite）：over 经 {{u.out.items}} 引用上游数组，逐项收集
    const n = Math.min(p.over.length, countOverCap);
    if (p.over.length > n) truncation = { requested: p.over.length, processed: n };
    for (let i = 0; i < n; i++) iterations.push(p.over[i]);
  } else if (p.over !== undefined && p.over !== null && String(p.over).trim() !== '') {
    // ★ 2026-10-19（用户拍板「改」）：over 配了、但**解析后不是数组** —— 以前会一路落到 count / while /
    //   LOOP_NO_BOUND，最后报「缺少循环边界——count / while / over 至少配置一个」，把"没配"和"配了但取值失败"
    //   混成一句话，用户看到只会以为自己没填。给专属码 + 实际拿到的类型 + 检查方向。
    //   判据细节：空串/空白（面板刚切到 over、还没填值）**不算配了** ⇒ 仍走下面的 LOOP_NO_BOUND。
    return { ...makeResult('failed', { error: { code: 'LOOP_OVER_NOT_ARRAY', message: `over 解析出来不是数组（实际是 ${typeof p.over}）——按数组长度循环要求 over 是一个数组：请检查 {{…}} 引用路径是否指到数组本身（如 {{节点id.out.items}}），以及上游这一轮是否真的产出了数组。` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  } else if (typeof p.count === 'number') {
    const want = Math.max(0, Math.floor(p.count));
    const n = Math.min(want, countOverCap);
    if (want > n) truncation = { requested: want, processed: n };
    for (let i = 0; i < n; i++) iterations.push(i);
  } else {
    // ★ 2026-10-19（用户拍板：**while 条件循环整条移除**，循环只保留 count / over；"跑到满足条件为止"改用
    //   循环体里判断 + `break: true`）。老数据里残留的 while 键由 schema 宽容（引擎不再读取），这里只报"没有边界"。
    return { ...makeResult('failed', { error: { code: 'LOOP_NO_BOUND', message: '缺少循环边界——count / over 至少配置一个（条件循环已移除：要"满足条件就停"，请在循环体里用条件节点判断，并让 end 输出 break: true）' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }

  const body = p.body;
  // 无循环体：保持原语义——只产出迭代序列 {count, items}（每轮条件没有"轮"可判断 ⇒ 不生效，也不带 rounds/skipped）
  if (!body?.workflowName) return finish(t0, startedAt, { out: loopOut(iterations.length, iterations, false) });

  // —— 循环体：逐轮调用子工作流（方案 A）——
  const depth = (ctx as Context & { _depth?: number })._depth ?? 0;
  if (depth >= MAX_SUBFLOW_DEPTH) {
    return { ...makeResult('failed', { error: { code: 'SUBFLOW_DEPTH', message: `子工作流嵌套超过 ${MAX_SUBFLOW_DEPTH} 层上限` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }
  const { createStorage } = await import('../../adapter/storage.js');
  const { createLogger } = await import('../../adapter/logger.js');
  const { runWorkflow } = await import('../../executor/run.js');
  const sub = await createStorage().readWorkflow(String(body.workflowName));
  if (!sub) {
    return { ...makeResult('failed', { error: { code: 'WORKFLOW_NOT_FOUND', message: `循环体子工作流不存在: ${body.workflowName}（先在工作流面板保存，或检查名称）` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }
  const myId = String((ctx as Context & { currentNodeId?: string }).currentNodeId ?? 'loop');
  const outputs: JsonValue[] = [];
  /** 每轮条件的作用域：在 ctxToScope 之上注入 lastOutput（上一轮 end 输出）与轮次序号（while 已移除，这里是它唯一消费者） */
  const roundScope = (i: number, last: JsonValue): Record<string, unknown> => ({
    ...ctxToScope(ctx),
    lastOutput: last,
    // 顶层也给一份（表达式里 `loopIndex` 与 `vars.loopIndex` 两种写法都行，跟模板注入保持一致）
    loopItem: i,
    loopIndex: i,
    vars: { ...(ctx.vars ?? {}), loopItem: i, loopIndex: i },
  });
  /** ★ 初始值是**空对象**而不是 null：表达式引擎里 `null` / `undefined` 会被当变量名（实测 `undefined variable: null`），
   *  空对象则属性访问安全（`lastOutput.x` 得 undefined）⇒ 条件写错也不会把整轮炸掉。要判断"第一轮"用 `loopIndex == 0`。 */
  let lastOutput: JsonValue = {} as JsonValue;
  // 轮数＝已算好的迭代序列长度（while 已移除，不再有"边跑边判"的动态轮数）
  const totalRounds = iterations.length;
  for (let i = 0; i < totalRounds; i++) {
    if (ctx.signal?.aborted) {
      return { ...makeResult('failed', { error: { code: 'RUN_CANCELLED', message: '运行已由用户取消' } }), out: loopOut(outputs.length, outputs), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() } as NodeResult;
    }
    // ★ 2026-10-19（用户拍板 A：每轮条件）：「自定义判断」—— 每轮开始前求值，为真才执行本轮循环体；
    //   为假就**跳过这一轮**（不写 out.items），直接进入下一轮；跳过不影响 lastOutput（仍是上一轮真跑出来的输出）。
    if (gateInfo) {
      gateInfo.rounds = i + 1;
      let runThis = false;
      try {
        runThis = evaluateBool(p.roundIf as string, roundScope(i, lastOutput));
      } catch (e) {
        return { ...makeResult('failed', { error: { code: 'LOOP_COND_ERROR', message: `第 ${i + 1} 轮前求值「每轮条件」失败——${(e as Error).message}。可引用：运行前已完成的节点、lastOutput（上一轮循环体 end 的输出）、loopIndex（轮次序号）。` } }), out: loopOut(outputs.length, outputs), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() } as NodeResult;
      }
      if (!runThis) { gateInfo.skipped += 1; continue; }
    }
    // 当轮上下文：注入 {{vars.loopItem}} / {{vars.loopIndex}}，供 body.inputs 引用（也可引用上游 {{节点id.out.x}}）
    // ★ 2026-10-19（用户选 A：把上一轮输出注入循环体传参）：再加 {{vars.lastOutput}}（上一轮循环体 end 的输出；
    //   第一轮是空对象 {}）⇒ 循环体传参能"接着上一轮往下干"（游标 / 累加 / 翻页），不必只靠 out.items 事后汇总。
    const iterCtx = { ...ctx, vars: { ...(ctx.vars ?? {}), loopItem: iterations[i] as JsonValue, loopIndex: i, lastOutput } } as Context;
    let inputs: Record<string, JsonValue>;
    try {
      inputs = resolveParams((body.inputs ?? {}) as Record<string, JsonValue>, iterCtx, myId);
    } catch (e) {
      return { ...makeResult('failed', { error: { code: 'DATAFLOW_REF', message: `循环体第 ${i + 1} 轮输入解析失败: ${(e as Error).message}` } }), out: loopOut(outputs.length, outputs), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() } as NodeResult;
    }
    const { summary } = await runSubflowSerialized(
      `${ctx.runDir ?? ''}|${sub.name}`,
      () => runWorkflow(sub, { logger: createLogger(), cwd: process.cwd(), inputs, _depth: depth + 1, signal: ctx.signal, runId: ctx.runId, runDir: ctx.runDir }),
    );
    const endIds = sub.nodes.filter((n) => n.type === 'end').map((n) => n.id);
    const endOut = (endIds.map((id) => summary.results[id]?.out).find((v) => v != null) ?? null) as JsonValue;
    const ff = firstFailure(summary.results);
    const why = failSuffix(ff);
    if (summary.status !== 'success' && p.onIterationError !== 'continue') {
      // 默认 stop：整节点失败，但把已完成轮次留在 out.items 里便于排查
      // ★ 2026-10-19：补 failedRound / failedNode（纯加法）—— 父层失败浮窗与运行记录里能直接看到「第几轮、哪个节点、什么码」。
      const failOut: Record<string, JsonValue> = { ...loopOut(outputs.length, outputs), failedRound: i + 1 };
      if (ff) failOut.failedNode = ff as unknown as JsonValue;
      return { ...makeResult('failed', { error: { code: 'LOOP_BODY_FAILED', message: `第 ${i + 1}/${iterations.length} 轮循环体「${sub.name}」以 ${summary.status} 结束${why}——已完成 ${outputs.length} 轮，结果保留在 out.items 里（要跳过失败轮请设 onIterationError: "continue"）` } }), out: failOut, durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() } as NodeResult;
    }
    outputs.push(summary.status === 'success'
      ? endOut
      : ({ error: { code: 'SUBFLOW_FAILED', message: `第 ${i + 1} 轮失败${why}` }, output: endOut, ...(ff ? { failedNode: ff } : {}) } as unknown as JsonValue));
    lastOutput = outputs[outputs.length - 1];   // 下一轮的 {{vars.lastOutput}} / 每轮条件看的就是它
    // ★ 2026-10-19（用户拍板 A）：子工作流 end 输出里带 `break: true` ⇒ **本轮跑完就停**，剩余轮不再跑。
    //   节点仍算 success（这是正常收敛，不是失败）；out 里补 broken / breakAt（第几轮停的），
    //   已完成轮次照旧在 out.items 里（那一轮的 end 输出也含 break 键，便于排查）。
    if (isBreakOutput(lastOutput)) {
      return finish(t0, startedAt, { out: { ...loopOut(outputs.length, outputs), broken: true, breakAt: i + 1 } });
    }
  }
  return finish(t0, startedAt, { out: loopOut(outputs.length, outputs) });
}
export const loopDef: NodeDefinition<LoopParams> = {
  type: 'loop',
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      count: { type: 'integer', minimum: 0 },
      // ★ 2026-10-19（用户拍板：while 条件循环整条移除）：下面三个**只为兼容老数据**保留在 schema 里，
      //   引擎已不再读取（直接删键会让老 def 因 additionalProperties:false 校验失败 ⇒ 违反"不影响现有功能"）。
      while: { type: 'string' },
      whileMode: { type: 'string', enum: ['true', 'false'] },
      dangerouslyAllowInfinite: { type: 'boolean' },
      // ★ 2026-10-19：每轮条件（门禁）——为真才执行本轮循环体，为假跳过该轮继续下一轮
      roundIf: { type: 'string' },
      over: { type: 'array' },
      maxIterations: { type: 'integer', minimum: 1, maximum: 100_000 },
      // ★ 循环体（方案 A）：每轮调用该子工作流；inputs 里用 {{vars.loopItem}} / {{vars.loopIndex}}
      body: {
        type: 'object', additionalProperties: false,
        properties: { workflowName: { type: 'string', minLength: 1 }, inputs: { type: 'object', additionalProperties: true } },
        required: ['workflowName'],
      },
      onIterationError: { enum: ['stop', 'continue'] },
    },
    // 老 def 里只有 while 的节点也放行（结构校验不炸），运行时会给 LOOP_NO_BOUND 的明确提示 —— 见 runLoop。
    anyOf: [{ required: ['count'] }, { required: ['over'] }, { required: ['while'] }],
  },
  run: async (ctx, p) => safeNodeRun(() => runLoop(p as never, ctx)),
  describe: () => ({ label: '循环', category: 'control' }),
};

// ---------- 11. log ----------
interface LogParams { level?: 'info' | 'warn' | 'error'; message: string }
export const logDef: NodeDefinition<LogParams> = {
  type: 'log',
  schema: {
    type: 'object', required: ['message'], additionalProperties: false,
    properties: { level: { enum: ['info', 'warn', 'error'] }, message: { type: 'string' } },
  },
  run: async (_ctx, p) => {
    const { startedAt, t0 } = startedEnded();
    const line = `[workflow] ${p.message}`;
    if (p.level === 'error') console.error(line);
    else if (p.level === 'warn') console.warn(line);
    else console.info(line);
    return finish(t0, startedAt, { out: p.message });
  },
  describe: () => ({ label: '日志', category: 'misc' }),
};

// ---------- 12. manual ----------
interface ManualParams { prompt: string; schema?: object }
export const manualDef: NodeDefinition<ManualParams> = {
  type: 'manual',
  schema: {
    type: 'object', required: ['prompt'], additionalProperties: false,
    properties: { prompt: { type: 'string' }, schema: { type: 'object' } },
  },
  // 人工确认（2026-10-03 用户拍板「真暂停 + 恢复」）：
  //   交互式运行（HTTP /run）→ 登记挂起并等 POST /run/resume；确认后 out.value = 用户备注。
  //   非交互路径（CLI /workflow 工具、subflow 子工作流内部）→ 无人可点，自动通过 + warning 留痕
  //   （旧实现是 v0.1 空壳：任何场景都立即返回 success，用户反馈「人工确认节点没作用」）。
  run: async (ctx, p) => {
    const { startedAt, t0 } = startedEnded();
    const prompt = String(p.prompt ?? '');
    const nodeId = (ctx as Context & { currentNodeId?: string }).currentNodeId ?? '';
    const confirmedAt = new Date().toISOString();
    if (!ctx.interactive || !ctx.runId) {
      ctx.logger?.warn('manual 节点在非交互环境自动通过（无人可确认）', { nodeId, prompt: prompt.slice(0, 120) });
      return finish(t0, startedAt, { out: { prompt, confirmed: true, autoPassed: true, value: '', confirmedAt } });
    }
    ctx.onAwaiting?.({ runId: ctx.runId, nodeId, prompt });
    try {
      const r = await waitForManual({ runId: ctx.runId, nodeId, prompt, createdAt: confirmedAt }, ctx.signal);
      return finish(t0, startedAt, {
        out: { prompt, confirmed: true, value: r.value, confirmedAt: new Date().toISOString() },
      });
    } catch (e) {
      // 用户点「取消本次运行」→ 挂起被 reject（不抛异常，转显式失败结果）
      return {
        ...makeResult('failed', { error: { code: 'MANUAL_CANCELLED', message: `人工确认未完成：${(e as Error).message}` } }),
        durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString(),
      };
    }
  },
  describe: () => ({ label: '手动确认', category: 'control' }),
};

// ---------- 13. merge（#A5：并行分支合流） ----------
export const mergeDef: NodeDefinition = {
  type: 'merge',
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      keys: { type: 'array', items: { type: 'string' }, description: '可选：输出键名列表（按上游顺序）；缺省用上游节点 id' },
    },
  },
  run: async (ctx, p) => {
    const { startedAt, t0 } = startedEnded();
    const my = (ctx as Context & { currentNodeId?: string }).currentNodeId ?? '';
    const upstreams = (ctx as Context & { upstreams?: Record<string, string[]> }).upstreams?.[my] ?? [];
    if (upstreams.length < 2) {
      return { ...makeResult('failed', { error: { code: 'MERGE_NO_UPSTREAM', message: `merge 需要至少 2 条上游连线（当前 ${upstreams.length} 条）——把多个分支的输出连入 merge 节点` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    }
    const out: Record<string, JsonValue> = {};
    upstreams.forEach((uid, i) => {
      const key = (p as { keys?: string[] })?.keys?.[i] ?? uid;
      out[key] = ctx.results[uid]?.out ?? null;
    });
    return finish(t0, startedAt, { out });
  },
  describe: () => ({ label: '合流', category: 'control' }),
};

// ---------- 14. subflow（#A7：子工作流调用） ----------
const MAX_SUBFLOW_DEPTH = 5;
export const subflowDef: NodeDefinition = {
  type: 'subflow',
  schema: {
    type: 'object', required: ['workflowName'], additionalProperties: false,
    properties: {
      workflowName: { type: 'string', minLength: 1 },
      inputs: { type: 'object', additionalProperties: true },
    },
  },
  run: async (ctx, p) => {
    const { startedAt, t0 } = startedEnded();
    const q = p as { workflowName?: string; inputs?: Record<string, JsonValue> };
    const depth = (ctx as Context & { _depth?: number })._depth ?? 0;
    if (depth >= MAX_SUBFLOW_DEPTH) {
      return { ...makeResult('failed', { error: { code: 'SUBFLOW_DEPTH', message: `子工作流嵌套超过 ${MAX_SUBFLOW_DEPTH} 层上限` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    }
    if (ctx.signal?.aborted) {
      return { ...makeResult('failed', { error: { code: 'RUN_CANCELLED', message: '运行已由用户取消' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    }
    const { createStorage } = await import('../../adapter/storage.js');
    const { createLogger } = await import('../../adapter/logger.js');
    const { runWorkflow } = await import('../../executor/run.js');
    const sub = await createStorage().readWorkflow(String(q.workflowName ?? ''));
    if (!sub) {
      return { ...makeResult('failed', { error: { code: 'WORKFLOW_NOT_FOUND', message: `子工作流不存在: ${q.workflowName}（先在工作流面板保存，或检查名称）` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    }
    const { summary } = await runSubflowSerialized(`${ctx.runDir ?? ''}|${sub.name}`, () => runWorkflow(sub, {
      logger: createLogger(),
      cwd: process.cwd(),
      // ★ 模板解析由**执行器统一**负责（run.ts 对每个节点的 params 走 resolveParams），
      //   这里拿到的 inputs 已经是解析后的值 —— 与其它节点同语义，**不要**在这里再解析一遍
      //   （第二遍会把"解析结果里恰好含 {{...}} 的字符串"当模板再解，与其它节点行为不一致）。
      inputs: (q.inputs ?? {}) as Record<string, JsonValue>,
      _depth: depth + 1,
      signal: ctx.signal,
      // ★ 2026-10-18：沿用父运行的 runId + 临时目录（子工作流的产物要能被上层节点读到）
      runId: ctx.runId,
      runDir: ctx.runDir,
    }));
    // 收集子流程 end 节点输出作为本节点输出
    const endIds = sub.nodes.filter((n) => n.type === 'end').map((n) => n.id);
    const endOut = endIds.map((id) => summary.results[id]?.out).find((v) => v != null) ?? null;
    // ★ 2026-10-19：子工作流失败时把「哪个节点、什么错误码、说了什么」带到父层（用户原话见文件头 firstFailure 注释）
    const ff = firstFailure(summary.results);
    const why = failSuffix(ff);
    const subOut: Record<string, JsonValue> = {
      workflow: sub.name, status: summary.status, totalDurationMs: summary.totalDurationMs, output: endOut, failedCount: summary.failedCount,
      ...(summary.status !== 'success' && ff ? { failedNode: ff as unknown as JsonValue } : {}),
    };
    // ★ 2026-10-19 修「子工作流失败了但父层看不出来」：此前本节点用 finish() 返回 ⇒ **status 恒为 success**，
    //   即使带了 error 字段，执行器（run.ts 只看 r.status === 'failed'）也不会把下游停掉、整图还会算成功。
    //   现在子工作流非 success 就返回 failed ⇒ 失败能正常向上传播（下游 skipped、整图 failed）。
    if (summary.status !== 'success') {
      return {
        ...makeResult('failed', { out: subOut, error: { code: 'SUBFLOW_FAILED', message: `子工作流「${sub.name}」以 ${summary.status} 结束${why}` } }),
        durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString(),
      } as NodeResult;
    }
    return finish(t0, startedAt, { out: subOut });
  },
  describe: () => ({ label: '子工作流', category: 'control' }),
};
