// src/adapter/routes/helpers.ts — 路由模块共用的收发底座与依赖注入类型
// sendJson / readJsonBody 是所有路由的收发小工具；ApiRouteDeps 由 api.ts 装配一次、
// 传给各域路由模块（routes/run|workflows|schedules|ai|meta.ts）——模块内不各自建 storage/logger。
// 2026-10-14 重构轮 2 自 api.ts 纯搬运拆出。

import { createLogger } from '../logger.js';
import type { DshStorage } from '../storage.js';

export type RouteSpec = { kind?: 'exact' | 'prefix'; path: string; handler: (req: any, res: any) => unknown };
export type RouteRegisterer = (spec: RouteSpec) => void;

/** 各域路由模块的依赖包（api.ts 装配） */
export interface ApiRouteDeps {
  route: RouteRegisterer;
  sendJson: typeof sendJson;
  readJsonBody: typeof readJsonBody;
  storage: DshStorage;
  logger: ReturnType<typeof createLogger>;
}

export function sendJson(res: any, status: number, body: unknown): void {
  try {
    res.statusCode = status;
    res.setHeader?.('content-type', 'application/json');
    res.end?.(JSON.stringify(body));
  } catch (e) {
    try { res.end?.(JSON.stringify({ error: String((e as Error).message) })); } catch { /* */ }
  }
}

export function readJsonBody(req: any): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on?.('data', (c: Buffer) => { buf += c.toString(); });
    req.on?.('end', () => {
      try { resolve(buf ? JSON.parse(buf) : {}); } catch (e) { reject(e); }
    });
    req.on?.('error', reject);
  });
}
