// src/client/cm-rainbow.ts — 括号按嵌套深度循环着色（"一对一种颜色"）
// ★ 2026-10-19 用户要求：「括号匹配标注不同颜色，一对一种颜色，选中括号颜色现在很浅，几乎看不到」
//   ⇒ 两句分别落在两处：①本文件的**深度着色**（同一层的括号同色、不同层换色，栈式判定）；
//   ②`styles-dialogs.css` 里加强 `.cm-matchingBracket`（配对高亮：底色+描边+白字，不再是浅灰）。
// ★ 性能：每键一次 O(n) 扫描（30 万字符约 1–2ms，远低于 33ms 帧预算），只为**视口内**的括号建装饰；
//   超大文档（> 50 万字符）直接跳过，避免在极端文本上拿性能换彩色。
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

const MAX_CHARS = 500_000;
const COLORS = 4;
const CLASSES = ['cm-br-0', 'cm-br-1', 'cm-br-2', 'cm-br-3'];
const OPEN = new Set(['(', '[', '{']);
const CLOSE_OF: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

function inRanges(ranges: readonly { from: number; to: number }[], pos: number): boolean {
  for (const r of ranges) {
    if (pos >= r.from && pos <= r.to) return true;
    if (pos < r.from) return false;   // ranges 升序：已经越过
  }
  return false;
}

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  if (doc.length === 0 || doc.length > MAX_CHARS) return builder.finish();
  const text = doc.toString();
  const visible = view.visibleRanges;
  const stack: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    // 快速跳过绝大多数非括号字符（比 Set 查表便宜）
    if (ch !== 40 && ch !== 91 && ch !== 123 && ch !== 41 && ch !== 93 && ch !== 125) continue;
    const c = text[i];
    if (OPEN.has(c)) {
      if (inRanges(visible, i)) {
        builder.add(i, i + 1, Decoration.mark({ class: CLASSES[stack.length % COLORS] }));
      }
      stack.push(c);
      continue;
    }
    const want = CLOSE_OF[c];
    if (!want) continue;
    // 容错：只在栈里找最近的同类开括号（不配对的闭括号不弹别人）
    const idx = stack.lastIndexOf(want);
    if (idx < 0) continue;
    if (inRanges(visible, i)) {
      builder.add(i, i + 1, Decoration.mark({ class: CLASSES[idx % COLORS] }));
    }
    stack.length = idx;
  }
  return builder.finish();
}

/** 彩虹括号扩展：按嵌套深度给 () [] {} 上 4 色循环 */
export const rainbowBrackets = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = build(view); }
  update(u: ViewUpdate): void {
    if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
  }
}, { decorations: (v) => v.decorations });
