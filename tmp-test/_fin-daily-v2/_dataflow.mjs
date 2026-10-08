// src/executor/dataflow.ts
var DataflowError = class extends Error {
  constructor(msg) {
    super(msg);
    this.name = "DataflowError";
  }
};
var REF_RE = /\{\{\s*([^}]+?)\s*\}\}/g;
function resolveRefToken(token, ctx, nodeId) {
  const parts = token.split(".").filter((p) => p.length > 0);
  if (parts.length === 0) return { ok: false, error: `\u8282\u70B9 "${nodeId}" \u4E2D\u5B58\u5728\u7A7A\u5F15\u7528` };
  if (parts[0] === "inputs") {
    let cur2 = ctx.inputs;
    for (let i = 1; i < parts.length; i++) {
      const step = stepInto(cur2, parts[i], `inputs.${parts.slice(1).join(".")}`, nodeId);
      if ("error" in step) return { ok: false, error: step.error };
      cur2 = step.value;
    }
    return { ok: true, value: cur2 };
  }
  if (parts[0] === "vars") {
    let cur2 = ctx.vars;
    for (let i = 1; i < parts.length; i++) {
      const step = stepInto(cur2, parts[i], `vars.${parts.slice(1).join(".")}`, nodeId);
      if ("error" in step) return { ok: false, error: step.error };
      cur2 = step.value;
    }
    return { ok: true, value: cur2 };
  }
  const nodeRef = parts[0];
  const nodeResult = ctx.results[nodeRef];
  if (!nodeResult) {
    return { ok: false, error: `\u8282\u70B9 "${nodeId}" \u5F15\u7528\u4E86 "${nodeRef}"\uFF1A\u8BE5\u8282\u70B9\u5C1A\u672A\u6267\u884C\u6216\u4E0D\u5B58\u5728` };
  }
  if (nodeResult.status !== "success") {
    return { ok: false, error: `\u8282\u70B9 "${nodeId}" \u5F15\u7528\u4E86 "${nodeRef}"\uFF1A\u8BE5\u8282\u70B9\u72B6\u6001\u4E3A "${nodeResult.status}"\uFF08\u672A\u6210\u529F\uFF09\uFF0C\u6CA1\u6709\u53EF\u7528\u7684\u8F93\u51FA` };
  }
  let cur = nodeResult.out ?? null;
  const start = parts[1] === "out" ? 2 : 1;
  for (let i = start; i < parts.length; i++) {
    const step = stepInto(cur, parts[i], parts.slice(1).join("."), nodeId, nodeRef);
    if ("error" in step) return { ok: false, error: step.error };
    cur = step.value;
  }
  return { ok: true, value: cur };
}
function stepInto(cur, key, pathLabel, nodeId, nodeRef) {
  if (Array.isArray(cur)) {
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0 || String(idx) !== key) {
      return { error: `\u8DEF\u5F84 "${pathLabel}" \u7684 "${key}" \u5904\u9700\u8981\u6570\u5B57\u6570\u7EC4\u4E0B\u6807${nodeRef ? `\uFF08\u8282\u70B9 "${nodeRef}"\uFF09` : ""}\uFF08\u8282\u70B9 ${nodeId}\uFF09` };
    }
    if (idx >= cur.length) {
      return { error: `\u8DEF\u5F84 "${pathLabel}" \u7684\u4E0B\u6807 ${idx} \u8D85\u51FA\u6570\u7EC4\u8303\u56F4\uFF08\u957F\u5EA6 ${cur.length}\uFF09${nodeRef ? `\uFF0C\u8282\u70B9 "${nodeRef}"` : ""}\uFF08\u8282\u70B9 ${nodeId}\uFF09` };
    }
    return { value: cur[idx] ?? null };
  }
  if (cur == null || typeof cur !== "object") {
    return { error: `\u8DEF\u5F84 "${pathLabel}" \u4E0D\u53EF\u8FBE\uFF08\u4E0A\u6E38\u8F93\u51FA\u5728\u8BE5\u5904\u4E0D\u662F\u5BF9\u8C61/\u6570\u7EC4\uFF09${nodeRef ? `\uFF0C\u8282\u70B9 "${nodeRef}"` : ""}\uFF08\u8282\u70B9 ${nodeId}\uFF09` };
  }
  return { value: cur[key] ?? null };
}
function resolveParams(params, ctx, nodeId, opts) {
  const strict = opts?.strict !== false;
  return walk(params);
  function walk(v) {
    if (typeof v === "string") {
      const trimmed = v.trim();
      const inner = trimmed.startsWith("{{") && trimmed.endsWith("}}") ? trimmed.slice(2, -2) : null;
      if (inner !== null && !inner.includes("{") && !inner.includes("}")) {
        const token = inner.trim();
        const r = resolveRefToken(token, ctx, nodeId);
        if (r.ok) return r.value;
        if (strict) throw new DataflowError(r.error ?? `\u5F15\u7528\u89E3\u6790\u5931\u8D25: ${token}`);
        return v;
      }
      let out = v;
      let m;
      REF_RE.lastIndex = 0;
      while ((m = REF_RE.exec(v)) !== null) {
        const token = m[1].trim();
        const r = resolveRefToken(token, ctx, nodeId);
        if (!r.ok) {
          if (strict) throw new DataflowError(r.error ?? `\u5F15\u7528\u89E3\u6790\u5931\u8D25: ${token}`);
          continue;
        }
        const sv = typeof r.value === "string" ? r.value : JSON.stringify(r.value ?? null);
        out = out.replace(m[0], sv);
      }
      return out;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") {
      const outObj = {};
      for (const [k, val] of Object.entries(v)) outObj[k] = walk(val);
      return outObj;
    }
    return v;
  }
}
function validateRefs(params, ctx, nodeId) {
  const errors = [];
  try {
    resolveParams(params, ctx, nodeId, { strict: true });
  } catch (e) {
    if (e instanceof DataflowError) errors.push(e.message);
    else throw e;
  }
  return errors;
}
function extractRefs(params) {
  const nodeRefs = /* @__PURE__ */ new Set();
  const varsUsed = /* @__PURE__ */ new Set();
  const inputsUsed = /* @__PURE__ */ new Set();
  const scan = (v) => {
    if (typeof v === "string") {
      const trimmed = v.trim();
      const tokens = [];
      if (trimmed.startsWith("{{") && trimmed.endsWith("}}") && !trimmed.includes("}}", 2)) {
        tokens.push(trimmed.slice(2, -2).trim());
      } else {
        let m;
        REF_RE.lastIndex = 0;
        while ((m = REF_RE.exec(v)) !== null) tokens.push(m[1].trim());
      }
      for (const t of tokens) {
        const parts = t.split(".").filter((p) => p.length > 0);
        if (parts[0] === "vars") varsUsed.add(parts.slice(1).join("."));
        else if (parts[0] === "inputs") inputsUsed.add(parts.slice(1).join("."));
        else if (parts[0] === "results") nodeRefs.add(parts[1] ?? "");
        else nodeRefs.add(parts[0]);
      }
      return;
    }
    if (Array.isArray(v)) v.forEach(scan);
    else if (v !== null && typeof v === "object") Object.values(v).forEach(scan);
  };
  scan(params);
  return { nodeRefs: [...nodeRefs], varsUsed: [...varsUsed], inputsUsed: [...inputsUsed] };
}
export {
  DataflowError,
  extractRefs,
  resolveParams,
  validateRefs
};
