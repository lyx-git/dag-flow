// src/executor/dataflow.ts — DAG 数据向下传递机制
//
// 目标：让下游节点的参数可以引用上游节点的输出，实现数据在 DAG 中的向下流动。
//
// 引用语法（模板字符串）：
//   {{nodeId.out}}          → 上游节点 nodeId 的完整输出（NodeResult.out）
//   {{nodeId.out.field}}    → 上游输出的字段（嵌套点路径，支持 a.b.c）
//   {{nodeId.out.list.0}}   → 上游输出里的数组元素（点路径数字段 = 数组下标）
//   {{vars.xxx}}            → 共享变量 xxx（set_var 节点写入）
//   {{inputs.xxx}}          → 工作流输入 xxx
//   {{results.nodeId}}      → 上游节点完整 NodeResult（含 status/durationMs）
//
// 解析时机：执行节点前，把 params 里的模板字符串替换为实际值（递归遍历对象/数组）。
// 校验时机：解析时若引用不合法（节点不存在/未执行/字段缺失）→ 抛 DataflowError。

import type { Context, JsonValue, NodeResult } from '../types.js';

export class DataflowError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'DataflowError';
  }
}

/** 模板引用正则：{{ ... }}（允许空白与点路径） */
const REF_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

/** 解析路径：'nodeId.out.field' → { ref: 'nodeId.out', path: 'field' } 或 vars/inputs */
function resolveRefToken(token: string, ctx: Context, nodeId: string): { ok: boolean; value?: JsonValue; error?: string } {
  const parts = token.split('.').filter((p) => p.length > 0);
  if (parts.length === 0) return { ok: false, error: `节点 "${nodeId}" 中存在空引用` };

  // 1. 输入引用：inputs.xxx
  if (parts[0] === 'inputs') {
    let cur: JsonValue = ctx.inputs as JsonValue;
    for (let i = 1; i < parts.length; i++) {
      const step = stepInto(cur, parts[i], `inputs.${parts.slice(1).join('.')}`, nodeId);
      if ('error' in step) return { ok: false, error: step.error };
      cur = step.value;
    }
    return { ok: true, value: cur };
  }

  // 2. 共享变量引用：vars.xxx
  if (parts[0] === 'vars') {
    let cur: JsonValue = ctx.vars as JsonValue;
    for (let i = 1; i < parts.length; i++) {
      const step = stepInto(cur, parts[i], `vars.${parts.slice(1).join('.')}`, nodeId);
      if ('error' in step) return { ok: false, error: step.error };
      cur = step.value;
    }
    return { ok: true, value: cur };
  }

  // 3. 上游节点输出：nodeId.out[.field]（out 可省略 → nodeId 直接代表 out）
  const nodeRef = parts[0];
  const nodeResult: NodeResult | undefined = ctx.results[nodeRef];
  if (!nodeResult) {
    return { ok: false, error: `节点 "${nodeId}" 引用了 "${nodeRef}"：该节点尚未执行或不存在` };
  }
  if (nodeResult.status !== 'success') {
    return { ok: false, error: `节点 "${nodeId}" 引用了 "${nodeRef}"：该节点状态为 "${nodeResult.status}"（未成功），没有可用的输出` };
  }

  // parts[1] === 'out' → 取 out；否则视为直接取 out（兼容 nodeId 即 out）
  let cur: JsonValue = nodeResult.out ?? null;
  const start = parts[1] === 'out' ? 2 : 1;
  for (let i = start; i < parts.length; i++) {
    const step = stepInto(cur, parts[i], parts.slice(1).join('.'), nodeId, nodeRef);
    if ('error' in step) return { ok: false, error: step.error };
    cur = step.value;
  }
  return { ok: true, value: cur };
}

/** 路径单步推进：对象取键，数组取数字下标（如 list.0.url）；其余为不可达路径 */
function stepInto(
  cur: JsonValue,
  key: string,
  pathLabel: string,
  nodeId: string,
  nodeRef?: string,
): { value: JsonValue } | { error: string } {
  if (Array.isArray(cur)) {
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0 || String(idx) !== key) {
      return { error: `路径 "${pathLabel}" 的 "${key}" 处需要数字数组下标${nodeRef ? `（节点 "${nodeRef}"）` : ''}（节点 ${nodeId}）` };
    }
    if (idx >= cur.length) {
      return { error: `路径 "${pathLabel}" 的下标 ${idx} 超出数组范围（长度 ${cur.length}）${nodeRef ? `，节点 "${nodeRef}"` : ''}（节点 ${nodeId}）` };
    }
    return { value: cur[idx] ?? null };
  }
  if (cur == null || typeof cur !== 'object') {
    return { error: `路径 "${pathLabel}" 不可达（上游输出在该处不是对象/数组）${nodeRef ? `，节点 "${nodeRef}"` : ''}（节点 ${nodeId}）` };
  }
  return { value: (cur as Record<string, JsonValue>)[key] ?? null };
}

/**
 * 解析节点参数中的模板引用，替换为实际值。
 * @param params 原始 params
 * @param ctx 运行时上下文（results/vars/inputs）
 * @param nodeId 当前节点 id（错误信息用）
 * @param opts 可选：strict=false 时引用解析失败降级为原字符串（不抛错），便于宽松模式
 */
export function resolveParams(
  params: Record<string, JsonValue>,
  ctx: Context,
  nodeId: string,
  opts?: { strict?: boolean },
): Record<string, JsonValue> {
  const strict = opts?.strict !== false;
  // params 入参本身是 Record；walk 的 JsonValue 返回类型是宽化签名，运行时与入参同构
  return walk(params) as Record<string, JsonValue>;

  function walk(v: JsonValue): JsonValue {
    if (typeof v === 'string') {
      // 纯引用：整个字符串就是一个 {{...}} → 直接替换为值（保持类型，数组/对象原样返回）
      // 判定：token 内部不得再含花括号（排除 "{{a}} {{b}}" 多模板拼接的场景）
      const trimmed = v.trim();
      const inner = trimmed.startsWith('{{') && trimmed.endsWith('}}') ? trimmed.slice(2, -2) : null;
      if (inner !== null && !inner.includes('{') && !inner.includes('}')) {
        const token = inner.trim();
        const r = resolveRefToken(token, ctx, nodeId);
        if (r.ok) return r.value as JsonValue;
        if (strict) throw new DataflowError(r.error ?? `引用解析失败: ${token}`);
        return v; // 宽松：保留原字符串
      }
      // 混合模板：替换所有 {{...}} 为字符串值
      let out = v;
      let m: RegExpExecArray | null;
      REF_RE.lastIndex = 0;
      while ((m = REF_RE.exec(v)) !== null) {
        const token = m[1].trim();
        const r = resolveRefToken(token, ctx, nodeId);
        if (!r.ok) {
          if (strict) throw new DataflowError(r.error ?? `引用解析失败: ${token}`);
          continue;
        }
        const sv = typeof r.value === 'string' ? r.value : JSON.stringify(r.value ?? null);
        out = out.replace(m[0], sv);
      }
      return out;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') {
      const outObj: Record<string, JsonValue> = {};
      for (const [k, val] of Object.entries(v)) outObj[k] = walk(val);
      return outObj;
    }
    return v;
  }
}

/**
 * 校验 params 中的所有模板引用是否可解析（不实际替换，仅检查）。
 * 返回错误列表；空数组 = 全部合法。
 * 用于运行前预检，保证"高效无错跑完"。
 */
export function validateRefs(params: Record<string, JsonValue>, ctx: Context, nodeId: string): string[] {
  const errors: string[] = [];
  try {
    resolveParams(params, ctx, nodeId, { strict: true });
  } catch (e) {
    if (e instanceof DataflowError) errors.push(e.message);
    else throw e;
  }
  return errors;
}

/**
 * 提取 params 中引用了哪些上游节点 id（供预检：依赖的节点必须存在且拓扑序在其前）。
 * 返回 { nodeRefs: string[], varsUsed: string[], inputsUsed: string[] }
 */
export function extractRefs(params: Record<string, JsonValue>): { nodeRefs: string[]; varsUsed: string[]; inputsUsed: string[] } {
  const nodeRefs = new Set<string>();
  const varsUsed = new Set<string>();
  const inputsUsed = new Set<string>();
  const scan = (v: JsonValue) => {
    if (typeof v === 'string') {
      const trimmed = v.trim();
      const tokens: string[] = [];
      if (trimmed.startsWith('{{') && trimmed.endsWith('}}') && !trimmed.includes('}}', 2)) {
        tokens.push(trimmed.slice(2, -2).trim());
      } else {
        let m: RegExpExecArray | null;
        REF_RE.lastIndex = 0;
        while ((m = REF_RE.exec(v)) !== null) tokens.push(m[1].trim());
      }
      for (const t of tokens) {
        const parts = t.split('.').filter((p) => p.length > 0);
        if (parts[0] === 'vars') varsUsed.add(parts.slice(1).join('.'));
        else if (parts[0] === 'inputs') inputsUsed.add(parts.slice(1).join('.'));
        else if (parts[0] === 'results') nodeRefs.add(parts[1] ?? '');
        else nodeRefs.add(parts[0]);
      }
      return;
    }
    if (Array.isArray(v)) v.forEach(scan);
    else if (v !== null && typeof v === 'object') Object.values(v).forEach(scan);
  };
  scan(params as JsonValue);
  return { nodeRefs: [...nodeRefs], varsUsed: [...varsUsed], inputsUsed: [...inputsUsed] };
}
