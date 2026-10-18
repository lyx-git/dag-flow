// test/lazy-dirs.test.mjs — 目录「按需创建」：不再凭空建 images/、tmp/logs/、tmp/<子工作流名>/
//
// 用户原话（2026-10-21，连报两轮）：「.dsh/.dag-flow/ 还是会自动创建 images，.dsh/.dag-flow/tmp 还是会自动创建
//   logs 和子工作流名称（隐式调用）」。
// 契约：
//   ① 只初始化存储（启动一次）⇒ 只建 `workflow/`，**不建** `images/`、`tmp/`、`tmp/logs/`；
//   ② 真的写第一条日志 ⇒ 才出现 `tmp/logs/` 且里面有当天的日志文件；
//   ③ 真的跑一次父→子工作流 ⇒ `tmp/` 下只有顶层工作流目录，子工作流名下什么都没有，且不会出现 `images/`。
// 跑法：node test/lazy-dirs.test.mjs
import { tmpRoot } from './_tmp-root.mjs';
import { useHomeAs } from './_isolate-home.mjs';
import { build } from 'esbuild';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.error(`  ✗ ${name}${detail ? '  —  ' + detail : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ROOT = resolve(import.meta.dirname, '..');
const HOME = useHomeAs(tmpRoot('df-lazydirs-'));
const DF = join(HOME, '.dag-flow');

const ENTRY = join(tmpRoot('df-lazydirs-entry-'), 'entry.ts');
writeFileSync(ENTRY, [
  `export { ensureDagFlowDirs, dagFlowDir } from ${JSON.stringify(join(ROOT, 'src/adapter/workspace.ts').replace(/\\/g, '/'))};`,
  `export { createStorage } from ${JSON.stringify(join(ROOT, 'src/adapter/storage.ts').replace(/\\/g, '/'))};`,
  `export { createLogger } from ${JSON.stringify(join(ROOT, 'src/adapter/logger.ts').replace(/\\/g, '/'))};`,
  `export { runWorkflow } from ${JSON.stringify(join(ROOT, 'src/executor/run.ts').replace(/\\/g, '/'))};`,
  `export { registerBuiltinNodes } from ${JSON.stringify(join(ROOT, 'src/registry/builtin.ts').replace(/\\/g, '/'))};`,
  '',
].join('\n'));
const OUT = join(ROOT, 'tmp-test', 'build');
mkdirSync(OUT, { recursive: true });
const BUNDLE = join(OUT, 'lazy-dirs.bundle.mjs');
await build({
  entryPoints: [ENTRY], bundle: true, format: 'esm', platform: 'node', target: 'node20', outfile: BUNDLE, logLevel: 'silent',
  external: ['@deepseek-ai/cordis', 'node:fs', 'node:fs/promises', 'node:path', 'node:url', 'node:os', 'node:process',
    'node:sqlite', 'node:child_process', 'node:crypto', 'node:stream', 'node:stream/promises', 'node:zlib',
    'node:http', 'node:https', 'node:events', 'node:buffer', 'node:util', 'node:timers', 'node:async_hooks'],
});
const { ensureDagFlowDirs, dagFlowDir, createStorage, createLogger, runWorkflow, registerBuiltinNodes } = await import(pathToFileURL(BUNDLE).href);
registerBuiltinNodes();

console.log('\n== ① 只初始化存储（等价于宿主启动）==');
{
  await ensureDagFlowDirs();
  await dagFlowDir();
  const storage = createStorage();
  await storage.describe();          // 触发 resolveRoot（原来这里会 mkdir images/）
  const root = readdirSync(DF);
  t('workflow/ 建了（存定义必需）', root.includes('workflow'), root.join(','));
  t('★ 没有 images/', !existsSync(join(DF, 'images')));
  t('★ 没有 tmp/', !existsSync(join(DF, 'tmp')));
  t('★ 没有 tmp/logs/', !existsSync(join(DF, 'tmp', 'logs')));
}

console.log('\n== ② 写日志也不创建任何目录（2026-10-21 起文件日志已关闭）==');
{
  const log = createLogger();
  log.info('lazy-dirs 探针');
  log.warn('lazy-dirs 探针 2');
  log.error('lazy-dirs 探针 3');
  await sleep(150);
  t('★ 没有 tmp/logs/（不再落文件日志）', !existsSync(join(DF, 'tmp', 'logs')));
  t('★ 连 tmp/ 都还没建', !existsSync(join(DF, 'tmp')));
  t('★ 仍然没有 images/', !existsSync(join(DF, 'images')));
}

console.log('\n== ③ 跑一次父→子工作流 ⇒ tmp 下只有顶层，且不出现 images/ ==');
{
  const storage = createStorage();
  const child = { name: '懒建子流', version: 1, nodes: [
    { id: 'start', type: 'start', next: 'end' },
    { id: 'end', type: 'end' },
  ], edges: [{ from: 'start', to: 'end' }] };
  const parent = { name: '懒建父流', version: 1, nodes: [
    { id: 'start', type: 'start', next: 'sub1' },
    { id: 'sub1', type: 'subflow', params: { workflowName: '懒建子流' }, next: 'end' },
    { id: 'end', type: 'end' },
  ], edges: [{ from: 'start', to: 'sub1' }, { from: 'sub1', to: 'end' }] };
  await storage.writeWorkflow(child.name, child);
  await storage.writeWorkflow(parent.name, parent);
  const log = { info() {}, warn() {}, error() {} };
  const { summary } = await runWorkflow(parent, { logger: log, cwd: process.cwd(), runId: 'run-555-lazy' });
  t('整链跑成功', summary.status === 'success', JSON.stringify(summary.error ?? null).slice(0, 160));
  const tmpNames = readdirSync(join(DF, 'tmp')).filter((n) => n !== 'logs');
  t('tmp/ 下只有顶层工作流目录', tmpNames.length === 1 && tmpNames[0] === '懒建父流', tmpNames.join(','));
  t('★ 子工作流名下什么都没有', !existsSync(join(DF, 'tmp', '懒建子流')));
  t('★ 没有 images/', !existsSync(join(DF, 'images')));
  t('顶层运行目录里有 run.json', existsSync(join(DF, 'tmp', '懒建父流', 'run-555-lazy', 'run.json')));
}

console.log(`\n=== lazy-dirs: ${pass} passed, ${fail} failed ===`);
if (fail) { console.error('失败项：' + failures.join(' / ')); process.exit(1); }
