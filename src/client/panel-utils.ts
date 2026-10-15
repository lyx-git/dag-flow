// src/client/panel-utils.ts — FlowPanel 模块级共用工具（定时/版本/日志/参数摘要/字段表缓存/失败详情）
// 全是**模块级纯函数与常量**：不碰 React 状态、不建组件；FlowPanel 主体与 NodeInspector/弹窗渲染共用。
// 2026-10-14 重构轮 6 自 FlowPanel.tsx 纯搬运拆出（FlowPanelProps 仍留在 FlowPanel.tsx）。

import { createElement } from 'react';

// ================= 定时任务：显示用小工具 =================

/** 本机时间简写：今天 09:00 / 明天 09:00 / 10-07 09:00 */
export function fmtWhen(iso?: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const d = new Date(t);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const dayDiff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
  if (dayDiff === 0) return `今天 ${hm}`;
  if (dayDiff === 1) return `明天 ${hm}`;
  if (dayDiff === -1) return `昨天 ${hm}`;
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hm}`;
}

/** 「12s 前」这类相对时间（调度器心跳显示用） */
export function fmtAgo(iso?: string | null): string {
  if (!iso) return '还没跑过';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '还没跑过';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s 前`;
  if (s < 3600) return `${Math.round(s / 60)}min 前`;
  return `${Math.round(s / 3600)}h 前`;
}

/** 上次运行结果的中文摘要（含耗时与失败原因） */
export function fmtLastRun(lastRun?: { status?: string; durationMs?: number; error?: string } | null): string {
  if (!lastRun) return '还没跑过';
  const dur = typeof lastRun.durationMs === 'number' ? `（${(lastRun.durationMs / 1000).toFixed(1)}s）` : '';
  if (lastRun.status === 'success') return `✓ 成功${dur}`;
  if (lastRun.status === 'failed') return `✗ 失败${dur}${lastRun.error ? '：' + lastRun.error : ''}`;
  if (lastRun.status === 'skipped') return '⏭ 本次跳过（上一次还没跑完）';
  return `⚠ 出错${dur}${lastRun.error ? '：' + lastRun.error : ''}`;
}

// ★ 必填标识（2026-10-02 用户需求：必填输入框名称前加红星；纯视觉标识，不改校验语义）
export const reqMark = () => createElement('span', { className: 'dsh-wf-req-mark', title: '必填' }, '*');

/** 版本数据落盘位置展示串（跟随服务端目录分隔符；2026-10-01 夜弹窗标注用） */
export function verDisplayPath(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  const base = dir.replace(/[\\/]+$/, '');
  return `${base}${sep}versions${sep}${name}${sep}<时间戳>.json`;
}

/** 展示用路径拼接（跟随服务端目录分隔符） */
export function joinDisplay(dir: string, file: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  return `${dir.replace(/[\\/]+$/, '')}${sep}${file}`;
}

/** 打开 .dag-flow 下的数据文件夹（2026-10-11 用户需求：「标记一下数据的存放位置，可以点一下直接打开文件夹」）。
 *  sub = 相对 .dag-flow 的子目录（'' = 根，如 schedules.json 就在根下）；越界由宿主 resolveDagFlowSub 拦下（400）。
 *  失败走**应用内顶部浮窗**（项目铁律：禁用原生 alert/confirm）。 */
export function openFolderAt(sub: string, onFail: (msg: string) => void): void {
  fetch('/api/dag-flow/open-folder', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sub }),
  })
    .then(async (r) => {
      if (r.ok) return;
      const j: any = await r.json().catch(() => null);
      throw new Error(String(j?.error ?? `HTTP ${r.status}`));
    })
    .catch((e) => onFail(`打开文件夹失败：${(e as Error).message}`));
}

/** 「📁 数据存于 …（打开文件夹）」整行——🕘 历史版本 / ⏰ 定时任务 / 🧾 运行日志 三个弹窗共用同一样式与行为 */
export function dataPathRow(text: string, sub: string, onFail: (msg: string) => void): any {
  return createElement('div', {
    className: 'dag-flow-picker-hint dsh-wf-data-path',
    style: { fontSize: 10, flex: 'none', fontFamily: 'ui-monospace, Consolas, monospace' },
    title: '点击打开所在文件夹',
    onClick: () => openFolderAt(sub, onFail),
  },
    `📁 数据存于 ${text}`,
    createElement('span', { className: 'dsh-wf-data-path-go' }, '打开文件夹'),
  );
}

/** 节点显示标识：显示名_id（label 缺失或与 id 相同则只用 id）——与失败详情的标识规则一致 */
export function displayTag(def: { nodes?: { id: string; label?: string }[] } | null | undefined, id: string): string {
  const label = def?.nodes?.find((n) => n.id === id)?.label;
  return label && label !== id ? `${label}_${id}` : id;
}

/** 运行失败详情全文（失败弹窗正文，2026-10-02）：优先执行器错误串；否则从 RunSummary
 *  提取汇总错误 + 逐节点失败明细（画布徽标只标了状态，弹窗里给出每个节点的失败原因）。
 *  ★ 节点标识统一「显示名_节点id」格式（2026-10-02 用户指定：【失败原因：显示名_id】
 *    【失败节点：显示名_id】，让用户一眼定位是哪个节点出问题）；未设 label 回退只显示 id。 */
export function runFailureDetail(
  runResult: { status: string; summary?: unknown; error?: string } | null,
  def?: { nodes?: { id: string; label?: string }[] },
): string {
  if (!runResult) return '';
  if (runResult.error) return runResult.error;
  const s = runResult.summary as
    | { status?: string; error?: { code?: string; message?: string; nodeId?: string }; results?: Record<string, { status?: string; error?: { code?: string; message?: string } }> }
    | null | undefined;
  if (!s) return '运行失败（无详细信息）';
  // 节点标识：显示名_id（label 与 id 相同时只显示 id，避免重复）
  const nodeTag = (id: string): string => {
    const label = def?.nodes?.find((n) => n.id === id)?.label;
    return label && label !== id ? `${label}_${id}` : id;
  };
  const lines: string[] = [];
  const failed = Object.entries(s.results ?? {}).filter(([, r]) => r?.status === 'failed');
  // 单节点失败：按用户指定的标题格式——失败节点 / 失败原因 都带「显示名_id」
  if (failed.length === 1 && failed[0] !== undefined) {
    const [id, r] = failed[0];
    const tag = nodeTag(id);
    lines.push(`【失败节点：${tag}】`);
    lines.push(`【失败原因：${tag}】${r.error?.code ? r.error.code + '：' : ''}${r.error?.message ?? '未知错误'}`);
    return lines.join('\n');
  }
  // 多节点失败：逐行带节点标识
  if (failed.length > 1) {
    lines.push(`【失败节点（${failed.length}）】`);
    for (const [id, r] of failed) {
      lines.push(`· 【${nodeTag(id)}】${r.error?.code ? r.error.code + '：' : ''}${r.error?.message ?? '未知错误'}`);
    }
    return lines.join('\n');
  }
  // 无节点级失败（如工作流参数校验失败 / DAG 成环等运行级错误）：显示汇总原因
  if (s.error?.message) {
    const who = s.error.nodeId ? `：${nodeTag(s.error.nodeId)}` : '';
    lines.push(`【失败原因${who}】${s.error.code ? s.error.code + '：' : ''}${s.error.message}`);
  }
  if (lines.length === 0) lines.push(`工作流以「${s.status ?? 'failed'}」状态结束（无节点级错误）`);
  return lines.join('\n');
}

/** 参数摘要（只读一行，2026-10-11）：面板里不再放可编辑的 JSON 框（同一件事只留一个入口），
 *  这里只告诉用户"有哪些参数、长文本多长"，真正的编辑在「✏️ 编辑参数」弹窗里做。 */
export function paramsSummary(params: Record<string, unknown> | undefined): string {
  const entries = Object.entries(params ?? {});
  if (!entries.length) return '还没有参数——点上面的按钮添加';
  return entries.map(([k, v]) => {
    if (typeof v === 'string') return v.includes('\n') || v.length > 24 ? `${k}（${v.length} 字符）` : `${k}: ${v}`;
    if (v === null || v === undefined) return `${k}: ${String(v)}`;
    if (typeof v === 'object') { try { return `${k}: ${JSON.stringify(v)}`; } catch { return `${k}: …`; } }
    return `${k}: ${String(v)}`;
  }).join(' · ');
}

/** python/bash 的代码摘要（只读一行，2026-10-11 方案 A）：面板不再放"代码文件"输入框与"编辑代码"按钮，
 *  它们都在「🧪 参数与试跑」弹窗里改；这里只告诉用户当前用的是文件还是内联代码。 */
export function codeSummary(params: Record<string, unknown> | undefined, workflowName: string): string {
  const p = params ?? {};
  const cp = typeof p.codePath === 'string' ? p.codePath.trim() : '';
  const code = typeof p.code === 'string' ? p.code : '';
  if (cp) return `用文件：${cp}（优先于内联代码）`;
  if (code.trim()) return `内联代码：${code.split('\n').length} 行 · ${code.length} 字符`;
  return `还没写代码——打开「🧪 参数与试跑」在 code 行直接写（或填 codePath 指向 scripts/${workflowName || '工作流名'}/xxx.py）`;
}

// ★ 2026-10-15：TABS（画布/JSON 标签组）已删除——画布/JSON 拆成头部独立按钮（用户要求「都放成独立按钮」），
//   图标直接写在 FlowPanel 头部（JSON 图标候选拍板后替换）

// ================= 运行日志（2026-10-04 用户需求：「工作流执行黑盒」） =================
// 用户原话：「现在每个节点的执行情况没有日志打印，参数传递是否正常，下个节点接收参数是否正常
//           都没有日志可以看到，无法判断流程中间执行日志情况，节点之间的交互情况也没有，工作流执行黑盒」。
// 展示口径：每个节点一条——原始入参（含 {{}} 引用）→ 实际入参（模板已展开）→ 引用了哪些上游
//           （= 节点之间的交互）→ 出参 / 错误 / 耗时。数据来自 host 的 GET /api/dag-flow/run/log。
/** 日志值 → 可读文本（对象 JSON 缩进，字符串原样） */
export function fmtLogValue(v: unknown): string {
  if (v === undefined) return '（无）';
  if (v === null) return 'null';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v, null, 2) ?? String(v); } catch { return String(v); }
}

/**
 * ★ 2026-10-09 性能优化（用户拍板做）：日志检索串**按条目对象引用缓存**。
 * 原实现每次筛选都对**每一条**日志现场 `JSON.stringify(...).toLowerCase()` ✗ ——
 * 日志条目里带 `rawParams`/`params`/`out`（单字段上限 4000 字），大图上每敲一个字都要全量重序列化。
 * 用 WeakMap 按对象引用缓存：条目没换 → 直接命中；条目被新数组替换 → 旧键自动回收（不泄漏 ✓）。
 */
const logSearchCache = new WeakMap<object, string>();
export function logSearchText(e: unknown): string {
  if (e && typeof e === 'object') {
    const hit = logSearchCache.get(e as object);
    if (hit !== undefined) return hit;
    let s = '';
    try { s = JSON.stringify(e).toLowerCase(); } catch { s = ''; }
    logSearchCache.set(e as object, s);
    return s;
  }
  return String(e ?? '').toLowerCase();
}

/** 字段表类型（fieldsFor 系列共用） */
export type FieldRow = { path: string; desc: string; sample?: string };
export type FieldTable = { list: FieldRow[]; live: boolean; skipped: number };

/**
 * ★ 2026-10-09 性能优化（用户拍板做）：字段表缓存按 **runOuts 的对象身份** 分桶。
 * `fieldsFor` 只依赖 runOuts（outSpecOf 只看 type、上游字段清单在 key 里）→ 身份分桶天然正确：
 * runOuts 换了新对象就是新桶，绝不会读到旧值 ✓。用 WeakMap 保证旧桶随对象回收（不泄漏 ✓）。
 * 空 runOuts（`{}` 每次都新）会每次新建空 Map —— 属于廉价退化，不做特殊处理 ✓。
 */
const fieldsCacheByOuts = new WeakMap<object, Map<string, FieldTable>>();
export function fieldsCacheOf(runOuts: unknown): Map<string, FieldTable> {
  if (!runOuts || typeof runOuts !== 'object') return new Map();
  const key = runOuts as object;
  let m = fieldsCacheByOuts.get(key);
  if (!m) { m = new Map(); fieldsCacheByOuts.set(key, m); }
  return m;
}

/** 引用关系 → 一行文字（节点/变量/工作流输入） */
export function fmtRefs(refs: { nodeRefs?: string[]; varsUsed?: string[]; inputsUsed?: string[] } | undefined): string {
  if (!refs) return '';
  const parts = [
    ...(refs.nodeRefs ?? []).map((x) => `节点 ${x}`),
    ...(refs.varsUsed ?? []).map((x) => `变量 ${x}`),
    ...(refs.inputsUsed ?? []).map((x) => `输入 ${x}`),
  ];
  return parts.join('、');
}

/** 状态 → 中文标签 */
export function logStatusLabel(s?: string): string {
  return s === 'success' ? '成功' : s === 'failed' ? '失败' : s === 'skipped' ? '跳过' : s === 'running' ? '运行中' : (s || '—');
}

/** 单节点日志 → 纯文本（📋 复制用） */
export function logEntryText(e: { id?: string; type?: string; status?: string; durationMs?: number; refs?: { nodeRefs?: string[]; varsUsed?: string[]; inputsUsed?: string[] }; rawParams?: unknown; params?: unknown; out?: unknown; error?: { code?: string; message?: string }; tolerated?: boolean; truncated?: string[] }): string {
  const L: string[] = [];
  L.push(`【${e?.id ?? '?'}${e?.type ? ` (${e.type})` : ''} · ${e?.status ?? '运行中'}${typeof e?.durationMs === 'number' ? ` · ${e.durationMs}ms` : ''}】`);
  const refs = fmtRefs(e?.refs);
  if (refs) L.push(`引用上游：${refs}`);
  if (e?.rawParams !== undefined) L.push(`原始参数（含模板引用）：\n${fmtLogValue(e.rawParams)}`);
  if (e?.params !== undefined) L.push(`实际入参（模板已展开）：\n${fmtLogValue(e.params)}`);
  if (e?.out !== undefined) L.push(`出参：\n${fmtLogValue(e.out)}`);
  if (e?.error) L.push(`错误：[${e.error.code ?? ''}] ${e.error.message ?? ''}`);
  if (e?.tolerated) L.push('（该节点失败但已容错放行）');
  if (Array.isArray(e?.truncated) && e.truncated.length) L.push(`（字段已截断：${e.truncated.join('、')}）`);
  return L.join('\n');
}

/** 整份日志 → 纯文本 */
export function runLogText(entries: unknown[]): string {
  return (entries ?? []).map((e) => logEntryText(e as never)).join('\n\n');
}

/** 分组标题里「显示名」的截断：超过 maxLen 只保留前段 + …（能区分即可），全名走悬浮 title。
 *  （2026-10-13 用户要求：「显示名超过长度了，就只显示前面能区分的字符，多余的部分就...显示，浮窗显示全名」） */
export function truncLabel(s: string, maxLen = 10): string {
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}
