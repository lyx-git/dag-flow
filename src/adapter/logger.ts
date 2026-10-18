// src/adapter/logger.ts — 日志桥接
// ★ 唯一允许调 DSH logger 的地方
//
// 2026-09-06 修订：真实 ctx 直接有 logger（ctx.logger.info/warn/error）。
// ★ 2026-10-21 用户拍板（重启后仍报「tmp 还是会自动创建 logs」）⇒ **不再落文件日志**：
//   日志只走宿主 logger + console，「.dag-flow/tmp/logs/」这个目录从此不会由插件创建。
//   （历史：2026-09-26 曾写 .dag-flow/logs/，2026-10-18 挪到 tmp/logs/ 并按 20 份滚动，现整体取消。）

import { hostService } from './safety.js';

export interface DshLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

function consoleOut(level: 'info' | 'warn' | 'error', msg: string, meta?: Record<string, unknown>): void {
  const tag = `[dag-flow]`;
  const line = meta && Object.keys(meta).length ? `${msg} ${JSON.stringify(meta)}` : msg;
  // eslint-disable-next-line no-console
  console[level](`${tag} ${line}`);
}


export function createLogger(): DshLogger {
  // logger 是 cordis ctx 的自有属性（context.ts L27-28: this.logger = new LoggerService(self)），
  // 裸访问本来就不抛；但统一走 hostService 以免将来它改成服务后踩 inject 坑。
  const hostLogger = hostService('logger') as
    | { info?: Function; warn?: Function; error?: Function }
    | null
    | undefined;

  const emit = (
    level: 'info' | 'warn' | 'error',
    hostFn: Function | undefined,
    msg: string,
    meta?: Record<string, unknown>,
  ): void => {
    const line = meta && Object.keys(meta).length ? `${msg} ${JSON.stringify(meta)}` : msg;
    if (!hostFn) {
      consoleOut(level, msg, meta);
      return;
    }
    try {
      hostFn.call(hostLogger, msg, meta);
    } catch (e) {
      // 升版时 logger 抛错，降级到 console
      consoleOut(level, `${msg} (logger call failed: ${(e as Error).message})`, meta);
    }
  };

  return {
    info(msg, meta) { emit('info', hostLogger?.info, msg, meta); },
    warn(msg, meta) { emit('warn', hostLogger?.warn, msg, meta); },
    error(msg, meta) { emit('error', hostLogger?.error, msg, meta); },
  };
}
