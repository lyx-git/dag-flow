// tmp-test/verify-fin-daily-v2-pipeline.mjs — 不花钱的端到端验证：
//   把新工作流的 AI/mail 节点换成 log（不调 LLM、不发邮件），用真实引擎跑一遍，
//   证明「8 路搜索 + 7 个采集器」在插件内部真的能跑通（模板注入 / 内置 Python / 超时 / 环境）。
import { readFileSync } from 'node:fs';

const SRC = 'D:/workspace/pluginspace/.dag-flow/workflow/金融政策日报.json';
const BASE = 'http://127.0.0.1:3080';
const def = JSON.parse(readFileSync(SRC, 'utf8'));

// —— 把花钱/发信的节点换成 log ——
let swapped = 0;
for (const n of def.nodes) {
  if (n.type === 'subagent' || n.id === 'mail') {
    n.type = 'log';
    n.params = { message: `[验证轮] 跳过 ${n.id}` };
    swapped++;
  }
}
console.log(`已把 ${swapped} 个节点换成 log（不调 LLM / 不发邮件）`);

const t0 = Date.now();
const r = await fetch(`${BASE}/api/dag-flow/run`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ def, skipSelfcheck: true }),
});
const d = await r.json().catch(() => null);
const secs = ((Date.now() - t0) / 1000).toFixed(1);
if (!d) { console.log(`HTTP ${r.status} 无 JSON 响应`); process.exit(1); }
const sum = d.summary ?? d;
console.log(`\nHTTP ${r.status}｜${secs}s｜status=${sum.status} 成功=${sum.successCount ?? '?'} 失败=${sum.failedCount ?? '?'} 跳过=${sum.skippedCount ?? '?'}`);
if (sum.status === 'failed' && !Object.keys(sum.results ?? {}).length) {
  console.log('\n=== 未进入执行（预检/校验层失败），原始响应 ===');
  console.log(JSON.stringify(d, null, 1).slice(0, 2000));
  process.exit(1);
}

const results = sum.results ?? {};
console.log('\n=== 采集器结果（材料量）===');
let ok = 0, thin = 0, fail = 0;
for (const [id, res] of Object.entries(results)) {
  if (!id.startsWith('py_')) continue;
  const out = typeof res.out === 'string' ? res.out : '';
  const lines = out.split('\n');
  const first = lines[0] || '(空)';
  const second = lines[1] || '';
  const status2 = lines.find((l) => l.startsWith('MATERIAL_')) ?? '';
  console.log(`  ${id.padEnd(10)} ${String(res.status).padEnd(8)} ${String(res.durationMs ?? '').padStart(7)}ms  ${(status2 || first).slice(0, 78)}`);
  if (first.startsWith('源发现')) console.log(`  ${' '.repeat(10)} ${first.slice(0, 100)}`);
  if (res.status !== 'success') { fail++; continue; }
  if (status2.includes('MATERIAL_OK')) ok++;
  else if (status2.includes('MATERIAL_THIN')) thin++;
  else fail++;
}
console.log(`\n采集器：MATERIAL_OK ${ok} / MATERIAL_THIN ${thin} / 异常 ${fail}`);

console.log('\n=== 搜索节点 ===');
for (const [id, res] of Object.entries(results)) {
  if (!id.startsWith('srch_')) continue;
  console.log(`  ${id.padEnd(14)} ${String(res.status).padEnd(8)} 结果 ${res.out?.count ?? '?'} 条`);
}

const bad = Object.entries(results).filter(([, r2]) => r2.status === 'failed');
if (bad.length) {
  console.log('\n=== 失败节点 ===');
  for (const [id, res] of bad) console.log(`  ${id}: ${res.error?.code} ${String(res.error?.message).slice(0, 160)}`);
}
console.log(bad.length === 0 ? '\n✅ 全流程无失败节点' : `\n❌ 有 ${bad.length} 个失败节点`);
