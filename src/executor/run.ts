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
import { normalizeDef } from './normalize.js';
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

/**
 * ★ 单节点运行日志（2026-10-04 用户需求：「参数传递是否正常、下个节点接收参数是否正常都没有日志，
 *   节点之间的交互情况也没有，工作流执行黑盒」）。
 *   phase='resolved'：模板**已展开**的入参 + 原始入参（带 {{}}）+ 引用了哪些上游；
 *   phase='done'：出参 / 错误 / 容错 / 耗时。两条通知由 api 层合并成一条日志。
 */
export interface NodeRunDetail {
  id: string;
  type: string;
  phase: 'resolved' | 'done';
  status?: 'running' | 'success' | 'failed' | 'skipped';
  /** 模板已展开的入参（节点真正收到的东西） */
  params?: Record<string, JsonValue>;
  /** 原始入参（保留 {{nodeId.out}} 引用，便于对照「引用 → 实际值」） */
  rawParams?: Record<string, JsonValue>;
  refs?: { nodeRefs: string[]; varsUsed: string[]; inputsUsed: string[] };
  out?: JsonValue;
  error?: { code: string; message: string; stack?: string };
  tolerated?: boolean;
  /** ★ 节点调试信息（2026-10-04）：AI 节点的 prompt／模型／token 用量／结束原因（**不进 out**） */
  debug?: JsonValue;
  durationMs?: number;
  startedAt?: string;
  endedAt?: string;
}

/** 提取 params 的引用关系（日志采集专用：失败也不影响主流程） */
function safeRefs(params: Record<string, JsonValue>): NodeRunDetail['refs'] {
  try { return extractRefs(params) as NodeRunDetail['refs']; } catch { return undefined; }
}

export interface RunOptions {
  logger: DshLogger;
  cwd: string;
  inputs?: Record<string, JsonValue>;
  onNodeDone?: (id: string, result: NodeResult) => void;
  /** ★ 运行日志通知（见 NodeRunDetail）：节点解析完入参、跑完各回调一次 */
  onNodeLog?: (detail: NodeRunDetail) => void;
  /** ★ 节点**开始**执行的通知（2026-10-03 用户需求「画布按运行路径依次显示状态，不要最后一次性显示」）：
   *  API 层据此把该节点标成「运行中」，画布轮询 /run/status 就能依次点亮节点。 */
  onNodeStart?: (id: string) => void;
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
  /** ★ 容错（2026-10-03）：失败但被 tolerate 开关放行的节点数——不计入 failedCount、不影响 status */
  toleratedCount?: number;
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

  // ★ 2026-10-04 起 **只有一套执行语义**（用户拍板「合并顺序模式，只保留一套 DAG 语义」）：
  //   轮 1 归一化（没有 edges 的定义先由 next 补出等价 edges）→ 轮 2/3 把 stop/continue/goto 搬进 DAG →
  //   轮 4 删除 legacy 递归执行器。这里不再有任何模式分派，一律走 runDag。
  //   映射表（next → edges）与唯一例外见 src/executor/normalize.ts 文件头；
  //   已删除的回退开关 DAG_FLOW_LEGACY_EXEC 不再被读取。
  const norm = normalizeDef(def);
  if (norm.added > 0) {
    opts.logger.info('workflow exec: normalized next → edges (dag)', { name: def.name, added: norm.added });
  }
  return runDag(norm.def, opts);
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
    // ★ 2026-10-08 用户拍板「引用即依赖」：被引用的节点必须是引用者的**上游（有连线路径）**。
    //   旧实现只比较拓扑序号，拦不住"更早/同层但没有连线"的引用（真机踩过：ai_final 引用了
    //   没连线的 ai_intl，只靠层序侥幸成立）。判据用可达性而非直接边：中间隔着节点也算有依赖。
    const ancCache = new Map<string, Set<string>>();
    const ancestorsOf = (id: string): Set<string> => {
      const hit = ancCache.get(id);
      if (hit) return hit;
      const seen = new Set<string>();
      const q = [...(inEdgesMap.get(id) ?? [])];
      while (q.length) {
        const cur = q.shift() as string;
        if (seen.has(cur)) continue;
        seen.add(cur);
        for (const p of inEdgesMap.get(cur) ?? []) if (!seen.has(p)) q.push(p);
      }
      ancCache.set(id, seen);
      return seen;
    };
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
        if (!ancestorsOf(node.id).has(ref)) {
          return dagFail('DATAFLOW_NO_EDGE',
            `节点 "${node.id}" 引用了 "${ref}" 的输出，但两者之间没有连线（"${ref}" 不是它的上游）——`
            + `执行先后顺序没有保证。请在画布上从 "${ref}" 拖一条线连到 "${node.id}"（中间隔着别的节点也可以，只要连通）。`);
        }
      }
    }
  }

  // 3. 分层执行（预算防护：最多 10 万节点执行）
  let successCount = 0, failedCount = 0, skippedCount = 0;
  let toleratedCount = 0;
  let firstError: RunSummary['error'] | undefined;
  const MAX_NODES = 100_000;
  let executed = 0;
  // 条件分支激活：被跳过（未激活分支）的节点集合
  const skipped = new Set<string>();

  // ★ 2026-10-04 轮 2（用户拍板）：失败策略进 DAG，语义 = **只停该节点的下游，其它分支继续**。
  //   为此把"跳过"从"逐源累加"改成**全局死边判定 + 传播**：
  //     · deadEdges 记「这次运行不走的边」：条件分支未命中的边 / 失败节点的全部出边 / 被跳过节点的全部出边
  //     · 一个节点只要有**任意一条活入边**就不跳过（旧实现逐源累加：目标被别的活边喂入时会被误跳过）
  //     · 节点被跳过 ⇒ 它的出边全部变死（传递性），否则孙节点会被错误执行
  //   失败策略（面板合并成一个下拉，底层仍是两个字段，零数据迁移）：
  //     ignore = node.tolerate === true       下游照常跑，不计失败（原「失败不影响流程」）
  //     skip   = node.onError === 'continue'  下游不走（出边死），不计失败（原「失败后继续执行下游」的意图版）
  //     stop   = 默认 / onError === 'stop'     下游不走（出边死），计入失败 + 记 firstError
  //     goto   = node.onError = {goto:'X'}   失败后跳到 X 继续（★ 轮 3 已实现：X 只执行一次，
  //                                          且只在 X 所在层**还没跑到**时生效；已执行/已过层则
  //                                          按 stop 处理，并把原因写进该节点的错误消息）
  const policyOf = (node: Node | undefined): 'stop' | 'skip' | 'ignore' | 'goto' => {
    if (node?.tolerate === true) return 'ignore';
    const oe = node?.onError;
    if (oe === 'continue') return 'skip';
    if (oe && typeof oe === 'object' && (oe as { goto?: string }).goto) return 'goto';
    return 'stop';
  };
  const edgeKey = (from: string, when: string | undefined, to: string): string => `${from}|${when ?? ''}|${to}`;

  // ★ 2026-10-04 轮 3：把"跳过"改成**每层从零重算**（不动点），而不是增量累加。
  //   原因：goto 要在失败后**复活**一个本来会被跳过的目标节点；若用增量（上一轮把目标记进 skipped
  //   并把它的出边标死），复活时就必须反向撤销级联，很容易留下残留。改成"hardDead 是唯一事实来源、
  //   skipped 每层重算"，goto 只需把目标放进 gotoTargets，级联自然重算干净。
  //   hardDead = 条件分支未命中的边 + 失败节点（策略非 ignore）的全部出边；
  //   skipped  = 入边全死（含"源被跳过"的传递）且未被 goto 指定、且尚未真正执行过的节点。
  const hardDead = new Set<string>();
  /** goto 指定的「本轮必须执行」目标（只对**尚未到达的层**生效，见下面的判定） */
  const gotoTargets = new Set<string>();
  const layerIndexOf = new Map<string, number>();
  topo.layers.forEach((ids, i) => ids.forEach((id) => layerIndexOf.set(id, i)));

  // ★ 2026-10-04 轮 5（性能）：跳过判定原本是"每层全量重算不动点"，链式/菱形图因此退化成
  //   O(层数 × 节点数)——实测 2000 节点链 772ms、2000 节点"失败链"5003ms（tmp-test/bench-executor.mjs）。
  //   两处优化，语义完全不变：
  //     ①**内容版本号** deadGen：hardDead / gotoTargets 只增不减，任一新增就 +1；deadGen 没变说明
  //       重算的输入没变 → 结果必然相同 → 整轮重算直接跳过（绝大多数层根本没有失败/分支，变成 O(1)）。
  //     ②**预计算入/出边键**：不再每轮对每个节点做 `outEdges.filter(...)` 分配，改成建一次表 + Set 查表。
  let deadGen = 0;
  const markDead = (k: string): void => { if (!hardDead.has(k)) { hardDead.add(k); deadGen++; } };
  const inKeys = new Map<string, string[]>();
  const outKeys = new Map<string, string[]>();
  for (const e of def.edges ?? []) {
    const k = edgeKey(e.from, e.when, e.to);
    const ik = inKeys.get(e.to);
    if (ik) ik.push(k); else inKeys.set(e.to, [k]);
    const ok2 = outKeys.get(e.from);
    if (ok2) ok2.push(k); else outKeys.set(e.from, [k]);
  }
  let lastGen = -1;

  const recomputeSkipped = (): void => {
    if (deadGen === lastGen) return;   // ★ 输入没变 → 上一轮的结果依然成立（性能关键路径）
    lastGen = deadGen;
    skipped.clear();
    const dead = new Set(hardDead);
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of def.nodes) {
        if (gotoTargets.has(node.id)) continue;              // goto 指定 → 永不跳过
        const ins = inKeys.get(node.id);
        if (!ins || ins.length === 0) continue;              // 无入边 = 入口节点，永不跳过
        let allDead = true;
        for (const k of ins) if (!dead.has(k)) { allDead = false; break; }
        if (!allDead) continue;
        const res = ctx.results[node.id];
        if (res && res.status !== 'skipped') continue;        // 真执行过 → 不算跳过
        if (!skipped.has(node.id)) { skipped.add(node.id); changed = true; }
        // 传递性：被跳过节点的出边也作废（否则孙节点会带着空输入照跑）
        for (const k of outKeys.get(node.id) ?? []) dead.add(k);
      }
    }
  };

  for (let layerIdx = 0; layerIdx < topo.layers.length; layerIdx++) {
    const layer = topo.layers[layerIdx]!;
    // ★ 每层开跑前从零重算"该跳过谁"（含 goto 复活的目标），保证级联与 hardDead 始终一致
    recomputeSkipped();
    // 层内节点并行（跳过未激活分支节点）
    const results = await Promise.all(layer.map(async (id) => {
      if (skipped.has(id)) {
        // 跳过节点也写入 results（merge/前端可观测 skipped 状态）
        const sr = { ...makeResult('skipped', { out: null }), durationMs: 0, startedAt, endedAt: startedAt } as NodeResult;
        ctx.results[id] = sr;
        // 跳过的节点也记一条日志（用户要知道"为什么没跑"）
        opts.onNodeLog?.({ id, type: nodeById.get(id)?.type ?? '', phase: 'done', status: 'skipped', out: null, durationMs: 0, startedAt, endedAt: startedAt });
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
      opts.onNodeStart?.(id);   // ★ 通知「本节点开始执行」（画布据此显示「运行中」）
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
            // 入参解析失败也要留下日志（否则"参数传递出错"在黑盒里看不到）
            opts.onNodeLog?.({
              id, type: node.type, phase: 'resolved', rawParams: node.params as Record<string, JsonValue>,
              refs: safeRefs((node.params ?? {}) as Record<string, JsonValue>),
            });
            opts.onNodeLog?.({ id, type: node.type, phase: 'done', status: 'failed', error: { code: 'DATAFLOW_REF', message: e.message } });
            return makeResult('failed', { error: { code: 'DATAFLOW_REF', message: e.message } });
          }
          throw e;
        }
        // ★ 日志①：模板展开后的实际入参 + 原始引用（节点之间的数据流）
        opts.onNodeLog?.({
          id, type: node.type, phase: 'resolved',
          params: resolved, rawParams: node.params as Record<string, JsonValue>,
          refs: safeRefs((node.params ?? {}) as Record<string, JsonValue>),
        });
        // merge 等节点需要自身 id 与上游列表（per-node ctx 视图）
        return defReg.run({ ...ctx, currentNodeId: id, upstreams: { ...ctx.upstreams, [id]: inEdgesMap.get(id) ?? [] } } as Context, resolved as never);
      });
      ctx.results[id] = r;
      // （日志②不在这里发：tolerated 要等下面的"失败策略记账"才定稿，见那个循环末尾）
      opts.onNodeDone?.(id, r);
      return { id, r, skip: false as const };
    }));

    // ① 本层的「边判定」：失败策略 + 条件分支（if 按真假 / switch 按 out.matched）→ 写入 hardDead
    for (const { id, r } of results) {
      const node = nodeById.get(id);
      const edges = outEdges.get(id);
      if (!node || !edges) continue;

      // —— 失败节点的出边：除「忽略失败」外一律作废 → 只停它的下游，其它分支继续 ——
      if (r.status === 'failed') {
        const policy = policyOf(node);
        if (policy !== 'ignore') {
          for (const e of edges) markDead(edgeKey(id, e.when, e.to));
        }
        // ★ 轮 3：onError:{goto:'X'} → 失败后跳到 X 继续（X 只执行一次）
        if (policy === 'goto') {
          const target = String((node.onError as { goto?: string })?.goto ?? '');
          const tLayer = layerIndexOf.get(target);
          if (tLayer !== undefined && tLayer > layerIdx) {
            // 目标还没跑到 → 指定它必跑（recomputeSkipped 里会豁免它，级联随之重算干净）
            gotoTargets.add(target);
            deadGen++;   // ★ 让"输入变了"的版本号感知到这次新增（否则下一层会跳过重算）
          } else if (target) {
            // 目标已经过去（已执行 / 已跳过 / 同层）→ 按"只执行一次"语义不重复执行，并**写明**原因，
            // 让悬浮卡与失败详情能看出"跳转没生效"，而不是静默当没配置过。
            const why = tLayer === undefined ? '目标不存在' : (ctx.results[target] ? '目标已执行过' : '目标已过层');
            if (r.error) r.error = { ...r.error, message: `${r.error.message ?? ''}（onError.goto 指向 "${target}"：${why}，未重复执行——目标只执行一次）` };
          }
        }
        continue;
      }

      const isIf = node.type === 'if';
      const isSwitch = node.type === 'switch';
      if (!isIf && !isSwitch) continue;
      if (r.status !== 'success') continue;   // 跳过的条件节点：出边已在 recomputeSkipped 里变死
      const outVal = (r.out as JsonValue & { matched?: string }) ?? null;
      const truthy = Boolean(outVal);
      const matched = String((outVal as JsonValue & { matched?: string })?.matched ?? '');
      const hasExact = edges.some((e) => e.when === matched);
      // ★ 判定规则（2026-10-04 轮 2 改为全局死边，修掉"逐源累加"的跨源误跳过）：
      //   只把**未命中的边**记成死边，目标是否跳过交给 recomputeSkipped 统一判定——
      //   于是「一个目标被另一条活边喂入时必须执行」（2026-10-03 修的同类问题）在跨源时也成立。
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
        if (!active) markDead(edgeKey(id, e.when, e.to));
      }
    }

    // ★ 解构必须带 id（2026-10-02 真机 500「id is not defined」根因：此循环此前只解构
    //   {r, skip}，firstError.nodeId 引用的 id 不在作用域 → 任何 DAG 节点失败即 ReferenceError）
    for (const { id, r, skip } of results) {
      if (skip) { skippedCount++; continue; }
      if (r.status === 'success') successCount++;
      else if (r.status === 'failed') {
        // ★ 容错/跳过支路（2026-10-04 轮 2 起统一由 policyOf 判定）：
        //   策略为「忽略失败(ignore)」或「跳过这条支路(skip)」→ 不计入 failedCount、不写 firstError，
        //   节点自身仍保留 failed + tolerated=true（界面标「⚠ 已容错」+ 悬浮看错误详情）。
        //   取消（RUN_CANCELLED）永远不算容错。
        const policy = policyOf(nodeById.get(id));
        if (r.error?.code !== 'RUN_CANCELLED' && (policy === 'ignore' || policy === 'skip')) {
          r.tolerated = true;
          toleratedCount++;
        } else {
          failedCount++;
          // ★ 补 nodeId：失败弹窗的「失败原因：显示名_id」需要定位到节点
          if (!firstError) firstError = { code: r.error?.code ?? 'NODE_FAILED', message: r.error?.message ?? 'node failed', nodeId: id };
        }
      }
      else skippedCount++;
      // ★ 日志②（出参 / 错误 / 容错 / 耗时）在**状态定稿之后**发：tolerated 是上面按失败策略标出来的，
      //   早发会导致日志里少了「已容错」（2026-10-04 由 test/run-log 的 D3 断言抓到）
      opts.onNodeLog?.({
        id, type: nodeById.get(id)?.type ?? '', phase: 'done',
        status: r.status, out: r.out as JsonValue, error: r.error as NodeRunDetail['error'],
        tolerated: r.tolerated, debug: r.debug, durationMs: r.durationMs, startedAt: r.startedAt, endedAt: r.endedAt,
      });
    }

    // ③ 取消：立刻停止后续层（取消与失败策略无关，永远中断）
    //    ★ 2026-10-04 轮 2：这里**不再**因 failedCount>0 而 break ——
    //    失败只停该节点的下游（hardDead），其它分支照常跑完；整轮是否算失败仍由 failedCount 决定。
    //    （轮 3：跳过判定改为**每层开跑前** recomputeSkipped() 从零重算，故此处无需再传播。）
    if (opts.signal?.aborted) break;
  }

  const endedAt = new Date().toISOString();
  const summary: RunSummary = {
    runId, workflowName: def.name,
    status: failedCount === 0 ? 'success' : 'failed',
    totalNodes: def.nodes.length, successCount, failedCount, skippedCount,
    ...(toleratedCount ? { toleratedCount } : {}),
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
