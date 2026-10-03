// src/client/outFields.ts
// 从**一次真实的节点输出**里抽出「下游可引用」的字段路径（2026-10-03 用户需求：
// 「节点跑过一次之后，用真实 out 反推 chips——连 results.0.title 这种深层字段、以及动态型节点的
//   实际键名都能自动列出来」）。
//
// 为什么不能只靠静态字段表：`set_var` 的键、`merge` 的键、`subagent/session_input` 的输出形状、
// 用户自定义节点返回的对象，全都**由数据决定**——只有真跑过才知道有哪些键、值长什么样。
//
// 规则（都能被 test/out-fields.test.mjs 锁住）：
//   · 对象 → 每个键一条；值还是对象/数组时再展开一层（最多 maxDepth 层、最多 maxFields 条，防面板被撑爆）
//   · 数组 → 只展开第 1 个元素（对应 `{{id.out.results.0.url}}` 这种写法）
//   · 键名含 `. \s [ ] { }` → **跳过**（拼进 `{{id.out.a.b}}` 会歧义/解析失败），计进 skipped 供面板提示
//   · 标量（字符串/数字/布尔/null）→ 返回空数组（调用方只给整取引用 + 说明）
//
// 纯函数、无 React/无副作用：客户端面板与离线单测共用。

export interface OutField {
  /** 相对 out 的点路径，如 `results.0.url` */
  path: string;
  /** 值的类型：string / number / boolean / null / object / array */
  kind: string;
  /** 单行预览（长字符串截断，对象/数组给「N 个键/项」） */
  sample: string;
}

export interface OutFieldsResult {
  fields: OutField[];
  /** 被跳过的键路径（键名含点/空白/括号，无法用 {{}} 引用） */
  skipped: string[];
}

/** 键名合法性：含点、空白、方括号、花括号的键无法写进 `{{id.out.<键>}}` */
const BAD_KEY = /[.\s[\]{}]/;

/** 值 → 单行预览 */
export function sampleOf(v: unknown, max = 48): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') {
    const s = v.replace(/\s+/g, ' ').trim();
    if (!s) return '（空字符串）';
    return s.length > max ? `${s.slice(0, max)}…` : s;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.length} 项]`;
  if (typeof v === 'object') return `{${Object.keys(v as Record<string, unknown>).length} 个键}`;
  return String(v);
}

export function kindOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/**
 * 抽字段。out 是标量时返回空 fields（调用方应只给整取引用）。
 * @param out 节点某次运行的真实输出
 */
export function fieldsFromValue(out: unknown, opts: { maxDepth?: number; maxFields?: number; maxItems?: number } = {}): OutFieldsResult {
  const maxDepth = opts.maxDepth ?? 3;
  const maxFields = opts.maxFields ?? 30;
  const fields: OutField[] = [];
  const skipped: string[] = [];

  const push = (p: string, v: unknown): void => {
    fields.push({ path: p, kind: kindOf(v), sample: sampleOf(v) });
  };
  const walk = (val: unknown, prefix: string, depth: number): void => {
    if (fields.length >= maxFields) return;
    if (Array.isArray(val)) {
      if (!val.length) return;
      const el = val[0];
      // 只展开第 1 个元素（results.0.url）；元素本身是标量就不展开
      if (el === null || typeof el !== 'object' || Array.isArray(el)) return;
      for (const [k, v] of Object.entries(el as Record<string, unknown>)) {
        if (fields.length >= maxFields) return;
        if (BAD_KEY.test(k)) { skipped.push(`${prefix}.0.${k}`); continue; }
        push(`${prefix}.0.${k}`, v);
      }
      return;
    }
    if (val === null || typeof val !== 'object') return;
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (fields.length >= maxFields) return;
      const p = prefix ? `${prefix}.${k}` : k;
      if (BAD_KEY.test(k)) { skipped.push(p); continue; }
      push(p, v);
      if (depth < maxDepth && v !== null && typeof v === 'object') walk(v, p, depth + 1);
    }
  };
  walk(out, '', 1);
  return { fields, skipped };
}
