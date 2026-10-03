// src/dsh-gate/host.ts — 防腐层·宿主服务访问
//
// ★ 防腐层（Anti-Corruption Layer）铁律：整个 dag-flow 只有 src/dsh-gate/ 允许
//   直接接触 DSH 的 cordis ctx（服务名、ctx.get 语义、inject 快照机制）。
//   DSH 升版导致服务访问方式变化时，只改本文件；业务代码（adapter/registry/executor/
//   client）通过本模块的稳定签名访问宿主，不感知 DSH 版本。
//
// 宿主服务清单（2026-10-02）：
//   webServer          — dsh-auto-compact / dsh-versions 同款（client HTTP API 注册）
//   tools              — dsh-vision-router 同款（/workflow 工具注册）
//   workspaceRegistry  — dsh-workspace 提供（存储根锚定 <当前工作区>/.dag-flow/）
//   llm                — LlmRuntime（listProviders/listModels/stream，DSH 自带模型发现与分发）
// ★ 0.2.0 cordis 4.x 没有 optional inject——声明宿主不存在的服务名会让插件永不 apply。
//   新增名字前必须先经 cordis_inspect 查证宿主确有此服务（教训见 2026-10-01 404 事故）。

/** DSH 传给 apply(ctx) 的根对象（cordis Context）。业务代码不要假设它的形状。 */
export type DshHost = unknown;

/**
 * 本插件依赖的宿主服务名（= src/index.ts 的 inject 数组唯一来源）。
 * cordis fiber.store 只快照 inject 名单里的服务，名单变更 = 本常量一处改动。
 */
export const HOST_INJECT: string[] = ['webServer', 'tools', 'workspaceRegistry', 'llm'];

let _host: DshHost = null;

/** apply(ctx) 时由 safety.initSafety 调用（防腐层内部接线，业务代码勿调）。 */
export function setHost(host: DshHost): void {
  _host = host;
}

/** 宿主句柄。apply(ctx) 前为 null。 */
export function getHost(): DshHost {
  return _host;
}

/**
 * 安全读取宿主服务/属性（dsh 0.2.0 起必须走这里，禁止业务代码裸 ctx.xxx）。
 *
 * 前提：服务名必须已写进 HOST_INJECT——fiber.store 只快照 inject 名单，
 * 没声明的话 get / 属性访问都拿不到（fiber.ts _checkImpl / this.store 快照）。
 *
 * 三层容错顺序：ctx.get(name)（strict）→ ctx.get(name, false)（非严格：服务存在
 * 但 fiber 尚未 ACTIVE 时 strict 拿 undefined）→ 属性访问（兼容 0.1.x 与
 * logger/cwd 这类 ctx 自有属性）。任何异常都吞掉返回 undefined——探测代码
 * 不允许因为宿主升版而抛错。
 */
export function hostService(name: string, host: DshHost = _host): unknown {
  if (host == null) return undefined;
  const ctx = host as Record<string, unknown>;
  try {
    const get = ctx.get as ((n: string, strict?: boolean) => unknown) | undefined;
    if (typeof get === 'function') {
      const strict = get.call(host, name);
      if (strict !== undefined && strict !== null) return strict;
      const lax = get.call(host, name, false);
      if (lax !== undefined && lax !== null) return lax;
    }
  } catch {
    /* 0.2.0 之前没有 ctx.get / get 抛错 → 退回属性访问 */
  }
  try {
    return ctx[name];
  } catch {
    return undefined;
  }
}
