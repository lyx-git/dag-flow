// tmp-test/probe-merge-fanout.mjs — 实测两件事：
//  ①「固定 N 份并行扇出 + merge 汇总 + 下游取用」今天能否用
//  ②手写 def 只写 edges、不写 next，是否会被结构校验/可达性拒绝
const BASE = process.env.DF_BASE ?? 'http://127.0.0.1:3080/api/dag-flow';

const nodesWithNext = [
  { id: 'start', type: 'start', params: { topic: '扇出汇总探针' }, next: ['log_a', 'log_b', 'log_c'] },
  { id: 'log_a', type: 'log', params: { level: 'info', message: 'A-结果' }, next: 'merge1' },
  { id: 'log_b', type: 'log', params: { level: 'info', message: 'B-结果' }, next: 'merge1' },
  { id: 'log_c', type: 'log', params: { level: 'info', message: 'C-结果' }, next: 'merge1' },
  { id: 'merge1', type: 'merge', params: {}, next: 'log_out' },
  { id: 'log_out', type: 'log', params: { level: 'info', message: '汇总拿到的 A = {{merge1.out.log_a}}｜B = {{merge1.out.log_b}}' }, next: 'end' },
  { id: 'end', type: 'end' },
];
const edges = [
  { from: 'start', to: 'log_a' }, { from: 'start', to: 'log_b' }, { from: 'start', to: 'log_c' },
  { from: 'log_a', to: 'merge1' }, { from: 'log_b', to: 'merge1' }, { from: 'log_c', to: 'merge1' },
  { from: 'merge1', to: 'log_out' },
];
const stripNext = (ns) => ns.map(({ next, ...rest }) => rest);

const run = async (label, def) => {
  const r = await fetch(BASE + '/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ def }) });
  const j = await r.json();
  console.log(`\n=== ${label} → HTTP ${r.status} ===`);
  if (r.status !== 200 || !j.summary) { console.log('   ' + JSON.stringify(j).slice(0, 400)); return; }
  const R = j.summary.results ?? {};
  console.log(`   status=${j.summary.status}｜成功 ${j.summary.successCount} / 失败 ${j.summary.failedCount} / 跳过 ${j.summary.skippedCount}`);
  for (const [id, v] of Object.entries(R)) console.log(`   ${v.status === 'success' ? '✓' : '✗'} ${id.padEnd(9)} ${v.durationMs}ms  out=${JSON.stringify(v.out)?.slice(0, 110)}`);
  console.log(`   merge1 汇总对象 = ${JSON.stringify(R.merge1?.out)}`);
  console.log(`   下游 log_out = ${JSON.stringify(R.log_out?.out)}`);
  if (j.summary.error) console.log(`   顶层错误 = ${j.summary.error.code}: ${String(j.summary.error.message).slice(0, 300)}`);
};

await run('A. next + edges 都写（画布保存的形态）', { name: 'probe-merge-fanout', version: 1, nodes: nodesWithNext, edges });
await run('B. 只写 edges，不写 next', { name: 'probe-merge-edgesonly', version: 1, nodes: stripNext(nodesWithNext), edges });
