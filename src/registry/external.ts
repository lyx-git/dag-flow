// src/registry/external.ts — 节点注册表（公开 API）
// 第三方插件通过 registerNode() 扩展

import type { NodeDefinition, Context, NodeResult, JsonValue } from '../types.js';

class WorkflowNodeRegistryImpl {
  defs = new Map<string, NodeDefinition>();

  register<P>(def: NodeDefinition<P>): void {
    if (!def || typeof def.type !== 'string' || !def.type) {
      throw new Error('注册节点失败：缺少 def.type');
    }
    if (typeof def.run !== 'function') {
      throw new Error(`注册节点 ${def.type} 失败：def.run 必须是函数`);
    }
    if (this.defs.has(def.type)) {
      // 同类型重复注册 → 警告并覆盖（取最后一个）
      // eslint-disable-next-line no-console
      console.warn(`[dag-flow] 节点类型 "${def.type}" 被重复注册，已覆盖为后注册者`);
    }
    this.defs.set(def.type, def as unknown as NodeDefinition);
  }

  unregister(type: string): boolean {
    return this.defs.delete(type);
  }

  get(type: string): NodeDefinition | undefined {
    return this.defs.get(type);
  }

  list(): NodeDefinition[] {
    return Array.from(this.defs.values());
  }

  has(type: string): boolean {
    return this.defs.has(type);
  }
}

export const WorkflowNodeRegistry = new WorkflowNodeRegistryImpl();

/** 给第三方插件用的便捷 helper */
export function registerNode<P>(def: NodeDefinition<P>): void {
  WorkflowNodeRegistry.register(def);
}

/** 把 ctx 拍平成 expr 可用的 scope（inputs + vars + 节点 out 拍平 + results 命名空间）。 */
export function ctxToScope(ctx: Context): Record<string, unknown> {
  // 顶层展开 inputs/vars（兼容直接写 base）+ 保留对象本身（表达式可写 inputs.base / vars.k）
  const scope: Record<string, unknown> = { ...ctx.inputs, ...ctx.vars, inputs: ctx.inputs, vars: ctx.vars };
  // 节点输出双通道：拍平（py_gate 即该节点 out，既有形态）+ results 命名空间
  // （results.<id> 与模板 {{results.<id>}} 同义，09-27 统一两套语法——
  //  修"py_gate.out 模板式写法在表达式里取 undefined → NaN 静默走 false"的坑）
  const results: Record<string, unknown> = {};
  for (const [id, r] of Object.entries(ctx.results)) {
    const out = r.out ?? null;
    scope[id] = out;
    results[id] = out;
  }
  scope.results = results;
  return scope;
}

/** 构造一个空 NodeResult 的小工具 */
export function makeResult(
  status: NodeResult['status'],
  partial: Partial<NodeResult> = {},
): NodeResult {
  const now = new Date().toISOString();
  return {
    status,
    durationMs: 0,
    startedAt: now,
    endedAt: now,
    ...partial,
  };
}

/** 节点 run 通用包装：捕获 throw → 转 failed。 */
export async function safeNodeRun(
  fn: () => Promise<NodeResult>,
): Promise<NodeResult> {
  try {
    return await fn();
  } catch (e) {
    return {
      status: 'failed',
      error: {
        code: 'UNCAUGHT',
        message: (e as Error).message,
        stack: (e as Error).stack,
      },
      durationMs: 0,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    };
  }
}

// re-export for 3rd-party
export type { Context, NodeResult, JsonValue, NodeDefinition };
