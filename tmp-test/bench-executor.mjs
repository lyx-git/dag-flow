// tmp-test/bench-executor.mjs — DAG 执行器基准（2026-10-04 轮 5：量"跳过判定"优化的真实收益）
//   三种形状（节点全是 log，排除节点本身耗时，只量引擎开销）：
//     chain   链式 N 节点（层数最多 → 每层一次跳过判定，最吃优化）
//     fanout  扇出 N 条 + merge 合流（同一层最宽）
//     diamond 连续菱形（层多且每层 2 节点）
//   + 一个"带失败"的形状（failed×N），验证失败路径下的跳过传播成本。
// 用法：node tmp-test/bench-executor.mjs [N...]（默认 200 500 1000）
import * as http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sizes = process.argv.slice(2).map(Number).filter((n) => n > 0);
const NS = sizes.length ? sizes : [200, 500, 1000];

const ws = mkdtempSync(join(tmpdir(), 'dag-flow-bench-'));
process.chdir(ws);
const routes = [];
const stubCtx = { logger: { info: () => {}, warn: () => {}, error: () => {} }, webServer: { register(r) { routes.push(r); return () => {}; } } };
await import('file:///D:/workspace/pluginspace/dag-flow/dist/index.js').then((m) => m.apply(stubCtx));
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://x').pathname;
  const exact = routes.find((r) => r.kind === 'exact' && r.path === pathname);
  const prefix = routes.find((r) => r.kind === 'prefix' && (pathname === r.path || pathname.startsWith(r.path + '/')));
  const handler = exact?.handler ?? prefix?.handler;
  if (!handler) { res.statusCode = 404; res.end('no route'); return; }
  try { await handler(req, res); } catch (e) { res.statusCode = 500; res.end(String(e?.message ?? e)); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const port = server.address().port;
const runDef = async (def) => {
  const t0 = performance.now();
  const r = await fetch(`http://127.0.0.1:${port}/api/dag-flow/run`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ def }),
  });
  const body = await r.json().catch(() => null);
  return { wallMs: performance.now() - t0, summary: body?.summary ?? null };
};

const lg = (id) => ({ id, type: 'set_var', params: { vars: { v: 'x' } } });  // set_var：静默、无控制台噪声

function chain(N) {
  const nodes = [{ id: 'start', type: 'start' }];
  for (let i = 1; i <= N; i++) nodes.push(lg(`n${i}`));
  nodes.push({ id: 'end', type: 'end' });
  const edges = [{ from: 'start', to: 'n1' }];
  for (let i = 1; i < N; i++) edges.push({ from: `n${i}`, to: `n${i + 1}` });
  edges.push({ from: `n${N}`, to: 'end' });
  return { name: `bench-chain-${N}`, version: 1, nodes, edges };
}
function fanout(N) {
  const nodes = [{ id: 'start', type: 'start' }, { id: 'm', type: 'merge' }, { id: 'end', type: 'end' }];
  const edges = [];
  for (let i = 1; i <= N; i++) { nodes.push(lg(`f${i}`)); edges.push({ from: 'start', to: `f${i}` }, { from: `f${i}`, to: 'm' }); }
  edges.push({ from: 'm', to: 'end' });
  return { name: `bench-fanout-${N}`, version: 1, nodes, edges };
}
function diamond(N) {
  const nodes = [{ id: 'start', type: 'start' }];
  const edges = [];
  let prev = 'start';
  for (let i = 1; i <= N; i++) {
    nodes.push(lg(`a${i}`), lg(`b${i}`));
    edges.push({ from: prev, to: `a${i}` }, { from: prev, to: `b${i}` });
    prev = `a${i}`;
    edges.push({ from: `b${i}`, to: `a${i}` });   // 汇进 a_i，保持单一前进方向
  }
  nodes.push({ id: 'end', type: 'end' });
  edges.push({ from: prev, to: 'end' });
  return { name: `bench-diamond-${N}`, version: 1, nodes, edges };
}
function failTail(N) {
  // 前一半失败且策略 skip（写出边 = 死边），后一半应当被跳过 → 量跳过传播
  const nodes = [{ id: 'start', type: 'start' }];
  const edges = [];
  let prev = 'start';
  for (let i = 1; i <= N; i++) {
    nodes.push({ id: `p${i}`, type: 'python', params: { code: 'import sys\nsys.exit(3)' }, onError: 'continue' });
    edges.push({ from: prev, to: `p${i}` });
    prev = `p${i}`;
  }
  nodes.push({ id: 'end', type: 'end' });
  edges.push({ from: prev, to: 'end' });
  return { name: `bench-fail-${N}`, version: 1, nodes, edges };
}

const shapes = [['chain', chain], ['fanout', fanout], ['diamond', diamond], ['fail', failTail]];
console.log('形状        节点数   墙钟(ms)   引擎 totalDurationMs   状态');
for (const N of NS) {
  for (const [label, make] of shapes) {
    const def = make(N);
    const { wallMs, summary } = await runDef(def);
    console.log(`${label.padEnd(10)} ${String(def.nodes.length).padStart(6)}   ${wallMs.toFixed(0).padStart(7)}   ${String(summary?.totalDurationMs ?? '-').padStart(18)}   ${summary?.status ?? '?'}`);
  }
}
server.close();
