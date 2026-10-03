// tmp-test/live-demo-run.mjs — 在**正在运行的真实 dsh 宿主**上把演示工作流跑一遍
// 用途（2026-10-03 用户要求「验证 loop 功能」）：真实引擎 + 真实网络/LLM/人工确认，
//   端到端确认 loop_demo(count) 与 loop_over(遍历搜索结果) 的 out 正确，switch/if 分支走对。
// 跑法：node tmp-test/live-demo-run.mjs
import { readFileSync } from 'node:fs';

const BASE = process.env.DF_BASE ?? 'http://127.0.0.1:3080/api/dag-flow';
const FILE = process.env.DEMO_WF ?? 'D:/workspace/pluginspace/.dag-flow/workflow/全节点演示-技术简报.json';
const def = JSON.parse(readFileSync(FILE, 'utf8'));
console.log(`工作流：${def.name}（${def.nodes.length} 节点 / ${(def.edges ?? []).length} 边）`);

const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};

const t0 = Date.now();
let r = await post('/run', { def });
let summary = r.json?.summary;
console.log(`\n① POST /run → HTTP ${r.status}（${Date.now() - t0}ms）`);
if (r.status === 202) {
  console.log(`   暂停等人工确认：节点 ${r.json.awaiting?.nodeId}｜prompt=${String(r.json.awaiting?.prompt ?? '').slice(0, 60)}`);
  const runId = r.json.runId;
  const st = await (await fetch(`${BASE}/run/status?runId=${runId}`)).json();
  console.log(`② GET /run/status → status=${st.status} awaiting=${st.awaiting?.nodeId ?? '-'} 已完成节点=${Object.keys(st.results ?? {}).length}`);
  const doneIds = Object.entries(st.results ?? {}).filter(([, v]) => v.status === 'success').map(([k]) => k);
  console.log(`   挂起前已完成：${doneIds.join(', ')}`);
  const t1 = Date.now();
  const res = await post('/run/resume', { runId, value: '自动验证：继续生成简报' });
  console.log(`③ POST /run/resume → HTTP ${res.status}（${Date.now() - t1}ms）`);
  summary = res.json?.summary;
}

if (!summary) { console.log('\n❌ 没拿到 summary：' + JSON.stringify(r.json).slice(0, 400)); process.exit(1); }

console.log(`\n④ 运行结果：${summary.status}｜成功 ${summary.successCount} / 失败 ${summary.failedCount} / 跳过 ${summary.skippedCount}｜总耗时 ${summary.totalDurationMs}ms`);
if (summary.error) console.log(`   顶层错误：${summary.error.code} ${String(summary.error.message).slice(0, 200)}`);
console.log('   逐节点：');
for (const [id, res] of Object.entries(summary.results ?? {})) {
  const n = def.nodes.find((x) => x.id === id);
  const flag = res.status === 'success' ? '✓' : res.status === 'failed' ? '✗' : '○';
  const err = res.error ? ` ← ${res.error.code}: ${String(res.error.message).slice(0, 120)}` : '';
  console.log(`   ${flag} ${id.padEnd(16)} ${String(n?.type ?? '?').padEnd(15)} ${String(res.status).padEnd(7)} ${res.durationMs}ms${err}`);
}

const R = summary.results ?? {};
const show = (id) => (id in R ? JSON.stringify(R[id].out)?.slice(0, 220) : '(未执行)');
console.log('\n⑤ loop 证据：');
console.log(`   loop_demo（count:3）      out=${show('loop_demo')}`);
console.log(`   loop_over（遍历搜索结果） out=${show('loop_over')}`);
console.log(`   web_search1 结果条数      out.count=${R.web_search1?.out?.count}`);
console.log('\n⑥ 分支证据：');
console.log(`   if_has_search  out=${show('if_has_search')}`);
console.log(`   switch_mode    out=${show('switch_mode')}`);
console.log(`   end_final      out=${show('end_final')}`);
console.log('\n⑦ 未执行的节点（应为分支未激活）：' + Object.keys(R).length + ' 个节点有结果；共 ' + def.nodes.length + ' 个节点');
