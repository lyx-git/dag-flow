// src/adapter/runtime.ts — 运行时路径解析 + 平台检测
// R3 核心：装上插件就能用，不要求用户装 Python/Bash
//
// 策略（用户决策 V1+V2+V3）：
// - Windows: 打包 Python 3.12 (PBS install_only_stripped) + MinGit-busybox bash + uv
// - Mac/Linux: 不打包，~/.dsh/runtime/ 全局缓存首次启动按需下载
// - 都降级到系统 python3/bash
//
// 文件位置规则：
//   bundled  : <plugin-dir>/runtime/<tool>/<version>/<platform>/<binary>
//   user-cached: ~/.dsh/runtime/<tool>/<version>/<platform>/<binary>  (按需下载)
//   system   : PATH 上的 python3 / bash

import { existsSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dshHome } from './dsh-home.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// plugin 根目录（runtime/ 与 src/ 同级）
// ★ 双形态兼容（2026-09-26 修复：esbuild 单文件 bundle 里 __dirname=<plugin>/dist，
//   旧算法按 tsc 形态 ../.. 计算会指到 plugin 的上一级 → bundled 运行时永远找不到）：
//   - tsc 多文件形态：__dirname = <plugin>/dist/adapter → ../.. 是 root
//   - esbuild bundle 形态：__dirname = <plugin>/dist      → ..    是 root
// bundledPath 逐候选探测存在性，不依赖固定层级。
const PLUGIN_ROOT_CANDIDATES: string[] = ['..', '../..'].map((rel) => path.resolve(__dirname, rel));

const USER_RUNTIME_DIR = path.join(dshHome(), 'runtime');  // 09-27 意见 2：DSH_HOME 统一走 dshHome()

// ---------- 平台检测 ----------
export type Platform = 'win-x64' | 'mac-x64' | 'mac-arm64' | 'linux-x64' | 'linux-arm64' | 'linux-musl-x64' | 'unknown';

export function detectPlatform(): Platform {
  const p = process.platform;
  const a = process.arch;
  if (p === 'win32' && a === 'x64') return 'win-x64';
  if (p === 'darwin' && a === 'x64') return 'mac-x64';
  if (p === 'darwin' && a === 'arm64') return 'mac-arm64';
  if (p === 'linux' && a === 'x64') {
    // 探测 musl（Alpine 等）；注意：ESM 产物中无 require，用顶部 import 的 existsSync
    try {
      if (existsSync('/etc/alpine-release')) return 'linux-musl-x64';
    } catch { /* */ }
    return 'linux-x64';
  }
  if (p === 'linux' && a === 'arm64') return 'linux-arm64';
  return 'unknown';
}

// ---------- 工具/版本常量（与 runtime-architecture.md 对齐） ----------
// 2026-09-26：与 scripts/download-runtime.mjs 保持同步；python 3.12.12 上游已撤下换 3.12.14，
// uv 0.4.18 → 0.12.10（实际解压验证 uv 0.12.10）。bundled 目录名必须与这里的常量一致。
export const PYTHON_VERSION = '3.12.14';
export const PYTHON_RELEASE = '20260901';
export const BASH_VERSION = '2.55.0.5';
export const UV_VERSION = '0.12.10';

const PY_EXE_BY_PLATFORM: Record<Platform, string> = {
  'win-x64': 'python.exe',
  'mac-x64': 'bin/python3.12',
  'mac-arm64': 'bin/python3.12',
  'linux-x64': 'bin/python3.12',
  'linux-arm64': 'bin/python3.12',
  'linux-musl-x64': 'bin/python3.12',
  'unknown': '',
};

const BASH_EXE_BY_PLATFORM: Record<Platform, string> = {
  // MinGit 2.55.0.5 完整版解压布局：usr/bin/sh.exe（不是 mingit64/usr/bin/bash.exe）
  'win-x64': 'usr/bin/sh.exe',
  'mac-x64': '',                          // 用系统
  'mac-arm64': '',
  'linux-x64': '',
  'linux-arm64': '',
  'linux-musl-x64': '',
  'unknown': '',
};

// win-x64 候选 shell 路径（兼容不同 MinGit 版本布局）
const BASH_CANDIDATES_WIN: string[] = [
  'usr/bin/sh.exe',
  'usr/bin/bash.exe',
  'mingit64/usr/bin/bash.exe',
  'mingit64/usr/bin/sh.exe',
];

const UV_EXE_BY_PLATFORM: Record<Platform, string> = {
  'win-x64': 'uv.exe',
  'mac-x64': 'uv',
  'mac-arm64': 'uv',
  'linux-x64': 'uv',
  'linux-arm64': 'uv',
  'linux-musl-x64': 'uv',
  'unknown': '',
};

// ---------- 路径解析 ----------
export interface RuntimePaths {
  platform: Platform;
  pythonExe: string;        // 解析到的可执行文件绝对路径
  pythonSource: 'bundled' | 'user-cache' | 'system' | 'missing';
  bashExe: string;
  bashSource: 'bundled' | 'user-cache' | 'system' | 'missing';
  uvExe: string;
  uvSource: 'bundled' | 'user-cache' | 'system' | 'missing';
}

function bundledPath(tool: string, version: string, platform: Platform, sub: string): string {
  // 逐候选探测（tsc 形态 / esbuild 形态），返回第一个真实存在的路径；
  // 全不存在时返回首选候选（调用方 existsSync 判定后走 user-cache/system 兜底）
  for (const root of PLUGIN_ROOT_CANDIDATES) {
    const p = path.join(root, 'runtime', tool, version, platform, sub);
    if (existsSync(p)) return p;
  }
  return path.join(PLUGIN_ROOT_CANDIDATES[0], 'runtime', tool, version, platform, sub);
}

function userCachePath(tool: string, version: string, platform: Platform, sub: string): string {
  return path.join(USER_RUNTIME_DIR, tool, version, platform, sub);
}

/** 在 PATH 上找可执行文件；返回绝对路径或 null */
function which(bin: string): string | null {
  const PATH = (process.env.PATH ?? '').split(path.delimiter);
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.EXE;.BAT;.CMD').split(';')
    : [''];
  for (const p of PATH) {
    for (const ext of exts) {
      const full = path.join(p, bin + ext);
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        if (existsSync(full)) return full;
      } catch { /* */ }
    }
  }
  return null;
}

/**
 * 扫描 user-cache 里已下载的 <tool>/<version>/<platform>/<exe>，
 * 返回第一个存在的 exe 绝对路径；无则 null。
 * 用于兼容"下载脚本动态发现版本"（如 python 3.10.21+20260901）——
 * 不依赖硬编码的 PYTHON_VERSION。
 */
function findCachedExe(tool: string, platform: Platform, sub: string): string | null {
  const toolRoot = path.join(USER_RUNTIME_DIR, tool);
  try {
    const versions = readdirSync(toolRoot);
    for (const v of versions) {
      const p = path.join(toolRoot, v, platform, sub);
      if (existsSync(p)) return p;
    }
  } catch { /* no cache */ }
  return null;
}

/** 解析 Python 路径：bundled → user-cache（动态版本）→ system */
export function resolvePython(platform: Platform = detectPlatform()): { exe: string; source: RuntimePaths['pythonSource'] } {
  const sub = PY_EXE_BY_PLATFORM[platform];
  if (sub) {
    const bundled = bundledPath('python', `${PYTHON_VERSION}+${PYTHON_RELEASE}`, platform, sub);
    if (existsSync(bundled)) return { exe: bundled, source: 'bundled' };
    const cached = findCachedExe('python', platform, sub);
    if (cached) return { exe: cached, source: 'user-cache' };
  }
  // 系统 python 探测
  for (const bin of ['python3.12', 'python3', 'python', 'py']) {
    const sys = which(bin);
    if (sys) return { exe: sys, source: 'system' };
  }
  return { exe: '', source: 'missing' };
}

export function resolveBash(platform: Platform = detectPlatform()): { exe: string; source: RuntimePaths['bashSource'] } {
  // win-x64：多候选布局（MinGit 2.55 完整版是 usr/bin/sh.exe；旧版是 mingit64/usr/bin/bash.exe）
  if (platform === 'win-x64') {
    for (const cand of BASH_CANDIDATES_WIN) {
      const bundled = bundledPath('bash', BASH_VERSION, platform, cand);
      if (existsSync(bundled)) return { exe: bundled, source: 'bundled' };
      const cached = findCachedExe('bash', platform, cand);
      if (cached) return { exe: cached, source: 'user-cache' };
    }
  } else {
    const sub = BASH_EXE_BY_PLATFORM[platform];
    if (sub) {
      const bundled = bundledPath('bash', BASH_VERSION, platform, sub);
      if (existsSync(bundled)) return { exe: bundled, source: 'bundled' };
      const cached = findCachedExe('bash', platform, sub);
      if (cached) return { exe: cached, source: 'user-cache' };
    }
  }
  // 系统 bash（macOS/Linux 都有；Windows 无）
  for (const bin of ['bash']) {
    const sys = which(bin);
    if (sys) return { exe: sys, source: 'system' };
  }
  return { exe: '', source: 'missing' };
}

export function resolveUv(platform: Platform = detectPlatform()): { exe: string; source: RuntimePaths['uvSource'] } {
  const sub = UV_EXE_BY_PLATFORM[platform];
  if (sub) {
    const bundled = bundledPath('uv', UV_VERSION, platform, sub);
    if (existsSync(bundled)) return { exe: bundled, source: 'bundled' };
    const cached = findCachedExe('uv', platform, sub);
    if (cached) return { exe: cached, source: 'user-cache' };
  }
  for (const bin of ['uv']) {
    const sys = which(bin);
    if (sys) return { exe: sys, source: 'system' };
  }
  return { exe: '', source: 'missing' };
}

export function resolveAll(): RuntimePaths {
  const platform = detectPlatform();
  const p = resolvePython(platform);
  const b = resolveBash(platform);
  const u = resolveUv(platform);
  return {
    platform,
    pythonExe: p.exe,
    pythonSource: p.source,
    bashExe: b.exe,
    bashSource: b.source,
    uvExe: u.exe,
    uvSource: u.source,
  };
}

/** 检查 Python 解释器是否包含某个模块（用于决定是否需要 uv pip install） */
export function hasPythonModule(pythonExe: string, moduleName: string): boolean {
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
  const r = spawnSync(pythonExe, ['-c', `import ${moduleName}`], { stdio: 'ignore' });
  return r.status === 0;
}

/** 触发首次启动按需下载（stub — 实际逻辑在 scripts/download-runtime.mjs） */
export async function ensureUserCache(platform: Platform = detectPlatform()): Promise<{ python: boolean; bash: boolean; uv: boolean }> {
  // 真实实现：spawn `node scripts/download-runtime.mjs --platform=${platform}`
  // 这里返回"是否已存在"，触发逻辑在调用方
  const _py = resolvePython(platform);
  const _ba = resolveBash(platform);
  const _uv = resolveUv(platform);
  return {
    python: _py.source !== 'missing',
    bash: _ba.source !== 'missing',
    uv: _uv.source !== 'missing',
  };
}
