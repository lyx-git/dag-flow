// src/client/flowgram/node-shell.tsx — 节点壳与画布交互：默认节点渲染器 / 交互控制器 / 拖线快选面板
// DefaultNodeWrapper（原生事件拖拽/点选/双击）+ CanvasInteractions（坐标换算注册/诊断桥/同步删除桥/空白取消选中）
// + NodeQuickPanel/onDragLineEnd（拖线到空白 → 快选 → 建节点并连线，官方同款 API 链）。
// 2026-10-14 重构轮 4 自 FlowGramCanvas.tsx 纯搬运拆出。

import { createElement, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  delay,
  useClientContext,
  useNodeRender,
  WorkflowDocument,
  WorkflowDragService,
  WorkflowLinesManager,
  WorkflowNodeRenderer,
} from '@flowgram.ai/free-layout-editor';
import { PlaygroundConfigEntity } from '@flowgram.ai/free-layout-editor';
import { createFreeNodePanelPlugin, WorkflowNodePanelService, WorkflowNodePanelUtils } from '@flowgram.ai/free-node-panel-plugin';
import { NODE_PALETTE } from '../types';
import type { RFNode, RFEdge } from '../util/flowDef';
import {
  editEdgeKeyRef,
  lastEmittedSig,
  onChangeRef,
  onNodeDoubleClickRef,
  onSelectRef,
  readWorldCtx,
  screenToWorld,
  structSigOf,
  worldCtxRef,
} from './canvas-utils';

// ================= 节点默认渲染器 =================

export function DefaultNodeWrapper(props: any) {
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

/** 画布级交互控制器：坐标换算注册 + 实体坐标诊断桥 + 同步删除桥 + 分支键就地编辑 */
export function CanvasInteractions(props: { nodes: RFNode[]; edges: RFEdge[]; onChange: (n: RFNode[], e: RFEdge[]) => void }) {
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
export function NodeQuickPanel(props: any) {
  const { onSelect, position } = props;
  const [query, setQuery] = useState('');
  const items = NODE_PALETTE.filter((m) => m.label.toLowerCase().includes(query.toLowerCase()));
  const pick = (m: any, e: any) => {
    const suffix = Math.random().toString(36).slice(2, 6);
    onSelect({
      nodeType: m.type,
      // ★ 2026-10-15 修 bug：**顶层显式给 id**——FlowGram 的 createWorkflowNodeByType 只在
      //   `json.id === undefined` 时用 `` `1${nanoid()}` `` 兜底（id 必然数字开头），
      //   会撞 WORKFLOW_SCHEMA 的 `^[a-zA-Z]` ⇒ 存盘后引擎解析被拦（运行/定时全失败）。
      //   `${type}_${后缀}` 与 label 同后缀；type 一律小写字母开头，必然合法。
      nodeJSON: {
        id: `${m.type}_${suffix}`,
        data: { label: `${m.label}_${suffix}`, ...(m.defaultParams ?? {}) },
      },
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
export async function onDragLineEnd(ctx: any, params: any): Promise<void> {
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
