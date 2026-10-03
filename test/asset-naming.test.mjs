// test/asset-naming.test.mjs — 产出文件同名冲突策略（2026-10-03 用户拍板**方案 A：默认自动改名不覆盖**）
//   用户原话：「文件保存节点，如果保存的时候，文件夹下已经存在一份相同的文件，需要给我解决方案」
//   契约：同名 → `报告.md` / `报告-2.md` / `报告-3.md`…（保留历史、不静默覆盖、不让 DAG 节点失败）；
//         返回的 path/absolutePath 是**实际写入**的那个；子目录与无扩展名同样适用。
// 手段：esbuild 打包 src/adapter/assets.ts → 在临时工作区里真写文件 → 断言磁盘现状。
import { build } from 'esbuild';
import { mkdtempSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}（actual=${JSON.stringify(a)} expected=${JSON.stringify(b)}）`);

// 临时工作区：storage 的解析链会落到 process.cwd()（不污染真实工作区）
const ws = mkdtempSync(join(tmpdir(), 'df-asset-name-'));
process.chdir(ws);

const dir = mkdtempSync(join(tmpdir(), 'df-asset-bundle-'));
const OUT = join(dir, 'assets.mjs');
await build({
  entryPoints: ['src/adapter/assets.ts'],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent',
});
const { saveAsset, downloadAsset } = await import(pathToFileURL(OUT).href);

const read = (rel) => readFileSync(join(ws, rel), 'utf8');

console.log('== A. 文本保存：同名自动改名、绝不覆盖 ==');
{
  const a = await saveAsset('报告.md', '第一份', 'utf8');
  ok(existsSync(join(ws, '.dag-flow', '报告.md')), 'A1. 首次保存 → 报告.md');
  ok(a.relativePath.endsWith('报告.md'), `A2. 返回值是实际路径（${a.relativePath}）`);
  ok(a.absolutePath.endsWith('报告.md'), 'A3. absolutePath 同步（邮件节点靠它找文件）');

  const b = await saveAsset('报告.md', '第二份', 'utf8');
  ok(existsSync(join(ws, '.dag-flow', '报告-2.md')), 'A4. 再次同名 → 报告-2.md');
  eq(read('.dag-flow/报告.md'), '第一份', 'A5. 旧文件内容**没有被覆盖**（方案 A 的核心）');
  eq(read('.dag-flow/报告-2.md'), '第二份', 'A6. 新内容写进 -2.md');
  ok(b.absolutePath.endsWith('报告-2.md'), 'A7. 返回的是实际写入的路径（-2.md）');

  const c = await saveAsset('报告.md', '第三份', 'utf8');
  ok(c.absolutePath.endsWith('报告-3.md'), 'A8. 第三次 → 报告-3.md（序号递增）');
}

console.log('== B. 子目录 / 无扩展名 / 二进制 ==');
{
  await saveAsset('reports/日报-2026-10-03.md', 'x1', 'utf8');
  const b2 = await saveAsset('reports/日报-2026-10-03.md', 'x2', 'utf8');
  ok(b2.absolutePath.endsWith(join('reports', '日报-2026-10-03-2.md')) || b2.absolutePath.endsWith('reports/日报-2026-10-03-2.md'),
    `B1. 子目录内同名也改名（${b2.absolutePath.split('.dag-flow').pop()}）`);

  await saveAsset('noext', 'a');
  const b3 = await saveAsset('noext', 'b');
  ok(b3.absolutePath.endsWith('noext-2'), `B2. 无扩展名 → noext-2（${b3.absolutePath.split('.dag-flow').pop()}）`);

  await saveAsset('bin.dat', new Uint8Array([1, 2, 3]));
  const b4 = await saveAsset('bin.dat', new Uint8Array([4, 5]));
  ok(b4.absolutePath.endsWith('bin.dat-2') || b4.absolutePath.endsWith('bin-2.dat'),
    `B3. 二进制同样改名（${b4.absolutePath.split('.dag-flow').pop()}）`);
}

console.log('== C. 下载类产物同样适用（方案 A 覆盖两条写入路径）==');
{
  const d1 = await downloadAsset('data:text/plain,hello', 'dl.txt');
  ok(existsSync(join(ws, '.dag-flow', 'dl.txt')), 'C1. data: URL 下载落盘 dl.txt');
  const d2 = await downloadAsset('data:text/plain,again', 'dl.txt');
  ok(d2.absolutePath.endsWith('dl-2.txt'), `C2. 同名再次下载 → dl-2.txt（${d2.absolutePath.split('.dag-flow').pop()}）`);
  eq(read('.dag-flow/dl.txt'), 'hello', 'C3. 第一份下载内容保留');
}

console.log('== D. 文件名净化与路径穿越（既有安全语义未变）==');
{
  const s = await saveAsset('../evil.md', 'x');
  ok(!s.absolutePath.includes('..'), 'D1. ../ 被净化，仍在 .dag-flow 内');
  // 净化后与已存在的同名文件再次冲突 → 照样加序号而不是覆盖
  const s2 = await saveAsset('../evil.md', 'y');
  ok(s2.absolutePath !== s.absolutePath, 'D2. 净化后的同名同样走改名');
}

console.log('== E. 目标目录里文件数符合预期（每份都在）==');
{
  const names = readdirSync(join(ws, '.dag-flow'));
  ok(names.includes('报告.md') && names.includes('报告-2.md') && names.includes('报告-3.md'),
    `E1. 三份报告都在磁盘上（${names.filter((n) => n.startsWith('报告')).join(', ')}）`);
}

console.log(`\n=== 产出文件同名策略（方案 A）：${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
