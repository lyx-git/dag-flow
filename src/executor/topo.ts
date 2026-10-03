// src/executor/topo.ts — DAG 拓扑排序 + 环路检测（Kahn 算法）
// 纯函数，不依赖运行环境，可单测。
//
// 输入：WorkflowDef（nodes + edges，edges 为 DAG 唯一连接表示）
// 输出：拓扑层（每层可并行）或环路路径（供 UI 高亮拒绝）。

import type { WorkflowDef } from '../types.js';

export interface TopoResult {
  ok: boolean;
  /** 拓扑层：每层内节点无相互依赖，可并行执行 */
  layers: string[][];
  /** 拓扑序（层展平） */
  order: string[];
  /** 环路节点路径（ok=false 时给出，供 UI 高亮） */
  cyclePath: string[] | null;
  /** 不可达节点（从 start 无法到达，警告） */
  unreachable: string[];
}

/**
 * Kahn 拓扑排序 + 环路检测。
 * 边语义：只考虑 flow 类连接（pass/fail/context/data 是条件/数据边不构成控制流环）。
 * 简单起见：所有边都参与判环（保守），环路定位用 DFS 找具体路径。
 */
export function topoSort(def: WorkflowDef): TopoResult {
  const nodes = def.nodes;
  const edges = def.edges ?? [];
  const idSet = new Set(nodes.map((n) => n.id));

  // 邻接表 + 入度
  const adj = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const n of nodes) { adj.set(n.id, []); indeg.set(n.id, 0); }

  for (const e of edges) {
    if (!idSet.has(e.from) || !idSet.has(e.to)) continue; // 悬空边忽略
    adj.get(e.from)!.push(e.to);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }

  // Kahn：入度 0 入队（用副本，保留原始 indeg 供其他用途）
  const indegWork = new Map(indeg);
  const order: string[] = [];
  const layers: string[][] = [];

  // 分层标准 Kahn：每轮取"当前入度为 0 的全部"作为一层
  let frontier = [...indegWork.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  while (frontier.length > 0) {
    layers.push(frontier);
    order.push(...frontier);
    const next: string[] = [];
    for (const id of frontier) {
      for (const to of adj.get(id) ?? []) {
        indegWork.set(to, (indegWork.get(to) ?? 0) - 1);
        if (indegWork.get(to) === 0) next.push(to);
      }
    }
    frontier = next;
  }

  // 检查是否有环（order 长度 < 节点数 → 有环）
  if (order.length < nodes.length) {
    const remaining = nodes.filter((n) => !order.includes(n.id)).map((n) => n.id);
    return { ok: false, layers, order, cyclePath: findCyclePath(adj, remaining), unreachable: [] };
  }

  // 可达性：从 start BFS
  const startId = nodes.find((n) => n.type === 'start')?.id;
  const reachable = new Set<string>();
  if (startId) {
    const stack = [startId];
    while (stack.length) {
      const id = stack.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      stack.push(...(adj.get(id) ?? []));
    }
  }
  const unreachable = nodes.filter((n) => !reachable.has(n.id)).map((n) => n.id);

  return { ok: true, layers, order, cyclePath: null, unreachable };
}

/** 在子图中用 DFS 找一个环路径（从 remaining 中任一点出发） */
function findCyclePath(adj: Map<string, string[]>, remaining: string[]): string[] | null {
  const color = new Map<string, 0 | 1 | 2>(); // 0 白未访 / 1 灰在栈 / 2 黑完成
  const stack: string[] = [];
  for (const n of remaining) color.set(n, 0);

  const dfs = (u: string): string[] | null => {
    color.set(u, 1);
    stack.push(u);
    for (const v of adj.get(u) ?? []) {
      if (!remaining.includes(v)) continue;
      const c = color.get(v);
      if (c === 1) {
        // 找到环：从 v 到 stack 末尾
        const idx = stack.indexOf(v);
        return [...stack.slice(idx), v];
      }
      if (c === 0) {
        const r = dfs(v);
        if (r) return r;
      }
    }
    color.set(u, 2);
    stack.pop();
    return null;
  };

  for (const n of remaining) {
    if (color.get(n) === 0) {
      const r = dfs(n);
      if (r) return r;
    }
  }
  return null;
}
