import './_isolate-home.mjs';   // 保险起见与全仓一致（本文件只测纯函数、不落盘）
// test/open-folder-sub.test.mjs — 「数据存于 … → 打开文件夹」的**子目录解析守卫**（2026-10-11）
//
// 背景：⏰ 定时任务 / 🧾 运行日志 / 🕘 历史版本 三个弹窗都能点一行打开 `<DSH_HOME>/.dag-flow` 下的
//   对应目录（schedules.json 在根、运行记录在 runs/、版本在 workflow/versions/<名>/）。
//   `/api/dag-flow/open-folder` 因此接受可选 body `{ sub }` —— **必须**保证它只能开 .dag-flow 内部，
//   绝不允许 `../` 穿越或绝对路径（那等于给了一个"打开任意系统目录"的口子）。
// 手段：esbuild 即时打包 src/adapter/workspace.ts → 断言纯函数 resolveDagFlowSub 的边界。
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

const ROOT = process.cwd();
const outDir = mkdtempSync(join(tmpdir(), 'df-opensub-'));
const OUT = join(outDir, 'ws.mjs');
await build({
  entryPoints: [join(ROOT, 'src/adapter/workspace.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile: OUT,
  external: ['@deepseek-ai/cordis', 'node:fs', 'node:path', 'node:url', 'node:os', 'node:process', 'node:sqlite'],
  logLevel: 'silent',
});
const { resolveDagFlowSub } = await import(pathToFileURL(OUT).href);

// 纯路径逻辑，不碰磁盘：随便给一个绝对目录当「.dag-flow 根」
const BASE = resolve(ROOT, 'fake-home', '.dag-flow');
const inside = (p) => typeof p === 'string' && resolve(p).startsWith(resolve(BASE) + sep);

console.log('== A. 正常子目录（三个弹窗真实用到的） ==');
t('A1 空串 → .dag-flow 根本身（dock 按钮的既有语义）', resolveDagFlowSub(BASE, '') === BASE, String(resolveDagFlowSub(BASE, '')));
t('A2 undefined → 根（旧客户端不带 body 也不受影响）', resolveDagFlowSub(BASE, undefined) === BASE);
t('A3 null → 根', resolveDagFlowSub(BASE, null) === BASE);
t('A4 空白串 → 根', resolveDagFlowSub(BASE, '   ') === BASE);
t("A5 'runs'（运行日志弹窗）→ <根>/runs", resolveDagFlowSub(BASE, 'runs') === join(BASE, 'runs'), String(resolveDagFlowSub(BASE, 'runs')));
t('A6 多级 + 中文（历史版本弹窗）→ <根>/workflow/versions/金融政策日报',
  resolveDagFlowSub(BASE, 'workflow/versions/金融政策日报') === join(BASE, 'workflow', 'versions', '金融政策日报'));
t("A7 './runs' 同样解析到位", resolveDagFlowSub(BASE, './runs') === join(BASE, 'runs'));
t("A8 'runs/' 尾斜杠不影响", resolveDagFlowSub(BASE, 'runs/') === join(BASE, 'runs'));
t("A9 'runs/../logs' 归一化后仍在内部 → 允许（结果 = <根>/logs）",
  resolveDagFlowSub(BASE, 'runs/../logs') === join(BASE, 'logs'), String(resolveDagFlowSub(BASE, 'runs/../logs')));

console.log('\n== B. 越界一律拦下（安全红线：不许开 .dag-flow 之外的目录） ==');
t("B1 '../outside' → null", resolveDagFlowSub(BASE, '../outside') === null);
t("B2 '..' → null", resolveDagFlowSub(BASE, '..') === null);
t("B3 'a/../../b' → null", resolveDagFlowSub(BASE, 'a/../../b') === null);
t("B4 '..' + 分隔符 + 'runs'（Windows 反斜杠写法）→ null", resolveDagFlowSub(BASE, `..${sep}runs`) === null);
t('B5 绝对路径 → null（不给"打开任意系统目录"的口子）', resolveDagFlowSub(BASE, resolve(ROOT)) === null);
t('B6 Windows 盘符绝对路径 → null', resolveDagFlowSub(BASE, 'C:\\Windows') === null || process.platform !== 'win32');
t("B7 'workflow/../../../..' → null", resolveDagFlowSub(BASE, 'workflow/../../../..') === null);

console.log('\n== C. 返回值的形状契约 ==');
t('C1 任何非 null 结果都在 .dag-flow 内部', ['runs', 'logs', 'workflow', 'workflow/versions/x', 'tmp', '']
  .every((s) => { const r = resolveDagFlowSub(BASE, s); return r !== null && (resolve(r) === resolve(BASE) || inside(r)); }));
t('C2 结果是绝对路径', typeof resolveDagFlowSub(BASE, 'runs') === 'string' && resolve(resolveDagFlowSub(BASE, 'runs')) === resolve(join(BASE, 'runs')));

console.log(`\n=== open-folder-sub: ${pass} passed, ${fail} failed ===`);
if (fail > 0) { for (const f of failures) console.log(`  FAIL: ${f}`); process.exit(1); }
