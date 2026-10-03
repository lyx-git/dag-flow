// tmp-test/probe-ai-node.mjs — AI 节点探针（2026-10-03 修「成功但空输出」后复测）
// ① 打印 /models 第一条原始字段（确认客户端该用什么 model 字符串）
// ② 用演示里写的 model 单节点跑，确认现在**不再**静默 success（应报 SUBAGENT_EMPTY_OUTPUT/UNAVAILABLE）
// ③ 扫一批候选 model 字符串，找出真能返回文本的（给用户选模型用）
const BASE = process.env.DF_BASE ?? 'http://127.0.0.1:3080/api/dag-flow';
const get = async (p) => (await fetch(BASE + p)).json();
const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const tryModel = async (model) => {
  const r = await post('/run-node', { nodeType: 'subagent', params: { model, prompt: '用一句话回答：1+1 等于几？', timeoutMs: 30000 } });
  const t = r.json?.summary?.results?.target;
  return { model, ok: r.json?.ok, status: t?.status, ms: t?.durationMs, out: typeof t?.out === 'string' ? t.out.slice(0, 60) : t?.out, code: t?.error?.code, msg: String(t?.error?.message ?? '').slice(0, 120) };
};

const models = await get('/models');
const list = models.models ?? models.endpoints ?? models;
console.log('① /models 第一条原始字段：' + JSON.stringify(Array.isArray(list) ? list[0] : models).slice(0, 400));
console.log(`   共 ${Array.isArray(list) ? list.length : '?'} 条`);

console.log('\n② 演示里写的 model 复测（修复后应失败而不是静默成功）');
for (const m of ['custom-model:glm-5.3-flash', 'dsh:deepseek-flash']) {
  const r = await tryModel(m);
  console.log(`   ${m} → HTTP ok=${r.ok} status=${r.status} ${r.ms}ms out=${JSON.stringify(r.out)} ${r.code ? '| ' + r.code + ': ' + r.msg : ''}`);
}

console.log('\n③ 候选 model 扫描（找出真能出文本的）');
const cands = [];
for (const m of (Array.isArray(list) ? list : []).slice(0, 8)) {
  for (const c of [m.providerName, m.model, m.model ? `dsh:${m.model}` : null, m.providerName ? `dsh:${m.providerName}` : null]) {
    if (c && !cands.includes(c)) cands.push(c);
  }
}
let good = 0;
for (const c of cands) {
  if (good >= 3) break;
  const r = await tryModel(c);
  const flag = r.status === 'success' && typeof r.out === 'string' && r.out.trim() ? '✅ 可用' : '✗';
  if (flag === '✅ 可用') good++;
  console.log(`   [${flag}] ${c} → status=${r.status} ${r.ms}ms ${r.code ? r.code : JSON.stringify(r.out)}`);
}
console.log(`\n可用模型数（扫到 ${good} 个）：${good > 0 ? '把上面 ✅ 的字符串填进 AI 节点的「选择模型」' : '本次扫描没找到能出文本的——需要在 dsh 里检查该 provider 的凭证/配额'}`);
