// @ts-nocheck
// src/client/flowgram/FlowGramCanvas.tsx
// FlowGram free-layout 画布（2026-09-23 起替代旧画布引擎）。
// props 契约与旧 Canvas 完全一致（def/nodes/edges/onChange/onSelectNode/selectedNodeId），
// 新增 runResults（运行状态徽标走外置 store，不进 document 数据）。
//
// 数据映射：RFNode/RFEdge ↔ FlowGram WorkflowJSON
//   node: { id, type, position:{x,y}, data }  ↔  { id, type, meta:{position:{x,y}}, data }
//   edge: { id, source, target, sourceHandle:'t'|'f' }  ↔  { sourceNodeID, targetNodeID, sourcePortID:'true'|'false' }

import { createElement, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import 'reflect-metadata';
import {
  EditorRenderer,
  FreeLayoutEditorProvider,
  LineType,
  delay,
  useClientContext,
  useNodeRender,
  usePlaygroundTools,
  useService,
  WorkflowDocument,
  WorkflowDragService,
  WorkflowLinesManager,
  WorkflowNodeRenderer,
} from '@flowgram.ai/free-layout-editor';
import { PlaygroundConfigEntity } from '@flowgram.ai/free-layout-editor';
import { MinimapRender, createMinimapPlugin } from '@flowgram.ai/minimap-plugin';
import { createFreeSnapPlugin } from '@flowgram.ai/free-snap-plugin';
import { createFreeNodePanelPlugin, WorkflowNodePanelService, WorkflowNodePanelUtils } from '@flowgram.ai/free-node-panel-plugin';
// 分支键显形（2026-10-03 用户需求 B）：连线上打分支标签 + true 绿/false 红。
// free-lines-plugin 是 free-layout-editor 的传递依赖；createFreeLinesPlugin 声明了 singleton:true，
// 而核心 loadPlugins 用 reduceRight 收集单例（列表越靠后越优先）→ 我们这份实例会取代预设里的空实例。
import { createFreeLinesPlugin } from '@flowgram.ai/free-lines-plugin';
import '@flowgram.ai/free-layout-editor/index.css';
import './fg.css';
import { NODE_PALETTE } from '../types';
import { branchEditStore, branchKeyText, type BranchEditTarget } from './branchEdit';
import type { RFNode, RFEdge } from '../util/flowDef';
import { startResize8, readStoredJSON, saveJSON, readStoredWidth, clampNum, type PaletteGeom } from '../util/edge-drag';
import { DSH_NODE_REGISTRIES, SWITCH_NO_CASE } from './nodes';
// ★ 画布缩放策略（进画布默认缩放 / 适应画布夹取 / 一键放大缩小档位）——纯函数，离线可测
import { FIT_MIN_ZOOM, nextZoomStep, pickInitialZoom, fitZoomClamped, ensureVisibleShift } from '../viewZoom';
import { DECO_GROUP, isDecoType, memberNodeIds } from './decorations';
import { runStatusStore, selectionStore } from './runStatus';
import { switchCaseStore } from './switchCaseStore';

// ================= 数据映射 =================

function stripRunStatus(data: Record<string, unknown>): Record<string, unknown> {
  if (!data || typeof data !== 'object') return data;
  const copy = { ...data };
  delete copy.runStatus;
  return copy;
}

/** RF → FlowGram JSON */
function toFG(nodes: RFNode[], edges: RFEdge[]) {
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
function fromFG(json: { nodes?: any[]; edges?: any[] }): { nodes: RFNode[]; edges: RFEdge[] } {
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
function structSigOf(nodes: RFNode[], edges: RFEdge[]): string {
  return JSON.stringify({
    n: nodes.map((n) => [n.id, n.type, JSON.stringify(stripRunStatus(n.data))]),
    e: edges.map((e) => [e.source, e.target, e.sourceHandle ?? '']),
  });
}

// ================= 节点默认渲染器 =================

// —— 节点拖拽/拿起引擎（模块级共享：屏幕坐标 → 画布世界坐标换算 + transform 更新）——
// ★ 2026-10-01 夜：FlowGram 迁移以来节点拖拽/点选从未生效（renderDefaultNode 自定义渲染
//   没有 startDrag 可绑，HTML5 dragstart 方案又被 startDrag 内部 preventDefault 取消；
//   React onClick 也因 FlowGram 层的 stopPropagation 到不了委托根）。改用原生事件 + 自有实现：
//   - 按住拖动 = mousedown + mousemove（node.transform.update）
//   - 双击 = 拿起（握拳光标，节点跟随鼠标，单击放下 / Esc 还原）
//   - 单击 = 选中（右侧编辑面板联动，走 onSelectRef → FlowPanel.selectedNodeId）
//   - 双击 = 进入子工作流（loop 循环体 / subflow 目标；onNodeDoubleClickRef → FlowPanel，
//     2026-10-03 用户需求。此前的「双击拿起」已取消，双击在本版本无其它绑定）
interface DragWorldCtx { zoom: number; editorLeft: number; editorTop: number; scrollX: number; scrollY: number }

function readWorldCtx(): DragWorldCtx {
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
const worldCtxRef: { current: (() => any) | null } = { current: null };

/** 屏幕坐标 → 画布世界坐标（FlowGram：世界 = (screen - editor原点 + scroll) / zoom） */
function screenToWorld(clientX: number, clientY: number, w: DragWorldCtx): { x: number; y: number } {
  return {
    x: (clientX - w.editorLeft + w.scrollX) / w.zoom,
    y: (clientY - w.editorTop + w.scrollY) / w.zoom,
  };
}

function DefaultNodeWrapper(props: any) {
  const { form, node: nodeEntity } = useNodeRender();
  const ctx: any = useClientContext();
  const hostRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const nodeId: string = props.node.id;
    let dragging = false;      // 按住拖拽中
    let sx = 0, sy = 0;        // 拖拽起点（世界坐标）
    let ox = 0, oy = 0;        // 节点原点（世界坐标）
    let dragMoved = false;
    // ★ 分组框的成员（拖拽开始时快照；见 onNativeDown）
    let memberEntities: any[] = [];
    const memberStart = new Map<string, { x: number; y: number }>();

    const td = (): any => nodeEntity?.transform?.transform ?? null; // 官方同款 node.transform.transform

    const onNativeClick = (e: MouseEvent): void => {
      e.stopPropagation();
      // 拖拽后的 mouseup 不算点选（位移阈值：拖过的 click 不触发选中）
      if (dragMoved) { dragMoved = false; return; }
      onSelectRef.current?.(nodeId);
    };
    // ★ 双击节点 → 进入子工作流（2026-10-03 用户需求）。与 mousedown 的 preventDefault 不冲突
    //   （preventDefault 只拦 HTML5 拖拽/选词，不拦 dblclick）；是否真跳由 FlowPanel 决定
    //   （只有 loop 带 body.workflowName / subflow 带 params.workflowName 才跳）。
    const onNativeDblClick = (e: MouseEvent): void => {
      e.stopPropagation();
      onNodeDoubleClickRef.current?.(nodeId);
    };
    const onNativeDown = (e: MouseEvent): void => {
      if (e.button !== 0) return;
      // 表单控件上按下不拖节点（输入框/下拉等）
      const t = e.target as HTMLElement | null;
      if (t && t.closest('input,textarea,select,button')) return;
      // ★ preventDefault：阻断 WorkflowNodeRenderer 的 draggable=true 启动 HTML5 拖拽，
      //   避免与 FlowGram 内建拖拽（HTML5 dragstart→startDrag）竞争写同一节点的 transform。
      e.preventDefault();
      const w = readWorldCtx();
      const world = screenToWorld(e.clientX, e.clientY, w);
      // ★ FlowGram 双层结构：FlowNodeEntity.transform = FlowNodeTransformData（EntityData），
      //   真正的 TransformData 在其内部 .transform 字段（官方源码同款 node.transform.transform.position）
      const pos = td()?.position ?? { x: 0, y: 0 };
      dragging = true; dragMoved = false;
      sx = world.x; sy = world.y; ox = pos.x; oy = pos.y;
      // ★ 分组框：拖它时把**框内节点**一起搬（2026-10-04 用户拍板：拖动框带节点走）。
      //   成员在**拖拽开始时**按几何包含一次性算好（过程中不重算，否则会把刚拖到框里的节点又抓走）；
      //   解散/移动框都不改任何父子数据 —— def.canvas 里只存框，节点仍只属于 def.nodes。
      memberEntities = [];
      if (props.node?.type === DECO_GROUP) {
        try {
          const vals = ((form?.values ?? {}) as Record<string, unknown>);
          const box = { x: ox, y: oy, width: Number(vals.width ?? 320), height: Number(vals.height ?? 180) };
          const doc: any = ctx?.document;
          const all: any[] = doc?.getAllNodes?.() ?? [];
          const cand = all
            .filter((n: any) => n && n.id !== nodeId && !isDecoType(n.type))
            .map((n: any) => {
              const p = n.transform?.transform?.position ?? { x: 0, y: 0 };
              const sz = n.renderData?.size ?? {};
              return { id: n.id, x: p.x, y: p.y, width: sz.width ?? 180, height: sz.height ?? 80 };
            });
          const ids = memberNodeIds(box, cand);
          memberStart.clear();
          memberEntities = ids
            .map((id) => doc?.getNode?.(id))
            .filter(Boolean);
          for (const e of memberEntities) {
            const p = e.transform?.transform?.position ?? { x: 0, y: 0 };
            memberStart.set(e.id, { x: p.x, y: p.y });
          }
        } catch { memberEntities = []; memberStart.clear(); }
      }
    };
    const onMove = (e: MouseEvent): void => {
      if (!dragging) return;
      e.preventDefault();
      const w = readWorldCtx();
      const world = screenToWorld(e.clientX, e.clientY, w);
      const dx = world.x - sx, dy = world.y - sy;
      if (!dragMoved && Math.abs(dx) * w.zoom < 3 && Math.abs(dy) * w.zoom < 3) return;
      dragMoved = true;
      try { td()?.update?.({ position: { x: ox + dx, y: oy + dy } }); } catch { /* 忽略 */ }
      // ★ 分组框：成员跟着同一个位移走（用拖拽开始时的静态起点 + 同一个 dx/dy，避免累积误差）
      if (memberEntities.length) {
        for (const e of memberEntities) {
          const start = memberStart.get(e.id);
          if (!start) continue;
          try { e.transform?.transform?.update?.({ position: { x: start.x + dx, y: start.y + dy } }); } catch { /* 忽略 */ }
        }
      }
    };
    const onUp = (): void => {
      dragging = false;
    };

    el.addEventListener('click', onNativeClick);
    el.addEventListener('mousedown', onNativeDown);
    el.addEventListener('dblclick', onNativeDblClick);
    // ★ mousemove/mouseup 挂 window capture：FlowGram 的 PlaygroundDrag 在 document capture
    //   层 stopImmediatePropagation（合成/程序化事件全被吞），window 层先于 document 可达。
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
    return () => {
      el.removeEventListener('click', onNativeClick);
      el.removeEventListener('mousedown', onNativeDown);
      el.removeEventListener('dblclick', onNativeDblClick);
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.node?.id, nodeEntity]);

  return createElement(
    WorkflowNodeRenderer,
    { node: props.node, className: 'dsh-wf-fg-node' },
    createElement('div', { ref: hostRef, className: 'dsh-wf-fg-node-host', 'data-node-id': props.node?.id },
      form?.render(),
    ),
  );
}

// —— 画布节点同步删除桥（FlowPanel 的 Del 快捷键调用）——
// ★ 直接 dispose 实体（与 palette 拖入节点即时出现的机制同源），绕过 fromJSON 异步管线——
//   DefSync.fromJSON 的文档重建在 FlowGram 内部管线里延迟落地（真实机器上节点迟迟不消失）。
const disposeNodeRef: { current: ((id: string) => boolean) | null } = { current: null };

/** 供 FlowPanel 的 Del/Backspace 快捷键同步移除画布节点实体 */
export function disposeCanvasNode(id: string): boolean {
  return !!disposeNodeRef.current && disposeNodeRef.current(id);
}

/** 当前视口中心的世界坐标（2026-10-04：新建分组框/便签时用来决定放哪） */
export function viewportCenterWorld(): { x: number; y: number } {
  try {
    const editor = document.querySelector('.dsh-wf-fg-editor') as HTMLElement | null;
    const r = editor?.getBoundingClientRect();
    if (!r) return { x: 60, y: 40 };
    return screenToWorld(r.left + r.width / 2, r.top + r.height / 2, readWorldCtx());
  } catch { return { x: 60, y: 40 }; }
}

/** 画布级交互控制器：坐标换算注册 + 实体坐标诊断桥 + 同步删除桥 + 分支键就地编辑 */
function CanvasInteractions(props: { nodes: RFNode[]; edges: RFEdge[]; onChange: (n: RFNode[], e: RFEdge[]) => void }) {
  const ctx = useClientContext();

  // ★ 分支键就地编辑（2026-10-03 修复「switch 切不回原 case + 切换很慢」）：
  //   原实现只调 props.onChange → DefSync 整文档 fromJSON 重建；FlowGram 这层对**被替换掉的线**
  //   回收不完整，旧线连 DOM 带标签留在画布上（实测每次编辑 +1 条幽灵线，且带着旧分支键）——
  //   于是「看着没切过去」，线越积越多还越来越慢。现在：直接在画布上改这条线的端口
  //   （updateInfo → rebindLinePorts + fireChange，官方拖线重连内部走的就是它），并把新 sig
  //   标成「画布自己产生的变更」让 DefSync 跳过整文档重建。
  editEdgeKeyRef.current = (p) => {
    const nextNodes = props.nodes.map((n) => {
      if (!p.addCase || !p.key || p.key === '*' || n.id !== p.source) return n;
      const cases = { ...(((n.data as Record<string, unknown>)?.cases as Record<string, unknown>) ?? {}) };
      cases[p.key] = p.target;
      return { ...n, data: { ...n.data, cases } };
    });
    const nextEdges = props.edges.map((e) => (
      e.source === p.source && e.target === p.target ? { ...e, sourceHandle: p.key || null } : e
    ));
    let applied = false;
    try {
      const lm: any = ctx.container.get(WorkflowLinesManager);
      const line: any = (lm.getAllLines?.() ?? []).find((l: any) => l.from?.id === p.source && l.to?.id === p.target);
      const node: any = line?.from;
      // 新建 case 的端口由节点表单效应生成（可能还没落地）→ 取不到端口就退回重建路径
      const port: any = p.key ? node?.ports?.getPortEntityByKey?.('output', p.key) : undefined;
      if (line && (!p.key || port)) {
        line.updateInfo((info: any) => { info.fromPort = p.key || undefined; });
        applied = true;
      }
    } catch { applied = false; }
    if (applied) lastEmittedSig.current = structSigOf(nextNodes, nextEdges); // 画布已改好 → 别重建
    // 诊断钩子（真机/CDP 排查「改了没生效」）：记录这次编辑走了哪条路径
    (window as any).__df_lastBranchEdit = { source: p.source, target: p.target, key: p.key, inPlace: applied, at: Date.now() };
    props.onChange(nextNodes, nextEdges);
  };

  // 注册坐标换算读取器（zoom/scroll 来自 PlaygroundConfigEntity）+ 实体坐标诊断桥 + 删除桥
  useEffect(() => {
    let cfg: any = null;
    try { cfg = ctx.get(PlaygroundConfigEntity); } catch { /* 忽略 */ }
    worldCtxRef.current = () => cfg;
    (window as any).__df_node_pos = (id: string): { x: number; y: number } | null => {
      try {
        const doc = ctx.get(WorkflowDocument);
        const p = doc?.getNode?.(id)?.transform?.transform?.position;
        return p ? { x: p.x, y: p.y } : null;
      } catch { return null; }
    };
    disposeNodeRef.current = (id: string): boolean => {
      try {
        const doc = ctx.get(WorkflowDocument);
        const node = doc?.getNode?.(id);
        if (!node) return false;
        node.dispose();
        return true;
      } catch { return false; }
    };
    return () => {
      worldCtxRef.current = null;
      (window as any).__df_node_pos = null;
      disposeNodeRef.current = null;
    };
  }, [ctx]);

  // 点击画布空白处取消选中（mousedown 与 click 都落在画布空白处才触发——拖拽后误点不取消）
  useEffect(() => {
    let downOnEmpty = false;
    const inEditorEmpty = (t: HTMLElement | null): boolean => {
      const editor = document.querySelector('.dsh-wf-fg-editor');
      return !!(t && editor && editor.contains(t) && !t.closest('.dsh-wf-fg-node') && !t.closest('input,textarea,select,button'));
    };
    const onDown = (e: MouseEvent): void => { downOnEmpty = inEditorEmpty(e.target as HTMLElement | null); };
    const onClick = (e: MouseEvent): void => {
      if (!downOnEmpty) return;
      downOnEmpty = false;
      if (inEditorEmpty(e.target as HTMLElement | null)) onSelectRef.current?.(null);
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('click', onClick, true);
    };
  }, []);

  return null;
}

// ================= 连线拖出加节点（#2，对齐官方 onDragLineEnd） =================

/** 官方 node-panel 的自定义 renderer：深空蓝主题快选列表 */
function NodeQuickPanel(props: any) {
  const { onSelect, position } = props;
  const [query, setQuery] = useState('');
  const items = NODE_PALETTE.filter((m) => m.label.toLowerCase().includes(query.toLowerCase()));
  const pick = (m: any, e: any) => {
    const suffix = Math.random().toString(36).slice(2, 6);
    onSelect({
      nodeType: m.type,
      nodeJSON: { data: { label: `${m.label}_${suffix}`, ...(m.defaultParams ?? {}) } },
      selectEvent: e,
    });
  };
  // ★ 面板跟随拖线落点（2026-10-01 深夜用户需求「哪里停止就在哪里弹出」，2026-10-02 修：
  //   官方 Layer 把 position 原样透传给 renderer、定位是 renderer 的职责——旧实现没用该 prop，
  //   面板作为图层流内静态块渲染，位置不随落点且可能被画布遮住=用户看是「不弹」）。
  //   Portal 到 body + fixed：图层节点的 transform（onZoom scale）会造包含块，fixed 在图层内
  //   会退化成相对图层定位，body 直下才能用屏幕坐标直达落点。
  const posStyle: React.CSSProperties | undefined = (() => {
    if (!position || typeof position.x !== 'number' || typeof position.y !== 'number') return undefined;
    // 视口钳位：面板 216px 宽、约 300px 高，贴边不越界
    const x = Math.min(Math.max(4, position.x), window.innerWidth - 224);
    const y = Math.min(Math.max(4, position.y), window.innerHeight - 300);
    return { position: 'fixed' as const, left: x, top: y, zIndex: 10001 };
  })();
  const inner = createElement(
    'div',
    {
      className: 'dsh-wf-fg-quick',
      style: posStyle,
      onMouseDown: (e: any) => e.stopPropagation(),
    },
    createElement('input', {
      className: 'dsh-wf-fg-quick-search',
      autoFocus: true,
      placeholder: '选择节点…',
      value: query,
      onChange: (e: any) => setQuery(e.target.value),
      onKeyDown: (e: any) => {
        if (e.key === 'Enter' && items[0]) pick(items[0], e);
        if (e.key === 'Escape') props.onClose?.();
      },
    }),
    createElement(
      'div',
      { className: 'dsh-wf-fg-quick-list' },
      items.map((m) =>
        createElement(
          'div',
          {
            key: m.type,
            className: 'dsh-wf-fg-quick-item',
            style: { ['--kind' as string]: m.color },
            onMouseDown: (e: any) => { e.stopPropagation(); pick(m, e); },
          },
          createElement('span', { className: 'dsh-wf-fg-palette-emoji', style: { background: m.color } }, m.emoji),
          createElement('span', { className: 'dsh-wf-fg-quick-label' }, m.label),
        ),
      ),
    ),
  );
  // 有落点坐标时 portal 到 body（fixed 直达屏幕落点）；无坐标（理论不发生）退回图层内渲染
  return posStyle ? createPortal(inner, document.body) : inner;
}

/** 拖线到空白处 → 快选面板 → 创建节点并自动连线（官方同款 API 链） */
async function onDragLineEnd(ctx: any, params: any): Promise<void> {
  const { fromPort, toPort, mousePos, line, originLine, event } = params;
  if (originLine || !line || toPort || !fromPort) return;
  const panelService: any = ctx.get(WorkflowNodePanelService);
  const result = await panelService.singleSelectNodePanel({
    // ★ 面板跟随拖线落点（2026-10-01 深夜用户需求「哪里停止就在哪里弹出」，2026-10-02 修通）：
    //   直接用 mouseup 的屏幕坐标 event.clientX/Y——零坐标换算。params.mousePos 是画布世界坐标，
    //   自己拼 world→screen 逆变换要碰 zoom/scroll 符号约定（公式易错，实测偏移恰好差出 scroll 量）。
    position: { x: event?.clientX ?? 0, y: event?.clientY ?? 0 },
    panelProps: { fromPort },
  });
  if (!result) return;
  // ★ 新节点落在拖线松手点（2026-10-02 用户反馈：选完节点跑到画布中间）——
  //   createWorkflowNodeByType 第二参 position 传 undefined 时 FlowGram 放默认居中位置；
  //   params.mousePos 是松手点的世界坐标（drag 服务 getPosFromMouseEvent 产物），
  //   经官方 adjustNodePosition 按端口方位做半宽/半高居中修正后作为创建位置。
  const createPos = mousePos
    ? WorkflowNodePanelUtils.adjustNodePosition({
        nodeType: result.nodeType,
        position: mousePos,
        fromPort,
        toPort,
        document: ctx.document,
        dragService: ctx.get(WorkflowDragService),
      })
    : undefined;
  const node = ctx.document.createWorkflowNodeByType(result.nodeType, createPos, result.nodeJSON ?? {}, undefined);
  await delay(20);
  WorkflowNodePanelUtils.buildLine({ fromPort, node, linesManager: ctx.get(WorkflowLinesManager) });
}

// ================= 问题面板（#5：校验/孤立节点，点击定位） =================

interface FlowProblem { level: 'error' | 'warn'; nodeId?: string; msg: string }

function computeProblems(nodes: any[], edges: any[]): FlowProblem[] {
  const hasIn = new Set(edges.map((e) => e.target));
  const hasOut = new Set(edges.map((e) => e.source));
  const problems: FlowProblem[] = [];
  for (const n of nodes) {
    if (n.type !== 'start' && !hasIn.has(n.id)) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 无入边（不可达）` });
    if (n.type !== 'end' && !hasOut.has(n.id)) problems.push({ level: 'warn', nodeId: n.id, msg: `${n.id} 无出边（死路）` });
    const d = n.data ?? {};
    if (n.type === 'python' && !String(d.code ?? '').trim()) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} Python 代码为空` });
    if (n.type === 'bash' && !String(d.code ?? '').trim()) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} Bash 代码为空` });
    if (n.type === 'http' && !String(d.url ?? '').trim()) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} HTTP URL 为空` });
    if (n.type === 'web_search' && !String(d.query ?? '').trim()) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 搜索词（query）为空` });
    if (n.type === 'web_fetch' && !String(d.url ?? '').trim()) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 抓取地址（url）为空` });
    if (n.type === 'subagent' && !String(d.prompt ?? '').trim()) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 提示词为空` });
    if (n.type === 'image_generate' && !String(d.prompt ?? '').trim()) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 画面描述（prompt）为空` });
    if (n.type === 'image_generate' && !String(d.baseURL ?? '').trim()) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 图片 API 地址（baseURL）为空` });
    if (n.type === 'video_generate' && !String(d.submitUrl ?? '').trim()) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 任务提交地址（submitUrl）为空` });
    if (n.type === 'video_generate' && !String(d.pollUrl ?? '').trim()) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 任务查询地址（pollUrl）为空` });
    if (n.type === 'file_save' && !String(d.filename ?? '').trim()) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 保存文件名（filename）为空` });
    if (n.type === 'if' && !String(d.condition ?? '').trim()) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 条件表达式（condition）为空——会静默走 false 分支` });
    if (n.type === 'switch' && !String(d.value ?? '').trim()) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 匹配值（value）为空——会静默匹配不到任何分支` });
    if (n.type === 'switch' && (!d.cases || typeof d.cases !== 'object' || Array.isArray(d.cases) || Object.keys(d.cases).length === 0)) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 分支表（cases）为空——至少配置一个分支或 "*" 兜底` });
    if (n.type === 'log' && !String(d.message ?? '').trim()) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 日志内容（message）为空` });
    if (n.type === 'manual' && !String(d.prompt ?? '').trim()) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 等待说明（prompt）为空` });
    if (n.type === 'set_var' && (!d.vars || typeof d.vars !== 'object' || Array.isArray(d.vars) || Object.keys(d.vars).length === 0)) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 变量表（vars）为空——没有要写入的变量` });
    if (n.type === 'subflow' && !String(d.workflowName ?? '').trim()) problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 子工作流名（workflowName）为空` });
    if (n.type === 'session_input' && !String(d.sessionId ?? '').trim()) problems.push({ level: 'warn', nodeId: n.id, msg: `${n.id} 未选择会话——运行时会报「session not found」` });
    // ★ loop 循环边界（P1，2026-10-03）：count/while/over 全缺 → 运行必然 LOOP_NO_BOUND 失败，
    //   提前在问题面板显形（引擎优先级 over > count > while，卡片副标题同口径）
    if (n.type === 'loop') {
      const hasOver = Array.isArray(d.over) || (typeof d.over === 'string' && d.over.trim() !== '');
      const hasCount = typeof d.count === 'number';
      const hasWhile = typeof d.while === 'string' && d.while.trim() !== '';
      if (!hasOver && !hasCount && !hasWhile) {
        problems.push({ level: 'error', nodeId: n.id, msg: `${n.id} 循环边界缺失（count / while / over 至少配置一个）——运行时会报 LOOP_NO_BOUND` });
      }
    }
  }
  // ★ 分支线缺分支键（2026-10-03 方案 C）：执行器对「if/switch 出边没有 when」按恒激活处理——
  //   也就是说两条分支都会跑。这是静默错误，必须在问题面板里显形（点击该问题会选中源节点）。
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const e of edges) {
    const src = byId.get(e.source) as any;
    const t = src?.type;
    if (t !== 'if' && t !== 'switch') continue;
    if (e.sourceHandle) continue;
    problems.push({
      level: 'warn',
      nodeId: e.source,
      msg: `${e.source} → ${e.target} 这条分支线没设分支键——运行时会当作恒激活（所有分支都会执行）。点画布上该线中点的「未设分支」标签可设置`,
    });
  }
  // ★ 失败后跳转（onError.goto）指向**本节点之前**的节点（2026-10-04 轮 5）：
  //   轮 3 起 goto 是"失败边"语义，**目标只执行一次**——目标若在本节点之前（已经跑过）或同层，
  //   跳转不会生效、按「停止这条支路」处理。这类配置在画布上完全看不出来，运行后才发现，
  //   所以提前用祖先集合判出来（祖先必然在更早的层）；自跳也一并报。
  const parentsOf = new Map<string, string[]>();
  for (const e of edges) {
    const list = parentsOf.get(e.target);
    if (list) list.push(e.source); else parentsOf.set(e.target, [e.source]);
  }
  for (const n of nodes) {
    // ★ 取法：onError 是 RFNode 的**顶层字段**（见 util/flowDef.ts 的 RFNode 契约），不在 data 里
    const oe = (n as any).onError;
    const goto = oe && typeof oe === 'object' ? (oe as { goto?: string }).goto : undefined;
    if (!goto) continue;
    // 反向 BFS 收集祖先
    const seen = new Set<string>([n.id]);
    const q = [n.id];
    let isAncestor = false;
    while (q.length && !isAncestor) {
      const cur = q.shift() as string;
      for (const p of parentsOf.get(cur) ?? []) {
        if (p === goto) { isAncestor = true; break; }
        if (!seen.has(p)) { seen.add(p); q.push(p); }
      }
    }
    if (isAncestor || goto === n.id) {
      problems.push({
        level: 'warn',
        nodeId: n.id,
        msg: `${n.id} 失败后跳转的目标「${goto}」在本节点之前${goto === n.id ? '（就是它自己）' : ''}——跳转只在目标还没跑到时生效（目标只执行一次），这里不会生效、会按「停止这条支路」处理。要"失败后回跳重试"请用循环区（loop 的循环体）`,
      });
    }
  }
  return problems;
}

function ProblemPanel(props: { problems: FlowProblem[]; onClose: () => void; onSelect: (id: string) => void }) {
  return createElement(
    'div',
    { className: 'dsh-wf-fg-problems' },
    createElement('div', { className: 'dsh-wf-fg-problems-head' },
      createElement('span', null, `问题（${props.problems.length}）`),
      createElement('button', { className: 'dsh-wf-fg-problems-close', onClick: props.onClose }, '✕'),
    ),
    createElement('div', { className: 'dsh-wf-fg-problems-list' },
      props.problems.length === 0
        ? createElement('div', { className: 'dsh-wf-fg-problems-empty' }, '✓ 未发现问题')
        : props.problems.map((p, i) =>
            createElement('div', {
              key: i,
              className: `dsh-wf-fg-problem ${p.level}`,
              onClick: () => { if (p.nodeId) props.onSelect(p.nodeId); },
            }, `${p.level === 'error' ? '✕' : '⚠'} ${p.msg}`),
          ),
    ),
  );
}

// onChange/onSelect 的 ref 桥（editorProps 只构建一次，回调始终最新）
let onSelectRef: { current: ((id: string) => void) | null } = { current: null };
/** 双击节点回调桥（进入子工作流；editorProps 只构建一次，回调始终最新） */
let onNodeDoubleClickRef: { current: ((id: string) => void) | null } = { current: null };
let onChangeRef: { current: ((n: RFNode[], e: RFEdge[]) => void) | null } = { current: null };
let lastEmittedSig: { current: string } = { current: '' };

// ================= 分支键显形 + 就地编辑（连线标签 / 线色 / 方案 C）=================

/** 分支键显示名（真/假/其他；case 值原样）——与编辑器面板同一口径 */
function branchKeyLabel(key: string): string {
  return branchKeyText(key);
}

/** 当前画布图（RF 视图）：标签组件要按源节点类型/cases 决定「能不能编辑 / 候选键有哪些」 */
let graphRef: { current: { nodes: RFNode[]; edges: RFEdge[] } } = { current: { nodes: [], edges: [] } };
/** 就地改分支键的回调桥（editorProps 只构建一次，回调由 FlowGramCanvas 每次渲染刷新） */
export interface EdgeKeyEditPayload { source: string; target: string; key: string; addCase?: boolean }
let editEdgeKeyRef: { current: ((p: EdgeKeyEditPayload) => void) | null } = { current: null };

/** 连线中点的分支标签。挂在 free-lines-plugin 的 renderInsideLine 上：
 *  容器 = 「该线自身包围盒 + LINE_PADDING」的绝对定位盒（LineSVG 里 left=bounds.x-PADDING），
 *  所以 50%/50% + translate(-50%,-50%) 正好落在线中点，且随画布缩放/平移自动跟随。
 *  - 普通线（源节点非 if/switch）返回 null，不打扰原有观感
 *  - if/switch 的线：有分支键 → 显示标签；**没有分支键 → 琥珀色「未设分支」警示**（否则所有分支都会跑）
 *  - 点标签就地打开编辑器（方案 C） */
function LineBranchLabel(props: any) {
  const line = props?.line;
  const rawKey = String(line?.fromPort?.portID ?? '');
  // ★ 源/目标节点用 line.from/line.to 取——它们与端口无关；未设分支键的线可能没有 fromPort
  //   （若用 fromPort.node.id 取，恰恰是这种最该报警的线取不到节点 → 警示永远不显示）
  const src = String(line?.from?.id ?? line?.fromPort?.node?.id ?? '');
  const dst = String(line?.to?.id ?? line?.toPort?.node?.id ?? '');
  const node = graphRef.current.nodes.find((n) => n.id === src);
  const nodeType = String(node?.type ?? '');
  // ★ 循环标记（P3，2026-10-03 用户拍板）：loop 出边挂「循环」小标——画布上一眼看出这条线来自循环节点。
  //   与分支标签同一挂载点（线中点），但不可点（循环没有分支键可编辑）。
  if (nodeType === 'loop') {
    return createElement('div', {
      className: 'dsh-wf-fg-line-label is-loop',
      title: '来自循环节点的连线：loop 只产出迭代序列（out.count / out.items），下游节点只执行一次——需要重复执行请把循环体写成子工作流或放进单个 python/bash 节点',
    }, '循环');
  }
  const isBranchNode = nodeType === 'if' || nodeType === 'switch';
  if (!isBranchNode) return null;
  // ★ switch 单点端口（2026-10-03 用户拍板 B）：端口不再是分支键本身——'out' = 「这条线还没选分支键」，
  //   与 flowDef.fromRF 的映射一致（端口只决定拖线命中哪个锚点，分支键语义没变）。
  const key = nodeType === 'switch' && rawKey === 'out' ? '' : rawKey;
  // ★ 同一对 from→to 的多条线（多个 case 指向同一目标）标签会精确重叠：按它在同名线里的序号错开，
  //   否则叠成一坨读不出哪个 case 是哪个（?many 夹具就是 8 个 case 指向同一个目标）。
  const dupIdx = Math.max(0, graphRef.current.edges
    .filter((e) => e.source === src && e.target === dst)
    .findIndex((e) => String(e.sourceHandle ?? '') === rawKey));
  const dupStyle = dupIdx > 0 ? { marginTop: `${dupIdx * 13}px` } : undefined;
  const openEditor = (e: any): void => {
    e.stopPropagation();
    e.preventDefault();
    const cases = Object.keys(((node?.data ?? {}) as Record<string, unknown>).cases as object ?? {});
    branchEditStore.open({
      source: src, target: dst, current: key, nodeType, cases,
      anchor: { x: e.clientX ?? 0, y: e.clientY ?? 0 },
    });
  };
  if (!key) {
    return createElement('div', {
      className: 'dsh-wf-fg-line-label is-warn',
      style: dupStyle,
      title: nodeType === 'switch'
        ? '这条线还没选分支键（switch 里先画线、再点这条线的标签选 case）。不选的话它不会被执行'
        : '这条线没设分支键——运行时会把它当作恒激活（if/switch 的所有分支都会执行）。点击设置',
      onClick: openEditor,
    }, '未设分支');
  }
  const cls = key === 'true' ? 'is-true' : key === 'false' ? 'is-false' : key === '*' ? 'is-case' : 'is-case';
  return createElement('div', {
    className: `dsh-wf-fg-line-label ${cls}`,
    style: dupStyle,
    title: `分支键 ${key}（点击修改）`,
    onClick: openEditor,
  }, branchKeyLabel(key));
}

/** 线条配色：true 绿 / false 红（选中、悬停、运行流动时不覆盖，保留官方交互反馈色） */
function branchLineProps(line: any, oldProps: any): any {
  try {
    if (oldProps?.selected || oldProps?.hovered || line?.processing || line?.flowing) return oldProps;
    const key = String(line?.fromPort?.portID ?? '');
    const color = key === 'true' ? '#10b981' : key === 'false' ? '#f43f5e' : null;
    return color ? { ...oldProps, color } : oldProps;
  } catch { return oldProps; }
}

/** 分支键就地编辑器（方案 C）：连线标签点击后在锚点处弹出，直接选/改/清空分支键。
 *  渲染进 body（Portal）——画布层有 transform，面板内 fixed 定位会被包含块拖走。 */
function BranchKeyEditor() {
  const target: BranchEditTarget | null = useSyncExternalStore(
    branchEditStore.subscribe, branchEditStore.getSnapshot, branchEditStore.getSnapshot,
  );
  const [custom, setCustom] = useState('');
  useEffect(() => { setCustom(''); }, [target?.source, target?.target, target?.current]);
  if (!target) return null;

  const isIf = target.nodeType === 'if';
  // if 只有 true/false 两个固定端口；switch 是已有 cases 键 + '*' 兜底
  const keys = isIf ? ['true', 'false'] : [...target.cases, '*'];
  const apply = (key: string, addCase = false): void => {
    if (!editEdgeKeyRef.current) return;
    editEdgeKeyRef.current({ source: target.source, target: target.target, key, addCase });
    branchEditStore.close();
  };
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const left = Math.max(8, Math.min(target.anchor.x, vw - 300));
  const top = Math.max(8, Math.min(target.anchor.y + 8, vh - 220));

  const btn = (key: string, label: string, addCase = false) => createElement('button', {
    key: `k-${key}`,
    type: 'button',
    className: `dsh-wf-fg-bedit-key${target.current === key ? ' is-current' : ''}`,
    onClick: () => apply(key, addCase),
  }, label);

  return createPortal(
    createElement('div', { className: 'dsh-wf-fg-bedit-mask', onClick: () => branchEditStore.close() },
      createElement('div', {
        className: 'dsh-wf-fg-bedit',
        style: { left, top },
        onClick: (e: any) => e.stopPropagation(),
      },
        createElement('div', { className: 'dsh-wf-fg-bedit-title' },
          '分支键',
          createElement('span', { className: 'dsh-wf-fg-bedit-node' }, `${target.source} → ${target.target}`),
          createElement('button', { className: 'dsh-wf-fg-bedit-close', title: '关闭', onClick: () => branchEditStore.close() }, '✕'),
        ),
        createElement('div', { className: 'dsh-wf-fg-bedit-hint' },
          isIf
            ? '条件分支只有 true/false 两条出口——这条线走哪一条？'
            : '多路分支：可选已有 case，或在下面输入新 case 名（会自动写进该节点的分支表并指向本线目标）。'),
        createElement('div', { className: 'dsh-wf-fg-bedit-keys' },
          keys.map((k) => btn(k, k === '*' ? '* 其他' : `${branchKeyText(k)}（${k}）`)),
          target.current || isIf ? null : btn(target.current, `当前：未设置`, false),
        ),
        !isIf && createElement('div', { className: 'dsh-wf-fg-bedit-custom' },
          createElement('input', {
            value: custom,
            placeholder: '新 case 名（回车确认）',
            onChange: (e: any) => setCustom(e.target.value),
            onKeyDown: (e: any) => {
              if (e.key === 'Enter' && custom.trim()) apply(custom.trim(), true);
              if (e.key === 'Escape') branchEditStore.close();
            },
          }),
          createElement('button', {
            type: 'button',
            className: 'dsh-wf-fg-bedit-add',
            disabled: !custom.trim(),
            onClick: () => { if (custom.trim()) apply(custom.trim(), true); },
          }, '＋ 新建 case'),
        ),
        createElement('div', { className: 'dsh-wf-fg-bedit-foot' },
          createElement('button', {
            type: 'button',
            className: 'dsh-wf-fg-bedit-clear',
            title: '清空分支键（该线变回恒激活——if/switch 的所有分支都会执行）',
            disabled: !target.current,
            onClick: () => apply(''),
          }, '清空分支键'),
          createElement('span', { className: 'dsh-wf-fg-bedit-warn' }, '未设置分支键的线 = 恒激活'),
        ),
      ),
    ),
    document.body,
  );
}

// ================= 编辑器 props =================

/** ★ switch 新线的分支键归属（2026-10-03 用户拍板 B；10-03 真机反馈后改为**与命中端口无关**）。
 *  背景：用户要「switch 端口行去掉、只留 chips，选择哪个 chips，画线带出来的就是哪个分支」——但 switch 的
 *  出口端口在视觉上收成了同一个点（多端口同坐标叠着），鼠标命中的是哪个端口由 FlowGram 的绘制顺序决定。
 *  ★真机实测（用户反馈「这个没实现，没选择时画出来的是其他 else」）：引擎会把新线挂到 **`*` 兜底端口**上，
 *    我第一版只处理「挂在 `out` 端口上的新线」→ 真机一律不生效。现在**不再看引擎挂了哪个端口**：
 *  · 选中的 chip → 新线端口改写成这个 case（分支键仍走既有 portID↔when↔next 那套）
 *  · 没选中 → 新线端口改写成 `out`（＝未设分支，先画线、再在线上点选；绝不静默变成 `*` 兜底）
 *  · 老线一律不动（只认「同 from→to 的线数超出上一帧快照」的多出来的线），否则改一次选择会把历史线全带跑。
 *  就地改端口是既有机制（editEdgeKeyRef 同一路：line.updateInfo），不触发整文档重建、不会产生幽灵线。 */
function adoptChipCaseForNewLines(ctx: any): void {
  try {
    const prev = graphRef.current.edges;
    const prevCount = new Map<string, number>();
    for (const e of prev) {
      const k = `${e.source}|${e.target}`;
      prevCount.set(k, (prevCount.get(k) ?? 0) + 1);
    }
    const typeOf = (id: string): string => String(graphRef.current.nodes.find((n) => n.id === id)?.type ?? '');
    const lm: any = ctx.container.get(WorkflowLinesManager);
    const seen = new Map<string, number>();
    for (const l of (lm.getAllLines?.() ?? [])) {
      if (l?.isDrawing) continue;
      const src = String(l?.from?.id ?? ''); const dst = String(l?.to?.id ?? '');
      if (!src || !dst || typeOf(src) !== 'switch') continue;
      const k = `${src}|${dst}`;
      const idx = (seen.get(k) ?? 0) + 1;
      seen.set(k, idx);
      if (idx <= (prevCount.get(k) ?? 0)) continue;                    // 老线：不动
      const sel = switchCaseStore.getSel(src);
      const hasPort = (p: string): boolean => !!l?.from?.ports?.getPortEntityByKey?.('output', p);
      const want = sel && hasPort(sel) ? sel : SWITCH_NO_CASE;         // 没选中（或 case 端口缺失）→ 归到 out
      const hit = String(l?.fromPort?.portID ?? '');
      if (hit === want) { (window as any).__df_lastLineAdopt = { src, dst, hit, want, applied: false, sel: sel ?? null }; continue; }
      if (!hasPort(want)) continue;
      l.updateInfo((info: any) => { info.fromPort = want; });
      (window as any).__df_lastLineAdopt = { src, dst, hit, want, applied: true, sel: sel ?? null };
    }
  } catch { /* 归属失败不阻断主流程（线仍在，只是留着「未设分支」） */ }
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
function readCfg(ctx: any): any {
  try { return ctx.get(PlaygroundConfigEntity); } catch { return null; }
}

type WorldBox = { x: number; y: number; width: number; height: number };

/** 单节点世界坐标包围盒（量不到尺寸就按卡片尺寸估） */
function nodeBounds(node: any): WorldBox | null {
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
function worldBounds(ctx: any): WorldBox | null {
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
function viewportOf(cfg: any): { W: number; H: number } {
  return { W: cfg?.config?.width ?? 900, H: cfg?.config?.height ?? 600 };
}

/** 把视口对准某块世界坐标区域并居中（zoom 由调用方给定） */
function centerOn(cfg: any, box: WorldBox | null, zoom: number): boolean {
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
function rawFitZoom(ctx: any): number {
  const cfg = readCfg(ctx);
  const box = worldBounds(ctx);
  if (!box) return NaN;
  const { W, H } = viewportOf(cfg);
  return Math.min((W - 60) / box.width, (H - 60) / box.height);
}

function buildEditorProps(initialNodes: RFNode[], initialEdges: RFEdge[]) {
  // 初始视图只设一次（buildEditorProps 由 useMemo([]) 调用，生命周期与画布一致）
  let didInitView = false;
  return {
    background: false,
    readonly: false,
    initialData: toFG(initialNodes, initialEdges),
    nodeRegistries: DSH_NODE_REGISTRIES,
    fromNodeJSON: (node: any, json: any) => json,
    toNodeJSON: (node: any, json: any) => json,
    nodeEngine: { enable: true },
    history: { enable: true, enableChangeNode: true },
    // 连线配色（深空蓝主题；flowing = 运行中流动动画色）
    lineColor: {
      hidden: 'transparent',
      default: '#475569',
      drawing: '#4f8cff',
      hovered: '#4f8cff',
      selected: '#4f8cff',
      error: '#f87171',
      flowing: '#34d399',
    },
    // 拖线到空白处 → 弹出节点快选面板（#2）
    onDragLineEnd,
    materials: { renderDefaultNode: DefaultNodeWrapper },
    onContentChange: (ctx: any) => {
      try {
        // ★ switch 单点端口（2026-10-03 用户拍板 B）：先按节点上选中的 chip 给**刚画的**线定分支键
        adoptChipCaseForNewLines(ctx);
        const { nodes, edges } = fromFG(ctx.document.toJSON());
        lastEmittedSig.current = structSigOf(nodes, edges);
        onChangeRef.current?.(nodes, edges);
      } catch (e) {
        console.warn('[dag-flow] serialize failed:', e);
      }
    },
    onAllLayersRendered: (ctx: any) => {
      // 首次渲染：设一次**看得清**的初始视图（自适应但夹在 [75%,100%]）；
      // 之后**不再自动改视图** —— 用户自己缩放/拖动后不会被抢回去（这正是「适应画布」按钮以前没用的原因）。
      if (didInitView) return;
      const apply = (tryNo: number): void => {
        const cfg = readCfg(ctx);
        const W = cfg?.config?.width ?? 0;
        if (!W && tryNo < 8) { window.setTimeout(() => apply(tryNo + 1), 40); return; }   // 视口尺寸可能晚一帧就绪
        didInitView = true;
        try {
          const doc = ctx.get(WorkflowDocument);
          const all: any[] = doc?.getAllNodes?.() ?? [];
          const start = all.find((n: any) => String(n?.id) === 'start')
            ?? all.find((n: any) => String(n?.id ?? '').startsWith('start'));
          const raw = rawFitZoom(ctx);
          const zoom = pickInitialZoom(raw);
          // 居中目标 = 整图内容（与「适应画布」同源，取景与原行为一致）；取不到内容才退回起始节点
          const box = worldBounds(ctx) ?? nodeBounds(start);
          const applied = centerOn(cfg, box, zoom);
          // ★ 取景 C（2026-10-04 用户拍板）：整图居中之后，若**入口节点**不在真正可见的区域内，
          //   做一次**最少平移**把它带进来（缩放不变）。右侧面板是浮层，必须从可视宽度里减掉。
          let ensure: { shifted: boolean; dx: number; dy: number } = { shifted: false, dx: 0, dy: 0 };
          try {
            const startBox = nodeBounds(start);
            const { W: vw, H: vh } = viewportOf(cfg);
            let panelW = 0;
            try { panelW = Math.min(460, Math.max(0, document.querySelector('.dsh-wf-right')?.getBoundingClientRect().width ?? 0)); } catch { panelW = 0; }
            const shift = ensureVisibleShift({ graphBox: box, startBox, viewW: vw, viewH: vh, panelW, zoom });
            if (shift.shifted && shift.target) {
              cfg?.scrollToView?.({ bounds: shift.target, zoom, easing: false, scrollToCenter: true });
            }
            ensure = { shifted: shift.shifted, dx: Math.round(shift.dx), dy: Math.round(shift.dy) };
          } catch { /* 取景失败不影响画布 */ }
          // 诊断钩子（CDP 验证用）
          (window as any).__df_initialView = { zoom, rawFit: Number.isFinite(raw) ? Number(raw.toFixed(4)) : null, startId: start?.id ?? null, box, applied, ensure, tryNo, at: Date.now() };
        } catch (e) {
          console.warn('[dag-flow] 初始视图设置失败:', e);
        }
      };
      apply(0);
    },
    plugins: () => [
      createMinimapPlugin({
        disableLayer: true,
        canvasStyle: {
          canvasWidth: 168,
          canvasHeight: 100,
          canvasPadding: 24,
          canvasBackground: '#101a2b',
          canvasBorderRadius: 10,
          viewportBackground: 'rgba(79,140,255,0.10)',
          viewportBorderRadius: 4,
          viewportBorderColor: 'rgba(79,140,255,0.55)',
          viewportBorderWidth: 1,
          viewportBorderDashLength: 0,
          nodeColor: '#3a4d68',
          nodeBorderRadius: 2,
          nodeBorderWidth: 0,
          nodeBorderColor: 'transparent',
          overlayColor: 'rgba(0,0,0,0)',
        },
      }),
      createFreeSnapPlugin({
        edgeColor: '#2f4a6d',
        alignColor: '#4f8cff',
        edgeLineWidth: 1,
        alignLineWidth: 1,
        alignCrossWidth: 8,
      }),
      // 节点快选面板（自定义 renderer = 深空蓝主题；官方服务负责定位/创建/连线）
      createFreeNodePanelPlugin({ renderer: NodeQuickPanel }),
      // 连线分支标签 + 分支线配色（覆盖预设里的空实例，见文件头 import 处说明）
      createFreeLinesPlugin({ renderInsideLine: LineBranchLabel, customLineProps: branchLineProps }),
    ],
  };
}

// ================= 外部 def 变化 → document.fromJSON =================

function DefSync(props: { nodes: RFNode[]; edges: RFEdge[] }) {
  const ctx = useClientContext();
  const lastApplied = useRef('');
  const sig = structSigOf(props.nodes, props.edges);
  useEffect(() => {
    if (sig === lastEmittedSig.current) { lastApplied.current = sig; return; }
    if (sig === lastApplied.current) return;
    lastApplied.current = sig;
    try {
      // ★ 幽灵线清理（2026-10-03）：FlowGram 的 fromJSON 对「被替换掉的线」回收不完整——
      //   旧线实体留在 linesManager 里、DOM 也留在画布上（实测改一次分支键多一条线，
      //   且带着旧分支键标签）。重建前把「不在目标边集合里」的现存线先 dispose 掉：
      //   dispose 会触发线的 onDispose → 移除 DOM（free-lines-plugin 的 mountedLines 清理路径）。
      const lm: any = ctx.container.get(WorkflowLinesManager);
      const want = new Set(props.edges.map((e) => `${e.source}|${e.sourceHandle ?? ''}|${e.target}`));
      for (const l of (lm.getAllLines?.() ?? [])) {
        if (l?.isDrawing) continue;                        // 正在拖拽绘制的线别动
        const k = `${l?.from?.id ?? ''}|${l?.fromPort?.portID ?? ''}|${l?.to?.id ?? ''}`;
        if (!want.has(k)) { try { l.dispose(); } catch { /* 忽略 */ } }
      }
      ctx.document.fromJSON(toFG(props.nodes, props.edges));
    } catch (e) {
      console.warn('[dag-flow] fromJSON failed:', e);
    }
  }, [sig]);
  return null;
}

// ================= 工具条（撤销/重做/整理/适应/缩放） =================

function Toolbar(props: { problemCount?: number; showProblems?: boolean; onToggleProblems?: () => void }) {
  const ctx = useClientContext();
  const tools = usePlaygroundTools();
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  useEffect(() => {
    const disposable = ctx.history.undoRedoService.onChange(() => {
      setCanUndo(ctx.history.canUndo());
      setCanRedo(ctx.history.canRedo());
    });
    return () => disposable.dispose();
  }, [ctx]);
  const btn = (label: string, title: string, onClick: () => void, disabled?: boolean, primary?: boolean) =>
    createElement('button', { key: label + title, className: `dsh-wf-fg-tb${primary ? ' primary' : ''}`, title, onClick, disabled }, label);
  const problemCount = props.problemCount ?? 0;
  const zoomPct = Math.round((tools.zoom ?? 1) * 100);
  /** 当前缩放：优先读画布配置实体（比 hook 里的 state 更即时） */
  const zoomNow = (): number => {
    const cfg = readCfg(ctx);
    return cfg?.zoom ?? tools.zoom ?? 1;
  };
  /** ★ 一键缩放（2026-10-03 用户要求「最好可以一键放大缩小，方便修改」）：
   *  ＋/− 按**档位**跳（25/50/70/100/125/150/200%）；「1:1」/点百分比一键回 100%；
   *  缩放围绕**当前视口中心**（scrollToView + scrollToCenter），视觉上不跳。
   *  注意：usePlaygroundTools() 里只有 zoomin/zoomout（没有 updateZoom），所以走配置实体。 */
  const zoomTo = (z: number): void => {
    const cfg = readCfg(ctx);
    try {
      if (cfg?.scrollToView) {
        const c = cfg.config ?? {};
        const scale = cfg.zoom || 1;
        const cx = ((c.scrollX ?? 0) + (c.width ?? 900) / 2) / scale;   // 当前视口中心对应的世界坐标
        const cy = ((c.scrollY ?? 0) + (c.height ?? 600) / 2) / scale;
        cfg.scrollToView({ position: { x: cx, y: cy }, zoom: z, easing: false, scrollToCenter: true });
      } else {
        cfg?.updateConfig?.({ zoom: z });
      }
      (window as any).__df_lastZoom = { zoom: z, applied: true, by: 'toolbar', at: Date.now() };
    } catch {
      (window as any).__df_lastZoom = { zoom: z, applied: false, by: 'toolbar', at: Date.now() };
    }
  };
  const fitCanvas = (): void => {
    const raw = rawFitZoom(ctx);
    const z = fitZoomClamped(raw);
    const box = worldBounds(ctx);
    if (!centerOn(readCfg(ctx), box, z)) { try { tools.fitView(); } catch { /* 忽略 */ } }
    (window as any).__df_lastFit = { zoom: z, rawFit: Number.isFinite(raw) ? Number(raw.toFixed(4)) : null, box, at: Date.now() };
  };
  return createElement(
    'div',
    { className: 'dsh-wf-fg-toolbar' },
    btn('↶', '撤销', () => ctx.history.undo(), !canUndo),
    btn('↷', '重做', () => ctx.history.redo(), !canRedo),
    createElement('span', { key: 's1', className: 'dsh-wf-fg-tb-sep' }),
    btn('✨ 整理', '自动布局（Dagre 分层）', () => tools.autoLayout()),
    btn('⤢', `适应画布（全图可见，缩放下限 ${Math.round(FIT_MIN_ZOOM * 100)}%）`, fitCanvas),
    createElement('span', { key: 's2', className: 'dsh-wf-fg-tb-sep' }),
    // 一键放大缩小：− / 百分比（点它回 100%）/ ＋ / 1:1
    btn('−', `缩小（下一档：${Math.round(nextZoomStep(zoomNow(), -1) * 100)}%）`, () => zoomTo(nextZoomStep(zoomNow(), -1))),
    createElement('button', {
      key: 'zoom',
      className: 'dsh-wf-fg-zoom',
      title: `当前 ${zoomPct}% —— 点击回到 100%（1:1 实际大小）`,
      onClick: () => zoomTo(1),
    }, `${zoomPct}%`),
    btn('＋', `放大（下一档：${Math.round(nextZoomStep(zoomNow(), 1) * 100)}%）`, () => zoomTo(nextZoomStep(zoomNow(), 1))),
    btn('1:1', '一键回到 100%（实际大小，改参数时最常用）', () => zoomTo(1)),
    createElement('span', { key: 's3', className: 'dsh-wf-fg-tb-sep' }),
    btn(`⚠ 问题${problemCount ? `(${problemCount})` : ''}`, '问题面板（校验/孤立节点）', () => props.onToggleProblems?.(), false, false),
  );
}

// ================= 左侧节点面板（FlowGram 拖拽服务） =================

const CATEGORY_ORDER = ['control', 'script', 'io', 'ai', 'media', 'data', 'misc'];
const CATEGORY_LABELS: Record<string, string> = {
  control: '控制流', script: '脚本', io: 'IO', ai: 'AI', media: '多模态', data: '数据', misc: '杂项',
};

function NodePalette() {
  const dragService = useService(WorkflowDragService);
  const document = useService(WorkflowDocument);
  const ctx = useClientContext();
  const [query, setQuery] = useState('');
  const [min, setMin] = useState(false); // ★ 最小化：收成竖条，点展开
  // ★ 面板几何可拖八向调节（2026-10-01 夜用户需求：四周边缘线和角），localStorage 记忆；
  //   h=null 表示高度拉伸态（top/bottom 双锚），拖过 n/s 边后转为定高
  const [geom, setGeom] = useState<PaletteGeom>(() => readStoredJSON<PaletteGeom>(
    'dag-flow:palette-geom',
    { x: 12, y: 12, w: 200, h: null },
    (raw) => ({
      x: clampNum(raw?.x, 12, 0, 2000),
      y: clampNum(raw?.y, 12, 0, 2000),
      w: clampNum(raw?.w, 200, 160, 420),
      h: typeof raw?.h === 'number' ? clampNum(raw.h, 400, 220, 1400) : null,
    }),
  ));
  const paletteRef = useRef<HTMLElement | null>(null);
  const startResize = (dir: string) => (e: any) => {
    const el = paletteRef.current;
    const measured = el ? el.getBoundingClientRect().height : 600;
    startResize8(
      e, dir,
      { x: geom.x, y: geom.y, w: geom.w, h: geom.h ?? measured },
      { minW: 160, maxW: 420, minH: 220, maxH: 1400 },
      (g) => setGeom({ x: g.x, y: g.y, w: g.w, h: g.h }),
      (g) => {
        const out: PaletteGeom = { x: g.x, y: g.y, w: g.w, h: g.h };
        setGeom(out);
        saveJSON('dag-flow:palette-geom', out);
      },
    );
  };

  // ★ 仅拖拽添加（2026-10-02 用户需求）：startDragCard 是「松手即落卡」语义——按下即接管的话
  //   原位单击松开也会创建节点。改为按下后先记起点，位移超过阈值才真正起拖；原位单击松开
  //   = 清理监听、无副作用。监听挂 window capture（FlowGram document capture 会吞合成事件，
  //   见 lesson 0mupqrlf）。
  // ★ 拖影修复：startDragCard 的 onDragStart 克隆 event.currentTarget 当拖影并用它的
  //   getBoundingClientRect 定位——原生 move 事件的 currentTarget 是 window（拿不到元素、
  //   定位崩），必须构造以面板项为 currentTarget 的 shim 事件、坐标用原 mousedown 坐标
  //   （dragger.start 起点），拖影从面板项原位出发、delta 跟手，与官方按下即拖行为一致。
  const DRAG_THRESHOLD = 4; // px
  const onItemMouseDown = (e: any, type: string) => {
    if (e.button !== 0) return;
    const meta = NODE_PALETTE.find((m) => m.type === type);
    if (!meta) return;
    e.preventDefault(); // 防文本选择
    const itemEl = e.currentTarget as HTMLElement;
    const downX: number = e.clientX;
    const downY: number = e.clientY;
    let started = false;
    const idSuffix = () => Math.random().toString(36).slice(2, 6);
    const startCard = () => {
      const shim = new MouseEvent('mousedown', {
        clientX: downX, clientY: downY, bubbles: false, cancelable: true, view: window,
      });
      // startDragCard 内部读 event.currentTarget 克隆拖影并定位——shim 钉死为面板项元素
      Object.defineProperty(shim, 'currentTarget', { value: itemEl });
      try {
        void dragService.startDragCard(type, shim, {
          data: {
            label: `${meta.label}_${idSuffix()}`,
            ...(meta.defaultParams ?? {}),
          },
        });
      } catch (err) {
        console.warn('[dag-flow] startDragCard failed:', err);
      }
    };
    const cleanup = (): void => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
    };
    const onMove = (ev: MouseEvent): void => {
      if (started) return;
      if (Math.abs(ev.clientX - downX) < DRAG_THRESHOLD && Math.abs(ev.clientY - downY) < DRAG_THRESHOLD) return;
      started = true;
      cleanup();
      startCard();
    };
    const onUp = (): void => { cleanup(); };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
    void document; void ctx;
  };

  const groups = CATEGORY_ORDER
    .map((cat) => ({
      cat,
      items: NODE_PALETTE.filter((m) => m.category === cat && m.label.toLowerCase().includes(query.toLowerCase())),
    }))
    .filter((g) => g.items.length > 0);

  if (min) {
    return createElement('aside', { className: 'dsh-wf-fg-palette min' },
      createElement('button', {
        key: 'expand',
        className: 'dsh-wf-fg-palette-min-btn',
        title: '展开节点面板',
        onClick: () => setMin(false),
      }, '»'),
      createElement('div', { className: 'dsh-wf-fg-palette-min-label' }, '节点面板'),
    );
  }
  return createElement(
    'aside',
    {
      className: 'dsh-wf-fg-palette',
      ref: paletteRef,
      style: {
        left: geom.x, top: geom.y, width: geom.w,
        ...(geom.h != null ? { height: geom.h, bottom: 'auto' } : {}),
      } as any,
    },
    // 八向拖拽把手（四边+四角）：e/s 直接改尺寸，w/n 额外移动面板位置
    ...['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((dir) =>
      createElement('div', {
        key: dir,
        className: `dsh-wf-fg-palette-resize ${dir}`,
        title: '拖动调整面板大小',
        onMouseDown: startResize(dir),
      })),
    createElement('div', { className: 'dsh-wf-fg-palette-head' },
      createElement('input', {
        className: 'dsh-wf-fg-palette-search',
        placeholder: '搜索节点…',
        value: query,
        onChange: (e: any) => setQuery(e.target.value),
        onMouseDown: (e: any) => e.stopPropagation(),
      }),
      createElement('button', {
        className: 'dsh-wf-fg-palette-min',
        title: '最小化节点面板',
        onClick: () => setMin(true),
      }, '«'),
    ),
    createElement('div', { className: 'dsh-wf-fg-palette-list' },
      groups.map((g) => createElement('div', { key: g.cat },
        createElement('div', { className: 'dsh-wf-fg-palette-cat' }, CATEGORY_LABELS[g.cat] ?? g.cat),
        g.items.map((m) => createElement('div', {
          key: m.type,
          className: 'dsh-wf-fg-palette-item',
          style: { ['--kind' as string]: m.color },
          onMouseDown: (e: any) => void onItemMouseDown(e, m.type),
          title: `拖拽「${m.label}」到画布`,
        },
          createElement('span', { className: 'dsh-wf-fg-palette-emoji', style: { background: m.color } }, m.emoji),
          createElement('span', { className: 'dsh-wf-fg-palette-label' }, m.label),
        )),
      )),
    ),
  );
}

// ================= minimap（2026-10-01 夜：避让右面板 + 最小化 + 八向缩放） =================

const MINIMAP_BASE_W = 168;
const MINIMAP_BASE_H = 100;

function Minimap(props: { rightInset: number }) {
  const [min, setMin] = useState(false);
  // 目标宽度：内部 168×100 画布按 w/168 等比 zoom（插件画布尺寸创建时固化，运行时只能缩放），localStorage 记忆
  const [w, setW] = useState(() => readStoredWidth('dag-flow:minimap-w', MINIMAP_BASE_W, 120, 420));

  // 八向缩放：边把手用对应轴位移（上下边按纵横比折算），角把手用两轴合成位移——全程等比不变形
  const startResize = (dir: string) => (e: any) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = w;
    let last = startW;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let d = 0;
      if (dir.includes('e')) d += dx;
      if (dir.includes('w')) d -= dx;
      if (dir.includes('s')) d += dy * (MINIMAP_BASE_W / MINIMAP_BASE_H);
      if (dir.includes('n')) d -= dy * (MINIMAP_BASE_W / MINIMAP_BASE_H);
      last = Math.min(Math.max(startW + d, 120), 420);
      setW(last);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
      try { localStorage.setItem('dag-flow:minimap-w', String(Math.round(last))); } catch { /* 忽略 */ }
    };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
  };

  if (min) {
    return createElement('button', {
      className: 'dsh-wf-fg-minimap-stub',
      style: { right: props.rightInset },
      title: '展开缩略图',
      onClick: () => setMin(false),
    }, '🗺');
  }
  const h = Math.round((MINIMAP_BASE_H * w) / MINIMAP_BASE_W);
  return createElement('div', { className: 'dsh-wf-fg-minimap', style: { right: props.rightInset, width: w, height: h } },
    createElement('button', {
      className: 'dsh-wf-fg-minimap-min',
      title: '收起缩略图',
      onClick: () => setMin(true),
    }, '»'),
    createElement('div', { style: { zoom: w / MINIMAP_BASE_W } as any },
      createElement(MinimapRender, {
        containerStyles: { pointerEvents: 'auto', position: 'relative', top: 'unset', right: 'unset', bottom: 'unset', left: 'unset' },
        inactiveStyle: { opacity: 1, scale: 1, translateX: 0, translateY: 0 },
      }),
    ),
    ...['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((dir) =>
      createElement('div', { key: dir, className: `dsh-wf-fg-minimap-rs ${dir}`, onMouseDown: startResize(dir) })),
  );
}

// ================= 状态栏（B3：实时问题数，点击联动问题面板） =================

function StatusBar(props: { nodeCount: number; edgeCount: number; problemCount: number; onShowProblems: () => void }) {
  const hasProblems = props.problemCount > 0;
  return createElement(
    'div',
    { className: 'dsh-wf-statusbar' },
    createElement('span', null, `节点: ${props.nodeCount}`),
    createElement('span', null, `连线: ${props.edgeCount}`),
    hasProblems
      ? createElement('span', {
          className: 'dsh-wf-statusbar-error',
          style: { cursor: 'pointer' },
          onClick: props.onShowProblems,
          title: '点击查看问题详情',
        }, `⚠ ${props.problemCount} 个问题（点击查看）`)
      : createElement('span', { className: 'dsh-wf-statusbar-valid' }, '✓ 校验通过'),
  );
}

// ================= 主组件 =================

export function Canvas(props: {
  def?: unknown;
  nodes: RFNode[];
  edges: RFEdge[];
  activeEdges?: Set<string>;
  onChange: (nodes: RFNode[], edges: RFEdge[]) => void;
  onSelectNode: (id: string) => void;
  /** 双击节点（进入 loop 循环体 / subflow 子工作流，2026-10-03 用户需求） */
  onNodeDoubleClick?: (id: string) => void;
  selectedNodeId?: string | null;
  runResults?: Record<string, { status: string; durationMs?: number; count?: number; out?: unknown; error?: { code?: string; message?: string }; tolerated?: boolean }>;
  rightInset?: number; // 缩略图右避让量（右面板宽 + 边距，2026-10-01 夜）
}) {
  const { nodes, edges, runResults } = props;

  // 回调桥：保持最新（editorProps 只构建一次）
  onChangeRef.current = props.onChange;
  onSelectRef.current = props.onSelectNode;
  onNodeDoubleClickRef.current = props.onNodeDoubleClick ?? null;
  // 分支标签要按源节点类型/cases 决定候选键（标签在 FlowGram 层渲染，拿不到我们的 RF 数组）
  graphRef.current = { nodes, edges };

  // 运行状态 → 外置 store（不进 document 数据）
  useEffect(() => {
    runStatusStore.set(runResults ?? {});
  }, [runResults]);

  // 选中节点 → 外置 store（FormView/ThumbView 发起的选中在画布上高亮）
  useEffect(() => {
    selectionStore.set(props.selectedNodeId ?? '');
  }, [props.selectedNodeId]);

  // 问题面板（#5）
  const problems = useMemo(() => computeProblems(nodes, edges), [nodes, edges]);
  const [showProblems, setShowProblems] = useState(false);

  const editorProps = useMemo(() => buildEditorProps(nodes, edges), []);
  void LineType;

  return createElement(
    'div',
    { className: 'dsh-wf-fg-root' },
    createElement(
      FreeLayoutEditorProvider,
      editorProps,
      createElement(DefSync, { nodes, edges }),
      createElement(EditorRenderer, { className: 'dsh-wf-fg-editor' }),
      createElement(CanvasInteractions, { nodes, edges, onChange: props.onChange }),
      createElement(NodePalette),
      createElement(Toolbar, {
        problemCount: problems.length,
        showProblems,
        onToggleProblems: () => setShowProblems((v) => !v),
      }),
      showProblems && createElement(ProblemPanel, {
        problems,
        onClose: () => setShowProblems(false),
        onSelect: (id: string) => props.onSelectNode(id),
      }),
      createElement(Minimap, { rightInset: props.rightInset ?? 12 }),
      createElement(BranchKeyEditor),
      createElement(StatusBar, {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        problemCount: problems.length,
        onShowProblems: () => setShowProblems(true),
      }),
    ),
  );
}
