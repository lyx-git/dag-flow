// test/out-fields.test.mjs — 变量面板「按真实运行输出反推字段」的抽取逻辑单测（2026-10-03）
// 手段：esbuild 即时打包 src/client/outFields.ts → 临时 mjs → 断言（纯函数，无 React/无 IO）
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}（actual=${JSON.stringify(a)} expected=${JSON.stringify(b)}）`);

const dir = mkdtempSync(join(tmpdir(), 'df-out-fields-'));
const OUT = join(dir, 'outFields.mjs');
await build({
  entryPoints: ['src/client/outFields.ts'],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent',
});
const { fieldsFromValue, sampleOf, kindOf } = await import(pathToFileURL(OUT).href);

const paths = (r) => r.fields.map((f) => f.path);

console.log('== A. 标量 / 空值：不给字段（只该整取引用）==');
eq(paths(fieldsFromValue('hello')), [], 'A1. 字符串输出 → 无字段');
eq(paths(fieldsFromValue(42)), [], 'A2. 数字输出 → 无字段');
eq(paths(fieldsFromValue(false)), [], 'A3. 布尔输出 → 无字段');
eq(paths(fieldsFromValue(null)), [], 'A4. null 输出 → 无字段');
eq(paths(fieldsFromValue({})), [], 'A5. 空对象 → 无字段');
eq(paths(fieldsFromValue([])), [], 'A6. 空数组 → 无字段');

console.log('== B. 对象 / 嵌套：给点路径 + 类型 + 样例 ==');
{
  const r = fieldsFromValue({ status: 200, body: { count: 3, list: [1, 2] } });
  eq(paths(r), ['status', 'body', 'body.count', 'body.list'], 'B1. 逐层展开到 maxDepth（status/body/body.count/body.list）');
  eq(r.fields[0], { path: 'status', kind: 'number', sample: '200' }, 'B2. 字段带 kind + sample');
  eq(r.fields[3].kind, 'array', 'B3. 数组字段 kind=array');
  eq(r.fields[3].sample, '[2 项]', 'B4. 数组样例显示项数');
}

console.log('== C. 数组只展开第 1 个元素（对应 {{id.out.results.0.url}} 写法）==');
{
  const out = { results: [{ title: '标题A', url: 'https://a.example', snippet: '摘要' }, { title: '标题B' }], count: 2 };
  const r = fieldsFromValue(out);
  eq(paths(r), ['results', 'results.0.title', 'results.0.url', 'results.0.snippet', 'count'],
    'C1. 只展开第 1 个元素的键（不展开第 2 个）');
  eq(r.fields.find((f) => f.path === 'results.0.url').sample, 'https://a.example', 'C2. 深层字段带样例值');
  eq(paths(fieldsFromValue({ list: [1, 2, 3] })), ['list'], 'C3. 元素是标量的数组不展开');
}

console.log('== D. 用户自定义 / 动态键：真跑过才能知道有哪些键，抽出来即可用 ==');
{
  const r = fieldsFromValue({ topic: 'AI 日报', words: 3, 主题: '技术简报' });
  eq(paths(r), ['topic', 'words', '主题'], 'D1. set_var 风格的键全抽出来（含中文键）');
  eq(r.fields[0].sample, 'AI 日报', 'D2. 自定义值给样例');
  const merge = fieldsFromValue({ py_gate: '{"ok":true}', http1: { status: 200 } });
  eq(paths(merge), ['py_gate', 'http1', 'http1.status'], 'D3. merge 风格（键=上游节点 id）也能抽');
}

console.log('== E. 无法引用的键名要跳过并计数（否则复制过去解析失败）==');
{
  const r = fieldsFromValue({ 'a.b': 1, 'x y': 2, ok: 3, '[k]': 4, 'k{k}': 5 });
  eq(paths(r), ['ok'], 'E1. 含点/空白/方括号/花括号的键不进字段');
  eq(r.skipped.sort(), ['a.b', 'k{k}', 'x y', '[k]'].sort(), 'E2. 被跳过的键路径记进 skipped（面板可提示）');
}

console.log('== F. 上限与深度：面板不能被大对象撑爆 ==');
{
  const big = {};
  for (let i = 0; i < 60; i++) big['k' + i] = i;
  const r = fieldsFromValue(big);
  ok(r.fields.length <= 30, 'F1. 默认最多 30 条（实际 ' + r.fields.length + '）');
  const custom = fieldsFromValue(big, { maxFields: 5 });
  ok(custom.fields.length === 5, 'F2. maxFields 可调（实际 ' + custom.fields.length + '）');
  const deep = fieldsFromValue({ a: { b: { c: { d: 1 } } } });
  eq(paths(deep), ['a', 'a.b', 'a.b.c'], 'F3. 默认只到第 3 层（a.b.c，不含 a.b.c.d）');
  const deeper = fieldsFromValue({ a: { b: { c: { d: 1 } } } }, { maxDepth: 5 });
  eq(paths(deeper), ['a', 'a.b', 'a.b.c', 'a.b.c.d'], 'F4. maxDepth 可调');
}

console.log('== G. sampleOf / kindOf 预览口径 ==');
eq(sampleOf('x'.repeat(80)).endsWith('…'), true, 'G1. 长字符串截断加省略号');
eq(sampleOf('  a\n b  '), 'a b', 'G2. 多行/多余空白折叠成一行');
eq(sampleOf(''), '（空字符串）', 'G3. 空串有明确文案');
eq(sampleOf({ a: 1, b: 2 }), '{2 个键}', 'G4. 对象样例给键数');
eq(sampleOf(null), 'null', 'G5. null 明确显示');
eq([kindOf(null), kindOf([]), kindOf({}), kindOf(''), kindOf(0), kindOf(true)],
  ['null', 'array', 'object', 'string', 'number', 'boolean'], 'G6. kindOf 覆盖各类型');

console.log(`\n=== out-fields：${pass} passed, ${fail} failed ===`);
if (fail) process.exit(1);
