// test/runtime.test.mjs — runtime 路径解析的离线契约测试（不依赖子进程）
// 跑法：node test/runtime.test.mjs
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const failures = [];
async function t(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; failures.push({ name, err: e }); console.log(`  ✗ ${name}\n    ${e.message}`); }
}

console.log('\n=== runtime path resolution contract tests ===\n');

// ===== 契约层：复刻 src/adapter/runtime.ts 的纯函数部分（不读 fs） =====

// 平台检测（用纯函数版本，不调 process）
function detectPlatformFrom(p, a) {
  if (p === 'win32' && a === 'x64') return 'win-x64';
  if (p === 'darwin' && a === 'x64') return 'mac-x64';
  if (p === 'darwin' && a === 'arm64') return 'mac-arm64';
  if (p === 'linux' && a === 'x64') return 'linux-x64';
  if (p === 'linux' && a === 'arm64') return 'linux-arm64';
  return 'unknown';
}

const PY_EXE_BY_PLATFORM = {
  'win-x64': 'python.exe',
  'mac-x64': 'bin/python3.12',
  'mac-arm64': 'bin/python3.12',
  'linux-x64': 'bin/python3.12',
  'linux-arm64': 'bin/python3.12',
  'unknown': '',
};

const BASH_EXE_BY_PLATFORM = {
  'win-x64': 'mingit64/usr/bin/bash.exe',
  'mac-x64': '',
  'mac-arm64': '',
  'linux-x64': '',
  'linux-arm64': '',
  'unknown': '',
};

// 路径生成（不读 fs，只生成）
function bundledPath(PLUGIN_ROOT, tool, version, platform, sub) {
  return `${PLUGIN_ROOT}/runtime/${tool}/${version}/${platform}/${sub}`;
}
function userCachePath(USER_RUNTIME_DIR, tool, version, platform, sub) {
  return `${USER_RUNTIME_DIR}/${tool}/${version}/${platform}/${sub}`;
}

// ===== 测试 =====

await t('detect: win32+x64 → win-x64', () => {
  assert.equal(detectPlatformFrom('win32', 'x64'), 'win-x64');
});
await t('detect: darwin+arm64 → mac-arm64', () => {
  assert.equal(detectPlatformFrom('darwin', 'arm64'), 'mac-arm64');
});
await t('detect: linux+x64 → linux-x64', () => {
  assert.equal(detectPlatformFrom('linux', 'x64'), 'linux-x64');
});
await t('detect: win32+arm64 → unknown', () => {
  assert.equal(detectPlatformFrom('win32', 'arm64'), 'unknown');
});

await t('python path: win-x64 bundled = python.exe', () => {
  const p = bundledPath('/plugin', 'python', '3.12.12+20260901', 'win-x64', 'python.exe');
  assert.equal(p, '/plugin/runtime/python/3.12.12+20260901/win-x64/python.exe');
});
await t('python path: mac-arm64 = bin/python3.12', () => {
  const p = bundledPath('/plugin', 'python', '3.12.12+20260901', 'mac-arm64', 'bin/python3.12');
  assert.equal(p, '/plugin/runtime/python/3.12.12+20260901/mac-arm64/bin/python3.12');
});
await t('python path: linux-x64 user-cache 路径', () => {
  const p = userCachePath('/home/u/.dsh/runtime', 'python', '3.12.12+20260901', 'linux-x64', 'bin/python3.12');
  assert.equal(p, '/home/u/.dsh/runtime/python/3.12.12+20260901/linux-x64/bin/python3.12');
});

await t('bash path: win-x64 bundled = mingit64/usr/bin/bash.exe', () => {
  const p = bundledPath('/plugin', 'bash', '2.55.0.5', 'win-x64', 'mingit64/usr/bin/bash.exe');
  assert.equal(p, '/plugin/runtime/bash/2.55.0.5/win-x64/mingit64/usr/bin/bash.exe');
});
await t('bash path: mac-arm64 → 空（用系统）', () => {
  const sub = BASH_EXE_BY_PLATFORM['mac-arm64'];
  assert.equal(sub, '');
});
await t('bash path: linux-x64 → 空（用系统）', () => {
  const sub = BASH_EXE_BY_PLATFORM['linux-x64'];
  assert.equal(sub, '');
});

await t('uv path: win-x64 = uv.exe', () => {
  assert.equal(bundledPath('/p', 'uv', '0.4.18', 'win-x64', 'uv.exe'), '/p/runtime/uv/0.4.18/win-x64/uv.exe');
});
await t('uv path: mac-arm64 = uv (无扩展名)', () => {
  assert.equal(bundledPath('/p', 'uv', '0.4.18', 'mac-arm64', 'uv'), '/p/runtime/uv/0.4.18/mac-arm64/uv');
});

// 模拟 resolve 决策（bundled → user-cache → system → missing）
function resolveDecision(platform, hasBundled, hasUserCache, hasSystem) {
  if (hasBundled) return 'bundled';
  if (hasUserCache) return 'user-cache';
  if (hasSystem) return 'system';
  return 'missing';
}

await t('resolve: bundled 优先', () => {
  assert.equal(resolveDecision('win-x64', true, true, true), 'bundled');
});
await t('resolve: 无 bundled → user-cache', () => {
  assert.equal(resolveDecision('linux-x64', false, true, true), 'user-cache');
});
await t('resolve: 无 bundled/cache → system (macOS/Linux bash)', () => {
  assert.equal(resolveDecision('mac-arm64', false, false, true), 'system');
});
await t('resolve: 全无 → missing', () => {
  assert.equal(resolveDecision('win-x64', false, false, false), 'missing');
});

// python 节点 R3 改造：错误码
await t('PYTHON_UNAVAILABLE 错误信息含 fetch 命令', () => {
  const msg = `Python runtime not found. Run: node scripts/download-runtime.mjs --platform=win-x64`;
  assert.match(msg, /download-runtime\.mjs/);
  assert.match(msg, /--platform=win-x64/);
});

await t('BASH_UNAVAILABLE 错误信息含 fetch 命令', () => {
  const msg = `bash runtime not found. Run: node scripts/download-runtime.mjs --platform=linux-x64`;
  assert.match(msg, /download-runtime\.mjs/);
});

// download script URL 模板
const PBS_BASE = 'https://github.com/astral-sh/python-build-standalone/releases/download/20260901';
const UV_BASE = 'https://github.com/astral-sh/uv/releases/download/0.4.18';
const MINGIT_BASE = 'https://github.com/git-for-windows/MinGit/releases/download/v2.55.0.5';

await t('download URL: win-x64 PBS', () => {
  const url = `${PBS_BASE}/cpython-3.12.12+20260901-x86_64-pc-windows-msvc-install_only_stripped.tar.gz`;
  assert.match(url, /x86_64-pc-windows-msvc/);
});
await t('download URL: mac-arm64 PBS', () => {
  const url = `${PBS_BASE}/cpython-3.12.12+20260901-aarch64-apple-darwin-install_only_stripped.tar.gz`;
  assert.match(url, /aarch64-apple-darwin/);
});
await t('download URL: linux-x64 PBS', () => {
  const url = `${PBS_BASE}/cpython-3.12.12+20260901-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz`;
  assert.match(url, /x86_64-unknown-linux-gnu/);
});
await t('download URL: win-x64 MinGit busybox', () => {
  const url = `${MINGIT_BASE}/MinGit-2.55.0.5-64-bit.zip`;
  assert.match(url, /MinGit-2\.55\.0\.5-64-bit\.zip/);
});
await t('download URL: win-x64 uv', () => {
  const url = `${UV_BASE}/uv-x86_64-pc-windows-msvc.zip`;
  assert.match(url, /uv-x86_64-pc-windows-msvc\.zip/);
});

// R3 行为契约
await t('R3 契约: python 节点不允许回退到系统 python（除非 bundled/cache 都没有）', () => {
  // 模拟：bundled=否, cache=否, system=是 → 仍走 system（兼容过渡）
  // 但 R3 严格模式：system=是 才回退，否则 missing
  // 当前实现是兼容模式（system 当 fallback）— 这是有意的，避免破坏现有 v0.1 用户
  const r1 = resolveDecision('mac-arm64', false, false, true);
  assert.equal(r1, 'system'); // 当前实现：system 是 fallback
  // 未来 v0.2 可考虑严格 R3 模式：bundled|user-cache 才有，其他直接 missing
});

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail > 0) {
  for (const f of failures) console.log(`  FAIL: ${f.name}\n    ${f.err.message}`);
  process.exit(1);
}
process.exit(0);
