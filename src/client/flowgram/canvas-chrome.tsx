// src/client/flowgram/canvas-chrome.tsx — 画布周边 UI：工具条（撤销/重做/整理/适应/缩放）+ 缩略图 + 状态栏
// Toolbar 一键缩放走配置实体（usePlaygroundTools 只有 zoomin/zoomout）；Minimap 八向等比缩放 + 最小化 + 右侧避让；
// StatusBar 实时节点/连线/问题数（点击联动问题面板）。
// 2026-10-14 重构轮 5 自 FlowGramCanvas.tsx 纯搬运拆出。

import { createElement, useEffect, useState } from 'react';
import {
  useClientContext,
  usePlaygroundTools,
} from '@flowgram.ai/free-layout-editor';
import { MinimapRender } from '@flowgram.ai/minimap-plugin';
import { FIT_MIN_ZOOM, nextZoomStep, fitZoomClamped } from '../viewZoom';
import { readStoredWidth } from '../util/edge-drag';
import { centerOn, rawFitZoom, readCfg, worldBounds } from './canvas-utils';
// ★ 2026-10-16 用户拍板方案 B：撤销/重做改走**自建快照栈**（FlowGram 自带 history 在本项目永远是空的，
//   原因见 src/client/undo-stack.ts 头注释：位移走自建拖拽引擎绕过 operationService，且每次
//   def→fromJSON 都触发 onReload→historyService.clear()）
import { undo, redo, undoCan, redoCan, subscribeUndo } from '../undo-stack';

// ================= 工具条（撤销/重做/整理/适应/缩放） =================

export function Toolbar(props: { problemCount?: number; showProblems?: boolean; onToggleProblems?: () => void }) {
  const ctx = useClientContext();
  const tools = usePlaygroundTools();
  // ★ 2026-10-16 用户报「画布上的撤销和重做按钮好像被改坏了…没反应了」⇒ 排查定性：**不是本轮改动**
  //   造成的，而是这两个按钮从 FlowGram 迁移起就没接线 —— 原先读 `ctx.history.canUndo()`，但那个栈
  //   永远为空：①节点位移走自建拖拽引擎（直接改 transform），绕过 `operationService.onNodePostionUpdate`
  //   （free-history-plugin 只在那里记 `dragNodes`）；②每次 def→fromJSON 都触发 `onReload→historyService.clear()`。
  //   ⇒ 按钮恒为灰。现改读**自建快照栈**（方案 B，用户拍板），覆盖位移/参数/增删节点连线。
  const [canUndo, setCanUndo] = useState(() => undoCan());
  const [canRedo, setCanRedo] = useState(() => redoCan());
  useEffect(() => subscribeUndo(() => {
    setCanUndo(undoCan());
    setCanRedo(redoCan());
  }), []);
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
    btn('↶', '撤销（Ctrl+Z）', () => { undo(); }, !canUndo),
    btn('↷', '重做（Ctrl+Shift+Z）', () => { redo(); }, !canRedo),
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

// ================= minimap（2026-10-01 夜：避让右面板 + 最小化 + 八向缩放） =================

const MINIMAP_BASE_W = 168;
const MINIMAP_BASE_H = 100;

export function Minimap(props: { rightInset: number }) {
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

export function StatusBar(props: { nodeCount: number; edgeCount: number; problemCount: number; onShowProblems: () => void }) {
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
