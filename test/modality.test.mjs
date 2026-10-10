import './_isolate-home.mjs';   // ★ 2026-10-11：隔离 DSH_HOME（存储根 = <DSH_HOME>/.dag-flow）
// test/modality.test.mjs — 模型多模态能力校验（/models 透传 + 运行前模态拦截 + 图片 API 测试路由）
// 数据源：dsh settings.yaml models[].input（标注 input: [text, image] 才支持图片，未标注视为仅文本）。
// 跑法：node test/modality.test.mjs
import * as http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ★ 先起 mock LLM 服务器拿到端口，再写 settings.yaml（fixture 的 baseURL 引用真实端口），最后 import dist
const mockSrv = http.createServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://x');
  if (u.pathname === '/llm/chat/completions') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: 'llm-ok' } }] }));
    return;
  }
  res.statusCode = 404; res.end('mock 404');
});
await new Promise((ok) => mockSrv.listen(0, '127.0.0.1', ok));
const mockPort = mockSrv.address().port;

const fakeHome = mkdtempSync(join(tmpdir(), 'dag-modality-home-'));
mkdirSync(join(fakeHome, '.dsh'), { recursive: true });
writeFileSync(join(fakeHome, '.dsh', 'settings.yaml'), `llm-pi-ai:
  providers:
    custom-model:
      apiKeyEnv: TEST_LLM_KEY
      api: openai-responses
      baseURL: http://127.0.0.1:${mockPort}/llm
      models:
        - id: glm-text-only
          name: glm-text-only
          contextWindow: 40960
          maxTokens: 40960
        - id: kimi-vision
          name: kimi-vision
          contextWindow: 1048576
          maxTokens: 131072
          input:
            - text
            - image
`, 'utf8');
writeFileSync(join(fakeHome, '.dsh', '.credentials.yaml'), `refs:
  TEST_LLM_KEY: sk-test-123
`, 'utf8');
process.env.USERPROFILE = fakeHome;
process.env.HOME = fakeHome;
// 09-27 意见 2 落地：dshHome() 统一为 DSH_HOME 优先（语义 = .dsh 根目录本身）。
// fixture 注入必须走同一通道，否则在本机（DSH_HOME 已设）会读到真机配置——
// 不仅是断言失败，B5 场景还会拿着真机密钥真实调用 LLM。
process.env.DSH_HOME = join(fakeHome, '.dsh');
process.chdir(mkdtempSync(join(tmpdir(), 'dag-modality-')));

const routes = [];
const stubCtx = { logger: { info() {}, warn() {}, error() {} }, webServer: { register(r) { routes.push(r); return () => {}; } } };
const mod = await import('file:///D:/workspace/pluginspace/dag-flow/dist/index.js');
mod.apply(stubCtx);

const server = http.createServer(async (req, res) => {
  const pn = new URL(req.url, 'http://x').pathname;
  const h = routes.find((r) => r.kind === 'exact' && r.path === pn)?.handler;
  if (!h) { res.statusCode = 404; res.end('no route'); return; }
  try { await h(req, res); } catch (e) { res.statusCode = 500; res.end(String(e?.message ?? e)); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}/api/dag-flow`;

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
const runNode = async (nodeType, params = {}) => {
  const r = await fetch(base + '/run-node', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nodeType, params }) });
  const body = await r.json().catch(() => ({}));
  return body?.summary?.results?.target;
};

// ===== A. /models 透传能力 =====
{
  const r = await fetch(base + '/models');
  const data = await r.json();
  const glm = (data.models ?? []).find((m) => m.model === 'glm-text-only');
  const kimi = (data.models ?? []).find((m) => m.model === 'kimi-vision');
  t('A1. 未标注 input 的模型 → hasImage=false（仅文本）', glm?.hasImage === false && Array.isArray(glm?.input) && !glm.input.includes('image'), JSON.stringify(glm));
  t('A2. 标注 input:[text,image] 的模型 → hasImage=true', kimi?.hasImage === true && kimi?.input?.includes('image'), JSON.stringify(kimi));
}

// ===== B. 运行前模态校验（subagent） =====
{
  const tg = await runNode('subagent', { prompt: '帮我分析这张图 screenshot.png 里的内容', model: 'dsh:custom-model:glm-text-only' });
  t('B1. 纯文本模型 + prompt 引用图片 → 拦截 MODEL_MODALITY_MISMATCH', tg?.status === 'failed' && tg?.error?.code === 'MODEL_MODALITY_MISMATCH', JSON.stringify(tg)?.slice(0, 200));
  t('B2. 提示含模型名/缺失模态/修复指引', /glm-text-only/.test(tg?.error?.message ?? '') && /图片/.test(tg?.error?.message ?? '') && /input: \[text, image\]/.test(tg?.error?.message ?? ''), JSON.stringify(tg?.error?.message)?.slice(0, 240));
}
{
  const tg = await runNode('subagent', { prompt: '读取报告 report.pdf 并总结', model: 'dsh:custom-model:glm-text-only' });
  t('B3. 纯文本模型 + prompt 引用文件 → 拦截（file 模态）', tg?.status === 'failed' && tg?.error?.code === 'MODEL_MODALITY_MISMATCH' && /文件/.test(tg?.error?.message ?? ''), JSON.stringify(tg)?.slice(0, 200));
}
{
  const tg = await runNode('subagent', { prompt: '看这张图 demo.mp4 的截图', model: 'dsh:custom-model:glm-text-only' });
  t('B4. 引用视频 → 拦截（video 模态）', tg?.status === 'failed' && /视频/.test(tg?.error?.message ?? ''), JSON.stringify(tg)?.slice(0, 200));
}
{
  const tg = await runNode('subagent', { prompt: '普通文本问题，无任何文件引用', model: 'dsh:custom-model:glm-text-only' });
  t('B5. 纯文本 prompt + 纯文本模型 → 通过模态校验并真实调用 LLM', tg?.status === 'success' && tg?.out === 'llm-ok', JSON.stringify(tg)?.slice(0, 160));
}
{
  const tg = await runNode('subagent', { prompt: '分析 chart.png 的趋势', model: 'dsh:custom-model:kimi-vision' });
  t('B6. 图片模型 + prompt 引用图片 → 通过模态校验并调用 LLM', tg?.status === 'success' && tg?.out === 'llm-ok', JSON.stringify(tg)?.slice(0, 160));
}
{
  const tg = await runNode('subagent', { prompt: '看 data.csv 的列', model: 'dsh:custom-model:kimi-vision' });
  t('B7. kimi-vision（input: text,image）+ 引用 csv → 拦截（模型缺 file 模态）', tg?.status === 'failed' && tg?.error?.code === 'MODEL_MODALITY_MISMATCH', JSON.stringify(tg)?.slice(0, 200));
}
{
  // ★ 2026-10-08 真机回归：材料型长提示词（新闻正文里含「附件.pdf」）不得被判成"引用文件"。
  //   真机现场：金融政策日报 ai_policy/ai_bank 因正文里的「…（征求意见稿）.pdf」直接 failed。
  const material = '【材料开始】\n（附件下载：1.企业会计准则——一般规定（修订征求意见稿）.pdf 2.起草说明.pdf）\n'
    + '央行公开市场操作公告：为保持银行体系流动性合理充裕，开展逆回购操作……\n'.repeat(120);
  t('B8a. 构造的长材料提示词确实超过阈值（>4000 字）', material.length > 4000, `长度=${material.length}`);
  const tg = await runNode('subagent', { prompt: material, model: 'dsh:custom-model:glm-text-only' });
  t('B8b. 材料型长提示词含 .pdf → 不再误判，正常调用 LLM', tg?.status === 'success' && tg?.out === 'llm-ok', JSON.stringify(tg)?.slice(0, 200));
  const short = await runNode('subagent', { prompt: '读取附件 征求意见稿.pdf 并总结', model: 'dsh:custom-model:glm-text-only' });
  t('B8c. 同一句话在短指令里仍按原口径拦截（避免把检查改废）', short?.status === 'failed' && short?.error?.code === 'MODEL_MODALITY_MISMATCH', JSON.stringify(short)?.slice(0, 200));
}

// ===== C. /test-image-api（image_generate 提前测试） =====
const realFetch = globalThis.fetch;
{
  // key 缺失 → 400
  const r = await fetch(base + '/test-image-api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseURL: 'https://x/v1' }) });
  const d = await r.json();
  t('C1. 缺 Key → 400 提示', r.status === 400 && /Key/.test(d.error ?? ''), JSON.stringify(d));
}
{
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url ?? String(input);
    if (url.startsWith('http://127.0.0.1')) return realFetch(input, init);
    if (url.startsWith('https://imgapi.test/v1/images/generations')) {
      const body = JSON.parse(init?.body ?? '{}');
      const auth = init?.headers?.authorization;
      if (auth === 'Bearer wrong-key') return new Response('unauthorized', { status: 401 });
      if (body.model === 'bad-model') return new Response(JSON.stringify({ error: { message: 'model not found' } }), { status: 404 });
      return new Response(JSON.stringify({ data: [{ url: 'https://example.com/t.png' }] }), { status: 200 });
    }
    throw new Error('unmocked: ' + url);
  };
  try {
    const post = async (body) => { const r = await fetch(base + '/test-image-api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return r.json(); };
    const ok = await post({ baseURL: 'https://imgapi.test/v1', apiKey: 'sk-x', model: 'wanx-v1' });
    t('C2. 组合可用 → ok:true 且注明已生成测试图', ok?.ok === true && /测试图/.test(ok?.note ?? ''), JSON.stringify(ok));
    const nf = await post({ baseURL: 'https://imgapi.test/v1', apiKey: 'sk-x', model: 'bad-model' });
    t('C3. 模型不存在（404）→ ok:false + 指引检查 baseURL/model', ok && nf?.ok === false && /model/i.test(nf?.hint ?? ''), JSON.stringify(nf)?.slice(0, 200));
    const un = await post({ baseURL: 'https://imgapi.test/v1', apiKey: 'wrong-key', model: 'other-model' });
    t('C4. Key 无效（401）→ ok:false + 指引', un?.ok === false && /Key/.test(un?.hint ?? ''), JSON.stringify(un)?.slice(0, 200));
  } finally {
    globalThis.fetch = realFetch;
  }
}

mockSrv.close(); server.close();
console.log(`\n=== modality tests: ${pass} passed, ${fail} failed ===`);
if (fail > 0) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
