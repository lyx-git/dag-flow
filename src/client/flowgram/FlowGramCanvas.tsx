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
import { CanvasInteractions, DefaultNodeWrapper, NodeQuickPanel, nodeDragActive, onDragLineEnd, disposeCanvasNode } from './node-shell';
import { computeProblems, ProblemPanel } from './problems';
import { adoptChipCaseForNewLines, BranchKeyEditor } from './branch-editor';
import { LineInside, linePropsFor, RunPathSync } from './run-path';
import { NodePalette } from './node-palette';
import { Minimap, StatusBar, Toolbar } from './canvas-chrome';
// 首屏里程碑（诊断，只写 window.__df_firstPaint；读法见 perf-marks.ts 头注释）
import { fpInfo, fpMark } from '../perf-marks';

// 对外符号保持不变（FlowPanel 从本模块导入 disposeCanvasNode；EdgeKeyEditPayload 历史导出位）
export { disposeCanvasNode };
export type { EdgeKeyEditPayload };

// ================= 位置变化的上抛节流（2026-10-15：拖动卡顿修复「签名短路」）=================
// 背景（实测）：`onContentChange` 在**任何画布内容变化**时都会跑，里面无条件做
// 「整图 toJSON → fromFG → 全图签名 → 上抛 onChange」；上抛会让 FlowPanel `setDef` ⇒
// **整个面板整树重渲染**。拖节点时 transform 每帧变 ⇒ 这条链每帧跑：
// 实测一次拖动 = def 写回 **38~40 次**，而"按在空白没拖到节点" = **0 次**（天然对照）。
// 真机上每帧预算被序列化+签名+React 提交吃满 ⇒ 表现为拖动卡顿。
// 修法：`structSigOf` **刻意不含 position**（见 canvas-utils.ts）⇒ 签名与上次相同就说明"只有位置变了"，
// 这种情况**不再逐帧上抛**，改为「拖拽静止 180ms 后补写一次」+「mouseup 立即补写」（覆盖"拖完马上保存"）。
// ★ 行为变更（已单列上报）：拖动**过程中** def 不再逐帧更新；松手/静止后落盘一次，位置不丢。
let posFlushTimer: number | null = null;
/** 画布文档句柄类型：与 `fromFG` 的形参对齐（不引入 any） */
type PosDoc = { toJSON: () => Parameters<typeof fromFG>[0] };
let pendingPosCtx: { document: PosDoc } | null = null;
let boundPosFlush = false;

/** 把"只有位置变化"的那次同步真正落回 def（幂等；无待写则什么都不做） */
function flushPosition(): void {
  if (posFlushTimer != null) { window.clearTimeout(posFlushTimer); posFlushTimer = null; }
  const ctx = pendingPosCtx;
  pendingPosCtx = null;
  if (!ctx) return;
  try {
    const { nodes, edges } = fromFG(ctx.document.toJSON());
    lastEmittedSig.current = structSigOf(nodes, edges);
    onChangeRef.current?.(nodes, edges);
  } catch (e) {
    console.warn('[dag-flow] flush position failed:', e);
  }
}

/** 记下"待补写"并安排静止后补写（重复调用只刷新计时器，不叠加上抛） */
function schedulePositionFlush(ctx: { document: PosDoc }): void {
  pendingPosCtx = ctx;
  if (!boundPosFlush) {
    boundPosFlush = true;
    // capture：画布层有 stopPropagation，capture 阶段才稳
    window.addEventListener('mouseup', flushPosition, true);
  }
  if (posFlushTimer != null) window.clearTimeout(posFlushTimer);
  posFlushTimer = window.setTimeout(flushPosition, 180);
}

/** 画布是否还有"位置待补写"（拖动中 / 刚松手尚未落定）——
 *  撤销栈用它把**一次拖动只记一条历史**（否则中途的多次落定会各占一步，第一下撤销只退回拖动中途） */
export function hasPendingPosFlush(): boolean {
  return pendingPosCtx != null || posFlushTimer != null;
}

/** ★ 2026-10-19：首帧初始视图落定 → 揭开"切换工作流"的淡入遮罩（见 Canvas 的 veil 与 fg.css）。
 *  为什么用模块级变量而不是 props：`buildEditorProps` 是模块级函数、一个画布实例只构建一次，
 *  拿不到组件的 setState —— 与 onChangeRef / onSelectRef 是同一套桥接机制（回调由 Canvas 每次渲染刷新）。 */
let revealVeil: (() => void) | null = null;

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
    // ★ 2026-10-16：FlowGram 自带的 history 在本项目用不上（位移走自建拖拽引擎绕过
    //   operationService.onNodePostionUpdate；且每次 def→fromJSON 都触发 onReload→clear ⇒ 栈恒空）。
    //   撤销/重做已改走自建快照栈（src/client/undo-stack.ts）⇒ 这里**关掉它注册的 Ctrl+Z / Ctrl+Shift+Z
    //   快捷键**（否则与自建栈抢键），插件本身保留（`ctx.history` 仍可安全取用）。
    history: { enable: true, enableChangeNode: true, disableShortcuts: true },
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
        // ★ 2026-10-19 性能（画布体检 P2）：节点拖拽中**直接排程、不做序列化**。
        //   拖动时 transform 每帧变 ⇒ 本回调每帧都跑；原路径每帧要 `document.toJSON()`（FlowGram 全量
        //   序列化）→ `fromFG()`（全图重建对象）→ `structSigOf()`（含每节点 data 的 JSON.stringify），
        //   算完才发现"只有位置变了"再整份丢弃 —— 纯白算 + 大量临时对象（实测 GC 占拖动总耗时 10~22%）。
        //   现在：拖动中把 ctx 记下就返回，松手（window mouseup capture）或静止 180ms 后由 flushPosition
        //   **落盘一次**；flushPosition 上抛的是整份 def ⇒ 拖动期间的结构变化也不丢，只是延后到落定。
        //   CDP CPU profile A/B：拖动中主线程脚本 −15.6%（30 节点/95KB）、−13.9%（100 节点）。
        //   ★ `__df_legacySerialize` 只是给 tmp-test/cdp/perf-canvas-profile.mjs 做**同批 A/B 对照**用的诊断开关，
        //     真机永远是 undefined ⇒ 一律走新路径（早退）。
        if (nodeDragActive.current && !(window as any).__df_legacySerialize) { schedulePositionFlush(ctx); return; }
        // ★ switch 单点端口（2026-10-03 用户拍板 B）：先按节点上选中的 chip 给**刚画的**线定分支键
        adoptChipCaseForNewLines(ctx);
        const { nodes, edges } = fromFG(ctx.document.toJSON());
        const sig = structSigOf(nodes, edges);
        // ★ 2026-10-15 签名短路（拖动卡顿修复）：签名没变＝只有位置变了（structSigOf 刻意不含 position）
        //   ⇒ 不逐帧上抛（那会每帧一次 FlowPanel 整树重渲染），改为静止/松手后补写一次。
        if (sig === lastEmittedSig.current) { schedulePositionFlush(ctx); return; }
        lastEmittedSig.current = sig;
        onChangeRef.current?.(nodes, edges);
      } catch (e) {
        console.warn('[dag-flow] serialize failed:', e);
      }
    },
    onAllLayersRendered: (ctx: any) => {
      fpMark('layersRendered');   // 首屏里程碑：FlowGram 所有图层渲染完（节点 DOM 已全在）
      // 首次渲染：设一次**看得清**的初始视图（自适应但夹在 [75%,100%]）；
      // 之后**不再自动改视图** —— 用户自己缩放/拖动后不会被抢回去（这正是「适应画布」按钮以前没用的原因）。
      if (didInitView) return;
      const apply = (tryNo: number): void => {
        const cfg = readCfg(ctx);
        const W = cfg?.config?.width ?? 0;
        if (!W && tryNo < 8) { window.setTimeout(() => apply(tryNo + 1), 40); return; }   // 视口尺寸可能晚一帧就绪
        didInitView = true;
        fpMark('initialView');   // 首屏里程碑：初始视图算完并落位
        try {
          const doc = ctx.get(WorkflowDocument);
          const all: any[] = doc?.getAllNodes?.() ?? [];
          fpInfo({ nodes: all.length });
          const start = all.find((n: any) => String(n?.id) === 'start')
            ?? all.find((n: any) => String(n?.id ?? '').startsWith('start'));
          const raw = rawFitZoom(ctx);
          const zoom = pickInitialZoom(raw);
          // 居中目标 = 整图内容（与「适应画布」同源，取景与既有行为一致）；取不到内容才退回起始节点
          const box = worldBounds(ctx) ?? nodeBounds(start);
          // ★ 取景 C（2026-10-04 用户拍板）+ **一步落位**（2026-10-19 修「切换画布时闪」）：
          //   整图居中之后，若**入口节点**不在真正可见的区域内，要做一次**最少平移**把它带进来（缩放不变）。
          //   ★ 原先的顺序是「先 centerOn 整图 → 再 scrollToView 平移」＝**两次视图落定**，肉眼看到
          //   "先到位、再跳一下"。而 ensureVisibleShift 返回的 target 本就是那块安全视口区域的矩形，
          //   直接把它居中一次到位，**最终结果与"先居中再平移"完全一致**（原第二步就是把 target 居中），
          //   区别只是少了一次中间落位 ⇒ 画面不跳。
          let applied = false;
          let ensure: { shifted: boolean; dx: number; dy: number } = { shifted: false, dx: 0, dy: 0 };
          try {
            const startBox = nodeBounds(start);
            const { W: vw, H: vh } = viewportOf(cfg);
            let panelW = 0;
            try { panelW = Math.min(460, Math.max(0, document.querySelector('.dsh-wf-right')?.getBoundingClientRect().width ?? 0)); } catch { panelW = 0; }
            const shift = ensureVisibleShift({ graphBox: box, startBox, viewW: vw, viewH: vh, panelW, zoom });
            if (shift.shifted && shift.target && typeof cfg?.scrollToView === 'function') {
              cfg.scrollToView({ bounds: shift.target, zoom, easing: false, scrollToCenter: true });
              applied = true;
            } else {
              applied = centerOn(cfg, box, zoom);
            }
            ensure = { shifted: shift.shifted, dx: Math.round(shift.dx), dy: Math.round(shift.dy) };
          } catch {
            // 取景失败不影响画布：仍退回整图居中兜一次（与旧行为一致）
            try { applied = centerOn(cfg, box, zoom); } catch { applied = false; }
          }
          // 诊断钩子（CDP 验证用）
          (window as any).__df_initialView = { zoom, rawFit: Number.isFinite(raw) ? Number(raw.toFixed(4)) : null, startId: start?.id ?? null, box, applied, ensure, tryNo, at: Date.now() };
        } catch (e) {
          console.warn('[dag-flow] 初始视图设置失败:', e);
        } finally {
          // 初始视图已落定（或失败兜底）⇒ 揭开切换遮罩，让画布淡入（见 Canvas 的 veil 与 fg.css）
          revealVeil?.();
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
  // ★ 2026-10-19 性能（P4）：签名只在 nodes/edges **引用**变化时重算。
  //   原来直接在 render 体里调 structSigOf ⇒ 本组件随 Canvas 每次重渲染（点选节点 / 运行状态刷新 /
  //   开弹窗都会让 FlowPanel 重渲染）都白跑一遍 O(n) 全量签名（含每节点 data 的 JSON.stringify）。
  const sig = useMemo(() => structSigOf(props.nodes, props.edges), [props.nodes, props.edges]);
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

  /* ★ 2026-10-19 切换工作流时的淡入遮罩（用户：「切换画布的时候，为啥画布会闪啊，流程就像闪进来的」）：
     切换＝整个停靠面板重挂 ⇒ 画布从空到满是一次性"闪出来"。遮罩盖住这段空窗，
     初始视图落定后由 revealVeil() 淡出（fg.css 里 120ms transition）。
     ★ 500ms 兜底：万一 onAllLayersRendered 没来（异常/空图），也必须揭开 —— 遮罩永久盖住画布是红线。 */
  const [veil, setVeil] = useState(true);
  revealVeil = () => { fpMark('veilGone'); setVeil(false); };
  // 首屏里程碑：画布组件挂载（≈ FlowGram 编辑器容器已进 DOM）
  useEffect(() => { fpMark('canvasMount'); }, []);
  useEffect(() => {
    const t = window.setTimeout(() => setVeil(false), 500);
    return () => window.clearTimeout(t);
  }, []);

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
      // ★ 2026-10-16：Toolbar 不再收问题相关 props —— 上部那颗「⚠ 问题」按钮已按用户要求删掉
      //   （「上部有个问题面板和左下角校验是同一个东西，只保留左下角的校验就行」）⇒ 问题入口只剩
      //   左下角状态栏的「⚠ N 个问题（点击查看）」，见 canvas-chrome.tsx 的 StatusBar。
      createElement(Toolbar),
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
      // ★ 切换工作流的淡入遮罩（上方 veil state / fg.css / revealVeil）：
      //   必须是最后一个子元素，靠 z-index:30 盖在工具条・缩略图（20）与节点层之上。
      createElement('div', {
        key: 'veil',
        className: `dsh-wf-fg-veil${veil ? '' : ' out'}`,
        'aria-hidden': true,
      }),
    ),
  );
}
