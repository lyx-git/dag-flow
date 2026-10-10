// src/adapter/logger.ts — 日志桥接
// ★ 唯一允许调 DSH logger 的地方
//
// 2026-09-06 修订：真实 ctx 直接有 logger（ctx.logger.info/warn/error）。
// 2026-09-26 新增：同时落文件到 <DSH_HOME>/.dag-flow/logs/dag-flow-YYYY-MM-DD.log
//   （fire-and-forget 追加写，失败静默——文件日志是增强，绝不能影响主流程）。

import { appendFile } from 'node:fs/promises';
import * as path from 'node:path';
import { hostService } from './safety.js';
import { dagFlowLogsDir } from './workspace.js';

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

function todayLogPath(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `dag-flow-${y}-${m}-${day}.log`;
}

/** 东八区（UTC+8）可读时间戳：2026-10-02 07:07:45.247（不依赖机器时区，显式 +8h 换算）。
 *  2026-10-02 用户要求：日志时间从 UTC ISO（…T…Z）改为东八区格式 */
function cstStamp(d = new Date()): string {
  const t = new Date(d.getTime() + 8 * 3600 * 1000);
  return t.toISOString().replace('T', ' ').replace('Z', '');
}

/** 追加一行到当天日志文件（fire-and-forget：目录/磁盘失败静默，绝不阻塞主流程） */
function appendToLogFile(level: string, line: string): void {
  const stamp = cstStamp();
  const text = `${stamp} [${level.toUpperCase()}] ${line}\n`;
  void dagFlowLogsDir()
    .then((dir) => appendFile(path.join(dir, todayLogPath()), text, 'utf8'))
    .catch(() => { /* 文件日志失败静默（工作区不可写等场景） */ });
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
    appendToLogFile(level, line);
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
