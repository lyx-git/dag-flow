// src/executor/normalize.ts
// 「归一化」：把只有 node.next、没有 edges 的工作流**补出等价的 edges**，
// 让它们和画布保存的工作流走**同一套**（DAG）执行语义。
//
// 背景（2026-10-04 用户拍板）：项目此前有两套并行执行语义——
//   def.edges 存在 → runDag（拓扑分层并行）
//   否则           → 旧 next 递归执行器（advance()）
// 路线是合并成一套：先在入口归一化，后续轮次再把失败策略搬进 DAG，最后删除 legacy 代码。
//
// 映射表（与客户端 src/client/util/flowDef.ts 的 toRF() **逐条对齐**——画布看到的就是这里算的）：
//   next: 'x'                  → [{from, to:'x'}]                  普通边（省略 when）
//   next: ['a','b']            → 两条普通边                          并行扇出
//   next: {true:'a',false:'b'} → when:'true' / when:'false'         if 分支
//   next: {case:'a','*':'b'}   → when:case / when:'*'               switch 分支
//
// ★ 唯一的例外（必须保留，否则会改变行为）：**switch 节点写了非对象 next**（字符串 / 数组）。
//   legacy 执行器对字符串 next 是"无条件跟随"（run.ts 原 advance() 先判 typeof next === 'string'），
//   而 DAG 里 switch 节点的出边若没有分支键会被判为"未激活" → 目标被跳过。
//   所以这里把这种边标成 when:'*'（无精确 case 命中时激活），等价复现 legacy 的"恒跟随"。
//   if 节点不需要这个处理：DAG 对 if 的缺键边本来就按恒激活处理（run.ts 激活段）。
import type { Edge, Node, WorkflowDef } from '../types.js';

/** 单个节点的 next → 出边（语义见文件头映射表） */
function edgesOfNode(n: Node): Edge[] {
  const out: Edge[] = [];
  const nx = n.next;
  if (nx === undefined || nx === null) return out;
  // switch 的非对象 next → 恒激活 shim（见文件头★）
  const star = n.type === 'switch' ? '*' : undefined;

  if (typeof nx === 'string') {
    out.push(star ? { from: n.id, to: nx, when: star } : { from: n.id, to: nx });
    return out;
  }
  if (Array.isArray(nx)) {
    for (const t of nx) {
      if (!t) continue;
      out.push(star ? { from: n.id, to: t, when: star } : { from: n.id, to: t });
    }
    return out;
  }
  // 泛化 object next：{true,false}（if）或 { [case值]: 目标 }（switch，可含 '*'）
  for (const [key, target] of Object.entries(nx)) {
    if (!target) continue;   // 与客户端一致：空目标不建边
    out.push({ from: n.id, to: target, when: key });
  }
  return out;
}

/** 由 nodes 的 next 推导出全部 edges（不读取 def.edges） */
export function nextToEdges(nodes: Node[]): Edge[] {
  const out: Edge[] = [];
  for (const n of nodes) out.push(...edgesOfNode(n));
  return out;
}

/**
 * 归一化入口：只在**没有任何 edges** 时补边。
 * - 已有 edges → 原样返回（added=0），绝不改动画布保存的工作流
 * - 既无 edges 也无 next → 原样返回（added=0），由 DAG 按"全部节点入度 0"处理
 * - 不修改入参对象（返回新对象），避免调用方持有的 def 被意外改写
 */
export function normalizeDef(def: WorkflowDef): { def: WorkflowDef; added: number } {
  if (def.edges && def.edges.length > 0) return { def, added: 0 };
  const edges = nextToEdges(def.nodes);
  if (edges.length === 0) return { def, added: 0 };
  return { def: { ...def, edges }, added: edges.length };
}
