// src/executor/parse.ts — 工作流定义校验
// 校验：JSON schema + 节点 id 唯一 + next 引用合法 + 拓扑（有起点 + 终点）+ 至少 1 个 start + 至少 1 个 end

import Ajv, { type ValidateFunction } from 'ajv';
import { WORKFLOW_SCHEMA, type WorkflowDef, type Node } from '../types.js';

const ajv = new Ajv({ allErrors: true, strict: false, unicodeRegExp: true });
const validateSchema: ValidateFunction = ajv.compile(WORKFLOW_SCHEMA);

export class WorkflowParseError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'WorkflowParseError';
  }
}

/** ajv 英文错误消息 → 中文（常见模式映射，未命中保留原文） */
const AJV_ZH: [RegExp, string][] = [
  [/must have required property '([^']+)'/, '缺少必填字段 "$1"'],
  [/must NOT have additional properties/, '存在不允许的多余字段'],
  [/must be (string|object|array|number|integer|boolean|null)/, '类型必须是 $1'],
  [/must match pattern '([^']+)'/, '必须匹配格式 $1'],
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
function zhAjvMessage(m: string): string {
  for (const [re, tpl] of AJV_ZH) {
    const mm = m.match(re);
    if (mm) return tpl.replace(/\$(\d)/g, (_, i) => mm[Number(i)] ?? `$${i}`);
  }
  return m;
}

/** 节点「显示名_id」标签（2026-10-02 用户要求：报错必须能一眼看出是哪个节点）。
 *  label 缺失或与 id 相同时退化为 id；连 id 都没有则用 fallback（如 #17）。 */
export function nodeTag(node: { id?: unknown; label?: unknown } | undefined, fallback = ''): string {
  const id = typeof node?.id === 'string' && node.id ? node.id : fallback;
  const label = typeof node?.label === 'string' ? node.label : '';
  return label && label !== id ? `${label}_${id}` : id;
}

/** JSON Pointer（如 /nodes/17/next）→ 人话位置（如 节点 多路分支：运行模式(switch) 的 next） */
function locate(def: unknown, instancePath: string): string {
  const raw = instancePath || '/';
  const m = /^\/nodes\/(\d+)((?:\/.*)?)$/.exec(raw);
  if (!m) return raw;
  const idx = Number(m[1]);
  const nodes = (def as { nodes?: unknown } | null)?.nodes;
  const node = Array.isArray(nodes)
    ? (nodes[idx] as { id?: unknown; label?: unknown; type?: unknown } | undefined)
    : undefined;
  const tag = nodeTag(node, `#${idx}`);
  const type = typeof node?.type === 'string' && node.type ? `(${node.type})` : '';
  const rest = (m[2] ?? '').replace(/^\//, '').replace(/\//g, '.');
  return `节点 ${tag}${type}${rest ? ` 的 ${rest}` : ''}`;
}

/** 已知 oneOf 字段的可选形式：折叠报错时一并给出人话提示 */
const ONEOF_FORMS: Record<string, string> = {
  next: '字符串 / 字符串数组 / { 分支键: 目标节点id } 对象 / null',
  onError: '"stop" / "continue" / { goto: 目标节点id }',
};

export function parseAndValidate(def: unknown): WorkflowDef {
  if (!validateSchema(def)) {
    const errs = validateSchema.errors ?? [];
    // oneOf/anyOf 折叠（2026-10-02 用户要求）：ajv 会把每个候选分支的失败各报一条，
    // 一个根因能喷 9 条（类型必须是 string；缺少必填字段 "true"；…；must match exactly one schema）。
    // 这里同一路径的 oneOf 只保留一条摘要 + 允许形式提示，分支内的子错误丢弃。
    const folded = new Set(
      errs.filter((e) => e.keyword === 'oneOf' || e.keyword === 'anyOf').map((e) => e.instancePath ?? ''),
    );
    const lines: string[] = [];
    const seen = new Set<string>();
    const push = (line: string): void => {
      if (seen.has(line)) return;
      seen.add(line);
      lines.push(line);
    };
    for (const e of errs) {
      const path = e.instancePath ?? '';
      if (folded.has(path)) {
        const forms = ONEOF_FORMS[path.split('/').filter(Boolean).pop() ?? ''];
        push(`${locate(def, path)} 结构不符合任一允许的形式${forms ? `（允许：${forms}）` : ''}`);
        continue;
      }
      // 已被折叠的 oneOf 分支内部子错误：不再重复输出
      if (e.schemaPath?.includes('/oneOf/') || e.schemaPath?.includes('/anyOf/')) continue;
      push(`${locate(def, path)} ${zhAjvMessage(e.message ?? '')}`);
    }
    throw new WorkflowParseError(`工作流结构校验未通过: ${lines.join('；')}`);
  }
  const wf = def as WorkflowDef;

  // 节点 id 唯一
  const ids = new Set<string>();
  for (const n of wf.nodes) {
    if (ids.has(n.id)) throw new WorkflowParseError(`节点 id 重复: ${n.id}`);
    ids.add(n.id);
  }

  // next 引用合法
  for (const n of wf.nodes) {
    if (n.next === undefined || n.next === null) continue;
    if (typeof n.next === 'string') {
      checkRef(n.id, n.next, ids);
    } else if (Array.isArray(n.next)) {
      for (const ref of n.next) checkRef(n.id, ref, ids);
    } else {
      // 泛化 object next：{true,false}（if）或 { [case值]: 目标 }（switch 多分支）
      for (const ref of Object.values(n.next)) checkRef(n.id, ref, ids);
    }
    // onError.goto
    if (n.onError && typeof n.onError === 'object' && n.onError.goto) {
      checkRef(n.id, n.onError.goto, ids);
    }
  }

  // 至少 1 个 start + 至少 1 个 end
  const starts = wf.nodes.filter((n) => n.type === 'start');
  const ends = wf.nodes.filter((n) => n.type === 'end');
  if (starts.length !== 1) throw new WorkflowParseError(`start 节点必须恰好 1 个（当前 ${starts.length} 个）`);
  if (ends.length < 1) throw new WorkflowParseError(`缺少 end 节点（至少需要 1 个）`);

  // 拓扑可达性（粗略）：从 start BFS 触达的所有节点（同时考虑 next 与 edges），触达之外的节点警告
  const reachable = new Set<string>([starts[0]!.id]);
  const stack = [starts[0]!.id];
  const edgeTargets = new Map<string, string[]>();
  for (const e of wf.edges ?? []) {
    const list = edgeTargets.get(e.from) ?? [];
    list.push(e.to);
    edgeTargets.set(e.from, list);
  }
  while (stack.length) {
    const cur = stack.pop()!;
    const node = wf.nodes.find((n) => n.id === cur);
    if (!node) continue;
    const refs = [...nextRefs(node), ...(edgeTargets.get(cur) ?? [])];
    for (const r of refs) if (r && !reachable.has(r)) { reachable.add(r); stack.push(r); }
  }
  const orphans = wf.nodes.filter((n) => !reachable.has(n.id) && n.type !== 'start');
  if (orphans.length) {
    // 不致命，仅警告
    // eslint-disable-next-line no-console
    console.warn(`[dag-flow] 以下节点不可达（未连接到 start）: ${orphans.map((o) => o.id).join(', ')}`);
  }

  return wf;
}

function checkRef(from: string, ref: string, ids: Set<string>): void {
  if (ref === '__end__') return; // 虚拟终点
  if (!ids.has(ref)) throw new WorkflowParseError(`节点 "${from}" 引用了不存在的 id "${ref}"`);
}

function nextRefs(n: Node): (string | null)[] {
  if (n.next === undefined || n.next === null) return [];
  if (typeof n.next === 'string') return [n.next];
  if (Array.isArray(n.next)) return n.next;
  return Object.values(n.next);
}
