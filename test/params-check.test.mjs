// test/params-check.test.mjs — 节点 params 必填项集中预检（NODE_PARAMS_INVALID）
// 覆盖：10 类静默/含糊缺失的拦截（串行 + DAG 双模式）、多问题聚合、{{}} 引用不误伤、
//      已有专属错误码的节点语义不被预检抢占（subagent/web_search/web_fetch）。
// 跑法：node test/params-check.test.mjs
import * as http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.chdir(mkdtempSync(join(tmpdir(), 'dag-params-')));
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

/** 串行模式（next 链）运行：target 节点类型 + params 可指定 */
const runSerial = async (type, params) => {
  const r = await fetch(base + '/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    def: { name: 'p-serial', version: 1, nodes: [
      { id: 'start', type: 'start', next: 't' },
      { id: 't', type, params },
      { id: 'end', type: 'end' },
    ] },
  }) });
  return (await r.json().catch(() => ({})))?.summary;
};

/** DAG 模式（edges）运行 */
const runDag = async (nodes, edges) => {
  const r = await fetch(base + '/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    def: { name: 'p-dag', version: 1, nodes, edges },
  }) });
  return (await r.json().catch(() => ({})))?.summary;
};

// ===== A. 串行模式：10 类必填缺失 → NODE_PARAMS_INVALID（执行前一次性拦截） =====
{
  const s = await runSerial('python', { code: '   ' });
  t('A1. python 空白 code → 预检拦截', s?.error?.code === 'NODE_PARAMS_INVALID' && /python.*空白/.test(s?.error?.message ?? ''), JSON.stringify(s?.error)?.slice(0, 180));
}
{
  const s = await runSerial('bash', { code: '' });
  t('A2. bash 空 code → 预检拦截', s?.error?.code === 'NODE_PARAMS_INVALID' && /bash/.test(s?.error?.message ?? ''), JSON.stringify(s?.error)?.slice(0, 180));
}
{
  const s = await runSerial('http', { method: 'GET', url: '' });
  t('A3. http 空 url → 预检拦截', s?.error?.code === 'NODE_PARAMS_INVALID' && /http.*url 为空/.test(s?.error?.message ?? ''), JSON.stringify(s?.error)?.slice(0, 180));
}
{
  const s = await runSerial('if', { condition: '  ' });
  t('A4. if 空白 condition → 预检拦截（防静默 false）', s?.error?.code === 'NODE_PARAMS_INVALID' && /if.*condition/.test(s?.error?.message ?? ''), JSON.stringify(s?.error)?.slice(0, 180));
}
{
  const s = await runSerial('log', { level: 'info', message: '   ' });
  t('A5. log 空白 message → 预检拦截（防输出 undefined）', s?.error?.code === 'NODE_PARAMS_INVALID' && /log.*message/.test(s?.error?.message ?? ''), JSON.stringify(s?.error)?.slice(0, 180));
}
{
  const s = await runSerial('manual', { prompt: '' });
  t('A6. manual 空 prompt → 预检拦截', s?.error?.code === 'NODE_PARAMS_INVALID' && /manual/.test(s?.error?.message ?? ''), JSON.stringify(s?.error)?.slice(0, 180));
}
{
  const s = await runSerial('set_var', {});
  t('A7. set_var 缺 vars → 预检拦截（防静默成功）', s?.error?.code === 'NODE_PARAMS_INVALID' && /set_var.*vars/.test(s?.error?.message ?? ''), JSON.stringify(s?.error)?.slice(0, 180));
}
{
  const s = await runSerial('switch', { value: 'x', cases: {} });
  t('A8. switch 空 cases → 预检拦截（防分支全 skip）', s?.error?.code === 'NODE_PARAMS_INVALID' && /switch.*cases/.test(s?.error?.message ?? ''), JSON.stringify(s?.error)?.slice(0, 180));
}
{
  const s = await runSerial('subflow', { workflowName: ' ' });
  t('A9. subflow 空白 workflowName → 预检拦截', s?.error?.code === 'NODE_PARAMS_INVALID' && /subflow.*workflowName/.test(s?.error?.message ?? ''), JSON.stringify(s?.error)?.slice(0, 180));
}
{
  const s = await runSerial('file_save', { source: 'text', filename: '' });
  t('A10. file_save 空 filename → 预检拦截', s?.error?.code === 'NODE_PARAMS_INVALID' && /file_save.*filename/.test(s?.error?.message ?? ''), JSON.stringify(s?.error)?.slice(0, 180));
}

// ===== B. DAG 模式同样生效 + 多问题聚合 =====
{
  const s = await runDag(
    [
      { id: 'start', type: 'start' },
      { id: 'h', type: 'http', params: { url: '' } },
      { id: 'l', type: 'log', params: { message: '' } },
      { id: 'end', type: 'end' },
    ],
    [ { from: 'start', to: 'h' }, { from: 'h', to: 'l' }, { from: 'l', to: 'end' } ],
  );
  t('B1. DAG 模式预检生效', s?.error?.code === 'NODE_PARAMS_INVALID', JSON.stringify(s?.error)?.slice(0, 180));
  t('B2. 多问题一次性聚合（http + log 两处明细）', /节点 h\(http\)/.test(s?.error?.message ?? '') && /节点 l\(log\)/.test(s?.error?.message ?? ''), JSON.stringify(s?.error)?.slice(0, 240));
  t('B3. 预检失败不进入执行（results 空）', Object.keys(s?.results ?? {}).length === 0, JSON.stringify(s?.results)?.slice(0, 80));
}

// ===== C. {{}} 模板引用视为合法（不误伤） =====
{
  const s = await runSerial('http', { method: 'GET', url: '{{inputs.u}}', timeoutMs: 1500 });
  t('C1. url 为 {{inputs.u}} 引用 → 预检通过（错误是执行期而非参数校验）', s?.error?.code !== 'NODE_PARAMS_INVALID' && s?.status === 'failed', JSON.stringify(s?.error)?.slice(0, 140));
}

// ===== D. 已有专属错误码的节点语义不被预检抢占 =====
{
  const s = await runSerial('subagent', { prompt: 'x', model: '' });
  t('D1. subagent 空 model 仍为 MODEL_REQUIRED（语义保留在节点内）', s?.results?.t?.error?.code === 'MODEL_REQUIRED', JSON.stringify(s?.results?.t)?.slice(0, 140));
}
{
  const s = await runSerial('web_search', { query: '' });
  t('D2. web_search 空 query 仍为 SEARCH_EMPTY_QUERY', s?.results?.t?.error?.code === 'SEARCH_EMPTY_QUERY', JSON.stringify(s?.results?.t)?.slice(0, 140));
}
{
  const s = await runSerial('web_fetch', { url: '' });
  t('D3. web_fetch 空 url 仍为 FETCH_NO_URL', s?.results?.t?.error?.code === 'FETCH_NO_URL', JSON.stringify(s?.results?.t)?.slice(0, 140));
}

// ===== E. 合法工作流不受影响 =====
{
  const s = await runSerial('log', { level: 'info', message: 'params-ok' });
  t('E1. 合法参数 → 正常执行 success', s?.status === 'success' && s?.results?.t?.out === 'params-ok', JSON.stringify(s?.results?.t)?.slice(0, 120));
}
{
  const s = await runDag(
    [
      { id: 'start', type: 'start' },
      { id: 'sv', type: 'set_var', params: { vars: { ok: 1 } } },
      { id: 'end', type: 'end' },
    ],
    [ { from: 'start', to: 'sv' }, { from: 'sv', to: 'end' } ],
  );
  t('E2. DAG 合法（set_var 有 vars）→ 正常执行不被预检拦截', s?.status === 'success' && s?.results?.sv?.status === 'success', JSON.stringify(s?.error)?.slice(0, 140));
}

server.close();
console.log(`\n=== params-check: ${pass} passed, ${fail} failed ===`);
if (fail > 0) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
