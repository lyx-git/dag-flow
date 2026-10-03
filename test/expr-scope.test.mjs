// test/expr-scope.test.mjs — 表达式作用域回归（2026-09-27：results 命名空间 + NaN 告警）
// 锁四件事：①节点输出按 id 拍平（既有）；②results.<id> 命名空间与拍平式同义（新）；
// ③两种写法的 if 条件都能求值；④旧式 .out 写法 NaN → false + console.warn 提示。
// 手段：esbuild 即时打包 src/registry/external.ts + expr.ts → 临时 mjs → 断言。
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const tmp = mkdtempSync(join(tmpdir(), 'dag-flow-expr-test-'));

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

console.log(`\n=== expr-scope: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
