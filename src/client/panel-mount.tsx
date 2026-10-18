// src/client/panel-mount.tsx — FlowPanel 挂载/卸载核心 + def 缓存键（window-frame 与 dock 的公共底层）
// 独立 React root 承载 FlowPanel（宿主 React 树内直接渲染 FlowGram 会触发打包内 TDZ 崩溃，2026-10-01 真机实测）。
// 2026-10-14 阶段四自 index.tsx 纯搬运拆出（onClose 兜底改由调用方显式传入，见 window-frame.tsx）。

import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FlowPanel } from './FlowPanel';
import { DEFAULT_WORKFLOW, type WorkflowDef } from './types';
// 首屏里程碑（诊断，只写 window.__df_firstPaint，不参与业务；见 perf-marks.ts 头注释）
import { fpReset } from './perf-marks';

let activeRoot: Root | null = null;
let activeEl: HTMLElement | null = null;

// 缓存键：停靠模式的「内容缓存」（切换回会话保留，重开继续编辑）
export const WF_CACHE_KEY = 'dag-flow:def-cache';

export function mountWorkflowPanel(target: HTMLElement, opts: any = {}): void {
  fpReset();   // 首屏计时起点（停靠/窗口两种模式都经过这里 ⇒ 一次覆盖）
  if (activeRoot) unmount();
  activeEl = target;
  activeRoot = createRoot(target);
  // 兜底：opts 为空对象时注入默认工作流，避免 FlowPanel 白屏
  const ctx = { ...opts, workflow: opts.workflow ?? DEFAULT_WORKFLOW };
  activeRoot.render(
    createElement(FlowPanel, {
      ctx,
      onMount: () => {},
      onClose: opts.onClose,
      onCache: opts.onCache,
      // ★ 2026-10-15：上面栏的占位容器（停靠模式传入）——FlowPanel 用它把「工作流名 + 保存状态」portal 上去
      chromeSlot: opts.chromeSlot ?? null,
    })
  );
}

export function unmount(): void {
  const el = activeEl;
  const root = activeRoot;
  activeRoot = null;
  activeEl = null;
  if (!root) return;
  try {
    root.unmount();
  } catch (e) {
    // ★ 2026-10-19（用户报 removeChild NotFoundError）：**正常路径不再手动 `innerHTML = ''`**。
    //   React 的 `root.unmount()` 会自己清空容器；抢在它之前/之后强行清空，会和 FlowGram 在
    //   requestAnimationFrame 里做的**延迟 DOM 清理**打架 —— 宿主那边就表现为
    //   `Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node`。
    //   只有卸载真的抛异常（容器可能残留）时才兜底清一次。
    try { if (el) el.innerHTML = ''; } catch { /* 忽略 */ }
    console.warn('[dag-flow] panel unmount failed:', e);
  }
}

