// test/storage-cleanup.test.mjs — 运行前清理 tmp + 日志保留（2026-10-18 用户要求）
//
// 用户原话：「同一个工作流执行多次生成多份文件，导致每次执行读错文件的问题，读到其他执行生成的文件上去了，
//   每次执行过后要及时清理生成的文件，否则会越积越多，每次执行的日志也要定时清理，要不然也会越积越多」
// ⇒ 本文件锁三件事：
//   ① pruneRunTmp(names)：清空这些工作流的 `tmp/<名>/` 内容、**保留目录本身**、不碰别的工作流；
//   ② collectRunWorkflows(def)：能沿 subflow / loop.body 递归收集（读不到定义的子工作流也带上名字，
//      好让它残留的目录一起被清）；
//   ③ pruneLogs()：按日志文件名里的日期保留最近 30 天，非日志文件一律不碰，dryRun 只算不删。
import { tmpRoot } from './_tmp-root.mjs';
import { build } from 'esbuild';
import { writeFileSync, readFileSync, mkdirSync, readdirSync, existsSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.error(`  ✗ ${name}${detail ? '  —  ' + detail : ''}`); }
}

const ROOT = process.cwd();
const HOME = tmpRoot('storage-cleanup-');
process.env.DSH_HOME = HOME;

const ENTRY = join(tmpRoot('storage-cleanup-entry-'), 'entry.ts');
writeFileSync(ENTRY, [
  `export { createStorage } from ${JSON.stringify(join(ROOT, 'src/adapter/storage.ts').replace(/\\/g, '/'))};`,
  '',
].join('\n'));
const OUT = join(ROOT, 'tmp-test', 'build', 'storage-cleanup');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
await build({
  entryPoints: [ENTRY], bundle: true, format: 'esm', platform: 'node', target: 'node20',
  outfile: join(OUT, 'bundle.mjs'),
  external: ['@deepseek-ai/cordis', 'node:fs', 'node:path', 'node:url', 'node:os', 'node:process', 'node:sqlite'],
  logLevel: 'silent',
});
const { createStorage } = await import(pathToFileURL(join(OUT, 'bundle.mjs')).href);
const storage = createStorage();
const GF = join(HOME, '.dag-flow');
const write = (p, text = 'x') => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, text, 'utf8'); };

// ===== ① pruneRunTmp：清内容、留目录、不碰别人 =====
{
  console.log('\n== ① 运行前清空 tmp（pruneRunTmp） ==');
  write(join(GF, 'tmp', '甲', 'market-1.json'));
  write(join(GF, 'tmp', '甲', 'sub', 'deep.txt'));
  write(join(GF, 'tmp', '甲', 'report-1.html'));
  write(join(GF, 'tmp', '乙', 'keep.json'));
  const r = await storage.pruneRunTmp(['甲']);
  t('删掉了 甲 下的 3 个条目（含子目录里的文件）', r.deleted === 3, `实际 deleted=${r.deleted}`);
  t('甲 目录仍然存在（只清内容，不删目录）', existsSync(join(GF, 'tmp', '甲')));
  t('甲 目录已空', readdirSync(join(GF, 'tmp', '甲')).length === 0);
  t('乙 的文件原样保留', existsSync(join(GF, 'tmp', '乙', 'keep.json')));
  const r2 = await storage.pruneRunTmp(['不存在的名字', '']);
  t('不存在的目录 / 空名字不抛错、deleted=0', r2.deleted === 0, JSON.stringify(r2));
}

// ===== ② collectRunWorkflows：沿 subflow / loop.body 递归 =====
{
  console.log('\n== ② 收集本次运行会用到的工作流（collectRunWorkflows） ==');
  const wf = (name, nodes) => write(join(GF, 'workflow', `${name}.json`), JSON.stringify({ name, nodes, edges: [] }, null, 2));
  wf('顶层', [
    { id: 'a', type: 'subflow', params: { workflowName: '子' } },
    { id: 'b', type: 'loop', params: { body: { workflowName: '循环体' } } },
    { id: 'c', type: 'python', params: {} },
  ]);
  wf('子', [{ id: 'd', type: 'subflow', params: { workflowName: '孙(不存在)' } }]);
  wf('循环体', []);
  const def = JSON.parse(readFileSync(join(GF, 'workflow', '顶层.json'), 'utf8'));
  const names = await storage.collectRunWorkflows(def);
  t('带上自己（顶层）', names.includes('顶层'), JSON.stringify(names));
  t('带上 subflow 引用的「子」', names.includes('子'));
  t('带上 loop.body 引用的「循环体」', names.includes('循环体'));
  t('读不到定义的「孙(不存在)」也带上名字（残留目录照样清）', names.includes('孙(不存在)'));
  t('不把无关节点当子工作流', names.length === 4, JSON.stringify(names));
  const onlySelf = await storage.collectRunWorkflows({ name: '顶层', nodes: [] }, 0);
  t('depth=0 时只收自己', onlySelf.length === 1 && onlySelf[0] === '顶层', JSON.stringify(onlySelf));
}

// ===== ③ pruneLogs：落 tmp/logs，只保留最新 5 份 =====
{
  console.log('\n== ③ 日志保留最新 5 份（pruneLogs，落 tmp/logs） ==');
  const logsDir = join(GF, 'tmp', 'logs');
  const names = [];
  for (let i = 1; i <= 8; i++) {
    const name = 'dag-flow-2026-01-0' + i + '.log';   // 文件名日期即字典序：01 最旧
    write(join(logsDir, name), 'x');
    names.push(name);
  }
  write(join(logsDir, 'notes.txt'), 'not a log');
  const dry = await storage.pruneLogs({ maxFiles: 5, dryRun: true });
  t('dryRun：该删 3 份（共 8 份，保留 5）', dry.deleted.length === 3, JSON.stringify(dry.deleted));
  t('dryRun：文件其实还在', names.every((n) => existsSync(join(logsDir, n))));
  const r = await storage.pruneLogs({ maxFiles: 5 });
  const left = readdirSync(logsDir).filter((f) => f.endsWith('.log')).sort();
  t('真删：只剩最新 5 份', JSON.stringify(left) === JSON.stringify(names.slice(3)), JSON.stringify(left));
  t('非日志文件不碰', existsSync(join(logsDir, 'notes.txt')));
  t('kept 计数 = 5 份日志 + notes', r.kept === 6, '实际 kept=' + r.kept);

  // ★ 2026-10-18 用户要求：默认只保留最近 20 份（不传 maxFiles）
  for (let i = 1; i <= 25; i++) write(join(logsDir, 'dag-flow-2025-02-' + String(i).padStart(2, '0') + '.log'), 'y');
  await storage.pruneLogs();
  const left20 = readdirSync(logsDir).filter((f) => f.endsWith('.log')).length;
  t('默认只保留最新 20 份日志', left20 === 20, '实际 ' + left20);
}

// ===== ④ pruneRunTmpDirs：每个工作流只留最新 5 个运行目录 =====
{
  console.log('\n== ④ 保留最新 5 个运行目录（pruneRunTmpDirs） ==');
  const base = join(GF, 'tmp', '丙');
  for (let i = 0; i < 8; i++) {
    const d = join(base, `run-${i}`);
    write(join(d, 'f.json'));
    const t0 = new Date(Date.now() - 60_000 + i * 1000);   // i 越大越新
    utimesSync(d, t0, t0);
  }
  write(join(base, 'legacy-flat.json'));                  // 旧结构遗留在根下的平铺文件
  const r = await storage.pruneRunTmpDirs(['丙'], 5);
  const left = readdirSync(base).filter((x) => x.startsWith('run-')).sort();
  t('只留最新 4 个运行目录（本次运行还会新建 1 个 ⇒ 合计 5）', left.length === 4, JSON.stringify(left));
  t('留下的是最新的 run-4..run-7', JSON.stringify(left) === JSON.stringify(['run-4', 'run-5', 'run-6', 'run-7']), JSON.stringify(left));
  t('旧结构的平铺文件被清掉', !existsSync(join(base, 'legacy-flat.json')));
  t('removed 里记下了被删的名字', r.removed.length === 5, JSON.stringify(r.removed));
  const keepAll = await storage.pruneRunTmpDirs(['丙'], 99);
  t('keep 大于现存数量时一个都不删', keepAll.removed.length === 0 && readdirSync(base).filter((x) => x.startsWith('run-')).length === 4);

  // ★ 2026-10-18 用户要求：默认保留最近 20 次（不传 keep ⇒ 留 19 个旧的 + 本次新建 1 个 = 20）
  const base2 = join(GF, 'tmp', '丁');
  for (let i = 0; i < 25; i++) {
    const d = join(base2, 'run-' + String(i).padStart(2, '0'));
    write(join(d, 'f.json'));
    const tt = new Date(Date.now() - 100_000 + i * 1000);
    utimesSync(d, tt, tt);
  }
  const rel20 = await storage.pruneRunTmpDirs(['丁']);
  const leftRuns = readdirSync(base2).filter((x) => x.startsWith('run-')).length;
  t('默认只保留最新 19 个旧运行目录（本次还会新建 1 个 ⇒ 20）', leftRuns === 19, '实际 ' + leftRuns + ' / removed ' + rel20.removed.length);
}

console.log(`\n=== storage-cleanup: ${pass} passed, ${fail} failed ===`);
if (fail) { console.error('失败项：' + failures.join(' / ')); process.exit(1); }
