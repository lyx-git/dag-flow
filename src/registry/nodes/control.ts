// src/registry/nodes/control.ts — 控制流节点：start / end / set_var / if / switch / loop / log / manual / merge / subflow
// loop 循环体与 subflow 都走「函数内动态 import 执行器」调子工作流（防与执行器循环依赖）；
// 表达式求值在 ../expr.js。拆分自 builtin.ts（2026-10-14 重构轮 1，纯搬运）。

import type { Context, NodeDefinition, NodeResult, JsonValue } from '../../types.js';
import { ctxToScope, makeResult, safeNodeRun } from '../external.js';
import { evaluateBool, evaluateExpr } from '../expr.js';
import { waitForManual } from '../../executor/awaiting.js';
import { resolveParams } from '../../executor/dataflow.js';
import { startedEnded, finish } from './shared.js';

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
interface LoopBodySpec { workflowName?: string; inputs?: Record<string, JsonValue> }
interface LoopParams {
  count?: number; while?: string; over?: JsonValue[]; maxIterations?: number;
  dangerouslyAllowInfinite?: boolean; dangerouslyAllowDestructive?: boolean;
  body?: LoopBodySpec;
  /** 某轮循环体失败时的策略：stop（默认，整节点失败但保留已完成轮次）/ continue（该轮写占位继续跑） */
  onIterationError?: 'stop' | 'continue';
}
// 防无限嵌套：loop 节点内部不再"递归调用自身 run"（旧实现 def.run 会无限递归爆炸）。
// ★ 2026-10-03：支持 body=子工作流当循环体——只扩本节点 run、复用 subflow 的调用机制，
//   不动 topoSort/DAG、不需要画布回边。每轮结果依次进 out.items，下游写法与无 body 时完全一致。
async function runLoop(p: LoopParams, ctx: Context): Promise<NodeResult> {
  const { startedAt, t0 } = startedEnded();
  const maxIter = Math.min(p.maxIterations ?? 1_000, 100_000);
  const iterations: JsonValue[] = [];

  if (Array.isArray(p.over)) {
    // 数组迭代（A6-lite）：over 经 {{u.out.items}} 引用上游数组，逐项收集
    const n = Math.min(p.over.length, maxIter);
    for (let i = 0; i < n; i++) iterations.push(p.over[i]);
  } else if (typeof p.count === 'number') {
    const n = Math.max(0, Math.min(Math.floor(p.count), maxIter));
    for (let i = 0; i < n; i++) iterations.push(i);
  } else if (typeof p.while === 'string') {
    let i = 0;
    // ★ 2026-10-11（用户要求修 ②）：while 条件求值抛错（写错变量名 / 引用自身 / 引用循环体内部状态）
    //   以前会冒到 safeNodeRun 被兜成 `UNCAUGHT`——错误码没有信息量，用户只看到"undefined variable"。
    //   这里就地接住，给专属码 + 人话 + 出路。
    //   ★ 仍然保持**失败**（不学 if 的"静默 false"）：while 静默变 false 就等于「0 轮 + 整轮成功」，
    //     那正是本项目最忌讳的静默成功；而 if 的静默 false 是用户拍板过的既有语义（另有笔误告警）。
    try {
      while (i < maxIter) {
        const keepGoing = evaluateBool(p.while, ctxToScope(ctx));
        if (!keepGoing) break;
        iterations.push(i);
        i++;
        if (i >= maxIter && !p.dangerouslyAllowInfinite) {
          return { ...makeResult('failed', { error: { code: 'LOOP_MAX_ITER', message: `达到最大迭代次数 ${maxIter}——如确认要继续，设置 dangerouslyAllowInfinite: true` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
        }
      }
    } catch (e) {
      return { ...makeResult('failed', { error: { code: 'LOOP_COND_ERROR', message: `循环条件求值失败——${(e as Error).message}。条件里只能引用「运行前已完成」的节点；循环体内部的状态进不了条件——按固定次数循环请改用 count，遍历上游数组请改用 over。` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    }
  } else {
    return { ...makeResult('failed', { error: { code: 'LOOP_NO_BOUND', message: '缺少循环边界——count / while / over 至少配置一个' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }

  const body = p.body;
  // 无循环体：保持原语义——只产出迭代序列 {count, items}
  if (!body?.workflowName) return finish(t0, startedAt, { out: { count: iterations.length, items: iterations } });

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
  for (let i = 0; i < iterations.length; i++) {
    if (ctx.signal?.aborted) {
      return { ...makeResult('failed', { error: { code: 'RUN_CANCELLED', message: '运行已由用户取消' } }), out: { count: outputs.length, items: outputs }, durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() } as NodeResult;
    }
    // 当轮上下文：注入 {{vars.loopItem}} / {{vars.loopIndex}}，供 body.inputs 引用（也可引用上游 {{节点id.out.x}}）
    const iterCtx = { ...ctx, vars: { ...(ctx.vars ?? {}), loopItem: iterations[i] as JsonValue, loopIndex: i } } as Context;
    let inputs: Record<string, JsonValue>;
    try {
      inputs = resolveParams((body.inputs ?? {}) as Record<string, JsonValue>, iterCtx, myId);
    } catch (e) {
      return { ...makeResult('failed', { error: { code: 'DATAFLOW_REF', message: `循环体第 ${i + 1} 轮输入解析失败: ${(e as Error).message}` } }), out: { count: outputs.length, items: outputs }, durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() } as NodeResult;
    }
    const { summary } = await runWorkflow(sub, { logger: createLogger(), cwd: process.cwd(), inputs, _depth: depth + 1, signal: ctx.signal });
    const endIds = sub.nodes.filter((n) => n.type === 'end').map((n) => n.id);
    const endOut = (endIds.map((id) => summary.results[id]?.out).find((v) => v != null) ?? null) as JsonValue;
    if (summary.status !== 'success' && p.onIterationError !== 'continue') {
      // 默认 stop：整节点失败，但把已完成轮次留在 out.items 里便于排查
      return { ...makeResult('failed', { error: { code: 'LOOP_BODY_FAILED', message: `第 ${i + 1}/${iterations.length} 轮循环体「${sub.name}」以 ${summary.status} 结束——已完成 ${outputs.length} 轮，结果保留在 out.items 里（要跳过失败轮请设 onIterationError: "continue"）` } }), out: { count: outputs.length, items: outputs }, durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() } as NodeResult;
    }
    outputs.push(summary.status === 'success'
      ? endOut
      : ({ error: { code: 'SUBFLOW_FAILED', message: `第 ${i + 1} 轮失败` }, output: endOut } as JsonValue));
  }
  return finish(t0, startedAt, { out: { count: outputs.length, items: outputs } });
}
export const loopDef: NodeDefinition<LoopParams> = {
  type: 'loop',
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      count: { type: 'integer', minimum: 0 },
      while: { type: 'string' },
      over: { type: 'array' },
      maxIterations: { type: 'integer', minimum: 1, maximum: 100_000 },
      dangerouslyAllowInfinite: { type: 'boolean' },
      // ★ 循环体（方案 A）：每轮调用该子工作流；inputs 里用 {{vars.loopItem}} / {{vars.loopIndex}}
      body: {
        type: 'object', additionalProperties: false,
        properties: { workflowName: { type: 'string', minLength: 1 }, inputs: { type: 'object', additionalProperties: true } },
        required: ['workflowName'],
      },
      onIterationError: { enum: ['stop', 'continue'] },
    },
    anyOf: [{ required: ['count'] }, { required: ['while'] }, { required: ['over'] }],
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
    const { summary } = await runWorkflow(sub, {
      logger: createLogger(),
      cwd: process.cwd(),
      // ★ 模板解析由**执行器统一**负责（run.ts 对每个节点的 params 走 resolveParams），
      //   这里拿到的 inputs 已经是解析后的值 —— 与其它节点同语义，**不要**在这里再解析一遍
      //   （第二遍会把"解析结果里恰好含 {{...}} 的字符串"当模板再解，与其它节点行为不一致）。
      inputs: (q.inputs ?? {}) as Record<string, JsonValue>,
      _depth: depth + 1,
      signal: ctx.signal,
    });
    // 收集子流程 end 节点输出作为本节点输出
    const endIds = sub.nodes.filter((n) => n.type === 'end').map((n) => n.id);
    const endOut = endIds.map((id) => summary.results[id]?.out).find((v) => v != null) ?? null;
    return finish(t0, startedAt, {
      out: { workflow: sub.name, status: summary.status, totalDurationMs: summary.totalDurationMs, output: endOut, failedCount: summary.failedCount },
      ...(summary.status !== 'success' ? { error: { code: 'SUBFLOW_FAILED', message: `子工作流 "${sub.name}" 以 ${summary.status} 状态结束` } } : {}),
    } as Partial<NodeResult>);
  },
  describe: () => ({ label: '子工作流', category: 'control' }),
};
