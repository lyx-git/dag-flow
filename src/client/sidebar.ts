// @ts-nocheck
// src/client/sidebar.ts
// DSH 左侧栏入口（"新会话"按钮正下方）：自愈式 DOM 注入。
// ★ 2026-10-01 依据宿主权威样式对齐（@deepseek-ai/dsh-client-ui-sidebar
//   SidebarRoot.module.css，浏览器/展开态）：
//   .newSession{height:38px; margin:0 2px 12px; padding:8px 12px; font:14px/22px w500;
//     border:.5px solid var(--dsw-alias-border-l3); border-radius:var(--dsw-radius-md);
//     background:var(--dsw-alias-button-elevated-fill); display:flex;
//     justify-content:center; align-items:center}
//   .newSessionContent{display:flex; gap:6px}  ← icon-文字间距的真实来源
//   且「新会话」按钮是 root 的直接子元素（Tooltip 不包 wrapper），折叠态另有一组
//   36x36/透明背景规则。本文件不再猜测：观感逐项拷贝 computed style，宽度走
//   flex stretch（与宿主同构），margin/对齐/内容层间距按宿主规则写入。
// 定位/折叠逻辑对齐 dsh-node-flow 的同款实现（同 GUI 已验证）。

export const ENTRY_ATTR = 'data-dag-flow-entry';
const ENTRY_SELECTOR = `[${ENTRY_ATTR}]`;
const ENTRY_LABEL_ATTR = 'data-dag-flow-entry-label';
const ENTRY_ICON_ATTR = 'data-dag-flow-entry-icon';
/** 宿主「新会话」展开态 margin（同款节奏：上 0 / 左右 2px / 下 12px）。
 *  上方 12px 由「新会话」自身的 margin-bottom 提供，下方 12px 由本按钮
 *  margin-bottom 提供，与 panelList（无 margin-top）相接 → 上下间隔一致。 */
const HOST_MARGIN_EXPANDED = '0 2px 12px';
/** 宿主「新会话」折叠态 margin（.hHd-Xa_collapsed .newSession{margin:0 0 12px}） */
const HOST_MARGIN_COLLAPSED = '0 0 12px';
/** 宿主内容层 icon-文字间距（拷贝失败时的保底，正常从宿主 newSessionContent 读取） */
const FALLBACK_CONTENT_GAP = '6px';
const ENTRY_STYLE_ID = 'dag-flow-entry-style';

let entry: HTMLButtonElement | null = null;

/** 宿主按钮的内容层（class 为 CSS modules 哈希，但含 newSessionContent 字面子串） */
function hostContentOf(btn: HTMLButtonElement): HTMLElement | undefined {
  return btn.querySelector<HTMLElement>('[class*="newSessionContent"]') ?? undefined;
}

/** 折叠态的背景/边框透明不能写内联（展开时要还原），用一次性样式表 + !important 接管 */
function ensureInjectedStyles(): void {
  if (document.getElementById(ENTRY_STYLE_ID)) return;
  const tag = document.createElement('style');
  tag.id = ENTRY_STYLE_ID;
  tag.textContent =
    `${ENTRY_SELECTOR}[data-sidebar-collapsed="true"]{background:transparent!important;border-color:transparent!important}`;
  document.head.appendChild(tag);
}

/** 从参考按钮拷贝关键观感属性（背景/边框/圆角/字体/高度/内边距/内容排布）
 *  ★ 一律用 JS 驼峰直接赋值（style[p]=v）：CSSStyleDeclaration.setProperty() 只认
 *  短横线命名法，传驼峰会静默丢弃（复刻页实测 inline 全空）——旧实现的关键观感
 *  属性（背景/字体/圆角/行高）因此从未拷上，按钮观感长期不对的总根源。 */
function copyStyleFrom(btn: HTMLButtonElement, target: HTMLButtonElement): void {
  try {
    const cs = getComputedStyle(btn);
    const props = [
      'backgroundColor', 'color', 'fontSize',
      'fontWeight', 'fontFamily', 'boxShadow', 'height', 'lineHeight',
    ];
    for (const p of props) {
      const v = (cs as any)[p];
      if (v && v !== 'none' && v !== 'normal') (target.style as any)[p] = v;
    }
    // 内边距取参考按钮，但保底可读
    target.style.padding = cs.padding && cs.padding !== '0px' ? cs.padding : '8px 12px';
    target.style.boxSizing = 'border-box';
    target.style.border = cs.border && cs.borderStyle !== 'none' ? cs.border : 'none';
    target.style.background = cs.backgroundImage !== 'none' ? cs.background : cs.backgroundColor;
    if (cs.borderRadius && cs.borderRadius !== '0px') target.style.borderRadius = cs.borderRadius;
    // 内容排布对齐宿主：整体居中；icon-文字间距读宿主内容层的 gap
    //（宿主按钮本体 gap:0，真正的 6px 间距在 newSessionContent 层，不能拷按钮的）
    target.style.display = 'flex';
    target.style.justifyContent = 'center';
    target.style.alignItems = 'center';
    const hostContent = hostContentOf(btn);
    const contentGap = hostContent ? getComputedStyle(hostContent).gap : '';
    target.style.gap = contentGap && contentGap !== 'normal' ? contentGap : FALLBACK_CONTENT_GAP;
    target.style.cursor = 'pointer';
    target.style.transition = 'background 0.15s';
  } catch { /* 样式拷贝失败不致命 */ }
}

/** 折叠态判断（窄图标栏） */
function sidebarIsCollapsed(root: HTMLElement): boolean {
  return root.matches('[class*="collapsed"], [data-sidebar-collapsed="true"]')
    || root.closest('[data-sidebar-collapsed="true"]') !== null
    || root.getBoundingClientRect().width <= 80;
}

/** 折叠/展开布局同步（两态数值均对齐宿主 .newSession 的对应规则） */
function syncEntryLayout(root: HTMLElement): void {
  if (!entry) return;
  const collapsed = sidebarIsCollapsed(root);
  entry.dataset.sidebarCollapsed = collapsed ? 'true' : 'false';
  entry.style.alignSelf = collapsed ? 'flex-start' : 'stretch';
  entry.style.justifyContent = 'center';
  // 宽度：展开态清空内联 width，走 flex stretch + 左右 2px margin（与宿主完全同构）；
  // 折叠态 36px（宿主折叠规则）。
  entry.style.width = collapsed ? '36px' : '';
  entry.style.height = collapsed ? '36px' : entry.style.height || 'auto';
  entry.style.padding = collapsed ? '0' : entry.style.padding || '8px 12px';
  entry.style.margin = collapsed ? HOST_MARGIN_COLLAPSED : HOST_MARGIN_EXPANDED;
  const label = entry.querySelector<HTMLElement>(`[${ENTRY_LABEL_ATTR}]`);
  if (label) label.hidden = collapsed;
  // 图标尺寸随形态（宿主 wide=14px，collapsed=18px）
  const icon = entry.querySelector<HTMLElement>(`[${ENTRY_ICON_ATTR}]`);
  if (icon) {
    const size = collapsed ? '18px' : '14px';
    icon.style.width = size;
    icon.style.height = size;
  }
}

function buildEntryInner(label: string): string {
  const svg =
    '<svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="3" y="3" width="7" height="7" rx="1.5"></rect>' +
    '<rect x="14" y="14" width="7" height="7" rx="1.5"></rect>' +
    '<circle cx="17.5" cy="6.5" r="2.5"></circle>' +
    '<path d="M10 6.5h5M10 17.5h1.5M17.5 9v5"></path></svg>';
  return `<span aria-hidden="true" ${ENTRY_ICON_ATTR} ` +
    'style="display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;flex:none;">' +
    `${svg}</span>` +
    `<span ${ENTRY_LABEL_ATTR} style="white-space:nowrap;">${label}</span>`;
}

function sidebarRoot(): HTMLElement | undefined {
  const column = document.querySelector<HTMLElement>('[data-pane="sidebar"], [class*="sidebarCol"]');
  if (!column) return undefined;
  const logoOwner = column.querySelector<HTMLElement>('[class*="logoRow"]')?.parentElement;
  return logoOwner ?? (column.firstElementChild as HTMLElement | undefined);
}

function newSessionButton(root: HTMLElement): HTMLButtonElement | undefined {
  const nested = root.querySelector<HTMLButtonElement>('button[class*="newSession"]');
  if (nested) return nested;
  for (const child of root.children) {
    if (child.tagName === 'BUTTON') return child as HTMLButtonElement;
  }
  return undefined;
}

function placeEntry(root: HTMLElement): boolean {
  if (!entry) return false;
  const button = newSessionButton(root);
  if (!button) return false;
  if (entry.parentElement !== root) {
    // 拷贝新会话按钮观感（每次放置都同步一次，容忍宿主主题切换）
    copyStyleFrom(button, entry);
    // 「新会话」按钮不是 logoRow 的子元素（Tooltip 不包 wrapper），closest 得 null，
    // 走 base=button 分支 → 入口插在「新会话」与 panelList 之间
    const row = button.closest('[class*="logoRow"]');
    const base = row !== null && row.parentElement === root ? row : button;
    root.insertBefore(entry, base.nextElementSibling);
  }
  return true;
}

/**
 * 挂载侧栏入口（等待 shell 渲染 + React 重渲染时自愈）。返回清理函数。
 */
export function mountSidebarEntry(onClick: () => void, label = '工作流'): () => void {
  if (document.querySelector(ENTRY_SELECTOR)) return () => {};
  ensureInjectedStyles();
  entry = document.createElement('button');
  entry.type = 'button';
  entry.setAttribute(ENTRY_ATTR, '');
  entry.setAttribute('aria-label', label);
  entry.title = '打开 / 新建工作流';
  entry.innerHTML = buildEntryInner(label);
  entry.addEventListener('mouseenter', () => {
    if (entry) entry.style.filter = 'brightness(1.15)';
  });
  entry.addEventListener('mouseleave', () => {
    if (entry) entry.style.filter = '';
  });
  entry.addEventListener('click', onClick);

  let root: HTMLElement | undefined;
  let placed = false;
  let observedRoot: HTMLElement | undefined;

  const resizeObserver = new ResizeObserver(() => { if (root) syncEntryLayout(root); });
  const stateObserver = new MutationObserver(() => { if (root) syncEntryLayout(root); });

  const observeRoot = (next: HTMLElement): void => {
    if (observedRoot === next) return;
    resizeObserver.disconnect();
    stateObserver.disconnect();
    observedRoot = next;
    resizeObserver.observe(next);
    stateObserver.observe(next, { attributes: true, attributeFilter: ['class', 'data-sidebar-collapsed'] });
  };

  const tryPlace = (): void => {
    if (root !== undefined && !root.isConnected) {
      resizeObserver.disconnect();
      stateObserver.disconnect();
      observedRoot = undefined;
      root = undefined;
      placed = false;
    }
    if (placed) {
      if (entry && document.body.contains(entry)) return;
      root = undefined;
      placed = false;
    }
    root ??= sidebarRoot();
    if (root === undefined) return;
    observeRoot(root);
    placed = placeEntry(root);
    if (placed) syncEntryLayout(root);
  };

  const waitObserver = new MutationObserver(() => { tryPlace(); });
  waitObserver.observe(document.body, { childList: true, subtree: true });
  tryPlace();

  return () => {
    waitObserver.disconnect();
    resizeObserver.disconnect();
    stateObserver.disconnect();
    entry?.remove();
    entry = null;
  };
}
