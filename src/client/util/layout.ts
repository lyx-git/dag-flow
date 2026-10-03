// src/client/util/layout.ts — 自动布局（基于拓扑分层，自实现，不依赖 dagre）
//
// 目标：把节点按 DAG 拓扑层排布成网格——
//   层 0（start）在最上，后续层依次往下；同层节点从左到右均布。
// 输出：layout map（{ [nodeId]: {x,y} }），可直接写入 WorkflowDef.layout。

import type { WorkflowDef } from '../types.js';
import { topoSort } from '../../executor/topo.js';

const COL_GAP = 240;
const ROW_GAP = 140;
const ORIGIN = { x: 40, y: 40 };

/** 计算自动布局。返回 { layout, layers }（layers 供调试）。 */
export function computeLayout(def: WorkflowDef): {
  layout: Record<string, { x: number; y: number }>;
  layers: string[][];
} {
  const topo = topoSort(def);
  // 有环时退化：环形散布（避免全部节点重叠在原点）
  const layers = topo.ok ? topo.layers : [def.nodes.map((n) => n.id)];
  const layout: Record<string, { x: number; y: number }> = {};

  if (!topo.ok) {
    const R = Math.max(240, def.nodes.length * 28);
    def.nodes.forEach((n, i) => {
      const angle = (i / Math.max(1, def.nodes.length)) * Math.PI * 2;
      layout[n.id] = { x: Math.round(400 + R * Math.cos(angle)), y: Math.round(300 + R * Math.sin(angle)) };
    });
    return { layout, layers };
  }

  layers.forEach((layer, row) => {
    const count = layer.length;
    const totalW = (count - 1) * COL_GAP;
    const startX = ORIGIN.x - totalW / 2; // 居中
    layer.forEach((id, col) => {
      layout[id] = {
        x: Math.round(startX + col * COL_GAP),
        y: ORIGIN.y + row * ROW_GAP,
      };
    });
  });

  return { layout, layers };
}

/** 便捷：把自动布局应用到 def（返回新 def） */
export function applyAutoLayout(def: WorkflowDef): WorkflowDef {
  const { layout } = computeLayout(def);
  return { ...def, layout };
}
