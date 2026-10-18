// src/client/cm-search.ts — 现代搜索浮层（替换 CM6 默认那条"底部灰条 + 英文按钮"的搜索面板）
// ★ 2026-10-19 用户原话：「ctrl+F搜索框出现在底部，颜色，设计样式，都很丑，没有现代化的设计方案」
//   ⇒ 用 CM6 官方提供的 `search({ top: true, createPanel })` 换成自绘面板：
//   编辑器**右上角**一条圆角浮层（放大镜图标 + 输入框 + 匹配计数 + 上一处/下一处/关闭 图标按钮），
//   视觉沿用插件自己的深空蓝（`--wf-*` 变量），不再暴露 "next / previous / close" 这些英文原生按钮。
// ★ 匹配高亮仍由 CM6 的 search 扩展负责（`.cm-searchMatch` / `.cm-searchMatch-selected`，样式在 CSS 里美化）。
import { EditorView } from '@codemirror/view';
import type { Panel, ViewUpdate } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { closeSearchPanel, findNext, findPrevious, getSearchQuery, search, SearchQuery, setSearchQuery } from '@codemirror/search';

const NS = 'http://www.w3.org/2000/svg';
const escRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function icon(paths: readonly string[]): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '13');
  svg.setAttribute('height', '13');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

function button(title: string, svg: SVGSVGElement, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.appendChild(svg);
  b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
  return b;
}

/** 统计匹配数（超长文本封顶 1000，避免搜单字符时遍历几万次） */
function countMatches(text: string, q: SearchQuery): number {
  if (!q.search) return 0;
  let re: RegExp;
  try { re = new RegExp(q.regexp ? q.search : escRe(q.search), q.caseSensitive ? 'g' : 'gi'); } catch { return -1; }
  let n = 0;
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) {
    n += 1;
    if (n >= 1000) return n;
    if (m[0].length === 0) re.lastIndex += 1;   // 零宽匹配防死循环
  }
  return n;
}

class DshSearchPanel implements Panel {
  readonly dom: HTMLElement;
  readonly top = true;
  private readonly view: EditorView;
  private readonly input: HTMLInputElement;
  private readonly countEl: HTMLElement;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(view: EditorView) {
    this.view = view;
    const box = document.createElement('div');
    box.className = 'dsh-wf-find';

    this.input = document.createElement('input');
    this.input.className = 'dsh-wf-find-input';
    this.input.type = 'text';
    this.input.placeholder = '查找';
    this.input.setAttribute('main-field', 'true');   // CM6 打开面板时聚焦这个框
    this.input.setAttribute('spellcheck', 'false');

    this.countEl = document.createElement('span');
    this.countEl.className = 'dsh-wf-find-count';

    box.appendChild(icon(['M7.4 2.4a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm3.5 8.4L14 14']));
    box.appendChild(this.input);
    box.appendChild(this.countEl);
    box.appendChild(button('上一处（Shift+Enter）', icon(['M8 11.6V4.4', 'M8 4.4 5.2 7.2', 'M8 4.4l2.8 2.8']), () => findPrevious(this.view)));
    box.appendChild(button('下一处（Enter）', icon(['M8 4.4v7.2', 'M8 11.6 5.2 8.8', 'M8 11.6l2.8-2.8']), () => findNext(this.view)));
    box.appendChild(button('关闭（Esc）', icon(['M4.6 4.6l6.8 6.8', 'M11.4 4.6l-6.8 6.8']), () => closeSearchPanel(this.view)));
    this.dom = box;

    this.input.addEventListener('input', () => this.schedule());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) findPrevious(this.view); else findNext(this.view);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeSearchPanel(this.view);
      }
    });
  }

  /** 输入防抖：150ms 内不重复扫全文（大文本下每键都扫会拖慢打字） */
  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      const text = this.input.value;
      this.view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: text, caseSensitive: false })) });
      this.refreshCount();
    }, 150);
  }

  private refreshCount(): void {
    const q = getSearchQuery(this.view.state);
    if (!q.search) { this.countEl.textContent = ''; return; }
    const n = countMatches(this.view.state.doc.toString(), q);
    this.countEl.textContent = n < 0 ? '正则无效' : (n === 0 ? '无匹配' : (n >= 1000 ? '1000+ 处' : `${n} 处`));
  }

  mount(): void {
    // 打开时若编辑器里有选中文本，CM6 会把它当查询 ⇒ 同步进输入框
    const q = getSearchQuery(this.view.state);
    if (q.search && this.input.value !== q.search) this.input.value = q.search;
    this.refreshCount();
    this.input.focus();
    this.input.select();
  }

  update(u: ViewUpdate): void {
    // 外部改了查询（选中文字后 Ctrl+F、或 findNext 换行后）⇒ 同步显示；不动输入框内容避免打断输入
    const q = getSearchQuery(u.state);
    if (this.input.value === '' && q.search) { this.input.value = q.search; this.refreshCount(); }
    else if (u.docChanged && q.search) { this.refreshCount(); }
  }

  destroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

/** 搜索扩展：自带现代化浮层面板（Ctrl+F / Ctrl+G 由 searchKeymap 触发，见 cm-code.tsx） */
export function dshSearch(): Extension {
  return search({ top: true, createPanel: (view: EditorView) => new DshSearchPanel(view) });
}
