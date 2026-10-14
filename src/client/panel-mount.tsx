// src/client/panel-mount.tsx — FlowPanel 挂载/卸载核心 + def 缓存键（window-frame 与 dock 的公共底层）
// 独立 React root 承载 FlowPanel（宿主 React 树内直接渲染 FlowGram 会触发打包内 TDZ 崩溃，2026-10-01 真机实测）。
// 2026-10-14 阶段四自 index.tsx 纯搬运拆出（onClose 兜底改由调用方显式传入，见 window-frame.tsx）。

import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FlowPanel } from './FlowPanel';
import { DEFAULT_WORKFLOW, type WorkflowDef } from './types';

let activeRoot: Root | null = null;
let activeEl: HTMLElement | null = null;

// 缓存键：停靠模式的「内容缓存」（切换回会话保留，重开继续编辑）
export const WF_CACHE_KEY = 'dag-flow:def-cache';

export function mountWorkflowPanel(target: HTMLElement, opts: any = {}): void {
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
    })
  );
}

export function unmount(): void {
  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
  }
  if (activeEl) {
    activeEl.innerHTML = '';
    activeEl = null;
  }
}

