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
import { Fragment, useEffect, useRef, useState } from 'react';
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
// ★ 2026-10-17：行 ↔ params 值的**纯函数层**抽到独立模块（本文件已越过 500 行软上限；抽出的部分可离线单测
//   —— 含"删一行不再污染别行"的高危回归锁，见 test/params-value.test.mjs）。
import {
  rowsFromParams, singleLinePlaceholder, looksJsonLike, toText, paramsFromRows, diffPatch,
} from './params-value';
import type { Row } from './params-value';
import type { ParamMeta } from './param-meta';

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
  'Tab = 4 空格缩进。',
].join('\n');
// ★ 2026-10-18 用户两轮定稿：`改动即自动保存` **不进问号**（原话「还是要在明显地方提示的，不能放到
//   小问号里面，这个提示信息属于关键提示」），但**也不另起一行、不加粗提亮**（第三轮原话「恢复成这样，
//   并且放到小问号后面，字体颜色大小，状态统一成"3 个参数"一样的」）⇒ 最终＝标题行里紧跟说明问号之后
//   的一小段：`N 个参数 · 改动即自动保存`，字号 / 颜色 / 字体与计数完全同款（`.dsh-wf-params-meta`）。
//   口径：**关键提示**（影响"数据会不会丢 / 会不会真的生效"这类判断的句子）必须平铺在显眼位置——
//   位置显眼就够了，样式跟随所在行；只有纯操作说明（语法 / 快捷键 / 怎么切多行框）才进问号。

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

// ★ 2026-10-17：`toText` / `rowsFromParams` / `singleLinePlaceholder` / `looksJsonLike` / `valueOfText` /
//   `paramsFromRows` / `diffPatch` 与 `Row` 类型已抽到 ./params-value（纯函数层，可离线单测）。

export function ParamsEditor({ nodeId, nodeLabel, params, varGroups = [], varHint, inputDefaults = {}, canTest = true, testRunning = false, testResult = null, codeLang, fieldHints, fieldPlaceholders, imagePickKeys, paramMeta, extraFields, handledKeys, onRunTest, onParamsChange, onClose }: {
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
  /** ★ 2026-10-19（用户要求「所有节点的右侧编辑模板的参数…全部挪到一个地方」）：**节点专属参数控件区**——
   *  由 NodeInspector 把这几个块（会话选择 / 文件保存 / 网页与文档解析）原样搬进来，渲染在通用参数行**上方**。
   *  它们不是"一格一值"的参数，塞进通用键值编辑器会退化成裸输入框，所以是整块搬、不是拆成行。
   *  后续批次（subagent 模型 / python·bash 代码 / switch 分支 / loop 循环设置）同样走这条通道。 */
  extraFields?: React.ReactNode;
  /** ★ 2026-10-19（批 1）：这些 params 键由 `extraFields` 里的专属表单负责编辑 ⇒ 通用参数行里**不重复列出**，
   *  写回时也**原样保留**（否则会被 diffPatch 当成"已删除"）。 */
  handledKeys?: string[];
  /** ★ 2026-10-19（用户拍板 A）：参数的**中文名/释义/示例占位**（唯一源＝./param-meta.ts）。
   *  登记了的参数会在参数名左侧显示中文名、右侧显示问号释义；未登记的节点/参数保持原样（只有参数名）。 */
  paramMeta?: Record<string, ParamMeta>;
  /** 点「▶ 试跑本节点」时把解析好的 inputs 交给上层（参数数据取当前节点 params，由上层负责发请求） */
  onRunTest?: (inputs: Record<string, unknown>) => void;
  onParamsChange: (patch: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'fields' | 'json'>('fields');
  // ★ 2026-10-19（用户拍板 A）：登记了中文元数据的参数（image_generate / video_generate）—— 元数据里的示例
  //   直接进 placeholder（单行/多行都吃这一份），登记的键**全部补行**（弹窗是这些参数唯一的入口）。
  //   ★ 注意：**不要**把示例并进 `fieldPlaceholders` 一起传 rowsFromParams —— 那张表会强制该行变富文本框
  //   （`multi = !!ph`），而这里多数参数（model / size / n / 各种 URL）应当是单行框。
  const metaAutoRows = paramMeta
    ? Object.entries(paramMeta).map(([k, m]) => ({ k, multi: !!m.multi, placeholder: m.placeholder }))
    : undefined;
  const [rows, setRows] = useState<Row[]>(() => {
    const all = rowsFromParams(params, codeLang, fieldHints, fieldPlaceholders, metaAutoRows);
    return handledKeys?.length ? all.filter((r) => !handledKeys.includes(r.k.trim())) : all;
  });
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  // ★ 2026-10-19 用户要求：「试跑本节点的结果，现在是在弹窗下面显示，改成中上部弹窗告知」
  //   ⇒ 结果不再挤在底部条里，而是**中上部浮层卡片**（与既有"运行终态浮窗"同一口径）：
  //     成功 2.6s 自动消失、失败常驻且可手动关闭。底部试跑条只剩按钮与输入。
  const [resultToast, setResultToast] = useState<TestResult | null>(null);
  // 依赖用"特征串"而不是对象引用：父组件每次重渲染都会传新对象，用引用会反复重置计时器。
  const resultSig = testResult ? `${testResult.ok ? 1 : 0}|${testResult.status ?? ''}|${testResult.ms ?? ''}|${testResult.error ?? ''}` : '';
  useEffect(() => {
    if (!testResult) { setResultToast(null); return undefined; }
    setResultToast(testResult);
    if (testResult.ok) {
      const t = setTimeout(() => setResultToast(null), 2600);
      return () => clearTimeout(t);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultSig]);
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

  /** 行变化 → 立即写回（差异补丁）。
   *  ★ 2026-10-17 二次修（独立审查报的高危项，已实测复现）：原先在**这一处按行下标**比对，把"文本或键名变了的
   *  行"标成粘性 `edited`。但**删除一行**会让 `next` 整体前移 ⇒ 用下标对齐时，被删行**之后的所有行**都被误标成
   *  "用户改过" ⇒ 它们重新过 `valueOfText`：`"0012"`→12、`"true"`→布尔、`"null"`→**该参数键被整条删掉**。
   *  现在**不再做粘性标记**，改由 `paramsFromRows` 直接与 `orig`（从 def 读出的原值）比对文本
   *  —— 判据只看"这一行的文本是否还等于它当初的原值"，删行/换行位置都不会污染别的行。 */
  /** ★ 2026-10-19（批 1）：`handledKeys` 里的键由**节点专属表单**（extraFields）负责编辑，
   *  它们不在通用行里出现 —— 但写回时必须**原样保留**，否则 `diffPatch` 会把"旧有新无"的键判成删键，
   *  一改任何参数就把 path / ocr / filename 这类字段删掉（高危面，必须拦住）。 */
  const handled = handledKeys ?? [];
  const keepHandled = (rec: Record<string, unknown>): Record<string, unknown> => {
    if (!handled.length) return rec;
    const out: Record<string, unknown> = { ...rec };
    for (const k of handled) if (Object.prototype.hasOwnProperty.call(params, k)) out[k] = params[k];
    return out;
  };
  const visibleRows = (rs: Row[]): Row[] => (handled.length ? rs.filter((r) => !handled.includes(r.k.trim())) : rs);

  const pushRows = (next: Row[]): void => {
    setRows(next);
    onParamsChange(diffPatch(params, keepHandled(paramsFromRows(next))));
  };

  const openJson = (): void => {
    // ★ 有个专属表单管的键也要出现在 JSON 里（否则用户从 JSON 看/改会以为参数丢了）
    setJsonText(JSON.stringify(keepHandled(paramsFromRows(rows)), null, 2));
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
      const nextAll = rowsFromParams(parsed as Record<string, unknown>, codeLang, fieldHints, fieldPlaceholders, metaAutoRows);
      const next = handled.length ? nextAll.filter((r) => !handled.includes(r.k.trim())) : nextAll;
      setRows(next);
      onParamsChange(diffPatch(params, keepHandled(paramsFromRows(next))));
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
    // ★ 2026-10-19（用户拍板 A）：参数名的中文元数据（label/desc/placeholder）—— 登记过的参数
    //   用**两行式**：中文名在上（正常字号/正常颜色），参数名在下当注脚（更小、更浅、等宽字体），问号跟注脚后面。
    //   用户原话：「显示成两行，中文名在上面，参数名在下面，并且参数名变小，字体颜色变浅，弱化，中文名正常显示，
    //   参数名就像注脚」。desc 优先于 fieldHints（后者是节点级特例说明）。
    const meta = paramMeta?.[r.k];
    const hint = meta?.desc ?? fieldHints?.[r.k];
    // 参数名（key）是引擎写死的（prompt / submitUrl…），登记过的行**不再给输入框**（改了不报错、只是静默失效）；
    // 注脚形态正好满足这一点。只在"登记过且是本节点真有的键"时走两行式：
    //   `r.auto` ＝ 登记表补出来的行，`r.orig !== undefined` ＝ def 里本来就有的键；
    //   「+ 添加参数」新起的那行（两者都不满足）仍是可编辑输入框 —— 否则输到 'prompt' 时会变成只读、
    //   输入框消失、焦点丢失，加不回被删掉的参数。
    const named = !!meta?.label && (r.auto === true || r.orig !== undefined);
    return createElement('div', {
      className: `dsh-wf-params-row${named ? ' named' : ''}`,
      key: i,
      // ★ 2026-10-19：行上带 `data-key`（两个用途）——① 测试/调试可以稳定按参数名定位行
      //   （两行式之后参数名不再是 input，`.dsh-wf-params-k` 的 value 读不到了）；
      //   ② 排查时一眼看出这一行管的是哪个键。
      'data-key': r.k,
    },
      createElement('div', { className: `dsh-wf-params-kcell${named ? ' named' : ''}` },
        named
          ? createElement(Fragment, null,
              createElement('span', { className: 'dsh-wf-params-kname', title: meta.label }, meta.label),
              createElement('span', { className: 'dsh-wf-params-ksub' },
                createElement('span', { className: 'dsh-wf-params-kkey', title: `参数名：${r.k}` }, r.k),
                hint ? createElement(InfoTip, { text: hint, className: 'dsh-wf-params-k-tip' }) : null,
              ),
            )
          : createElement(Fragment, null,
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
            ),
      ),
      createElement('div', { className: 'dsh-wf-params-v' },
        r.multi
          ? createElement(CodeText, {
              value: r.text,
              onChange: (v: string) => setRow({ text: v }),
              lang: langOf(r),
              height: 150,
              // 占位只留"示例/该填什么"，解释性文字进问号（弹窗级问号里有完整说明）
              placeholder: meta?.placeholder ?? r.placeholder ?? (r.k === 'code' && codeLang
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
                // ★ 2026-10-19：元数据里的示例可能是多行（如 images 的三行示例）——单行框要走
                //   `singleLinePlaceholder` 把换行折成 " / "（input 不认换行，直接塞会变成空格）。
                placeholder: singleLinePlaceholder({ ...r, placeholder: meta?.placeholder ?? r.placeholder }),
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
      // ★ 2026-10-19 用户要求：「参数与试跑按钮的弹窗，如果参数较多，用滚动的方式，不要整个弹窗页平铺」
      //   ⇒ 加 `dsh-wf-params-dialog`：弹窗自身限高（flex 列 = 标题/页签固定 + 参数区内部滚动 + 底部试跑条常驻），
      //   取代上一版"遮罩整页滚动"。内容少时 max-height 不生效，观感与以前一致。
      className: 'dag-flow-picker dsh-wf-params-dialog', style: { width: '80vw', maxWidth: 1100 },
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
        // ★ 2026-10-18 定稿：「恢复成这样，并且放到小问号后面，字体颜色大小，状态统一成"3 个参数"一样的」
        //   ⇒ 计数 + 关键提示合成一小段，紧跟说明问号之后（标题行左区；关闭按钮自带 margin-left:auto 在最右，
        //   两者都不会贴右内边）。样式与计数同款 `.dsh-wf-params-meta`（**不带 margin-left:auto**）。
        createElement('span', { className: 'dsh-wf-params-meta' },
          // ★ 计数把"由专属表单编辑的键"也算进去（那些键不在通用行里，但确实是本节点的参数）
          `${rows.filter((r) => r.k.trim()).length + handled.filter((k) => Object.prototype.hasOwnProperty.call(params, k)).length} 个参数 · 改动即自动保存`),
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
      ),
      createElement('div', { className: 'dsh-wf-params-split' },
      createElement('div', { className: 'dsh-wf-params-main' },
      tab === 'fields'
        ? createElement('div', { className: 'dsh-wf-params-body' },
            // ★ 2026-10-19：节点专属参数控件区（整块搬进来的，不是一行一值）——放在通用参数行上方，
            //   与参数行同处一个滚动容器（`.dsh-wf-params-main`），弹窗限高后一起滚。
            extraFields ? createElement('div', { className: 'dsh-wf-params-extras' }, extraFields) : null,
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
        // ★ 2026-10-19 用户要求：结果改成**中上部浮层告知**（见组件顶部的 resultToast）——底部条不再渲染结果。
      ),
    ),
  ), document.body),
  // ★ 2026-10-19 用户要求：「试跑本节点的结果，现在是在弹窗下面显示，改成中上部弹窗告知」
  //   ⇒ 固定定位卡片（top 16vh、水平居中、z-index 高于弹窗遮罩的 10000）：
  //     成功（ok）2.6s 自动消失；失败/取消常驻，右上角 ✕ 手动关（内容沿用 TestResultView，逐字不变）。
  resultToast
    ? createPortal(createElement('div', {
        className: `dsh-wf-testtoast ${resultToast.error || !resultToast.ok ? 'is-err' : 'is-ok'}`,
        role: 'status',
        'aria-live': 'polite',
      },
        createElement('button', {
          className: 'dsh-wf-testtoast-close', title: '关闭', onClick: () => setResultToast(null),
        }, '✕'),
        createElement(TestResultView, { result: resultToast }),
      ), document.body)
    : null,
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
