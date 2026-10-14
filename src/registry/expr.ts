// src/registry/expr.ts — 表达式求值（if / while / condition）
// 封装 expr-eval，避免业务代码直接 import 第三方包（便于替换）

import { Parser, type Expression } from 'expr-eval';

const parser = new Parser({
  operators: {
    in: false,
    // ★ 2026-10-14 阶段五：`notin` 与 `concat` 两个选项删除——expr-eval 全包（含 .d.ts）没有这两个键，
    //   运行时从未读过（死选项）。★备注：原作者写 concat:false 的意图是「禁字符串拼接」，从未生效过
    //   （正确选项名是 concatenate）——现网 if/while 条件零处用到拼接；要真禁请改 concatenate:false（等拍板）。
    assignment: false,
    logical: true,
    comparison: true,
  },
});

const EXP = new Set(['Math', 'Number', 'String', 'Boolean', 'Array', 'Object', 'JSON', 'Date']);

export class ExprError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'ExprError';
  }
}

/** 求值一个表达式。可读 ctx（inputs + vars + results.<id>.out）。 */
export function evaluateExpr(expr: string, scope: Record<string, unknown>): unknown {
  let parsed: Expression;
  try {
    parsed = parser.parse(expr);
  } catch (e) {
    throw new ExprError(`表达式解析失败: ${(e as Error).message} | 表达式: ${expr}`);
  }
  // 阻止访问 window/process/require 之类
  for (const k of Object.keys(scope)) {
    if (!EXP.has(k) && typeof scope[k] === 'object' && scope[k] !== null) {
      // 允许；但函数对象会被丢弃
      if (typeof (scope[k] as { [k: string]: unknown })[k] === 'function') {
        throw new ExprError(`作用域 ${k} 中的函数引用不被允许`);
      }
    }
  }
  try {
    // ★ Math/JSON（缺索引签名）与 Boolean/Array 构造器装不进 expr-eval 的 Value 类型 → 断言过桥；
    //   运行时与 nocheck 时代完全一致（这份白名单本来就是给求值器用的标准全局）。
    const evalScope = {
      ...scope,
      // 显式白名单
      Math, Number, String, Boolean, Array, Object, JSON, Date,
    } as unknown as Record<string, never>;
    return parsed.evaluate(evalScope);
  } catch (e) {
    throw new ExprError(`表达式求值失败: ${(e as Error).message} | 表达式: ${expr}`);
  }
}

/** 强转 boolean。expr 自身可以不是 boolean（最后取 !!）。
 *  两类告警（均按 false 处理，不改变既有语义）：
 *  ①表达式最终值为 NaN（如裸 Number(不存在字段)）；
 *  ②表达式含 ".out" 且结果为 false——表达式作用域里节点输出按 <节点id> 拍平或用 results.<id>，
 *    永远没有 ".out" 写法（那是模板语法），含 .out 的 false 几乎必是笔误（09-27 实测两次踩坑）。 */
export function evaluateBool(expr: string, scope: Record<string, unknown>): boolean {
  const v = evaluateExpr(expr, scope);
  if (typeof v === 'number' && Number.isNaN(v)) {
    // eslint-disable-next-line no-console
    console.warn(`[dag-flow] 条件表达式结果为 NaN，已按 false 处理: ${expr}——常见原因：表达式里写了模板式的 node.out / results.<id>.out；表达式作用域中节点输出按 <节点id> 直接取（对象型 out 再取字段，如 ws.count），或用 results.<id> 命名空间`);
  } else if (v === false && /[A-Za-z0-9_\])]\.out\b/.test(expr)) {
    // eslint-disable-next-line no-console
    console.warn(`[dag-flow] 条件表达式含 ".out" 且结果为 false——表达式作用域没有 ".out" 写法（节点输出按 <节点id> 拍平取值，或用 results.<id> 命名空间），疑似笔误，已按 false 处理: ${expr}`);
  }
  return Boolean(v);
}
