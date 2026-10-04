// src/executor/selfcheck.ts
// 工作流自检（2026-10-04 用户拍板：**分多轮**实现；运行前自动检查；发现问题要给出**报错提示 + 解决办法**，
//   并拦下让用户做人工确认；不做报告导出）。
//
// 设计约束（沿用本项目既有教训）：
//   ① **唯一真源**：判据只写在这里，宿主 `/run`、CLI、客户端面板都调它——历史上判据分散（schema 三处副本、
//      两套跳过判定）每次都导致口径不一致。
//   ② **纯函数**：不读文件系统、不碰网络；需要外部信息的检查（subflow 依赖是否存在、模型是否在列表）
//      由调用方通过 `deps` 注入，保持可离线单测。
//   ③ **加法优先**：不改变既有的执行期行为；本模块只"报告 + 建议"，拦不拦由调用方决定。
//
// 轮次规划（每轮只加一类检查）：
//   轮 1（本文件当前实现）：结构/引用、模板引用前缀、可达性、环
//   轮 2：参数必填、分支键缺失、switch cases↔出边一致、goto 回跳
//   轮 3：loop 边界/循环体、merge 上游、subflow 依赖存在、存值模型是否还在列表
//   轮 4：建议类（不拦）
import type { JsonValue, WorkflowDef } from '../types.js';
import { parseAndValidate, nodeTag } from './parse.js';
import { extractRefs } from './dataflow.js';
import { normalizeDef } from './normalize.js';
import { topoSort } from './topo.js';
import { checkWorkflowParams } from '../registry/params-check.js';

export type SelfcheckLevel = 'error' | 'warn';

export interface SelfcheckItem {
  level: SelfcheckLevel;
  /** 稳定错误码（测试与前端分组用；不随文案变化） */
  code: string;
  /** 定位到的节点（客户端据此选中/滚动；结构类错误可能没有） */
  nodeId?: string;
  /** 哪里不对（说清现象） */
  message: string;
  /** 怎么改（用户明确要求：给出解决办法） */
  fix: string;
}

export interface SelfcheckResult {
  /** 无 error 即通过（warn 不拦运行） */
  ok: boolean;
  items: SelfcheckItem[];
  errorCount: number;
  warnCount: number;
  stats: { nodes: number; edges: number };
}

/** 模板引用里不是"节点输出"的保留前缀（{{inputs.x}} / {{vars.x}} / {{env.x}}） */
const RESERVED_REF_PREFIX = new Set(['inputs', 'vars', 'env', 'loopItem', 'loopIndex']);

export interface SelfcheckDeps {
  /** 节点显示名（默认用 parse 的 nodeTag：显示名_id(类型)） */
  labelOf?: (id: string) => string;
  /** 工作区现有工作流名（轮 3：subflow 依赖 / loop 循环体是否存在；不传则跳过这项检查） */
  knownWorkflows?: Set<string>;
  /** 存值模型能否解析（轮 3：路由侧用**引擎同一个** resolveLlmEndpoint 预解析；不传则跳过） */
  modelResolves?: (model: string) => boolean;
  /** 本工作流是否有定时任务（轮 4：有定时任务 + 含 manual 节点 → 提醒"定时触发不会停下来等确认"） */
  hasSchedule?: boolean;
}

/**
 * 跑一遍自检。**永不抛异常**（自身出错也转成一条 error 项），保证调用方不会因为自检本身崩掉运行路径。
 */
export function selfcheck(defInput: unknown, deps: SelfcheckDeps = {}): SelfcheckResult {
  const items: SelfcheckItem[] = [];
  const push = (it: SelfcheckItem): void => { items.push(it); };
  const finish = (nodes: number, edges: number): SelfcheckResult => {
    // 展示顺序：**error 在前、warn 在后**（弹窗先给"会拦住运行"的，客户端「去修改」也先跳到它）
    const rank = (l: SelfcheckLevel): number => (l === 'error' ? 0 : 1);
    const sorted = items.map((it, i) => ({ it, i })).sort((a, b) => (rank(a.it.level) - rank(b.it.level)) || (a.i - b.i)).map((x) => x.it);
    const errorCount = sorted.filter((i) => i.level === 'error').length;
    const warnCount = sorted.length - errorCount;
    return { ok: errorCount === 0, items: sorted, errorCount, warnCount, stats: { nodes, edges } };
  };

  // ---------- 轮 1 ①：结构与引用（复用 parseAndValidate；它抛错，这里转成分级项）----------
  let def: WorkflowDef;
  try {
    def = parseAndValidate(defInput);
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    push({
      level: 'error',
      code: 'STRUCT_INVALID',
      message: msg,
      fix: '按提示修正工作流结构：常见原因是节点 id 重复/缺失、start 或 end 数量不对、next 或 onError.goto 指向了不存在的节点。'
        + '可以在画布右侧「JSON」视图对照检查（连线会同时写 next 与 edges，两者要保持一致）。',
    });
    // 结构都不合法时，后续检查没有可靠依据 → 直接返回
    const raw = defInput as { nodes?: unknown[]; edges?: unknown[] };
    return finish(Array.isArray(raw?.nodes) ? raw.nodes.length : 0, Array.isArray(raw?.edges) ? raw.edges.length : 0);
  }

  const labelOf = deps.labelOf ?? ((id: string) => nodeTag(def.nodes.find((n) => n.id === id), id));
  const ids = new Set(def.nodes.map((n) => n.id));
  // ★ 图级检查一律用**归一化后**的边（next-only 的 def 也有边）：与引擎同一套判据。
  //   2026-10-04 修：轮 1 的可达性只看 def.edges，导致只写 next 的合法工作流被误报「不可达」。
  const normalized = normalizeDef(def);
  const edgesN = normalized.def.edges ?? [];
  const nodes = def.nodes.length;
  const edges = edgesN.length;

  try {
    // ---------- 轮 1 ②：模板引用前缀必须指向真实存在的节点 ----------
    for (const node of def.nodes) {
      const { nodeRefs } = extractRefs((node.params ?? {}) as Record<string, JsonValue>);
      for (const ref of nodeRefs) {
        if (RESERVED_REF_PREFIX.has(ref)) continue;          // {{inputs.*}} / {{vars.*}} 等不是节点引用
        if (ids.has(ref)) continue;
        push({
          level: 'error',
          code: 'REF_UNKNOWN',
          nodeId: node.id,
          message: `节点「${labelOf(node.id)}」的参数里引用了不存在的节点 "${ref}"（{{${ref}.out…}}）`,
          fix: `把引用改成实际存在的上游节点：在画布上选中该节点，右侧面板「🔗 上游变量」里点一下就复制到正确引用；`
            + `或者把缺少的 "${ref}" 节点补上。`,
        });
      }
    }

    // ---------- 轮 1 ③：从 start 不可达（运行时会当独立入口直接执行）----------
    const starts = def.nodes.filter((n) => n.type === 'start');
    if (starts.length === 1) {
      const adj = new Map<string, string[]>();
      for (const e of edgesN) {
        const l = adj.get(e.from);
        if (l) l.push(e.to); else adj.set(e.from, [e.to]);
      }
      const seen = new Set<string>([starts[0].id]);
      const q = [starts[0].id];
      while (q.length) {
        const cur = q.shift() as string;
        for (const to of adj.get(cur) ?? []) if (!seen.has(to)) { seen.add(to); q.push(to); }
      }
      for (const n of def.nodes) {
        if (seen.has(n.id) || n.type === 'start') continue;
        push({
          level: 'warn',
          code: 'UNREACHABLE',
          nodeId: n.id,
          message: `节点「${labelOf(n.id)}」从 start 不可达——运行时它会被当作「独立入口」直接执行（不是"跳过"）`,
          fix: '把它接进主流程；如果它只是草稿/临时节点，就删掉它，避免每次运行都白跑一次。',
        });
      }
    }

    // ---------- 轮 1 ④：环路（用归一化后的 edges，和引擎同一套判据）----------
    const topo = topoSort(normalized.def);
    if (!topo.ok) {
      const path = (topo.cyclePath ?? []).join(' → ');
      push({
        level: 'error',
        code: 'CYCLE',
        message: `工作流存在环路：${path || '（无法定位具体路径）'}`,
        fix: '断开环上的那条回边。要"失败后重试/循环执行"请用 loop 节点的「循环体=子工作流」，不要靠回边，'
          + '引擎不执行回边（会直接拒绝）。',
      });
    }

    // ================= 轮 2：参数必填 / 分支键 / switch 一致性 / goto 回跳 =================
    const nodeOf = (id: string) => def.nodes.find((n) => n.id === id);

    // ---------- 轮 2 ①：节点必填参数（与执行期同一个检查器，跑起来才会发现的错误提前暴露）----------
    for (const p of checkWorkflowParams({ nodes: def.nodes as never })) {
      push({
        level: 'error',
        code: 'PARAM_REQUIRED',
        nodeId: p.nodeId,
        message: `节点「${labelOf(p.nodeId)}」缺少必填参数：${p.msg}`,
        fix: '在画布上选中该节点，在右侧面板补齐这个参数；Python/Bash 节点可以直接在面板里写代码，'
          + '或指定代码文件（二选一）。',
      });
    }

    // ---------- 轮 2 ②：if/switch 的出边必须有分支键（没键 = 恒激活，所有分支都会跑，属静默错误）----------
    for (const e of edgesN) {
      const from = nodeOf(e.from);
      if (!from || (from.type !== 'if' && from.type !== 'switch')) continue;
      if (e.when === undefined || e.when === null || e.when === '') {
        push({
          level: 'error',
          code: 'BRANCH_KEY_MISSING',
          nodeId: e.from,
          message: `节点「${labelOf(e.from)}」→「${labelOf(e.to)}」这条线没有分支键——执行器会把它当"恒激活"，`
            + '于是所有分支都会跑一遍',
          fix: '在这条线的中点上点一下标签，选一个分支键（if 是 真/假，switch 是它的 case）；'
            + '确实想让这条线无条件执行，就把它接到 switch 的兜底分支「其他」上。',
        });
      }
    }

    // ---------- 轮 2 ③：switch 的 cases ↔ 出边一致性 ----------
    for (const n of def.nodes) {
      if (n.type !== 'switch') continue;
      const cases = Object.keys((n.params?.cases as Record<string, unknown>) ?? {});
      const outs = edgesN.filter((e) => e.from === n.id);
      const outKeys = new Set(outs.map((e) => String(e.when ?? '')).filter((k) => k !== ''));
      for (const c of cases) {
        if (!outKeys.has(c)) {
          push({
            level: 'warn',
            code: 'SWITCH_CASE_NO_EDGE',
            nodeId: n.id,
            message: `节点「${labelOf(n.id)}」的分支设置里有 case "${c}"，但没有对应的出边——当 value 取值 "${c}" 时不会走任何分支`,
            fix: `从该节点拉一条线到目标节点，然后在线上把分支键选成 "${c}"；如果这个 case 已经不需要了，就在右侧面板删掉它。`,
          });
        }
      }
      for (const k of outKeys) {
        if (!cases.includes(k)) {
          push({
            level: 'warn',
            code: 'SWITCH_EDGE_NOT_IN_CASES',
            nodeId: n.id,
            message: `节点「${labelOf(n.id)}」有分支键 "${k}" 的出边，但分支设置里没有这个 case（画布端口可能挂不上、面板里也看不到它）`,
            fix: `在右侧面板「🔀 分支设置」里补一条 "${k}" → 目标节点，或把这条线的分支键改成已有的 case。`,
          });
        }
      }
    }

    // ---------- 轮 2 ④：goto 目标必须在本节点"还没跑到"的层（否则永远不生效）----------
    const layers = topo.ok ? (topo.layers ?? []) : [];
    const layerOf = (id: string): number => {
      for (let i = 0; i < layers.length; i++) if ((layers[i] as string[]).includes(id)) return i;
      return -1;
    };
    if (topo.ok) {
      for (const n of def.nodes) {
        const oe = n.onError;
        if (!oe || typeof oe !== 'object' || !oe.goto) continue;
        const target = String(oe.goto);
        if (!ids.has(target)) continue;   // 结构校验已报"引用不存在"
        const myLayer = layerOf(n.id);
        const tLayer = layerOf(target);
        if (myLayer >= 0 && tLayer >= 0 && tLayer <= myLayer) {
          push({
            level: 'warn',
            code: 'GOTO_BACKWARD',
            nodeId: n.id,
            message: `节点「${labelOf(n.id)}」失败后跳转到「${labelOf(target)}」，但目标在它之前（或同层）已经执行过——`
              + '这个跳转永远不生效，实际按「停止这条支路」处理',
            fix: '要么把跳转目标改成还没执行过的下游节点；要么不用 goto：把这段逻辑包成子工作流，用 loop 的'
              + '「循环体=子工作流」来重试（goto 不做回跳）。',
          });
        }
      }
    }

    // ================= 轮 3：loop 边界/循环体、merge 上游、subflow 依赖、存值模型 =================
    // ---------- 轮 3 ①：loop 必须有循环边界（与引擎 LOOP_NO_BOUND 同一个判据：over / count / while 三选一）----------
    for (const n of def.nodes) {
      if (n.type !== 'loop') continue;
      const p = (n.params ?? {}) as Record<string, unknown>;
      // ★ 判据必须对齐"**解析后**"的值：over/count 此时可能还是模板字符串（{{上游.out.items}}），
      //   运行时才被 resolveParams 解成数组/数字。只按 Array.isArray 判会**误报无边界**（2026-10-04 实测踩到）。
      const nonEmptyStr = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '';
      const hasBound = Array.isArray(p.over) || nonEmptyStr(p.over)
        || typeof p.count === 'number' || nonEmptyStr(p.count)
        || nonEmptyStr(p.while);
      if (!hasBound) {
        push({
          level: 'error',
          code: 'LOOP_NO_BOUND',
          nodeId: n.id,
          message: `节点「${labelOf(n.id)}」没有循环边界——运行到这个节点会直接失败（LOOP_NO_BOUND）`,
          fix: '在右侧面板「🔁 循环设置」里三选一：count 固定次数 / while 表达式 / over 遍历上游数组。',
        });
      }
      // 循环体（子工作流）必须真的存在：引擎每轮都要 readWorkflow，不存在就会整轮失败
      const bodyName = String(((p.body ?? {}) as { workflowName?: string }).workflowName ?? '').trim();
      if (bodyName && deps.knownWorkflows && !deps.knownWorkflows.has(bodyName)) {
        push({
          level: 'error',
          code: 'LOOP_BODY_MISSING',
          nodeId: n.id,
          message: `节点「${labelOf(n.id)}」的循环体指定了子工作流「${bodyName}」，但工作区里没有这个名字的工作流——运行时每轮都会失败（WORKFLOW_NOT_FOUND）`,
          fix: `在「🔁 循环设置」的循环体下拉里选一个真实存在的工作流；如果是想新建，先建好再回来选（当前工作区的工作流可在左上角 📂 列表里看到）。`,
        });
      }
    }

    // ---------- 轮 3 ②：merge 至少 2 条上游（与引擎 MERGE_NO_UPSTREAM 同因）----------
    const inDeg = new Map<string, number>();
    for (const e of edgesN) inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
    for (const n of def.nodes) {
      if (n.type !== 'merge') continue;
      const d = inDeg.get(n.id) ?? 0;
      if (d < 2) {
        push({
          level: 'error',
          code: 'MERGE_NO_UPSTREAM',
          nodeId: n.id,
          message: `节点「${labelOf(n.id)}」只有 ${d} 条上游连线——merge 至少要 2 条，运行时必然失败（MERGE_NO_UPSTREAM）`,
          fix: '把需要汇总的多个分支都连进这个 merge 节点（连线数 ≥ 2）；只要一路输入就别用 merge，直接把那条线接到下游。',
        });
      }
    }

    // ---------- 轮 3 ③：subflow 依赖的工作流必须存在 ----------
    for (const n of def.nodes) {
      if (n.type !== 'subflow') continue;
      const dep = String((n.params?.workflowName as string | undefined) ?? '').trim();
      if (dep && deps.knownWorkflows && !deps.knownWorkflows.has(dep)) {
        push({
          level: 'error',
          code: 'SUBFLOW_MISSING',
          nodeId: n.id,
          message: `节点「${labelOf(n.id)}」要调用的子工作流「${dep}」在工作区里不存在——运行到这个节点会失败`,
          fix: '在右侧面板的「子工作流」下拉里重新选一个存在的工作流（改名/删除过的子工作流要重新指认）。',
        });
      }
    }

    // ================= 轮 4：建议类（**全部只提醒、不拦运行**） =================
    // 设计原则：每条都必须"信息量 > 噪音"——只在确实有隐患/花销时出现，且给出可执行的一步。
    // ---------- 轮 4 ①：有定时任务 + 含手动确认节点 → 定时那次不会停下来等人 ----------
    if (deps.hasSchedule) {
      const manuals = def.nodes.filter((n) => n.type === 'manual');
      if (manuals.length > 0) {
        push({
          level: 'warn',
          code: 'MANUAL_AUTOPASS',
          nodeId: manuals[0].id,
          message: `这个工作流挂了定时任务，且含 ${manuals.length} 个「人工确认」节点——定时触发那次没有人能确认，这些节点会被「自动放行」（不是失败，也不代表有人确认过）`,
          fix: '需要人工把关的内容别放在定时工作流里（或把人工确认节点换成自动校验/通知）；手动点 ▶ 运行时它们才会真停下来等你确认。',
        });
      }
    }

    // ---------- 轮 4 ②：被下游引用 ≥2 次的"数据源"节点用了「跳过这条支路」→ 失败会静默成"成功但没做事" ----------
    const refCount = new Map<string, number>();   // 节点 id → 有几个**不同的**节点引用了它的 out
    for (const node of def.nodes) {
      const { nodeRefs } = extractRefs((node.params ?? {}) as Record<string, JsonValue>);
      for (const ref of new Set(nodeRefs)) {
        if (RESERVED_REF_PREFIX.has(ref) || !ids.has(ref) || ref === node.id) continue;
        refCount.set(ref, (refCount.get(ref) ?? 0) + 1);
      }
    }
    for (const n of def.nodes) {
      if (n.onError !== 'continue') continue;
      const users = refCount.get(n.id) ?? 0;
      if (users >= 2) {
        push({
          level: 'warn',
          code: 'SOURCE_SKIP_SILENT',
          nodeId: n.id,
          message: `节点「${labelOf(n.id)}」设了「跳过这条支路」，而它有 ${users} 个下游节点引用它的输出——它一旦失败，`
            + '这条支路会被跳过、整轮却仍显示**成功**，看起来像"跑完了但什么都没做"',
          fix: '数据源类节点建议改成「⛔ 停止这条支路」（失败就该报出来），或「🛟 忽略失败」并确保下游不依赖它的输出。',
        });
      }
    }

    // ---------- 轮 4 ③：含图片/视频生成节点 → 每次运行都会真实调用付费接口 ----------
    const media = def.nodes.filter((n) => n.type === 'image_generate' || n.type === 'video_generate');
    if (media.length > 0) {
      push({
        level: 'warn',
        code: 'MEDIA_COST',
        nodeId: media[0].id,
        message: `这个工作流含 ${media.length} 个图片/视频生成节点（${media.map((n) => n.id).join('、')}）——每次运行都会真实调用付费接口`,
        fix: '调试阶段把媒体分支设成「⏭ 跳过这条支路」或先断开，确认流程没问题再打开；定时任务会按档期反复产生费用。',
      });
    }

    // ---------- 轮 4 ④：循环次数偏大（尤其带循环体）→ 耗时/费用成倍放大 ----------
    for (const n of def.nodes) {
      if (n.type !== 'loop') continue;
      const p = (n.params ?? {}) as Record<string, unknown>;
      const cnt = typeof p.count === 'number' ? p.count : null;
      const hasBody = !!(p.body as { workflowName?: string } | undefined)?.workflowName;
      const big = (cnt != null && (hasBody ? cnt >= 20 : cnt >= 50));
      if (big) {
        push({
          level: 'warn',
          code: 'BIG_LOOP',
          nodeId: n.id,
          message: hasBody
            ? `节点「${labelOf(n.id)}」循环 ${cnt} 次、每轮都要跑一遍循环体子工作流——耗时与费用会按 ${cnt} 倍放大`
            : `节点「${labelOf(n.id)}」循环 ${cnt} 次（同时会展开 ${cnt} 份迭代数据）`,
          fix: '先用小次数（如 1~3 次）验证流程正确，再调到目标值；循环体里别放付费/慢节点。',
        });
      }
    }

    // ---------- 轮 3 ④：AI 节点存值模型是否还能解析（warn：自检时解析不到，运行也可能因服务未就绪而成功）----------
    for (const n of def.nodes) {
      if (n.type !== 'subagent') continue;
      const m = String((n.params?.model as string | undefined) ?? '').trim();
      if (m && deps.modelResolves && deps.modelResolves(m) === false) {
        push({
          level: 'warn',
          code: 'MODEL_UNRESOLVED',
          nodeId: n.id,
          message: `节点「${labelOf(n.id)}」存值模型「${m}」这次没解析到（可能是模型下架、换机器，或宿主 LLM 服务此刻不可用）——运行时这个节点可能失败`,
          fix: '在右侧「选择模型」里重新选一个 dsh 当前提供的模型（存值不会被静默改写，需要你确认后再存）。',
        });
      }
    }
  } catch (e) {
    // 自检自身异常绝不阻断运行：降级成一条 warn（用户可人工判断）
    push({
      level: 'warn',
      code: 'SELFCHECK_INTERNAL',
      message: `自检过程中出现异常：${(e as Error).message ?? String(e)}`,
      fix: '把这条提示连同工作流名反馈给插件作者；不影响你继续运行。',
    });
  }

  return finish(nodes, edges);
}
