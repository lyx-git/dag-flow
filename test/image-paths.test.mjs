// test/image-paths.test.mjs — 图片输入的路径候选 + doc_parse 的 `[图片 #N]` 洗白（2026-10-17）
//   背景（独立代码审查报的两条真缺陷，均已核实）：
//   ① 上游节点产物（如 image_generate）的 `path`/`relativePath` 是**相对 <DSH_HOME>** 的
//      `.dag-flow/images/x.png`（adapter/assets.ts 用 path.relative(DSH_HOME, file)），而读侧只按
//      **统一图片目录** 拼 ⇒ 变成 `.dag-flow/images/.dag-flow/images/x.png` ⇒ 官方推荐的
//      `{{img.out.images}}` 传图必 IMAGE_NOT_FOUND（且 path 优先于可用的 url）。
//   ② `extractImages: off`（UI 下拉「关」）时文本里仍留着 `[图片 #N]` 占位 —— 指向不存在的文件。
//   两者都落在纯函数上，故在此直接锁住（无 IO/无 React/无 CDP）。
import { tmpRoot } from './_tmp-root.mjs';
import { build } from 'esbuild';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// DSH_HOME 指到临时目录 ⇒ 期望路径可预测（paths.ts 每次调用求值）
const HOME = tmpRoot('df-imgpaths-home-');
process.env.DSH_HOME = HOME;

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}（actual=${JSON.stringify(a)} expected=${JSON.stringify(b)}）`);

const dir = tmpRoot('df-imgpaths-');
const outInputs = join(dir, 'imageInputs.mjs');
const outDoc = join(dir, 'docExtract.mjs');
await build({ entryPoints: ['src/adapter/image-inputs.ts'], bundle: true, format: 'esm', platform: 'node', outfile: outInputs, logLevel: 'silent' });
await build({ entryPoints: ['src/registry/doc-extract.ts'], bundle: true, format: 'esm', platform: 'node', outfile: outDoc, logLevel: 'silent' });
const { imagePathCandidates, imageDir } = await import(pathToFileURL(outInputs).href);
const { stripImageMarks } = await import(pathToFileURL(outDoc).href);

console.log('== A. imagePathCandidates：相对路径的候选顺序（修 ①）==');
{
  const imgDir = imageDir();
  ok(imgDir.endsWith(join('.dag-flow', 'images')), `A0. 统一图片目录 = ${imgDir}`);
  const bare = imagePathCandidates('chart.png');
  eq(bare[0], join(imgDir, 'chart.png'), 'A1. 裸文件名 ⇒ 首选统一图片目录');
  eq(bare.length, 2, 'A2. 裸文件名还有 <DSH_HOME> 兜底候选（去重后共 2 个）');

  // ★ 修复点：上游产物形态 —— 第二个候选必须正好指向真实文件
  const up = imagePathCandidates('.dag-flow/images/x.png');
  eq(up[1], join(HOME, '.dag-flow', 'images', 'x.png'), 'A3. ★`.dag-flow/images/x.png`（上游产物 relativePath）⇒ 候选里有正确路径（不再双层化）');
  eq(up[0], join(imgDir, '.dag-flow', 'images', 'x.png'), 'A4. 且它仍是第一候选之外的兜底——首选会 miss、第二个命中');

  eq(imagePathCandidates('/tmp/a.png'), ['/tmp/a.png'], 'A5. 绝对路径 ⇒ 原样唯一候选');
  const win = imagePathCandidates('C:\\pics\\a.png');
  eq(win, ['C:\\pics\\a.png'], 'A6. Windows 绝对路径 ⇒ 原样唯一候选');
}

console.log('== B. stripImageMarks：洗掉 `[图片 #N]` 占位（修 ②）==');
{
  eq(stripImageMarks('前文\n[图片 #1]\n后文'), '前文\n后文', 'B1. 独占一行的占位被整行洗掉');
  eq(stripImageMarks('图前文字 [图片 #2]'), '图前文字', 'B2. 行尾占位连同前导空格一起洗掉');
  eq(stripImageMarks('[图片 #1] [图片 #2]'), '', 'B3. 只有占位 ⇒ 洗成空串');
  eq(stripImageMarks('没有任何标记的正文'), '没有任何标记的正文', 'B4. 无标记时原样返回');
  ok(!stripImageMarks('a\n[图片 #3]\n\n\n\nb').includes('[图片 #'), 'B5. ★洗完后不含任何占位');
  eq(stripImageMarks('a\n[图片 #3]\n\n\n\nb'), 'a\n\nb', 'B6. 连续空行被压成一段（不留大洞）');
  // ★ 2026-10-17（独立审查报的 D1）：**无占位时不做任何空白规整** —— 否则解析普通 .md/.txt 也会把
  //   Markdown 硬换行（行尾两空格）、连续空行、首尾缩进一起改掉，属超出"洗掉假地址"目标的行为变更。
  const plain = 'line one  \n\n\n\nline two \t\n  缩进行\n';
  eq(stripImageMarks(plain), plain, 'B7. ★无占位文本原样返回（不删行尾空格 / 不压空行 / 不 trim）');
}

console.log(`\n结果：${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
