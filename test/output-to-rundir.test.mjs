// test/output-to-rundir.test.mjs — 「产出类」落本次运行目录（2026-10-18 用户选「只搬产出类」）
//
// 契约：`saveAsset(filename, content, encoding?, dirOverride?)` / `downloadAsset(..., dirOverride?)` /
//   `saveImagesToLibrary(items, wfName?, dirOverride?)` —— 给了 dirOverride 就落那里（运行目录），
//   不给就退回旧位置（`.dag-flow/` 根、`images/<工作流名>/`），保证 CLI / 直跑行为不变。
//   `relativePath` 始终相对 `.dag-flow`（下游模板/读图靠它解析）。
import { tmpRoot } from './_tmp-root.mjs';
import { build } from 'esbuild';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.error(`  ✗ ${name}${detail ? '  —  ' + detail : ''}`); }
}

const ROOT = process.cwd();
const HOME = tmpRoot('output-rundir-');
process.env.DSH_HOME = HOME;

const ENTRY = join(tmpRoot('output-rundir-entry-'), 'entry.ts');
const { writeFileSync } = await import('node:fs');
writeFileSync(ENTRY, [
  `export { saveAsset, outputDir } from ${JSON.stringify(join(ROOT, 'src/adapter/assets.ts').replace(/\\/g, '/'))};`,
  `export { saveImagesToLibrary } from ${JSON.stringify(join(ROOT, 'src/adapter/image-library.ts').replace(/\\/g, '/'))};`,
  '',
].join('\n'));
// ★ bundle 落在「上两级 = 仓库根」的目录（runtime/插件根解析依赖 __dirname 相对层级）
const OUT = join(ROOT, 'tmp-test', 'build');
mkdirSync(OUT, { recursive: true });
const BUNDLE = join(OUT, 'output-rundir.bundle.mjs');
await build({
  entryPoints: [ENTRY], bundle: true, format: 'esm', platform: 'node', target: 'node20',
  outfile: BUNDLE,
  external: ['@deepseek-ai/cordis', 'node:fs', 'node:fs/promises', 'node:path', 'node:url', 'node:os', 'node:process', 'node:sqlite', 'node:child_process', 'node:crypto', 'node:stream', 'node:stream/promises'],
  logLevel: 'silent',
});
const { saveAsset, outputDir, saveImagesToLibrary } = await import(pathToFileURL(BUNDLE).href);

console.log('\n== ① 给了 dirOverride：产出落本次运行目录 ==');
{
  const runDir = join(HOME, '.dag-flow', 'tmp', 'wf', 'run-1');   // 与真实 ctx.runDir 同形
  mkdirSync(runDir, { recursive: true });
  const a = await saveAsset('报告.md', '# hi', 'utf8', runDir);
  t('absolutePath 在 runDir 下', a.absolutePath.startsWith(runDir), a.absolutePath);
  t('relativePath 指向本次运行目录（含 tmp/wf/run-1/）', a.relativePath.includes('tmp/wf/run-1/'), a.relativePath);
  t('文件真的写出来了', existsSync(a.absolutePath) && readFileSync(a.absolutePath, 'utf8') === '# hi');
}

console.log('\n== ② 不给 dirOverride：退回 .dag-flow 根（旧行为不变） ==');
{
  const b = await saveAsset('plain.txt', 'x', 'utf8');
  const dir = await outputDir();
  t('落在 .dag-flow 根目录', b.absolutePath.startsWith(dir), b.absolutePath);
  t('relativePath 不以 tmp/ 开头', !b.relativePath.startsWith('tmp/'), b.relativePath);
}

console.log('\n== ③ 抽图落 <runDir>/images/（给了 dirOverride） ==');
{
  const imgDir = join(HOME, '.dag-flow', 'tmp', 'wf', 'run-2', 'images');
  const items = [{ name: 'doc-1.png', bytes: Buffer.from([1, 2, 3]), mediaType: 'image/png' }];
  const saved = await saveImagesToLibrary(items, '某工作流', imgDir);
  t('返回 1 张', saved.length === 1, JSON.stringify(saved));
  t('path 在 runDir/images 下', String(saved[0]?.path).startsWith(imgDir), String(saved[0]?.path));
  t('文件真的写出来了', existsSync(String(saved[0]?.path)));
}

console.log('\n== ④ 抽图不给 dirOverride：退回 images/<工作流名>/ ==');
{
  const items = [{ name: 'doc-2.png', bytes: Buffer.from([9]), mediaType: 'image/png' }];
  const saved = await saveImagesToLibrary(items, '某工作流');
  t('path 含 images/<工作流名>/', /images[\\/]某工作流[\\/]/.test(String(saved[0]?.path)), String(saved[0]?.path));
}

console.log(`\n=== output-to-rundir: ${pass} passed, ${fail} failed ===`);
if (fail) { console.error('失败项：' + failures.join(' / ')); process.exit(1); }
