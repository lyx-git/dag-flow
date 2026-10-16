// src/client/flowgram/canvas-utils.ts — 画布共享内核：数据映射 / 回调桥 ref / 坐标与视图换算
// 数据映射 RFNode/RFEdge ↔ FlowGram WorkflowJSON；模块级 ref 桥（editorProps 只构建一次、回调始终最新的机制）；
// PlaygroundConfigEntity 读取与世界坐标换算、适应画布/居中的纯几何。
// 2026-10-14 重构轮 4 自 FlowGramCanvas.tsx 纯搬运拆出（各域组件从本文件取共享件）。

import type { RFNode, RFEdge } from '../util/flowDef';
import { PlaygroundConfigEntity, WorkflowDocument } from '@flowgram.ai/free-layout-editor';

// ================= 数据映射 =================

export function stripRunStatus(data: Record<string, unknown>): Record<string, unknown> {
  if (!data || typeof data !== 'object') return data;
  const copy = { ...data };
  delete copy.runStatus;
  return copy;
}

/** RF → FlowGram JSON */
export function toFG(nodes: RFNode[], edges: RFEdge[]) {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type,
      meta: { position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 } },
      data: stripRunStatus(n.data),
    })),
    edges: edges.map((e) => ({
      sourceNodeID: e.source,
      targetNodeID: e.target,
      // 泛化：sourceHandle 承载分支键（if:'true'/'false'，switch:case 值，'*' 兜底）
      ...(e.sourceHandle ? { sourcePortID: e.sourceHandle } : {}),
    })),
  };
}

/** FlowGram JSON → RF */
export function fromFG(json: { nodes?: any[]; edges?: any[] }): { nodes: RFNode[]; edges: RFEdge[] } {
  const nodes: RFNode[] = (json?.nodes ?? []).map((n) => ({
    id: n.id,
    type: n.type,
    position: { x: n.meta?.position?.x ?? 0, y: n.meta?.position?.y ?? 0 },
    data: { ...(n.data ?? {}) },
  }));
  const edges: RFEdge[] = (json?.edges ?? []).map((e, i) => ({
    id: `e${i}-${e.sourceNodeID}-${e.targetNodeID}`,
    source: e.sourceNodeID,
    target: e.targetNodeID,
    sourceHandle: e.sourcePortID ?? null,
  }));
  return { nodes, edges };
}

/** 结构签名：不含 position（画布拖动/外部布局调整不触发整文档重建） */
export function structSigOf(nodes: RFNode[], edges: RFEdge[]): string {
  return JSON.stringify({
    n: nodes.map((n) => [n.id, n.type, JSON.stringify(stripRunStatus(n.data))]),
    e: edges.map((e) => [e.source, e.target, e.sourceHandle ?? '']),
  });
}

// ================= 回调桥 ref（editorProps 只构建一次，回调始终最新） =================

export let onSelectRef: { current: ((id: string | null) => void) | null } = { current: null };
/** 双击节点回调桥（进入子工作流；editorProps 只构建一次，回调始终最新） */
export let onNodeDoubleClickRef: { current: ((id: string) => void) | null } = { current: null };
export let onChangeRef: { current: ((n: RFNode[], e: RFEdge[]) => void) | null } = { current: null };
export let lastEmittedSig: { current: string } = { current: '' };

/** 当前画布图（RF 视图）：标签组件要按源节点类型/cases 决定「能不能编辑 / 候选键有哪些」 */
export let graphRef: { current: { nodes: RFNode[]; edges: RFEdge[] } } = { current: { nodes: [], edges: [] } };

/** 就地改分支键的回调桥（editorProps 只构建一次，回调由 FlowGramCanvas 每次渲染刷新） */
export interface EdgeKeyEditPayload { source: string; target: string; key: string; addCase?: boolean }
export let editEdgeKeyRef: { current: ((p: EdgeKeyEditPayload) => void) | null } = { current: null };

/** ★ 撤销/重做「位移」专用通道（2026-10-16 自建撤销栈）：把节点实体的 transform 直接改到位。
 *  为什么不走 def→fromJSON 重建：①`structSigOf` **刻意不含 position**，只回退位置时 DefSync 会判定
 *  "结构没变"而跳过重建（位置就不会回退）；②重建会打断正在进行的拖拽。
 *  由 `node-shell.tsx` 在拿到 ctx 后注册实现（与 `__df_node_pos` 同一处），卸载时置空。 */
export let applyNodePositionsRef: { current: ((map: Record<string, { x: number; y: number }>) => void) | null } = { current: null };

// ================= 节点拖拽的世界坐标换算 =================

// —— 节点拖拽/拿起引擎（模块级共享：屏幕坐标 → 画布世界坐标换算 + transform 更新）——
// ★ 2026-10-01 夜：FlowGram 迁移以来节点拖拽/点选从未生效（renderDefaultNode 自定义渲染
//   没有 startDrag 可绑，HTML5 dragstart 方案又被 startDrag 内部 preventDefault 取消；
//   React onClick 也因 FlowGram 层的 stopPropagation 到不了委托根）。改用原生事件 + 自有实现：
//   - 按住拖动 = mousedown + mousemove（node.transform.update）
//   - 双击 = 拿起（握拳光标，节点跟随鼠标，单击放下 / Esc 还原）
//   - 单击 = 选中（右侧编辑面板联动，走 onSelectRef → FlowPanel.selectedNodeId）
//   - 双击 = 进入子工作流（loop 循环体 / subflow 目标；onNodeDoubleClickRef → FlowPanel，
//     2026-10-03 用户需求。此前的「双击拿起」已取消，双击在本版本无其它绑定）
export interface DragWorldCtx { zoom: number; editorLeft: number; editorTop: number; scrollX: number; scrollY: number }

export function readWorldCtx(): DragWorldCtx {
  const editor = document.querySelector('.dsh-wf-fg-editor') as HTMLElement | null;
  const rect = editor?.getBoundingClientRect();
  let cfg: any = null;
  try { cfg = (worldCtxRef.current?.() as any) ?? null; } catch { /* 忽略 */ }
  return {
    zoom: cfg?.zoom ?? 1,
    scrollX: cfg?.scrollX ?? 0,
    scrollY: cfg?.scrollY ?? 0,
    editorLeft: rect?.left ?? 0,
    editorTop: rect?.top ?? 0,
  };
}

// PlaygroundConfigEntity 读取器（Canvas 内组件注册；拿 zoom/scroll 做坐标换算）
export const worldCtxRef: { current: (() => any) | null } = { current: null };

/** 屏幕坐标 → 画布世界坐标（FlowGram：世界 = (screen - editor原点 + scroll) / zoom） */
export function screenToWorld(clientX: number, clientY: number, w: DragWorldCtx): { x: number; y: number } {
  return {
    x: (clientX - w.editorLeft + w.scrollX) / w.zoom,
    y: (clientY - w.editorTop + w.scrollY) / w.zoom,
  };
}

// ================= 画布视图（进画布默认缩放 / 适应画布 / 一键放大缩小） =================
// 需求（2026-10-03 用户原话）：「适应画布的按钮现在没啥用，现在刚进工作流画布的时候，画布上的节点太小了，
//   无法看清，最好可以一键放大缩小，方便修改」。
// 根因：onAllLayersRendered 里**每次渲染都 fitView** —— 23 节点的图被硬塞进视口（~0.3），节点看不清，
//   而且「适应画布」按钮和这个自动行为重复，所以"没啥用"。
// 现在：①进画布只设一次**看得清**的初始视图（自适应但夹在 [75%, 100%]，**取景保持原样 = 整图内容居中**）；
//      ②「⤢ 适应画布」只由点击触发，且夹在 [50%, 100%]；③「＋/−」按档位一键放大缩小（…50%→75%→100%…），
//      「1:1」一键回 100%。
// ★ 2026-10-03 修正：初版把居中目标写成起始节点(nodeBounds(start))，等于把整张图往右推——右半边被插件自己的
//   右侧检查器面板(.dsh-wf-right, absolute 浮层)盖住，端口点 elementFromPoint 命中面板，连拖线都起不来。
//   改为与「适应画布」同源：整图内容居中，**只改缩放、不改取景**。

/** 取画布配置实体（拿不到返回 null，调用方静默降级，不影响画布功能） */
export function readCfg(ctx: any): any {
  try { return ctx.get(PlaygroundConfigEntity); } catch { return null; }
}

export type WorldBox = { x: number; y: number; width: number; height: number };

/** 单节点世界坐标包围盒（量不到尺寸就按卡片尺寸估） */
export function nodeBounds(node: any): WorldBox | null {
  if (!node) return null;
  try {
    const t = node.transform?.transform;
    const b = t?.bounds;
    if (b && Number.isFinite(b.x) && Number.isFinite(b.y) && b.width > 0) {
      return { x: b.x, y: b.y, width: b.width, height: b.height || 80 };
    }
    const p = t?.position;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return { x: p.x, y: p.y, width: 240, height: 80 };
  } catch { /* 忽略 */ }
  return null;
}

/** 全部节点的世界坐标包围盒；一个都拿不到返回 null */
export function worldBounds(ctx: any): WorldBox | null {
  try {
    const doc = ctx.get(WorkflowDocument);
    const all: any[] = doc?.getAllNodes?.() ?? [];
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const n of all) {
      const b = nodeBounds(n);
      if (!b) continue;
      x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y);
      x2 = Math.max(x2, b.x + b.width); y2 = Math.max(y2, b.y + b.height);
    }
    if (!Number.isFinite(x1) || !Number.isFinite(x2)) return null;
    return { x: x1, y: y1, width: Math.max(1, x2 - x1), height: Math.max(1, y2 - y1) };
  } catch { return null; }
}

/** 视口尺寸（拿不到给保守默认值） */
export function viewportOf(cfg: any): { W: number; H: number } {
  return { W: cfg?.config?.width ?? 900, H: cfg?.config?.height ?? 600 };
}

/** 把视口对准某块世界坐标区域并居中（zoom 由调用方给定） */
export function centerOn(cfg: any, box: WorldBox | null, zoom: number): boolean {
  if (!cfg) return false;
  const cx = box ? box.x + box.width / 2 : 0;
  const cy = box ? box.y + box.height / 2 : 0;
  try {
    if (typeof cfg.scrollToView === 'function') {
      cfg.scrollToView({ bounds: box ?? { x: cx, y: cy, width: 0, height: 0 }, zoom, easing: false, scrollToCenter: true });
      return true;
    }
    const { W, H } = viewportOf(cfg);
    cfg.updateConfig({ zoom, scrollX: cx * zoom - W / 2, scrollY: cy * zoom - H / 2 });
    return true;
  } catch { return false; }
}

/** 「内容全部装进视口」所需缩放（原始值，未夹取） */
export function rawFitZoom(ctx: any): number {
  const cfg = readCfg(ctx);
  const box = worldBounds(ctx);
  if (!box) return NaN;
  const { W, H } = viewportOf(cfg);
  return Math.min((W - 60) / box.width, (H - 60) / box.height);
}
