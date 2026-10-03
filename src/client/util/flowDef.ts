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
  const typeOf = (id: string): string => rfNodes.find((n) => n.id === id)?.type ?? '';
  // 按源节点聚合出边：handle → target
  const perSource = new Map<string, { handle: string | null; target: string }[]>();
  for (const e of rfEdges) {
    let handle = normHandle(e.sourceHandle);
    // ★ switch 单点端口（2026-10-03 用户拍板 B）：switch 的出口端口在视觉上合成一个点，
    //   其中 'out' 代表「这条线还没选分支键」（先画线、再在线上点选）→ 与「未设分支」同义（'' 键，
    //   不会被任何 case 命中，也不会像 null 那样退化成"顺序执行"）。
    if (handle === 'out' && typeOf(e.source) === 'switch') handle = '';
    const list = perSource.get(e.source) ?? [];
    list.push({ handle, target: e.target });
    perSource.set(e.source, list);
  }

  const next: Record<string, NextRef> = {};
  for (const [source, list] of perSource) {
    const handles = list.map((x) => x.handle);
    const allPlain = handles.every((h) => h == null);
    const isIf = typeOf(source) === 'if' || handles.every((h) => h === 'true' || h === 'false');
    if (allPlain) {
      // 顺序/并行 next
      const targets = list.map((x) => x.target);
      next[source] = targets.length === 1 ? targets[0] : targets;
    } else if (isIf && handles.every((h) => h === 'true' || h === 'false') && handles.length <= 2) {
      // if：{true,false}
      const t = list.find((x) => x.handle === 'true')?.target;
      const f = list.find((x) => x.handle === 'false')?.target;
      next[source] = { true: t ?? '', false: f ?? '' };
    } else {
      // switch 泛化 case 映射
      const map: Record<string, string> = {};
      for (const x of list) map[x.handle ?? ''] = x.target;
      next[source] = map;
    }
  }

  const nodes: ClientNode[] = rfNodes.map((rn) => {
    const tn = def.nodes.find((n) => n.id === rn.id);
    const paramsCopy: Record<string, unknown> = {};
    if (tn?.params) Object.assign(paramsCopy, tn.params);
    const dataCopy: Record<string, unknown> = { ...rn.data };
    delete (dataCopy as { label?: string }).label;
    Object.assign(paramsCopy, dataCopy);

    const nodeNext: NextRef | undefined = next[rn.id];

    return {
      id: rn.id,
      type: rn.type,
      params: paramsCopy,
      ...(nodeNext !== undefined ? { next: nodeNext } : {}),
      ...(rn.onError ?? tn?.onError ? { onError: rn.onError ?? tn?.onError } : {}),
      ...(tn?.label !== undefined || rn.data.label !== undefined ? { label: (rn.data.label as string) ?? tn?.label } : {}),
    };
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
