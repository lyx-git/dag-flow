// src/adapter/assets.ts — 工作流产出文件落盘（图片/视频/文件）
// 产物目录：**<DSH_HOME>/.dag-flow/ 根下**（2026-09-26 用户指令：最终结果直接放 .dag-flow/，
//           不建专门产物子目录；filename 自带的相对子路径照落，如 .dag-flow/reports/周报.md）
// 临时中转：下载类产物先写 <DSH_HOME>/.dag-flow/tmp/*.part，完成后 rename 到最终位置
//          （大文件不占内存；中断残留只留在 tmp，不会污染最终目录）
// 安全：filename 解析后必须仍在 .dag-flow/ 内（防路径穿越 ../）

import { promises as fs } from 'node:fs';
import { createWriteStream, existsSync } from 'node:fs';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { storageBaseDir, dagFlowDir, dagFlowTmpDir } from './workspace.js';

export interface SavedAsset {
  /** 相对 <DSH_HOME> 的路径（含 .dag-flow/ 前缀，如 .dag-flow/reports/周报.md；2026-10-11 起基准不再是工作区） */
  relativePath: string;
  /** 宿主机绝对路径 */
  absolutePath: string;
  bytes: number;
}

/** 产物输出目录：<DSH_HOME>/.dag-flow（最终结果直接放这里，不建专门子目录） */
export async function outputDir(): Promise<string> {
  return dagFlowDir();
}

/** 规范化文件名：防路径穿越；允许子目录（字母数字/连字符/下划线/中文） */
function safeOutputPath(dir: string, filename: string): string {
  const base = path.basename(filename).replace(/[^\w.\-\u4e00-\u9fa5]+/g, '-').replace(/^[-.]+/, '') || `output-${Date.now()}`;
  // 子目录：取 filename 的目录部分（白名单字符，禁止 ..）
  const dirPartRaw = path.dirname(filename).replace(/\\/g, '/');
  let sub = '';
  if (dirPartRaw && dirPartRaw !== '.' && dirPartRaw !== '/') {
    const cleaned = dirPartRaw.replace(/[^\w\-\u4e00-\u9fa5/]+/g, '-').replace(/^\/+|\/+$/g, '');
    if (cleaned && !cleaned.includes('..')) sub = cleaned;
  }
  const full = sub ? path.join(dir, sub, base) : path.join(dir, base);
  const resolved = path.resolve(full);
  if (!resolved.startsWith(path.resolve(dir))) {
    throw new Error(`文件名非法（路径越界）: ${filename}`);
  }
  return resolved;
}

/**
 * ★ 同名冲突策略（2026-10-03 用户拍板**方案 A：默认自动改名不覆盖**）：
 *   目标文件已存在时改成 `报告.md` → `报告-2.md` → `报告-3.md` …（保留历史，绝不静默覆盖）。
 *   为什么选 A：DAG 工作流里"文件已存在"不该让节点失败，也不该悄悄吃掉上一份产出；
 *   返回的还是**实际写入的路径**（out.path/absolutePath），下游/邮件拿到的是真实文件名。
 *   ★ 行为变更声明：此前是静默覆盖，从本版起同名即改名（同一天跑两次日报会得到 -2.md）。
 *   并发同名的极限竞态（两个节点同时探测到同一空位）各自写入不报错，最多其中一个被后写覆盖——
 *   单机工作流场景可接受，不为此加锁。
 */
function uniqueOutputPath(file: string): string {
  if (!existsSync(file)) return file;
  const dir = path.dirname(file);
  const ext = path.extname(file);
  const stem = path.basename(file, ext);
  for (let i = 2; i < 1000; i++) {
    const cand = path.join(dir, `${stem}-${i}${ext}`);
    if (!existsSync(cand)) return cand;
  }
  return path.join(dir, `${stem}-${Date.now()}${ext}`);   // 极端情况兜底（同名 1000 份）
}

/** 保存文本/binary 内容为产出文件（直接写 .dag-flow 目标位置；同名自动改名，见 uniqueOutputPath） */
export async function saveAsset(
  filename: string,
  content: string | Uint8Array,
  encoding?: 'utf8' | 'base64',
): Promise<SavedAsset> {
  const dir = await outputDir();
  const file = uniqueOutputPath(safeOutputPath(dir, filename));
  await fs.mkdir(path.dirname(file), { recursive: true });
  const buf = typeof content === 'string'
    ? (encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8'))
    : Buffer.from(content);
  await fs.writeFile(file, buf);
  const root = await storageBaseDir();
  return {
    relativePath: path.relative(root, file).replace(/\\/g, '/'),
    absolutePath: file,
    bytes: buf.length,
  };
}

/**
 * 下载 URL 为产出文件（视频/图片生成 API 常返回 CDN 链接）。
 * 流式写 <DSH_HOME>/.dag-flow/tmp/download-<随机>.part → 完成后 rename 到最终位置：
 * 大文件不占内存；下载中断时残留只在 tmp，不会在最终目录留半成品。
 */
export async function downloadAsset(url: string, filename: string, timeoutMs = 300_000): Promise<SavedAsset> {
  const dir = await outputDir();
  const file = uniqueOutputPath(safeOutputPath(dir, filename));   // ★ 同名自动改名（方案 A）
  await fs.mkdir(path.dirname(file), { recursive: true });
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  let tmpFile: string | null = null;
  try {
    const resp = await fetch(url, { signal: ac.signal });
    if (!resp.ok) throw new Error(`下载失败（HTTP ${resp.status}）: ${url.slice(0, 120)}`);
    if (!resp.body) throw new Error(`下载失败：响应无内容: ${url.slice(0, 120)}`);
    const tmpDir = await dagFlowTmpDir();
    tmpFile = path.join(tmpDir, `download-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.part`);
    await pipeline(Readable.fromWeb(resp.body as never), createWriteStream(tmpFile));
    await fs.rename(tmpFile, file);
    tmpFile = null;
    const stat = await fs.stat(file);
    const root = await storageBaseDir();
    return {
      relativePath: path.relative(root, file).replace(/\\/g, '/'),
      absolutePath: file,
      bytes: stat.size,
    };
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error(`下载超时（${timeoutMs}ms）: ${url.slice(0, 120)}`);
    throw e;
  } finally {
    clearTimeout(t);
    if (tmpFile) { await fs.rm(tmpFile, { force: true }).catch(() => { /* 清理失败忽略 */ }); }
  }
}
