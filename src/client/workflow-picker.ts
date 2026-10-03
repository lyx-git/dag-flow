// @ts-nocheck
// src/client/workflow-picker.ts
// 「打开 / 新建工作流」入口弹窗 —— v2：组合式输入框（combobox）
//   一个输入框同时承担两件事：
//   - 下拉：聚焦/输入时弹出候选列表（已有工作流 JSON，按子串过滤，点击打开）
//   - 直接输入：输入的名称若不存在，列表首行出现「➕ 创建」，回车即创建
// 2026-10-01 晚：移除底部「取消/打开」按钮行——关闭走右上角 ✕ / Esc / 点遮罩
// 纯 DOM 实现，样式走 --wf-* token + 自带 <style>。

import type { WorkflowDef } from './types';
import { normalizeWorkflowName as normalizeName } from '../name-rule';

const API = '/api/dag-flow/workflows';

/** 下拉候选项：name + 节点数 + 落盘路径（2026-10-03 用户需求：名称后置灰显示所在路径） */
interface PickerWorkflow { name: string; nodes: number; path?: string }

/** 路径拼接：跟随目录自身的分隔符（Windows 反斜杠），避免出现 `…\workflow/名.json` 混搭 */
function joinPath(dir: string, name: string): string {
  if (!dir) return '';
  const sep = dir.includes('\\') ? '\\' : '/';
  return `${dir.replace(/[\\/]+$/, '')}${sep}${name}.json`;
}

/** 工作流名/路径进 innerHTML 前转义（名称规则已限字符集，但目录路径来自文件系统） */
function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
const PICKER_CSS_ID = 'dag-flow-picker-styles';
const PICKER_CSS = `
.dag-flow-picker-overlay { position: fixed; inset: 0; z-index: 10000; display: flex;
  align-items: flex-start; justify-content: center; padding-top: 14vh;
  background: rgba(4, 9, 20, 0.55); backdrop-filter: blur(2px); }
.dag-flow-picker { width: 680px; max-width: calc(100vw - 40px); border-radius: 14px;
  background: var(--wf-panel, #101a2b); border: 1px solid var(--wf-border-strong, #2a3a56);
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.45); overflow: hidden;
  font-family: inherit; color: var(--wf-text, #e6edf7); }
.dag-flow-picker-title { padding: 16px 20px 10px; font-size: 15px; font-weight: 600;
  display: flex; align-items: center; gap: 8px; }
.dag-flow-picker-body { padding: 4px 20px 16px; position: relative; }
.dag-flow-picker-hint { font-size: 12px; color: var(--wf-muted, #8b9bb3); margin: 2px 0 10px; line-height: 1.6; }
.dag-flow-combo { position: relative; }
.dag-flow-combo input { width: 100%; box-sizing: border-box; padding: 10px 14px; border-radius: 8px;
  border: 1px solid var(--wf-border, #22304a); background: var(--wf-bg, #0b1120);
  color: var(--wf-text, #e6edf7); font-size: 14px; outline: none;
  font-family: ui-monospace, Consolas, monospace; }
.dag-flow-combo input:focus { border-color: var(--wf-accent, #4f8cff); }
.dag-flow-combo-list { margin-top: 4px; max-height: 170px; overflow-y: auto; border-radius: 8px;
  background: var(--wf-panel2, #162135); border: 1px solid var(--wf-border-strong, #2a3a56);
  box-shadow: var(--wf-shadow, 0 4px 16px rgba(0, 0, 0, 0.32)); }
.dag-flow-combo-list::-webkit-scrollbar { width: 8px; }
.dag-flow-combo-list::-webkit-scrollbar-track { background: transparent; }
.dag-flow-combo-list::-webkit-scrollbar-thumb { background: var(--wf-border-strong, #2a3a56); border-radius: 4px; }
.dag-flow-combo-list::-webkit-scrollbar-thumb:hover { background: var(--wf-accent, #4f8cff); }
.dag-flow-combo-row { display: flex; align-items: center; gap: 8px; padding: 7px 12px;
  font-size: 12px; line-height: 20px; cursor: pointer; color: var(--wf-text, #e6edf7);
  max-height: 40px; overflow: hidden;
  transition: opacity 0.15s ease, max-height 0.15s ease, padding 0.15s ease; }
.dag-flow-combo-row.del-out { opacity: 0; max-height: 0; padding-top: 0; padding-bottom: 0; }
.dag-flow-combo-row:hover, .dag-flow-combo-row.hl { background: color-mix(in srgb, var(--wf-accent, #4f8cff) 16%, transparent); }
.dag-flow-combo-row .meta { color: var(--wf-muted, #8b9bb3); font-size: 11px; margin-left: auto; }
/* 落盘路径：紧跟名称、置灰（2026-10-03 用户需求）——单行省略，完整路径在 title 里 */
.dag-flow-combo-row .path { color: var(--wf-muted, #8b9bb3); opacity: 0.82; font-size: 11px;
  flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: ui-monospace, Consolas, monospace; }
.dag-flow-combo-row .cp { margin-left: 6px; flex: none; width: 22px; height: 22px; border-radius: 6px;
  border: none; background: transparent; color: var(--wf-muted, #8b9bb3); cursor: pointer;
  font-size: 12px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; padding: 0; }
.dag-flow-combo-row .cp:hover { background: color-mix(in srgb, var(--wf-accent, #4f8cff) 18%, transparent);
  color: var(--wf-accent, #4f8cff); }
.dag-flow-combo-row .del { margin-left: 6px; flex: none; width: 22px; height: 22px; border-radius: 6px;
  border: none; background: transparent; color: var(--wf-muted, #8b9bb3); cursor: pointer;
  font-size: 12px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; padding: 0; }
.dag-flow-combo-row .del:hover { background: color-mix(in srgb, var(--wf-danger, #f87171) 18%, transparent);
  color: var(--wf-danger, #f87171); }
.dag-flow-combo-row.confirming { background: color-mix(in srgb, var(--wf-danger, #f87171) 12%, transparent); }
.dag-flow-combo-row .confirm-text { color: var(--wf-danger, #f87171); font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dag-flow-combo-row .confirm-btn { flex: none; padding: 3px 10px; border-radius: 6px; font-size: 11px;
  cursor: pointer; line-height: 1.4; }
.dag-flow-combo-row .confirm-btn.del-no { background: var(--wf-panel2, #162135);
  border: 1px solid var(--wf-border-strong, #2a3a56); color: var(--wf-text, #e6edf7); }
.dag-flow-combo-row .confirm-btn.del-yes { background: var(--wf-danger, #f87171); color: #fff; border: none; font-weight: 600; }
.dag-flow-combo-row.create { color: var(--wf-accent, #4f8cff); font-weight: 600; }
.dag-flow-combo-empty { padding: 8px 10px; font-size: 12px; color: var(--wf-muted, #8b9bb3); }
.dag-flow-picker-err { color: var(--wf-danger, #f87171); font-size: 11px; margin-top: 6px; min-height: 14px; }
.dag-flow-picker-close { margin-left: auto; flex: none; width: 26px; height: 26px; border-radius: 8px;
  border: none; background: transparent; color: var(--wf-muted, #8b9bb3); cursor: pointer;
  font-size: 13px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; }
.dag-flow-picker-close:hover { background: color-mix(in srgb, var(--wf-accent, #4f8cff) 16%, transparent);
  color: var(--wf-text, #e6edf7); }
/* —— 版本历史弹窗（dag-flow-picker-ver，2026-10-01 夜）—— */
.dag-flow-picker-ver-list::-webkit-scrollbar { width: 8px; }
.dag-flow-picker-ver-list::-webkit-scrollbar-track { background: transparent; }
.dag-flow-picker-ver-list::-webkit-scrollbar-thumb { background: var(--wf-border-strong, #2a3a56); border-radius: 4px; }
.dag-flow-picker-ver-list::-webkit-scrollbar-thumb:hover { background: var(--wf-accent, #4f8cff); }
.dag-flow-picker-resize-y { flex: none; height: 10px; margin: 0 14px; position: relative;
  cursor: ns-resize; touch-action: none; }
.dag-flow-picker-resize-y::after { content: ''; position: absolute; left: 50%; top: 3px; transform: translateX(-50%);
  width: 30px; height: 3px; border-radius: 2px; background: var(--wf-border-strong, #2a3a56);
  transition: background 0.15s ease; }
.dag-flow-picker-resize-y:hover::after { background: var(--wf-accent, #4f8cff); }
`;

export function ensurePickerStyles(): void {
  if (document.getElementById(PICKER_CSS_ID)) return;
  const s = document.createElement('style');
  s.id = PICKER_CSS_ID;
  s.textContent = PICKER_CSS;
  document.head.appendChild(s);
}

/** 新建用最小工作流（start → end，满足 host 校验 nodes>=2） */
function minimalWorkflow(name: string): WorkflowDef {
  return {
    name,
    version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'end' },
      { id: 'end', type: 'end' },
    ],
  } as WorkflowDef;
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, { credentials: 'include', ...init });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`请求失败（HTTP ${res.status}）${body ? `: ${body.slice(0, 120)}` : ''}`);
  }
  return res.json();
}

// normalizeName 自 2026-10-01 起统一引用 src/name-rule.ts（支持中文命名）

/**
 * 打开「打开 / 新建工作流」组合输入弹窗。
 * @param onOpen 用户选定/创建完成 → 回调拿到 WorkflowDef（面板以它为初始内容）
 */
export function openWorkflowPicker(onOpen: (def: WorkflowDef) => void): void {
  if (document.querySelector('.dag-flow-picker-overlay')) return; // 已开
  ensurePickerStyles();

  const overlay = document.createElement('div');
  overlay.className = 'dag-flow-picker-overlay';
  const card = document.createElement('div');
  card.className = 'dag-flow-picker';
  card.innerHTML = `
    <div class="dag-flow-picker-title">⚡ 打开 / 新建工作流<button class="dag-flow-picker-close" type="button" title="关闭 (Esc)">✕</button></div>
    <div class="dag-flow-picker-body">
      <div class="dag-flow-picker-hint">下拉选择已有工作流打开；输入名称后回车创建（支持中文/字母/数字/连字符）。</div>
      <div class="dag-flow-combo">
        <input type="text" placeholder="输入名称，或 ↓ 选择已有工作流" maxlength="64" autocomplete="off">
        <div class="dag-flow-combo-list" style="display:none"></div>
      </div>
      <div class="dag-flow-picker-err"></div>
    </div>`;
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const close = (): void => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  card.querySelector('.dag-flow-picker-close')!.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });

  const body = card.querySelector('.dag-flow-picker-body') as HTMLElement;
  const input = body.querySelector('input') as HTMLInputElement;
  const listBox = body.querySelector('.dag-flow-combo-list') as HTMLElement;
  const err = body.querySelector('.dag-flow-picker-err') as HTMLElement;

  let workflows: PickerWorkflow[] = [];
  /** 工作流落盘目录（列表接口回带；复制出新工作流时据此推算它的路径） */
  let storageDir = '';
  let hlIndex = -1; // 键盘高亮行
  let busy = false;
  let listLoadFailed = false; // 列表拉取失败时无法本地判断「已存在」，创建前需探测

  const setOpenErr = (msg: string): void => { err.textContent = msg; };
  // 2026-10-01 晚：底部「取消/打开/创建」按钮行整体移除（用户反馈没用）——
  // 打开=点列表行，创建=输入名称后回车或点 ➕ 行，关闭=右上角 ✕ / Esc / 点遮罩。
  // 原 setFoot/syncFoot/primaryAction 三态按钮机制随之删除；busy 保留防重复提交。

  /** 打开已有工作流 */
  const openExisting = async (name: string): Promise<void> => {
    busy = true;
    try {
      const data = await fetchJson(`${API}/${encodeURIComponent(name)}`);
      close();
      onOpen(data.workflow);
    } catch (e) {
      busy = false;
      setOpenErr(`读取失败：${(e as Error).message}`);
    }
  };

  /** 创建新工作流（最小 start→end） */
  const createNew = async (rawName: string): Promise<void> => {
    const name = normalizeName(rawName);
    if (!name) { setOpenErr('名称为空（支持中文/字母/数字/连字符）'); return; }
    busy = true;
    try {
      // 列表拉取失败时本地无法判断「已存在」——先探测：已存在则直接打开，
      // 防止最小模板把已有工作流覆盖掉（save 是覆盖语义）
      if (listLoadFailed) {
        const probe = await fetch(`${API}/${encodeURIComponent(name)}`, { credentials: 'include' });
        if (probe.ok) {
          const data = await probe.json();
          close();
          onOpen(data.workflow);
          return;
        }
      }
      const def = minimalWorkflow(name);
      const data = await fetchJson(`${API}/save`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, def }),
      });
      close();
      onOpen({ ...def, name: data.name ?? name });
    } catch (e) {
      busy = false;
      setOpenErr(`创建失败：${(e as Error).message}`);
    }
  };

  /** 构建下拉行内层：名称 + 落盘路径（置灰）+ 节点数 + 行尾 ⧉复制 + 🗑 删除（取消确认态时也用它恢复原行） */
  const buildRowInner = (row: HTMLDivElement, w: PickerWorkflow): void => {
    row.classList.remove('confirming');
    row.dataset.name = w.name;
    // 路径紧跟名称、以 .path 置灰显示（单行省略号；完整路径放 title 便于悬停查看）
    const pathHtml = w.path
      ? ` <span class="path" title="${escapeHtml(w.path)}">${escapeHtml(w.path)}</span>`
      : '';
    row.innerHTML = `📄 ${escapeHtml(w.name)}${pathHtml} <span class="meta">${w.nodes} 节点</span>`;
    // ★ 复制（2026-10-01 深夜从管理视图移植）：生成一模一样的工作流 <名>-copy（冲突递增）
    const cp = document.createElement('button');
    cp.type = 'button';
    cp.className = 'cp';
    cp.title = `复制「${w.name}」`;
    cp.textContent = '⧉';
    cp.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); });
    cp.addEventListener('click', (e) => { e.stopPropagation(); void copyWorkflow(w); });
    row.appendChild(cp);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'del';
    del.title = `删除「${w.name}」`;
    del.textContent = '🗑';
    del.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); });
    del.addEventListener('click', (e) => { e.stopPropagation(); enterConfirm(row, w); });
    row.appendChild(del);
  };

  /** 行内确认态（替代原生 confirm 的突兀系统弹窗）：删除→DELETE+退场动画；取消→恢复原行 */
  const enterConfirm = (row: HTMLDivElement, w: { name: string; nodes: number }): void => {
    row.classList.add('confirming');
    row.innerHTML = '';
    const text = document.createElement('span');
    text.className = 'confirm-text';
    text.textContent = `删除「${w.name}」？`;
    const yes = document.createElement('button');
    yes.type = 'button'; yes.className = 'confirm-btn del-yes'; yes.textContent = '删除';
    yes.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); });
    yes.addEventListener('click', (e) => {
      e.stopPropagation();
      void deleteWorkflow(w).then((ok) => { if (!ok) buildRowInner(row, w); });
    });
    const no = document.createElement('button');
    no.type = 'button'; no.className = 'confirm-btn del-no'; no.textContent = '取消';
    no.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); });
    no.addEventListener('click', (e) => { e.stopPropagation(); buildRowInner(row, w); });
    row.append(text, no, yes);
  };

  /** 复制工作流（2026-10-01 深夜从管理视图移植）：GET 原内容 → <名>-copy（冲突递增 -copy-2/-copy-3…）
   *  → POST 保存（snapshot:false 不产版本）→ 原行后插入新行（不整表重建，避免其余行闪现） */
  const copyWorkflow = async (w: PickerWorkflow): Promise<void> => {
    if (busy) return;
    busy = true;
    setOpenErr('');
    try {
      const data = await fetchJson(`${API}/${encodeURIComponent(w.name)}`);
      const src = data.workflow ?? {};
      const names = new Set(workflows.map((x) => x.name));
      let copyName = normalizeName(`${w.name}-copy`);
      let i = 2;
      while (names.has(copyName)) copyName = normalizeName(`${w.name}-copy-${i++}`);
      await fetchJson(`${API}/save`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: copyName, def: { ...src, name: copyName }, snapshot: false }),
      });
      const item = { name: copyName, nodes: Array.isArray(src.nodes) ? src.nodes.length : 0, path: joinPath(storageDir, copyName) };
      workflows = [...workflows, item];
      const rowEl = Array.from(listBox.querySelectorAll('.dag-flow-combo-row'))
        .find((r) => r.dataset.name === w.name);
      const newRow = document.createElement('div');
      newRow.className = 'dag-flow-combo-row';
      newRow.addEventListener('mousedown', (e) => { e.preventDefault(); void openExisting(item.name); });
      buildRowInner(newRow, item);
      if (rowEl && rowEl.parentNode) rowEl.parentNode.insertBefore(newRow, rowEl.nextSibling);
      else renderList();
      busy = false;
    } catch (e) {
      busy = false;
      setOpenErr(`复制失败：${(e as Error).message}`);
    }
  };

  /** 执行删除：DELETE 成功 → 本地过滤 + 该行退场动画后单独移除（不整表重建，避免其余行闪现） */
  const deleteWorkflow = async (w: PickerWorkflow): Promise<boolean> => {
    try {
      const res = await fetch(`${API}/${encodeURIComponent(w.name)}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`请求失败（HTTP ${res.status}）${body ? `: ${body.slice(0, 120)}` : ''}`);
      }
      workflows = workflows.filter((x) => x.name !== w.name);
      const rowEl = Array.from(listBox.querySelectorAll('.dag-flow-combo-row'))
        .find((r) => r.dataset.name === w.name);
      if (rowEl) {
        rowEl.classList.add('del-out');
        setTimeout(() => { rowEl.remove(); }, 170);
      }
      return true;
    } catch (e) {
      setOpenErr(`删除失败：${(e as Error).message}`);
      return false;
    }
  };

  /** 渲染下拉候选：创建行（输入非空且非精确匹配时）+ 过滤后的已有列表 */
  const renderList = (): void => {
    const text = normalizeName(input.value);
    const matches = workflows.filter((w) => !text || w.name.includes(text));
    const exact = workflows.find((w) => w.name === text);
    const rows: HTMLElement[] = [];

    if (text && !exact) {
      const create = document.createElement('div');
      create.className = 'dag-flow-combo-row create';
      create.innerHTML = `➕ 创建「${text}」`;
      create.addEventListener('mousedown', (e) => { e.preventDefault(); void createNew(text); });
      rows.push(create);
    }
    for (const w of matches.slice(0, 30)) {
      const row = document.createElement('div');
      row.className = 'dag-flow-combo-row';
      row.addEventListener('mousedown', (e) => { e.preventDefault(); void openExisting(w.name); });
      buildRowInner(row, w);
      rows.push(row);
    }
    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'dag-flow-combo-empty';
      empty.textContent = text ? '无匹配——回车创建' : '工作区暂无工作流——输入名称创建第一个';
      rows.push(empty);
    }
    listBox.innerHTML = '';
    rows.forEach((r) => listBox.appendChild(r));
    hlIndex = -1;
  };

  const showList = (): void => { renderList(); listBox.style.display = 'block'; };
  const hideList = (): void => { listBox.style.display = 'none'; };

  input.addEventListener('focus', showList);
  input.addEventListener('input', () => { setOpenErr(''); showList(); });
  input.addEventListener('blur', () => setTimeout(hideList, 150)); // 留给 mousedown 触发
  input.addEventListener('keydown', (e) => {
    const rows = [...listBox.querySelectorAll('.dag-flow-combo-row')] as HTMLElement[];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!rows.length) return;
      hlIndex = e.key === 'ArrowDown' ? Math.min(hlIndex + 1, rows.length - 1) : Math.max(hlIndex - 1, 0);
      rows.forEach((r, i) => r.classList.toggle('hl', i === hlIndex));
      rows[hlIndex]?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const target = hlIndex >= 0 ? rows[hlIndex] : rows.find((r) => r.classList.contains('create')) ?? rows[0];
      target?.dispatchEvent(new Event('mousedown'));
    }
  });

  // 初始：拉取工作流列表并聚焦输入框（空列表也能直接输入创建）
  // ★ 2026-10-01 深夜：无条件渲染并显示列表——原来依赖 focus 事件触发，headless/程序化场景
  //   focus 不派发就永远不出列表（且与「下拉列表默认可见」的既有偏好一致）
  fetchJson(API)
    .then((data) => {
      workflows = data.workflows ?? [];
      storageDir = data.storage?.dir ?? '';
      input.focus();
      renderList();
      listBox.style.display = 'block';
    })
    .catch((e) => {
      listLoadFailed = true;
      setOpenErr(`查询失败：${(e as Error).message}（仍可输入名称创建）`);
    });
}
