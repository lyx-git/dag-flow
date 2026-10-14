// src/adapter/api.ts — client 侧 HTTP API（dsh webServer 路由）
//
// dsh 0.1.2-rc.1 的 webServer.register 形态（dsh-image-vision 同款）：
//   ctx.webServer.register({ kind: 'exact', path, handler: async (req, res) => {...} })
//
// 本文件 2026-10-14 重构轮 2 拆分后**只做装配**：防腐层注册器 + 依赖包（ApiRouteDeps）+ 五个域模块注册。
// 路由实现按域放在 ./routes/ 下（模块内注释保留原始编号）：
//   routes/meta.ts        GET /nodes、GET /models、POST /test-image-api、GET·GET /sessions、GET /sessions/<id>（prefix）
//   routes/ai.ts          POST /ai-generate（AI 生成工作流 JSON，支持 SSE 流式）
//   routes/run.ts         GET /runs、POST·DELETE /run、GET /run/status、POST /run/resume、POST /open-folder、
//                         POST /selfcheck、GET /run/log、POST /run-node
//   routes/workflows.ts   GET /workflows、GET·DELETE /workflows/<name>（prefix，含 versions/<ts>）、POST /workflows/save
//   routes/schedules.ts   GET /schedules、POST /schedules/save·delete·run
//   routes/helpers.ts     sendJson / readJsonBody / ApiRouteDeps（收发底座与依赖类型）
// ★ 各域模块的注册顺序与拆分前的路由排列顺序略有不同——每条路由 path 互不相同、按 (kind,path) 匹配，
//   注册顺序不影响行为（api-e2e 全量断言锁着）。
import { disabledApis } from './safety.js';
import { createHostRouteRegistrar } from '../dsh-gate/registrar.js';
import { createStorage } from './storage.js';
import { createLogger } from './logger.js';
import { sendJson, readJsonBody, type ApiRouteDeps } from './routes/helpers.js';
import { registerMetaRoutes } from './routes/meta.js';
import { registerAiRoutes } from './routes/ai.js';
import { registerRunRoutes } from './routes/run.js';
import { registerWorkflowRoutes } from './routes/workflows.js';
import { registerScheduleRoutes } from './routes/schedules.js';

export function registerApiRoutes(): { registered: boolean; reason?: string; dispose?: () => void } {
  // 只按本能力自己的漂移判断（2026-10-01）：不再叠加 isSafeMode()——那会让 tools 的
  // 漂移连累路由注册，且未初始化时默认 true 会静默跳过全部路由（404 成因之一）。
  if (disabledApis().includes('webServer.register')) {
    return { registered: false, reason: 'webServer.register 不可用' };
  }
  // webServer 注册契约适配已收编防腐层（dsh-gate/registrar.ts）——dsh 升版改注册契约时只改那边。
  // 防腐层同时管理 disposer 列表：dsh webServer.register 返回 disposer，且重复注册同一
  // (kind,path) 会抛 webserver: duplicate ... route；profile 是 patchReload:"live"，
  // 插件热重载必须先注销旧路由（index.ts 把 dispose 挂到 ctx.effect）。
  const logger = createLogger();
  const reg = createHostRouteRegistrar(logger);
  if ('error' in reg) {
    return { registered: false, reason: reg.error };
  }
  const storage = createStorage();
  const dispose = (): void => reg.dispose();
  const route = (spec: { kind?: 'exact' | 'prefix'; path: string; handler: (req: any, res: any) => unknown }): void =>
    reg.register(spec);

  try {
    const deps: ApiRouteDeps = { route, sendJson, readJsonBody, storage, logger };
    registerMetaRoutes(deps);
    registerAiRoutes(deps);
    registerRunRoutes(deps);
    registerWorkflowRoutes(deps);
    registerScheduleRoutes(deps);

    logger.info(`[dag-flow] API routes registered: ${reg.count()} 条`);
    return { registered: true, dispose };
  } catch (e) {
    dispose(); // 半途失败：已注册的也要撤掉，避免留下残路由
    return { registered: false, reason: (e as Error).message };
  }
}
