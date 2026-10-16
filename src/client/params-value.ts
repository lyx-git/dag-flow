// src/client/params-value.ts
// 参数弹窗的**值层纯函数**（2026-10-17 从 params-editor.tsx 抽出：那个文件当时 575 行、越过项目 500 行软上限；
//   更重要的是这些函数正是"行 ↔ params 值"最容易出错的地方 —— 抽成纯模块后**可以离线单测**）。
//
// 契约：**不 import React、不碰 DOM**（纯逻辑 ⇒ 可被 esbuild 直接打包做单测）。
// 关联：src/client/params-editor.tsx（唯一调用方）、src/client/code-text.ts（CodeLang 类型）、
//   test/params-value.test.mjs（回归锁，含 2026-10-17「删一行不再污染别行」的高危项）。
import type { CodeLang } from './code-text';

// ★ 2026-10-16（用户拍板方案 A：去掉「T/{}」类型按钮）——Row 不再记录"按字符串还是按 JSON 存"，
//   落盘类型由**值文本自动推断**（见 valueOfText）；形态 multi 仍保留（含换行/长文本自动为多行）。
export type Row = {
  k: string; text: string; multi: boolean; auto?: boolean; placeholder?: string;
  /** ★ 2026-10-17：这一行从 def 里读出来的**原值**（文本未变时按它原样回写，见 paramsFromRows） */
  orig?: unknown;
};

/** 内容超过这个长度就默认用多行（富文本）框；`code` 行与登记了示例的行另有无条件规则。 */
export const MULTI_THRESHOLD = 60;

/** 非字符串值 → 可编辑文本（对象/数组缩进展示） */
export function toText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') { try { return JSON.stringify(v, null, 2); } catch { return String(v); } }
  return String(v);
}

export function rowsFromParams(params: Record<string, unknown>, codeLang?: CodeLang, fieldHints?: Record<string, string>, fieldPlaceholders?: Record<string, string>): Row[] {
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
    return { k, text, multi, orig: v, ...(ph ? { placeholder: ph } : {}) };
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
export function singleLinePlaceholder(r: Row): string {
  if (r.placeholder) return r.placeholder.replace(/\n+/, ' ').replace(/\n+/g, ' / ');
  return '值';
}

/** 文本看起来像 JSON 对象/数组吗（只用于**语法高亮**；落盘类型判定见 valueOfText） */
export function looksJsonLike(text: string): boolean {
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
export function valueOfText(text: string): unknown {
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

/** 行 → params 对象（空名字的行忽略；auto 行留空则忽略；值类型由 valueOfText 自动推断）。
 *  ★ 2026-10-17 修（独立审查报的高危项）：**只对"文本确实被改过"的行做类型推断**，其余行按从 def 读出的
 *  原值（`orig`）原样回写 —— 否则"改一行"会让**所有行**重过 valueOfText：别的行上"长得像数字/布尔/JSON"
 *  的**字符串**会被静默改型（`"0012"`→12、`"1.0"`→1、文本 `true`→布尔、`{…}`→对象），
 *  文本正好是 `null` 的行还会被当"删键"直接删掉该参数；且弹窗提示里教的"切 JSON 视图加引号强制字符串"
 *  同样会被这条推断改回去（逃生口是假的）。现在 JSON 视图写 `"0012"` 真的能存成字符串。
 *  ★★ 二次修（同日独立审查实测复现）：判据从"粘性 `edited` 标记"改成**与 `orig` 的文本比对** —— 原判据按
 *  行下标对齐，**删掉一行**会让它后面所有行都被误标成"改过" ⇒ 那些行的值被静默改型、`"null"` 那行直接丢键。
 *  回归锁见 test/params-value.test.mjs 的 C 段。 */
export function paramsFromRows(rows: Row[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    const k = r.k.trim();
    if (!k) continue;
    // ★ auto 行的"留空＝没有这个参数"必须先判断（否则会往 def 里写 `"images": ""` 脏值）
    if (r.auto && r.text.trim() === '') continue;
    // 文本与从 def 读出的原值一致 ⇒ 用户没动过它 ⇒ 按原值回写（"改一下又改回原样"也走这条路）；
    // `orig === undefined` 只可能是"新增行还没表过态"，仍走推断
    const v = r.orig === undefined || r.text !== toText(r.orig) ? valueOfText(r.text) : r.orig;
    if (v !== null) out[k] = v;                                   // null = 删键语义，不写入
  }
  return out;
}

/** 差异补丁：新对象里有就写值，旧对象里有而新对象没有就传 null（= 删键） */
export function diffPatch(oldP: Record<string, unknown>, newP: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(newP)) patch[k] = v;
  for (const k of Object.keys(oldP ?? {})) if (!(k in newP)) patch[k] = null;
  return patch;
}
