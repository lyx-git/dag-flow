// tmp-test/probe-client-marker.mjs — 确认真机 dsh 提供给浏览器的 dag-flow 客户端 bundle 是否已是新版
// 用法：node tmp-test/probe-client-marker.mjs
const base = process.env.DF_BASE_ROOT ?? 'http://127.0.0.1:3080';
const MARKER = 'v20261003-model-label';

const html = await (await fetch(base + '/')).text();
const refs = [...new Set([...html.matchAll(/([^"'\s]*dag-flow[^"'\s]*)/gi)].map((m) => m[1]))];
console.log('root HTML 中含 dag-flow 的引用：', JSON.stringify(refs.slice(0, 12)));

const cands = [...new Set([
  ...refs.filter((r) => r.includes('.js')),
  '/api/client-plugins/dag-flow/client.js',
  '/client-plugins/dag-flow/client.js',
  '/api/dag-flow/client.js',
])];
let any = false;
for (const u of cands) {
  const url = u.startsWith('http') ? u : base + (u.startsWith('/') ? u : '/' + u);
  try {
    const r = await fetch(url);
    const t = await r.text();
    const hit = t.includes(MARKER);
    if (hit) any = true;
    console.log(`${hit ? '✅' : '  '} ${r.status} ${url}  marker=${hit}  bytes=${t.length}`);
  } catch (e) {
    console.log(`   ERR ${url} ${e.message}`);
  }
}
console.log(any ? `✅ 真机已提供含 ${MARKER} 的客户端 bundle` : `⚠ 没找到含 ${MARKER} 的客户端 bundle（可能 URL 猜错，不代表没生效）`);
