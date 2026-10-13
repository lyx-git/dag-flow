// src/client/code-text.tsx
// 代码级文本编辑框（零依赖）：行号槽 + 高亮层 + 透明 textarea 三层叠加。
// ★ 2026-10-11 抽出复用：用户拍板「参数编辑区的富文本编辑框是那种类似代码级的富文本编辑框，
//   也不是 word 编辑框」——所以参数编辑器的长文本值 / JSON 视图都用这套（等宽 + 行号 + 高亮 + Tab 缩进）。
//   高亮函数从 FlowPanel.tsx 原样搬来（python/bash 两套规则不变），另加 json / text 两种。
import { useRef, useState } from 'react';
import { createElement } from 'react';

export type CodeLang = 'python' | 'bash' | 'json' | 'text';

const CODE_KEYWORDS: Record<string, string[]> = {
  python: ['import', 'from', 'as', 'def', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'not', 'and', 'or', 'is', 'None', 'True', 'False', 'try', 'except', 'finally', 'with', 'lambda', 'class', 'pass', 'break', 'continue', 'print', 'range', 'len'],
  bash: ['if', 'then', 'elif', 'else', 'fi', 'for', 'while', 'do', 'done', 'in', 'echo', 'export', 'read', 'exit', 'return', 'case', 'esac', 'function', 'local', 'date'],
};

const escHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** JSON 高亮：键 / 字符串值 / 数字 / true·false·null（其余原样） */
function highlightJson(code: string): string {
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let out = '';
  let last = 0;
  for (const m of code.matchAll(re)) {
    out += escHtml(code.slice(last, m.index ?? 0));
    const [full, str, colon, lit, num] = m;
    if (str && colon) out += `<span class="tok-k">${escHtml(str)}</span>${escHtml(colon)}`;
    else if (str) out += `<span class="tok-s">${escHtml(str)}</span>`;
    else if (lit) out += `<span class="tok-k">${escHtml(full)}</span>`;
    else if (num) out += `<span class="tok-n">${escHtml(full)}</span>`;
    else out += escHtml(full);
    last = (m.index ?? 0) + full.length;
  }
  out += escHtml(code.slice(last));
  return out + '\n'; // 尾部补一个空行，保证滚动高度与 textarea 一致
}

/** 简易语法高亮：注释/字符串/关键字/数字 着色（先 HTML 转义再包 span） */
export function highlightCode(code: string, lang: CodeLang): string {
  if (lang === 'text') return escHtml(code) + '\n';
  if (lang === 'json') return highlightJson(code);
  const kw = CODE_KEYWORDS[lang] ?? [];
  const kwRe = kw.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`(#[^\\n]*)|("(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*')|\\b(${kwRe})\\b|(\\b\\d+(?:\\.\\d+)?\\b)`, 'g');
  let out = '';
  let last = 0;
  for (const m of code.matchAll(re)) {
    out += escHtml(code.slice(last, m.index ?? 0));
    const [full, comment, str, kwTok, num] = m;
    if (comment) out += `<span class="tok-c">${escHtml(full)}</span>`;
    else if (str) out += `<span class="tok-s">${escHtml(full)}</span>`;
    else if (kwTok) out += `<span class="tok-k">${escHtml(full)}</span>`;
    else if (num) out += `<span class="tok-n">${escHtml(full)}</span>`;
    last = (m.index ?? 0) + full.length;
  }
  out += escHtml(code.slice(last));
  return out + '\n';
}

/** 行号槽文本 */
export function lineNumbers(code: string): string {
  const n = Math.max(1, code.split('\n').length);
  return Array.from({ length: n }, (_, i) => String(i + 1)).join('\n');
}

/**
 * 代码级文本编辑框。受控：value / onChange。
 * · lang：python | bash | json | text（text = 只做 HTML 转义，不猜语法，适合提示词这类自然语言）
 * · height：编辑区高度（px）
 * · toolbar：插在编辑区上方的工具栏节点（可选）
 * · status：右下角「Ln x, Col y · N 字符」状态栏
 */
export function CodeText({ value, onChange, lang = 'text', height = 180, placeholder = '', toolbar = null, status = true, spellCheck = false, expand }: {
  value: string;
  onChange: (v: string) => void;
  lang?: CodeLang;
  height?: number;
  placeholder?: string;
  toolbar?: unknown;
  status?: boolean;
  spellCheck?: boolean;
  /** ★ 2026-10-11 用户要求：「放大按钮在富文本框里面的**右上角**，斜双箭头，点了放大到弹窗、遮盖其他部分」，
   *  并且在弹窗里同一个把手变成「缩小」。传 { expanded, onToggle } 即渲染该把手（位置固定在编辑区右上角）。 */
  expand?: { expanded: boolean; onToggle: () => void; title?: string };
}) {
  const hlRef = useRef<HTMLPreElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const [cursor, setCursor] = useState({ ln: 1, col: 1, len: value.length });

  const syncScroll = (ta: HTMLTextAreaElement): void => {
    if (hlRef.current) { hlRef.current.scrollTop = ta.scrollTop; hlRef.current.scrollLeft = ta.scrollLeft; }
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
  };
  const updateCursor = (ta: HTMLTextAreaElement): void => {
    const lines = ta.value.slice(0, ta.selectionStart).split('\n');
    setCursor({ ln: lines.length, col: (lines[lines.length - 1]?.length ?? 0) + 1, len: ta.value.length });
  };

  return createElement('div', { className: 'dsh-wf-codetext' },
    createElement('div', { className: 'dsh-wf-code-ed', style: { height } },
      // ★ 2026-10-13 用户要求：「复制，清除，tips 挪到富文本框里面右下角位置，并且不能遮挡输入操作」⇒
      //   文本区（行号槽 + 高亮层 + textarea）包进 `.dsh-wf-code-main`，占满除工具条以外的全部高度；
      //   工具条成为编辑区**内部最底部的一条带**（独占空间 ⇒ 不覆盖 textarea、不拦截输入）。
      createElement('div', { className: 'dsh-wf-code-main' },
      createElement('div', { className: 'dsh-wf-code-gutter', ref: gutterRef },
        createElement('pre', null, lineNumbers(value))),
      createElement('div', { className: 'dsh-wf-code-wrap' },
        createElement('pre', {
          className: 'dsh-wf-code-hl', ref: hlRef, 'aria-hidden': true,
          dangerouslySetInnerHTML: { __html: highlightCode(value, lang) },
        }),
        createElement('textarea', {
          className: 'dsh-wf-code-ta',
          value,
          spellCheck,
          wrap: 'off',
          placeholder,
          onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => { onChange(e.target.value); updateCursor(e.target); },
          onScroll: (e: React.UIEvent<HTMLTextAreaElement>) => syncScroll(e.currentTarget),
          onClick: (e: React.MouseEvent<HTMLTextAreaElement>) => updateCursor(e.currentTarget),
          onKeyUp: (e: React.KeyboardEvent<HTMLTextAreaElement>) => updateCursor(e.currentTarget),
          onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            // Tab = 4 空格缩进（Shift+Tab 反缩进当前行首）
            if (e.key !== 'Tab') return;
            e.preventDefault();
            const ta = e.currentTarget;
            const s = ta.selectionStart;
            const epos = ta.selectionEnd;
            const v = ta.value;
            if (!e.shiftKey) {
              onChange(v.slice(0, s) + '    ' + v.slice(epos));
              requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 4; });
            } else {
              const lineStart = v.lastIndexOf('\n', s - 1) + 1;
              const cut = v.slice(lineStart, lineStart + 4) === '    ' ? 4 : 0;
              if (cut) {
                onChange(v.slice(0, lineStart) + v.slice(lineStart + cut));
                requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = Math.max(lineStart, s - cut); });
              }
            }
          },
        }),
      ),
      // ★ 放大/缩小把手：**文本区**内部右上角（在 .dsh-wf-code-main 里定位，随文本区而不是随工具条）——
      //   用户 2026-10-11 指定「放大按钮在富文本框里面的右上角，放大和缩小」。
      expand
        ? createElement('button', {
            className: `dsh-wf-code-expand${expand.expanded ? ' is-expanded' : ''}`,
            title: expand.title ?? (expand.expanded ? '缩小（回到参数面板里）' : '放大编辑（在大窗口里写，盖住其它部分）'),
            onClick: (e: React.MouseEvent) => { e.stopPropagation(); expand.onToggle(); },
          }, createElement('svg', {
            width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
            strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
          },
            // 斜杠方向（/）的双箭头：向外＝放大；向内＝缩小（★ 两版几何必须真的不同——
            //   上一版"向内"其实画的是同一个 L 形，用户真机反馈「缩小按钮样式还是放大，没改变」，已修）
            createElement('path', { d: 'M4.6 11.4 11.4 4.6' }),
            expand.expanded
              ? [
                  // 缩小：两支箭头从两端朝中心汇聚（头像朝内），与放大明显不同
                  createElement('path', { key: 'ne-shaft', d: 'M11.4 4.6 9.0 7.0' }),
                  createElement('path', { key: 'ne-head', d: 'M11.0 7.0H9.0V5.0' }),
                  createElement('path', { key: 'sw-shaft', d: 'M4.6 11.4 7.0 9.0' }),
                  createElement('path', { key: 'sw-head', d: 'M5.0 9.0h2v2' }),
                ]
              : [
                  // 放大：两端朝外的箭头
                  createElement('path', { key: 'ne', d: 'M8.2 4.6h3.2v3.2' }),
                  createElement('path', { key: 'sw', d: 'M7.8 11.4H4.6V8.2' }),
                ],
          ))
        : null,
      ),
      // ★ 工具条（复制 / 清空 / 提示）：编辑区**内部最底部一条带、内容靠右**（＝框内右下角）。
      //   2026-10-13 用户明确「并且不能遮挡输入操作」⇒ 这条带**独占空间**（不是浮层）：不覆盖任何代码文字、
      //   不拦截 textarea 的点击；代价是文本区矮 ~28px（上一版"绝对定位浮层"正是因遮挡被否）。
      toolbar ? createElement('div', { className: 'dsh-wf-code-toolbar' }, toolbar as never) : null,
    ),
    status ? createElement('div', { className: 'dsh-wf-code-status' }, `Ln ${cursor.ln}, Col ${cursor.col} · ${cursor.len} 字符`) : null,
  );
}
