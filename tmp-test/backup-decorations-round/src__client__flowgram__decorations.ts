// @ts-nocheck
// src/client/flowgram/decorations.ts
// 画布装饰：**分组框**（把一组节点圈起来、拖动时一起搬）+ **便签**（写备注）。
// 2026-10-04 用户拍板方案 A（原型见 tmp-test/proto-group-comment.html）：
//   · 拖动框 → 框内节点跟着一起动（按几何包含关系临时算，**不建立父子数据**）
//   · 便签可折叠成小图标
//   · 存储：def.canvas = { groups, comments } —— **不进执行图**（引擎/自检/运行日志完全看不到）
//
// 为什么单列 def.canvas 而不放进 nodes：装饰一旦进 nodes，引擎会把它们当节点执行
//   （UNKNOWN_NODE_TYPE）、自检会报"不可达/参数缺失"、拓扑排序也会被干扰。
//
// 画布上的表示：它们仍是 FlowGram 节点（类型 deco-group / deco-note），这样平移/缩放/拖拽/
// 命中测试全部复用引擎；但 toRF/fromRF 在 def 边界把它们**分流**到 canvas，绝不出现在 def.nodes。

import type { RFNode } from '../util/flowDef';

export const DECO_GROUP = 'deco-group';
export const DECO_NOTE = 'deco-note';

/** 装饰节点类型判据（toRF/fromRF/拖拽/渲染都靠它分流） */
export function isDecoType(type: string | undefined | null): boolean {
  return type === DECO_GROUP || type === DECO_NOTE;
}

/** 分组框 / 便签的配色（与画布主题一套：深空蓝 + 少量强调色） */
export const GROUP_COLORS = ['#4f8cff', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#38bdf8'];
export const NOTE_COLORS = ['#ffd977', '#9ecbff', '#c9b6ff', '#b9f6ca'];

/** 便签配色 → 文字色（浅底配深字，保证可读） */
export function noteTextColor(bg: string | undefined): string {
  return bg === '#9ecbff' ? '#10233a' : bg === '#c9b6ff' ? '#231640' : bg === '#b9f6ca' ? '#12331f' : '#2a2410';
}

let seq = 0;
export function newDecoId(prefix: 'grp' | 'note'): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}`;
}

/** 装饰节点 → FlowPanel 的回调桥（FlowPanel 挂载时注册；改名/换色/折叠/删除都走它）。
 *  放在本模块（而不是 nodes.tsx）是为了避免 FlowPanel ↔ nodes 的循环依赖。 */
export const decoBridge: {
  current: ((id: string, patch: Record<string, unknown>) => void) | null;
} = { current: null };

/** 新建分组框的默认尺寸（世界坐标） */
export const GROUP_DEFAULT_W = 320;
export const GROUP_DEFAULT_H = 180;
export const NOTE_DEFAULT_W = 190;
export const NOTE_DEFAULT_H = 96;
export const NOTE_COLLAPSED_H = 26;

/** def.canvas → 画布 RF 节点（FlowPanel 把它们并进 Canvas 的 nodes） */
export function decorationsToRF(def: { canvas?: any }): RFNode[] {
  const out: RFNode[] = [];
  for (const g of def?.canvas?.groups ?? []) {
    out.push({
      id: g.id, type: DECO_GROUP,
      position: { x: g.x ?? 0, y: g.y ?? 0 },
      data: { title: g.title ?? '', width: g.width ?? GROUP_DEFAULT_W, height: g.height ?? GROUP_DEFAULT_H, color: g.color ?? GROUP_COLORS[0] },
    });
  }
  for (const c of def?.canvas?.comments ?? []) {
    out.push({
      id: c.id, type: DECO_NOTE,
      position: { x: c.x ?? 0, y: c.y ?? 0 },
      data: { text: c.text ?? '', color: c.color ?? NOTE_COLORS[0], collapsed: !!c.collapsed, width: c.width ?? NOTE_DEFAULT_W },
    });
  }
  return out;
}

/** 画布 RF 节点（仅装饰部分）→ def.canvas（位置从 RFNode.position 取，属性从 data 取） */
export function decorFromRF(decoRfNodes: RFNode[]): { groups: any[]; comments: any[] } {
  const groups: any[] = [];
  const comments: any[] = [];
  for (const n of decoRfNodes) {
    const d = (n.data ?? {}) as Record<string, any>;
    const x = Math.round(n.position?.x ?? 0);
    const y = Math.round(n.position?.y ?? 0);
    if (n.type === DECO_GROUP) {
      groups.push({
        id: n.id, title: String(d.title ?? ''), x, y,
        width: Math.max(80, Math.round(Number(d.width) || GROUP_DEFAULT_W)),
        height: Math.max(60, Math.round(Number(d.height) || GROUP_DEFAULT_H)),
        color: String(d.color ?? GROUP_COLORS[0]),
      });
    } else if (n.type === DECO_NOTE) {
      comments.push({
        id: n.id, text: String(d.text ?? ''), x, y,
        color: String(d.color ?? NOTE_COLORS[0]),
        collapsed: !!d.collapsed,
        width: Math.max(80, Math.round(Number(d.width) || NOTE_DEFAULT_W)),
      });
    }
  }
  return { groups, comments };
}

/**
 * 拖动分组框时，哪些**真实节点**要跟着一起动：几何包含（节点中心落在框内即算成员）。
 * 纯函数，便于离线测；传的是「拖拽开始时」的静态快照，拖拽过程中不再重算（否则会把刚拖进来的节点又抓走）。
 */
export function memberNodeIds(
  box: { x: number; y: number; width: number; height: number },
  nodes: Array<{ id: string; x: number; y: number; width?: number; height?: number }>,
): string[] {
  const cx2 = box.x + box.width;
  const cy2 = box.y + box.height;
  const out: string[] = [];
  for (const n of nodes) {
    // 节点中心（拿不到尺寸就按点算）
    const nx = n.x + (n.width ?? 0) / 2;
    const ny = n.y + (n.height ?? 0) / 2;
    if (nx >= box.x && nx <= cx2 && ny >= box.y && ny <= cy2) out.push(n.id);
  }
  return out;
}

/** 新建分组框时给个不重复的默认标题 */
export function nextGroupTitle(def: { canvas?: any }): string {
  const n = (def?.canvas?.groups ?? []).length + 1;
  return `分组 ${n}`;
}
