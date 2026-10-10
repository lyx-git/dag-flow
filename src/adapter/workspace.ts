// src/adapter/workspace.ts — dag-flow 数据目录统一解析
// ★ 布局（2026-10-11 用户拍板：**dag-flow 创建的文件不依赖 DSH 工作区**，根固定 <DSH_HOME>/.dag-flow/）：
//   <DSH_HOME>/.dag-flow/workflow/    工作流定义（storage.ts 管）
//   <DSH_HOME>/.dag-flow/runs/        运行记录（storage.ts 管）
//   <DSH_HOME>/.dag-flow/tmp/         执行临时文件（下载中间产物等，可随时清空）
//   <DSH_HOME>/.dag-flow/logs/        运行日志（logger.ts 按天写 dag-flow-YYYY-MM-DD.log）
//   <DSH_HOME>/.dag-flow/scripts/     python/bash codePath 相对路径的锚定根
//   <DSH_HOME>/.dag-flow/             最终产出（file_save/image/video 的结果文件直接放这里，不建专门子目录）
// （工作区时代的 <工作区>/.dag-flow/ 由 storage.ts 一次性**补缺复制**到新根，旧目录原样保留不删。）

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { resolveStorageRoot } from './storage.js';

let cachedRoot: string | null = null;

/** 相对路径的基准目录（= <DSH_HOME>，即 .dag-flow 的上一级）—— 只用于产出文件回报「相对路径」。
 *  storage.dir = <DSH_HOME>/.dag-flow/workflow → 上两级 = <DSH_HOME>。结果缓存。 */
export async function storageBaseDir(): Promise<string> {
  if (cachedRoot) return cachedRoot;
  const info = await resolveStorageRoot();
  cachedRoot = path.dirname(path.dirname(info.dir));
  return cachedRoot;
}

/** .dag-flow 根目录（最终产出直接放这里） */
export async function dagFlowDir(): Promise<string> {
  const info = await resolveStorageRoot();
  return path.dirname(info.dir);
}

let ensured: Promise<void> | null = null;

/** 确保 .dag-flow/tmp、.dag-flow/logs 与 .dag-flow/scripts 目录存在（进程内只创建一次） */
export async function ensureDagFlowDirs(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      const root = await dagFlowDir();
      await fs.mkdir(path.join(root, 'tmp'), { recursive: true });
      await fs.mkdir(path.join(root, 'logs'), { recursive: true });
      // scripts/：代码文件目录（python/bash 节点 codePath 相对路径的锚定根；2026-10-02 用户需求：
      // 「有个地方写格式化的代码，然后引入执行」——在 .dag-flow/scripts/ 写 .py/.sh，节点填文件名引用）
      await fs.mkdir(path.join(root, 'scripts'), { recursive: true });
    })().catch(() => { /* 目录创建失败时调用方各自降级（如 logger 只走 console） */ });
  }
  return ensured;
}

/** 代码文件目录：<DSH_HOME>/.dag-flow/scripts（python/bash codePath 相对路径锚定根） */
export async function dagFlowScriptsDir(): Promise<string> {
  await ensureDagFlowDirs();
  return path.join(await dagFlowDir(), 'scripts');
}

/** 临时文件目录：<DSH_HOME>/.dag-flow/tmp */
export async function dagFlowTmpDir(): Promise<string> {
  await ensureDagFlowDirs();
  return path.join(await dagFlowDir(), 'tmp');
}

/** 日志目录：<DSH_HOME>/.dag-flow/logs */
export async function dagFlowLogsDir(): Promise<string> {
  await ensureDagFlowDirs();
  return path.join(await dagFlowDir(), 'logs');
}
