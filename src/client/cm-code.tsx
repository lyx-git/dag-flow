// src/client/cm-code.tsx
// 代码级编辑区（CodeMirror 6）。★ 2026-10-19 实测对比后选定：
//   原有三层实现（行号槽 + 高亮层 <pre> + **透明 textarea**）在大文本下打一个字符 p50 **1103ms**——
//   浏览器给 30 万字符的 textarea 排版本身就要 ≈420ms，高亮层再排一遍 ≈486ms，任何 CSS/React 微调都动不了。
//   CM6 只渲染视口行（实测同规模按键 p50 **5.7ms**），且不需要 worker、同步可用（无 CDN、无超时回退）。
// ★ 2026-10-19 第二轮：不再用 `basicSetup`（它的 foldGutter 写死文本箭头）⇒ 自己组装扩展；
//   折叠箭头自绘 SVG；括号按深度 4 色循环；匹配括号加强；搜索面板换自绘浮层。
// ★ 2026-10-19 第三轮：`Ctrl+Shift+L` 增强 —— 光标没选中文字时先选词再全选相同项（见 selectAllMatches）。
import { useEffect, useRef } from 'react';
import { createElement } from 'react';
import {
  EditorView, placeholder as cmPlaceholder, keymap,
  lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection,
  dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine,
} from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { history, defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  foldGutter, foldKeymap, indentOnInput, bracketMatching,
  StreamLanguage, syntaxHighlighting, HighlightStyle, indentUnit, defaultHighlightStyle,
} from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap, selectSelectionMatches } from '@codemirror/search';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { tags } from '@lezer/highlight';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { rainbowBrackets } from './cm-rainbow';
import { dshSearch } from './cm-search';

export type CmLang = 'python' | 'bash' | 'json' | 'text';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 折叠箭头：自绘 chevron（CM6 默认是 "⌄"/"›" 文本，用户觉得丑；语义：展开态朝下、折叠态朝右） */
function foldMarker(open: boolean): HTMLElement {
  const span = document.createElement('span');
  span.className = `dsh-wf-foldmark${open ? ' is-open' : ''}`;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', open ? 'M4.6 6.3 8 9.7l3.4-3.4' : 'M6.3 4.6 9.7 8l-3.4 3.4');
  svg.appendChild(path);
  span.appendChild(svg);
  return span;
}

/** 深空蓝主题：底色/字号/行高对齐原来的三层实现，观感变化最小 */
const cmTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--wf-text, #e6edf7)' },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, Consolas, monospace',
    fontSize: '12px',
    lineHeight: '1.55',
    overflow: 'auto',
  },
  '.cm-gutters': { backgroundColor: 'transparent', color: '#42506b', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'rgba(79,140,255,0.05)' },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(79,140,255,0.08)' },
  '.cm-content': { caretColor: 'var(--wf-text, #e6edf7)' },
  '&.cm-focused': { outline: 'none' },
  // ★ 选区高亮不在这里配：CM6 内置 baseTheme 对 `.cm-selectionBackground` 有更深的选择器，
  //   写在 theme 里会被盖掉（实测焦点态只生效到基础值）⇒ 统一放到 `styles-dialogs.css` 的
  //   `.dsh-wf-cmcode .cm-selectionBackground`（带作用域 + !important 才压得住）。
}, { dark: true });

/** 语法着色：沿用原 `.tok-*` 配色（关键字紫 / 字符串绿 / 注释灰 / 数字橙）。
 *  ★ 每个 tag 都带 `tok-*` 类名：①主题可被 CSS 覆盖；②调试与自动化能直接断言"这段代码真的着色了"。 */
const cmHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#c792ea', class: 'tok-keyword' },
  { tag: tags.string, color: '#a3e635', class: 'tok-string' },
  { tag: [tags.propertyName, tags.attributeName], color: '#c792ea', class: 'tok-prop' },
  { tag: [tags.number, tags.bool, tags.null], color: '#f78c6c', class: 'tok-num' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: '#64748b', fontStyle: 'italic', class: 'tok-comment' },
  { tag: tags.operator, color: '#89ddff', class: 'tok-op' },
  { tag: tags.variableName, color: 'var(--wf-text, #e6edf7)', class: 'tok-var' },
]);

/** 语言扩展（切换语言走 Compartment，不重建编辑器） */
function langExt(lang: CmLang) {
  if (lang === 'python') return python();
  if (lang === 'json') return json();
  if (lang === 'bash') return StreamLanguage.define(shell);
  return [];   // text = 只做纯文本
}

/**
 * Ctrl+Shift+L 的增强版：**光标没选中文字时，先选中光标所在的词，再选中它的所有相同项**。
 * ★ 2026-10-19 用户报「编辑区 ctrl+D，同一行有多个相同的文本只能选中一个」——实测结论：
 *   ①`Ctrl+D`（selectNextOccurrence）本身完全正常：第 1/2/3 次分别得到 1/2/3 个选区（同行连续/分散/跨行都对）；
 *   ②真正的坑是 `selectSelectionMatches` 在**空选区**下直接 `continue`（源码 `if (from == to) continue`），
 *     所以"光标停在词上按 Ctrl+Shift+L"毫无反应 ⇒ 看起来像"只能选一个"。
 *   这里补上"先选词"这一步，它就成为名副其实的"一键全选所有相同项"。
 */
function selectAllMatches(view: EditorView): boolean {
  const sel = view.state.selection.main;
  if (sel.from === sel.to) {
    const word = view.state.wordAt(sel.head);
    if (!word) return false;
    view.dispatch({ selection: { anchor: word.from, head: word.to } });
  }
  return selectSelectionMatches({ state: view.state, dispatch: (tr) => view.dispatch(tr) });
}

/** 挂在编辑区宿主上的视图句柄（见下方 cmViewOf） */
type CmHost = HTMLElement & { __cmView?: EditorView };

/**
 * 从任意 DOM（宿主自身或它的后代）反查 CM6 视图。
 * ★ 为什么需要：换掉三层 textarea 后，原先读 `el.selectionStart` / `el.value` 的业务代码
 *   （参数弹窗「点变量 → 插到光标处」）拿不到光标与文本了。统一走这几个函数，别再摸 DOM。
 */
export function cmViewOf(el: Element | null | undefined): EditorView | null {
  const host = (el?.closest?.('.dsh-wf-cmcode') ?? null) as CmHost | null;
  return host?.__cmView ?? null;
}

/** 读当前文本（无编辑器返回空串） */
export function cmText(el: Element | null | undefined): string {
  return cmViewOf(el)?.state.doc.toString() ?? '';
}

/** 当前选区（无编辑器返回 null） */
export function cmSelection(el: Element | null | undefined): { from: number; to: number } | null {
  const v = cmViewOf(el);
  if (!v) return null;
  const s = v.state.selection.main;
  return { from: s.from, to: s.to };
}

/** 在光标处插入文本 ⇒ 返回插入后的光标位置（−1 = 这块 DOM 上没有可用编辑器） */
export function cmInsertAtCursor(el: Element | null | undefined, text: string): number {
  const v = cmViewOf(el);
  if (!v) return -1;
  const s = v.state.selection.main;
  v.dispatch({ changes: { from: s.from, to: s.to, insert: text } });
  return s.from + text.length;
}

/** 聚焦并把光标放到 pos（React 重渲染后请在 rAF 里调用，等新 value 同步进文档） */
export function cmFocusAt(el: Element | null | undefined, pos: number): boolean {
  const v = cmViewOf(el);
  if (!v) return false;
  v.focus();
  const at = Math.max(0, Math.min(pos, v.state.doc.length));
  v.dispatch({ selection: { anchor: at } });
  return true;
}

export function CmCode({ value, onChange, lang, onCursor, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  lang: CmLang;
  /** 光标位置上报（状态栏 Ln/Col） */
  onCursor?: (at: { ln: number; col: number; len: number }) => void;
  placeholder?: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langComp = useRef(new Compartment()).current;
  // 回调走 ref：监听器只绑一次，始终调用最新闭包（与项目其它外置 store 同款）
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onCursorRef = useRef(onCursor);
  onCursorRef.current = onCursor;

  // 创建（只一次；卸载即 destroy，CM6 自己清理 DOM 与监听器）
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          // ===== 基础编辑能力（等价于 basicSetup 的集合，但 foldGutter 换成自绘箭头）=====
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          foldGutter({ markerDOM: (open: boolean) => foldMarker(open) }),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          syntaxHighlighting(cmHighlight),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          // ===== 视觉增强 =====
          dshSearch(),
          rainbowBrackets,
          cmTheme,
          // ===== 业务层 =====
          langComp.of(langExt(lang)),
          cmPlaceholder(placeholder ?? ''),
          indentUnit.of('    '),            // 与原三层实现一致：Tab / 自动缩进 = 4 空格
          keymap.of([
            // ★ 必须排在 searchKeymap **之前**：同一 key 先命中者生效（它替代默认的 selectSelectionMatches）
            { key: 'Mod-Shift-l', run: selectAllMatches, preventDefault: true },
            indentWithTab,                   // ★ 上面这批里没有 Tab 绑定，不补 Tab 会去移动焦点
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...completionKeymap,
            ...searchKeymap,                 // Ctrl+F / Ctrl+G / Ctrl+D（浮层面板见 cm-search.ts）
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
            if (u.docChanged || u.selectionSet) {
              const head = u.state.selection.main.head;
              const line = u.state.doc.lineAt(head);
              onCursorRef.current?.({ ln: line.number, col: head - line.from + 1, len: u.state.doc.length });
            }
          }),
        ],
      }),
      parent: host,
    });
    viewRef.current = view;
    (host as CmHost).__cmView = view;   // ← cmViewOf 的反查句柄（参数弹窗插变量要用）
    return () => {
      delete (host as CmHost).__cmView;
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部 value 变化 → 同步进文档（比较后再写，避免把用户输入打回去造成光标跳动）
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const cur = view.state.doc.toString();
    if (cur !== value) {
      view.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
    }
  }, [value]);

  // 切换语言（不重建编辑器 ⇒ 光标/滚动位置保留）
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: langComp.reconfigure(langExt(lang)) });
  }, [lang, langComp]);

  return createElement('div', { className: 'dsh-wf-cmcode', ref: hostRef });
}
