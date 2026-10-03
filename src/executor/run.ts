// @ts-nocheck
// src/executor/run.ts — 工作流执行核心
// 调度：start → 推进（next string / array parallel / {true,false} / loop 内部 next 推进 / 终止）

import type { Context, Node, NodeResult, WorkflowDef, JsonValue } from '../types.js';
import { parseAndValidate, nodeTag } from './parse.js';
import { WorkflowNodeRegistry } from '../registry/external.js';
import { makeResult, safeNodeRun } from '../registry/external.js';
import { checkWorkflowParams, formatParamProblems } from '../registry/params-check.js';
import type { DshLogger } from '../adapter/logger.js';
import { writeRunRecord } from './record.js';
import { topoSort } from './topo.js';
import { newRunId } from './awaiting.js';
import { resolveParams, extractRefs, DataflowError } from './dataflow.js';

/** 参数预检失败：一次性返回全部节点的必填缺失明细（防"生成的 DAG 跑到一半才失败"） */
function invalidParamsSummary(def: WorkflowDef, problems: string[]): { summary: RunSummary; record: RunSummary } {
  const startedAt = new Date().toISOString();
  const summary: RunSummary = {
    runId: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    workflowName: def.name,
    status: 'failed',
    totalNodes: def.nodes.length,
    successCount: 0,
    failedCount: 1,
    skippedCount: 0,
    totalDurationMs: 0,
    startedAt,
    endedAt: startedAt,
    results: {},
    error: { code: 'NODE_PARAMS_INVALID', message: problems },
  };
  return { summary, record: summary };
}

export interface RunOptions {
  logger: DshLogger;
  cwd: string;
  inputs?: Record<string, JsonValue>;
  onNodeDone?: (id: string, result: NodeResult) => void;
  /** 取消信号（run API 取消） */
  signal?: AbortSignal;
  /** 子工作流嵌套深度（subflow 节点内部递增） */
  _depth?: number;
  /** 运行 id（缺省自生成）。★ API 层必须在运行结束前拿到它——awaiting 响应要带上 */
  runId?: string;
  /** 交互式运行：只由 HTTP POST /run 传 true。
   *  manual 节点据此决定「挂起等人确认」还是「无人可点 → 自动通过 + warning」（2026-10-03 用户拍板） */
  interactive?: boolean;
  /** manual 节点挂起时的通知（API 层转成 awaiting 响应） */
  onAwaiting?: (info: { runId: string; nodeId: string; prompt: string }) => void;
}

export interface RunSummary {
  runId: string;
  workflowName: string;
  status: 'success' | 'failed';
  totalNodes: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  totalDurationMs: number;
  startedAt: string;
  endedAt: string;
  results: Record<string, NodeResult>;
  error?: { code: string; message: string; nodeId?: string };
}

export async function runWorkflow(defInput: unknown, opts: RunOptions): Promise<{ summary: RunSummary; record: RunSummary }> {
  const def = parseAndValidate(defInput);

  // 参数必填预检：任何节点缺必填参数 → 一次性失败并列出全部明细（不进入执行）
  const paramProblems = checkWorkflowParams(def);
  if (paramProblems.length > 0) {
    return invalidParamsSummary(def, formatParamProblems(paramProblems, (id) => nodeTag(def.nodes.find((n) => n.id === id), id)));
  }

  // DAG 模式：若显式提供 edges（DAG 唯一连接表示），走拓扑分层并行执行器
  if (def.edges && def.edges.length > 0) {
    return runDag(def, opts);
  }
  // 否则回退旧递归模式（node.next 推导）

  const runId = opts.runId ?? newRunId();
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const ctx: Context = {
    inputs: { ...(def.inputs ?? {}), ...(opts.inputs ?? {}) },
    vars: {},
    results: {},
    _depth: opts._depth ?? 0,
    signal: opts.signal,
    runId,
    interactive: opts.interactive === true,
    onAwaiting: opts.onAwaiting,
    logger: opts.logger,
  };

  const start = def.nodes.find((n) => n.type === 'start')!;

  // 上游索引（merge 节点收集上游输出用）：优先 edges，其次 next 反推
  const upstreamMap = new Map<string, string[]>();
  if (def.edges?.length) {
    for (const e of def.edges) {
      const list = upstreamMap.get(e.to) ?? [];
      list.push(e.from);
      upstreamMap.set(e.to, list);
    }
  } else {
    for (const n of def.nodes) {
      const refs = Array.isArray(n.next) ? n.next
        : typeof n.next === 'string' ? [n.next]
        : n.next ? Object.values(n.next) : [];
      for (const to of refs) {
        if (!to) continue;
        const list = upstreamMap.get(to) ?? [];
        list.push(n.id);
        upstreamMap.set(to, list);
      }
    }
  }
  const withUpstreams = (nodeId: string): Context => ({
    ...ctx,
    currentNodeId: nodeId,
    upstreams: { ...ctx.upstreams, [nodeId]: upstreamMap.get(nodeId) ?? [] },
  });

  let successCount = 0, failedCount = 0, skippedCount = 0;
  let firstError: RunSummary['error'] | undefined;

  // 记录哪些节点"被合流/被跳过的"
  const scheduled = new Set<string>();

  const cancelled = (): NodeResult => ({ ...makeResult('failed', { error: { code: 'RUN_CANCELLED', message: '运行已由用户取消' } }), durationMs: 0, startedAt: new Date().toISOString(), endedAt: new Date().toISOString() });

  async function executeNode(node: Node): Promise<NodeResult> {
    if (scheduled.has(node.id)) {
      // 已执行（并行合流场景）→ 直接返回
      return ctx.results[node.id]!;
    }
    scheduled.add(node.id);
    if (opts.signal?.aborted) {
      const r = cancelled();
      ctx.results[node.id] = r;
      return r;
    }

    const defReg = WorkflowNodeRegistry.get(node.type);
    if (!defReg) {
      const r: NodeResult = { ...makeResult('failed', { error: { code: 'UNKNOWN_NODE_TYPE', message: `节点类型 "${node.type}" 未注册（提供该节点的插件是否已安装？）` } }), durationMs: 0, startedAt: new Date().toISOString(), endedAt: new Date().toISOString() };
      ctx.results[node.id] = r;
      failedCount++;
      opts.onNodeDone?.(node.id, r);
      return r;
    }

    const r = await safeNodeRun(async () => {
      // 数据传递：解析 params 中的 {{nodeId.out}} 模板引用为上游实际输出
      let resolved: Record<string, JsonValue> = node.params ?? {};
      try {
        // ★ loop 的 body.inputs 必须延迟到每轮迭代时再解析（里面会引用 {{vars.loopItem}}/{{vars.loopIndex}}，
        //   运行前解析必然 DATAFLOW_REF）——这里把 body 原样透传，由 runLoop 自己逐轮 resolveParams。
        const { body: rawBody, ...restParams } = (node.params ?? {}) as Record<string, JsonValue> & { body?: JsonValue };
        resolved = node.type === 'loop' && rawBody !== undefined
          ? ({ ...resolveParams(restParams, ctx, node.id), body: rawBody } as Record<string, JsonValue>)
          : resolveParams(node.params ?? {}, ctx, node.id);
      } catch (e) {
        if (e instanceof DataflowError) {
          return makeResult('failed', { error: { code: 'DATAFLOW_REF', message: e.message } });
        }
        throw e;
      }
      // merge 等节点需要知道自身 id 与上游列表（per-node ctx 视图，避免并发互踩）
      return defReg.run(withUpstreams(node.id), resolved as never);
    });
    ctx.results[node.id] = r;
    if (r.status === 'success') successCount++;
    else if (r.status === 'failed') failedCount++;
    else skippedCount++;
    opts.onNodeDone?.(node.id, r);
    return r;
  }

  async function advance(fromNode: Node, fromResult: NodeResult): Promise<void> {
    // 终止
    if (fromNode.type === 'end') return;
    if (fromResult.status === 'failed') {
      // onError 处理
      if (fromNode.onError === 'continue') {
        // 跳过 next 推进（认为该节点已"消费"）
        return;
      } else if (fromNode.onError && typeof fromNode.onError === 'object' && fromNode.onError.goto) {
        const next = def.nodes.find((n) => n.id === fromNode.onError!.goto);
        if (!next) throw new Error(`onError 跳转目标不存在：${fromNode.onError.goto}`);
        const r2 = await executeNode(next);
        return advance(next, r2);
      } else {
        // 默认 stop：不推进，记 firstError
        if (!firstError) firstError = { code: fromResult.error?.code ?? 'NODE_FAILED', message: fromResult.error?.message ?? 'node failed', nodeId: fromNode.id };
        return;
      }
    }

    const next = fromNode.next;
    if (next === undefined || next === null) return;
    if (typeof next === 'string') {
      const n = def.nodes.find((x) => x.id === next);
      if (!n) throw new Error(`连线断裂：${fromNode.id} → ${next}（目标节点不存在）`);
      const r = await executeNode(n);
      return advance(n, r);
    }
    if (Array.isArray(next)) {
      const ps = next.map((id) => def.nodes.find((x) => x.id === id)).filter(Boolean) as Node[];
      const rs = await Promise.all(ps.map((n) => executeNode(n)));
      // 任意失败 → 不继续推进（除非 onError）
      const anyFailed = rs.some((r) => r.status === 'failed');
      if (anyFailed) {
        if (!firstError) firstError = { code: 'PARALLEL_FAILED', message: '一个或多个并行分支失败', nodeId: fromNode.id };
        return;
      }
      // 并行合流后不主动推进（业务应在每个分支末端推到合流节点）
    }
    if (typeof next === 'object' && !Array.isArray(next)) {
      // {true,false}（if）或泛化 case 映射（switch：按 out.matched 选分支，'*' 兜底）
      let branch: string | undefined;
      if ('true' in next || 'false' in next) {
        const cond = ctx.results[fromNode.id]?.out;
        branch = cond ? (next as { true: string; false: string }).true : (next as { true: string; false: string }).false;
      } else {
        const matched = String((ctx.results[fromNode.id]?.out as JsonValue & { matched?: string })?.matched ?? '');
        branch = (next as Record<string, string>)[matched] ?? (next as Record<string, string>)['*'];
      }
      if (!branch) throw new Error(`连线断裂：${fromNode.id} 没有匹配的分支（${JSON.stringify(next)}）`);
      const n = def.nodes.find((x) => x.id === branch);
      if (!n) throw new Error(`连线断裂：${fromNode.id} → ${branch}（目标节点不存在）`);
      const r = await executeNode(n);
      return advance(n, r);
    }
  }

  // 启动
  const startR = await executeNode(start);
  await advance(start, startR);

  // 串行合流：从 start 推进的链上所有 end 节点（若 next 没指向 end 可能漏；
  // 简化：扫描所有 end 节点若未执行则执行）
  for (const endNode of def.nodes.filter((n) => n.type === 'end')) {
    if (!scheduled.has(endNode.id)) {
      const r = await executeNode(endNode);
      if (r.status === 'success') successCount++;
      else if (r.status === 'failed') failedCount++;
    }
  }

  const endedAt = new Date().toISOString();
  const summary: RunSummary = {
    runId,
    workflowName: def.name,
    status: failedCount === 0 ? 'success' : 'failed',
    totalNodes: def.nodes.length,
    successCount,
    failedCount,
    skippedCount,
    totalDurationMs: Date.now() - t0,
    startedAt,
    endedAt,
    results: ctx.results,
    ...(firstError ? { error: firstError } : {}),
  };
  opts.logger.info('workflow done', { runId, name: def.name, status: summary.status, totalMs: summary.totalDurationMs });
  // 落盘运行记录（SQLite/JSON，不阻塞主流程）
  try { await writeRunRecord(summary); } catch (e) { opts.logger.warn('run record write failed', { error: (e as Error).message }); }
  return { summary, record: summary };
}

/**
 * DAG 模式执行器：拓扑分层并行。
 * 前置：def.edges 存在（DAG 唯一连接表示）。
 * 语义：topoSort 判环（有环拒绝）→ 按层 Promise.all 并行 →
 *      条件分支（if/switch）只激活匹配边 → 预算防护（maxNodes）→ 落盘。
 */
async function runDag(def: WorkflowDef, opts: RunOptions): Promise<{ summary: RunSummary; record: RunSummary }> {
  const runId = opts.runId ?? newRunId();
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const ctx: Context = {
    inputs: { ...(def.inputs ?? {}), ...(opts.inputs ?? {}) },
    vars: {},
    results: {},
    signal: opts.signal,
    runId,
    interactive: opts.interactive === true,
    onAwaiting: opts.onAwaiting,
    logger: opts.logger,
  };
  const nodeById = new Map(def.nodes.map((n) => [n.id, n]));

  // 统一失败返回（DAG 预检/执行失败）
  const dagFail = (code: string, message: string): { summary: RunSummary; record: RunSummary } => {
    const summary: RunSummary = {
      runId, workflowName: def.name, status: 'failed',
      totalNodes: def.nodes.length, successCount: 0, failedCount: 1, skippedCount: 0,
      totalDurationMs: Date.now() - t0, startedAt, endedAt: startedAt, results: {},
      error: { code, message },
    };
    return { summary, record: summary };
  };

  // 1. 拓扑排序 + 环路检测
  const topo = topoSort(def);
  if (!topo.ok) {
    return dagFail('DAG_CYCLE', `工作流存在环路: ${topo.cyclePath?.join(' → ') ?? 'cycle'}`);
  }

  // 2. 建边索引：source → [{to, when?}]（用于条件分支激活）+ 反向（merge 收集上游）
  const outEdges = new Map<string, { to: string; when?: string }[]>();
  const inEdgesMap = new Map<string, string[]>();
  for (const e of def.edges ?? []) {
    const list = outEdges.get(e.from) ?? [];
    list.push({ to: e.to, when: e.when });
    outEdges.set(e.from, list);
    const inList = inEdgesMap.get(e.to) ?? [];
    inList.push(e.from);
    inEdgesMap.set(e.to, inList);
  }

  // 2.5 数据依赖预检：每个节点的模板引用必须指向存在的上游节点（拓扑序在其前）
  {
    const orderIdx = new Map(topo.order.map((id, i) => [id, i]));
    for (const node of def.nodes) {
      const { nodeRefs } = extractRefs(node.params ?? {});
      for (const ref of nodeRefs) {
        if (ref === node.id) {
          return dagFail('DATAFLOW_SELF_REF', `节点 "${node.id}" 引用了自己（{{${ref}.out}}）`);
        }
        if (!nodeById.has(ref)) {
          return dagFail('DATAFLOW_UNKNOWN', `节点 "${node.id}" 引用了不存在的节点 "${ref}"`);
        }
        const refIdx = orderIdx.get(ref) ?? -1;
        const curIdx = orderIdx.get(node.id) ?? -1;
        if (refIdx > curIdx) {
          return dagFail('DATAFLOW_ORDER', `节点 "${node.id}" 引用了排在它之后才执行的 "${ref}"（数据流倒挂）`);
        }
      }
    }
  }

  // 3. 分层执行（预算防护：最多 10 万节点执行）
  let successCount = 0, failedCount = 0, skippedCount = 0;
  let firstError: RunSummary['error'] | undefined;
  const MAX_NODES = 100_000;
  let executed = 0;
  // 条件分支激活：被跳过（未激活分支）的节点集合
  const skipped = new Set<string>();

  for (const layer of topo.layers) {
    // 层内节点并行（跳过未激活分支节点）
    const results = await Promise.all(layer.map(async (id) => {
      if (skipped.has(id)) {
        // 跳过节点也写入 results（merge/前端可观测 skipped 状态）
        const sr = { ...makeResult('skipped', { out: null }), durationMs: 0, startedAt, endedAt: startedAt } as NodeResult;
        ctx.results[id] = sr;
        return { id, r: sr, skip: true as const };
      }
      if (opts.signal?.aborted) {
        return { id, r: { ...makeResult('failed', { error: { code: 'RUN_CANCELLED', message: '运行已由用户取消' } }), durationMs: 0, startedAt, endedAt: startedAt } as NodeResult, skip: false as const };
      }
      if (executed >= MAX_NODES) {
        return { id, r: { ...makeResult('failed', { error: { code: 'BUDGET_EXCEEDED', message: '节点执行数超出预算（100000）——检查是否存在失控循环' } }), durationMs: 0, startedAt, endedAt: startedAt } as NodeResult, skip: false as const };
      }
      executed++;
      const node = nodeById.get(id);
      if (!node) return { id, r: null as unknown as NodeResult, skip: false as const };
      const defReg = WorkflowNodeRegistry.get(node.type);
      if (!defReg) {
        return { id, r: { ...makeResult('failed', { error: { code: 'UNKNOWN_NODE_TYPE', message: `节点类型 "${node.type}" 未注册（提供该节点的插件是否已安装？）` } }), durationMs: 0, startedAt, endedAt: startedAt } as NodeResult, skip: false as const };
      }
      const r = await safeNodeRun(async () => {
        // 数据传递：解析 params 中的 {{nodeId.out}} 模板引用
        let resolved: Record<string, JsonValue> = node.params ?? {};
        try {
          // ★ 同 legacy 路径：loop 的 body 延迟到每轮迭代解析（见上）
          const { body: rawBody, ...restParams } = (node.params ?? {}) as Record<string, JsonValue> & { body?: JsonValue };
          resolved = node.type === 'loop' && rawBody !== undefined
            ? ({ ...resolveParams(restParams, ctx, id), body: rawBody } as Record<string, JsonValue>)
            : resolveParams(node.params ?? {}, ctx, id);
        } catch (e) {
          if (e instanceof DataflowError) {
            return makeResult('failed', { error: { code: 'DATAFLOW_REF', message: e.message } });
          }
          throw e;
        }
        // merge 等节点需要自身 id 与上游列表（per-node ctx 视图）
        return defReg.run({ ...ctx, currentNodeId: id, upstreams: { ...ctx.upstreams, [id]: inEdgesMap.get(id) ?? [] } } as Context, resolved as never);
      });
      ctx.results[id] = r;
      opts.onNodeDone?.(id, r);
      return { id, r, skip: false as const };
    }));

    // 条件分支激活：if 按真假；switch 按 out.matched 匹配 when（'*' 兜底）
    for (const { id, r } of results) {
      const node = nodeById.get(id);
      const edges = outEdges.get(id);
      if (!node || !edges) continue;
      const isIf = node.type === 'if';
      const isSwitch = node.type === 'switch';
      if (!isIf && !isSwitch) continue;
      if (r.status !== 'success') {
        // 失败/跳过的条件节点：激活所有出边由全局 stop 语义接管（默认失败即终止后续层）
        continue;
      }
      const outVal = (r.out as JsonValue & { matched?: string }) ?? null;
      const truthy = Boolean(outVal);
      const matched = String((outVal as JsonValue & { matched?: string })?.matched ?? '');
      const hasExact = edges.some((e) => e.when === matched);
      // ★ 一个目标只要**有任意一条**激活入边就不该被跳过（2026-10-03 修）：
      //   旧实现逐条未激活边就 `skipped.add(e.to)`，于是 switch 的多个 case 指向同一节点时
      //   （如 quick→log_mode 且 image→log_mode）——激活的那条 + 未激活的另一条 → 目标被错误跳过。
      //   演示工作流补 image case 后 log_mode 被跳过即此因。现在先收集「激活目标」再决定跳过。
      const activated = new Set<string>();
      const deactivated: string[] = [];
      for (const e of edges) {
        let active = true;
        if (isIf) {
          active = e.when === 'true' ? truthy : e.when === 'false' ? !truthy : true;
        } else if (isSwitch) {
          // 匹配 case 边激活；无匹配 case 时 '*' 兜底边激活；其余跳过
          if (e.when === matched) active = true;
          else if (e.when === '*') active = !hasExact;
          else active = false;
        }
        if (active) activated.add(String(e.to)); else deactivated.push(String(e.to));
      }
      for (const t of deactivated) if (!activated.has(t)) skipped.add(t);
    }

    // ★ 解构必须带 id（2026-10-02 真机 500「id is not defined」根因：此循环此前只解构
    //   {r, skip}，firstError.nodeId 引用的 id 不在作用域 → 任何 DAG 节点失败即 ReferenceError）
    for (const { id, r, skip } of results) {
      if (skip) { skippedCount++; continue; }
      if (r.status === 'success') successCount++;
      else if (r.status === 'failed') {
        failedCount++;
        // ★ 补 nodeId：失败弹窗的「失败原因：显示名_id」需要定位到节点
        if (!firstError) firstError = { code: r.error?.code ?? 'NODE_FAILED', message: r.error?.message ?? 'node failed', nodeId: id };
      }
      else skippedCount++;
    }

    // 失败即终止后续层（默认 stop 语义）
    if (failedCount > 0) break;
  }

  const endedAt = new Date().toISOString();
  const summary: RunSummary = {
    runId, workflowName: def.name,
    status: failedCount === 0 ? 'success' : 'failed',
    totalNodes: def.nodes.length, successCount, failedCount, skippedCount,
    totalDurationMs: Date.now() - t0, startedAt, endedAt, results: ctx.results,
    ...(firstError ? { error: firstError } : {}),
  };
  opts.logger.info('workflow done (dag)', { runId, name: def.name, status: summary.status, totalMs: summary.totalDurationMs });
  try { await writeRunRecord(summary); } catch (e) { opts.logger.warn('run record write failed', { error: (e as Error).message }); }
  return { summary, record: summary };
}

export function createExecutor(): { run: typeof runWorkflow } {
  return { run: runWorkflow };
}
