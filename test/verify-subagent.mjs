// 核实：subagent 节点「配置即执行」真实跑通（自动发现 settings.yaml 模型）
import * as http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

process.chdir(mkdtempSync(join(tmpdir(), 'dag-subagent-verify-')));
const routes = [];
const stubCtx = { logger: { info() {}, warn() {}, error() {} }, webServer: { register(r) { routes.push(r); return () => {}; } } };
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

// 1. 可用模型列表（自动发现）
const models = await (await fetch(base + '/models')).json();
console.log('自动发现的模型数:', (models.models ?? []).length);
for (const m of (models.models ?? []).slice(0, 5)) console.log('  -', m.id, '|', m.name, '|', m.kind);

// 2. subagent 节点真实执行（显式选第一个发现的模型——模型必选语义）
const firstModel = (models.models ?? [])[0]?.id ?? '';
console.log('\n选用模型:', firstModel || '(none)');
const r = await fetch(base + '/run-node', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ nodeType: 'subagent', params: { prompt: '只回复两个字：通过', model: firstModel, timeoutMs: 60_000 } }),
});
const data = await r.json();
const tg = data.summary?.results?.target;
console.log('\nsubagent 执行:', r.status, '| status:', tg?.status);
console.log('LLM 输出:', JSON.stringify(tg?.out)?.slice(0, 200));
console.log('耗时:', tg?.durationMs, 'ms');
if (tg?.status !== 'success') console.log('error:', JSON.stringify(tg?.error)?.slice(0, 300));
server.close();
