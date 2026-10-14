// src/client/dock.tsx — 停靠模式（2026-10-01）：画布进驻 DSH 中央面板（main keyed slot）
// 依据 live Slots 树：注册 key='dag-flow' 的面板，点击侧栏入口（sidebar.ts 自愈注入）即在会话区域展示画布；
// 槽位注册/面板切换的 DSH 形状假设全在 src/client/dsh-gate.ts（客户端防腐层）。
// 2026-10-14 阶段四自 index.tsx 纯搬运拆出；apply 所需的三个入口收成 setDockHost/openDockedCanvas/wireDockOpenRequest。

import { Component, createElement, useEffect, useRef, useSyncExternalStore } from 'react';
import { DEFAULT_WORKFLOW, type WorkflowDef } from './types';
import { openWorkflowPicker } from './workflow-picker';
// 子工作流导航（2026-10-03 用户需求）：栈/守卫在 navStack.ts，与 CDP 夹具共用同一份逻辑
import { bindNavSwap, backToParentWorkflow, enterSubWorkflow, navCrumbs, navCurrentName, navFocusNodeId, setNavCurrent } from './navStack';
import {
  selectPanel as gateSelectPanel,
  type ClientHost,
} from './dsh-gate';
import { mountWorkflowPanel, unmount, WF_CACHE_KEY } from './panel-mount';

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
/** 从子工作流返回父工作流时要重新选中的节点（navStack 通过 bindNavSwap 回传） */
let dockFocusNodeId: string | null = null;
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

// ================= 子工作流导航（2026-10-03 用户需求）=================
// 需求原话：「如果选择了要执行的子工作流，那么双击 loop 循环节点可以直接跳到子工作流里面，
//          子工作流也可以一键切回到父工作流的循环节点」→ 用户拍板返回入口用「header 返回胶囊 + 面包屑」，
//          适用范围 loop（循环体）+ subflow（引用的子工作流）。
// 栈与守卫在 src/client/navStack.ts（与 CDP 夹具共用同一份真实逻辑）；这里只提供「换 def」能力：
// 停靠面板 bump 版本号重挂载 FlowPanel（与「打开已有工作流」同一条通路）。
bindNavSwap((def, focus) => {
  dockFocusNodeId = focus;
  setDockDef(def, true);
});

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

/** 应用内浮窗提示（用于面板外的宿主级操作，例如「打开文件夹」失败）——
 *  与 FlowPanel 的 toast **同一套观感与口径**：顶部 14vh 居中、`dsh-wf-toast` 类名（吃 styles.css 的入场动画）；
 *  **成功类 2.6s 自动消失、失败类常驻且点一下关闭**。
 *  ★ 2026-10-11：用它替换了原来的原生 `alert`（用户准则：禁止系统原生弹窗）。 */
function showToast(text: string, ok = false): void {
  try {
    const el = document.createElement('div');
    el.className = 'dsh-wf-toast';
    el.title = '点击关闭';
    el.textContent = (ok ? '✓ ' : '✗ ') + text;
    const accent = ok ? 'var(--wf-success, #34d399)' : 'var(--wf-danger, #f87171)';
    el.setAttribute('style', [
      'position:fixed', 'top:14vh', 'left:50%', 'transform:translateX(-50%)', 'z-index:10001',
      'background:var(--wf-panel, #101a2b)',
      `border:1px solid ${accent}`,
      'border-radius:8px', 'padding:6px 14px', 'font-size:12px', 'line-height:1.5',
      `color:${accent}`, 'cursor:pointer', 'max-width:min(560px, 88vw)', 'word-break:break-word',
    ].join(';'));
    el.addEventListener('click', () => { el.remove(); });
    document.body.appendChild(el);
    if (ok) setTimeout(() => { el.remove(); }, 2600);   // 失败类不自动消失（错误不该被吞掉）
  } catch { /* 提示失败不影响功能 */ }
}

/** main 区的停靠面板：头部工具行 + 独立 React root 承载 FlowPanel。
 *  ★ 与 legacy 窗口模式同款挂载方式（createRoot 独立挂载，真机验证过）——
 *  在宿主 React 树内直接渲染 FlowPanel/FlowGram 会触发打包内 TDZ 崩溃
 *  （Cannot access 'o' before initialization，2026-10-01 真机实测）；
 *  dockVersion 变化时重挂以切换工作流。 */
export function DockedMainPanel(): any {
  const bodyRef = useRef(null);
  useSyncExternalStore(subscribeDock, () => dockVersion);
  useEffect(() => {
    if (!bodyRef.current) return;
    const def = dockDef ?? readCacheDef() ?? DEFAULT_WORKFLOW;
    console.log('[dag-flow] dock mount v' + dockVersion, 'def=' + (def?.name ?? '(null)'));
    mountWorkflowPanel(bodyRef.current, {
      workflow: def,
      onCache: (d: WorkflowDef) => {
        setNavCurrent(d);              // 让导航栈知道当前 def（进入子工作流时要压「父 def 快照」）
        setDockDef(d, false);
      },
      onClose: () => backToConversation(),
      // 子工作流导航（loop 循环体 / subflow 目标）：进入 + 一键返回父工作流的来源节点
      nav: {
        crumbs: navCrumbs(),           // 从外到内的父链（不含当前）
        current: navCurrentName() || def.name || '',
        enter: enterSubWorkflow,
        back: backToParentWorkflow,
      },
      // 返回父工作流时要重新选中的节点（来源循环节点）；进入子工作流时为 null
      focusNodeId: navFocusNodeId(),
    });
    return () => { unmount(); };
  }, [dockVersion]);
  return createElement('div', { className: 'dsh-wf-dock' },
    createElement('div', { className: 'dsh-wf-dock-head' },
      createElement('span', { className: 'dsh-wf-dock-title' }, '⚡ 自定义工作流'),
      createElement('span', { className: 'dsh-wf-dock-sub' }, '停靠在会话区域 · 数据落 <DSH_HOME>/.dag-flow/'),
      createElement('div', { className: 'dsh-wf-dock-actions' },
        createElement('button', {
          className: 'dsh-wf-dock-btn', type: 'button',
          onClick: () => {
            // 打开工作流数据文件夹（<DSH_HOME>/.dag-flow/，系统文件管理器；2026-10-11 起与工作区无关）
            fetch('/api/dag-flow/open-folder', { method: 'POST', credentials: 'include' })
              .then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`); })
              // ★ 2026-10-11：失败提示由原生 alert 改为**应用内浮窗**（用户准则：禁止系统原生弹窗）
              .catch((e) => { console.error('[dag-flow] open folder failed:', e); showToast('打开文件夹失败：' + (e as Error).message); });
          },
          title: '打开工作流数据文件夹（<DSH_HOME>/.dag-flow/）',
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

// —— apply() 编排入口（2026-10-14 阶段四收口：host 上下文与「打开/新建」接线归停靠模块所有）——
/** 记录宿主上下文（apply 传入；backToConversation 与「打开/新建」切换都要用它调 selectPanel） */
export function setDockHost(ctx: ClientHost): void {
  hostCtx = ctx ?? null;
}
/** 侧栏入口回调：带缓存/默认工作流进入停靠画布并切 main 槽位 */
export function openDockedCanvas(): void {
  setDockDef(dockDef ?? readCacheDef() ?? DEFAULT_WORKFLOW, true);
  gateSelectPanel(hostCtx, 'dag-flow');
}
/** 「➕ 打开 / 新建」接线：选择/新建工作流 → 换 def 并切到停靠画布 */
export function wireDockOpenRequest(): void {
  dockOpenRequest = () => openWorkflowPicker((def) => {
    setDockDef(def, true);
    gateSelectPanel(hostCtx, 'dag-flow');
  });
}

