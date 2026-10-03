// tmp-test/probe-logger.mjs — 验证日志时间戳为东八区格式（2026-10-02 用户需求）
// 用法：esbuild --format=esm 打包后 node 执行；日志落在 <cwd>/.dag-flow/logs/
import { createLogger } from '../src/adapter/logger.js';

const logger = createLogger();
logger.info('时间戳格式验证（应为东八区 YYYY-MM-DD HH:mm:ss.SSS）');
await new Promise((r) => setTimeout(r, 300)); // appendToLogFile 是 fire-and-forget，等它落盘
console.log('probe done');
