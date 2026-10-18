// src/jsonish.ts — 「看起来像 JSON 的字符串」统一解析口径
//
// 背景（2026-10-19）：python / bash 节点的 out 是**原始 stdout 字符串**，file_read 的 out 是文件正文，
// log 的 out 是消息文本。这类节点的 out 里如果装的是 JSON，下游想取字段就会遇到「字符串 vs 对象」的错配：
//   · 模板 {{py.out.ok}}   → 旧实现直接判「上游输出在该处不是对象/数组」抛 DATAFLOW_REF
//   · 表达式 py.out.ok     → 旧实现得 undefined → 比较静默为 false（最阴：if 走了错误分支）
//
// 现在两侧共用本文件同一口径，保证「模板能取到的字段，表达式也能取到」：
//   只对首字符是 { 或 [ 的字符串尝试 JSON.parse；解析失败（如 '{not json'）保持原字符串，绝不抛错。
//   纯文本（'done'）、JSON 标量（'123' / 'true' / '"x"'）一律不解析 —— 它们本来就该按字符串用。
//
// 注意：只处理**节点 out 顶层**。更深层（如 http 节点的 out.body 也是 JSON 文本）两侧都未自动解析，
// 想取 body 内字段请先用 python 节点 JSON.parse 或直接 if 里比对整串。

/** 字符串首字符是 { 或 [ 时尝试 JSON.parse；失败/非此形态原样返回。 */
export function maybeParseJsonish(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return v;
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return v;
  }
}
