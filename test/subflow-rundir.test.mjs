// test/subflow-rundir.test.mjs — 隐式调用（父→子→孙）一律落**顶层父**的运行目录，不建子工作流目录
//
// 用户口径（2026-10-21 原话）：「父工作流调用子工作流，.dsh/.dag-flow/tmp 还是生成了子工作流目录，期望如果是
//   父工作流调用子工作流的这种隐式调用，以父工作流传过来的目录为准，都放在父工作流，**多级父子调用也是一样的**；
//   如果不是这种隐式调用，就按照正常工作流调用为准」。
// 契约：
//   ① A→B→C 三级：B、C 的 python 节点 cwd 与 DAGFLOW_RUN_DIR 都必须等于 A 的运行目录；
//   ② `tmp/` 下只出现 A 这一层目录，且 B、C 名下**不存在**任何目录（含 run.json）；
//   ③ 直接跑 C（不是隐式调用）⇒ 正常按自己的工作流名建 `tmp/<C>/<runId>/`。
// 跑法：node test/subflow-rundir.test.mjs
import { tmpRoot } from './_tmp-root.mjs';
import { useHomeAs } from './_isolate-home.mjs';
import { build } from 'esbuild';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.error(`  ✗ ${name}${detail ? '  —  ' + detail : ''}`); }
}

const ROOT = resolve(import.meta.dirname, '..');
const HOME = useHomeAs(tmpRoot('df-subrundir-'));
const DF = join(HOME, '.dag-flow');

const ENTRY = join(tmpRoot('df-subrundir-entry-'), 'entry.ts');
writeFileSync(ENTRY, [
  `export { runWorkflow } from ${JSON.stringify(join(ROOT, 'src/executor/run.ts').replace(/\\/g, '/'))};`,
  `export { registerBuiltinNodes } from ${JSON.stringify(join(ROOT, 'src/registry/builtin.ts').replace(/\\/g, '/'))};`,
  `export { createStorage } from ${JSON.stringify(join(ROOT, 'src/adapter/storage.ts').replace(/\\/g, '/'))};`,
  '',
].join('\n'));
const OUT = join(ROOT, 'tmp-test', 'build');
mkdirSync(OUT, { recursive: true });
const BUNDLE = join(OUT, 'subflow-rundir.bundle.mjs');
await build({
  entryPoints: [ENTRY], bundle: true, format: 'esm', platform: 'node', target: 'node20',
  outfile: BUNDLE, logLevel: 'silent',
  external: ['@deepseek-ai/cordis', 'node:fs', 'node:fs/promises', 'node:path', 'node:url', 'node:os', 'node:process',
    'node:sqlite', 'node:child_process', 'node:crypto', 'node:stream', 'node:stream/promises', 'node:zlib',
    'node:http', 'node:https', 'node:events', 'node:buffer', 'node:util', 'node:timers', 'node:async_hooks'],
});
const { runWorkflow, registerBuiltinNodes, createStorage } = await import(pathToFileURL(BUNDLE).href);
registerBuiltinNodes();
const storage = createStorage();

const log = { info() {}, warn() {}, error() {} };
const PY = 'import os, json\nprint(json.dumps({"cwd": os.getcwd(), "runDir": os.environ.get("DAGFLOW_RUN_DIR", "")}))';

const def = (name, nodes, edges) => ({ name, version: 1, nodes, edges });
const childC = def('子工作流C', [
  { id: 'start', type: 'start', next: 'py1' },
  { id: 'py1', type: 'python', params: { code: PY }, next: 'end' },
  { id: 'end', type: 'end' },
], [{ from: 'start', to: 'py1' }, { from: 'py1', to: 'end' }]);
const childB = def('子工作流B', [
  { id: 'start', type: 'start', next: 'sub_c' },
  { id: 'sub_c', type: 'subflow', params: { workflowName: '子工作流C' }, next: 'end' },
  { id: 'end', type: 'end' },
], [{ from: 'start', to: 'sub_c' }, { from: 'sub_c', to: 'end' }]);
const topA = def('顶层工作流A', [
  { id: 'start', type: 'start', next: 'sub_b' },
  { id: 'sub_b', type: 'subflow', params: { workflowName: '子工作流B' }, next: 'end' },
  { id: 'end', type: 'end' },
], [{ from: 'start', to: 'sub_b' }, { from: 'sub_b', to: 'end' }]);

for (const d of [childC, childB, topA]) await storage.writeWorkflow(d.name, d);

const tmpEntries = () => {
  try { return readdirSync(join(DF, 'tmp'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); }
  catch { return []; }
};

console.log('\n== ① A→B→C 三级隐式调用：全部落在 A 的运行目录 ==');
let topRunId = '';
{
  const { summary } = await runWorkflow(topA, { logger: log, cwd: process.cwd(), runId: 'run-900-top' });
  topRunId = summary.runId;
  // ★ 子工作流的节点结果不在顶层 summary.results 里；直接读 A 运行目录里的 nodes/py1.out
  //   —— 它存在本身就说明「子工作流的 stdout 也落在父运行目录」。
  const pyOutFile = join(DF, 'tmp', '顶层工作流A', 'run-900-top', 'nodes', 'py1.out');
  let parsed = {};
  let rawPy = '';
  try { rawPy = readFileSync(pyOutFile, 'utf8'); parsed = JSON.parse(rawPy.trim()); } catch (e) { rawPy = 'READ_FAIL: ' + String(e?.message ?? e); }
  t('整链跑成功', summary.status === 'success', JSON.stringify(summary.error ?? null).slice(0, 160));
  t('C 的 python cwd = A 的运行目录', String(parsed.cwd ?? '').toLowerCase() === join(DF, 'tmp', '顶层工作流A', 'run-900-top').toLowerCase(), 'cwd=' + String(parsed.cwd) + ' raw=' + rawPy.slice(0, 200));
  t('C 拿到的 DAGFLOW_RUN_DIR 也是 A 的运行目录', String(parsed.runDir ?? '').toLowerCase() === join(DF, 'tmp', '顶层工作流A', 'run-900-top').toLowerCase(), 'runDir=' + String(parsed.runDir) + ' raw=' + rawPy.slice(0, 200));
  t('A 的运行记录写在 A 自己名下', existsSync(join(DF, 'tmp', '顶层工作流A', 'run-900-top', 'run.json')));
  t('子工作流的 stdout 也落在父运行目录（nodes/py1.out）', existsSync(pyOutFile), pyOutFile);
}

console.log('\n== ② tmp/ 下只有顶层这一层（B、C 名下什么都不建） ==');
{
  const names = tmpEntries().filter((n) => n !== 'logs');   // logs 是全局日志目录，不是工作流目录
  t('tmp/ 只有「顶层工作流A」', names.length === 1 && names[0] === '顶层工作流A', names.join(','));
  t('没有 tmp/子工作流B', !existsSync(join(DF, 'tmp', '子工作流B')));
  t('没有 tmp/子工作流C', !existsSync(join(DF, 'tmp', '子工作流C')));
  t('B/C 也没有在自己名下写 run.json', !existsSync(join(DF, 'tmp', '子工作流B', 'run.json')) && !existsSync(join(DF, 'tmp', '子工作流C', 'run.json')));
}

console.log('\n== ③ 直接跑 C（不是隐式调用）⇒ 按自己的名字建目录 ==');
{
  const { summary } = await runWorkflow(childC, { logger: log, cwd: process.cwd(), runId: 'run-901-solo' });
  const parsed = JSON.parse(String(summary.results?.py1?.out ?? '{}').trim() || '{}');
  t('跑成功', summary.status === 'success', JSON.stringify(summary.error ?? null).slice(0, 160));
  t('目录建在 tmp/子工作流C/run-901-solo/', existsSync(join(DF, 'tmp', '子工作流C', 'run-901-solo')));
  t('它的 cwd 就是自己这个目录', String(parsed.cwd ?? '').toLowerCase() === join(DF, 'tmp', '子工作流C', 'run-901-solo').toLowerCase(), String(parsed.cwd ?? ''));
  t('自己也写了自己的运行记录', existsSync(join(DF, 'tmp', '子工作流C', 'run-901-solo', 'run.json')));
}

console.log(`\n=== subflow-rundir: ${pass} passed, ${fail} failed ===`);
if (fail) { console.error('失败项：' + failures.join(' / ')); process.exit(1); }
