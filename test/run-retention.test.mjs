// test/run-retention.test.mjs — 运行记录保留策略（2026-10-11 用户选「策略 A」）
//   口径：每个工作流保留**最近 200 条** + **超过 30 天**的删除（谁先满足按谁）；只删 runs/run-*.json，
//   不动 *.json.tmp、不动其它文件、更不动 workflow/ 与版本快照。
//   ★ 第一行必须 import './_isolate-home.mjs'：storage 模块级会读 dshHome()，否则会写进真机数据根。
//   跑法：node test/run-retention.test.mjs
import './_isolate-home.mjs';
import { build } from 'esbuild';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const assert = (cond, msg) => { if (cond) { pass++; console.log(`  ✓ ${msg}`); } else { fail++; console.error(`  ✗ ${msg}`); } };

const ROOT = resolve(import.meta.dirname, '..');
const tmp = mkdtempSync(join(tmpdir(), 'df-retention-'));
const OUT = join(tmp, 'storage.mjs');
await build({ entryPoints: [join(ROOT, 'src/adapter/storage.ts')], bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent' });
const { createStorage, RUN_KEEP_MAX_PER_WORKFLOW, RUN_KEEP_MAX_AGE_DAYS } = await import(pathToFileURL(OUT).href);

const st = createStorage();
const runsDir = await st.runsDir();
const DAY = 86_400_000;
const list = () => readdirSync(runsDir).sort();
/** 直接落一条记录（不经 writeRunRecord，避免写入时的自动清理干扰受控场景） */
const put = (msAgo, wf, tag) => {
  const id = `run-${Date.now() - msAgo}-${tag}`;
  writeFileSync(join(runsDir, `${id}.json`), JSON.stringify({ runId: id, workflowName: wf, status: 'success', finishedAt: new Date(Date.now() - msAgo).toISOString() }, null, 2), 'utf8');
  return `${id}.json`;
};

console.log('== A. 默认阈值 ==');
assert(RUN_KEEP_MAX_PER_WORKFLOW === 200 && RUN_KEEP_MAX_AGE_DAYS === 30, `默认＝每工作流 ${RUN_KEEP_MAX_PER_WORKFLOW} 条 / ${RUN_KEEP_MAX_AGE_DAYS} 天`);

console.log('== B. 每工作流保留最近 200 条（第 201 条起淘汰最旧的）==');
{
  const made = [];
  for (let i = 0; i < 205; i++) made.push(put(DAY + (205 - i) * 1000, 'many', `m${i}`));   // i 越大越新
  const r = await st.pruneRunRecords();
  assert(r.kept === 200 && r.deleted.length === 5, `删 5 留 200（实际 删 ${r.deleted.length} / 留 ${r.kept}）`);
  assert(r.deleted.join(',') === made.slice(0, 5).sort().join(','), `删的正是最旧的 5 条：${r.deleted.join(', ')}`);
  const left = list().filter((f) => /-m\d+\.json$/.test(f));
  assert(left.length === 200 && !left.includes(made[0]) && left.includes(made[204]), '磁盘上最旧 5 条已消失、最新一条还在');
}

console.log('== C. 超过 30 天即删（哪怕只有几条）==');
{
  const a = put(40 * DAY, 'aged', 'o1');
  const b = put(31 * DAY, 'aged', 'o2');
  const c = put(10 * DAY, 'aged', 'o3');
  const r = await st.pruneRunRecords();
  assert(r.deleted.includes(a) && r.deleted.includes(b), `40/31 天前的两条被删：${r.deleted.join(', ')}`);
  assert(!r.deleted.includes(c) && existsSync(join(runsDir, c)), '10 天前的那条保留');
}

console.log('== D. 只碰 run-*.json：其它文件与 workflow/ 一律不碰 ==');
{
  writeFileSync(join(runsDir, 'index.json'), '{"note":"不是运行记录"}', 'utf8');
  writeFileSync(join(runsDir, 'notes.txt'), 'hi', 'utf8');
  writeFileSync(join(runsDir, 'run-half.json.tmp'), 'partial', 'utf8');
  const wfDir = resolve(runsDir, '..', 'workflow');
  mkdirSync(wfDir, { recursive: true });
  writeFileSync(join(wfDir, 'keep-me.json'), '{"name":"keep-me","version":1,"nodes":[]}', 'utf8');
  await st.pruneRunRecords({ maxPerWorkflow: 0, maxAgeDays: 0 });   // 最激进：所有 run-*.json 都该删
  assert(existsSync(join(runsDir, 'index.json')) && existsSync(join(runsDir, 'notes.txt')), '非 run-*.json 的文件保留');
  assert(existsSync(join(runsDir, 'run-half.json.tmp')), '*.json.tmp 半成品保留（不被当成运行记录）');
  assert(existsSync(join(wfDir, 'keep-me.json')), 'workflow/ 下的工作流定义未被波及');
  assert(list().filter((f) => /^run-.*\.json$/.test(f)).length === 0, '激进口径下运行记录确实清空（证明上一条不是"什么都没删"）');
}

console.log('== E. 边界：正好 200 条不删；201 条只删 1 ==');
{
  for (let i = 0; i < 200; i++) put(DAY + (200 - i) * 1000, 'edge', `e${i}`);   // e0 最旧
  await st.pruneRunRecords();
  assert(list().filter((f) => /-e\d+\.json$/.test(f)).length === 200, '正好 200 条：一条不删');
  put(1000, 'edge', 'extra');                                                    // 最新一条
  await st.pruneRunRecords();
  const left = list().filter((f) => /-e\d+\.json$/.test(f));
  const extraAlive = list().some((f) => /-extra\.json$/.test(f));
  // 201 条里淘汰最旧的 1 条（e0）⇒ e* 剩 199，加上新写入的 extra 正好 200
  assert(left.length === 199 && extraAlive && !left.some((f) => /-e0\.json$/.test(f)), `201 条 → 留 200（含最新写入的那条），删掉的是最旧的 e0；e* 剩 ${left.length}`);
}

console.log('== F. dryRun 只算不删 ==');
{
  const before = list().length;
  const plan = await st.pruneRunRecords({ dryRun: true, maxPerWorkflow: 0, maxAgeDays: 0 });
  const runCount = list().filter((f) => /^run-.*\.json$/.test(f)).length;
  assert(plan.deleted.length === runCount && runCount > 0, `dryRun 报告 ${plan.deleted.length} 条待删（与磁盘上 ${runCount} 条一致）`);
  assert(list().length === before, 'dryRun 之后文件一个没少');
}

console.log('== G. 触发点：writeRunRecord 落盘后自动清理 ==');
{
  for (let i = 0; i < 201; i++) put(DAY + (201 - i) * 1000, 'hook', `h${i}`);    // 1 天前，不触发年龄规则
  const id = `run-${Date.now()}-hooknew`;
  await st.writeRunRecord(id, { runId: id, workflowName: 'hook', status: 'success', finishedAt: new Date().toISOString() });
  let n = 0;
  for (let k = 0; k < 50; k++) {
    n = list().filter((f) => /-h\d+\.json$/.test(f)).length;
    if (n <= 199) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  // 201 条旧的 + 刚写入的 1 条 = 202 → 淘汰最旧 2 条 ⇒ 旧记录剩 199，加新记录正好 200
  assert(n === 199, `自动清理把该工作流压回 200 条（旧记录剩 ${n} + 新写入 1 条）——清理是"写入后顺手做"`);
  assert(existsSync(join(runsDir, `${id}.json`)), '刚写入的这条一定还在（不会把自己清掉）');
}

console.log(`\n=== 运行记录保留策略：${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
