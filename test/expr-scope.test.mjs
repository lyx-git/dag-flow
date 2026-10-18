// test/expr-scope.test.mjs — 表达式作用域回归（2026-09-27：results 命名空间 + NaN 告警）
// 锁四件事：①节点输出按 id 拍平（既有）；②results.<id> 命名空间与拍平式同义（新）；
// ③两种写法的 if 条件都能求值；④旧式 .out 写法 NaN → false + console.warn 提示。
// 手段：esbuild 即时打包 src/registry/external.ts + expr.ts → 临时 mjs → 断言。
import { tmpRoot } from './_tmp-root.mjs';
import { build } from 'esbuild';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const tmp = tmpRoot('dag-flow-expr-test-');

const OUT = join(tmp, 'external.bundle.mjs');
await build({
  entryPoints: [join(ROOT, 'src/registry/external.ts')],
  bundle: true, format: 'esm', platform: 'node', target: 'node20',
  outfile: OUT, logLevel: 'silent',
});
const { ctxToScope } = await import(pathToFileURL(OUT).href);

const OUT2 = join(tmp, 'expr.bundle.mjs');
await build({
  entryPoints: [join(ROOT, 'src/registry/expr.ts')],
  bundle: true, format: 'esm', platform: 'node', target: 'node20',
  outfile: OUT2, logLevel: 'silent',
});
const { evaluateBool } = await import(pathToFileURL(OUT2).href);

let pass = 0, fail = 0;
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

const ctx = {
  inputs: { run: '1' },
  vars: { topic: 'T' },
  results: {
    py_gate: { out: '1' },
    ws: { out: { count: 6, engine: 'bing' } },
  },
};
const scope = ctxToScope(ctx);

t('X1 节点输出按 id 拍平（既有形态）', scope.py_gate === '1');
t('X2 results 命名空间同义（results.<id> = out）', scope.results?.py_gate === '1' && scope.results?.ws?.count === 6);
t('X3 inputs/vars 对象保留', scope.inputs?.run === '1' && scope.vars?.topic === 'T');

t('X4 拍平式条件可用', evaluateBool('Number(py_gate) > 0', scope) === true);
t('X5 results 命名空间条件可用（新）', evaluateBool('Number(results.py_gate) > 0', scope) === true);
t('X6 对象型 out 取字段', evaluateBool('ws.count == 6', scope) === true);

let warned = '';
const origWarn = console.warn;
console.warn = (m) => { warned = String(m); };
let nanResult = false;
try { nanResult = evaluateBool('Number(py_gate.out)', scope); } finally { console.warn = origWarn; }
t('X7 裸 Number(不存在字段) → NaN 按 false（不抛错）', nanResult === false);
t('X8 NaN 触发告警且含表达式原文', warned.includes('NaN') && warned.includes('Number(py_gate.out)'), warned.slice(0, 120));

let warned2 = '';
const origWarn2 = console.warn;
console.warn = (m) => { warned2 = String(m); };
let cmpResult = true;
try { cmpResult = evaluateBool('Number(py_gate.out) > 0', scope); } finally { console.warn = origWarn2; }
t('X9 比较式含 .out 且结果 false → 笔误告警（不再静默）', cmpResult === false && warned2.includes('.out') && warned2.includes('疑似笔误'), warned2.slice(0, 120));
let warned3 = '';
const origWarn3 = console.warn;
console.warn = (m) => { warned3 = String(m); };
let okResult = false;
try { okResult = evaluateBool('Number(py_gate) > 0', scope); } finally { console.warn = origWarn3; }
t('X10 正确写法结果为 true 且不触发告警', okResult === true && warned3 === '', warned3.slice(0, 120));

// ★ X11~X14（2026-10-19 新增，真机 bug 回归锁）：python/bash 节点的 out 是**原始 stdout 字符串**，
//   模板侧会解析它取字段，表达式侧曾不解析 ⇒ `py_store.ok` 得 undefined、`== true` 静默为 false
//   （真机实证：py_store 的 ok 明明是 true，if 却走了 false 分支）。
{
  const c2 = { inputs: {}, vars: {}, results: { py_store: { out: '{"ok": true, "dirCount": 7}' } } };
  const s2 = ctxToScope(c2);
  t('X11 JSON 字符串 out 被解析（拍平式可取字段）', s2.py_store?.ok === true && evaluateBool('py_store.ok == true', s2) === true);
  t('X12 results 命名空间同样可解析', evaluateBool('results.py_store.dirCount == 7', s2) === true);
  const c3 = { inputs: {}, vars: {}, results: { bash1: { out: 'done' }, bad: { out: '{not json' } } };
  const s3 = ctxToScope(c3);
  t('X13 纯文本 out 保持原字符串（不误解析）', s3.bash1 === 'done');
  t('X14 首字符像 JSON 但解析失败 → 保持原样不抛错', s3.bad === '{not json');
}

// ★ X15~X18（2026-10-19 新增）：模板侧 {{...}} 与表达式侧口径统一（共用 src/jsonish.ts）。
//   旧实现两侧都取不到字符串 out 的字段，但模板侧**报错**、表达式侧**静默 false** —— 这里锁住模板侧。
const OUT3 = join(tmp, 'dataflow.bundle.mjs');
await build({
  entryPoints: [join(ROOT, 'src/executor/dataflow.ts')],
  bundle: true, format: 'esm', platform: 'node', target: 'node20',
  outfile: OUT3, logLevel: 'silent',
});
const { resolveParams, DataflowError } = await import(pathToFileURL(OUT3).href);
const mkOut = (out) => ({ status: 'success', out });
{
  const c = { inputs: {}, vars: {}, results: { py_store: mkOut('{"ok": true, "dirCount": 7}') } };
  const r = resolveParams({ a: '{{py_store.out.ok}}', b: '{{py_store.out.dirCount}}' }, c, 'end');
  t('X15 模板取 JSON 字符串 out 的字段（与表达式一致）', r.a === true && r.b === 7, JSON.stringify(r));
  const r2 = resolveParams({ only: '{{py_store.out}}' }, c, 'end');
  t('X16 纯引用 {{py.out}} 仍原样返回字符串（不改变既有拼接用法）', r2.only === '{"ok": true, "dirCount": 7}');
}
{
  const c = { inputs: {}, vars: {}, results: { bash1: mkOut('done'), bad: mkOut('{not json') } };
  const r = resolveParams({ m: 'x{{bash1.out}}y' }, c, 'end');
  t('X17 纯文本 out 混合模板仍是字符串拼接', r.m === 'xdoney', JSON.stringify(r));
  let threw = false;
  try { resolveParams({ f: '{{bad.out.field}}' }, c, 'end'); } catch (e) { threw = e instanceof DataflowError; }
  t('X18 首字符像 JSON 但解析失败 → 取字段仍按不可达报错', threw);
}

console.log(`\n=== expr-scope: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
