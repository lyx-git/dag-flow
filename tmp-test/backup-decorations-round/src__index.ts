// @ts-nocheck
// src/index.ts — 插件入口（DSH 风格：name + inject + apply + 模块顶层副作用）
// 参照 dsh-at-file / dsh-subagent-profile：DSH loader 通过 cordis plugin 调 apply(ctx, config)。
//   1. `name` 暴露插件 id（与 cordis.patch.yml 的 insert id 对齐）
//   2. `inject` 声明本插件依赖的扩展点（DSH loader 会在调 apply 前注入这些服务到 ctx）
//   3. `apply(ctx, config)` 是真正的 host process 入口，DSH loader 通过 ctx.plugin() 调它
//   4. 模块顶层副作用——安全模式下 import 时即跑 registerBuiltinNodes()（fail-soft）
//
// 2026-09-06 修复：apply(ctx) 必须把真实 ctx 传给 initSafety()——之前 initSafety()
// 只在模块顶层无参调用（_host=null），导致所有 DSH host 能力（AI 节点/工具注册/存储）
// 拿不到 host。现在：顶层只注册节点；apply 里 initSafety(ctx) + attachToHost()。

import { initSafety, isSafeMode, getDriftReport } from './adapter/safety.js';
import { HOST_INJECT } from './dsh-gate/host.js';
import { createLogger } from './adapter/logger.js';
import { attachToHost } from './adapter/cli.js';
import { registerBuiltinNodes } from './registry/builtin.js';
import { WorkflowNodeRegistry, registerNode } from './registry/external.js';
import { runWorkflow } from './executor/run.js';
import { writeRunRecord, showWorkflow, listRuns } from './executor/record.js';
import { registerApiRoutes } from './adapter/api.js';
import { startScheduler } from './adapter/scheduler.js';
import type { DshStorage, DshLogger } from './adapter/storage.js';

// —— 模块顶层副作用：注册内置节点（fail-soft，import 时即跑）
let _nodesRegistered = false;
function registerNodesOnce(): void {
  if (_nodesRegistered) return;
  _nodesRegistered = true;
  try {
    registerBuiltinNodes();
  } catch (e) {
    try { console.error('[dag-flow] registerBuiltinNodes failed (non-fatal):', e); } catch {}
  }
}
registerNodesOnce();

// —— DSH cordis 插件接口：name + inject + apply
export const name = 'dag-flow';
// ★ inject 名单唯一来源 = 防腐层 dsh-gate/host.ts 的 HOST_INJECT（服务名清单/访问语义
// /三层容错都在防腐层维护；2026-10-02 防腐层改造后业务代码不感知 DSH 服务名）。
// 现名单：webServer（client HTTP API）、tools（/workflow 工具）、workspaceRegistry
// （存储根锚定 <当前工作区>/.dag-flow/）、llm（自带模型发现与 viaHost 分发）。
// ★ 0.2.0 cordis 无 optional inject——新增名字前必须先经 cordis_inspect 查证宿主确有此服务。
export const inject: string[] = HOST_INJECT;

/** 注册结果（cli.attachToHost / api.registerApiRoutes 的统一返回形状）。 */
interface AttachResult {
  registered: boolean;
  reason?: string;
  dispose?: () => void;
}

/** 把子模块返回的 dispose 挂到宿主 fiber 上（2026-10-01）。
 *
 *  为什么必须挂：profile 的 patchReload 是 "live"，插件重载时旧 fiber 若不回收路由，
 *  dsh-host-webserver 的 register() 会对重复的 (kind,path) 直接抛
 *  `webserver: duplicate ... route`，第二次 apply 起所有路由静默注册失败 → 前端全部 404。
 *  ctx.effect 是 cordis fiber mixin 的 accessor（reflect.ts 的 accessor 分支先于 fiber
 *  检查），不是服务、不需要写进 inject。 */
function bindDispose(ctx: any, dispose: (() => void) | undefined, label: string): boolean {
  if (typeof dispose !== 'function') return false;
  try {
    const effect = ctx?.effect;
    if (typeof effect !== 'function') return false;
    effect.call(ctx, () => dispose, label);
    return true;
  } catch {
    return false;
  }
}

/** DSH loader 实际调用的入口。ctx 是 cordis Context（含 tools/llm/webServer/fs 等）。 */
export function apply(ctx: any, config?: any): void {
  try {
    // 1. ★ 把真实 ctx 注入 safety（AI 节点/工具注册/存储都从这拿 host）
    const drift = initSafety(ctx);

    // 2. 注册内置节点（幂等）
    registerNodesOnce();

    // logger 用 dag-flow 自己的：emit 会同时写 .dag-flow/logs/*.log 并转发给宿主 logger，
    // 避免只依赖 ctx.logger 时文件日志完全缺失（2026-10-01）。
    const logger = createLogger();

    // 3. 注册 /workflow 工具（fail-soft）
    let toolResult: AttachResult = { registered: false };
    try { toolResult = attachToHost() ?? toolResult; } catch (e) {
      try { logger.warn('[dag-flow] attachToHost failed (non-fatal):', e); } catch {}
    }
    bindDispose(ctx, toolResult.dispose, 'dag-flow: workflow tool');

    // 3.5. 注册 client HTTP API 路由（fail-soft）
    let apiResult: AttachResult = { registered: false };
    try { apiResult = registerApiRoutes() ?? apiResult; } catch (e) {
      try { logger.warn('[dag-flow] registerApiRoutes failed (non-fatal):', e); } catch {}
    }
    bindDispose(ctx, apiResult.dispose, 'dag-flow: api routes');

    // 3.6. 启动定时调度器（2026-10-03 用户拍板方案 v1，docs/SCHEDULE-PLAN.md §5）
    //   载体 = 宿主进程内 20s tick（所以 dsh web 必须常驻才会触发）；disposer 挂 ctx.effect
    //   （第三条 effect：工具 + 路由 + 调度器），插件热重载/卸载时定时器随之清掉。
    let schedResult: AttachResult = { registered: false };
    try { schedResult = startScheduler() ?? schedResult; } catch (e) {
      try { logger.warn('[dag-flow] startScheduler failed (non-fatal):', e); } catch {}
    }
    bindDispose(ctx, schedResult.dispose, 'dag-flow: scheduler');

    // 4. 提示已加载（带 reason，失败原因不再被吞掉）
    const driftMsg = drift.safeMode
      ? `safe mode active (drifted: ${drift.drifted.join(', ') || 'none'})`
      : 'apis all-ok';
    const status = (r: AttachResult) => (r.registered ? 'registered' : `skipped${r.reason ? ` (${r.reason})` : ''}`);
    try {
      logger.info(
        `[dag-flow] loaded (host v20261004-decorations), ${WorkflowNodeRegistry.list().length} nodes, workflow tool ${status(toolResult)}, api ${status(apiResult)}, scheduler ${status(schedResult)}, ${driftMsg}`
      );
    } catch {}
  } catch (e) {
    try { console.error('[dag-flow] apply failed (non-fatal):', e); } catch {}
  }
}

// —— 暴露给其他插件 & 测试（DSH cordis 插件接口已在上方 export const/function 声明）
export {
  WorkflowNodeRegistry,
  registerNode,
  runWorkflow,
  writeRunRecord,
  showWorkflow,
  listRuns,
  isSafeMode,
  getDriftReport,
};

export type { DshStorage, DshLogger };
