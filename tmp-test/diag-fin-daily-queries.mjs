// tmp-test/diag-fin-daily-queries.mjs — 打印最近一次运行里，8 个搜索节点实际发给 bing 的查询词 + 结果 URL
import { readFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:3080';
const WF = '金融政策日报';

const r = await fetch(`${BASE}/api/dag-flow/run/log?name=${encodeURIComponent(WF)}`);
if (!r.ok) { console.log(`/run/log ${r.status}`); process.exit(0); }
const d = await r.json();
const entries = d.entries ?? [];

console.log(`runId=${d.runId} status=${d.runStatus} 条目=${entries.length}\n`);

for (const e of entries) {
  if (e.type !== 'web_search') continue;
  const q = e.params?.query ?? e.rawParams?.query ?? '(无)';
  console.log(`=== ${e.id} ===`);
  console.log(`  实际 query（${String(q).length} 字）：${q}`);
  const results = e.out?.results ?? [];
  for (const [i, x] of results.entries()) {
    console.log(`   [${i + 1}] ${String(x?.title ?? '').slice(0, 46)}`);
    console.log(`       ${String(x?.url ?? '').slice(0, 96)}`);
  }
  console.log('');
}
