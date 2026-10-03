// src/dsh-gate/registrar.ts — 防腐层·宿主扩展点注册
//
// ★ DSH 注册契约（webServer 路由 / tools 工具）的形状假设只在适配到本文件：
//   - ctx.webServer.register({ kind: 'exact'|'prefix', path, handler }) → 返回 disposer
//     （重复注册同一 (kind,path) 抛 webserver: duplicate ... route——profile 是
//      patchReload:"live"，插件热重载必须先注销旧路由，见 index.ts bindDispose）
//   - ctx.tools.register(tool) → 返回 disposer
// dsh 升版改注册契约时只改本文件，api.ts / cli.ts 不动。
//
// 防腐层不做漂移策略（drift/safe-mode 判断留在 adapter/safety.ts 与各调用方的
// disabledApis 门卫里）——本模块只负责「契约怎么调」。

import { hostService } from './host.js';

/** 统一注册结果（= api.ts/cli.ts AttachResult 形状，index.ts bindDispose 消费） */
export interface HostAttachResult {
  registered: boolean;
  reason?: string;
  dispose?: () => void;
}

/** 路由规格（kind 缺省 exact；prefix 路由由 dsh 按前缀匹配） */
export interface HostRouteSpec {
  kind?: 'exact' | 'prefix';
  path: string;
  handler: (req: any, res: any) => unknown;
}

/**
 * 注册一个 DSH 工具（cli.ts 的 /workflow 工具用）。
 * 服务不可用/注册抛错都折叠成 { registered:false, reason }，不抛错。
 */
export function registerHostTool(tool: unknown): HostAttachResult {
  const tools = hostService('tools') as { register?: (t: unknown) => unknown } | null | undefined;
  const fn = tools?.register;
  if (typeof fn !== 'function') {
    return { registered: false, reason: '宿主上未找到 ctx.tools.register' };
  }
  try {
    const d = fn.call(tools, tool);
    return {
      registered: true,
      dispose: typeof d === 'function'
        ? () => { try { (d as () => void)(); } catch { /* 已注销 */ } }
        : undefined,
    };
  } catch (e) {
    return { registered: false, reason: (e as Error).message };
  }
}

export interface HostRouteRegistrar {
  /** 注册一条路由：失败仅告警跳过，不中断其余路由 */
  register: (spec: HostRouteSpec) => void;
  /** 已成功注册（返回了 disposer）的路由数——日志/测试断言口径 */
  count: () => number;
  /** 注销全部路由（热重载时由 index.ts 挂到 ctx.effect） */
  dispose: () => void;
}

/**
 * 创建 webServer 路由注册器（api.ts 的 registerApiRoutes 用）。
 * webServer 不可用时返回 { error }（调用方折叠成 registered:false + reason）。
 */
export function createHostRouteRegistrar(logger: { warn: (msg: string) => void }): HostRouteRegistrar | { error: string } {
  const webServer = hostService('webServer') as { register?: (r: unknown) => unknown } | null | undefined;
  const register = webServer?.register;
  if (typeof register !== 'function') {
    return { error: '宿主上未找到 ctx.webServer.register' };
  }
  const disposers: Array<() => void> = [];
  return {
    register(spec: HostRouteSpec): void {
      try {
        const d = register.call(webServer, { kind: spec.kind ?? 'exact', path: spec.path, handler: spec.handler });
        if (typeof d === 'function') disposers.push(d as () => void);
      } catch (e) {
        logger.warn(`路由 ${spec.path} 注册失败（已跳过）: ${(e as Error).message}`);
      }
    },
    count: () => disposers.length,
    dispose: (): void => {
      for (const d of disposers.splice(0)) {
        try {
          d();
        } catch {
          /* 路由已不存在（宿主重启等）→ 忽略 */
        }
      }
    },
  };
}
