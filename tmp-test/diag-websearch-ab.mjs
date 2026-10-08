// tmp-test/diag-websearch-ab.mjs — A/B 实测：查询词里的换行是否会毁掉搜索结果
//   走真实插件的 /run-node（单节点试跑），provider=bing，只搜不发 LLM（不花钱）
const BASE = 'http://127.0.0.1:3080';

async function runNode(label, query) {
  const body = { nodeType: 'web_search', params: { provider: 'bing', query } };
  const r = await fetch(`${BASE}/api/dag-flow/run-node`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => null);
  const target = d?.summary?.results?.target ?? d?.results?.target ?? null;
  const results = target?.out?.results ?? [];
  console.log(`\n=== ${label} ===`);
  console.log(`  query = ${JSON.stringify(query)}`);
  console.log(`  HTTP ${r.status}；status=${target?.status ?? d?.status ?? '?'}；结果 ${results.length} 条`);
  if (target?.error) console.log(`  error = ${JSON.stringify(target.error)}`);
  for (const [i, x] of results.slice(0, 4).entries()) {
    console.log(`   [${i + 1}] ${String(x?.title ?? '').slice(0, 50)}  ← ${String(x?.url ?? '').slice(0, 70)}`);
  }
  return results.map((x) => x?.url ?? '').join('|');
}

const a = await runNode('A 带尾随换行（复刻现状）', '2026-10-08\n金融政策 央行 降准');
const b = await runNode('B 不带换行（干净查询）', '2026-10-08 金融政策 央行 降准');
const c = await runNode('C 纯关键词（无日期）', '金融政策 央行 降准 最新');

console.log('\n=== 结论 ===');
console.log('A 与 B 结果是否相同：' + (a === b ? '相同 ← 换行把查询毁了' : '不同 ← 换行不影响'));
console.log('B 与 C 结果是否相同：' + (b === c ? '相同 ← 搜索没按查询词走（解析/请求有问题）' : '不同 ← 搜索确实按查询词走'));
