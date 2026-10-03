// scripts/download-runtime.mjs — 按需下载 Python / bash / uv 运行时
// 跑法：node scripts/download-runtime.mjs [--platform=PLAT] [--tools=python,bash,uv]
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

import { existsSync, mkdirSync, createWriteStream, rmSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
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
      url: `https://github.com/git-for-windows/git/releases/download/v${BASH_VERSION}/MinGit-2.55.0.5-64-bit.zip`,
      format: 'zip',
      bashExe: 'mingit64/usr/bin/bash.exe',
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

// ---------- HTTP 下载（带重试） ----------
async function downloadWithRetry(url, dest, retries = 3) {
  let lastErr;
  for (let i = 1; i <= retries; i++) {
    try {
      await download(url, dest);
      return dest;
    } catch (e) {
      lastErr = e;
      console.log(`  (下载失败 ${i}/${retries}: ${e.message}${i < retries ? '，重试...' : ''})`);
      // 清理残留文件
      try { rmSync(dest, { force: true }); } catch { /* */ }
      if (i < retries) await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
  throw lastErr;
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    file.on('error', reject);
    const req = https.get(url, { headers: { 'User-Agent': 'dag-flow/0.2.0' } }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        file.destroy();
        return download(res.headers.location, dest).then(resolve, reject);
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
    req.setTimeout(60000, () => { req.destroy(new Error('request timeout 60s')); });
  });
}

// ---------- 解压 ----------
async function extractTarGz(archive, dest) {
  mkdirSync(dest, { recursive: true });
  const r = spawnSync('tar', ['-xzf', archive, '-C', dest, '--strip-components=1'], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`tar extract failed (exit ${r.status})`);
}

async function extractZip(archive, dest) {
  if (process.platform === 'win32') {
    const r = spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path "${archive}" -DestinationPath "${dest}" -Force`], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`Expand-Archive failed (exit ${r.status})`);
  } else {
    const r = spawnSync('unzip', ['-q', '-o', archive, '-d', dest], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`unzip failed (exit ${r.status})`);
  }
}

/**
 * 动态解析 python-build-standalone 的真实下载 URL。
 * 查 GitHub API 最新 release，找匹配当前平台（含架构）的 3.12.x install_only_stripped 资产；
 * 3.12 不存在则回退任意 3.x stripped；API 不可用回退硬编码 URL。
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
    // 优先：本平台 + 3.12.x
    const want312 = new RegExp(`cpython-3\\.12\\.\\d+\\+.*${escMarker}.*install_only_stripped`);
    let asset = assets.find((a) => want312.test(a.name));
    // 次优：本平台 + 任意 3.x
    if (!asset) {
      const anyPlat = new RegExp(`cpython-3\\.\\d+\\.\\d+\\+.*${escMarker}.*install_only_stripped`);
      asset = assets.find((a) => anyPlat.test(a.name));
    }
    // 最后：任意平台任意 3.x stripped（仅当上面都没匹配时）
    if (!asset) asset = assets.find((a) => /cpython-3\.\d+\.\d+\+.*install_only_stripped/.test(a.name));
    if (asset?.browser_download_url) {
      const m = asset.name.match(/cpython-(3\.\d+\.\d+)\+(.+?)-(?:x86_64|aarch64)/);
      return {
        url: asset.browser_download_url,
        version: m?.[1] ?? PYTHON_VERSION,
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
      return { url: asset.browser_download_url, version: tag };
    }
  } catch (e) {
    console.log(`[${platform}] uv: API 发现失败（${e.message}），用硬编码 URL`);
  }
  return fallback;
}

// ---------- 单个工具下载流程 ----------
async function fetchOne(tool, target, platform, pyVersion = PYTHON_VERSION, pyRelease = PYTHON_RELEASE) {
  if (!target || !target.url) {
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
  const exePath = path.join(outDir, targetExe);

  if (existsSync(exePath)) {
    console.log(`[${platform}] ${tool}: already cached at ${exePath}`);
    return true;
  }

  console.log(`[${platform}] ${tool}: downloading ${target.url}`);
  mkdirSync(outDir, { recursive: true });
  const tmpArchive = path.join(outDir, `download.${target.format}`);
  try {
    await downloadWithRetry(target.url, tmpArchive, 3);
    console.log(`[${platform}] ${tool}: extracting...`);
    if (target.format === 'tar.gz') await extractTarGz(tmpArchive, outDir);
    else if (target.format === 'zip') await extractZip(tmpArchive, outDir);
    if (!existsSync(exePath)) {
      throw new Error(`expected ${exePath} not found after extraction`);
    }
    console.log(`[${platform}] ${tool}: ✓ ${exePath}`);
    rmSync(tmpArchive, { force: true });
    return true;
  } catch (e) {
    console.error(`[${platform}] ${tool}: FAILED — ${e.message}`);
    rmSync(outDir, { recursive: true, force: true });
    return false;
  }
}

// ---------- 主流程 ----------
async function main() {
  const args = process.argv.slice(2);
  const argMap = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
  const targetPlatforms = argMap.platform ? [argMap.platform] : [detectPlatform()].filter(Boolean);
  const tools = (argMap.tools ?? 'python,bash,uv').split(',');
  // --mirror=https://ghfast.top/ 等加速前缀（中国大陆 GitHub 直连常被重置）
  const mirror = argMap.mirror ? String(argMap.mirror).replace(/\/+$/, '') + '/' : '';

  if (targetPlatforms.length === 0) {
    console.error('Unknown platform');
    process.exit(1);
  }

  console.log(`Downloading runtime to ${USER_RUNTIME_DIR}`);
  console.log(`Platforms: ${targetPlatforms.join(', ')}`);
  console.log(`Tools: ${tools.join(', ')}${mirror ? `\nMirror: ${mirror}` : ''}\n`);

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
        const url = mirror + resolved.url;
        const ok = await fetchOne(tool, { ...targets[tool], url }, platform, resolved.version, resolved.release);
        if (!ok) allOk = false;
      } else if (tool === 'uv') {
        const resolved = await resolveUvUrlFor(platform, targets[tool]);
        console.log(`[${platform}] uv: 目标 ${resolved.version}`);
        const url = mirror + resolved.url;
        const ok = await fetchOne(tool, { ...targets[tool], url }, platform, resolved.version, '');
        if (!ok) allOk = false;
      } else {
        const rawUrl = targets[tool]?.url;
        const ok = await fetchOne(tool, { ...targets[tool], url: rawUrl ? mirror + rawUrl : rawUrl }, platform);
        if (!ok && targets[tool]?.url) allOk = false;
      }
    }
  }

  console.log(allOk ? '\n✓ All done.' : '\n✗ Some downloads failed (will fall back to system binaries).');
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
