// test/image-inputs.test.mjs — AI 节点 `images` 参数的解析与载入契约（2026-10-16 P1 多模态传图）
//   锁两件事：①**规范化规则**（2026-10-15 用户拍板：容忍数组/对象、只 trim+跳空行、四种扩展名、
//   相对路径锚定统一图片目录 <DSH_HOME>/.dag-flow/images/、≤20 张）；②**非法项必须明确报错**（绝不静默丢图——
//   否则用户以为图发出去了）。上限常量与 2026-10-16 真机启动诊断实测值对齐（20 张 / 20MB）。
//   手段：esbuild 即时打包 src/adapter/image-inputs.ts（零依赖，仅 node 内置）→ 断言纯函数 + IO。
import './_isolate-home.mjs';   // 隔离 DSH_HOME（resolveImagePath 的相对基准），绝不碰真机数据根
import { tmpRoot } from './_tmp-root.mjs';
import { build } from 'esbuild';
import { mkdirSync, writeFileSync, truncateSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}（actual=${JSON.stringify(a)} expected=${JSON.stringify(b)}）`);

const ROOT = join(import.meta.dirname, '..');
const dir = join(ROOT, 'tmp-test', 'build', 'image-inputs');
mkdirSync(dir, { recursive: true });
const OUT = join(dir, 'image-inputs.mjs');
await build({
  entryPoints: [join(ROOT, 'src/adapter/image-inputs.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent',
});
const {
  IMAGE_MAX_COUNT, IMAGE_MAX_BYTES, ImageInputError,
  collectImageEntries, mediaTypeOf, parseImageList, resolveImagePath, imageDir, loadImageInput, loadImageInputs, listImageFiles, countImageEntries,
} = await import(pathToFileURL(OUT).href);

console.log('== A. 上限常量与宿主真机限制对齐（2026-10-16 启动诊断实测）==');
eq(IMAGE_MAX_COUNT, 20, 'A1. 每消息最多 20 张');
eq(IMAGE_MAX_BYTES, 20971520, 'A2. 单图最多 20971520 字节（20MB）');

console.log('== B. collectImageEntries：字符串/数组/对象三种形态 ==');
{
  eq(collectImageEntries('a.png\nb.png'), ['a.png', 'b.png'], 'B1. 字符串按行切');
  eq(collectImageEntries('a.png\r\nb.png'), ['a.png', 'b.png'], 'B2. CRLF 也切得对（Windows 写的文件名）');
  eq(collectImageEntries(['a.png', ['b.png', { path: 'c.png' }]]), ['a.png', 'b.png', 'c.png'], 'B3. ★数组递归（上游 image_generate.out.images 就是数组）');
  eq(collectImageEntries({ path: 'p.png', url: 'u.png' }), ['p.png'], 'B4. 对象优先取 path');
  eq(collectImageEntries({ url: 'u.png', file: 'f.png' }), ['u.png'], 'B5. 没有 path 时取 url');
  eq(collectImageEntries({ file: 'f.png' }), ['f.png'], 'B6. 再退到 file');
  eq(collectImageEntries(null), [], 'B7. null → 空');
  eq(collectImageEntries(123), [], 'B8. 非字符串标量 → 空（不猜）');
}

console.log('== C. mediaTypeOf：只认宿主那四种 ==');
{
  eq(mediaTypeOf('a.png'), 'image/png', 'C1. png');
  eq(mediaTypeOf('a.JPG'), 'image/jpeg', 'C2. 大写扩展名 + jpg');
  eq(mediaTypeOf('a.jpeg'), 'image/jpeg', 'C3. jpeg');
  eq(mediaTypeOf('a.webp'), 'image/webp', 'C4. webp');
  eq(mediaTypeOf('a.gif'), 'image/gif', 'C5. gif');
  eq(mediaTypeOf('https://x.com/a.png?token=1'), 'image/png', 'C6. ★URL 带 query 仍能认出（取 pathname 的扩展名）');
  eq(mediaTypeOf('a.bmp'), null, 'C7. bmp 不在宿主白名单 → null');
  eq(mediaTypeOf('a'), null, 'C8. 没扩展名 → null');
}

console.log('== D. parseImageList：归一化 + 非法项明确报错 ==');
{
  const list = parseImageList('  a.png \n\n b.jpg  \n');
  eq(list.map((x) => x.value), ['a.png', 'b.jpg'], 'D1. trim + 跳空行');
  eq(list.map((x) => x.kind), ['path', 'path'], 'D2. 本地路径 kind=path');
  eq(parseImageList('https://x.com/a.png').map((x) => x.kind), ['url'], 'D3. http(s) kind=url');
  eq(parseImageList('').length, 0, 'D4. 空串 → 空列表（= 纯文本调用）');
  eq(parseImageList(undefined).length, 0, 'D5. undefined → 空列表');
  eq(parseImageList(Array.from({ length: IMAGE_MAX_COUNT }, (_, i) => `x${i}.png`)).length, IMAGE_MAX_COUNT, 'D6. 正好 20 张通过（边界内）');

  const tooMany = (() => { try { parseImageList(Array.from({ length: IMAGE_MAX_COUNT + 1 }, (_, i) => `x${i}.png`)); return null; } catch (e) { return e; } })();
  ok(tooMany instanceof ImageInputError && tooMany.code === 'IMAGE_TOO_MANY', `D7. ★21 张明确报错 IMAGE_TOO_MANY（实际 ${tooMany?.code}）`);

  const badExt = (() => { try { parseImageList('note.txt'); return null; } catch (e) { return e; } })();
  ok(badExt instanceof ImageInputError && badExt.code === 'IMAGE_UNSUPPORTED_TYPE', `D8. ★非白名单格式明确报错 IMAGE_UNSUPPORTED_TYPE（实际 ${badExt?.code}）`);
  ok(!!badExt && badExt.message.includes('note.txt') && badExt.message.includes('png'), 'D9. 报错文案带上"是哪一条"与允许的格式（用户能自己改）');
}

console.log('== E. resolveImagePath：相对路径锚定本工作流最近一次运行的 images/ ==');
{
  const home = process.env.DSH_HOME;
  ok(!!home, 'E1. 隔离 home 已就绪（_isolate-home）');
  // ★ 2026-10-20 用户拍板「不用兼容旧位置数据」⇒ 图片只在运行目录里，基准 = 最近一次运行的 images/
  const WF = '解析测试流';
  const runImg = join(home, '.dag-flow', 'tmp', WF, 'run-77', 'images');
  mkdirSync(runImg, { recursive: true });
  const abs = resolveImagePath('sub/a.png', WF);
  eq(abs, join(runImg, 'sub', 'a.png'), 'E2. ★相对路径以本次运行产出的 images/ 为基准');
  eq(resolveImagePath('chart.png', WF), join(runImg, 'chart.png'), 'E2b. 裸文件名 ⇒ 运行目录的 images/ 下直接找（用户最省事的写法）');
  eq(imageDir(), join(home, '.dag-flow', 'images'), 'E2c. imageDir() 仍是旧图片目录常量（只作历史常量保留，不再写入）');
  const winAbs = join(home, 'abs.png');
  eq(resolveImagePath(winAbs, WF), winAbs, 'E3. 绝对路径原样使用');
}

console.log('== F. loadImageInput：本地读 / 不存在 / 超限 ==');
{
  const ws = tmpRoot('df-imginput-');
  const good = join(ws, 'ok.png');
  writeFileSync(good, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]));   // 假 PNG 头 + 几字节
  const r = await loadImageInput({ kind: 'path', value: good });
  eq(r.data.byteLength, 8, 'F1. 读出真实字节数');
  eq(r.mediaType, 'image/png', 'F2. mediaType 由扩展名决定');
  eq(r.name, 'ok.png', 'F3. name = basename');

  const missing = await loadImageInput({ kind: 'path', value: join(ws, 'nope.png') }).then(() => null, (e) => e);
  ok(missing instanceof ImageInputError && missing.code === 'IMAGE_NOT_FOUND', `F4. ★文件不存在明确报错（实际 ${missing?.code}）`);

  const big = join(ws, 'big.png');
  writeFileSync(big, Buffer.alloc(1));
  truncateSync(big, IMAGE_MAX_BYTES + 1);                                  // 稀疏文件，秒建
  const tooBig = await loadImageInput({ kind: 'path', value: big }).then(() => null, (e) => e);
  ok(tooBig instanceof ImageInputError && tooBig.code === 'IMAGE_TOO_LARGE', `F5. ★超过 20MB 明确报错（实际 ${tooBig?.code}）`);

  const batch = await loadImageInputs([{ kind: 'path', value: good }, { kind: 'path', value: good }]);
  eq(batch.length, 2, 'F6. 批量保序返回（同一张图写两行 = 两张，不去重）');
}

console.log('== G. listImageFiles：统一图片目录清单（「🖼 选图」弹窗的数据源）==');
{
  // ★ 2026-10-20：清单只扫「tmp/<工作流名>/<runId>/images/」（旧 images/<名>/ 不再参与）
  const WF = '清单测试流';
  eq((await listImageFiles(WF)).length, 0, 'G1. 还没跑过 ⇒ 空清单（不是错误）');
  const dir = join(process.env.DSH_HOME, '.dag-flow', 'tmp', WF, 'run-1', 'images');
  mkdirSync(dir, { recursive: true });
  eq((await listImageFiles(WF)).length, 0, 'G1b. 空目录 ⇒ 空清单');
  writeFileSync(join(dir, 'a.png'), Buffer.from([1, 2, 3]));
  writeFileSync(join(dir, 'b.JPG'), Buffer.alloc(2048));       // 扩展名大小写不敏感
  writeFileSync(join(dir, 'note.txt'), Buffer.from('x'));      // 非图片：不收
  writeFileSync(join(dir, '.hidden.png'), Buffer.from('x'));   // 隐藏文件：不收
  mkdirSync(join(dir, 'sub'), { recursive: true });            // 子目录：不收（第一版只列根目录）
  writeFileSync(join(dir, 'sub', 'c.png'), Buffer.from('x'));
  utimesSync(join(dir, 'a.png'), new Date(1000), new Date(1000));
  utimesSync(join(dir, 'b.JPG'), new Date(2000), new Date(2000));
  const list = await listImageFiles(WF);
  eq(list.map((i) => i.name), ['b.JPG', 'a.png'], 'G2. ★只收白名单扩展名、跳过隐藏文件与子目录，且按修改时间倒序（新图排最前）');
  eq(list[1].bytes, 3, 'G3. 带文件字节数（弹窗显示大小）');
  ok(typeof list[1].mtime === 'number' && list[1].mtime > 0, 'G4. 带 mtime（弹窗显示时间 + 排序依据）');
}

console.log('== H. countImageEntries：配图模态预检用的"数条数"（★ P2 不静默降级）==');
{
  eq(countImageEntries(undefined), 0, 'H1. 没写 images ⇒ 0 条');
  eq(countImageEntries(''), 0, 'H2. 空串 ⇒ 0 条');
  eq(countImageEntries('  \n \n'), 0, 'H3. 只有空行/空格 ⇒ 0 条');
  eq(countImageEntries('a.png\nb.png'), 2, 'H4. 两行 ⇒ 2 条');
  eq(countImageEntries('a.png\r\nb.png\r\n'), 2, 'H5. CRLF + 尾随换行 ⇒ 2 条');
  eq(countImageEntries(['a.png', 'b.png']), 2, 'H6. 数组 ⇒ 2 条（上游 {{img.out.images}} 那种）');
  eq(countImageEntries([{ path: 'a.png' }, { url: 'https://x/b.png' }]), 2, 'H7. 对象元素取 path/url ⇒ 2 条');
  eq(countImageEntries('note.txt'), 1, 'H8. ★ 数条数**不看格式**（非法项交给 parseImageList 报错），仍算 1 条');
}

console.log(`\n=== images 参数契约：${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
