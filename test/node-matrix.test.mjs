import './_isolate-home.mjs';   // ★ 2026-10-11：隔离 DSH_HOME（存储根 = <DSH_HOME>/.dag-flow）
// test/node-matrix.test.mjs — 18 节点逐节点执行矩阵（每个节点真实走 start→target→end）
// 可独立执行节点走 /run-node；依赖上游数据的节点（merge/loop.over 等）已在 api-e2e 覆盖。
// 跑法：node test/node-matrix.test.mjs
import * as http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

process.chdir(mkdtempSync(join(tmpdir(), 'dag-nodematrix-')));
const routes = [];
const stubCtx = { logger: { info() {}, warn() {}, error() {} }, webServer: { register(r) { routes.push(r); return () => {}; } } };
const mod = await import('file:///D:/workspace/pluginspace/dag-flow/dist/index.js');
mod.apply(stubCtx);

// mock 上游 HTTP 服务（http 节点 + subagent 优雅失败用）
let pingHits = 0;
const mockSrv = http.createServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://x');
  if (u.pathname === '/ping') { pingHits++; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, msg: 'pong' })); return; }
  res.statusCode = 404; res.end('mock 404');
});
await new Promise((ok) => mockSrv.listen(0, '127.0.0.1', ok));
const mockPort = mockSrv.address().port;

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

// ===== A. 注册齐全 =====
{
  const r = await fetch(base + '/nodes');
  const types = (await r.json())?.nodes ?? [];
  const expected = ['start', 'end', 'python', 'bash', 'http', 'web_search', 'web_fetch', 'subagent', 'session_input', 'if', 'switch', 'merge', 'subflow', 'image_generate', 'video_generate', 'file_save', 'loop', 'set_var', 'log', 'manual'];
  t('A. /nodes 返回全部 20 节点类型', expected.every((x) => types.includes(x)) && types.length === 20, JSON.stringify(types));
}

// ===== B. 逐节点执行 =====
// 1. log（最简单：真实成功）
{
  const r = await runNode('log', { level: 'info', message: 'matrix-log' });
  t('1. log → success 且输出消息', target(r)?.status === 'success' && target(r)?.out === 'matrix-log');
}
// 2. set_var（写入 vars，无下游引用时输出自身）
{
  const r = await runNode('set_var', { vars: { k1: 'v1', k2: 2 } });
  const out = target(r)?.out;
  t('2. set_var → success 且回显写入键值', target(r)?.status === 'success' && out?.k1 === 'v1' && out?.k2 === 2, JSON.stringify(out));
}
// 3. manual（同步模式返回 awaitingUser）
{
  const r = await runNode('manual', { prompt: '请确认参数' });
  const out = target(r)?.out;
  // ★ 2026-10-03 更新：manual 已从 v0.1 空壳改为「真暂停 + 恢复」。/run-node 是非交互路径（不传 interactive），
  //   按契约自动通过并留痕 autoPassed=true；交互式挂起/恢复由 test/manual-await.test.mjs（20 断言）覆盖。
  t('3. manual 非交互自动通过（autoPassed=true + confirmed）', target(r)?.status === 'success' && out?.autoPassed === true && out?.confirmed === true && out?.prompt === '请确认参数', JSON.stringify(out));
}
// 4. http（真实 GET 本地 mock）
{
  const r = await runNode('http', { method: 'GET', url: `http://127.0.0.1:${mockPort}/ping`, timeoutMs: 5000 });
  const out = target(r)?.out;
  t('4. http GET → success 且解析 JSON body', target(r)?.status === 'success' && out?.body?.ok === true && out?.body?.msg === 'pong', JSON.stringify(out)?.slice(0, 160));
  t('4b. http 确实打到了 mock 服务', pingHits >= 1);
}
// 5. bash（依赖 runtime：success 或优雅 failed+错误码，不允许崩溃/无 error）
{
  const r = await runNode('bash', { code: 'echo dag-bash-echo', timeoutMs: 5000 });
  const tg = target(r);
  t('5. bash → 有明确结果（success 输出 / failed 带错误码）', tg?.status === 'success' || (tg?.status === 'failed' && Boolean(tg?.error?.code)), JSON.stringify(tg)?.slice(0, 140));
}
// 6. python（同上：runtime 缺失优雅失败）
{
  const r = await runNode('python', { code: 'print("matrix-py")', timeoutMs: 5000 });
  const tg = target(r);
  t('6. python → 有明确结果', tg?.status === 'success' || (tg?.status === 'failed' && Boolean(tg?.error?.code)), JSON.stringify(tg)?.slice(0, 140));
}
// 7. subagent（模型必选：未选 → MODEL_REQUIRED，不调 LLM）
{
  const r = await runNode('subagent', { prompt: 'matrix', model: '' });
  const tg = target(r);
  t('7. subagent 未选模型 → 明确失败 MODEL_REQUIRED', tg?.status === 'failed' && tg?.error?.code === 'MODEL_REQUIRED', JSON.stringify(tg)?.slice(0, 140));
}
// 7a. subagent（不存在的模型 id → 优雅失败 SUBAGENT_UNAVAILABLE/超时，不崩）
{
  const r = await runNode('subagent', { prompt: 'matrix', model: 'nonexistent-model-xyz', timeoutMs: 3000 });
  const tg = target(r);
  t('7a. subagent → 优雅失败（SUBAGENT_UNAVAILABLE / 超时）', tg?.status === 'failed' && /SUBAGENT_UNAVAILABLE|timeout/.test(tg?.error?.code ?? tg?.error?.message ?? ''), JSON.stringify(tg)?.slice(0, 140));
}
// 7b. subagent 留空 → 不执行、中断流程（SUBAGENT_EMPTY_PROMPT，且不调 LLM）
{
  const r = await runNode('subagent', { prompt: '', model: 'nonexistent-model-xyz', timeoutMs: 3000 });
  const tg = target(r);
  t('7b. subagent prompt 留空 → 中断（SUBAGENT_EMPTY_PROMPT，秒返不调 LLM）', tg?.status === 'failed' && tg?.error?.code === 'SUBAGENT_EMPTY_PROMPT' && tg?.durationMs < 50, JSON.stringify(tg)?.slice(0, 160));
  const r2 = await runNode('subagent', { prompt: '   ', model: 'nonexistent-model-xyz', timeoutMs: 3000 });
  t('7c. subagent prompt 纯空白 → 同样中断', r2.body?.summary?.results?.target?.error?.code === 'SUBAGENT_EMPTY_PROMPT');
}
// 7d. subagent 空输出（2026-10-03 用户报「AI 节点成功但正文为空」）：
//     mock LLM 返回 200 + 纯空白 content → 节点绝不许报 success（否则下游/落盘静默拿到空内容）
{
  const emptySrv = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '   ' } }], output: [] }));
  });
  await new Promise((ok) => emptySrv.listen(0, '127.0.0.1', ok));
  const emptyPort = emptySrv.address().port;
  const saved = { b: process.env.DAG_FLOW_LLM_BASEURL, k: process.env.DAG_FLOW_LLM_KEY, m: process.env.DAG_FLOW_LLM_MODEL };
  process.env.DAG_FLOW_LLM_BASEURL = `http://127.0.0.1:${emptyPort}/v1`;
  process.env.DAG_FLOW_LLM_KEY = 'sk-mock-empty';
  process.env.DAG_FLOW_LLM_MODEL = 'mock-empty-out';
  try {
    const r = await runNode('subagent', { prompt: '空输出探针', model: 'mock-empty-out', timeoutMs: 5000 });
    const tg = target(r);
    t('7d. subagent 空输出 → 绝不 success（SUBAGENT_EMPTY_OUTPUT）', tg?.status === 'failed' && tg?.error?.code === 'SUBAGENT_EMPTY_OUTPUT', JSON.stringify(tg)?.slice(0, 200));
    t('7d-2. 错误消息说明不再按成功处理', /不再按成功处理/.test(String(tg?.error?.message ?? '')), String(tg?.error?.message ?? '').slice(0, 120));
  } finally {
    emptySrv.close();
    if (saved.b === undefined) delete process.env.DAG_FLOW_LLM_BASEURL; else process.env.DAG_FLOW_LLM_BASEURL = saved.b;
    if (saved.k === undefined) delete process.env.DAG_FLOW_LLM_KEY; else process.env.DAG_FLOW_LLM_KEY = saved.k;
    if (saved.m === undefined) delete process.env.DAG_FLOW_LLM_MODEL; else process.env.DAG_FLOW_LLM_MODEL = saved.m;
  }
}
// 8. session_input（读取真实 ~/.dsh/sessions；无匹配会话也须结构完整）
{
  const r = await runNode('session_input', { sessionId: '', limit: 3 });
  const tg = target(r);
  t('8. session_input → 有输出结构（内容或空）', tg != null && (tg.status === 'success' || tg.status === 'failed'), JSON.stringify(tg)?.slice(0, 140));
}
// 9. if（条件求值）
{
  const r = await runNode('if', { condition: '1 > 0' });
  const tg = target(r);
  t('9. if → success 且输出布尔', target(r)?.status === 'success' && tg?.out === true, JSON.stringify(tg)?.slice(0, 100));
}
// 10. switch（case 求值）
{
  const r = await runNode('switch', { value: '"beta"', cases: { alpha: 'n1', beta: 'n2' } });
  const out = target(r)?.out;
  t('10. switch → matched=beta 且 target=n2', target(r)?.status === 'success' && out?.matched === 'beta' && out?.target === 'n2', JSON.stringify(out));
}
// 11. loop（count 计数）
{
  const r = await runNode('loop', { count: 4 });
  const out = target(r)?.out;
  t('11. loop count=4 → items 4 项', target(r)?.status === 'success' && out?.count === 4 && out?.items?.length === 4, JSON.stringify(out));
}
// 12. merge（无上游 → 明确失败提示）
{
  const r = await runNode('merge', {});
  const tg = target(r);
  t('12. merge 无上游 → 明确失败 MERGE_NO_UPSTREAM', tg?.status === 'failed' && tg?.error?.code === 'MERGE_NO_UPSTREAM', JSON.stringify(tg)?.slice(0, 120));
}
// 13. subflow（不存在的子工作流 → 明确失败提示）
{
  const r = await runNode('subflow', { workflowName: 'matrix-not-exist' });
  const tg = target(r);
  t('13. subflow 不存在 → 明确失败 WORKFLOW_NOT_FOUND', tg?.status === 'failed' && tg?.error?.code === 'WORKFLOW_NOT_FOUND', JSON.stringify(tg)?.slice(0, 120));
}
// 14. image_generate（缺 key → 明确失败提示）
{
  const r = await runNode('image_generate', { prompt: 'm', baseURL: `http://127.0.0.1:${mockPort}` });
  const tg = target(r);
  t('14. image_generate 缺 Key → 明确失败 IMAGE_NO_KEY', tg?.status === 'failed' && tg?.error?.code === 'IMAGE_NO_KEY', JSON.stringify(tg)?.slice(0, 120));
}
// 15. video_generate（缺 pollUrl → 明确失败提示）
{
  const r = await runNode('video_generate', { submitUrl: `http://127.0.0.1:${mockPort}/video/submit` });
  const tg = target(r);
  t('15. video_generate 缺 pollUrl → 明确失败 VIDEO_NO_POLL', tg?.status === 'failed' && tg?.error?.code === 'VIDEO_NO_POLL', JSON.stringify(tg)?.slice(0, 120));
}
// 16. file_save（text 落盘）
{
  const r = await runNode('file_save', { source: 'text', content: 'node-matrix', filename: 'matrix/nm.txt' });
  const out = target(r)?.out;
  t('16. file_save text → success 且落盘（.dag-flow/ 根下）', target(r)?.status === 'success' && out?.path === '.dag-flow/matrix/nm.txt', JSON.stringify(out));
}
// 17. start / 18. end（组合已有覆盖，这里补独立语义：start 输出 params）
{
  // start 输出 params 的行为在 /run 全流程已覆盖（e2e-loop-over start.params.items），
  // 此处仅验证 end 节点可通过 run-node 校验拒绝（end 不可单跑）
  const r = await runNode('end', {});
  t('17. start/end 不可单独试跑（400 引导）', r.status === 400, `status=${r.status}`);
}
// 16b. web_search（stub fetch → 内置 bing 引擎链；详细矩阵见 test/search.test.mjs）
{
  const realFetch = globalThis.fetch;
  const bingFixture = `<!DOCTYPE html><html><body><!-- ${'nm pad '.repeat(60)} --><ol id="b_results"><li class="b_algo"><h2><a href="https://example.com/nm-hit">Node Matrix Hit</a></h2><div class="b_caption"><p>node matrix bing snippet 文本。</p></div></li></ol></body></html>`;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url ?? String(input);
    if (url.startsWith('http://127.0.0.1')) return realFetch(input, init);
    if (url.startsWith('https://www.bing.com/search')) return new Response(bingFixture, { status: 200, headers: { 'content-type': 'text/html' } });
    throw new Error('unmocked: ' + url);
  };
  try {
    const r = await runNode('web_search', { query: 'matrix search', count: 5 });
    const out = target(r)?.out;
    t('16b. web_search → success 且内置 bing 引擎解析结果', target(r)?.status === 'success' && out?.engine === 'bing' && out?.viaHost === false && out?.results?.[0]?.url === 'https://example.com/nm-hit', JSON.stringify(out)?.slice(0, 160));
  } finally { globalThis.fetch = realFetch; }
}
// 16c. web_fetch（stub fetch → 剥 HTML 正文）
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url ?? String(input);
    if (url.startsWith('http://127.0.0.1')) return realFetch(input, init);
    if (url === 'https://example.com/nm-page') return new Response('<html><body><script>var q=1;</script><h1>标题</h1><p>正文段落内容</p></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    throw new Error('unmocked: ' + url);
  };
  try {
    const r = await runNode('web_fetch', { url: 'https://example.com/nm-page' });
    const out = target(r)?.out;
    t('16c. web_fetch → success 且剥 HTML 取正文', target(r)?.status === 'success' && out?.mode === 'text' && !String(out?.text).includes('<') && String(out?.text).includes('正文段落内容'), JSON.stringify(out)?.slice(0, 160));
  } finally { globalThis.fetch = realFetch; }
}
// 16d. web_search 留空 → 快失败
{
  const r = await runNode('web_search', { query: '' });
  const tg = target(r);
  t('16d. web_search query 留空 → 中断（SEARCH_EMPTY_QUERY，秒返）', tg?.status === 'failed' && tg?.error?.code === 'SEARCH_EMPTY_QUERY' && tg?.durationMs < 50, JSON.stringify(tg)?.slice(0, 140));
}

// ===== C. 连接语义：if 双分支 + set_var→vars 引用（组合流）=====
{
  const def = {
    name: 'matrix-combo', version: 1,
    inputs: { base: 10 },
    nodes: [
      { id: 'start', type: 'start', next: 'if1' },
      { id: 'if1', type: 'if', params: { condition: 'inputs.base > 5' } },
      { id: 'sv', type: 'set_var', params: { vars: { combo: 'ok-combo' } }, next: 'log1' },
      { id: 'log1', type: 'log', params: { level: 'info', message: 'combo done: {{vars.combo}}' }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
    edges: [
      { from: 'start', to: 'if1' },
      { from: 'if1', to: 'sv', when: 'true' },
      { from: 'sv', to: 'log1' },
      { from: 'log1', to: 'end' },
    ],
  };
  const r = await fetch(base + '/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ def }) });
  const data = await r.json();
  const res = data.summary?.results ?? {};
  t('C1. if 条件真→激活 set_var', data.summary?.status === 'success' && res.sv?.status === 'success', JSON.stringify(data.summary?.error));
  t('C2. vars 引用解析（log 输出含 ok-combo）', res.log1?.out === 'combo done: ok-combo', JSON.stringify(res.log1));
}

mockSrv.close(); server.close();
console.log(`\n=== node-matrix: ${pass} passed, ${fail} failed ===`);
if (fail > 0) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
