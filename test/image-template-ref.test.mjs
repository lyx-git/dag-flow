// test/image-template-ref.test.mjs — AI 节点怎么拿到「文档解析抽出来的图」（2026-10-21 用户提问的回归锁）
//
// 用户原话：「如果文档解析出来多个图片放到 images 下了，ai 节点要怎么填写路径才能拿到 images 文件夹下的图片，
//   毕竟 runid 是运行时生成，建工作流时，还没有」。
// 契约（本轮验证的三件事）：
//   ① 整串写 `{{doc.out.images}}` ⇒ 执行器**保持数组类型**（不是字符串化），元素仍是含 path 的对象；
//   ② 该数组直接作为 AI 节点 `images` 参数 ⇒ `parseImageList` 取每个元素的 path ⇒ 能真的读到字节；
//   ③ 手填裸文件名（chart.png）⇒ 在本工作流各次运行目录的 images/ 里按新→旧命中最新那份；找不到明确报错。
// 跑法：node test/image-template-ref.test.mjs
import { tmpRoot } from './_tmp-root.mjs';
import { useHomeAs } from './_isolate-home.mjs';
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.error(`  ✗ ${name}${detail ? '  —  ' + detail : ''}`); }
}

const ROOT = resolve(import.meta.dirname, '..');
const HOME = useHomeAs(tmpRoot('df-imgref-'));
const DF = join(HOME, '.dag-flow');
const WF = '图片引用测试流';

const ENTRY = join(tmpRoot('df-imgref-entry-'), 'entry.ts');
writeFileSync(ENTRY, [
  `export { resolveParams } from ${JSON.stringify(join(ROOT, 'src/executor/dataflow.ts').replace(/\\/g, '/'))};`,
  `export { parseImageList, loadImageInput, ImageInputError } from ${JSON.stringify(join(ROOT, 'src/adapter/image-inputs.ts').replace(/\\/g, '/'))};`,
  '',
].join('\n'));
const OUT = join(ROOT, 'tmp-test', 'build');
mkdirSync(OUT, { recursive: true });
const BUNDLE = join(OUT, 'image-template-ref.bundle.mjs');
await build({
  entryPoints: [ENTRY], bundle: true, format: 'esm', platform: 'node', target: 'node20', outfile: BUNDLE, logLevel: 'silent',
  external: ['@deepseek-ai/cordis', 'node:fs', 'node:fs/promises', 'node:path', 'node:url', 'node:os', 'node:process',
    'node:sqlite', 'node:child_process', 'node:crypto', 'node:stream', 'node:stream/promises', 'node:zlib',
    'node:http', 'node:https', 'node:events', 'node:buffer', 'node:util', 'node:timers', 'node:async_hooks'],
});
const { resolveParams, parseImageList, loadImageInput, ImageInputError } = await import(pathToFileURL(BUNDLE).href);

// 造一次「运行中」的现场：本次运行目录 + 两张抽出来的图
const runDir = join(DF, 'tmp', WF, 'run-1792327000000-abc');
const runImg = join(runDir, 'images');
mkdirSync(runImg, { recursive: true });
const PNG_A = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const PNG_B = Buffer.from([0x89, 0x50, 0x4e, 0x47, 4, 5, 6, 7]);
writeFileSync(join(runImg, '合同-1.png'), PNG_A);
writeFileSync(join(runImg, '合同-2.png'), PNG_B);

// doc_parse 节点真实输出形状（见 registry/nodes/doc.ts 的 landImages）
const docOut = {
  images: [
    { name: '合同-1.png', path: join(runImg, '合同-1.png'), mediaType: 'image/png', bytes: PNG_A.length, source: 'word/media/pic.png', reused: false },
    { name: '合同-2.png', path: join(runImg, '合同-2.png'), mediaType: 'image/png', bytes: PNG_B.length, source: 'word/media/pic2.png', reused: false },
  ],
  meta: { imageCount: 2, imageDir: runImg },
  text: '正文 [图片：合同-1.png]',
};
const ctx = { inputs: {}, vars: {}, results: { doc_img: { status: 'success', out: docOut } }, signal: undefined };

console.log('\n== ① `{{doc_img.out.images}}` 展开后仍是数组（保持类型） ==');
let expanded;
{
  const p = resolveParams({ images: '{{doc_img.out.images}}' }, ctx, 'ai1');
  expanded = p.images;
  t('结果是数组（不是 JSON 字符串）', Array.isArray(expanded), typeof expanded + ' / ' + String(expanded).slice(0, 80));
  t('两个元素都在', Array.isArray(expanded) && expanded.length === 2, String(expanded?.length));
  t('元素仍带 path 字段', Array.isArray(expanded) && typeof expanded[0]?.path === 'string', JSON.stringify(expanded?.[0] ?? null).slice(0, 120));
}

console.log('\n== ② 该数组直接作为 AI 节点 images 参数 ⇒ 解析出真实文件并读到字节 ==');
{
  const specs = parseImageList(expanded);
  t('解出 2 条 path 类型', specs.length === 2 && specs.every((s) => s.kind === 'path'), JSON.stringify(specs).slice(0, 160));
  const loaded = [];
  for (const s of specs) loaded.push(await loadImageInput(s, WF));
  t('两张都读到了字节', loaded.length === 2 && loaded.every((x) => x.data.length > 0), JSON.stringify(loaded.map((x) => x.data.length)));
  t('第一张内容与源文件一致', Buffer.from(loaded[0].data).equals(PNG_A), Buffer.from(loaded[0].data).toString('hex'));
  t('mediaType 正确', loaded.every((x) => x.mediaType === 'image/png'), JSON.stringify(loaded.map((x) => x.mediaType)));
}

console.log('\n== ③ 手填裸文件名 ⇒ 在各次运行目录里按新→旧命中 ==');
{
  // 再塞一次更旧的运行（同名文件、内容不同）——期望命中「较新」的那份（本次运行目录）
  const olderRun = join(DF, 'tmp', WF, 'run-1792326000000-old', 'images');
  mkdirSync(olderRun, { recursive: true });
  writeFileSync(join(olderRun, '合同-1.png'), Buffer.from([9, 9, 9]));
  const oldT = (Date.now() - 600_000) / 1000;
  const fs = await import('node:fs');
  fs.utimesSync(join(olderRun, '合同-1.png'), oldT, oldT);

  const one = await loadImageInput({ kind: 'path', value: '合同-1.png' }, WF);
  t('裸文件名能命中（取最新的那份）', Buffer.from(one.data).equals(PNG_A), Buffer.from(one.data).toString('hex'));

  let code = '';
  try { await loadImageInput({ kind: 'path', value: '不存在-9.png' }, WF); } catch (e) { code = e?.code ?? String(e); }
  t('找不到时明确报 IMAGE_NOT_FOUND（不静默丢图）', code === 'IMAGE_NOT_FOUND', code);
}

console.log(`\n=== image-template-ref: ${pass} passed, ${fail} failed ===`);
if (fail) { console.error('失败项：' + failures.join(' / ')); process.exit(1); }
