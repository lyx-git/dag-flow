// src/ajv-zh.ts — ajv 英文错误消息 → 中文（**唯一源**）
//
// ★ 为什么集中在这里（2026-10-16 规范整改）：这份映射原先在 host（`src/executor/parse.ts`）
//   与 client（`src/client/JsonView.tsx`）**各抄一份**、靠"两处人工同步"维持 —— 2026-10-16 就漂移过：
//   ajv 对 `required` 用**单引号**、对 `pattern` 用**双引号**，client 那份少了两条映射，
//   于是真机日志里「id must match pattern "^[a-zA-Z]…"」整句漏译（用户看不出 id 该长什么样）。
//   本文件**零依赖**（只有正则与字符串），host 与 client 两个 bundle 都能直接 import
//   —— 先例：`src/name-rule.ts` 同款做法，被 JsonView 直接引用。
// ★ 任何新增/修改映射**只改这里**；`test/parse-message.test.mjs` 会断言两个消费方不再自带副本。
//
// 顺序敏感：数组按序匹配、先命中先返回 ⇒ 更具体的模式要排在更泛的（如 `must be (string|…)`）前面。
// 消费方：src/executor/parse.ts（host 侧校验消息）、src/client/JsonView.tsx（JSON 视图实时校验）。

/** 常见 ajv 消息模式 → 中文模板（`$1..$9` 回填捕获组；未命中保留英文原文） */
export const AJV_ZH: [RegExp, string][] = [
  // ★ 2026-10-16 修：ajv 对 `required` 用**单引号**、对 `pattern` 用**双引号**，而旧正则只认单引号
  //   ⇒ pattern 那句一直漏译（真机日志实证：`id must match pattern "^[a-zA-Z]…"` 保留英文原文）。
  //   两条都改成单双引号皆认；pattern 用**贪婪**捕获，兼容 pattern 自身含引号。
  [/must have required property ['"]([^'"]+)['"]/, '缺少必填字段 "$1"'],
  [/must NOT have additional properties/, '存在不允许的多余字段'],
  [/must be (string|object|array|number|integer|boolean|null)/, '类型必须是 $1'],
  [/must match pattern ['"](.+)['"]/, '必须匹配格式 $1'],
  [/must be equal to constant/, '值不匹配要求'],
  [/must NOT be shorter than (\d+)/, '长度不能少于 $1'],
  [/must NOT be longer than (\d+)/, '长度不能超过 $1'],
  [/must be >= (-?\d+)/, '不能小于 $1'],
  [/must be <= (-?\d+)/, '不能大于 $1'],
  [/must NOT have fewer than (\d+) items/, '数组至少需要 $1 项'],
  [/must NOT have more than (\d+) items/, '数组不能超过 $1 项'],
  [/must have unique item/, '数组元素必须唯一'],
  [/must NOT be valid/, '格式不合法'],
];

/** 把一条 ajv 英文消息翻成中文（未命中任何模式时原样返回） */
export function zhAjvMessage(m: string): string {
  for (const [re, tpl] of AJV_ZH) {
    const mm = m.match(re);
    if (mm) return tpl.replace(/\$(\d)/g, (_, i) => mm[Number(i)] ?? `$${i}`);
  }
  return m;
}
