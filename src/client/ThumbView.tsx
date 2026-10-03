// @ts-nocheck
// src/client/ThumbView.tsx
// 缩略图视图（原型 B）：节点卡片 + 箭头线（CSS 实现），分支节点显示双线，
// 节点点击 → 切到 Canvas 并选中。

import { createElement } from 'react';
import type { WorkflowDef } from './types';
import { findMeta } from './types';

interface ThumbViewProps {
  def: WorkflowDef;
  onSelectNode: (id: string) => void;
  onSwitchToCanvas: () => void;
}

export function ThumbView({ def, onSelectNode, onSwitchToCanvas }: ThumbViewProps) {
  // 推导 edges（缺时按 next 推）
  const edges = deriveEdges(def);

  // 按拓扑分层：BFS，从 start 出发
  const layers = layoutByLayers(def.nodes, edges);

  return createElement(
    'div',
    { className: 'dsh-wf-thumb-root' },
    createElement(
      'h2',
      { style: { fontSize: 20, fontWeight: 700, color: 'var(--dsh-wf-fg)', margin: '0 0 4px' } },
      '📊 ', def.name,
    ),
    createElement(
      'p',
      { className: 'dsh-wf-text-muted', style: { fontSize: 12, marginBottom: 24 } },
      `${def.nodes.length} 节点 · 视图: 缩略图`,
    ),
    createElement(
      'div',
      { className: 'dsh-wf-thumb-flow' },
      ...layers.map((layer, layerIdx) => {
        if (layer.kind === 'line') {
          return createElement('div', { key: `arrow-${layerIdx}`, className: 'dsh-wf-thumb-arrow' });
        }
        if (layer.kind === 'branch') {
          return createElement(
            'div',
            { key: `branch-${layerIdx}`, className: 'dsh-wf-thumb-branch' },
            ...layer.cols.map((col, colIdx) =>
              createElement(
                'div',
                { key: `col-${layerIdx}-${colIdx}`, style: { display: 'flex', flexDirection: 'column', alignItems: 'center' } },
                createElement('div', { className: `dsh-wf-thumb-branch-label ${col.when}` }, col.when === 'true' ? '✓ true' : '✗ false'),
                createElement('div', { className: `dsh-wf-thumb-arrow ${col.when}` }),
                renderCard(col.nodeId, def, () => { onSelectNode(col.nodeId); onSwitchToCanvas(); }),
                createElement('div', { className: 'dsh-wf-thumb-arrow' }),
              ),
            ),
          );
        }
        return createElement(
          'div',
          { key: `line-${layerIdx}`, style: { display: 'flex', flexDirection: 'column', alignItems: 'center' } },
          ...layer.items.map((id) => renderCard(id, def, () => { onSelectNode(id); onSwitchToCanvas(); })),
        );
      }),
    ),
  );
}

function renderCard(id: string, def: WorkflowDef, onClick: () => void) {
  const node = def.nodes.find((n) => n.id === id);
  if (!node) return null;
  const meta = findMeta(node.type);
  return createElement(
    'div',
    {
      key: id,
      className: 'dsh-wf-thumb-card',
      style: { borderLeft: `4px solid ${meta?.color ?? '#64748b'}` },
      onClick,
    },
    createElement('div', { className: 'dsh-wf-thumb-card-title' }, `${meta?.emoji ?? '⚙️'} ${node.label ?? id}`),
    createElement('div', { className: 'dsh-wf-thumb-card-sub' }, node.type),
  );
}

interface LayerLine { kind: 'line' }
interface LayerSingle { kind: 'single'; items: string[] }
interface LayerBranch { kind: 'branch'; cols: { when: 'true' | 'false'; nodeId: string }[] }
type Layer = LayerLine | LayerSingle | LayerBranch;

function deriveEdges(def: WorkflowDef): { from: string; to: string; when?: 'true' | 'false' }[] {
  if (def.edges && def.edges.length > 0) {
    return def.edges.map((e) => ({ from: e.from, to: e.to, when: e.when === 'true' ? 'true' : e.when === 'false' ? 'false' : undefined }));
  }
  const out: { from: string; to: string; when?: 'true' | 'false' }[] = [];
  for (const n of def.nodes) {
    if (n.next == null) continue;
    if (typeof n.next === 'string') out.push({ from: n.id, to: n.next });
    else if (Array.isArray(n.next)) for (const t of n.next) out.push({ from: n.id, to: t });
    else if (typeof n.next === 'object') {
      if (n.next.true) out.push({ from: n.id, to: n.next.true, when: 'true' });
      if (n.next.false) out.push({ from: n.id, to: n.next.false, when: 'false' });
    }
  }
  return out;
}

function layoutByLayers(
  nodes: WorkflowDef['nodes'],
  edges: { from: string; to: string; when?: 'true' | 'false' }[],
): Layer[] {
  if (nodes.length === 0) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, { from: string; when?: 'true' | 'false' }[]>();
  for (const n of nodes) incoming.set(n.id, []);
  for (const e of edges) {
    const arr = incoming.get(e.to);
    if (arr) arr.push({ from: e.from, when: e.when });
  }

  // 找 start（无 incoming 的）
  const startCandidates = nodes.filter((n) => (incoming.get(n.id)?.length ?? 0) === 0);
  const start = startCandidates[0] ?? nodes[0];

  const layers: Layer[] = [];
  const visited = new Set<string>();
  let current: { id: string; when?: 'true' | 'false' }[] = [{ id: start.id }];
  layers.push({ kind: 'single', items: [start.id] });
  visited.add(start.id);

  while (current.length > 0) {
    const nextAll: { id: string; when?: 'true' | 'false' }[] = [];
    for (const cur of current) {
      for (const e of edges) {
        if (e.from === cur.id && !visited.has(e.to)) {
          visited.add(e.to);
          nextAll.push({ id: e.to, when: e.when });
        }
      }
    }
    if (nextAll.length === 0) break;

    // 检测 if 分叉：当前层有 ≥2 个且带 when 的
    const ifBranch = nextAll.filter((n) => n.when && byId.get(n.id));
    const linear = nextAll.filter((n) => !n.when);

    if (ifBranch.length >= 2) {
      layers.push({
        kind: 'branch',
        cols: ifBranch.map((n) => ({ when: n.when as 'true' | 'false', nodeId: n.id })),
      });
    } else if (ifBranch.length === 1) {
      layers.push({ kind: 'single', items: [ifBranch[0].id] });
    }
    if (linear.length > 0) {
      layers.push({ kind: 'single', items: linear.map((n) => n.id) });
    }
    if (ifBranch.length === 0 && linear.length === 0) break;

    layers.push({ kind: 'line' });
    current = nextAll;
  }
  return layers;
}
