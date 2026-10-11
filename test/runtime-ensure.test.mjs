// test/runtime-ensure.test.mjs — 运行时「自带优先 → 读不到就自动下载 → 兼容性校验」离线测试
//
// 用户要求（2026-10-11 原话）：「插件的 runtime 下的 python/bash/uv/ocr 组件，都要改造成先读 runtime 下的插件，
//   如果读到就使用 runtime 下的组件，如果读不到就自动下载组件，并且要保证组件之间的兼容性，
//   自动下载的组件要满足兼容性要求，必须下载就能使用」。
//
// 手法：把「自带根」指到一个**空目录**（DAGFLOW_RUNTIME_BUNDLED_DIR），把「下载脚本」换成一个**假脚本**
//   （DAGFLOW_RUNTIME_DOWNLOAD_SCRIPT）——于是"自带没有 ⇒ 自动下载 ⇒ 装进用户缓存 ⇒ 校验 ⇒ 可用"这条
//   完整链路能被真走一遍，而且**不联网、不动真机**（DSH_HOME 已被 _isolate-home 隔离）。
//   真网络下载另用真机彩排验证（tmp-test/rehearse-runtime-download.mjs）。
// 跑法：node test/runtime-ensure.test.mjs
import './_isolate-home.mjs';   // ★ 必须最先：隔离 DSH_HOME（绝不碰真机数据/运行区）
import { ISOLATED_HOME } from './_isolate-home.mjs';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url));      // 测试文件在 <plugin>/test/ 下
const work = mkdtempSync(join(tmpdir(), 'dag-runtime-'));
const emptyBundled = join(work, 'no-bundled');                          // 假装"插件里没带运行时"
mkdirSync(emptyBundled, { recursive: true });
process.env.DAGFLOW_RUNTIME_BUNDLED_DIR = emptyBundled;

// 假下载脚本：按**真实布局**把工具"装"进 <DSH_HOME>/runtime/<tool>/<版本>/<平台>/
//   ★ python 用真内置解释器的**目录联接**（junction）——这样版本探测是真跑的，测的不是桩
const realPythonDir = join(PLUGIN_ROOT, 'runtime', 'python', '3.12.14+20260901', 'win-x64');
const logFile = join(work, 'downloads.log');
const fakeDl = join(work, 'fake-download.mjs');
writeFileSync(fakeDl, `
import { appendFileSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(logFile)}, args.join(' ') + '\\n');
const pick = (k, d) => (args.find((a) => a.startsWith(k + '=')) ?? (k + '=' + d)).slice(k.length + 1);
const tools = pick('--tools', 'python').split(',').filter(Boolean);
const platform = pick('--platform', 'win-x64');
const home = process.env.DSH_HOME || join(homedir(), '.dsh');
if (process.env.FAKE_DL_FAIL === '1') { console.error('假装下载失败：网络不可达'); process.exit(3); }
const REAL_PY = ${JSON.stringify(realPythonDir)};
for (const tool of tools) {
  const ver = tool === 'python' ? '3.12.14+20260901' : tool === 'bash' ? '2.55.0.5' : '0.12.10';
  const verDir = join(home, 'runtime', tool, ver);
  const platDir = join(verDir, platform);
  mkdirSync(verDir, { recursive: true });
  if (tool === 'python') {
    // 整个平台目录做成 junction（真实下载解压后就是这个布局：python.exe 直接在 <平台>/ 下）
    try { symlinkSync(REAL_PY, platDir, 'junction'); }
    catch { mkdirSync(platDir, { recursive: true }); writeFileSync(join(platDir, 'python.exe'), 'stub'); }
  } else if (tool === 'bash') {
    mkdirSync(join(platDir, 'usr', 'bin'), { recursive: true });
    writeFileSync(join(platDir, 'usr', 'bin', 'sh.exe'), '#!/bin/sh\\n');
  } else {
    mkdirSync(platDir, { recursive: true });
    writeFileSync(join(platDir, 'uv.exe'), 'stub');
  }
}
console.log('[fake-download] 装好：' + tools.join(','));
`, 'utf8');
process.env.DAGFLOW_RUNTIME_DOWNLOAD_SCRIPT = fakeDl;

// 把 PATH 换成一个空目录：确保「自带空 + 缓存空」时真能判定为 missing（否则会命中本机系统 python）
const realPath = process.env.PATH;
process.env.PATH = work;

const OUT = join(work, 'runtime-ensure.mjs');
await build({ entryPoints: ['src/adapter/runtime-ensure.ts'], bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent' });
const re = await import(pathToFileURL(OUT).href);

const PLAT = localDetectPlatform();
/** 本机平台串（与 src/adapter/runtime.ts 的 detectPlatform 同规则；只用于断言命令行参数） */
function localDetectPlatform() {
  const p = process.platform, a = process.arch;
  if (p === 'win32' && a === 'x64') return 'win-x64';
  if (p === 'darwin' && a === 'x64') return 'mac-x64';
  if (p === 'darwin' && a === 'arm64') return 'mac-arm64';
  if (p === 'linux' && a === 'x64') return 'linux-x64';
  if (p === 'linux' && a === 'arm64') return 'linux-arm64';
  return 'unknown';
}
const dlCount = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).length : 0);

// ==================== A. 纯函数：兼容性判据 ====================
console.log('== A. 兼容性判据（纯函数，不起进程） ==');
t('3.12.14 通过（OCR 的轮子是 cp312 编的）', re.checkPythonAbi('3.12.14').ok === true);
t('3.13.1 被拒，且说清为什么', re.checkPythonAbi('3.13.1').ok === false && /3\.12/.test(String(re.checkPythonAbi('3.13.1').reason)));
t('空版本号被拒', re.checkPythonAbi('').ok === false);
t('兼容矩阵写死在代码里（python abi + uv/bash 版本 + OCR 要 3.12）', re.RUNTIME_COMPAT.python.abi === '3.12' && !!re.RUNTIME_COMPAT.uv.version && !!re.RUNTIME_COMPAT.bash.version && re.RUNTIME_COMPAT.ocr.requiresPython === '3.12');

// ==================== B. 自带优先 ====================
console.log('== B. 自带优先（覆盖根 = 空目录 ⇒ 应判定为缺失） ==');
const st0 = re.runtimeStatus();
t('自带根被覆盖（逃生舱生效，不回落到真插件目录）', JSON.stringify(st0.bundledRoots) === JSON.stringify([emptyBundled]), JSON.stringify(st0.bundledRoots));
t('三个工具全 missing（自带空 + 缓存空 + PATH 空）', ['python', 'bash', 'uv'].every((k) => st0.tools[k] === 'missing'), JSON.stringify(st0.tools));
t('还没有发生任何下载', dlCount() === 0);

// ==================== C. 失败路径（都要有明确错误码，不能静默降级） ====================
// 放在成功路径之前：此时缓存还是空的，"缺失"才成立（缓存一旦装好就不会再走下载分支）
console.log('== C. 失败路径 ==');
process.env.FAKE_DL_FAIL = '1';
re.__resetRuntimeCache();
let err = null;
try { await re.ensureTool('uv'); } catch (e) { err = e; }
t('下载脚本失败 → RUNTIME_DOWNLOAD_FAILED（并带上脚本输出尾巴）', err?.code === 'RUNTIME_DOWNLOAD_FAILED' && /假装下载失败|退出码/.test(String(err?.message)), `${err?.code}: ${String(err?.message).slice(0, 90)}`);
t('下载失败时确实调用了下载脚本', dlCount() === 1);

delete process.env.FAKE_DL_FAIL;
process.env.DAGFLOW_RUNTIME_NO_DOWNLOAD = '1';
re.__resetRuntimeCache();
err = null;
try { await re.ensureTool('uv'); } catch (e) { err = e; }
t('禁止下载时缺失 → RUNTIME_MISSING（纯离线环境可控）', err?.code === 'RUNTIME_MISSING', String(err?.code));
t('禁止下载时不再尝试下载（脚本没被再调）', dlCount() === 1);
delete process.env.DAGFLOW_RUNTIME_NO_DOWNLOAD;

const notPython = join(work, 'not-a-python.exe');
writeFileSync(notPython, 'this is not an executable\n');
const bad = re.checkCompat('python', notPython);
t('冒充 Python 会被 checkCompat 拒绝（不带着坏解释器去跑）', bad.ok === false && !!bad.reason, JSON.stringify(bad));

// ==================== C2. 解析到了、但那份不兼容（审计 C） ====================
// 场景：系统里有一份 python（macOS/Linux 常见 3.13），而 OCR 的轮子是 cp312 ⇒ 不能直接失败，要去补一份兼容的。
console.log('== C2. 解析到但那份不兼容 → 也要去补 ==');
const sysBin = join(work, 'sysbin');
mkdirSync(sysBin, { recursive: true });
writeFileSync(join(sysBin, process.platform === 'win32' ? 'python3.exe' : 'python3'), 'not an executable\n');  // 冒充系统 python：跑不出版本号
process.env.PATH = sysBin;
re.__resetRuntimeCache();
t('起点：python 解析到 system（不是 missing——所以旧逻辑根本不会去下载）', re.runtimeStatus().tools.python === 'system', JSON.stringify(re.runtimeStatus().tools));

process.env.DAGFLOW_RUNTIME_NO_DOWNLOAD = '1';
err = null;
try { await re.ensureTool('python'); } catch (e) { err = e; }
t('不兼容 + 禁止下载 → RUNTIME_VERSION_MISMATCH（不是 MISSING，且说清是哪份坏、坏在哪）', err?.code === 'RUNTIME_VERSION_MISMATCH' && /不兼容|无法执行/.test(String(err?.message)), `${err?.code}: ${String(err?.message).slice(0, 100)}`);
delete process.env.DAGFLOW_RUNTIME_NO_DOWNLOAD;
re.__resetRuntimeCache();

const dlBeforeC2 = dlCount();
const pyFix = await re.ensureTool('python', { log: (m) => console.log('   ' + m) });
t('不兼容 → 自动补下载，并改用新下的那份（source=user-cache、版本 3.12.x）', pyFix.source === 'user-cache' && existsSync(pyFix.exe) && String(pyFix.version).startsWith('3.12.'), JSON.stringify({ source: pyFix.source, version: pyFix.version, exe: pyFix.exe }));
t('补下载真的调了一次下载脚本（触发原因是"不兼容"，不是"缺失"）', dlCount() - dlBeforeC2 === 1, `下载次数=${dlCount() - dlBeforeC2}`);
process.env.PATH = work;   // 回到"没有系统工具"的 PATH，继续后面的下载用例

// ==================== D. 缺失 → 自动下载 → 校验 → 可用 ====================
console.log('== D. 缺失即自动下载，下完即用 ==');
const dlBefore = dlCount();
const py = await re.ensureTool('python');
t('python：可用（source=user-cache，已在上一段按"不兼容"补下载过）', py.source === 'user-cache' && existsSync(py.exe), JSON.stringify({ source: py.source, exe: py.exe }));
t('python：真探测到 3.12.x（兼容性校验真跑了，不是空过）', String(py.version).startsWith('3.12.'), py.version);
t('python：下载脚本收到了正确的命令行', readFileSync(logFile, 'utf8').includes(`--platform=${PLAT}`) && readFileSync(logFile, 'utf8').includes('--tools=python'));
t('python：总览里已变成 user-cache', re.runtimeStatus().tools.python === 'user-cache');

const py2 = await re.ensureTool('python');
process.env.DSH_RUNTIME_NO_CACHE = '1';                 // 关掉解析记忆化，逼它重新扫盘
const py3 = await re.ensureTool('python');
delete process.env.DSH_RUNTIME_NO_CACHE;
t('再调两次都不再下载（缓存已就位；记忆化关掉也一样）', py2.exe === py.exe && py3.exe === py.exe && dlCount() - dlBefore === 0, `下载次数=${dlCount() - dlBefore}`);

const bash = await re.ensureTool('bash');
t('bash：自动下载后可用', bash.source === 'user-cache' && /sh\.exe$/.test(bash.exe), JSON.stringify(bash));
const uv = await re.ensureTool('uv');
t('uv：自动下载后可用', uv.source === 'user-cache' && /uv\.exe$/.test(uv.exe), JSON.stringify(uv));
t('bash / uv 各下载一次，没有重复下载（python 已在上一段下过）', dlCount() - dlBefore === 2, `下载次数=${dlCount() - dlBefore}`);

// ==================== E. 真插件自带（不设覆盖） ====================
console.log('== E. 真插件自带（不设覆盖 ⇒ 走随包分发的那份） ==');
process.env.DAGFLOW_RUNTIME_BUNDLED_DIR = PLUGIN_ROOT;
delete process.env.DAGFLOW_RUNTIME_DOWNLOAD_SCRIPT;
process.env.PATH = realPath;
re.__resetRuntimeCache();
const st1 = re.runtimeStatus();
t('自带根 = 真插件目录', JSON.stringify(st1.bundledRoots) === JSON.stringify([PLUGIN_ROOT]), JSON.stringify(st1.bundledRoots));
t('本机三个运行时都解析到 bundled（自带优先，不是缓存/系统）', st1.tools.python === 'bundled' && st1.tools.bash === 'bundled' && st1.tools.uv === 'bundled', JSON.stringify(st1.tools));
const p3 = await re.ensureTool('python');
t('自带解释器通过兼容性校验且报告真实版本', p3.source === 'bundled' && String(p3.version).startsWith('3.12.'), `${p3.source} ${p3.version}`);
t('downloadScriptPath() 指向随包分发的下载脚本（真存在）', /download-runtime\.mjs$/.test(re.downloadScriptPath()) && existsSync(re.downloadScriptPath()), re.downloadScriptPath());

delete process.env.DAGFLOW_RUNTIME_BUNDLED_DIR;
re.__resetRuntimeCache();
const st2 = re.runtimeStatus();
t('清掉覆盖后不再用被覆盖的根（逃生舱只在本进程内生效）', !st2.bundledRoots.includes(emptyBundled) && !st2.bundledRoots.includes(PLUGIN_ROOT), JSON.stringify(st2.bundledRoots));

// ==================== F. 下载脚本：多源候选（纯函数） ====================
// 背景（2026-10-11 本机实测）：github.com **连不上**（TCP 都握不上手），所以"只试 GitHub"等于永远失败。
// 下载脚本现在会按序试多个源；这些纯函数决定顺序 —— 离线钉死，免得改坏。
console.log('== F. 下载脚本的多源候选 ==');
const dr = await import(pathToFileURL(join(PLUGIN_ROOT, 'scripts', 'download-runtime.mjs')).href);

const PY_GH = 'https://github.com/astral-sh/python-build-standalone/releases/download/20260901/cpython-3.12.14+20260901-x86_64-pc-windows-msvc-install_only_stripped.tar.gz';
const BASH_GH = 'https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.5/MinGit-2.55.0.5-64-bit.zip';
const UV_GH = 'https://github.com/astral-sh/uv/releases/download/0.12.10/uv-x86_64-pc-windows-msvc.zip';

t('python 的 GitHub 资产能映射到 npmmirror 镜像',
  dr.npmmirrorUrlFor(PY_GH) === 'https://registry.npmmirror.com/-/binary/python-build-standalone/20260901/cpython-3.12.14+20260901-x86_64-pc-windows-msvc-install_only_stripped.tar.gz', dr.npmmirrorUrlFor(PY_GH));
t('MinGit 也能映射到 npmmirror 镜像',
  dr.npmmirrorUrlFor(BASH_GH) === 'https://registry.npmmirror.com/-/binary/git-for-windows/v2.55.0.windows.5/MinGit-2.55.0.5-64-bit.zip', dr.npmmirrorUrlFor(BASH_GH));
t('uv 不映射镜像（npmmirror 实测没有 uv 二进制 → 交给 PyPI wheel）', dr.npmmirrorUrlFor(UV_GH) === null);
t('非 GitHub URL / 空值不硬映射', dr.npmmirrorUrlFor('') === null && dr.npmmirrorUrlFor('https://example.com/x') === null);

const pySources = dr.sourceListFor({ tool: 'python', githubUrl: PY_GH, format: 'tar.gz', mirror: '' });
t('python 源顺序：国内镜像 → GitHub 直连', pySources.map((s) => s.name).join('|') === 'npmmirror 国内镜像|GitHub 直连', pySources.map((s) => s.name).join('|'));
const pySourcesM = dr.sourceListFor({ tool: 'python', githubUrl: PY_GH, format: 'tar.gz', mirror: 'https://ghfast.top' });
t('自定义镜像插到最前面（前缀自动补 /）', pySourcesM[0].name.startsWith('自定义镜像') && pySourcesM[0].url === 'https://ghfast.top/' + PY_GH, pySourcesM[0].url);
const uvSources = dr.sourceListFor({ tool: 'uv', githubUrl: UV_GH, format: 'zip', mirror: '' });
t('uv 源顺序：PyPI wheel → GitHub 直连', uvSources.map((s) => s.name).join('|') === 'PyPI uv wheel|GitHub 直连', uvSources.map((s) => s.name).join('|'));
t('uv 的 wheel 源带 wheel 标记（走"从 wheel 里取 uv.exe"那条路）', uvSources[0].wheel === true);
t('bash 在 macOS/Linux 没有 URL 时源为空（用系统 bash，不白跑下载）', dr.sourceListFor({ tool: 'bash', githubUrl: null, format: 'system', mirror: '' }).length === 0);
t('★ 审计 A 回归锁：没有 GitHub 原 URL 时**也不套镜像前缀**（否则拼出 https://<镜像>/null 假源 → path.join(undefined) 崩）',
  dr.sourceListFor({ tool: 'bash', githubUrl: null, format: 'system', mirror: 'https://ghfast.top' }).length === 0
  && dr.sourceListFor({ tool: 'bash', githubUrl: null, format: 'system', mirror: 'https://ghfast.top' }).every((s) => !/null/.test(String(s.url))));

t('wheel 平台匹配：win_amd64 ✓ / macosx ✗',
  dr.wheelMatchScore('uv-0.12.10-py3-none-win_amd64.whl', 'win-x64') === 100 && dr.wheelMatchScore('uv-0.12.10-py3-none-macosx_11_0_arm64.whl', 'win-x64') === -1);
t('wheel 平台匹配：manylinux x86_64（压缩标签集）✓',
  dr.wheelMatchScore('uv-0.12.10-py3-none-manylinux_2_17_x86_64.manylinux2014_x86_64.whl', 'linux-x64') === 100);
t('wheel 平台匹配：musl 机器上 musllinux 优于 manylinux',
  dr.wheelMatchScore('uv-0.12.10-py3-none-musllinux_1_1_x86_64.whl', 'linux-musl-x64') > dr.wheelMatchScore('uv-0.12.10-py3-none-manylinux_2_17_x86_64.manylinux2014_x86_64.whl', 'linux-musl-x64'));
t('wheel 平台匹配：mac arm64 / x64 不串台',
  dr.wheelMatchScore('uv-0.12.10-py3-none-macosx_11_0_arm64.whl', 'mac-arm64') === 100 && dr.wheelMatchScore('uv-0.12.10-py3-none-macosx_11_0_arm64.whl', 'mac-x64') === -1);

const idx = dr.parseSimpleIndex(`
  <a href="uv-0.12.10-py3-none-win_amd64.whl#sha256=abc">uv-0.12.10-py3-none-win_amd64.whl</a>
  <a href="/packages/uv-0.12.10-py3-none-macosx_11_0_arm64.whl#sha256=def">uv-0.12.10-py3-none-macosx_11_0_arm64.whl</a>
  <a href="https://x/y/uv-0.12.10.tar.gz#sha256=eee">uv-0.12.10.tar.gz</a>`, 'https://pypi.org/simple/uv/');
t('简单索引解析：只认 wheel、去掉 #sha256、相对链接补全（根相对按 host 解析）',
  idx.length === 2 && idx[0].url === 'https://pypi.org/simple/uv/uv-0.12.10-py3-none-win_amd64.whl' && idx[1].url === 'https://pypi.org/packages/uv-0.12.10-py3-none-macosx_11_0_arm64.whl', JSON.stringify(idx));
const picks = dr.pickUvWheel(idx, 'win-x64', '0.12.10');
t('挑 wheel：命中 win 那颗、且版本对得上', picks?.filename === 'uv-0.12.10-py3-none-win_amd64.whl', JSON.stringify(picks));
t('挑 wheel：版本对不上就不挑（宁可不装，不装错版本）', dr.pickUvWheel(idx, 'win-x64', '9.9.9') === null);
t('挑 wheel：没有匹配平台就不挑', dr.pickUvWheel(idx, 'linux-arm64', '0.12.10') === null);

t('★ MinGit 布局锁定：completeness zip 解出来是根级 usr/bin/sh.exe',
  dr.PLATFORM_TARGETS['win-x64'].bash.bashExe === 'usr/bin/sh.exe', dr.PLATFORM_TARGETS['win-x64'].bash.bashExe);
t('单源超时短（换源比死等划算）', dr.SOURCE_TIMEOUT_MS > 0 && dr.SOURCE_TIMEOUT_MS <= 60000, String(dr.SOURCE_TIMEOUT_MS));
t('import 下载脚本不跑主流程（有 isMain 守卫）', typeof dr.main === 'undefined' && pass > 0);

// 收尾：清掉本次测试自己造的临时工作区（里面只有假缓存和假脚本）
try { rmSync(work, { recursive: true, force: true }); } catch { /* 忽略 */ }
console.log(`\n=== runtime-ensure：${pass} passed, ${fail} failed ===`);
console.log(`（隔离 home = ${ISOLATED_HOME}，临时工作区已清理）`);
if (fail) { console.log('失败项：' + failures.join(' / ')); process.exit(1); }
