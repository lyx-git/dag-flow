// @ts-nocheck
// src/client/index.tsx
// DSH 客户端入口：暴露 apply(ctx)。
//
// bundle 协议：window.__ModuleLoader__.load({ id, factory: (require) => ... })
// factory 返回 module.exports，DSH loader 自动调 module.exports.apply(ctx)。
// （协议 banner/footer 在 scripts/build-client.mjs——客户端防腐点清单见 src/client/dsh-gate.ts）
//
// v20261003-picker-path：「打开/新建工作流」下拉里，每个工作流名称后置灰显示它的落盘路径
//   （GET /workflows 每项新增 path 字段；路径跟随目录分隔符、单行省略、完整值放 title；
//    复制出的新行也按 storage.dir 推算路径）。
// v20261003-manual-confirm：manual（手动确认）节点从 v0.1 空壳改为真暂停 + 恢复——
//   POST /run 撞上 manual → 202 { status:'awaiting', runId, awaiting }（不 hold 连接），
//   客户端头部 ⏸ 徽标 + 确认弹窗（底部左「✕ 取消本次运行」右「✓ 确认并继续」，右上 ✕ 只关弹窗），
//   备注经 POST /run/resume 进入 out.value 供下游 {{节点id.out.value}} 取用；
//   GET /run/status 支持刷新后恢复等待态；非交互路径（CLI 工具/subflow 内部）自动通过 + warning。
// v20261002-next-map：分支键 next（if 的 {true,false} / switch 的 { case值: 目标 }）收编为
//   WORKFLOW_SCHEMA.next.oneOf 的单个 object 分支——原来 host schema 只认 {true,false}，
//   画布 fromRF 每次保存都在产 case 映射 → 保存过的 switch 工作流全部报「结构校验未通过」。
//   客户端 JsonView 的精简 schema 同步对齐；校验报错折叠成一条并带「显示名_id(类型)」。
// v20261002-acl1：slots/layout 宿主形状假设收编 src/client/dsh-gate.ts（客户端防腐层）——
//   DSH 客户端升版改 slots/layout API 时只改那边；本文件只做业务编排。
//   之前版本在这里吃过的亏：inject 了宿主没有的服务 → 抛错被 mountContribution
//   路径 catch 不住 → 整个插件静默失败（v0.3→v0.4 教训，已固化为防腐层探测）。

import { Component, createElement, useEffect, useRef, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FlowPanel } from './FlowPanel';
import { SettingsPage } from './SettingsPage';
import { DEFAULT_WORKFLOW, type WorkflowDef } from './types';
import { applyTheme, getThemeMode } from './theme';
import { mountSidebarEntry } from './sidebar';
import { openWorkflowPicker } from './workflow-picker';
import {
  CLIENT_INJECT,
  registerSettingsSection,
  registerMainPanel,
  dumpMainPanelKeys,
  selectPanel as gateSelectPanel,
  type ClientHost,
} from './dsh-gate';
import './styles.css'; // ★ 注入插件独立主题样式（esbuild dsh-css-inject 转运行时 <style>）

let activeRoot: Root | null = null;
let activeEl: HTMLElement | null = null;

// ==================== 窗口化面板（legacy，2026-10-01 起默认停靠模式，入口不再调用） ====================
// 缓存键：停靠模式的「内容缓存」（切换回会话保留，重开继续编辑）
const WF_CACHE_KEY = 'dag-flow:def-cache';

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
    if (initialDef) mountWorkflowPanel(win.body, { workflow: initialDef });
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
  mountWorkflowPanel(body, { workflow: initialDef });
}

function mountWorkflowPanel(target: HTMLElement, opts: any = {}): void {
  if (activeRoot) unmount();
  activeEl = target;
  activeRoot = createRoot(target);
  // 兜底：opts 为空对象时注入默认工作流，避免 FlowPanel 白屏
  const ctx = { ...opts, workflow: opts.workflow ?? DEFAULT_WORKFLOW };
  activeRoot.render(
    createElement(FlowPanel, {
      ctx,
      onMount: () => {},
      onClose: opts.onClose ?? (() => closeWin()),
      onCache: opts.onCache,
    })
  );
}

function unmount(): void {
  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
  }
  if (activeEl) {
    activeEl.innerHTML = '';
    activeEl = null;
  }
}

// inject 名单唯一来源 = 客户端防腐层（slots=设置页分区/主区面板；layout=面板切换）
export const inject: string[] = CLIENT_INJECT;

// ==================== 停靠模式（2026-10-01）：画布进驻 DSH 中央面板 ====================
// 依据 live Slots 树：`main` 是 keyed slot（"Central panel selected by sidebar entry id"，
// 已占用 key: conversation，开放域可注册新 key）——注册 key='dag-flow' 的面板，点击
// 侧栏入口（sidebar.ts 自愈注入）即在会话区域位置展示画布。槽位注册/面板切换的
// DSH 形状假设全在 src/client/dsh-gate.ts（客户端防腐层）。

let hostCtx: ClientHost = null;
let dockOpenRequest: (() => void) | null = null;

// 停靠画布的 def 外置存储：FlowPanel onCache 静默同步（不触发重挂，保住内部编辑态）；
// 选择/新建/入口点击时 bump 版本号，让 DockedMainPanel 以新 def 重挂载。
let dockDef: WorkflowDef | null = null;
let dockVersion = 0;
const dockListeners = new Set<() => void>();

function readCacheDef(): WorkflowDef | null {
  try {
    const raw = localStorage.getItem(WF_CACHE_KEY);
    return raw ? (JSON.parse(raw) as WorkflowDef) : null;
  } catch { return null; }
}

function setDockDef(def: WorkflowDef, bump: boolean): void {
  dockDef = def;
  try { localStorage.setItem(WF_CACHE_KEY, JSON.stringify(def)); } catch { /* 忽略 */ }
  if (bump) { dockVersion++; dockListeners.forEach((l) => l()); }
}

function subscribeDock(listener: () => void): () => void {
  dockListeners.add(listener);
  return () => { dockListeners.delete(listener); };
}

/** 回到会话面板（防腐层 selectPanel；layout 不可用时静默）。 */
function backToConversation(): void {
  gateSelectPanel(hostCtx, 'conversation');
}

/** 渲染错误的可视化边界：停靠面板出错时显示错误详情而非空白（方便真机排障） */
class DockErrorBoundary extends Component<{ children: any }, { error: Error | null }> {
  constructor(props: any) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: unknown) {
    console.error('[dag-flow] dock render error:', error, info);
  }
  render() {
    if (this.state.error) {
      return createElement('div', { style: { padding: 20, color: '#f87171', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 } },
        createElement('div', null, `停靠面板渲染失败：${String(this.state.error?.message ?? this.state.error)}`),
        createElement('pre', { style: { whiteSpace: 'pre-wrap', fontSize: 11, marginTop: 10 } }, String(this.state.error?.stack ?? '')),
      );
    }
    return this.props.children;
  }
}

/** main 区的停靠面板：头部工具行 + 独立 React root 承载 FlowPanel。
 *  ★ 与 legacy 窗口模式同款挂载方式（createRoot 独立挂载，真机验证过）——
 *  在宿主 React 树内直接渲染 FlowPanel/FlowGram 会触发打包内 TDZ 崩溃
 *  （Cannot access 'o' before initialization，2026-10-01 真机实测）；
 *  dockVersion 变化时重挂以切换工作流。 */
function DockedMainPanel(): any {
  const bodyRef = useRef(null);
  useSyncExternalStore(subscribeDock, () => dockVersion);
  useEffect(() => {
    if (!bodyRef.current) return;
    const def = dockDef ?? readCacheDef() ?? DEFAULT_WORKFLOW;
    console.log('[dag-flow] dock mount v' + dockVersion, 'def=' + (def?.name ?? '(null)'));
    mountWorkflowPanel(bodyRef.current, {
      workflow: def,
      onCache: (d: WorkflowDef) => setDockDef(d, false),
      onClose: () => backToConversation(),
    });
    return () => { unmount(); };
  }, [dockVersion]);
  return createElement('div', { className: 'dsh-wf-dock' },
    createElement('div', { className: 'dsh-wf-dock-head' },
      createElement('span', { className: 'dsh-wf-dock-title' }, '⚡ 自定义工作流'),
      createElement('span', { className: 'dsh-wf-dock-sub' }, '停靠在会话区域 · 数据落 <工作区>/.dag-flow/'),
      createElement('div', { className: 'dsh-wf-dock-actions' },
        createElement('button', {
          className: 'dsh-wf-dock-btn', type: 'button',
          onClick: () => {
            // 打开当前工作区的工作流数据文件夹（<工作区>/.dag-flow/，系统文件管理器）
            fetch('/api/dag-flow/open-folder', { method: 'POST', credentials: 'include' })
              .then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`); })
              .catch((e) => { console.error('[dag-flow] open folder failed:', e); alert('打开文件夹失败：' + (e as Error).message); });
          },
          title: '打开工作流数据文件夹（<工作区>/.dag-flow/）',
        }, '📁 工作流文件夹'),
        createElement('button', {
          className: 'dsh-wf-dock-btn', type: 'button',
          onClick: () => dockOpenRequest?.(), title: '选择历史工作流或新建',
        }, '➕ 打开 / 新建'),
        createElement('button', {
          className: 'dsh-wf-dock-btn dsh-wf-dock-btn-primary', type: 'button',
          onClick: () => backToConversation(), title: '回到会话（画布内容保留，可随时回来）',
        }, '返回会话'),
      ),
    ),
    createElement('div', { className: 'dsh-wf-dock-body', ref: bodyRef }),
  );
}

export function apply(ctx: any): void {
  // 初始化主题（从 localStorage 恢复 data-wf-theme，默认跟随 DSH）
  try { applyTheme(getThemeMode()); } catch { /* 忽略 */ }
  // 顶层 try/catch：任何 inject 失败不影响其它
  try {
    hostCtx = ctx ?? null;

    // 1. settings.section — 设置页"工作流配置"分区（形状假设/容错在防腐层）
    registerSettingsSection(ctx, { id: 'dag-flow.settings', order: 80, label: '工作流配置' }, SettingsPage);

    // 2. 侧栏入口（左上方"新会话"按钮下方）：点击 = 直接切到主区域停靠画布
    //    （与"新会话"切到会话面板同款交互，不弹窗）。宿主 DOM 锚点/样式拷贝在 sidebar.ts（专职 DOM 防腐点）。
    try {
      mountSidebarEntry(() => {
        setDockDef(dockDef ?? readCacheDef() ?? DEFAULT_WORKFLOW, true);
        gateSelectPanel(hostCtx, 'dag-flow');
      });
    } catch (e) {
      console.warn('[dag-flow] sidebar entry mount failed:', e);
    }

    // 3. 主区域停靠面板（keyed main，与 conversation/plugins 同机制）。
    //    ★ generator + yield 注册形态与 selectPanel 的 key 校验假设都在防腐层
    //      （注册未生效时切换会抛 "main panel ... not registered"，2026-10-01 真机踩坑）。
    //    ★ 不注册 sidebar.panellist 行：入口按钮即切换，无需额外面板按钮（用户反馈）。
    if (!ctx?.layout || typeof ctx.layout.selectPanel !== 'function') {
      console.warn('[dag-flow] ctx.layout.selectPanel missing; dock switch disabled');
    }
    registerMainPanel(ctx, { key: 'dag-flow' }, DockedMainPanel);
    dumpMainPanelKeys(ctx, 'apply');
    setTimeout(() => dumpMainPanelKeys(ctx, 't+1.5s'), 1500);
    setTimeout(() => dumpMainPanelKeys(ctx, 't+5s'), 5000);

    // 选择/新建工作流 → 换 def 并切到停靠画布
    dockOpenRequest = () => openWorkflowPicker((def) => {
      setDockDef(def, true);
      gateSelectPanel(hostCtx, 'dag-flow');
    });

    // ★ bundle 版本标记：真机 DevTools 控制台可确认加载的是新构建（旧缓存 bundle 无此行）
    console.log('[dag-flow] client v20261003-picker-path · apply OK');
  } catch (e) {
    console.error('[dag-flow] client apply failed:', e);
  }
}

// 也保留 mount/unmount 给外部用
export { mountWorkflowPanel as mount, unmount };

// 默认导出 = { apply, inject, mount, unmount } —— DSH loader 看 .apply 自动调
export default { apply, inject, mount: mountWorkflowPanel, unmount };

// 辅助 re-export
export { FlowPanel } from './FlowPanel';
export { SettingsPage } from './SettingsPage';
export { NODE_PALETTE } from './types';
export type { WorkflowDef, MountContext } from './types';
