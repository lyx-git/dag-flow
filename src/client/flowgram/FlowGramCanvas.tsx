// src/client/flowgram/FlowGramCanvas.tsx
// FlowGram free-layout 画布（2026-09-23 起替代旧画布引擎）。
// props 契约与旧 Canvas 完全一致（def/nodes/edges/onChange/onSelectNode/selectedNodeId），
// 新增 runResults（运行状态徽标走外置 store，不进 document 数据）。
//
// ★ 2026-10-14 重构轮 4-5 拆分后本文件只留**装配层**：编辑器 props 构建（buildEditorProps）+
//   DefSync（外部 def → document.fromJSON，含幽灵线清理）+ 主组件 Canvas。
//   各域实现按职责放在本目录：canvas-utils.ts（数据映射/回调桥/坐标视图）、node-shell.tsx（节点壳与
//   画布交互/拖线快选）、problems.tsx（问题面板）、branch-editor.tsx（分支键显形与就地编辑/switch 归属）、
//   run-path.tsx（运行路径高亮/光点/连线配色）、node-palette.tsx（左侧面板）、canvas-chrome.tsx（工具条/缩略图/状态栏）。
//   disposeCanvasNode / EdgeKeyEditPayload 对外符号从本模块原样再导出（FlowPanel 导入路径不变）。
//
// 数据映射：RFNode/RFEdge ↔ FlowGram WorkflowJSON
//   node: { id, type, position:{x,y}, data }  ↔  { id, type, meta:{position:{x,y}}, data }
//   edge: { id, source, target, sourceHandle:'t'|'f' }  ↔  { sourceNodeID, targetNodeID, sourcePortID:'true'|'false' }

import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import 'reflect-metadata';
import {
  EditorRenderer,
  FreeLayoutEditorProvider,
  LineType,
  useClientContext,
} from '@flowgram.ai/free-layout-editor';
import { MinimapRender, createMinimapPlugin } from '@flowgram.ai/minimap-plugin';
import { createFreeSnapPlugin } from '@flowgram.ai/free-snap-plugin';
import { createFreeNodePanelPlugin } from '@flowgram.ai/free-node-panel-plugin';
// 分支键显形（2026-10-03 用户需求 B）：连线上打分支标签 + true 绿/false 红。
// free-lines-plugin 是 free-layout-editor 的传递依赖；createFreeLinesPlugin 声明了 singleton:true，
// 而核心 loadPlugins 用 reduceRight 收集单例（列表越靠后越优先）→ 我们这份实例会取代预设里的空实例。
import { createFreeLinesPlugin } from '@flowgram.ai/free-lines-plugin';
import '@flowgram.ai/free-layout-editor/index.css';
import './fg.css';
import './fg-overlays.css'; // 第二段（快选/问题面板/分支显形/chips/拖拽）：紧邻上一条，<style> 顺序 = 拆分前段落顺序
import type { RFNode, RFEdge } from '../util/flowDef';
import { DSH_NODE_REGISTRIES } from './nodes';
// ★ 画布缩放策略（进画布默认缩放 / 适应画布夹取 / 一键放大缩小档位）——纯函数，离线可测
import { pickInitialZoom, ensureVisibleShift } from '../viewZoom';
import { runStatusStore, selectionStore } from './runStatus';
import { WorkflowLinesManager, WorkflowDocument } from '@flowgram.ai/free-layout-editor';
import {
  centerOn,
  fromFG,
  graphRef,
  lastEmittedSig,
  nodeBounds,
  onChangeRef,
  onNodeDoubleClickRef,
  onSelectRef,
  rawFitZoom,
  readCfg,
  structSigOf,
  toFG,
  viewportOf,
  worldBounds,
  type EdgeKeyEditPayload,
} from './canvas-utils';
import { CanvasInteractions, DefaultNodeWrapper, NodeQuickPanel, onDragLineEnd, disposeCanvasNode } from './node-shell';
import { computeProblems, ProblemPanel } from './problems';
import { adoptChipCaseForNewLines, BranchKeyEditor } from './branch-editor';
import { LineInside, linePropsFor, RunPathSync } from './run-path';
import { NodePalette } from './node-palette';
import { Minimap, StatusBar, Toolbar } from './canvas-chrome';

// 对外符号保持不变（FlowPanel 从本模块导入 disposeCanvasNode；EdgeKeyEditPayload 历史导出位）
export { disposeCanvasNode };
export type { EdgeKeyEditPayload };

// ================= 编辑器 props =================

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
      // 连线分支标签 + 分支线配色 + 运行路径高亮（覆盖预设里的空实例，见文件头 import 处说明）
      //   renderInsideLine 上挂两件东西：分支键标签 + 「正在走」的光点（CometDots）
      createFreeLinesPlugin({ renderInsideLine: LineInside, customLineProps: linePropsFor }),
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

// ================= 主组件 =================

export function Canvas(props: {
  def?: unknown;
  nodes: RFNode[];
  edges: RFEdge[];
  activeEdges?: Set<string>;
  /** 其中"两端都成功"的边＝已走通（常亮绿）；差集＝正在走（绿 + 光点跑）。见 RunPathSync 头注释 */
  doneEdges?: Set<string>;
  /** 运行是否仍在进行（false ⇒ 没走完的边只留静态绿、光点停）。见 RunPathSync 头注释 */
  runActive?: boolean;
  onChange: (nodes: RFNode[], edges: RFEdge[]) => void;
  /** ★ null = 点空白取消选中（onSelectRef 桥同款契约；renderBody/p.onSelectNode 本来就是 string|null） */
  onSelectNode: (id: string | null) => void;
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

  // 选中节点 → 外置 store（外部视图发起的选中在画布上高亮）
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
      createElement(RunPathSync, { edges, activeEdges: props.activeEdges, doneEdges: props.doneEdges, runActive: props.runActive }),
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
