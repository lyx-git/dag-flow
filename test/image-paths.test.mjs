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
import { mkdirSync, utimesSync } from 'node:fs';
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

console.log('== A. imagePathCandidates：相对路径的候选顺序（2026-10-20 起按运行目录）==');
{
  // ★ 2026-10-20 用户拍板「不用兼容旧位置数据，都删了」⇒ 图片只在各次运行目录里：
  //   相对路径的基准 = 「tmp/<工作流名>/<runId>/images/」（新的在前），外加一条相对 <DSH_HOME> 的兜底。
  const WF = '路径测试流';
  const runNew = join(HOME, '.dag-flow', 'tmp', WF, 'run-2', 'images');
  const runOld = join(HOME, '.dag-flow', 'tmp', WF, 'run-1', 'images');
  for (const [d, t] of [[runOld, 1000], [runNew, 2000]]) {
    mkdirSync(d, { recursive: true });
    utimesSync(d, new Date(t), new Date(t));
  }
  ok(imageDir().endsWith(join('.dag-flow', 'images')), 'A0. 旧图片目录常量仍可求值（仅作历史常量）');
  const bare = imagePathCandidates('chart.png', WF);
  eq(bare[0], join(runNew, 'chart.png'), 'A1. ★裸文件名 ⇒ 首选**最近一次运行**的 images/');
  eq(bare[1], join(runOld, 'chart.png'), 'A2. 其次按运行目录新→旧依次探测');
  ok(bare.includes(join(HOME, 'chart.png')), 'A2b. 仍保留一条相对 <DSH_HOME> 的兜底候选');

  // ★ 上游产物形态：relativePath = 「.dag-flow/tmp/<名>/<runId>/images/x.png」（相对 DSH_HOME）
  const up = imagePathCandidates('.dag-flow/tmp/' + WF + '/run-2/images/x.png', WF);
  ok(up.includes(join(HOME, '.dag-flow', 'tmp', WF, 'run-2', 'images', 'x.png')), 'A3. ★上游产物 relativePath 能落到真实文件（不再双层化）');
  ok(up.indexOf(join(HOME, '.dag-flow', 'tmp', WF, 'run-2', 'images', 'x.png')) > 0, 'A4. 且它是兜底候选（首选会 miss、后面命中）');

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
