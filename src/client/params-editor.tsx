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
import type { TestResult } from './test-result';

type Row = { k: string; text: string; kind: 'string' | 'other'; multi: boolean; auto?: boolean };

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

// ★ 2026-10-11 用户要求「复制和清空按钮换成 icon 图标就行」——工具条里两个按钮改纯图标（title 里保留说明）。
/** 复制（两张叠起来的纸） */
function IconCopy(): ReactElement {
  return createElement('svg', SVG_ICON,
    createElement('rect', { x: 5.6, y: 5.6, width: 7.4, height: 7.4, rx: 1.3 }),
    createElement('path', { d: 'M10.4 3.2H5.2c-.9 0-1.6.7-1.6 1.6v5.2' }),
  );
}

/** 清空（垃圾桶） */
function IconTrash(): ReactElement {
  return createElement('svg', SVG_ICON,
    createElement('path', { d: 'M3.6 5.2h8.8M6.6 5.2V3.9c0-.4.3-.7.7-.7h1.4c.4 0 .7.3.7.7v1.3' }),
    createElement('path', { d: 'M5.1 5.2l.5 7.2c0 .5.4.9.9.9h3c.5 0 .9-.4.9-.9l.5-7.2' }),
  );
}

/** 非字符串值 → 可编辑文本（对象/数组缩进展示） */
function toText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') { try { return JSON.stringify(v, null, 2); } catch { return String(v); } }
  return String(v);
}

function rowsFromParams(params: Record<string, unknown>, codeLang?: CodeLang): Row[] {
  const rows: Row[] = Object.entries(params ?? {}).map(([k, v]) => {
    const kind: 'string' | 'other' = typeof v === 'string' ? 'string' : 'other';
    const text = toText(v);
    // ★ 2026-10-11：代码行默认就用富文本框（脚本天生多行）；其余行按内容长度自动判断——
    //   但**控件与按钮完全一致**（其它行也能点「单行/富文本」切过来）。
    const multi = (k === 'code' && !!codeLang) || text.includes('\n') || text.length > MULTI_THRESHOLD;
    return { k, text, kind, multi };
  });
  // ★ 2026-10-11 方案 A：python/bash 的 `codePath` 是"二选一"的另一个入口——节点默认参数里没有这个键，
  //   但用户要能填。原面板是"永远显示输入框"，所以这里**自动补一行**（auto=true：留空时不写进 def，
  //   保持"清空 = 删键"的既有语义，也不会凭空多出 "codePath": "" 脏值）。
  if (codeLang && !rows.some((r) => r.k === 'codePath')) {
    rows.push({ k: 'codePath', text: '', kind: 'string', multi: false, auto: true });
  }
  return rows;
}

/** 行 → params 对象（空名字的行忽略；auto 行留空则忽略；非字符串值按 JSON 解析，解析失败按字符串留原文） */
function paramsFromRows(rows: Row[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    const k = r.k.trim();
    if (!k) continue;
    if (r.kind === 'string') {
      if (r.auto && r.text.trim() === '') continue; // 自动补的行：留空 = 没有这个参数
      out[k] = r.text;
      continue;
    }
    try {
      const parsed = JSON.parse(r.text);
      if (parsed !== null) out[k] = parsed; // null 在 def 里等于"没有这个键"（既有语义），不写入
    } catch {
      out[k] = r.text;
    }
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

export function ParamsEditor({ nodeId, nodeLabel, params, varGroups = [], varHint, inputDefaults = {}, canTest = true, testRunning = false, testResult = null, codeLang, fieldHints, onRunTest, onParamsChange, onClose }: {
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
  /** 点「▶ 试跑本节点」时把解析好的 inputs 交给上层（参数数据取当前节点 params，由上层负责发请求） */
  onRunTest?: (inputs: Record<string, unknown>) => void;
  onParamsChange: (patch: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'fields' | 'json'>('fields');
  const [rows, setRows] = useState<Row[]>(() => rowsFromParams(params, codeLang));
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  // ★ 试跑条（方案 A）：输入按工作流参数逐字段填（默认值预填），默认收起；结果就地展开
  const [inputsOpen, setInputsOpen] = useState(false);
  // ★ 代码行「清空」的两击确认（沿用原代码编辑弹窗的防误触口径）
  const [clearArmKey, setClearArmKey] = useState<string | null>(null);
  // ★ 2026-10-11 用户要求：放大按钮在**富文本框内部右下角**（斜双箭头），点了**放大到弹窗**、遮盖其他部分。
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  /** 富文本框工具条（行内与放大弹窗共用）：复制 / 清空（两击确认）图标按钮 + Tab 提示 */
  const codeToolbar = (r: Row): unknown[] => [
    createElement('button', {
      className: 'dsh-wf-code-ibtn', title: '复制全部内容到剪贴板',
      onClick: () => void navigator.clipboard.writeText(r.text),
    }, createElement(IconCopy)),
    createElement('button', {
      className: `dsh-wf-code-ibtn${clearArmKey === r.k ? ' is-armed' : ''}`,
      title: clearArmKey === r.k ? '再点一次确认清空' : '清空全部内容（点两次确认，防误触）',
      onClick: () => {
        if (clearArmKey !== r.k) { setClearArmKey(r.k); setTimeout(() => setClearArmKey(null), 2500); return; }
        setClearArmKey(null);
        writeRowText(r.k, '');
      },
    }, createElement(IconTrash)),
    // 已点一次「清空」时给一句文字提示，避免纯图标看不出"处于确认态"
    clearArmKey === r.k ? createElement('span', { className: 'dsh-wf-code-armed' }, '再点一次清空') : null,
    createElement('span', { className: 'dsh-wf-panel-hint' }, 'Tab = 4 空格缩进 · 改动即自动保存'),
  ];
  /** 按参数名改值（行内编辑器与放大弹窗共用） */
  const writeRowText = (key: string, text: string): void => {
    const idx = rows.findIndex((r) => r.k === key);
    if (idx < 0) return;
    pushRows(rows.map((r, j) => (j === idx ? { ...r, text } : r)));
  };
  /** 富文本框的语言（code 行按节点类型高亮，其余按类型 text/json） */
  const langOf = (r: Row): CodeLang => (r.k === 'code' && codeLang ? codeLang : (r.kind === 'string' ? 'text' : 'json'));
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
      const next = rowsFromParams(parsed as Record<string, unknown>);
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
      createElement('div', { className: 'dsh-wf-params-v' },
        r.multi
          ? createElement(CodeText, {
              value: r.text,
              onChange: (v: string) => setRow({ text: v }),
              lang: langOf(r),
              height: 150,
              placeholder: r.k === 'code' && codeLang
                ? (codeLang === 'bash' ? "echo 'hello'\ndate" : "import datetime\nprint('你好，当前时间：' + datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'))")
                : (r.kind === 'string' ? '值（字符串；提示词这类长文本直接写，不用转义）' : '值（JSON：数字 / true / false / 对象 / 数组）'),
              toolbar: codeToolbar(r),
              expand: { expanded: false, onToggle: () => setExpandedKey(r.k) },
            })
          : createElement('input', {
              className: 'dsh-wf-input',
              placeholder: r.kind === 'string' ? '值（字符串）' : '值（JSON：数字 / true / false）',
              value: r.text,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setRow({ text: e.target.value }),
            }),
        hint ? createElement('div', { className: 'dsh-wf-panel-hint', style: { marginTop: 6 } }, hint) : null,
      ),
      createElement('button', {
        className: `dsh-wf-params-type${r.kind === 'string' ? '' : ' on'}`,
        title: r.kind === 'string'
          ? 'T = 按字符串存（推荐）；点一下改成 JSON 值（数字 / true / false / 对象 / 数组）'
          : '{} = 按 JSON 解析；点一下改回字符串（T）',
        onClick: () => setRow({ kind: r.kind === 'string' ? 'other' : 'string', multi: false }),
      }, r.kind === 'string' ? 'T' : '{}'),
      createElement('button', {
        className: 'dsh-wf-params-form',
        title: r.multi ? '改成单行输入' : '改成富文本框',
        onClick: () => setRow({ multi: !r.multi }),
      }, createElement(r.multi ? IconSingleLine : IconMultiLine)),
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
            createElement('div', { className: 'dsh-wf-panel-hint', style: { marginBottom: 10 } },
              '值里可用上游数据引用：{{节点id.out}} / {{节点id.out.字段}} / {{vars.变量}} / {{inputs.输入}}。长文本点该行的「多行框」图标用代码级编辑框（不用写 JSON 转义）；要数字 / true / false / 对象时，把「T」点成「{}」。'),
            rows.map(rowEl),
            createElement('div', { className: 'dsh-wf-params-addbar' },
              createElement('button', {
                className: 'dsh-wf-inputs-add', title: '添加一个参数',
                onClick: () => pushRows([...rows, { k: '', text: '', kind: 'string', multi: false }]),
              }, '+'),
              createElement('span', { className: 'dsh-wf-panel-hint' }, '新参数默认按字符串存；「T / {}」控制该行是否按 JSON 解析'),
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
              : createElement('div', { className: 'dsh-wf-panel-hint', style: { marginTop: 8 } },
                  '整份 params 的 JSON；解析失败不会写回，改对即生效。切回「字段视图」看逐参数编辑。'),
          ),
      ),
      varOpen
        ? createElement('div', { className: 'dsh-wf-params-drawer' },
            createElement(VarPicker, {
              groups: varGroups,
              onPick: (c) => insertRef(c.text),
              actionHint: varHint ?? '点变量插入到当前值框的光标处（先点一下值框，光标在哪就插在哪）',
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
            : createElement('span', { className: 'dsh-wf-panel-hint' }, '本工作流没有输入参数（没有 {{inputs.x}} 可引用），直接试跑即可'),
          createElement('span', { className: 'dsh-wf-panel-hint' }, '参数取当前节点的 params——改完即可就地试跑'),
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
            placeholder: '…',
            toolbar: codeToolbar(expandedRow),
            expand: { expanded: true, onToggle: () => setExpandedKey(null) },
          }),
        ),
      ), document.body)
    : null,
  );
}
