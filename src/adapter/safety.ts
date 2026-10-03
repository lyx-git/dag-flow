// src/adapter/safety.ts — drift 探测 + 安全模式（业务韧性策略）
//
// ★ 2026-10-02 防腐层改造：宿主服务的「访问方式」已收编 dsh-gate/host.ts（唯一出处），
//   本文件只保留 dag-flow 自己的韧性策略（drift 探测 / safe-mode 判定），并把
//   gate 的服务访问原样转发出去（存量消费方 api/cli/storage/subagent/search/logger
//   的 import 路径不变）。
//
// 历史决策留档：
// - 2026-09-06：dsh 0.1.2-rc.1 真实 ctx API（ctx.tools.register / ctx.get / ctx.effect…）
// - 2026-10-01（dsh 0.2.0 / cordis 4.x）：ctx 变 Proxy + inject 校验，fiber.store 只快照
//   inject 名单——真正的修法是 index.ts 声明 inject（现= dsh-gate/host.ts HOST_INJECT）；
//   hostService 三层容错保留（strict get → lax get → 属性访问），兜住服务存在但 fiber
//   尚未 ACTIVE 的残余时序。三层容错实现在 dsh-gate/host.ts（防腐层）。

import type { JsonValue } from '../types.js';
import { hostService as gateHostService, getHost as gateGetHost, setHost, type DshHost } from '../dsh-gate/host.js';

// —— 转发防腐层的服务访问（存量 import 路径兼容；新代码请直接 import dsh-gate） ——
export { hostService, getHost } from '../dsh-gate/host.js';
export type { DshHost };

// 直接引用（本文件内部用）
const hostService = gateHostService;
const getHost = gateGetHost;

/** DSH 内部 API 探测结果。drifted 数组为空 = 健康。 */
export interface DriftReport {
  drifted: string[];           // 形如 'tools.register' / 'llm.chat' / ...
  details: Record<string, JsonValue>;
  safeMode: boolean;           // true = 进入安全模式
  detectedAt: string;          // ISO
}

/**
 * 我们依赖的 DSH 能力清单。按"探测路径"逐条检查——
 * 一条能力可能对应多个候选路径（兼容不同 dsh 版本形状）。
 */
const CAPABILITY_PATHS: { name: string; paths: string[] }[] = [
  // 工具注册（dsh 0.1.2-rc.1 主要扩展点）
  { name: 'tools.register', paths: ['tools.register'] },
  // web server 路由（client 侧 API）
  { name: 'webServer.register', paths: ['webServer.register'] },
  // 文件系统
  { name: 'fs.resolve', paths: ['fs.resolve'] },
  // 生命周期
  { name: 'effect', paths: ['effect'] },
  // 兼容旧假设（若有则也通过）
  { name: 'cli.registerCommand', paths: ['cli.registerCommand'] },
  { name: 'storage.userDir', paths: ['storage.userDir'] },
  { name: 'subagent.spawn', paths: ['subagent.spawn', 'subagent.run'] },
  // 注：llm.chat / llm.resolveModelInfo 不在探测清单——dsh-llm 是 Typed RemoteService
  // （远程服务，不挂宿主 ctx），这两条路径永远 miss，只会给 drift 报告添噪音（2026-09-26 移除）。
  // AI 节点对 llm 的访问走 dsh-gate/llm.ts（2026-10-02 起 viaHost 主路径 + 方案 B 兜底）。
];

/** 探测单条能力：任一候选路径可用即通过。返回失败原因或 null。 */
function probeCapability(cap: (typeof CAPABILITY_PATHS)[number], host: DshHost): string | null {
  for (const p of cap.paths) {
    try {
      const v = getPath(host, p.split('.'));
      if (typeof v === 'function') return null;
      // tools 等对象本身存在也算（其方法在运行时再探测）
      if (typeof v === 'object' && v !== null && p === 'tools') return null;
    } catch {
      /* continue */
    }
  }
  return `none of [${cap.paths.join(', ')}] found on host`;
}

function getPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = undefined;
  for (let i = 0; i < path.length; i++) {
    const k = path[i] as string;
    if (i === 0) {
      // 首段是服务名，必须走防腐层 hostService（裸 ctx[k] 在 0.2.0 会抛 inject 错误）
      cur = hostService(k, obj);
    } else {
      if (cur == null) return undefined;
      if (typeof cur !== 'object' && typeof cur !== 'function') return undefined;
      cur = (cur as Record<string, unknown>)[k];
    }
    if (cur === undefined) return undefined;
  }
  return cur;
}

/** 启动时调一次（apply(ctx) 里调用，传入真实 ctx）。结果可被 isSafeMode() 查询。 */
export function detectApiDrift(host: DshHost): DriftReport {
  const drifted: string[] = [];
  const details: Record<string, JsonValue> = {};
  for (const cap of CAPABILITY_PATHS) {
    const reason = probeCapability(cap, host);
    if (reason) {
      drifted.push(cap.name);
      details[cap.name] = reason;
    }
  }
  return {
    drifted,
    details,
    // 核心能力缺失才进安全模式（工具注册 + 生命周期）
    safeMode: drifted.includes('tools.register') || drifted.includes('effect'),
    detectedAt: new Date().toISOString(),
  };
}

// === 简易安全模式状态（单例） ===
let _drift: DriftReport | null = null;

/** apply(ctx) 入口：把真实 ctx 交给防腐层持有 + 跑能力探测。 */
export function initSafety(host: DshHost = null): DriftReport {
  setHost(host);
  _drift = detectApiDrift(host);
  return _drift;
}

export function isSafeMode(): boolean {
  return _drift?.safeMode ?? true; // 未初始化视为不安全
}

export function getDriftReport(): DriftReport | null {
  return _drift;
}

/** 哪些能力在安全模式下不可用。 */
export function disabledApis(): string[] {
  return _drift?.drifted ?? [];
}

// getHost 已从防腐层转发导出（apply(ctx) 后即真实 ctx）。
