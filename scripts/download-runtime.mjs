// scripts/download-runtime.mjs — 按需下载 Python / bash / uv 运行时
// 跑法：node scripts/download-runtime.mjs [--platform=PLAT] [--tools=python,bash,uv] [--mirror=URL前缀]
//
// 用户决策 V1：只打包 Windows；其他平台首次启动按需下载
// 用户决策 V2：Python 3.12
// 用户决策 V3：打包 uv
//
// 2026-09-06 修复：
//  - MinGit 仓库是 git-for-windows/git（不是 git-for-windows/MinGit），
//    release tag 是 v2.55.0.windows.5（不是 v2.55.0.5）
//  - python 版本动态发现：查 GitHub API 最新 release，避免硬编码版本 404
//  - uv 解压失败：download() 后确保文件流 close 再解压
//
// ★★ 2026-10-11（用户要求：「如果读不到就自动下载组件…必须下载就能使用」）——**多源候选**：
//   本机实测：**github.com 根本连不上**（TCP 都握不上手、连首字节都没有；api.github.com 却可达），
//   而 npmmirror 的二进制镜像 ~5MB/s、PyPI 也在。所以只留"GitHub 直连"这一条源等于**自动下载永远失败**。
//   现在每个工具都有一串候选源，逐个试、第一个成功的胜出：
//     ① 自定义镜像（--mirror= 或 DAGFLOW_RUNTIME_MIRROR；前缀式，套在 GitHub 原 URL 上）
//     ② npmmirror 国内二进制镜像（python-build-standalone / git-for-windows 都有）
//     ③ uv 专有：PyPI 的 uv wheel（npmmirror 没有 uv 二进制；wheel 里就是 uv.exe，实测 17MB 秒下）
//     ④ GitHub 直连（最后的兜底；直连得通的环境第一下就成，不受影响）
//   每源用**短超时**（25s 无数据就换源），免得被一个死源按 60s×重试卡好几分钟。
//   同轮修掉一个真 bug：MinGit 完整版 zip 解出来是**根级** usr/（cmd/ etc/ mingw64/ usr/），
//   旧标记 `mingit64/usr/bin/bash.exe` 根本不存在 → 下载成功了也会判"没找到"然后把整个目录删掉。

import { existsSync, mkdirSync, createWriteStream, rmSync, copyFileSync, readdirSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import https from 'node:https';

// DSH 主目录：与 src/adapter/dsh-home.ts 保持同步（独立脚本无法 import TS，双处维护）
// 09-27 意见 2：补上 DSH_HOME 环境变量支持（此前仅 src 侧 sessions.ts 尊重）
const DSH_HOME_DIR = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const USER_RUNTIME_DIR = path.join(DSH_HOME_DIR, 'runtime');
// Python 3.12 首选版本（真实 release 由 resolvePythonUrlFor 动态发现；此常量作 fallback）
// 2026-09-26：3.12.12 上游已撤下换 3.12.14；uv 0.4.18 → 0.12.10。与 src/adapter/runtime.ts 常量保持同步。
const PYTHON_VERSION = '3.12.14';
const PYTHON_RELEASE = '20260901';
const BASH_VERSION = '2.55.0.windows.5'; // MinGit release tag（仓库 git-for-windows/git）
const UV_VERSION = '0.12.10';
const MINIGIT_ASSET = 'MinGit-2.55.0.5-64-bit.zip';

// 单源无数据超时（换源比死等更划算）
const SOURCE_TIMEOUT_MS = Number(process.env.DAGFLOW_RUNTIME_SOURCE_TIMEOUT_MS || 25000);
const SOURCE_RETRIES = Number(process.env.DAGFLOW_RUNTIME_SOURCE_RETRIES || 2);

// npmmirror 二进制镜像（国内首选；实测 ~5MB/s）
const NPMMIRROR_BINARY = 'https://registry.npmmirror.com/-/binary';
// PyPI 简单索引（uv wheel 的来源；按序试）
const PYPI_INDEXES = [
  process.env.DAGFLOW_PYPI_INDEX || '',
  'https://pypi.org/simple/',
  'https://pypi.tuna.tsinghua.edu.cn/simple/',
  'https://mirrors.aliyun.com/pypi/simple/',
].filter(Boolean);

// ---------- 平台 ----------
// pythonSuffix = 平台对应的 cpython 资产后缀（供动态发现 + fallback URL 组装）
const PLATFORM_TARGETS = {
  'win-x64': {
    python: {
      url: null, // 由 resolvePythonUrlFor 填充
      pythonSuffix: '-x86_64-pc-windows-msvc-install_only_stripped.tar.gz',
      format: 'tar.gz',
      pyExe: 'python.exe',
    },
    bash: {
      url: `https://github.com/git-for-windows/git/releases/download/v${BASH_VERSION}/${MINIGIT_ASSET}`,
      format: 'zip',
      // ★ MinGit 完整版 zip 解出来是根级 usr/bin/sh.exe（实测 2.55.0.5：cmd/ etc/ mingw64/ usr/）
      bashExe: 'usr/bin/sh.exe',
    },
    uv: {
      url: `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-pc-windows-msvc.zip`,
      uvMarker: 'x86_64-pc-windows-msvc',
      uvExt: 'zip',
      format: 'zip',
      uvExe: 'uv.exe',
    },
  },
  'mac-arm64': {
    python: {
      url: null,
      pythonSuffix: '-aarch64-apple-darwin-install_only_stripped.tar.gz',
      format: 'tar.gz',
      pyExe: 'bin/python3.12',
    },
    bash: { url: null, format: 'system' },        // macOS 自带
    uv: {
      url: `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-aarch64-apple-darwin.tar.gz`,
      uvMarker: 'aarch64-apple-darwin',
      uvExt: 'tar.gz',
      format: 'tar.gz',
      uvExe: 'uv',
    },
  },
  'mac-x64': {
    python: {
      url: null,
      pythonSuffix: '-x86_64-apple-darwin-install_only_stripped.tar.gz',
      format: 'tar.gz',
      pyExe: 'bin/python3.12',
    },
    bash: { url: null, format: 'system' },
    uv: {
      url: `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-apple-darwin.tar.gz`,
      uvMarker: 'x86_64-apple-darwin',
      uvExt: 'tar.gz',
      format: 'tar.gz',
      uvExe: 'uv',
    },
  },
  'linux-x64': {
    python: {
      url: null,
      pythonSuffix: '-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz',
      format: 'tar.gz',
      pyExe: 'bin/python3.12',
    },
    bash: { url: null, format: 'system' },
    uv: {
      url: `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-unknown-linux-gnu.tar.gz`,
      uvMarker: 'x86_64-unknown-linux-gnu',
      uvExt: 'tar.gz',
      format: 'tar.gz',
      uvExe: 'uv',
    },
  },
  'linux-arm64': {
    python: {
      url: null,
      pythonSuffix: '-aarch64-unknown-linux-gnu-install_only_stripped.tar.gz',
      format: 'tar.gz',
      pyExe: 'bin/python3.12',
    },
    bash: { url: null, format: 'system' },
    uv: {
      url: `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-aarch64-unknown-linux-gnu.tar.gz`,
      uvMarker: 'aarch64-unknown-linux-gnu',
      uvExt: 'tar.gz',
      format: 'tar.gz',
      uvExe: 'uv',
    },
  },
  'linux-musl-x64': {
    python: {
      url: null,
      pythonSuffix: '-x86_64-unknown-linux-musl-install_only_stripped.tar.gz',
      format: 'tar.gz',
      pyExe: 'bin/python3.12',
    },
    bash: { url: null, format: 'system' },
    uv: {
      url: `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-unknown-linux-musl.tar.gz`,
      uvMarker: 'x86_64-unknown-linux-musl',
      uvExt: 'tar.gz',
      format: 'tar.gz',
      uvExe: 'uv',
    },
  },
};

function detectPlatform() {
  const p = process.platform, a = process.arch;
  if (p === 'win32' && a === 'x64') return 'win-x64';
  if (p === 'darwin' && a === 'arm64') return 'mac-arm64';
  if (p === 'darwin' && a === 'x64') return 'mac-x64';
  if (p === 'linux' && a === 'x64') {
    if (existsSync('/etc/alpine-release')) return 'linux-musl-x64';
    return 'linux-x64';
  }
  if (p === 'linux' && a === 'arm64') return 'linux-arm64';
  return null;
}

// ---------- 候选源（纯函数，便于离线单测） ----------

/** npmmirror 二进制镜像里的项目名（**不能靠猜**：MinGit 的资产在 GitHub 上属于仓库 `git`，
 *  但 npmmirror 把它放在 `git-for-windows/` 下；uv 干脆没有。这里显式列出来。） */
const NPMMIRROR_PROJECT = {
  'python-build-standalone': 'python-build-standalone',
  git: 'git-for-windows',
  uv: null,
};

/** GitHub release 资产 URL → npmmirror 二进制镜像 URL（镜像没有的项目返回 null） */
export function npmmirrorUrlFor(githubUrl) {
  if (!githubUrl) return null;
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/(.+)$/.exec(String(githubUrl));
  if (!m) return null;
  const repo = m[2], tag = m[3], asset = m[4];
  const project = NPMMIRROR_PROJECT[repo];
  if (!project) return null;   // 镜像没有这个项目（如 uv）→ 交给 PyPI wheel 那条路
  return `${NPMMIRROR_BINARY}/${project}/${tag}/${asset}`;
}

/** 拼接镜像前缀（--mirror / DAGFLOW_RUNTIME_MIRROR） */
export function prefixUrl(prefix, url) {
  const p = String(prefix || '').trim();
  if (!p) return url;
  return p.endsWith('/') ? p + url : p + '/' + url;
}

/**
 * 某工具的候选源列表（**顺序即优先级**）：
 *   自定义镜像 → npmmirror → （uv 专有：PyPI wheel）→ GitHub 直连
 */
export function sourceListFor({ tool, githubUrl, format, mirror }) {
  const list = [];
  // ★ 没有 GitHub 原 URL 时（macOS/Linux 的 bash = "用系统自带"，url 为 null）**不能**套镜像前缀：
  //   否则会拼出 `https://<镜像>/null` 这种假源，一路走到 fetchOne 里对 undefined 取路径名 → 崩（2026-10-11 审计 A）
  if (mirror && githubUrl) list.push({ name: `自定义镜像 ${mirror}`, url: prefixUrl(mirror, githubUrl), format });
  const np = npmmirrorUrlFor(githubUrl);
  if (np) list.push({ name: 'npmmirror 国内镜像', url: np, format });
  if (tool === 'uv') list.push({ name: 'PyPI uv wheel', wheel: true, format: 'zip' });
  if (githubUrl) list.push({ name: 'GitHub 直连', url: githubUrl, format });
  return list;
}

/** wheel 文件名 → 平台匹配得分（-1 = 不匹配；分高者优先，manylinux 优于 musllinux） */
export function wheelMatchScore(filename, platform) {
  const m = /^uv-([^-]+)-py3-none-(.+)\.whl$/.exec(String(filename));
  if (!m) return -1;
  const tags = m[2].split('.');
  const has = (re) => tags.some((t) => re.test(t));
  switch (platform) {
    case 'win-x64': return tags.includes('win_amd64') ? 100 : -1;
    case 'mac-arm64': return has(/^macosx_[\d_]+arm64$/) ? 100 : -1;
    case 'mac-x64': return has(/^macosx_[\d_]+x86_64$/) ? 100 : -1;
    case 'linux-x64': return has(/^manylinux.*_x86_64$/) ? 100 : has(/^musllinux.*_x86_64$/) ? 60 : -1;
    case 'linux-arm64': return has(/^manylinux.*_aarch64$/) ? 100 : has(/^musllinux.*_aarch64$/) ? 60 : -1;
    case 'linux-musl-x64': return has(/^musllinux.*_x86_64$/) ? 100 : has(/^manylinux.*_x86_64$/) ? 60 : -1;
    default: return -1;
  }
}

/** 从 PyPI 简单索引里挑出当前平台的 uv wheel（version 为空则不限版本） */
export function pickUvWheel(files, platform, version) {
  let best = null, bestScore = 0;
  for (const f of files) {
    if (!/\.whl$/.test(f.filename)) continue;
    if (version && !f.filename.startsWith(`uv-${version}-`)) continue;
    const s = wheelMatchScore(f.filename, platform);
    if (s > bestScore) { best = f; bestScore = s; }
  }
  return best;
}

/** 解析 PyPI 简单索引 HTML 里的 wheel 链接 */
export function parseSimpleIndex(html, baseUrl) {
  const out = [];
  for (const m of String(html).matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)) {
    const name = m[2].trim();
    if (!name.endsWith('.whl')) continue;
    let url = m[1].split('#')[0];
    try { url = new URL(url, baseUrl).href; } catch { /* 保持原样 */ }
    out.push({ filename: name, url });
  }
  return out;
}

// ---------- HTTP ----------
function getText(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'dag-flow/0.2.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return getText(new URL(res.headers.location, url).href, timeoutMs).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} for ${url}`)); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error(`request timeout ${timeoutMs}ms`)); });
  });
}

// ---------- HTTP 下载（带重试） ----------
async function downloadWithRetry(url, dest, retries = 3, timeoutMs = 60000) {
  let lastErr;
  for (let i = 1; i <= retries; i++) {
    try {
      await download(url, dest, timeoutMs);
      return dest;
    } catch (e) {
      lastErr = e;
      console.log(`  (下载失败 ${i}/${retries}: ${e.message}${i < retries ? '，重试...' : ''})`);
      // 清理残留文件
      try { rmSync(dest, { force: true }); } catch { /* */ }
      if (i < retries) await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
  throw lastErr;
}

function download(url, dest, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    file.on('error', reject);
    const req = https.get(url, { headers: { 'User-Agent': 'dag-flow/0.2.0' } }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301 || res.statusCode === 307 || res.statusCode === 308) {
        file.destroy();
        return download(res.headers.location, dest, timeoutMs).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.destroy();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest))); // 确保关闭，Windows 才能解压
      res.on('error', (e) => { file.destroy(); reject(e); });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error(`request timeout ${timeoutMs}ms`)); });
  });
}

// ---------- 解压 ----------
async function extractTarGz(archive, dest) {
  mkdirSync(dest, { recursive: true });
  const r = spawnSync('tar', ['-xzf', archive, '-C', dest, '--strip-components=1'], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`tar extract failed (exit ${r.status})`);
}

async function extractZip(archive, dest) {
  mkdirSync(dest, { recursive: true });
  if (process.platform === 'win32') {
    const r = spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path "${archive}" -DestinationPath "${dest}" -Force`], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`Expand-Archive failed (exit ${r.status})`);
  } else {
    const r = spawnSync('unzip', ['-q', '-o', archive, '-d', dest], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`unzip failed (exit ${r.status})`);
  }
}

/** 在目录树里找某个文件名（第一个命中） */
function findFile(root, name) {
  let entries = [];
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) { const hit = findFile(p, name); if (hit) return hit; }
    else if (e.name === name) return p;
  }
  return null;
}

/**
 * uv 专有：PyPI 上没有"uv 二进制包"，只有 wheel —— 但 wheel 里就是那颗 uv(.exe)，
 * 取出来即可用（wheel 内部路径形如 uv-<版本>.data/scripts/uv.exe）。
 */
async function fetchUvFromWheel(platform, version, archive, stage) {
  let files = null, lastErr = null;
  for (const base of PYPI_INDEXES) {
    const idx = base.endsWith('/') ? `${base}uv/` : `${base}/uv/`;
    try {
      const html = await getText(idx, 15000);
      files = parseSimpleIndex(html, idx);
      if (files.length) { console.log(`  uv wheel 索引：${idx}（${files.length} 个候选）`); break; }
    } catch (e) { lastErr = e; console.log(`  uv wheel 索引不可用：${idx} — ${e.message}`); }
  }
  if (!files?.length) throw new Error(`取不到 PyPI 的 uv 索引${lastErr ? `（${lastErr.message}）` : ''}`);

  const wheel = pickUvWheel(files, platform, version);
  if (!wheel) throw new Error(`PyPI 上没有匹配 ${platform} 的 uv ${version || ''} wheel`);
  console.log(`  uv wheel 命中：${wheel.filename} → ${wheel.url}`);
  await downloadWithRetry(wheel.url, archive, SOURCE_RETRIES, SOURCE_TIMEOUT_MS);

  const uvExe = platform.startsWith('win') ? 'uv.exe' : 'uv';
  const tmp = path.join(stage, '_wheel');
  rmSync(tmp, { recursive: true, force: true });
  await extractZip(archive, tmp);
  const found = findFile(tmp, uvExe);
  if (!found) { rmSync(tmp, { recursive: true, force: true }); throw new Error(`wheel 里没找到 ${uvExe}`); }
  copyFileSync(found, path.join(stage, uvExe));
  rmSync(tmp, { recursive: true, force: true });
}

/**
 * 动态解析 python-build-standalone 的真实下载 URL。
 * 查 GitHub API 最新 release，找匹配当前平台（含架构）的 3.12.x install_only_stripped 资产；
 * API 不可用回退硬编码 URL。
 * @returns {Promise<{url: string, version: string, release: string}>}
 */
async function resolvePythonUrlFor(platform, target) {
  const suffix = target.pythonSuffix;
  const fallback = {
    url: `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_RELEASE}/cpython-${PYTHON_VERSION}+${PYTHON_RELEASE}${suffix}`,
    version: PYTHON_VERSION,
    release: PYTHON_RELEASE,
  };
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch('https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest', {
      signal: ctl.signal,
      headers: { 'User-Agent': 'dag-flow/0.2.0', accept: 'application/vnd.github+json' },
    });
    clearTimeout(to);
    if (!res.ok) return fallback;
    const rel = await res.json();
    const tag = String(rel.tag_name ?? '');
    const assets = rel.assets ?? [];
    // 平台标识串：-x86_64-pc-windows-msvc / -aarch64-apple-darwin / -x86_64-unknown-linux-gnu ...
    // 从 suffix 去掉 "-install_only_stripped.tar.gz" 得到精确平台串，用它在资产名里精确定位（含架构）
    const platMarker = suffix.replace(/-install_only_stripped\.tar\.gz$/, ''); // 形如 -x86_64-pc-windows-msvc
    const escMarker = platMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // ★★ 兼容性红线（2026-10-11 用户要求「自动下载的组件要满足兼容性要求，必须下载就能使用」）：
    //   只认 **3.12.x**！OCR 引擎的轮子（onnxruntime / pypdfium2 / opencv）全是 cp312 编的，
    //   跨次版本（3.13/3.14）下下来也只能干瞪眼 —— 所以这里**不做"任意 3.x"的降级**，
    //   匹配不到就直接用下面硬编码的 3.12.14 兜底 URL（宁可用固定版本，也不用跑不了的新版）。
    const want312 = new RegExp(`cpython-3\\.12\\.\\d+\\+.*${escMarker}.*install_only_stripped`);
    const asset = assets.find((a) => want312.test(a.name));
    if (asset?.browser_download_url) {
      const m = asset.name.match(/cpython-(3\.\d+\.\d+)\+(.+?)-(?:x86_64|aarch64)/);
      const version = m?.[1] ?? PYTHON_VERSION;
      if (!String(version).startsWith('3.12.')) {
        console.log(`[${platform}] python: 发现 ${version} 不是 3.12.x，按兼容性要求改用固定 ${PYTHON_VERSION}`);
        return fallback;
      }
      return {
        url: asset.browser_download_url,
        version,
        release: m?.[2] ?? tag,
      };
    }
  } catch (e) {
    console.log(`[${platform}] python: API 发现失败（${e.message}），用硬编码 URL`);
  }
  return fallback;
}

/**
 * 动态解析 uv 的真实下载 URL（查 GitHub API latest release）。
 * uv 资产命名形如 uv-x86_64-pc-windows-msvc.zip / uv-aarch64-apple-darwin.tar.gz（不含版本号前缀），
 * 用平台串匹配资产名；API 不可用回退硬编码 URL。
 * @returns {Promise<{url: string, version: string}>}
 */
async function resolveUvUrlFor(platform, target) {
  const platMarker = String(target.uvMarker ?? ''); // 形如 x86_64-pc-windows-msvc / aarch64-apple-darwin
  const ext = String(target.uvExt ?? 'zip');
  const fallback = {
    url: `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${platMarker}.${ext}`,
    version: UV_VERSION,
  };
  if (!platMarker) return fallback;
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch('https://api.github.com/repos/astral-sh/uv/releases/latest', {
      signal: ctl.signal,
      headers: { 'User-Agent': 'dag-flow/0.2.0', accept: 'application/vnd.github+json' },
    });
    clearTimeout(to);
    if (!res.ok) return fallback;
    const rel = await res.json();
    const tag = String(rel.tag_name ?? '');
    const escMarker = platMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const asset = (rel.assets ?? []).find((a) => new RegExp(`^uv-${escMarker}\\.(zip|tar\\.gz)$`).test(a.name));
    if (asset?.browser_download_url) {
      console.log(`[${platform}] uv: API 发现 ${asset.name}（tag ${tag}）`);
      return { url: asset.browser_download_url, version: tag.replace(/^v/, '') };
    }
  } catch (e) {
    console.log(`[${platform}] uv: API 发现失败（${e.message}），用硬编码 URL`);
  }
  return fallback;
}

// ---------- 单个工具下载流程（多源候选） ----------
async function fetchOne(tool, target, platform, pyVersion = PYTHON_VERSION, pyRelease = PYTHON_RELEASE, sources = []) {
  if (!target || (!target.url && !sources.length)) {
    console.log(`[${platform}] ${tool}: skip (system binary)`);
    return false;
  }
  // python: <pyVersion>+<pyRelease>；uv: 动态版本（无 release）；bash: BASH_VERSION
  const version = tool === 'python'
    ? `${pyVersion}+${pyRelease}`
    : tool === 'uv'
      ? pyVersion
      : BASH_VERSION;
  const outDir = path.join(USER_RUNTIME_DIR, tool, version, platform);
  const targetExe = tool === 'python' ? target.pyExe : tool === 'bash' ? target.bashExe : target.uvExe;
  // ★ 防御：这个平台没有该工具的目标可执行文件（mac/linux 的 bash = 用系统自带）→ 当"跳过"处理。
  //   不加这道闸，`path.join(outDir, undefined)` 会抛 ERR_INVALID_ARG_TYPE 把整个下载进程带崩（2026-10-11 审计 A）
  if (!targetExe) {
    console.log(`[${platform}] ${tool}: skip (system binary)`);
    return true;
  }
  const exePath = path.join(outDir, targetExe);

  if (existsSync(exePath)) {
    console.log(`[${platform}] ${tool}: already cached at ${exePath}`);
    return true;
  }

  const list = sources.length ? sources : [{ name: 'GitHub 直连', url: target.url, format: target.format }];
  const stage = path.join(USER_RUNTIME_DIR, tool, version, `${platform}.staging`);
  mkdirSync(path.dirname(outDir), { recursive: true });

  for (const src of list) {
    // 每个源都在**独立暂存目录**里解压：坏源留下的残渣不会污染下一个源
    rmSync(stage, { recursive: true, force: true });
    mkdirSync(stage, { recursive: true });
    const archiveName = `download.${src.wheel ? 'zip' : (src.format || target.format)}`;
    const tmpArchive = path.join(stage, archiveName);
    try {
      if (src.wheel) {
        console.log(`[${platform}] ${tool}: 尝试 ${src.name}…`);
        await fetchUvFromWheel(platform, pyVersion, tmpArchive, stage);
      } else {
        console.log(`[${platform}] ${tool}: 尝试 ${src.name} → ${src.url}`);
        await downloadWithRetry(src.url, tmpArchive, SOURCE_RETRIES, SOURCE_TIMEOUT_MS);
        if ((src.format || target.format) === 'tar.gz') await extractTarGz(tmpArchive, stage);
        else await extractZip(tmpArchive, stage);
      }
      if (!existsSync(path.join(stage, targetExe))) {
        throw new Error(`解压后没找到 ${targetExe}（这个源的布局不对）`);
      }
      rmSync(tmpArchive, { force: true });
      rmSync(outDir, { recursive: true, force: true });
      mkdirSync(path.dirname(outDir), { recursive: true });
      await fs.rename(stage, outDir);
      console.log(`[${platform}] ${tool}: ✓ 来自「${src.name}」→ ${exePath}`);
      return true;
    } catch (e) {
      console.error(`[${platform}] ${tool}: 「${src.name}」不可用 — ${e.message}`);
      try { rmSync(tmpArchive, { force: true }); } catch { /* */ }
    }
  }

  rmSync(stage, { recursive: true, force: true });
  rmSync(outDir, { recursive: true, force: true });
  console.error(`[${platform}] ${tool}: 所有候选源都失败（${list.map((s) => s.name).join(' / ')}）`);
  return false;
}

// ---------- 主流程 ----------
async function main() {
  const args = process.argv.slice(2);
  const argMap = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
  const targetPlatforms = argMap.platform ? [argMap.platform] : [detectPlatform()].filter(Boolean);
  const tools = (argMap.tools ?? 'python,bash,uv').split(',');
  // 镜像前缀（--mirror=https://ghfast.top/ 等；也可用环境变量，宿主自动下载时走这条）
  const mirror = String(argMap.mirror ?? process.env.DAGFLOW_RUNTIME_MIRROR ?? '').replace(/\s+/g, '');

  if (targetPlatforms.length === 0) {
    console.error('Unknown platform');
    process.exit(1);
  }

  console.log(`Downloading runtime to ${USER_RUNTIME_DIR}`);
  console.log(`Platforms: ${targetPlatforms.join(', ')}`);
  console.log(`Tools: ${tools.join(', ')}${mirror ? `\nMirror: ${mirror}` : ''}`);
  console.log(`单源超时: ${SOURCE_TIMEOUT_MS}ms × ${SOURCE_RETRIES} 次\n`);

  let allOk = true;
  for (const platform of targetPlatforms) {
    const targets = PLATFORM_TARGETS[platform];
    if (!targets) {
      console.error(`Unknown platform: ${platform}`);
      allOk = false;
      continue;
    }
    for (const tool of tools) {
      if (tool === 'python') {
        const resolved = await resolvePythonUrlFor(platform, targets[tool]);
        console.log(`[${platform}] python: 目标 ${resolved.version}+${resolved.release}`);
        // 动态发现的版本万一没被国内镜像收录（上游刚发新版就是这样），还得有"固定版"这条后路
        const pinnedUrl = `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_RELEASE}/cpython-${PYTHON_VERSION}+${PYTHON_RELEASE}${targets[tool].pythonSuffix}`;
        const attempts = [{ version: resolved.version, release: resolved.release, url: resolved.url }];
        if (`${resolved.version}+${resolved.release}` !== `${PYTHON_VERSION}+${PYTHON_RELEASE}`) {
          console.log(`[${platform}] python: 备用固定版 ${PYTHON_VERSION}+${PYTHON_RELEASE}`);
          attempts.push({ version: PYTHON_VERSION, release: PYTHON_RELEASE, url: pinnedUrl });
        }
        let ok = false;
        for (const a of attempts) {
          const sources = sourceListFor({ tool, githubUrl: a.url, format: targets[tool].format, mirror });
          if (await fetchOne(tool, { ...targets[tool], url: a.url }, platform, a.version, a.release, sources)) { ok = true; break; }
        }
        if (!ok) allOk = false;
      } else if (tool === 'uv') {
        const resolved = await resolveUvUrlFor(platform, targets[tool]);
        console.log(`[${platform}] uv: 目标 ${resolved.version}`);
        // 同理：PyPI 上没有这个版本时，退回固定版（PyPI 一定有它）
        const pinnedUrl = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${targets[tool].uvMarker}.${targets[tool].uvExt}`;
        const attempts = [{ version: resolved.version, url: resolved.url }];
        if (resolved.version !== UV_VERSION) {
          console.log(`[${platform}] uv: 备用固定版 ${UV_VERSION}`);
          attempts.push({ version: UV_VERSION, url: pinnedUrl });
        }
        let ok = false;
        for (const a of attempts) {
          const sources = sourceListFor({ tool, githubUrl: a.url, format: targets[tool].format, mirror });
          if (await fetchOne(tool, { ...targets[tool], url: a.url }, platform, a.version, '', sources)) { ok = true; break; }
        }
        if (!ok) allOk = false;
      } else {
        const rawUrl = targets[tool]?.url;
        const sources = sourceListFor({ tool, githubUrl: rawUrl, format: targets[tool]?.format, mirror });
        const ok = await fetchOne(tool, { ...targets[tool], url: rawUrl }, platform, PYTHON_VERSION, PYTHON_RELEASE, sources);
        if (!ok && rawUrl) allOk = false;
      }
    }
  }

  console.log(allOk ? '\n✓ All done.' : '\n✗ Some downloads failed (will fall back to system binaries).');
  process.exit(allOk ? 0 : 1);
}

// 只有"被直接执行"时才跑主流程（被 import 做单测时不跑）
const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });

export { detectPlatform, PLATFORM_TARGETS, PYTHON_VERSION, PYTHON_RELEASE, BASH_VERSION, UV_VERSION, MINIGIT_ASSET, NPMMIRROR_BINARY, SOURCE_TIMEOUT_MS };
