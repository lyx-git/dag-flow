import { tmpRoot } from './_tmp-root.mjs';
import './_isolate-home.mjs';   // ★ 2026-10-11：隔离 DSH_HOME（存储根 = <DSH_HOME>/.dag-flow）
// test/node-matrix.test.mjs — 18 节点逐节点执行矩阵（每个节点真实走 start→target→end）
// 可独立执行节点走 /run-node；依赖上游数据的节点（merge/loop.over 等）已在 api-e2e 覆盖。
// 跑法：node test/node-matrix.test.mjs
import * as http from 'node:http';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

process.chdir(tmpRoot('dag-nodematrix-'));
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
  const expected = ['start', 'end', 'python', 'bash', 'http', 'web_search', 'web_fetch', 'doc_parse', 'subagent', 'session_input', 'if', 'switch', 'merge', 'subflow', 'image_generate', 'video_generate', 'file_save', 'loop', 'set_var', 'log', 'manual'];
  t('A. /nodes 返回全部 21 节点类型', expected.every((x) => types.includes(x)) && types.length === 21, JSON.stringify(types));
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
// 21. doc_parse（文档解析：真实读本地文件 + 三条错误路径）
{
  const md = join(process.cwd(), 'matrix-doc.md');
  writeFileSync(md, '# 政策速览\n\n第一段正文。\n', 'utf8');
  const r = await runNode('doc_parse', { path: md });
  const out = target(r)?.out;
  t('21. doc_parse 绝对路径 → success 且抽出文本', target(r)?.status === 'success' && out?.format === 'markdown' && String(out?.text).includes('第一段正文') && Number(out?.chars) > 0, JSON.stringify(out)?.slice(0, 180));

  const rel = await runNode('doc_parse', { path: 'matrix-rel-doc.md' });   // 相对路径锚定 <DSH_HOME>/.dag-flow/
  t('21b. doc_parse 相对路径不存在 → DOC_NOT_FOUND 且提示锚点', target(rel)?.error?.code === 'DOC_NOT_FOUND' && /\.dag-flow/.test(String(target(rel)?.error?.message)), JSON.stringify(target(rel)?.error)?.slice(0, 200));

  const noPath = await runNode('doc_parse', {});
  t('21c. doc_parse path/url 都空 → 被参数预检拦下（NODE_PARAMS_INVALID）', target(noPath)?.error?.code === 'NODE_PARAMS_INVALID' || noPath.body?.summary?.error?.code === 'NODE_PARAMS_INVALID', JSON.stringify(noPath.body?.summary?.error)?.slice(0, 160));

  const bad = join(process.cwd(), 'matrix-doc.xyz');
  writeFileSync(bad, 'x', 'utf8');
  const un = await runNode('doc_parse', { path: bad });
  t('21d. doc_parse 不支持的扩展名 → DOC_UNSUPPORTED', target(un)?.error?.code === 'DOC_UNSUPPORTED' && /pdf/.test(String(target(un)?.error?.message)), JSON.stringify(target(un)?.error)?.slice(0, 180));

  // ★ 21e/21f（2026-10-11 审计出的真缺陷回归锁）：FlowPanel 的 text() 在 blur 时把 **字符串** 写进 params，
  //   所以 maxChars 必须以字符串形态生效；否则用户设的上限被静默忽略（实测面板填 60 仍按默认 20 万跑）。
  const longTxt = '正文行 '.repeat(120);
  const longFile = join(process.cwd(), 'matrix-doc-long.md');
  writeFileSync(longFile, longTxt, 'utf8');
  const asStr = await runNode('doc_parse', { path: longFile, maxChars: '40' });
  t('21e. doc_parse maxChars 以字符串传入（面板 blur 的形态）也生效', Number(target(asStr)?.out?.chars) === 40 && target(asStr)?.out?.truncated === true, `chars=${target(asStr)?.out?.chars} truncated=${target(asStr)?.out?.truncated}`);
  const asNum = await runNode('doc_parse', { path: longFile, maxChars: 40 });
  t('21f. doc_parse maxChars 以数字传入同样生效', Number(target(asNum)?.out?.chars) === 40 && target(asNum)?.out?.truncated === true, `chars=${target(asNum)?.out?.chars} truncated=${target(asNum)?.out?.truncated}`);

  // 21g：面板文案承诺「相对路径锚定 <DSH_HOME>/.dag-flow/」——正例也要锁（此前只有"不存在"的反例）
  const { ISOLATED_HOME } = await import('./_isolate-home.mjs');
  const relDir = join(ISOLATED_HOME, '.dag-flow', 'documents');
  mkdirSync(relDir, { recursive: true });
  writeFileSync(join(relDir, 'matrix-rel-ok.md'), '相对路径正文\n', 'utf8');
  const relOk = await runNode('doc_parse', { path: 'documents/matrix-rel-ok.md' });
  t('21g. doc_parse 相对路径按 <DSH_HOME>/.dag-flow/ 锚定（正例）', target(relOk)?.status === 'success' && String(target(relOk)?.out?.text).includes('相对路径正文'), JSON.stringify(target(relOk)?.error ?? target(relOk)?.out)?.slice(0, 160));

  // ★ 21g2–21g6（2026-10-16 用户需求「图片抽到哪里去了，需要在文本资料里面相应位置注明图片位置」）：
  //   造一个**最小含图 docx**（stored zip，自带打包器），跑真实节点，断言端到端链路：
  //   ①文本里就地标注真实文件名 ②文件真的落进统一图片目录 ③out.images 结构
  //   ④extractImages:'off' 只解析文本不落盘 ⑤重复解析幂等（同名同内容不重写）
  const docxWithImage = (() => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);
    const documentXml = '<w:document><w:body><w:p><w:r><w:t>图前文字</w:t></w:r>'
      + '<w:r><w:drawing><a:blip r:embed="rId9"/></w:drawing></w:r></w:p></w:body></w:document>';
    const rels = '<Relationships><Relationship Id="rId9" Type="image" Target="media/pic.png"/></Relationships>';
    const entries = [
      ['word/document.xml', Buffer.from(documentXml, 'utf8')],
      ['word/_rels/document.xml.rels', Buffer.from(rels, 'utf8')],
      ['word/media/pic.png', png],
    ];
    const chunks = []; const central = []; let offset = 0;
    for (const [nm, data] of entries) {
      const nb = Buffer.from(nm, 'utf8');
      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(0, 8);
      lh.writeUInt32LE(0, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
      lh.writeUInt16LE(nb.length, 26);
      chunks.push(lh, nb, data);
      central.push({ nb, len: data.length, offset });
      offset += lh.length + nb.length + data.length;
    }
    const cds = []; let cdSize = 0;
    for (const c of central) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6);
      h.writeUInt32LE(c.len, 20); h.writeUInt32LE(c.len, 24);
      h.writeUInt16LE(c.nb.length, 28); h.writeUInt32LE(c.offset, 42);
      cds.push(h, c.nb); cdSize += h.length + c.nb.length;
    }
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(central.length, 8); eocd.writeUInt16LE(central.length, 10);
    eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...chunks, ...cds, eocd]);
  })();
  const docxPath = join(process.cwd(), 'matrix-with-image.docx');
  writeFileSync(docxPath, docxWithImage);
  const rImg = await runNode('doc_parse', { path: docxPath });
  const oImg = target(rImg)?.out;
  t('21g2. ★ doc_parse 抽图：文本里就地标注真实文件名', target(rImg)?.status === 'success' && /\[图片：matrix-with-image-1\.png\]/.test(String(oImg?.text)), JSON.stringify(oImg?.text)?.slice(0, 200));
  const imgDir = join(ISOLATED_HOME, '.dag-flow', 'images');
  const landed = existsSync(join(imgDir, 'matrix-with-image-1.png'));
  t('21g3. ★ 抽出的图真的落进统一图片目录（.dag-flow/images/）', landed && Number(oImg?.meta?.imageCount) === 1, `landed=${landed} meta=${JSON.stringify(oImg?.meta)?.slice(0, 160)}`);
  t('21g4. out.images 结构（name/mediaType/bytes/source）', oImg?.images?.[0]?.name === 'matrix-with-image-1.png' && oImg?.images?.[0]?.mediaType === 'image/png' && oImg?.images?.[0]?.source === 'word/media/pic.png' && Number(oImg?.images?.[0]?.bytes) === 11, JSON.stringify(oImg?.images)?.slice(0, 200));
  const rOff = await runNode('doc_parse', { path: docxPath, extractImages: 'off' });
  const oOff = target(rOff)?.out;
  // ★ 2026-10-17 行为变更（独立审查报的高危项）：off 时**洗净** `[图片 #N]` 占位 —— 占位由 extractDocument
  //   按"有没有抽到图"无条件插入，而 off 会把 images 清空 ⇒ 留着就是"指向不存在文件的假地址"（还会进下游 prompt）
  t('21g5. extractImages:off → 只解析文本（★洗净 [图片 #1] 占位、不落盘）', target(rOff)?.status === 'success' && !String(oOff?.text).includes('[图片 #') && Array.isArray(oOff?.images) && oOff.images.length === 0, JSON.stringify(oOff?.text)?.slice(0, 160));
  const rAgain = await runNode('doc_parse', { path: docxPath });
  t('21g6. 重复解析幂等（同名同内容不重写，reused=true）', target(rAgain)?.status === 'success' && target(rAgain)?.out?.images?.[0]?.reused === true, JSON.stringify(target(rAgain)?.out?.images)?.slice(0, 160));

  // ★ 21g7–21g10（2026-10-16 第二轮：PDF 抽图）：含 DCTDecode(JPEG) 图的最小 PDF ⇒ 端到端跑通
  //   「抽图 → 落统一图片目录 → 文本就地标注真实文件名 → 幂等」。
  const pdfWithImage = (() => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(24, 0x33), Buffer.from([0xff, 0xd9])]);
    const content = 'BT /F1 12 Tf 72 720 Td (PDF figure) Tj ET q /Im1 Do Q';
    const parts = [Buffer.from('%PDF-1.4\n', 'latin1')];
    const obj = (num, body) => { parts.push(Buffer.from(`${num} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')); };
    obj(1, Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'));
    obj(2, Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'latin1'));
    obj(3, Buffer.from('<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 7 0 R >> >> /Contents 5 0 R >>', 'latin1'));
    obj(4, Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', 'latin1'));
    obj(5, Buffer.from(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`, 'latin1'));
    obj(7, Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, 'latin1'),
      jpeg,
      Buffer.from('\nendstream', 'latin1'),
    ]));
    parts.push(Buffer.from('trailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'));
    return { buf: Buffer.concat(parts), jpeg };
  })();
  const pdfPath = join(process.cwd(), 'matrix-with-image.pdf');
  writeFileSync(pdfPath, pdfWithImage.buf);
  const rPdf = await runNode('doc_parse', { path: pdfPath });
  const oPdf = target(rPdf)?.out;
  t('21g7. ★ PDF 抽图：文本里就地标注真实文件名（且在该页文本之后）', target(rPdf)?.status === 'success' && /PDF figure\n\[图片：matrix-with-image-1\.jpg\]/.test(String(oPdf?.text)), JSON.stringify(oPdf?.text)?.slice(0, 200));
  const pdfLanded = existsSync(join(imgDir, 'matrix-with-image-1.jpg'));
  t('21g8. ★ PDF 抽出的图落进统一图片目录（.dag-flow/images/）', pdfLanded && Number(oPdf?.meta?.imageCount) === 1, `landed=${pdfLanded} meta=${JSON.stringify(oPdf?.meta)?.slice(0, 160)}`);
  t('21g9. PDF out.images：JPEG 原样落盘（字节数一致）+ source 注明页码', oPdf?.images?.[0]?.mediaType === 'image/jpeg' && Number(oPdf?.images?.[0]?.bytes) === pdfWithImage.jpeg.length && /第 1 页/.test(String(oPdf?.images?.[0]?.source)), JSON.stringify(oPdf?.images)?.slice(0, 200));
  const rPdfAgain = await runNode('doc_parse', { path: pdfPath });
  t('21g10. PDF 重复解析幂等（reused=true）', target(rPdfAgain)?.status === 'success' && target(rPdfAgain)?.out?.images?.[0]?.reused === true, JSON.stringify(target(rPdfAgain)?.out?.images)?.slice(0, 160));

  // ★ 21g11–21g13（2026-10-16 第二轮·用户追加：「只有图没有文字的，text 里面说明抽出来的图片地址就行」）：
  //   扫描件（无文本层 + 整页图片）+ OCR **显式关** ⇒ **不再报错**，文本给出抽出的图片名（落盘后的真实地址）。
  //   注意：2026-10-18 起 ocr 默认值 = auto，所以这三条必须**显式**传 off 才表达「关」的语义。
  const scanImgPdf = (() => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20, 0x44), Buffer.from([0xff, 0xd9])]);
    const content = 'q 100 0 0 100 50 600 cm /Im1 Do Q';          // 没有 BT/ET ⇒ 无文本层
    const parts = [Buffer.from('%PDF-1.4\n', 'latin1')];
    const obj = (num, body) => { parts.push(Buffer.from(`${num} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')); };
    obj(1, Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'));
    obj(2, Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'latin1'));
    obj(3, Buffer.from('<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Im1 7 0 R >> >> /Contents 5 0 R >>', 'latin1'));
    obj(5, Buffer.from(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`, 'latin1'));
    obj(7, Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, 'latin1'),
      jpeg,
      Buffer.from('\nendstream', 'latin1'),
    ]));
    parts.push(Buffer.from('trailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'));
    return { buf: Buffer.concat(parts), jpeg };
  })();
  const scanImgPath = join(process.cwd(), 'matrix-scan-img.pdf');
  writeFileSync(scanImgPath, scanImgPdf.buf);
  const rOnly = await runNode('doc_parse', { path: scanImgPath, ocr: 'off' });
  const oOnly = target(rOnly)?.out;
  t('21g11. ★ 纯图 PDF（无文本层）+ OCR 显式关 ⇒ 成功返回、文本给出图片地址', target(rOnly)?.status === 'success' && /\[图片：matrix-scan-img-1\.jpg\]/.test(String(oOnly?.text)) && oOnly?.meta?.imagesOnly === true, JSON.stringify(oOnly?.text)?.slice(0, 200) + ' / ' + String(target(rOnly)?.error?.code));
  t('21g12. 纯图 PDF 抽出的图落进统一图片目录（且字节原样）', existsSync(join(imgDir, 'matrix-scan-img-1.jpg')) && Number(oOnly?.meta?.imageCount) === 1 && Number(oOnly?.images?.[0]?.bytes) === scanImgPdf.jpeg.length, JSON.stringify(oOnly?.meta) + ' ' + JSON.stringify(oOnly?.images)?.slice(0, 160));
  const rOnlyOff = await runNode('doc_parse', { path: scanImgPath, extractImages: 'off', ocr: 'off' });
  t('21g13. 纯图 PDF + extractImages:off ⇒ 保持原报错（契约不变）', target(rOnlyOff)?.error?.code === 'DOC_NO_TEXT_LAYER', String(target(rOnlyOff)?.error?.code));

  // ★ 21h–21l（2026-10-11 轮 2：图片 OCR）。用**假引擎**（DAGFLOW_OCR_* 逃生舱 + node 冒充解释器）
  //   ⇒ 链路完整、但整链仍然**离线**、不依赖真引擎装没装。
  const fakeEngine = join(process.cwd(), 'matrix-ocr-engine');
  mkdirSync(join(fakeEngine, 'rapidocr_onnxruntime'), { recursive: true });
  writeFileSync(join(fakeEngine, 'rapidocr_onnxruntime', '__init__.py'), '# fake engine\n', 'utf8');
  const fakeStub = join(process.cwd(), 'matrix-ocr-stub.mjs');
  writeFileSync(fakeStub, `for await (const _ of process.stdin) { /* 吃掉落参 */ }\nconsole.log('__OCR_JSON__ ' + JSON.stringify({ ok: true, text: '假引擎识别出来的公告正文', lines: 1, confidence: 0.88, durationMs: 5 }));\n`, 'utf8');
  process.env.DAGFLOW_OCR_ENGINE_DIR = fakeEngine;
  process.env.DAGFLOW_OCR_PYTHON = process.execPath;
  process.env.DAGFLOW_OCR_SCRIPT = fakeStub;

  const png = join(process.cwd(), 'matrix-img.png');
  writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));   // 假引擎不真读图，内容随意

  const imgOff = await runNode('doc_parse', { path: png, ocr: 'off' });
  t('21h. 图片 + OCR 显式关 → OCR_DISABLED，明确告诉去开', target(imgOff)?.error?.code === 'OCR_DISABLED' && /OCR/.test(String(target(imgOff)?.error?.message)), String(target(imgOff)?.error?.code));

  const imgAuto = await runNode('doc_parse', { path: png, ocr: 'auto' });
  const imgOut = target(imgAuto)?.out;
  t('21i. 图片 + OCR 自动 → success、format=image、文本来自引擎', target(imgAuto)?.status === 'success' && imgOut?.format === 'image' && String(imgOut?.text).includes('假引擎'), JSON.stringify(imgOut)?.slice(0, 160));
  t('21i-2. OCR 结果带来源标记（meta.ocr / ocrConfidence / ocrEngine / ocrMs）', imgOut?.meta?.ocr === true && imgOut?.meta?.ocrConfidence === 0.88 && /rapidocr/.test(String(imgOut?.meta?.ocrEngine)) && typeof imgOut?.meta?.ocrMs === 'number', JSON.stringify(imgOut?.meta));

  const imgJunk = await runNode('doc_parse', { path: png, ocr: '乱填的值' });
  t('21j. ocr 填了乱值 → 当 off（不偷偷跑引擎）', target(imgJunk)?.error?.code === 'OCR_DISABLED', String(target(imgJunk)?.error?.code));

  const imgStr = await runNode('doc_parse', { path: png, ocr: 'true' });   // 面板/JSON 传字符串的形态
  t('21k. ocr 以字符串 "true" 传入 → auto 生效（面板形态）', target(imgStr)?.status === 'success' && target(imgStr)?.out?.format === 'image', JSON.stringify(target(imgStr)?.error)?.slice(0, 120));

  // 扫描版 PDF（无文本层）：auto 会**真的**去栅格化 + OCR（轮 3）；off 才明确报错
  const scanPdf = join(process.cwd(), 'matrix-scan.pdf');
  const scanContent = 'q 100 0 0 100 50 600 cm Q';
  writeFileSync(scanPdf, ['%PDF-1.4',
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << >> /Contents 5 0 R >>\nendobj',
    `5 0 obj\n<< /Length ${scanContent.length} >>\nstream\n${scanContent}\nendstream\nendobj`,
    'trailer\n<< /Root 1 0 R >>\n%%EOF',
  ].join('\n'), 'latin1');

  const scanOff = await runNode('doc_parse', { path: scanPdf, ocr: 'off' });
  t('21l. 扫描版 PDF + OCR 显式关 → DOC_NO_TEXT_LAYER（不静默）', target(scanOff)?.error?.code === 'DOC_NO_TEXT_LAYER', String(target(scanOff)?.error?.code));

  // 假「栅格化 + OCR」脚本（契约与 runtime/ocr/pdf_ocr.py 一致），链保持离线
  const fakePdfStub = join(process.cwd(), 'matrix-pdf-ocr-stub.mjs');
  writeFileSync(fakePdfStub, `let raw=''; for await (const c of process.stdin) raw += c; const req = JSON.parse(raw||'{}');\nconsole.log('__OCR_JSON__ ' + JSON.stringify({ ok: true, text: '扫描件识别结果：第1页\\n第2页', pages: 2, ocrPages: req.maxPages > 2 ? 2 : req.maxPages, truncated: false, confidence: 0.93, durationMs: 30, perPage: [{ page: 1, lines: 1, chars: 9 }] }));\n`, 'utf8');
  process.env.DAGFLOW_OCR_PDF_SCRIPT = fakePdfStub;

  const scanOn = await runNode('doc_parse', { path: scanPdf, ocr: 'auto' });
  const scanOut = target(scanOn)?.out;
  t('21m. 扫描版 PDF + OCR 自动 → 栅格化 + OCR 成功（format=pdf、文本来自引擎）', target(scanOn)?.status === 'success' && scanOut?.format === 'pdf' && String(scanOut?.text).includes('扫描件识别结果'), JSON.stringify(scanOut)?.slice(0, 140));
  t('21m-2. 扫描件结果带页数与来源标记（pages / ocrPages / ocr / ocrConfidence）', scanOut?.meta?.ocr === true && scanOut?.meta?.pages === 2 && scanOut?.meta?.ocrPages === 2 && scanOut?.meta?.ocrConfidence === 0.93, JSON.stringify(scanOut?.meta));

  // 有文本层的 PDF：auto 走原生文本（不做无用功），force 才重新识别
  const textPdf = join(process.cwd(), 'matrix-text.pdf');
  const native = 'BT /F1 12 Tf 72 720 Td (Native layer text) Tj ET';
  writeFileSync(textPdf, ['%PDF-1.4',
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj',
    `5 0 obj\n<< /Length ${native.length} >>\nstream\n${native}\nendstream\nendobj`,
    'trailer\n<< /Root 1 0 R >>\n%%EOF',
  ].join('\n'), 'latin1');

  const pdfAuto = await runNode('doc_parse', { path: textPdf, ocr: 'auto' });
  const autoOut = target(pdfAuto)?.out;
  t('21n. 有文本层 PDF + OCR 自动 → 读原生文本、不触发 OCR（meta.ocr 不存在）', target(pdfAuto)?.status === 'success' && String(autoOut?.text).includes('Native layer text') && autoOut?.meta?.ocr === undefined, JSON.stringify(autoOut)?.slice(0, 140));

  const pdfForce = await runNode('doc_parse', { path: textPdf, ocr: 'force' });
  t('21o. 有文本层 PDF + OCR 强制 → 跳过文本层、重新识别（来自引擎）', target(pdfForce)?.status === 'success' && String(target(pdfForce)?.out?.text).includes('扫描件识别结果') && target(pdfForce)?.out?.meta?.ocr === true, JSON.stringify(target(pdfForce)?.out)?.slice(0, 140));

  delete process.env.DAGFLOW_OCR_PDF_SCRIPT;
  delete process.env.DAGFLOW_OCR_ENGINE_DIR;
  delete process.env.DAGFLOW_OCR_PYTHON;
  delete process.env.DAGFLOW_OCR_SCRIPT;
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
