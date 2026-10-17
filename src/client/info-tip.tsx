// src/client/info-tip.tsx
// 小问号 + 单击气泡：把原先平铺在界面上的**静态解释**收起来（2026-10-16 用户需求原话：「所有编辑框，
//   富文本框，弹窗里面需要解释的地方，解释的信息统一放到合适的地方用个小问号，单击显示解释内容，
//   现在平铺解释信息很乱」）。★口径：只收静态解释（怎么填/什么语义/什么限制）；**动态状态一律留平铺**
//   （⚠ 警告、空态引导、测试/运行结果、当前值回显）——那些收起来就看不见了。
// 交互：单击开、再单击关、点气泡外关、Esc 关、滚动/缩放关（与 hover-tip 同口径）。
// 定位：锚定问号下方（空间不够翻到上方），水平夹在视口内；只做 opacity 淡入（有几何依赖的元素不做位移/缩放）。
// ★必须 Portal 到 body：面板与参数弹窗的遮罩带 backdrop-filter，会给 fixed 元素造包含块（同 image-picker 的教训）。
import { createElement, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';

/** 同一时刻只允许一个气泡打开（点第二个自动关掉第一个） */
let closeCurrent: (() => void) | null = null;

const ICON = createElement('svg', {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round',
},
  createElement('circle', { cx: 12, cy: 12, r: 9 }),
  createElement('path', { d: 'M9.6 9.2a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .9-1 1.6v.3' }),
  createElement('circle', { cx: 12, cy: 17, r: 0.6, fill: 'currentColor', stroke: 'none' }),
);

export interface InfoTipProps {
  /** 解释正文（纯文本；支持换行） */
  text: string;
  /** 额外的按钮类名（用于按位置微调，如面板里贴标签右侧） */
  className?: string;
}

export function InfoTip({ text, className }: InfoTipProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; arrow: number } | null>(null);
  // ★ 2026-10-19：根元素由 `<button>` 改成 `<span role="button" tabIndex={0}>`。
  //   真因（用户报「小问号现在不直接点在按钮上，也会显示提示信息，有问题」）：问号被放在 `<label>` 里
  //   （`row()` / 面板各处的「标签 + 问号」都是这个结构），而 `<label>` 的默认激活行为会把它关联到
  //   **第一个 labelable 后代**——`<button>` 正是 labelable ⇒ **点 label 上任意位置（哪怕离问号很远）
  //   都会被浏览器当成点击问号**，气泡就弹出来了。`stopPropagation` 拦不住（浏览器是直接对控件派发 click）。
  //   span 不是 labelable ⇒ label 不再关联它，点标签文字不再误触；键盘可达性用 role + tabIndex + onKeyDown 补齐。
  const btnRef = useRef<HTMLSpanElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback((): void => {
    setOpen(false);
    if (closeCurrent === close) closeCurrent = null;
  }, []);

  const toggle = (): void => {
    if (open) { close(); return; }
    // 先关掉别人，再占位（保证同一时刻只有一个）
    closeCurrent?.();
    closeCurrent = close;
    setPos(null);
    setOpen(true);
  };

  // 打开后测量并定位（先渲染再量：气泡尺寸随文案变化，算不出就先挂载再摆）
  useLayoutEffect(() => {
    if (!open) return;
    const btn = btnRef.current;
    const pop = popRef.current;
    if (!btn || !pop) return;
    const b = btn.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    // ★ 2026-10-16 用户反馈（同一句说了两遍）：「小问号提示信息要放在显眼位置，不要放在靠近边缘线的位置」——
    //   原实现「左对齐问号 + 夹进视口」会让**靠右的问号**（右侧编辑面板里最常见）把气泡一路挤到视口右边缘、
    //   贴着边线走。⇒ 改成**按问号所在的半边选对齐方式**：右半边 ⇒ 气泡**右缘对齐问号右缘**（向左展开、
    //   朝界面中间伸），左半边 ⇒ 左缘对齐问号（向右展开）；安全边距也从 8px 加到 16px。
    const MARGIN = 16;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const center = b.left + b.width / 2;
    const raw = center > vw / 2 ? b.right - w : b.left;
    const left = Math.min(Math.max(MARGIN, raw), Math.max(MARGIN, vw - w - MARGIN));
    const below = b.bottom + 10;
    const top = below + h <= vh - MARGIN ? below : Math.max(MARGIN, b.top - h - 10);
    setPos({ left, top, arrow: Math.min(Math.max(12, center - left - 5), Math.max(12, w - 20)) });
  }, [open, text]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent): void => {
      const t = e.target as Node | null;
      if (!t) return;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
    const onMove = (): void => close();
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('mousedown', onDocDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, close]);

  // 卸载时清掉"当前打开者"占位（否则下一个问号会去调一个已销毁的 close）
  useEffect(() => () => { if (closeCurrent === close) closeCurrent = null; }, [close]);

  return createElement('span', { className: 'dsh-wf-info-wrap' },
    createElement('span', {
      ref: btnRef,
      role: 'button',
      tabIndex: 0,
      className: `dsh-wf-info${open ? ' on' : ''}${className ? ` ${className}` : ''}`,
      'aria-label': '说明',
      'aria-expanded': open,
      // ★ 故意不写 title：全局 hover-tip 会接管 title 再弹一层悬浮提示（与点击气泡重复）
      'data-tip': text,
      onClick: (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); toggle(); },
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        toggle();
      },
      onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
    }, ICON),
    open ? createPortal(
      createElement('div', {
        ref: popRef,
        className: `dsh-wf-info-pop${pos ? ' show' : ''}`,
        role: 'tooltip',
        style: pos ? { left: pos.left, top: pos.top, ['--dsh-wf-info-arrow' as string]: `${pos.arrow}px` } : { left: -9999, top: -9999 },
      }, text),
      document.body,
    ) : null,
  );
}
