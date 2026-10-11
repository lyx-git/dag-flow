// test/schema-parity.test.mjs — 客户端 JSON 视图的 schema 与宿主执行前 schema 的**一致性闸门**
//   （2026-10-11 审计①⑦）。由来：审计发现两份 schema 曾经不同——客户端 `onError` 写成
//   `{ type: ['string','object'] }`（任何 object 都放行），宿主却是严格 oneOf（goto 分支要求
//   `goto: string` 且不许有其它键）⇒ 用户在 JSON 页看到 ✅、一点运行才被宿主拒
//   （「这里说没问题，一运行就报错」）。同时客户端把 `name.pattern` 抄了一份硬编码副本。
//   本测试把「两份 schema 逐字段等价」和「pattern 只有唯一源」钉死，并**自带阳性对照**
//   （把旧的宽松 onError 塞回去必须被比较器抓出来），否则闸门本身可能是假的。
//   手段：esbuild 打包 src/types.ts + src/client/JsonView.tsx → 临时 mjs → 深比较（键序无关）
//   跑法：node test/schema-parity.test.mjs
import { build } from 'esbuild';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

const dir = mkdtempSync(join(tmpdir(), 'df-schema-parity-'));
const OUT = join(dir, 'schemas.mjs');
const ROOT = join(import.meta.dirname, '..');
const abs = (p) => join(ROOT, p).replace(/\\/g, '/');

// 只取两份 schema：JsonView 里被 `await import()` 的运行时依赖标成 external（本测试不会执行到）
await build({
  stdin: {
    contents: [
      `export { WORKFLOW_SCHEMA as host } from '${abs('src/types.ts')}';`,
      `export { WORKFLOW_SCHEMA as client } from '${abs('src/client/JsonView.tsx')}';`,
      `export { WORKFLOW_NAME_PATTERN } from '${abs('src/name-rule.ts')}';`,
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: OUT,
  external: ['ajv', '@monaco-editor/react'],
  logLevel: 'silent',
});
const { host, client, WORKFLOW_NAME_PATTERN } = await import(pathToFileURL(OUT).href);

/** 键序无关的规范化（对象键排序后重建；数组保序） */
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = canon(v[k]);
    return o;
  }
  return v;
}
/** 找出第一处差异路径；完全相同返回 null */
function firstDiff(a, b, p = '$') {
  if (typeof a !== typeof b) return `${p}: 类型不同 host=${typeof a} client=${typeof b}`;
  if (a === null || b === null || typeof a !== 'object') return a === b ? null : `${p}: host=${JSON.stringify(a)} client=${JSON.stringify(b)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${p}: 一边数组一边对象`;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return `${p}: 数组长度 ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) { const d = firstDiff(a[i], b[i], `${p}[${i}]`); if (d) return d; }
    return null;
  }
  const ka = Object.keys(a).sort(); const kb = Object.keys(b).sort();
  if (ka.join(',') !== kb.join(',')) return `${p}: 键不同 host=[${ka}] client=[${kb}]`;
  for (const k of ka) { const d = firstDiff(a[k], b[k], `${p}.${k}`); if (d) return d; }
  return null;
}

console.log('== A. 两份 schema 逐字段等价（键序无关）==');
{
  const diff = firstDiff(canon(host), canon(client));
  assert(diff === null, `A1. host 与 client 的 WORKFLOW_SCHEMA 无差异${diff ? `（实际：${diff}）` : ''}`);
  assert(Object.keys(host.properties.nodes.items.properties).includes('onError'), 'A2. 节点级 properties 含 onError（取到的确实是 schema）');
}

console.log('== B. 名字规则唯一源 ==');
{
  assert(host.properties.name.pattern === WORKFLOW_NAME_PATTERN, 'B1. host name.pattern 来自 name-rule.ts');
  assert(client.properties.name.pattern === WORKFLOW_NAME_PATTERN, 'B2. client name.pattern 来自 name-rule.ts（不再是硬编码副本）');
  const src = readFileSync(join(ROOT, 'src/client/JsonView.tsx'), 'utf8');
  assert(!src.includes("'^[\\\\p{L}"), 'B3. JsonView 源码里不再有硬编码 pattern 字面量');
  assert(src.includes("from '../name-rule'"), 'B4. JsonView 确实 import 了唯一源');
}

console.log('== C. onError 与宿主同严格 ==');
{
  const oneOf = host.properties.nodes.items.properties.onError.oneOf;
  assert(Array.isArray(oneOf) && oneOf.length === 2, 'C1. onError 是两分支 oneOf');
  assert(JSON.stringify(oneOf[0]) === JSON.stringify({ enum: ['stop', 'continue'] }), 'C2. 第一分支=stop/continue 枚举');
  assert(oneOf[1]?.required?.includes('goto') === true && oneOf[1]?.additionalProperties === false, 'C3. 第二分支要求 goto 且禁止额外键');
  const loose = host.properties.nodes.items.properties.onError.type;
  assert(loose === undefined, 'C4. onError 不再是宽松的 { type: [...] }');
}

console.log('== D. 阳性对照：比较器必须抓得住旧的宽松写法 ==');
{
  const oldShape = JSON.parse(JSON.stringify(host));
  oldShape.properties.nodes.items.properties.onError = { type: ['string', 'object'] };   // 审计前的客户端写法
  const diff = firstDiff(canon(host), canon(oldShape));
  assert(diff !== null && diff.includes('$.properties.nodes.items.properties.onError'), `D1. 旧写法被抓出（差异路径指向 onError）${diff ? `：${diff}` : ''}`);
}

console.log(`\n=== schema 一致性：${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
