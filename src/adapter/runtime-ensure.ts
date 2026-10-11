// src/adapter/runtime-ensure.ts — 运行时「自带优先 → 读不到就自动下载 → 下完即用」的统一入口
//
// 用户要求（2026-10-11 原话）：「插件的 runtime 下的 python/bash/uv/ocr 组件，都要改造成先读 runtime 下的插件，
//   如果读到就使用 runtime 下的组件，如果读不到就自动下载组件，并且要保证组件之间的兼容性，
//   自动下载的组件要满足兼容性要求，必须下载就能使用」。
//
// 本文件负责三件事：
//   ① **解析顺序**（复用 runtime.ts）：自带 → 用户缓存（<DSH_HOME>/runtime）→ 系统 → missing；
//   ② **缺失即自动下载**：spawn 随包分发的 scripts/download-runtime.mjs（唯一的下载真源），按平台拉到用户缓存；
//   ③ **兼容性校验**：下完立刻验（Python 必须是 3.12.x —— OCR 的轮子是 cp312 编的；验不过就明确报错，不埋雷）。
//
// ★ 兼容性矩阵（改版本必须同时改这里 + scripts/download-runtime.mjs）：
//   python 3.12.14+20260901（cp312 / ABI 3.12）← OCR 引擎（onnxruntime / pypdfium2 / opencv）全是 cp312 轮子
//   uv     0.12.10                        ← 装 Python 包（--python 指向上面这个解释器）
//   bash   2.55.0.5（MinGit）             ← bash 节点
//   ocr    见 src/adapter/ocr.ts 的 OCR_ENGINE_PACKAGES（rapidocr 1.4.4 + onnxruntime 1.19.2 + pypdfium2 5.14.0）
//
// 逃生舱：DAGFLOW_RUNTIME_DOWNLOAD_SCRIPT（换下载脚本，测试用）、DAGFLOW_RUNTIME_BUNDLED_DIR（换自带根）、
//         DAGFLOW_RUNTIME_NO_DOWNLOAD=1（只解析、不下载，用于纯离线环境）、DAGFLOW_RUNTIME_MIRROR（下载镜像前缀，
//         透传给下载脚本；国内直连 GitHub 不通时用得上）

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detectPlatform, resolvePython, resolveBash, resolveUv, bundledRoots,
  PYTHON_VERSION, PYTHON_RELEASE, UV_VERSION, BASH_VERSION,
  __resetRuntimeCache, type Platform,
} from './runtime.js';

export type RuntimeTool = 'python' | 'bash' | 'uv';
export type RuntimeSource = 'bundled' | 'user-cache' | 'system' | 'missing';

/** 清掉解析记忆化缓存（下完运行时、或换掉自带根/PATH 之后要重新扫盘时调用） */
export { __resetRuntimeCache } from './runtime.js';

/** 兼容性矩阵（单一真源；改版本要连下载脚本一起改） */
export const RUNTIME_COMPAT = {
  python: { version: PYTHON_VERSION, release: PYTHON_RELEASE, abi: '3.12', why: 'OCR 引擎的轮子（onnxruntime / pypdfium2 / opencv）都是 cp312 编译的' },
  uv: { version: UV_VERSION, why: '用来把 OCR 引擎装进插件/用户运行区' },
  bash: { version: BASH_VERSION, why: 'bash 节点' },
  ocr: { requiresPython: '3.12', packages: ['rapidocr-onnxruntime', 'onnxruntime', 'opencv-python-headless', 'pypdfium2'] },
} as const;

export class RuntimeError2 extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'RuntimeError';
    this.code = code;
  }
}

export interface Resolved { exe: string; source: RuntimeSource }

function resolve(tool: RuntimeTool, platform: Platform): Resolved {
  if (tool === 'python') return resolvePython(platform);
  if (tool === 'bash') return resolveBash(platform);
  return resolveUv(platform);
}

/** 下载脚本路径（随包分发；可用 DAGFLOW_RUNTIME_DOWNLOAD_SCRIPT 覆盖） */
export function downloadScriptPath(): string {
  const override = (process.env.DAGFLOW_RUNTIME_DOWNLOAD_SCRIPT ?? '').trim();
  if (override) return override;
  const roots = bundledRoots();
  for (const r of roots) {
    const p = path.join(r, 'scripts', 'download-runtime.mjs');
    if (existsSync(p)) return p;
  }
  // esbuild bundle 形态：本文件在 <plugin>/dist/ 里，改用自身位置推
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const cand = path.resolve(here, '..', 'scripts', 'download-runtime.mjs');
    if (existsSync(cand)) return cand;
  } catch { /* 忽略 */ }
  return path.join(roots[0]!, 'scripts', 'download-runtime.mjs');
}

/** 取解释器/工具上报的版本号（python 用 sys.version_info；其它工具 --version） */
function probeVersion(tool: RuntimeTool, exe: string): string {
  try {
    if (tool === 'python') {
      const r = spawnSync(exe, ['-c', 'import sys;print("%d.%d.%d" % sys.version_info[:3])'], { encoding: 'utf8', timeout: 20000 });
      return r.status === 0 ? String(r.stdout ?? '').trim() : '';
    }
    const r = spawnSync(exe, ['--version'], { encoding: 'utf8', timeout: 20000 });
    return String((r.stdout || r.stderr) ?? '').trim();
  } catch { return ''; }
}

/** 纯函数：判断 Python 版本串是否满足 ABI 要求（便于离线单测，不用真起进程） */
export function checkPythonAbi(version: string): { ok: boolean; reason?: string } {
  const want = RUNTIME_COMPAT.python.abi;   // '3.12'
  if (!version) return { ok: false, reason: '版本号为空' };
  if (!version.startsWith(want + '.')) {
    return { ok: false, reason: `版本不兼容：需要 Python ${want}.x（${RUNTIME_COMPAT.python.why}），实际是 ${version}` };
  }
  return { ok: true };
}

/** 兼容性校验：Python 必须落在 ABI 要求的次版本线上（默认 3.12），否则直接拒绝使用 */
export function checkCompat(tool: RuntimeTool, exe: string): { ok: boolean; version: string; reason?: string } {
  if (!exe) return { ok: false, version: '', reason: '可执行文件路径为空' };
  if (tool === 'python') {
    const v = probeVersion('python', exe);
    if (!v) return { ok: false, version: '', reason: '无法执行这个 Python（可能是平台不匹配/文件损坏）' };
    const abi = checkPythonAbi(v);
    return abi.ok ? { ok: true, version: v } : { ok: false, version: v, reason: abi.reason };
  }
  const v = probeVersion(tool, exe);
  return { ok: true, version: v };
}

/**
 * 确保某个运行时可用：自带 → 用户缓存 → 系统 → **缺失或那份不兼容**就自动下载，下完再验一次兼容性。
 * ★ 2026-10-11 审计 C：以前只有"解析不到(缺失)"才下载；系统里若有一份**不兼容**的（典型：macOS 自带
 *   Python 3.13，而 OCR 的轮子是 cp312），会直接报 RUNTIME_VERSION_MISMATCH 而不是去补一份 3.12 —— 现在补上了。
 *   （插件自带那份若本身不兼容 = 包坏了，再下也没用，仍直接报错。）
 * 返回最终可用的可执行路径（下载过会带 downloaded=true）。
 */
export async function ensureTool(tool: RuntimeTool, opts: { platform?: Platform; log?: (m: string) => void; timeoutMs?: number } = {}): Promise<Resolved & { downloaded: boolean; version: string }> {
  const platform = opts.platform ?? detectPlatform();
  const log = opts.log ?? (() => {});
  const noDownload = process.env.DAGFLOW_RUNTIME_NO_DOWNLOAD === '1';
  let r = resolve(tool, platform);
  let compat = r.exe ? checkCompat(tool, r.exe) : { ok: false, version: '', reason: `找不到 ${tool}` };
  const needDownload = r.source === 'missing' || (!compat.ok && r.source !== 'bundled');

  if (needDownload) {
    if (noDownload) {
      if (r.source === 'missing') {
        throw new RuntimeError2('RUNTIME_MISSING', `找不到 ${tool}，且当前禁止自动下载（DAGFLOW_RUNTIME_NO_DOWNLOAD=1）`);
      }
      throw new RuntimeError2('RUNTIME_VERSION_MISMATCH', `${tool} 不可用：${compat.reason}（路径 ${r.exe}）——已禁止自动下载（DAGFLOW_RUNTIME_NO_DOWNLOAD=1），请手动装一份兼容的 ${tool}`);
    }
    const script = downloadScriptPath();
    if (!existsSync(script)) {
      throw new RuntimeError2('RUNTIME_DOWNLOAD_FAILED', `找不到下载脚本：${script}（插件安装可能不完整）`);
    }
    const why = r.source === 'missing' ? '自带与缓存都没有' : `现有那份不兼容（${compat.reason}）`;
    log(`[runtime] ${tool} ${why} → 自动下载（platform=${platform}）…`);
    const res = spawnSync(process.execPath, [script, `--platform=${platform}`, `--tools=${tool}`], {
      encoding: 'utf8', timeout: opts.timeoutMs ?? 900_000, cwd: path.dirname(script),
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    });
    const tail = String(res.stderr || res.stdout || '').trim().split('\n').slice(-4).join(' | ');
    if (res.status !== 0) {
      throw new RuntimeError2('RUNTIME_DOWNLOAD_FAILED', `${tool} 下载失败（退出码 ${res.status}）：${tail.slice(0, 400)}`);
    }
    // 成功也把"来自哪个源"播出来（多源候选时用户最想知道这个）
    for (const line of String(res.stdout || '').split('\n')) {
      if (/尝试|来自|already cached|索引|命中/.test(line)) log(`[runtime] ${line.trim()}`);
    }
    __resetRuntimeCache();
    const before = r.exe;
    r = resolve(tool, platform);
    if (r.source === 'missing') {
      throw new RuntimeError2('RUNTIME_DOWNLOAD_FAILED', `${tool} 下载脚本跑完了，但仍找不到可执行文件（检查网络/磁盘）；脚本输出：${tail.slice(0, 300)}`);
    }
    compat = checkCompat(tool, r.exe);
    // 下完却还是**同一份**不兼容的（典型：用户缓存里躺着一份错版本的旧目录，扫描顺序先命中它）
    if (!compat.ok && r.exe === before) {
      throw new RuntimeError2('RUNTIME_VERSION_MISMATCH', `${tool} 不可用：${compat.reason}（路径 ${r.exe}）——刚下的那份没能顶掉它（同名版本目录更靠前），把这个目录删掉后重试`);
    }
  }

  if (!compat.ok) {
    throw new RuntimeError2('RUNTIME_VERSION_MISMATCH', `${tool} 不可用：${compat.reason}（路径 ${r.exe}）`);
  }
  return { ...r, downloaded: r.source !== 'bundled', version: compat.version };
}

/** 运行时总览（给日志/面板看：谁自带、谁缓存、谁缺失） */
export function runtimeStatus(platform: Platform = detectPlatform()): { platform: Platform; tools: Record<string, string>; compat: string; bundledRoots: string[] } {
  const tools: Record<string, string> = {};
  for (const t of ['python', 'bash', 'uv'] as RuntimeTool[]) {
    const r = resolve(t, platform);
    tools[t] = r.exe ? `${r.source}` : 'missing';
  }
  return {
    platform,
    tools,
    compat: `python ${RUNTIME_COMPAT.python.version}（ABI ${RUNTIME_COMPAT.python.abi}）/ uv ${RUNTIME_COMPAT.uv.version} / bash ${RUNTIME_COMPAT.bash.version}`,
    bundledRoots: bundledRoots(),
  };
}
