// tmp-test/diag-websearch-probe2.mjs — 定性：日期前缀是否把搜索结果带偏 / 短查询是否更准
const BASE = 'http://127.0.0.1:3080';

async function probe(label, query) {
  const r = await fetch(`${BASE}/api/dag-flow/run-node`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeType: 'web_search', params: { provider: 'bing', query } }),
  });
  const d = await r.json().catch(() => null);
  const t = d?.summary?.results?.target ?? d?.results?.target ?? null;
  const results = t?.out?.results ?? [];
  console.log(`\n=== ${label} ===  query = ${JSON.stringify(query)}  → ${results.length} 条`);
  for (const [i, x] of results.slice(0, 5).entries()) {
    console.log(`   [${i + 1}] ${String(x?.title ?? '').slice(0, 52)}`);
    console.log(`       ${String(x?.url ?? '').slice(0, 84)}`);
  }
}

await probe('D 短查询·无日期', '央行 降准');
await probe('E 中文日期前缀', '2026年10月8日 央行 降准');
await probe('F 三词·无日期', '金融政策 央行 降准');
