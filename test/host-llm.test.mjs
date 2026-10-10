import './_isolate-home.mjs';   // ★ 2026-10-11：隔离 DSH_HOME（存储根 = <DSH_HOME>/.dag-flow）
// test/host-llm.test.mjs — 宿主 LLM 流契约（2026-10-03 修「AI 节点成功但输出为空」）
//
// 背景：dsh-llm 的 FinishReasonMap 是
//   { stop:{kind:'stop'} | 'tool-calls' | 'max-tokens' | error:{kind:'error', failure:LlmFailure} | aborted:{…} }
//   LlmFailure = { message, code, status? }
// 而 dag-flow 旧实现按**字符串** 'error' 判、并读根本不存在的 `finish.error.message`
//   → 任何失败都被当成正常结束 → 节点 success + out=''（真机 9ms 空输出、落盘简报 AI 段全空）。
// 本文件用 stub ctx.llm 直接驱动 callViaHostLlm，把三种 finish 形态与空流守卫钉死。
// 跑法：node test/host-llm.test.mjs
import * as http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

process.chdir(mkdtempSync(join(tmpdir(), 'dag-hostllm-')));

// ★ 去重夹具（2026-10-03 用户拍板「要去重」）：DSH_HOME 指向临时目录 + 写一份 settings.yaml，
//   声明**与宿主发现同 provider:model**（probe-provider / probe-model）→ /models 里该模型只应出现一次
//   （保留 host 发现那条）。必须在 import dist 之前设好：SETTINGS_PATH 是模块顶层固化的。
const fakeHome = mkdtempSync(join(tmpdir(), 'dag-hostllm-home-'));
mkdirSync(fakeHome, { recursive: true });
writeFileSync(join(fakeHome, 'settings.yaml'), [
  'llm-pi-ai:', '  providers:', '    probe-provider:',
  '      baseURL: https://probe.example.com/v1', '      models:',
  '        - id: probe-model', '          name: probe-model', '',
].join('\n'));
process.env.DSH_HOME = fakeHome;

// —— stub ctx：llm 服务的产出由 __llmChunks 控制（hostService 的第三层=属性访问，故裸对象即可）——
const routes = [];
const state = { chunks: [], calls: [] };
const stubCtx = {
  logger: { info() {}, warn() {}, error() {} },
  webServer: { register(r) { routes.push(r); return () => {}; } },
  llm: {
    listProviders: () => [{ id: 'probe-provider', name: '探针' }],
    listModels: async () => [{ id: 'probe-model', name: '探针模型-显示名', inputModalities: ['text'] }],
    stream: (options) => {
      state.calls.push(options);
      const chunks = state.chunks;
      return (async function* () { for (const c of chunks) yield c; })();
    },
  },
};
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
const runNode = async (params) => {
  const r = await fetch(base + '/run-node', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nodeType: 'subagent', params }) });
  return (await r.json().catch(() => ({})))?.summary?.results?.target;
};
const MODEL = 'dsh:llm:probe-provider:probe-model';

console.log('\n== A. finish { kind:stop } + text-delta → 正常成功 ==');
{
  state.chunks = [{ type: 'text-delta', index: 0, text: '你好' }, { type: 'finish', reason: { kind: 'stop' } }];
  const tg = await runNode({ prompt: '契约探针', model: MODEL, timeoutMs: 5000 });
  t('A1. 有文本 → success 且 out=你好', tg?.status === 'success' && tg?.out === '你好', JSON.stringify(tg)?.slice(0, 160));
  t('A2. 传给宿主的是 provider/model（不带 dsh:llm: 前缀）', state.calls.at(-1)?.provider === 'probe-provider' && state.calls.at(-1)?.model === 'probe-model', JSON.stringify(state.calls.at(-1))?.slice(0, 160));
  // ★ 宿主契约：RequestUserInput.content = readonly ContentBlock[]（TextBlock={type:'text',text}）。
  //   传字符串会被适配器判为非法请求 → finish{kind:'error'} → 空输出（真机故障根因）。
  const msg = state.calls.at(-1)?.messages?.[0];
  t('A3. messages[0].content 是内容块数组（非字符串）', Array.isArray(msg?.content) && msg.content[0]?.type === 'text' && msg.content[0]?.text === '契约探针', JSON.stringify(msg)?.slice(0, 160));
}

console.log('\n== B. finish { kind:error, failure } → 必须是失败，且**带出宿主的 failure 详情** ==');
{
  state.chunks = [{ type: 'finish', reason: { kind: 'error', failure: { code: 'PROVIDER_401', message: '凭证无效（探针）', status: 401 } } }];
  const tg = await runNode({ prompt: '契约探针', model: MODEL, timeoutMs: 5000 });
  t('B1. 空文本 + finish:error → failed', tg?.status === 'failed', JSON.stringify(tg)?.slice(0, 160));
  t('B2. 错误消息带出 failure.message', /凭证无效（探针）/.test(String(tg?.error?.message ?? '')), String(tg?.error?.message ?? '').slice(0, 200));
  t('B3. 错误消息带出 failure.code 与 HTTP 状态', /PROVIDER_401/.test(String(tg?.error?.message ?? '')) && /401/.test(String(tg?.error?.message ?? '')), String(tg?.error?.message ?? '').slice(0, 200));
}

console.log('\n== C. finish { kind:aborted, failure } → 失败 ==');
{
  state.chunks = [{ type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: '被用户中止' } } }];
  const tg = await runNode({ prompt: '契约探针', model: MODEL, timeoutMs: 5000 });
  t('C1. aborted → failed 且带出原因', tg?.status === 'failed' && /被用户中止/.test(String(tg?.error?.message ?? '')), String(tg?.error?.message ?? '').slice(0, 200));
}

console.log('\n== D. 空流（一个 chunk 都没有）→ 不许静默成功 ==');
{
  state.chunks = [];
  const tg = await runNode({ prompt: '契约探针', model: MODEL, timeoutMs: 5000 });
  t('D1. 零 chunk → failed（不再 success+空串）', tg?.status === 'failed', JSON.stringify(tg)?.slice(0, 160));
  t('D2. 错误消息说明"一个 chunk 都没产出"', /一个 chunk 都没产出/.test(String(tg?.error?.message ?? '')), String(tg?.error?.message ?? '').slice(0, 200));
}

console.log('\n== E. finish { kind:stop } 但无文本 → 空输出守卫 ==');
{
  state.chunks = [{ type: 'finish', reason: { kind: 'stop' } }];
  const tg = await runNode({ prompt: '契约探针', model: MODEL, timeoutMs: 5000 });
  t('E1. 正常结束但无文本 → failed[SUBAGENT_EMPTY_OUTPUT]', tg?.status === 'failed' && tg?.error?.code === 'SUBAGENT_EMPTY_OUTPUT', JSON.stringify(tg)?.slice(0, 200));
}

console.log("\n== F. 旧形态兼容：reason 直接是字符串 'error' → 仍判失败 ==");
{
  state.chunks = [{ type: 'finish', reason: 'error' }];
  const tg = await runNode({ prompt: '契约探针', model: MODEL, timeoutMs: 5000 });
  t('F1. reason 为字符串 error → failed', tg?.status === 'failed', JSON.stringify(tg)?.slice(0, 160));
}

console.log('\n== G. /models 带出显示名 + 按 provider:model 去重（2026-10-03 用户要求）==');
{
  const r = await fetch(base + '/models');
  const body = await r.json().catch(() => ({}));
  const all = body?.models ?? [];
  const m = all[0];
  t('G1. /models 每项带 label（模型显示名）', typeof m?.label === 'string' && m.label.length > 0, JSON.stringify(m)?.slice(0, 240));
  t('G2. label = 宿主 listModels 的 name（不是内部 providerName）', m?.label === '探针模型-显示名', String(m?.label));
  t('G3. 带 providerLabel（提供方显示名，重名消歧用）', m?.providerLabel === '探针', String(m?.providerLabel));
  t('G4. ★ 存值/执行仍是 id：id 字段未被显示名污染', m?.id === 'dsh:llm:probe-provider:probe-model' && m?.model === 'probe-model', JSON.stringify({ id: m?.id, model: m?.model }));
  t('G5. 旧字段 name（内部 providerName）保持不变，向后兼容', m?.name === 'llm:probe-provider:probe-model', String(m?.name));
  // ★ 去重：夹具 settings.yaml 也声明了 probe-provider/probe-model（= 同一批模型的两种来源）
  const sameModel = all.filter((x) => x.model === 'probe-model');
  t('G6. 同一 provider:model 只出现一次（去重生效）', sameModel.length === 1, JSON.stringify(all.map((x) => x.id)));
  t('G7. 保留的是 host 发现那条（带 dsh:llm: 前缀 + 显示名）', sameModel[0]?.id === 'dsh:llm:probe-provider:probe-model' && sameModel[0]?.label === '探针模型-显示名', JSON.stringify(sameModel[0])?.slice(0, 200));
  t('G8. settings 直读那条被去重掉（不再出现 dsh:probe-provider:probe-model）', !all.some((x) => x.id === 'dsh:probe-provider:probe-model'), JSON.stringify(all.map((x) => x.id)));
}

console.log('\n== H. 模态不匹配报错用「显示名」（2026-10-03 与下拉文案同口径）==');
{
  // stub 的探测模型 name='探针模型-显示名'、inputModalities=['text'] → prompt 引用图片即能力不足
  const before = state.calls.length;
  const tg = await runNode({ prompt: '请分析这张图 photo.png', model: MODEL, timeoutMs: 5000 });
  t('H1. 引用图片 + 纯文本模型 → MODEL_MODALITY_MISMATCH', tg?.status === 'failed' && tg?.error?.code === 'MODEL_MODALITY_MISMATCH', JSON.stringify(tg)?.slice(0, 200));
  t('H2. 报错里是模型显示名，不是内部 id', /探针模型-显示名/.test(String(tg?.error?.message ?? '')), String(tg?.error?.message ?? '').slice(0, 240));
  t('H3. 内部串（llm:provider:model）不再出现在报错里', !/llm:probe-provider:probe-model/.test(String(tg?.error?.message ?? '')), String(tg?.error?.message ?? '').slice(0, 240));
  t('H4. 拦在调用前（未发起 LLM 请求，不浪费额度）', state.calls.length === before, `calls ${before} → ${state.calls.length}`);
}

console.log('\n== I. AI 调试信息（2026-10-04：试跑面板 + 运行日志共用的采集口径）==');
{
  state.chunks = [
    { type: 'text-delta', index: 0, text: '调试正文' },
    // ★ dsh-llm 的 usage chunk（适配器在 finish 之前发出）：TokenUsage = { inputTokens, outputTokens, totalTokens }
    { type: 'usage', usage: { inputTokens: 123, outputTokens: 45, totalTokens: 168 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ];
  const tg = await runNode({ prompt: '调试用的提示词 {{inputs.x}}', model: MODEL, maxTokens: 2048, timeoutMs: 5000 });
  const d = tg?.debug ?? {};
  t('I1. 成功结果带 debug（不进 out）', tg?.status === 'success' && !!tg?.debug && tg?.out === '调试正文', JSON.stringify({ out: tg?.out, hasDebug: !!tg?.debug }));
  t('I2. ★采集到 token 用量（宿主 usage chunk）', d.usage?.inputTokens === 123 && d.usage?.outputTokens === 45 && d.usage?.totalTokens === 168, JSON.stringify(d.usage));
  t('I3. ★记录"实际发出的提示词"（模板已展开：不再是 {{}} 原文）',
    String(d.prompt ?? '').startsWith('调试用的提示词') && !String(d.prompt ?? '').includes('{{'),
    String(d.prompt).slice(0, 60));
  t('I4. 记录模型 + 显示名 + 提供方', d.model === MODEL && !!d.provider && d.modelLabel === '探针模型-显示名', JSON.stringify({ model: d.model, provider: d.provider, label: d.modelLabel }));
  t('I5. 走宿主标记 + 结束原因 + maxTokens', d.viaHost === true && d.finishReason === 'stop' && d.maxTokens === 2048, JSON.stringify({ viaHost: d.viaHost, fin: d.finishReason, maxTokens: d.maxTokens }));
  t('I6. 有耗时与返回字数', typeof d.durationMs === 'number' && d.textChars === 4, JSON.stringify({ ms: d.durationMs, chars: d.textChars }));
}
{
  // 宿主不给 usage chunk 时：debug 里就没有 usage（面板会显示"宿主未提供"，不编造数字）
  state.chunks = [{ type: 'text-delta', index: 0, text: '无用量' }, { type: 'finish', reason: { kind: 'stop' } }];
  const tg = await runNode({ prompt: 'x', model: MODEL, timeoutMs: 5000 });
  t('I7. 宿主未给 usage → debug.usage 缺失（不编造）', tg?.debug && tg.debug.usage === undefined, JSON.stringify(tg?.debug?.usage ?? null));
}

server.close();
console.log(`\n=== host-llm 契约：${pass} passed, ${fail} failed ===`);
if (fail) console.log('失败项：' + failures.join(' | '));
process.exit(fail ? 1 : 0);
