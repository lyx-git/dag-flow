// src/client/select-box.tsx
// 自研下拉（样式 2，2026-10-18 用户拍板）：替换右侧参数面板里的原生 <select>。
// 为什么必须自研：原生 select 的**展开列表**在 Windows Chromium 下是系统菜单（白底 + 系统字体 + 蓝高亮），
//   CSS 改不了、也拍不到；闭合态那个系统三角与项目的线条图标风格也不搭。本组件把闭合态与展开态都做成
//   项目主题：闭合态＝与输入框同几何（38px / 圆角 10 / 1px 边框 / 9px 11px）+ 单行省略号，
//   展开态＝深色列表（可换行看全长文案、每项可选 sub 说明、项 ≥ 8 时带搜索框）。
// 交互：点击 / Enter / Space / ↓ 打开；↑↓ 移动；Enter 选中；Esc 关闭；点外部 / 滚动 / 改窗口大小关闭。
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
    const width = Math.max(r.width, 180);
    // ★ 2026-10-18（真实渲染截图抓到的坑）：带 sub 的项是**两行**（名称 + 小字说明），高度比单行项多一行 ——
    //   原估算按"每项一行"算，3 项都带 sub 时列表被算矮 ⇒ 只能看到两项半、第三项得滚动才看得见。
    //   改为按项分别估算：34 ≈ 单行项（padding 7+7 + 12.5px 行高），52 ≈ 带 sub 的项（另加一行 10.5px 小字）。
    const maxH = Math.min(LIST_MAX_H, shown.reduce((a, o) => a + (o.sub ? 52 : 34), 0) + (searchable ? 44 : 0) + 12);
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
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('mousedown', onDocDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open]);

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
      // title：闭合态只显示短名称（长解释已挪进列表项的 sub 小字）⇒ 悬停时把完整解释给全，信息不丢
      title: title ?? (cur ? (cur.sub ? `${cur.label} —— ${cur.sub}` : cur.label) : undefined),
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
          role: 'option',
          'aria-selected': o.value === value,
          onMouseEnter: () => setHi(i),
          onClick: () => { if (o.disabled) return; onChange(o.value); setOpen(false); },
        },
          createElement('span', { className: 'dsh-wf-sel-tick' }, o.value === value ? '✓' : ''),
          createElement('span', { className: 'dsh-wf-sel-body' },
            createElement('span', { className: 'dsh-wf-sel-label' }, o.label),
            o.sub ? createElement('span', { className: 'dsh-wf-sel-sub' }, o.sub) : null),
        )),
      ),
    ), document.body) : null,
  );
}
