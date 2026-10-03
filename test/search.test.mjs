// test/search.test.mjs — web_search / web_fetch 节点测试（fixture 化，不打真实网络）
// 覆盖：5 个内置免 key 引擎解析、bing 无关缓存 SERP 识别→回退链、宿主优先（成功/失败回落/仅宿主报错）、
//      空参快失败、web_fetch 剥 HTML/JSON/raw/HTTP 错误/超参钳制。
// 跑法：node test/search.test.mjs
import * as http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.chdir(mkdtempSync(join(tmpdir(), 'dag-search-')));
const routes = [];
const stubLogger = { info() {}, warn() {}, error() {} };
const stubCtx = { logger: stubLogger, webServer: { register(r) { routes.push(r); return () => {}; } } };
const mod = await import('file:///D:/workspace/pluginspace/dag-flow/dist/index.js');
mod.apply(stubCtx);

const server = http.createServer(async (req, res) => {
  const pn = new URL(req.url, 'http://x').pathname;
  const ex = routes.find((r) => r.kind === 'exact' && r.path === pn);
  const px = routes.find((r) => r.kind === 'prefix' && (pn === r.path || pn.startsWith(r.path + '/')));
  const h = ex?.handler ?? px?.handler;
  if (!h) { res.statusCode = 404; res.end('no route'); return; }
  try { await h(req, res); } catch (e) { res.statusCode = 500; res.end(String(e?.message ?? e)); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}/api/dag-flow`;
const runNode = async (nodeType, params = {}, inputs = {}) => {
  const r = await fetch(base + '/run-node', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nodeType, params, inputs }) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
const target = (r) => r.body?.summary?.results?.target;

// ===== fixtures（>500 字节避免 retry 的 empty-response 分支） =====
const BING_HTML = `<!DOCTYPE html><html><head><title>bing</title></head><body><!-- ${'bing pad '.repeat(20)} --><ol id="b_results">` +
  `<li class="b_algo"><h2><a href="https://example.com/flowgram">FlowGram 视觉化工作流引擎</a></h2><div class="b_caption"><p>FlowGram 是字节开源的流程画布引擎，支持 DAG 编辑与节点表单。</p></div></li>` +
  `<li class="b_algo"><h2><a href="https://example.org/reactflow">React Flow 流程库对比</a></h2><div class="b_caption"><p>React Flow 是另一个 React 流程图库。</p></div></li>` +
  `</ol></body></html>`;

const DDG_LITE_HTML = `<!DOCTYPE html><html><head><title>lite</title></head><body><!-- ${'lite pad '.repeat(20)} --><table>` +
  `<tr><td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fone&amp;rut=abc" class="result-link">Example One 标题</a></td></tr>` +
  `<tr><td class="result-snippet">First lite snippet 文本，包含说明信息。</td></tr>` +
  `<tr><td><a rel="nofollow" href="https://example.com/two" class="result-link">Example Two 标题</a></td></tr>` +
  `<tr><td class="result-snippet">Second lite snippet 文本。</td></tr>` +
  `</table></body></html>`;

const DDG_HTML_DOC = `<!DOCTYPE html><html><head><title>ddg</title></head><body><!-- ${'ddg pad '.repeat(20)} -->` +
  `<div class="result results_links results_links_deep web-result"><div class="links_main links_deep"><div class="result__body">` +
  `<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fddg">DDG Result 标题</a>` +
  `<a class="result__snippet" href="#">DDG html snippet 正文内容。</a>` +
  `</div></div></div></body></html>`;

const SEARXNG_JSON = { results: [
  { url: 'https://example.com/sxg1', title: 'SearXNG Result One', content: 'searxng 第一条内容摘要。' },
  { url: 'https://example.com/sxg2', title: 'SearXNG Result Two', content: 'searxng 第二条内容摘要。' },
] };

const ANYSEARCH_JSON = { code: 0, data: { results: [
  { url: 'https://example.com/any1', title: 'AnySearch Result One', snippet: 'anysearch 第一条摘要。' },
] } };

const PAGE_HTML = `<!DOCTYPE html><html><head><title>页面</title><style>body{color:red}</style></head>` +
  `<body><script>var tracked = "不应出现在正文";</script><h1>正文标题</h1><p>这是正文可见内容，包含关键信息。</p>` +
  `<div>第二段文字。</div>${'<!-- 注释不应出现 -->'.repeat(3)}</body></html>`;

// ===== fetch 路由桩（127.0.0.1 直通真实测试服务器） =====
const realFetch = globalThis.fetch;
let failAnysearch = false;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url ?? String(input);
  if (url.startsWith('http://127.0.0.1')) return realFetch(input, init);
  let u;
  try { u = new URL(url); } catch { throw new Error('unmocked url: ' + url); }
  if (u.hostname === 'www.bing.com' && u.pathname === '/search') return new Response(BING_HTML, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  if (u.hostname === 'lite.duckduckgo.com') return new Response(DDG_LITE_HTML, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  if (u.hostname === 'html.duckduckgo.com') return new Response(DDG_HTML_DOC, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  if (u.pathname === '/search' && u.searchParams.get('format') === 'json') return new Response(JSON.stringify(SEARXNG_JSON), { status: 200, headers: { 'content-type': 'application/json' } });
  if (u.hostname === 'api.anysearch.com') {
    if (failAnysearch) return new Response('any down', { status: 500 });
    return new Response(JSON.stringify(ANYSEARCH_JSON), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (u.hostname === 'example.com' && u.pathname === '/page') return new Response(PAGE_HTML, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  if (u.hostname === 'example.com' && u.pathname === '/flowgram') return new Response(`<!DOCTYPE html><html><body><h1>FlowGram 页面</h1><p>${'正文内容填充 '.repeat(20)}</p></body></html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  if (u.hostname === 'example.com' && u.pathname === '/api.json') return new Response(JSON.stringify({ ok: true, n: 42, items: ['a', 'b'] }), { status: 200, headers: { 'content-type': 'application/json' } });
  if (u.hostname === 'example.com' && u.pathname === '/broken') return new Response('boom', { status: 500 });
  throw new Error('unmocked url: ' + url);
};

// ===== A. web_search：内置引擎链 =====
{
  const r = await runNode('web_search', { query: 'FlowGram 画布引擎', count: 5 });
  const out = target(r)?.out;
  t('A1. auto → 命中内置 bing 引擎并解析出结果', target(r)?.status === 'success' && out?.engine === 'bing' && out?.viaHost === false, JSON.stringify(out)?.slice(0, 200));
  t('A2. bing 结果字段完整（title/url/snippet）', out?.results?.[0]?.url === 'https://example.com/flowgram' && String(out?.results?.[0]?.title).includes('FlowGram') && String(out?.results?.[0]?.snippet).includes('流程画布'), JSON.stringify(out?.results?.[0]));
  t('A3. count 钳制生效（count=5 → 最多 5 条）', Array.isArray(out?.results) && out?.results?.length <= 5 && out?.count === out?.results?.length, JSON.stringify(out?.count));
}
{
  // bing 返回与查询无关的缓存 SERP（内容不含查询 token）→ 判 0 条 → 回退 ddg-lite
  const r = await runNode('web_search', { query: '完全不相关的查询词xyzzyq', count: 5 });
  const out = target(r)?.out;
  t('A4. bing 无关缓存页 → 自动回退 ddg-lite', target(r)?.status === 'success' && out?.engine === 'ddg-lite' && out?.results?.length >= 1, JSON.stringify(out)?.slice(0, 200));
  t('A5. ddg-lite uddg 跳转链接已解码', out?.results?.[0]?.url === 'https://example.com/one', JSON.stringify(out?.results?.[0]?.url));
}
{
  const r = await runNode('web_search', { query: 'searxng 查询', provider: 'searxng', count: 3 });
  const out = target(r)?.out;
  t('A6. provider=searxng → 公共实例 JSON 解析', target(r)?.status === 'success' && out?.engine === 'searxng' && out?.results?.[0]?.url === 'https://example.com/sxg1', JSON.stringify(out)?.slice(0, 200));
}
{
  const r = await runNode('web_search', { query: 'ddg 查询', provider: 'ddg', count: 3 });
  const out = target(r)?.out;
  t('A7. provider=ddg → HTML SERP 解析', target(r)?.status === 'success' && out?.engine === 'ddg' && out?.results?.[0]?.url === 'https://example.com/ddg' && String(out?.results?.[0]?.title).includes('DDG'), JSON.stringify(out)?.slice(0, 200));
}
{
  const r = await runNode('web_search', { query: 'any 查询', provider: 'anysearch', count: 3 });
  const out = target(r)?.out;
  t('A8. provider=anysearch → 匿名 JSON API 解析', target(r)?.status === 'success' && out?.engine === 'anysearch' && out?.results?.[0]?.url === 'https://example.com/any1', JSON.stringify(out)?.slice(0, 200));
}
{
  failAnysearch = true;
  const r = await runNode('web_search', { query: '必挂查询', provider: 'anysearch', count: 3 });
  failAnysearch = false;
  const tg = target(r);
  t('A9. 引擎全挂 → 明确失败 SEARCH_FAILED（含聚合错误）', tg?.status === 'failed' && tg?.error?.code === 'SEARCH_FAILED' && String(tg?.error?.message).includes('所有搜索引擎均失败') && String(tg?.error?.message).includes('anysearch'), JSON.stringify(tg?.error)?.slice(0, 200));
}
{
  const t0 = Date.now();
  const r = await runNode('web_search', { query: '   ', count: 3 });
  const tg = target(r);
  t('A10. query 留空 → 快失败 SEARCH_EMPTY_QUERY（不发网络请求）', tg?.status === 'failed' && tg?.error?.code === 'SEARCH_EMPTY_QUERY' && tg?.durationMs < 50, JSON.stringify(tg)?.slice(0, 160));
  t('A11. 空白 query 同样快失败且耗时极短', Date.now() - t0 < 500, `wall=${Date.now() - t0}ms`);
}

// ===== B. 宿主优先（方案 C） =====
{
  const fakeToolsOk = {
    get: (n) => (n === 'web_search' ? { ok: true } : undefined),
    execute: async () => ({ sources: [{ url: 'https://host.example/a', title: 'Host A', snippet: '来自宿主的搜索结果' }] }),
  };
  mod.apply({ logger: stubLogger, webServer: { register() {} }, tools: fakeToolsOk });
  const r = await runNode('web_search', { query: 'host 优先查询', count: 5 });
  const out = target(r)?.out;
  t('B1. 宿主有 web_search 工具 → auto 优先走宿主', target(r)?.status === 'success' && out?.viaHost === true && out?.engine === 'host:web_search', JSON.stringify(out)?.slice(0, 200));
  t('B2. 宿主结果归一化（title/snippet 保留）', out?.results?.[0]?.url === 'https://host.example/a' && String(out?.results?.[0]?.title).includes('Host A') && String(out?.results?.[0]?.snippet).includes('宿主'), JSON.stringify(out?.results?.[0]));
}
{
  const fakeToolsErr = { get: () => ({}), execute: async () => { throw new Error('boom: callId rejected'); } };
  mod.apply({ logger: stubLogger, webServer: { register() {} }, tools: fakeToolsErr });
  const r = await runNode('web_search', { query: 'FlowGram 画布引擎', count: 5 });
  const out = target(r)?.out;
  t('B3. 宿主调用抛错 → 静默回落内置链（bing）', target(r)?.status === 'success' && out?.viaHost === false && out?.engine === 'bing', JSON.stringify(out)?.slice(0, 200));
}
{
  mod.apply({ logger: stubLogger, webServer: { register() {} } }); // 无 tools 服务
  const r = await runNode('web_search', { query: '仅宿主查询', provider: 'host', count: 5 });
  const tg = target(r);
  t('B4. provider=host 且宿主未装插件 → 明确报错指引', tg?.status === 'failed' && tg?.error?.code === 'SEARCH_FAILED' && String(tg?.error?.message).includes('宿主 web_search 工具不可用'), JSON.stringify(tg?.error)?.slice(0, 200));
}

// ===== C. web_fetch =====
{
  const r = await runNode('web_fetch', { url: 'https://example.com/page' });
  const out = target(r)?.out;
  t('C1. web_fetch HTML → 剥出正文文本', target(r)?.status === 'success' && out?.mode === 'text' && out?.status === 200, JSON.stringify(out)?.slice(0, 160));
  t('C2. 正文无标签/script/注释残留，保留可见文字', !String(out?.text).includes('<') && !String(out?.text).includes('不应出现') && !String(out?.text).includes('注释不应出现') && String(out?.text).includes('正文可见内容') && String(out?.text).includes('正文标题'), JSON.stringify(out?.text)?.slice(0, 200));
}
{
  const r = await runNode('web_fetch', { url: 'https://example.com/api.json' });
  const out = target(r)?.out;
  t('C3. web_fetch JSON → mode=json 且解析为对象', target(r)?.status === 'success' && out?.mode === 'json' && out?.json?.ok === true && out?.json?.n === 42, JSON.stringify(out)?.slice(0, 160));
}
{
  const r = await runNode('web_fetch', { url: 'https://example.com/page', raw: true });
  const out = target(r)?.out;
  t('C4. raw=true → 返回原始响应体', target(r)?.status === 'success' && out?.mode === 'raw' && String(out?.text).includes('<script>'), JSON.stringify(out)?.slice(0, 160));
}
{
  const r = await runNode('web_fetch', { url: 'https://example.com/broken' });
  const tg = target(r);
  t('C5. HTTP 500 → 明确失败 FETCH_FAILED（含状态码）', tg?.status === 'failed' && tg?.error?.code === 'FETCH_FAILED' && String(tg?.error?.message).includes('HTTP 500'), JSON.stringify(tg?.error)?.slice(0, 160));
}
{
  const r = await runNode('web_fetch', { url: 'https://example.com/page', maxChars: 300 });
  const out = target(r)?.out;
  t('C6. maxChars 钳制正文长度', target(r)?.status === 'success' && String(out?.text).length <= 300 && out?.chars === String(out?.text).length, `len=${String(out?.text).length}`);
}
{
  const r = await runNode('web_fetch', { url: '' });
  const tg = target(r);
  t('C7. url 留空 → 快失败 FETCH_NO_URL', tg?.status === 'failed' && tg?.error?.code === 'FETCH_NO_URL' && tg?.durationMs < 50, JSON.stringify(tg)?.slice(0, 160));
}

// ===== D. 全流程：搜索 → 抓取 → end（DAG /run） =====
{
  const def = {
    name: 'search-fetch-flow', version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'ws', type: 'web_search', params: { query: 'FlowGram 画布引擎', count: 3 } },
      { id: 'wf', type: 'web_fetch', params: { url: '{{ws.out.results.0.url}}' } },
      { id: 'end', type: 'end' },
    ],
    edges: [
      { from: 'start', to: 'ws' },
      { from: 'ws', to: 'wf' },
      { from: 'wf', to: 'end' },
    ],
  };
  const r = await fetch(base + '/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ def }) });
  const data = await r.json().catch(() => ({}));
  const res = data.summary?.results ?? {};
  t('D1. 搜索→抓取 全流程 success', data.summary?.status === 'success' && res.ws?.status === 'success' && res.wf?.status === 'success', JSON.stringify(data.summary?.error));
  t('D2. 搜索结果 URL 经 {{}} 引用传递给 web_fetch', res.wf?.out?.url === 'https://example.com/flowgram' && res.wf?.out?.mode === 'text', JSON.stringify(res.wf?.out)?.slice(0, 160));
}

globalThis.fetch = realFetch;
server.close();
console.log(`\n=== search tests: ${pass} passed, ${fail} failed ===`);
if (fail > 0) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
