// @ts-nocheck
// src/client/util/flowDef.ts
// WorkflowDef ↔ 画布节点/连线（RFNode/RFEdge）双向转换。
// 这是 5 个视图共享状态的"真相源"。
//
// 分支键语义（2026-09-24 泛化）：sourceHandle 承载分支键——
//   if     → 'true' / 'false'
//   switch → case 值 / '*'（兜底）
//   其他   → 无 handle（顺序/并行 next）
// 旧数据兼容：'t'/'f' 读取时映射回 'true'/'false'。

import type { ClientNode, ClientEdge, NextRef, WorkflowDef } from '../types';

export interface RFNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
  /** 失败策略（Node 级，画布不展示但需往返保留） */
  onError?: 'stop' | 'continue' | { goto: string };
}

export interface RFEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: string;
  style?: { stroke?: string };
}

const COL_GAP = 220;
const ROW_GAP = 140;
const ORIGIN = { x: 60, y: 40 };

/** 旧 handle 值兼容映射 */
function normHandle(h: string | null | undefined): string | null {
  if (h === 't') return 'true';
  if (h === 'f') return 'false';
  return h ?? null;
}

/** WorkflowDef → RF nodes/edges（缺 edges 时按 node.next 自动连） */
export function toRF(def: WorkflowDef): { nodes: RFNode[]; edges: RFEdge[] } {
  const nodes: RFNode[] = def.nodes.map((n, i) => {
    // 优先用持久化布局（DAG layout），否则蛇形栅格兜底
    const saved = def.layout?.[n.id];
    return {
      id: n.id,
      type: n.type,
      position: saved
        ? { x: saved.x, y: saved.y }
        : {
            x: ORIGIN.x + (i % 4) * COL_GAP,
            y: ORIGIN.y + Math.floor(i / 4) * ROW_GAP,
          },
      data: { ...(n.params ?? {}), label: n.label ?? n.id },
      ...(n.onError ? { onError: n.onError } : {}),
    };
  });

  const edgeStyle = (when?: string) =>
    when === 'true' ? { stroke: '#10b981' } : when === 'false' ? { stroke: '#f43f5e' } : undefined;

  let edges: RFEdge[] = [];
  if (def.edges && def.edges.length > 0) {
    edges = def.edges.map((e, i) => {
      const handle = normHandle(e.when);
      return {
        id: `e${i}-${e.from}-${e.to}`,
        source: e.from,
        target: e.to,
        ...(handle ? { sourceHandle: handle } : {}),
        label: handle ?? undefined,
        style: edgeStyle(handle ?? undefined),
      };
    });
  } else {
    // 从 node.next 推 edges（泛化 object next：{true,false} 与 switch case 映射）
    for (const n of def.nodes) {
      if (n.next == null) continue;
      if (typeof n.next === 'string') {
        edges.push({ id: `e-${n.id}-${n.next}`, source: n.id, target: n.next });
      } else if (Array.isArray(n.next)) {
        n.next.forEach((ref, i) => edges.push({ id: `e-${n.id}-${ref}-${i}`, source: n.id, target: ref }));
      } else {
        for (const [key, target] of Object.entries(n.next)) {
          if (!target) continue;
          edges.push({
            id: `e-${n.id}-${key}-${target}`,
            source: n.id,
            target,
            sourceHandle: key,
            label: key,
            style: edgeStyle(key),
          });
        }
      }
    }
  }

  return { nodes, edges };
}

/** RF nodes/edges → WorkflowDef（保留原始 def 的其它字段） */
export function fromRF(def: WorkflowDef, rfNodes: RFNode[], rfEdges: RFEdge[]): WorkflowDef {
  // ★ 2026-10-08：不再计算 node.next（写盘统一到 edges）——原来那段 perSource 聚合已删除。

  const nodes: ClientNode[] = rfNodes.map((rn) => {
    const tn = def.nodes.find((n) => n.id === rn.id);
    const paramsCopy: Record<string, unknown> = {};
    if (tn?.params) Object.assign(paramsCopy, tn.params);
    const dataCopy: Record<string, unknown> = { ...rn.data };
    delete (dataCopy as { label?: string }).label;
    Object.assign(paramsCopy, dataCopy);

    // ★ 2026-10-04 轮 5 修 bug：旧实现**逐个字段白名单**重建节点 → `tolerate`（以及将来任何新字段）
    //   会在一次画布编辑后就静默丢失。改成**以模板节点为基础覆盖**：只显式处理
    //   id/type/params/onError/label 这几项，其余字段原样保留。
    // ★ 2026-10-08 用户拍板：**写盘只写 edges、不再写 next**（读入仍兼容 next-only 文件）——
    //   引擎（normalize.ts）与画布（toRF）都以 edges 为准，两个字段并存只会带来"改了没生效"的坑。
    const out: ClientNode = { ...(tn ?? { id: rn.id, type: rn.type }), id: rn.id, type: rn.type, params: paramsCopy };
    delete (out as { next?: unknown }).next;
    const onErrorVal = rn.onError ?? tn?.onError;
    if (onErrorVal) out.onError = onErrorVal; else delete (out as { onError?: unknown }).onError;
    const labelVal = (rn.data as { label?: string }).label ?? tn?.label;
    if (labelVal !== undefined) out.label = labelVal;
    else delete (out as { label?: unknown }).label;
    return out;
  });

  // 同步 edges（when = 分支键）
  const edges: ClientEdge[] = rfEdges.map((e) => {
    const edge: ClientEdge = { from: e.source, to: e.target };
    if (e.sourceHandle) edge.when = normHandle(e.sourceHandle) as ClientEdge['when'];
    return edge;
  });

  // 布局持久化：把 RF 节点位置写回 def.layout（DAG 设计，重开不重置）
  const layout: Record<string, { x: number; y: number }> = {};
  for (const rn of rfNodes) {
    if (rn.position) layout[rn.id] = { x: rn.position.x, y: rn.position.y };
  }

  return {
    ...def,
    nodes,
    ...(edges.length > 0 ? { edges } : {}),
    ...(Object.keys(layout).length > 0 ? { layout } : {}),
  };
}

/** 生成新节点 id（node_<timestamp>_<rand>，保证唯一） */
export function newNodeId(): string {
  return `node_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * ★ 2026-10-08 用户拍板：**写盘统一到 `edges`**——把 def 规范成"只写 edges、不带 next"。
 *
 * 规则（与引擎 `normalizeDef`、画布 `toRF` 同一优先级，绝不改变执行语义）：
 *   · 有 `edges` → **原样保留 edges**（引擎/画布都只看它），只把每个节点的 `next` 删掉；
 *   · 没有 `edges` → 先按 `next` 推出等价 edges（复用与引擎逐条对齐的映射），再删 `next`；
 *   · 两者都没有 → 不动（由 DAG 按"全部节点入度 0"处理）。
 * 读入侧**继续兼容** next-only 文件（normalize/toRF 未改），所以老文件、手写文件、AI 生成都不受影响。
 *
 * @returns `{ def, changed }`——`changed` 为 true 表示确实发生了归一化（调用方可以据此提示用户）。
 */
export function canonicalizeDef(def: WorkflowDef): { def: WorkflowDef; changed: boolean } {
  const hasNext = def.nodes.some((n) => (n as { next?: unknown }).next !== undefined);
  if (!hasNext) return { def, changed: false };

  const edges = def.edges && def.edges.length > 0 ? def.edges : nextToEdges(def.nodes);
  const nodes = def.nodes.map((n) => {
    if ((n as { next?: unknown }).next === undefined) return n;
    const copy = { ...n } as ClientNode & { next?: unknown };
    delete copy.next;
    return copy;
  });
  const out: WorkflowDef = { ...def, nodes };
  if (edges.length > 0) out.edges = edges as ClientEdge[];
  else delete (out as { edges?: unknown }).edges;
  return { def: out, changed: true };
}

/**
 * 由 node.next 推导出全部 edges（**与宿主 `src/executor/normalize.ts` 的映射逐条对齐**：
 * 字符串=单后继 / 数组=扇出 / 对象=分支键；switch 的非对象 next 视为恒激活）。
 * 客户端这份是给 `canonicalizeDef` 用的（不能 import 宿主的 executor 代码）。
 */
export function nextToEdges(nodes: ClientNode[]): ClientEdge[] {
  const out: ClientEdge[] = [];
  for (const n of nodes) {
    const nx = (n as { next?: unknown }).next;
    if (nx === undefined || nx === null) continue;
    const star = n.type === 'switch' ? '*' : undefined;
    const push = (to: unknown): void => {
      if (!to || typeof to !== 'string') return;
      const e: ClientEdge = { from: n.id, to };
      if (star) e.when = star as ClientEdge['when'];
      out.push(e);
    };
    if (typeof nx === 'string') push(nx);
    else if (Array.isArray(nx)) for (const t of nx) push(t);
    else if (typeof nx === 'object') {
      for (const [key, target] of Object.entries(nx as Record<string, unknown>)) {
        if (!target || typeof target !== 'string') continue;
        out.push({ from: n.id, to: target, when: key as ClientEdge['when'] });
      }
    }
  }
  return out;
}
