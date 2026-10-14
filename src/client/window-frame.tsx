// src/client/window-frame.tsx — 窗口化面板（legacy，2026-10-01 起默认停靠模式，入口不再调用；保留作为备用形态）
// 标题栏可拖拽 + 最小化/最大化/还原 + 关闭清缓存；面板内容由 panel-mount.tsx 的 mountWorkflowPanel 承载。
// 2026-10-14 阶段四自 index.tsx 纯搬运拆出；原来藏在 mountWorkflowPanel 里的 onClose=closeWin 兜底
// 改为这里两处调用点显式传入（消除 panel-mount ← window-frame 的循环依赖，真实路径行为不变）。

import type { WorkflowDef } from './types';
import { mountWorkflowPanel, unmount, WF_CACHE_KEY } from './panel-mount';

// ==================== 窗口化面板（legacy，2026-10-01 起默认停靠模式，入口不再调用） ====================

interface WinState {
  el: HTMLElement;
  titleBar: HTMLElement;
  body: HTMLElement;
  mode: 'normal' | 'max' | 'min';
  pos: { x: number; y: number };
  size: { w: number; h: number };
}
let win: WinState | null = null;

function clearCache(): void {
  try { localStorage.removeItem(WF_CACHE_KEY); } catch { /* 忽略 */ }
}

function makeWinBtn(text: string, title: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `dsh-wf-win-btn${cls ? ' ' + cls : ''}`;
  b.textContent = text;
  b.title = title;
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

function applyWinLayout(): void {
  if (!win) return;
  const { el, body, mode, pos, size } = win;
  if (mode === 'min') {
    // 最小化：左下角小标签，只留标题栏
    el.style.cssText = 'position:fixed;left:16px;bottom:16px;width:220px;height:38px;z-index:9999;min-width:0;min-height:0;';
    body.style.display = 'none';
    el.classList.add('dsh-wf-win-min');
  } else if (mode === 'max') {
    el.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:9999;';
    body.style.display = 'flex';
    el.classList.remove('dsh-wf-win-min');
  } else {
    el.style.cssText = `position:fixed;left:${pos.x}px;top:${pos.y}px;width:${size.w}px;height:${size.h}px;z-index:9999;`;
    body.style.display = 'flex';
    el.classList.remove('dsh-wf-win-min');
  }
}

function minimizeWin(): void { if (win) { win.mode = 'min'; applyWinLayout(); } }
function toggleMaxWin(): void {
  if (!win) return;
  win.mode = win.mode === 'max' ? 'normal' : 'max';
  applyWinLayout();
}
function restoreFromMin(): void { if (win && win.mode === 'min') { win.mode = 'normal'; applyWinLayout(); } }

function closeWin(): void {
  if (!win) return;
  // 关闭面板即清空未保存数据（重新打开需重新做工作流再保存）
  clearCache();
  unmount();
  win.el.remove();
  win = null;
}

function openWorkflowWindow(initialDef?: WorkflowDef): void {
  // 已打开 → 恢复（最小化时回到正常）；若带 initialDef 则切换面板内容为新工作流
  if (win) {
    if (win.mode === 'min') restoreFromMin();
    win.el.style.zIndex = '9999';
    if (initialDef) mountWorkflowPanel(win.body, { workflow: initialDef, onClose: closeWin });
    return;
  }
  const el = document.createElement('div');
  el.id = 'dag-flow-win';
  el.className = 'dsh-wf-win';

  // 标题栏（可拖拽）
  const titleBar = document.createElement('div');
  titleBar.className = 'dsh-wf-win-titlebar';
  const title = document.createElement('span');
  title.className = 'dsh-wf-win-title';
  title.textContent = '⚡ 自定义工作流';
  const btns = document.createElement('div');
  btns.className = 'dsh-wf-win-btns';
  btns.appendChild(makeWinBtn('—', '最小化', minimizeWin));
  btns.appendChild(makeWinBtn('▢', '最大化 / 还原', toggleMaxWin));
  btns.appendChild(makeWinBtn('✕', '关闭（清缓存）', closeWin, 'dsh-wf-win-btn-close'));
  titleBar.appendChild(title);
  titleBar.appendChild(btns);

  // 内容区（React 挂载 FlowPanel）
  const body = document.createElement('div');
  body.className = 'dsh-wf-win-body';

  el.appendChild(titleBar);
  el.appendChild(body);
  document.body.appendChild(el);

  // 中等大小：居中 780×560
  const W = Math.min(780, window.innerWidth - 60);
  const H = Math.min(560, window.innerHeight - 80);
  win = {
    el, titleBar, body,
    mode: 'normal',
    pos: { x: Math.max(8, Math.round((window.innerWidth - W) / 2)), y: Math.max(8, Math.round((window.innerHeight - H) / 2)) },
    size: { w: W, h: H },
  };
  applyWinLayout();

  // 标题栏拖拽移动
  let dragging = false;
  let offX = 0; let offY = 0;
  titleBar.addEventListener('mousedown', (e: MouseEvent) => {
    if (win!.mode === 'max' || win!.mode === 'min') return;
    dragging = true;
    offX = e.clientX - win!.pos.x;
    offY = e.clientY - win!.pos.y;
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (!dragging || !win || win.mode !== 'normal') return;
    win.pos.x = Math.max(0, e.clientX - offX);
    win.pos.y = Math.max(0, e.clientY - offY);
    applyWinLayout();
  });
  window.addEventListener('mouseup', () => { dragging = false; });
  // 双击标题栏最大化
  titleBar.addEventListener('dblclick', (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.dsh-wf-win-btns')) return;
    toggleMaxWin();
  });

  // 挂载 FlowPanel（带 initialDef = 从弹窗选定的/新建的工作流；无则用默认工作流）
  mountWorkflowPanel(body, { workflow: initialDef, onClose: closeWin });
}

