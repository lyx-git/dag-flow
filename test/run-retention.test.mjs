// test/run-retention.test.mjs — 运行记录的**唯一落点**与随运行目录清理（2026-10-20 用户拍板「不用兼容旧位置数据，都删了」）
//
// 口径：
//   ① 运行记录只写 `<数据根>/tmp/<工作流名>/<runId>/run.json`，**不再建 runs/ 目录**；
//   ② `listRunRecords` / `readRunRecord` 只认运行目录 —— 手工塞进 `runs/` 的旧记录**查不到**（无兼容）；
//   ③ 每个工作流只留最新 20 个运行目录 ⇒ 旧运行的 run.json 随之消失（`pruneRunTmpDirs`）。
//   跑法：node test/run-retention.test.mjs
import { tmpRoot } from './_tmp-root.mjs';
import { useHomeAs } from './_isolate-home.mjs';
import { build } from 'esbuild';
import { existsSync, mkdirSync, writeFileSync, readdirSync, utimesSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const assert = (cond, msg, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}${detail ? '  —  ' + detail : ''}`); }
};

const ROOT = resolve(import.meta.dirname, '..');
const HOME = useHomeAs(tmpRoot('df-runrecords-'));      // ★ 无条件隔离，绝不写进真机数据根
const DF = join(HOME, '.dag-flow');
const OUT = join(tmpRoot('df-runrecords-b-'), 'storage.mjs');
await build({ entryPoints: [join(ROOT, 'src/adapter/storage.ts')], bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent' });
const { createStorage, TMP_KEEP_MAX_RUNS } = await import(pathToFileURL(OUT).href);
const st = createStorage();

console.log('== A. 写入只落运行目录（不再建 runs/） ==');
{
  await st.writeRunRecord('run-201-hi', { runId: 'run-201-hi', workflowName: '工作流A', status: 'success' });
  assert(existsSync(join(DF, 'tmp', '工作流A', 'run-201-hi', 'run.json')), '记录写在 tmp/<名>/<runId>/run.json');
  assert(!existsSync(join(DF, 'runs')), '没有新建 runs/ 目录');
  assert(!existsSync(join(DF, 'tmp', '工作流A', 'run-201-hi', 'run-201-hi.json')), '不再写成 <runId>.json');
}

console.log('\n== B. 列表/读取只认运行目录 ==');
{
  const ids = await st.listRunRecords('工作流A');
  assert(ids.includes('run-201-hi'), '按工作流列得到它', ids.join(','));
  assert((await st.listRunRecords()).includes('run-201-hi'), '全量列表也含它');
  const rec = await st.readRunRecord('run-201-hi');
  assert(rec?.status === 'success', '按 runId 读得到', JSON.stringify(rec ?? null).slice(0, 60));
}

console.log('\n== C. 旧 runs/ 里的记录不再兼容（查不到） ==');
{
  const legacyDir = join(DF, 'runs', '工作流B');
  mkdirSync(legacyDir, { recursive: true });
  writeFileSync(join(legacyDir, 'run-001-old.json'), JSON.stringify({ runId: 'run-001-old', workflowName: '工作流B', status: 'failed' }), 'utf8');
  const ids = await st.listRunRecords('工作流B');
  assert(!ids.includes('run-001-old'), '列表里不出现旧记录', ids.join(','));
  assert((await st.readRunRecord('run-001-old')) === null, '按 runId 也读不到旧记录');
}

console.log('\n== D. 保留最新 20 个运行目录 ⇒ 旧记录随之清理 ==');
{
  const wf = '工作流C';
  const base = join(DF, 'tmp', wf);
  const ids = [];
  for (let i = 0; i < 22; i++) {
    const id = `run-${1000 + i}-c${i}`;
    const dir = join(base, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'run.json'), JSON.stringify({ runId: id, workflowName: wf, status: 'success' }), 'utf8');
    const t = (Date.now() - (30 - i) * 60_000) / 1000;   // i 越大越新
    utimesSync(dir, t, t);
    ids.push(id);
  }
  assert(TMP_KEEP_MAX_RUNS === 20, `默认保留 ${TMP_KEEP_MAX_RUNS} 个运行目录`);
  await st.pruneRunTmpDirs([wf]);
  const left = readdirSync(base).sort();
  // 清理发生在「本次运行开始前」⇒ 只留 19 个旧目录，本次再新建 1 个，合计 20
  assert(left.length === TMP_KEEP_MAX_RUNS - 1, `旧目录留 ${TMP_KEEP_MAX_RUNS - 1} 个（实际 ${left.length}，本次运行还会新建 1 个 ⇒ 合计 ${TMP_KEEP_MAX_RUNS}）`);
  assert(!left.includes(ids[0]) && left.includes(ids[21]), '删的是最旧的、最新的一定在');
  const listed = await st.listRunRecords(wf);
  assert(listed.length === TMP_KEEP_MAX_RUNS - 1, `列表同口径（实际 ${listed.length} 条）`);
  assert(listed[0] === ids[21], `列表第一条是最新那次（${listed[0]}）`);
}

console.log(`\n=== 运行记录落点与清理：${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
