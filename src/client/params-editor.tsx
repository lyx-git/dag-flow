// src/client/params-editor.tsx
// 参数编辑器弹窗（2026-10-11 用户拍板）——用户原话：「每个节点都有参数这个输入框，这个输入框能否
// 独立出来，做成富文本框的形式，不管是新增或编辑，都比较方便」，并明确「富文本编辑框是那种类似
// 代码级的富文本编辑框，也不是 word 编辑框」。
//
// 形态：从右侧窄面板里独立出来的大编辑窗（1100px），两个页签——
//   · 字段视图：每个参数一行（参数名可改 + 值直接写 + ✕ 删 + 底部 + 新增）；长文本/对象值用代码级编辑框
//   · JSON 视图：整份 params 的 JSON，行号 + 高亮（一次粘贴一大段时用）
// 写回：沿用 FlowPanel.handleNodeChange 的既有语义——**浅合并 + null 表示删除键**，所以这里发的是
//   「差异补丁」：新增/改值传值，被删掉的键传 null。字符串值永远按字符串存（不猜 JSON），
//   非字符串值（数字/布尔/对象/数组）按 JSON 解析。
import { Fragment, useRef, useState } from 'react';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { CodeText } from './code-text';
import type { CodeLang } from './code-text';
// ★ 2026-10-11 用户拍板方案 A：变量引用搬进参数弹窗（右侧抽屉），点变量**插入到当前值框的光标处**
//   （面板里那行「🔗 变量引用」保留，两处共用同一套数据与视觉；分组数据由 FlowPanel 组装后传入）。
import { VarPicker } from './var-picker';
import type { VarPickGroup } from './var-picker';
// ★ 2026-10-11 用户拍板方案 A：试跑本节点集成进本弹窗（底部常驻试跑条）——输入按工作流参数逐字段填、
//   参数与试跑同屏、结果就地展开；结果块与面板结果区共用同一个组件。
import { TestResultView } from './test-result';
// ★ 2026-10-15 用户拍板「复制反馈在按钮本身」：公共复制（Clipboard→execCommand 兜底）+ 按钮文字态 hook
import { useCopyFlash } from './use-copy-flash';
import type { TestResult } from './test-result';
// ★ 2026-10-16 用户拍板「方案 A」：图片类参数支持从**统一图片目录**勾选多张（替代一个个复制文件名）。
import { ImagePickerDialog } from './dialogs/image-picker';
import { InfoTip } from './info-tip';

// ★ 2026-10-16（用户拍板方案 A：去掉「T/{}」类型按钮）——Row 不再记录"按字符串还是按 JSON 存"，
//   落盘类型由**值文本自动推断**（见 valueOfText）；形态 multi 仍保留（含换行/长文本自动为多行）。
type Row = { k: string; text: string; multi: boolean; auto?: boolean; placeholder?: string };

const MULTI_THRESHOLD = 60;

// ★ 2026-10-11 图标换成**内联 SVG**（用户反馈「单行输入和多行编辑框的 icon 有点丑」）：
//   原来是字体符号 ▭（U+25AD 空心方块）与 ⤢（冷僻箭头区字符）——不属于常用字形，
//   不同字体/字号下渲染差异极大，小按钮里就成了"空心方块 + 歪箭头"。
//   现改为一对语义直白的输入框图标（描边用 currentColor，任何字体与缩放下都清晰）：
//   单行 = 扁框内一横线；多行 = 高框内三横线。
const SVG_ICON = {
  width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.5, strokeLinecap: 'round', 'aria-hidden': 'true',
} as const;

/**
 * 参数弹窗的**静态说明**（2026-10-16 用户：「解释的信息统一放到合适的地方用个小问号，单击显示解释内容，
 * 现在平铺解释信息很乱」）——原先平铺在字段视图顶部、新增按钮旁、富文本工具栏末端的三四行文字，合并进
 * 弹窗标题区的一个小问号。★动态信息（试跑态、错误、结果）仍留在外面。
 */
const PARAMS_TIPS = [
  '值里可用上游数据引用：{{节点id.out}} / {{节点id.out.字段}} / {{vars.变量}} / {{inputs.输入}}。',
  '长文本点该行框内右侧的「多行框」图标切成代码级编辑框（不用写 JSON 转义）；要改回单行，点编辑器工具栏上的「单行框」图标。',
  '值类型自动识别：纯数字、true / false、{…} / […] 会按对应类型保存，其余按原文字符串；要强制当字符串时切「JSON 视图」给值加引号。',
  'Tab = 4 空格缩进 · 改动即自动保存。',
].join('\n');

/**
 * 单行输入（扁框 + 一横线）
 */
function IconSingleLine(): ReactElement {
  return createElement('svg', SVG_ICON,
    createElement('rect', { x: 2.6, y: 5.4, width: 10.8, height: 5.2, rx: 1.3 }),
    createElement('path', { d: 'M5.4 8h5.2' }),
  );
}

/** 多行编辑框（高框 + 三横线） */
function IconMultiLine(): ReactElement {
  return createElement('svg', SVG_ICON,
    createElement('rect', { x: 2.6, y: 2.8, width: 10.8, height: 10.4, rx: 1.3 }),
    createElement('path', { d: 'M5.2 5.6h5.6M5.2 8h5.6M5.2 10.4h3.6' }),
  );
}

// ★ 2026-10-11 用户要求「富文本框的放大按钮在里面的右上角，斜双箭头，放大和缩小」——
//   这个把手已由 code-text.tsx 的 `expand` prop 渲染（编辑区内部右上角），这里不再需要额外的行内图标。

/** 非字符串值 → 可编辑文本（对象/数组缩进展示） */
function toText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') { try { return JSON.stringify(v, null, 2); } catch { return String(v); } }
  return String(v);
}

function rowsFromParams(params: Record<string, unknown>, codeLang?: CodeLang, fieldHints?: Record<string, string>, fieldPlaceholders?: Record<string, string>): Row[] {
  const rows: Row[] = Object.entries(params ?? {}).map(([k, v]) => {
    const text = toText(v);
    // ★ 2026-10-11：代码行默认就用富文本框（脚本天生多行）；其余行按内容长度自动判断——
    //   但**控件与按钮完全一致**（其它行也能点「单行/富文本」切过来）。
    // ★★ 2026-10-16（用户「已经重启了，示例占位还是没改好」的**真因**）：示例原来只在下面的**自动补行**
    //   分支写进行对象 ⇒ 只要 def 里已经有这个键（用户填过值、清空过、或早期 bug 留下的 `"images": ""`），
    //   该行就走这条 params 分支、**示例永久丢失**（看到的只是通用文案）。⇒ 按字段名**无条件**附上示例；
    //   并且**登记了示例的字段默认就是富文本框**——否则键存在且值为空时这一行会退化成单行，
    //   连示例占位和「🖼 选图」工具栏一起消失。
    const ph = fieldPlaceholders?.[k];
    const multi = (k === 'code' && !!codeLang) || !!ph || text.includes('\n') || text.length > MULTI_THRESHOLD;
    return { k, text, multi, ...(ph ? { placeholder: ph } : {}) };
  });
  // ★ 2026-10-11 方案 A：python/bash 的 `codePath` 是"二选一"的另一个入口——节点默认参数里没有这个键，
  //   但用户要能填。原面板是"永远显示输入框"，所以这里**自动补一行**（auto=true：留空时不写进 def，
  //   保持"清空 = 删键"的既有语义，也不会凭空多出 "codePath": "" 脏值）。
  if (codeLang && !rows.some((r) => r.k === 'codePath')) {
    rows.push({ k: 'codePath', text: '', multi: false, auto: true });
  }
  // ★ 2026-10-16 P1：凡是 `fieldHints` 里登记了专用说明、而 params 里还没有的键（如 subagent 的 `images`）
  //   ⇒ 自动补一行，沿用上面的 `auto` 语义：**留空不写进 def**（默认零行为变更，也不会凭空多出空键）。
  //   ★ 同日用户问「多张图片、多个路径或 URL 要怎么区分」⇒ 登记了示例的字段（fieldPlaceholders）把示例
  //     写进**占位提示**（只影响 placeholder，不进值），用户一眼看出"一行一个"。
  for (const k of Object.keys(fieldHints ?? {})) {
    if (!rows.some((r) => r.k === k)) {
      const ph = fieldPlaceholders?.[k];
      rows.push({ k, text: '', multi: true, auto: true, ...(ph ? { placeholder: ph } : {}) });
    }
  }
  return rows;
}

/** 单行输入框的占位文案（★ 2026-10-16 用户报「切换后框内示例占位没有了」⇒ 单行形态也要带示例：
 *  input 的 placeholder 不认换行，把多行示例折成一行「a / b / c」展示；没登记示例时回退通用文案） */
function singleLinePlaceholder(r: Row): string {
  if (r.placeholder) return r.placeholder.replace(/\n+/, ' ').replace(/\n+/g, ' / ');
  return '值';
}

/** 文本看起来像 JSON 对象/数组吗（只用于**语法高亮**；落盘类型判定见 valueOfText） */
function looksJsonLike(text: string): boolean {
  const s = text.trim();
  if (!/^[[{]/.test(s)) return false;
  try { const v = JSON.parse(s); return v !== null && typeof v === 'object'; } catch { return false; }
}

/**
 * 值文本 → 落盘值（★ 2026-10-16 用户拍板方案 A：**去掉「T/{}」类型按钮，改为自动推断**）。
 * 判据：纯数字样 → 数字；true/false → 布尔；`{…}`/`[…]` 且能解析 → 对象/数组；其余一律**按原文字符串**存。
 * 真机实测（5 份工作流 118 个参数）：62 个字符串里**没有一个**"看起来像数字/布尔/JSON" ⇒ 自动推断零误判。
 * ⚠ 已知代价（方案 A 时已向用户说明）：`"0012"`、`"1.0"` 这类"看起来像数字的字符串"会被存成数字——
 *   真需要字符串时切 JSON 视图手写引号即可。
 */
function valueOfText(text: string): unknown {
  const s = text.trim();
  if (s === '') return '';
  if (s !== text) return text;                                    // 有首尾空白 ⇒ 不猜，按原文存
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) return Number(s);
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;                                  // null 在 def 里＝"没有这个键"（既有语义）
  if (/^[[{]/.test(s)) {
    try { const v = JSON.parse(s); if (v !== null && typeof v === 'object') return v; } catch { /* 不合法就按字符串 */ }
  }
  return text;
}

/** 行 → params 对象（空名字的行忽略；auto 行留空则忽略；值类型由 valueOfText 自动推断） */
function paramsFromRows(rows: Row[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    const k = r.k.trim();
    if (!k) continue;
    // ★ auto 行的"留空＝没有这个参数"必须先判断（否则会往 def 里写 `"images": ""` 脏值）
    if (r.auto && r.text.trim() === '') continue;
    const v = valueOfText(r.text);
    if (v !== null) out[k] = v;                                   // null = 删键语义，不写入
  }
  return out;
}

/** 差异补丁：新对象里有就写值，旧对象里有而新对象没有就传 null（= 删键） */
function diffPatch(oldP: Record<string, unknown>, newP: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(newP)) patch[k] = v;
  for (const k of Object.keys(oldP ?? {})) if (!(k in newP)) patch[k] = null;
  return patch;
}

export function ParamsEditor({ nodeId, nodeLabel, params, varGroups = [], varHint, inputDefaults = {}, canTest = true, testRunning = false, testResult = null, codeLang, fieldHints, fieldPlaceholders, imagePickKeys, onRunTest, onParamsChange, onClose }: {
  nodeId: string;
  nodeLabel?: string;
  params: Record<string, unknown>;
  /** 变量抽屉的分组数据（与变量弹窗同源，由 FlowPanel 组装） */
  varGroups?: VarPickGroup[];
  /** ★ 2026-10-11（用户拍板删掉面板变量引用后）：抽屉顶部那行说明
   *  —— 原面板入口行的「上游 N · 输出 N · 全局 N + 口语化搜」搬来这里，跟着抽屉显示 */
  varHint?: string;
  /** 试跑输入的默认值（= 工作流参数 def.inputs）：按字段渲染输入框并预填默认值 */
  inputDefaults?: Record<string, unknown>;
  /** start/end 节点不给试跑 */
  canTest?: boolean;
  testRunning?: boolean;
  testResult?: TestResult | null;
  /** ★ 2026-10-11 方案 A：python/bash 传 'python'|'bash' ⇒ `code` 行升级成语言感知的代码编辑器 */
  codeLang?: CodeLang;
  /** 指定参数行的专用说明（如 codePath 的"约定路径 / 填了文件优先于内联代码"） */
  fieldHints?: Record<string, string>;
  /** ★ 2026-10-16：自动补行的**示例占位文本**（如 images 的三行示例）——只进 placeholder，不进值 */
  fieldPlaceholders?: Record<string, string>;
  /** ★ 2026-10-16 方案 A：这些参数行提供「🖼 选图」（从统一图片目录勾选多张，逐行写入） */
  imagePickKeys?: string[];
  /** 点「▶ 试跑本节点」时把解析好的 inputs 交给上层（参数数据取当前节点 params，由上层负责发请求） */
  onRunTest?: (inputs: Record<string, unknown>) => void;
  onParamsChange: (patch: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'fields' | 'json'>('fields');
  const [rows, setRows] = useState<Row[]>(() => rowsFromParams(params, codeLang, fieldHints, fieldPlaceholders));
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  // ★ 试跑条（方案 A）：输入按工作流参数逐字段填（默认值预填），默认收起；结果就地展开
  const [inputsOpen, setInputsOpen] = useState(false);
  // ★ 代码行「清空」的两击确认（沿用原代码编辑弹窗的防误触口径）
  const [clearArmKey, setClearArmKey] = useState<string | null>(null);
  // ★ 2026-10-11 用户要求：放大按钮在**富文本框内部右下角**（斜双箭头），点了**放大到弹窗**、遮盖其他部分。
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  // ★ 2026-10-16 方案 A：「🖼 选图」弹窗属于哪一行（null = 没开）
  const [pickKey, setPickKey] = useState<string | null>(null);
  // ★ 2026-10-15 用户拍板「复制反馈在按钮本身」：点复制 → 按钮文字变「✓ 已复制」/「✗ 失败」1.4s（每行独立 key）
  const { flash: copyFlash, copy } = useCopyFlash();
  /** 富文本框工具条（行内与放大弹窗共用）：复制 / 清空（两击确认）按钮 + Tab 提示。
   *  ★ 2026-10-15 二次拍板：全部统一成「📋 复制」「🧹 清空」格式（emoji+文字），大小对齐结果卡复制按钮，
   *  反馈在按钮本身（✓ 已复制 / ✗ 复制失败 1.4s），颜色状态与全部入口共用同一个 .dsh-wf-copy-btn */
  const codeToolbar = (r: Row): unknown[] => [
    // ★ 2026-10-16（用户反馈「图片选择的弹窗按钮在提示语后面有点奇怪，最好放在富文本框里面」）：
    //   「🖼 选图」挪进富文本框的工具栏（与复制/清空同一排），只在登记的图片类参数行出现。
    ...(imagePickKeys?.includes(r.k) ? [createElement('button', {
      className: 'dsh-wf-copy-btn dsh-wf-imgpick-pick',
      title: '从统一图片目录里勾选多张（不用手抄文件名）',
      onClick: () => setPickKey(r.k),
    }, '🖼 选图')] : []),
    createElement('button', {
      className: `dsh-wf-copy-btn${copyFlash && copyFlash.key === r.k ? (copyFlash.kind === 'ok' ? ' is-done' : ' is-bad') : ''}`,
      title: '复制全部内容到剪贴板',
      onClick: () => copy(r.text, r.k),
    }, copyFlash && copyFlash.key === r.k ? (copyFlash.kind === 'ok' ? '✓ 已复制' : '✗ 复制失败') : '📋 复制'),
    createElement('button', {
      className: `dsh-wf-copy-btn${clearArmKey === r.k ? ' is-armed' : ''}`,
      title: clearArmKey === r.k ? '再点一次确认清空' : '清空全部内容（点两次确认，防误触）',
      onClick: () => {
        if (clearArmKey !== r.k) { setClearArmKey(r.k); setTimeout(() => setClearArmKey(null), 2500); return; }
        setClearArmKey(null);
        writeRowText(r.k, '');
      },
    }, '🧹 清空'),
    // 已点一次「清空」时给一句文字提示，避免看不出"处于确认态"
    clearArmKey === r.k ? createElement('span', { className: 'dsh-wf-code-armed' }, '再点一次清空') : null,
    // ★ 2026-10-16 方案 A：形态切换的"降级"这一半挪进富文本工具栏（"升级"那半是单行框右侧的小把手）
    createElement('button', {
      className: 'dsh-wf-copy-btn dsh-wf-params-shrink',
      title: '改成单行输入',
      onClick: () => pushRows(rows.map((x) => (x.k === r.k ? { ...x, multi: false } : x))),
    }, createElement(IconSingleLine)),
  ];
  /** 按参数名改值（行内编辑器与放大弹窗共用） */
  const writeRowText = (key: string, text: string): void => {
    const idx = rows.findIndex((r) => r.k === key);
    if (idx < 0) return;
    pushRows(rows.map((r, j) => (j === idx ? { ...r, text } : r)));
  };
  /** 富文本框的语言（code 行按节点类型高亮；其余按内容——像 JSON 对象/数组就用 json 着色） */
  const langOf = (r: Row): CodeLang => (r.k === 'code' && codeLang ? codeLang : (looksJsonLike(r.text) ? 'json' : 'text'));
  const [inputVals, setInputVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(inputDefaults ?? {}).map(([k, v]) => [k, toText(v)])));
  const inputKeys = Object.keys(inputDefaults ?? {});
  /** 试跑输入 → 对象：能按 JSON 解析的就解析（与「工作流参数」弹窗同一套约定），否则按字符串 */
  const parseInputVals = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const k of inputKeys) {
      const raw = inputVals[k] ?? '';
      try { out[k] = JSON.parse(raw); } catch { out[k] = raw; }
    }
    return out;
  };
  // ★ 变量抽屉（默认展开：这轮的目的就是"写参数时随手插变量"）
  const [varOpen, setVarOpen] = useState(true);
  const [pickHint, setPickHint] = useState<string | null>(null);
  /** 最近一次聚焦的「值」框（插变量插到它的光标处；不记参数名框） */
  const lastEdit = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const onEditCapture = (e: React.SyntheticEvent): void => {
    const t = e.target as (HTMLInputElement | HTMLTextAreaElement) | null;
    if (!t || typeof t.selectionStart !== 'number') return;
    if (!(t as HTMLElement).closest?.('.dsh-wf-params-v')) return;
    lastEdit.current = t;
  };
  /** 把变量引用插到最近聚焦值框的光标处（并把光标移到插入内容之后） */
  const insertRef = (text: string): void => {
    const el = lastEdit.current;
    if (!el || !el.isConnected) {
      setPickHint('先点一下要填的那个值框，再点变量（引用会插到光标处）');
      return;
    }
    const rowEl = el.closest('.dsh-wf-params-row') as HTMLElement | null;
    const rowEls = Array.from(document.querySelectorAll('.dsh-wf-params-row'));
    const idx = rowEl ? rowEls.indexOf(rowEl) : -1;
    if (idx < 0) { setPickHint('找不到对应的参数行——重新点一下值框再点变量'); return; }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const next = el.value.slice(0, start) + text + el.value.slice(end);
    setPickHint(null);
    pushRows(rows.map((r, i) => (i === idx ? { ...r, text: next } : r)));
    requestAnimationFrame(() => {
      try { el.focus(); el.setSelectionRange(start + text.length, start + text.length); } catch { /* 元素可能已卸载 */ }
    });
  };

  /** 行变化 → 立即写回（差异补丁） */
  const pushRows = (next: Row[]): void => {
    setRows(next);
    onParamsChange(diffPatch(params, paramsFromRows(next)));
  };

  const openJson = (): void => {
    setJsonText(JSON.stringify(paramsFromRows(rows), null, 2));
    setJsonError(null);
    setTab('json');
  };

  const onJsonChange = (text: string): void => {
    setJsonText(text);
    try {
      const parsed = JSON.parse(text || '{}');
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setJsonError('顶层必须是一个对象（形如 { "键": 值 }）');
        return;
      }
      setJsonError(null);
      const next = rowsFromParams(parsed as Record<string, unknown>, codeLang, fieldHints, fieldPlaceholders);
      setRows(next);
      onParamsChange(diffPatch(params, paramsFromRows(next)));
    } catch (e) {
      setJsonError(`JSON 解析失败：${(e as Error).message}（未写回，改对即生效）`);
    }
  };

  const rowEl = (r: Row, i: number): ReactElement => {
    const setRow = (patch: Partial<Row>): void => pushRows(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    // ★ 2026-10-11 用户要求：「python/bash 的富文本框和其他节点都保持一致，清空和复制按钮都需要」
    //   ⇒ **所有行一套控件**：[T 类型] [单行/富文本] [✕]，凡是富文本框都带「复制 / 清空」图标工具条；
    //   **放大/缩小**不再是行里的按钮，而是**富文本框内部右上角**的斜双箭头把手（点了放大成全屏弹窗）。
    //   语言只影响**着色**（code 行按节点类型高亮），不影响控件。
    const hint = fieldHints?.[r.k];
    return createElement('div', { className: 'dsh-wf-params-row', key: i },
      createElement('input', {
        className: 'dsh-wf-input dsh-wf-params-k',
        placeholder: '参数名',
        value: r.k,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setRow({ k: e.target.value }),
      }),
      // ★ 2026-10-16 用户需求（「解释的信息统一放到合适的地方用个小问号，单击显示解释内容，现在平铺解释信息很乱」）：
      //   字段的**静态说明**收进小问号，紧跟在参数名输入框右侧（原来平铺在值框下方，`images` 那种 180 字说明
      //   会把一行撑到 4 行高、参数之间挤在一起）。
      hint ? createElement(InfoTip, { text: hint, className: 'dsh-wf-params-k-tip' }) : null,
      createElement('div', { className: 'dsh-wf-params-v' },
        r.multi
          ? createElement(CodeText, {
              value: r.text,
              onChange: (v: string) => setRow({ text: v }),
              lang: langOf(r),
              height: 150,
              // 占位只留"示例/该填什么"，解释性文字进问号（弹窗级问号里有完整说明）
              placeholder: r.placeholder ?? (r.k === 'code' && codeLang
                ? (codeLang === 'bash' ? "echo 'hello'\ndate" : "import datetime\nprint('你好，当前时间：' + datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'))")
                : '值'),
              toolbar: codeToolbar(r),
              expand: { expanded: false, onToggle: () => setExpandedKey(r.k) },
            })
          // ★ 2026-10-16 用户拍板方案 A：形态不再占用行内按钮——单行框右侧留一个小把手（点了升级为多行框），
          //   多行框的"改回单行"在富文本工具栏里（见 codeToolbar）。类型也自动推断 ⇒ 行内按钮只剩「✕」。
          : createElement('div', { className: 'dsh-wf-params-single' },
              createElement('input', {
                className: 'dsh-wf-input',
                placeholder: singleLinePlaceholder(r),
                value: r.text,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => setRow({ text: e.target.value }),
              }),
              createElement('button', {
                className: 'dsh-wf-params-grow',
                title: '改成富文本框（多行）',
                onClick: () => setRow({ multi: true }),
              }, createElement(IconMultiLine)),
            ),
      ),
      createElement('button', {
        className: 'dsh-wf-params-del',
        title: '删除该参数',
        onClick: () => pushRows(rows.filter((_, j) => j !== i)),
      }, '✕'),
    );
  };

  const expandedRow = expandedKey ? rows.find((r) => r.k === expandedKey) : undefined;
  return createElement(Fragment, null,
  createPortal(createElement('div', {
    className: 'dag-flow-picker-overlay',
    onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) onClose(); },
  },
    createElement('div', {
      className: 'dag-flow-picker', style: { width: '80vw', maxWidth: 1100 },
      // 记住"最近聚焦的那个值框"（插变量要插到它的光标处；参数名框不算）
      onFocusCapture: onEditCapture,
      onKeyUpCapture: onEditCapture,
      onClickCapture: onEditCapture,
      onSelectCapture: onEditCapture,
    },
      createElement('div', { className: 'dag-flow-picker-title', style: { fontSize: 16 } },
        `🧪 参数与试跑（${nodeLabel ?? ''} · ${nodeId}）`,
        // ★ 2026-10-16 用户：「这段话的小问号在最右边线边上，调整下位置」——原先挂在页签行末尾
        //   （`.dsh-wf-params-meta` 的 margin-left:auto 之后），天生就顶在弹窗右内边上；
        //   现挪到标题文字右侧（左上区）：标题行 flex+gap:8px，关闭按钮自带 margin-left:auto，
        //   插在两者之间即可稳定停在标题旁，不贴任何边线。
        createElement(InfoTip, { text: PARAMS_TIPS, className: 'dsh-wf-params-tip' }),
        createElement('button', { className: 'dag-flow-picker-close', title: '关闭', onClick: onClose }, '✕'),
      ),
      createElement('div', { className: 'dsh-wf-params-tabs' },
        createElement('button', {
          className: `dsh-wf-params-tab${tab === 'fields' ? ' on' : ''}`,
          onClick: () => setTab('fields'),
        }, '字段视图'),
        createElement('button', {
          className: `dsh-wf-params-tab${tab === 'json' ? ' on' : ''}`,
          onClick: openJson,
        }, 'JSON 视图'),
        createElement('button', {
          className: `dsh-wf-params-var-toggle${varOpen ? ' on' : ''}`,
          title: '变量引用：点变量插入到当前值框的光标处',
          onClick: () => setVarOpen((v) => !v),
        }, `🔗 变量（${varGroups.reduce((n, g) => n + g.chips.length, 0)}）`),
        createElement('span', { className: 'dsh-wf-params-meta' },
          `${rows.filter((r) => r.k.trim()).length} 个参数 · 改动即自动保存`),
      ),
      createElement('div', { className: 'dsh-wf-params-split' },
      createElement('div', { className: 'dsh-wf-params-main' },
      tab === 'fields'
        ? createElement('div', { className: 'dsh-wf-params-body' },
            rows.map(rowEl),
            createElement('div', { className: 'dsh-wf-params-addbar' },
              createElement('button', {
                className: 'dsh-wf-inputs-add', title: '添加一个参数',
                onClick: () => pushRows([...rows, { k: '', text: '', multi: false }]),
              }, '+'),
            ),
          )
        : createElement('div', null,
            createElement(CodeText, {
              value: jsonText,
              onChange: onJsonChange,
              lang: 'json',
              height: 430,
              placeholder: '{ "prompt": "…", "maxTokens": 4096 }',
            }),
            jsonError
              ? createElement('div', { className: 'dsh-wf-params-err' }, `✗ ${jsonError}`)
              : createElement('div', { className: 'dsh-wf-params-jsonfoot' },
                  // JSON 视图的静态说明收进小问号（原来平铺一行在编辑器下方）
                  createElement(InfoTip, { text: '整份 params 的 JSON；解析失败不会写回，改对即生效。切回「字段视图」看逐参数编辑。' }),
                ),
          ),
      ),
      varOpen
        ? createElement('div', { className: 'dsh-wf-params-drawer' },
            createElement(VarPicker, {
              groups: varGroups,
              onPick: (c) => insertRef(c.text),
              // 静态说明已收进抽屉里的小问号（var-picker 自带），这里只在面板传了计数时才显示
              actionHint: varHint,
            }),
            pickHint ? createElement('div', { className: 'dsh-wf-params-err' }, pickHint) : null,
          )
        : null,
      ),
      // ★ 底部常驻试跑条（2026-10-11 用户拍板方案 A）：改完参数就地跑、结果就地看；
      //   输入（工作流参数）按字段填并预填默认值——取代原来面板里那个手写 JSON 的输入框。
      createElement('div', { className: 'dsh-wf-testbar' },
        createElement('div', { className: 'dsh-wf-testbar-head' },
          createElement('button', {
            className: 'dsh-wf-btn dsh-wf-btn-success',
            disabled: testRunning || !canTest || !onRunTest,
            title: canTest
              ? '用 start→本节点→end 的最小流程真实执行一次（参数取当前节点的 params）'
              : 'start/end 节点无需试跑',
            onClick: () => onRunTest?.(parseInputVals()),
          }, testRunning ? '⏳ 试跑中…' : '▶ 试跑本节点'),
          inputKeys.length
            ? createElement('button', {
                className: `dsh-wf-params-var-toggle${inputsOpen ? ' on' : ''}`,
                title: '试跑输入（工作流参数）：按字段填，默认值已预填；可用 {{inputs.名称}} 在参数里引用',
                onClick: () => setInputsOpen((v) => !v),
              }, `试跑输入（${inputKeys.length} 项）`)
            : createElement('span', { className: 'dsh-wf-panel-hint' }, '本工作流没有输入参数，直接试跑即可'),
          // 试跑条的静态说明收进小问号（原来平铺两行文字）
          createElement(InfoTip, { text: '参数取当前节点的 params——改完即可就地试跑。试跑输入（工作流参数）按字段填、默认值已预填，可用 {{inputs.名称}} 在参数里引用；本工作流没有输入参数时不用填。' }),
        ),
        inputsOpen && inputKeys.length
          ? createElement('div', { className: 'dsh-wf-testbar-inputs' },
              ...inputKeys.map((k) => createElement('div', { className: 'dsh-wf-testbar-row', key: k },
                createElement('span', { className: 'dsh-wf-testbar-k', title: `引用写法：{{inputs.${k}}}` }, k),
                createElement('input', {
                  className: 'dsh-wf-input',
                  value: inputVals[k] ?? '',
                  placeholder: '值（字符串或合法 JSON，数字 / 对象自动解析）',
                  onChange: (e: React.ChangeEvent<HTMLInputElement>) => setInputVals((m) => ({ ...m, [k]: e.target.value })),
                }),
              )),
            )
          : null,
        testResult
          ? createElement('div', { className: 'dsh-wf-testbar-result' }, createElement(TestResultView, { result: testResult }))
          : null,
      ),
    ),
  ), document.body),
  // ★ 2026-10-11 用户要求：富文本框内部右上角的斜双箭头点了「放大到弹窗，遮盖其他部分」；
  //   大窗里同一个把手变成「缩小」，点回来。**单独 Portal 到 body**（不能嵌在参数弹窗里：遮罩有
  //   backdrop-filter 会给 fixed 元素造包含块，弹窗会被困住——同早前代码编辑弹窗的教训）。
  expandedRow
    ? createPortal(createElement('div', {
        className: 'dag-flow-picker-overlay',
        onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) setExpandedKey(null); },
      },
        createElement('div', { className: 'dag-flow-picker', style: { width: '90vw', maxWidth: 1400 } },
          createElement('div', { className: 'dag-flow-picker-title', style: { fontSize: 16 } },
            `🔍 放大编辑「${expandedRow.k}」（${nodeLabel ?? ''} · ${nodeId}）`,
            createElement('button', { className: 'dag-flow-picker-close', title: '缩小（回到参数面板）', onClick: () => setExpandedKey(null) }, '✕'),
          ),
          createElement(CodeText, {
            value: expandedRow.text,
            onChange: (v: string) => writeRowText(expandedRow.k, v),
            lang: langOf(expandedRow),
            height: Math.max(320, Math.round((typeof window !== 'undefined' ? window.innerHeight : 900) * 0.62)),
            placeholder: expandedRow.placeholder ?? '…',
            toolbar: codeToolbar(expandedRow),
            expand: { expanded: true, onToggle: () => setExpandedKey(null) },
          }),
        ),
      ), document.body)
    : null,
  // ★ 2026-10-16 方案 A：「🖼 选图」弹窗（单独 Portal 到 body——与放大编辑弹窗同一理由：
  //   参数弹窗遮罩的 backdrop-filter 会给 fixed 元素造包含块，嵌进去会被困住）。
  pickKey
    ? createPortal(createElement(ImagePickerDialog, {
        // 预勾选：把该行里已经写着的文件名勾上（路径/URL 类条目匹配不上，自然不勾）
        current: (rows.find((r) => r.k === pickKey)?.text ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
        onClose: () => setPickKey(null),
        onConfirm: (names: string[], replace: boolean) => {
          const key = pickKey;
          const cur = rows.find((r) => r.k === key);
          const kept = replace || !cur ? [] : cur.text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
          for (const n of names) if (!kept.includes(n)) kept.push(n);   // 追加并去重（顺序＝列表顺序）
          writeRowText(key, kept.join('\n'));
          setPickKey(null);
        },
      }), document.body)
    : null,
  );
}
