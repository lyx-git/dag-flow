// src/name-rule.ts — 工作流名称规范（2026-10-01 起支持中文命名）
// 宿主与 client 共用的唯一事实源（旧实现 5 处各自内联 kebab 正则，已收敛到这里）。
//
// 规则：首字符须为字母/数字（Unicode \p{L}/\p{N}，含中文）；其余可为字母/数字/
// 下划线/连字符；总长 ≤64。空白、路径分隔符、点号等危险/干扰字符不合法。
// 规范化：trim → ASCII 小写（中文无大小写，不受影响）→ 非法字符与空白折叠为
// '-' → 去首尾 '-'。'E2E Demo!' → 'e2e-demo'，'每日 简报' → '每日-简报'。
// 纯字符串处理，无 DOM/Node API，client（无后缀导入）与 host（.js 后缀导入）皆可引用。

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}$/u;

/** JSON Schema pattern 源串（与 NAME_RE 同源）——WORKFLOW_SCHEMA 等 schema 消费方使用。
 *  ★ 必须配合 ajv 的 unicodeRegExp: true（\p{L}/\p{N} 需要 u 标志），否则中文名校验会误拒。 */
export const WORKFLOW_NAME_PATTERN = '^[\\p{L}\\p{N}][\\p{L}\\p{N}_-]{0,63}$';

/** 是否为合法工作流名（存储落盘的最终形态校验；同时是防路径穿越闸门） */
export function isValidWorkflowName(name: string): boolean {
  return NAME_RE.test(name);
}

/** 用户输入 → 合法工作流名；空串表示输入无法构成合法名（由调用方报错） */
export function normalizeWorkflowName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}
