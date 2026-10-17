// src/client/select-box.tsx
// 自研下拉（样式 2，2026-10-18 用户拍板）：替换右侧参数面板里的原生 <select>。
// 为什么必须自研：原生 select 的**展开列表**在 Windows Chromium 下是系统菜单（白底 + 系统字体 + 蓝高亮），
//   CSS 改不了、也拍不到；闭合态那个系统三角与项目的线条图标风格也不搭。本组件把闭合态与展开态都做成
//   项目主题：闭合态＝与输入框同几何（38px / 圆角 10 / 1px 边框 / 9px 11px）+ 单行省略号，
//   展开态＝深色列表：**与控件同宽**、列表项**单行省略号**、每项可选 sub 小字说明、项 ≥ 8 时带搜索框。
// 悬停提示＝**自绘**深色浮层（原生 `title` 的提示框是浏览器 UI，白底方角、CSS 改不了）——见 showTip。
// 交互：点击 / Enter / Space / ↓ 打开；↑↓ 移动；Enter 选中；Esc 关闭；点外部 / **页面或面板**滚动 / 改窗口大小关闭
//   （★列表**自己**的滚动不关闭 —— 见 onScroll：这里是 scroll 的 capture 监听，必须排除自家列表）。
// 浮层用 Portal 到 body + position:fixed —— 右侧面板的 backdrop-filter 会给 fixed 造包含块，挂在面板里会被困住。
// 关联：样式在 styles.css 的 .dsh-wf-sel*；调用方 NodeInspector.tsx / inspector-fields.tsx。
import { createElement, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { createPortal } from 'react-dom';

export interface SelectOption {
  value: string;
  label: string;
  /** 选项下的一行小字说明（可选；长解释放这里，选项名就能保持短） */
  sub?: string;
  disabled?: boolean;
}

/** 展开列表项数达到该值时，列表顶部出现搜索框 */
const SEARCH_FROM = 8;
/** 列表最大高度（px）：★ 2026-10-18 由 320 提到 380 —— 项里多了 sub 小字后每项约 52px，
 *  7 项的引擎列表在 320 下会被截成「第六项半」（要滚一下才看全）；380 正好容下 7 项，
 *  又远小于视口高度（更多项的列表如 13 个循环体仍按上限滚动，不会撑满屏幕）。 */
const LIST_MAX_H = 380;
/** 列表与视口边缘的最小留白（px） */
const EDGE = 8;
/** 悬停提示框的最大宽度（px） */
const TIP_MAX_W = 340;
/** 悬停多久才弹提示（ms）：列表里快速扫过时不要一路弹 */
const TIP_DELAY = 180;

interface TipState { left: number; w: number; text: string; top?: number; bottom?: number }

export function SelectBox(props: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  className?: string;
  title?: string;
  style?: CSSProperties;
  disabled?: boolean;
  /** value 为空且列表里没有对应项时显示的占位文案 */
  placeholder?: string;
}): ReactElement {
  const { value, options, onChange, className, title, style, disabled, placeholder } = props;
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxH: number } | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const tipTimer = useRef<number | null>(null);
  const btnRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const qRef = useRef<HTMLInputElement | null>(null);

  const cur = options.find((o) => o.value === value);
  const searchable = options.length >= SEARCH_FROM;
  const kw = q.trim().toLowerCase();
  const shown = kw
    ? options.filter((o) => `${o.label} ${o.sub ?? ''} ${o.value}`.toLowerCase().includes(kw))
    : options;

  // 定位：优先向下展开；下方放不下就向上；左右按锚点对齐并夹进视口（绝不贴边）
  useLayoutEffect(() => {
    if (!open) return;
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // ★ 2026-10-19（用户要求「下拉选浮窗的长度要保持和下拉选一致，不要超出」）：宽度**严格等于控件宽度**。
    //   原来有 180px 下限（`Math.max(r.width, 180)`）—— 两段式里那个窄的「本地路径」下拉会被撑到 180px、
    //   明显比控件宽。太窄时靠单行省略号 + 悬停自绘提示看全名，不再靠加宽。
    const width = r.width;
    // ★ 2026-10-18（真实渲染截图抓到的坑）：带 sub 的项是**两行**（名称 + 小字说明），高度比单行项多一行 ——
    //   原估算按"每项一行"算，3 项都带 sub 时列表被算矮 ⇒ 只能看到两项半、第三项得滚动才看得见。
    // 改为按项分别估算：34 ≈ 单行项（padding 7+7 + 12.5px 行高），52 ≈ 带 sub 的项（另加一行 10.5px 小字）；
    //   ★ 2026-10-19 实测搜索框占 50px（不是 44）：输入框 42（min-height 30 + padding 5+5 + border 2）+ 上下 padding 8。
    //   ★ 同一轮：列表自己改成 border-box（见 styles.css）⇒ 这里的 maxH 是**总高**（含 padding 与 border）：
    //     末尾 +12 是上下 padding 的余量、52 的估算已把 border 2px 吃掉；width 同理＝总宽（直接传控件宽）。
    const maxH = Math.min(LIST_MAX_H, shown.reduce((a, o) => a + (o.sub ? 52 : 34), 0) + (searchable ? 50 : 0) + 12);
    let left = r.left;
    if (left + width > window.innerWidth - EDGE) left = Math.max(EDGE, window.innerWidth - EDGE - width);
    const below = window.innerHeight - r.bottom - EDGE;
    const top = below >= maxH ? r.bottom + 4 : Math.max(EDGE, r.top - maxH - 4);
    setPos({ left, top, width, maxH });
  }, [open, q, shown.length, shown.filter((o) => o.sub).length, searchable]);

  // ★ 搜索框聚焦必须用 focus({preventScroll:true})，**不能用 autoFocus**：
  //   autoFocus 会把视口/resize 滚一下 → 触发 scroll → 上面的 onMove 把刚打开的列表关掉
  //   （2026-10-18 实测：13 项的「循环体」下拉点开瞬间就消失，4 项的下拉正常；真机同样会撞）。
  useEffect(() => {
    if (!open || !searchable) return undefined;
    const t = setTimeout(() => qRef.current?.focus({ preventScroll: true }), 0);
    return () => clearTimeout(t);
  }, [open, searchable]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false); };
    const onMove = (): void => setOpen(false);
    // ★ 2026-10-19（用户真机报「AI 节点的选择模型下拉无法滚动，滚动就闪退」）：scroll 用 capture 挂在 window 上，
    //   连**列表自己内部**的滚动也会命中（`.dsh-wf-sel-opts` 本身可滚，模型列表几十项必然要滚）⇒ 一滚就被自己关掉。
    //   判据：滚动目标在列表内部 ⇒ 不算"页面滚走"，直接放行；页面 / 面板真的滚动时仍然关闭（避免浮层与锚点分离）。
    const onScroll = (e: Event): void => {
      if (listRef.current && listRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDocDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  // 列表一关就收起悬停提示（点选 / Esc / 点外部都会走这里）；卸载时清掉未触发的定时器
  useEffect(() => { if (!open) setTip(null); }, [open]);
  useEffect(() => () => { if (tipTimer.current) window.clearTimeout(tipTimer.current); }, []);

  /**
   * 悬停提示（**自绘**，2026-10-19 用户：「下拉选鼠标悬停展示的框也比较丑，可以优化下」）。
   * 为什么必须自绘：原生 `title` 的提示框是浏览器 UI（白底 / 系统字体 / 方角），CSS 完全改不了、CDP 也拍不到。
   * 规则：①悬停 TIP_DELAY 后才弹（列表里快速扫过时不要一路闪）；②只在**真的被截断**时才弹，
   * 或调用方传了 `title`（说明性文字，force）；③内容＝「名称 —— 解释」，与闭合态同一口径；
   * ④位置＝默认在锚点**上方**（用 `bottom` 固定底边，不需要预先知道提示框高度），上方空间不足就落到下方。
   */
  const showTip = (anchor: HTMLElement, text: string | undefined, force: boolean): void => {
    if (tipTimer.current) window.clearTimeout(tipTimer.current);
    if (!text) return;
    tipTimer.current = window.setTimeout(() => {
      const cut = [...anchor.querySelectorAll<HTMLElement>('.dsh-wf-sel-label, .dsh-wf-sel-sub, .dsh-wf-sel-text')]
        .some((el) => el.scrollWidth - el.clientWidth > 1);
      if (!cut && !force) return;   // 全名本来就在屏幕上 ⇒ 不弹（否则只是噪音）
      const r = anchor.getBoundingClientRect();
      const w = Math.min(TIP_MAX_W, Math.max(180, r.width));
      let left = r.left;
      if (left + w > window.innerWidth - EDGE) left = Math.max(EDGE, window.innerWidth - EDGE - w);
      if (r.top > 96) setTip({ left, w, text, bottom: Math.max(EDGE, window.innerHeight - r.top + 6) });
      else setTip({ left, w, text, top: Math.min(window.innerHeight - EDGE, r.bottom + 6) });
    }, TIP_DELAY);
  };
  const hideTip = (): void => {
    if (tipTimer.current) { window.clearTimeout(tipTimer.current); tipTimer.current = null; }
    setTip(null);
  };

  const openList = (): void => {
    setHi(Math.max(0, options.findIndex((o) => o.value === value)));
    setQ('');
    setOpen(true);
  };

  const onKey = (e: { key: string; preventDefault: () => void }): void => {
    if (disabled) return;
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); openList(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(shown.length - 1, h + 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const o = shown[hi];
      if (o && !o.disabled) { onChange(o.value); setOpen(false); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
    if (e.key === 'Tab') setOpen(false);
  };

  // className 落在外层 wrapper（供 .dsh-wf-srcrow 这类"按直接子元素"的布局规则命中），
  // style 落在控件本体（调用方用它做警示边框等，如未选模型时的黄框）
  return createElement('div', { className: `dsh-wf-selwrap${className ? ` ${className}` : ''}` },
    createElement('div', {
      ref: btnRef,
      className: `dsh-wf-input dsh-wf-sel${open ? ' on' : ''}${disabled ? ' is-disabled' : ''}`,
      // data-value：把当前值落到 DOM 上——自研控件不是表单元素，测试/排查不用再去撞 React 内部状态
      'data-value': value,
      style,
      role: 'combobox',
      'aria-haspopup': 'listbox',
      'aria-expanded': open,
      'aria-disabled': disabled === true,
      tabIndex: disabled ? -1 : 0,
      // ★ 2026-10-19：**不再用原生 `title`**（它的提示框是浏览器 UI、白底方角，改不了）⇒ 走自绘提示；
      //   调用方传的 `title`（说明性文字）照样作为提示内容、且**总是显示**（force，不要求被截断）。
      onMouseEnter: (e: React.MouseEvent<HTMLDivElement>) => {
        if (open) return;   // 列表开着时由列表项自己管提示
        showTip(e.currentTarget, title ?? (cur ? (cur.sub ? `${cur.label} —— ${cur.sub}` : cur.label) : undefined), !!title);
      },
      onMouseLeave: hideTip,
      onClick: () => { if (!disabled) (open ? setOpen(false) : openList()); },
      onKeyDown: onKey,
    },
      createElement('span', { className: 'dsh-wf-sel-text' }, cur?.label ?? (value === '' ? (placeholder ?? '') : value)),
      createElement('svg', {
        className: 'dsh-wf-sel-chev', viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none',
        stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
      }, createElement('polyline', { points: '6 9 12 15 18 9' })),
    ),
    open && pos ? createPortal(createElement('div', {
      ref: listRef, className: 'dsh-wf-sel-list', role: 'listbox',
      style: { left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxH },
    },
      searchable ? createElement('div', { className: 'dsh-wf-sel-search' },
        createElement('input', {
          className: 'dsh-wf-sel-q', ref: qRef, placeholder: '搜索…', value: q,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => { setQ(e.target.value); setHi(0); },
          onKeyDown: onKey,
        })) : null,
      createElement('div', { className: 'dsh-wf-sel-opts' },
        shown.length === 0 ? createElement('div', { className: 'dsh-wf-sel-empty' }, '没有匹配项') : null,
        shown.map((o, i) => createElement('div', {
          key: o.value,
          className: `dsh-wf-sel-opt${o.value === value ? ' is-on' : ''}${i === hi ? ' is-hi' : ''}${o.disabled ? ' is-disabled' : ''}`,
          'data-opt': o.value,
          // ★ 2026-10-19：单行省略号 ⇒ 悬停用**自绘**提示给全名（原生 `title` 的白底系统框已按用户要求换掉）
          role: 'option',
          'aria-selected': o.value === value,
          onMouseEnter: (e: React.MouseEvent<HTMLDivElement>) => {
            setHi(i);
            showTip(e.currentTarget, o.sub ? `${o.label} —— ${o.sub}` : o.label, false);
          },
          onMouseLeave: hideTip,
          onClick: () => { if (o.disabled) return; onChange(o.value); setOpen(false); },
        },
          createElement('span', { className: 'dsh-wf-sel-tick' }, o.value === value ? '✓' : ''),
          createElement('span', { className: 'dsh-wf-sel-body' },
            createElement('span', { className: 'dsh-wf-sel-label' }, o.label),
            o.sub ? createElement('span', { className: 'dsh-wf-sel-sub' }, o.sub) : null),
        )),
      ),
    ), document.body) : null,
    // 悬停提示（同样 Portal 到 body：面板的 backdrop-filter 会给 fixed 造包含块）
    tip ? createPortal(createElement('div', {
      className: 'dsh-wf-sel-tip',
      role: 'tooltip',
      style: { left: tip.left, maxWidth: tip.w, ...(tip.top !== undefined ? { top: tip.top } : { bottom: tip.bottom }) },
    }, tip.text), document.body) : null,
  );
}
