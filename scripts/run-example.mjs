#!/usr/bin/env node
// scripts/run-example.mjs — 本地 harness 运行工作流 JSON（不依赖 DSH 真机 GUI）
//
// 用法：
//   node scripts/run-example.mjs <工作流.json> \
//        [--inputs '{"k":"v"}'] [--probes]
//
// 说明：
//   - stub cordis ctx（捕获 webServer 路由）+ 本地 http 服务挂插件 API，跑的是真实 dist/index.js；
//   - --inputs 覆盖示例的 inputs；img_baseURL 填 "MOCK" 会自动指向内置 mock 图片 API（零费用）；
//   - web_search / subagent 走真实网络与真实 dsh 配置（真实费用由 dsh settings 决定）；
//   - --probes 追加一轮"必填校验探针"：对可疑节点逐个喂缺失/非法参数，观察错误码质量。
import * as http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('用法: node scripts/run-example.mjs <example.json> [--inputs \'{"k":"v"}\'] [--probes]');
  process.exit(1);
}
const doProbes = args.includes('--probes');
let inputsOverride = {};
const ix = args.indexOf('--inputs');
if (ix >= 0) inputsOverride = JSON.parse(args[ix + 1] ?? '{}');
else if (process.env.EXAMPLE_INPUTS) {
  // PowerShell 向原生进程传 JSON 会吃掉双引号——用环境变量通道替代（值原样保真）
  inputsOverride = JSON.parse(process.env.EXAMPLE_INPUTS);
}

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
// 示例文件路径必须在 chdir 之前解析（chdir 后相对路径会指向临时工作区）
const EXAMPLE_PATH = resolve(file);

// 1) 临时工作区（运行记录落 tmp，不污染真实工作区）
const ws = mkdtempSync(join(tmpdir(), 'dag-flow-example-'));
process.chdir(ws);

// 2) stub ctx + 挂载真实 dist
const routes = [];
const stubCtx = {
  logger: { info() {}, warn() {}, error() {} },
  webServer: { register(r) { routes.push(r); return () => {}; } },
};
const mod = await import(pathToFileURL(join(ROOT, 'dist', 'index.js')).href);
mod.apply(stubCtx);

const server = http.createServer(async (req, res) => {
  const pn = new URL(req.url ?? '/', 'http://x').pathname;
  const h = routes.find((r) => r.kind === 'exact' && r.path === pn)?.handler;
  if (!h) { res.statusCode = 404; res.end('no route'); return; }
  try { await h(req, res); } catch (e) { res.statusCode = 500; res.end(String(e?.message ?? e)); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}/api/dag-flow`;
const post = async (p, body) => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

// 3) mock 图片 API（img_baseURL="MOCK" 时自动接线，零费用走真实 image_generate 代码路径）
let mediaPort = 0;
const media = http.createServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://x');
  if (u.pathname === '/images/generations') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: [{ url: `http://127.0.0.1:${mediaPort}/files/x.png` }] }));
    return;
  }
  if (u.pathname === '/files/x.png') {
    res.setHeader('content-type', 'image/png');
    res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]));
    return;
  }
  res.statusCode = 404; res.end('mock 404');
});
await new Promise((ok) => media.listen(0, '127.0.0.1', ok));
mediaPort = media.address().port;
if (inputsOverride.img_baseURL === 'MOCK') inputsOverride.img_baseURL = `http://127.0.0.1:${mediaPort}`;

// 4) 运行示例工作流
const def = JSON.parse(readFileSync(EXAMPLE_PATH, 'utf8'));
def.inputs = { ...(def.inputs ?? {}), ...inputsOverride };
console.log(`▶ 运行示例: ${def.name}（inputs: ${JSON.stringify(def.inputs)}）`);
const t0 = Date.now();
const r = await post('/run', { def });
const wall = Date.now() - t0;
const summary = r.body?.summary ?? {};
console.log(`\n=== 运行结果: HTTP ${r.status} | status=${summary.status} | totalDurationMs=${summary.totalDurationMs} | wall=${wall}ms | failedCount=${summary.failedCount ?? 0} ===`);

const results = summary.results ?? {};
const rows = Object.entries(results).map(([id, n]) => ({ id, type: n.type ?? '', status: n.status, durationMs: n.durationMs ?? 0, code: n.error?.code ?? '', msg: (n.error?.message ?? '').slice(0, 110) }));
const durSum = rows.reduce((a, b) => a + b.durationMs, 0);
for (const row of rows) {
  const flag = row.status === 'success' ? '✓' : row.status === 'skipped' ? '○' : '✗';
  console.log(`  ${flag} ${row.id.padEnd(12)} ${String(row.type).padEnd(16)} ${String(row.status).padEnd(8)} ${String(row.durationMs).padStart(6)}ms ${row.code} ${row.msg}`);
}
console.log(`\n节点耗时合计 ${durSum}ms vs 墙钟 ${summary.totalDurationMs}ms（差值≈并行节省/调度开销）`);

// 关键输出速览（UX：结果可读性）
const wsOut = results.ws?.out;
if (wsOut) console.log(`--- 搜索诊断: engine=${wsOut.engine} viaHost=${wsOut.viaHost} count=${wsOut.count} ---`);
const brief = results.ai_sum?.out ?? '';
if (brief) console.log(`\n--- AI 简报输出（前 300 字）---\n${String(brief).slice(0, 300)}`);
const saved = results.save?.out;
if (saved?.path) console.log(`--- 落盘: ${saved.path}（${saved.bytes ?? '?'} bytes）---`);
const imgOut = results.img?.out;
if (imgOut?.images?.[0]) console.log(`--- 图片: ${imgOut.images[0].path}（${imgOut.images[0].bytes} bytes）---`);

// 5) 必填校验探针（--probes）：可疑节点喂缺失/非法参数，观察错误码质量
if (doProbes) {
  const probes = [
    { name: 'if 条件引用不存在节点', nodeType: 'if', params: { condition: '{{ghost.out}} == 1' } },
    { name: 'set_var 引用不存在节点', nodeType: 'set_var', params: { vars: { x: '{{ghost.out}}' } } },
    { name: 'loop 空参数', nodeType: 'loop', params: {} },
    { name: 'http url 引用不存在节点', nodeType: 'http', params: { url: '{{ghost.out}}' } },
    { name: 'file_save content 引用不存在节点', nodeType: 'file_save', params: { source: 'text', filename: 'p.txt', content: '{{ghost.out}}' } },
    { name: 'subagent model 为空', nodeType: 'subagent', params: { prompt: 'hi', model: '' } },
    { name: 'switch value 引用不存在节点', nodeType: 'switch', params: { value: '{{ghost.out}}', cases: { a: 'x' } } },
    { name: 'image_generate 缺 baseURL/key', nodeType: 'image_generate', params: { prompt: 'x' } },
    { name: 'session_input 空 sessionId', nodeType: 'session_input', params: {} },
    { name: 'bash 纯空白 code', nodeType: 'bash', params: { code: '   ' } },
  ];
  console.log(`\n=== 必填校验探针（${probes.length} 项）===`);
  for (const p of probes) {
    const pr = await post('/run-node', { nodeType: p.nodeType, params: p.params });
    const tgt = pr.body?.summary?.results?.target;
    // 预检拦截时 results 为空、错误在 summary 层（NODE_PARAMS_INVALID）——两层都要取
    const code = tgt?.error?.code ?? pr.body?.summary?.error?.code ?? pr.body?.error ?? '(无错误码)';
    const msg = (tgt?.error?.message ?? pr.body?.summary?.error?.message ?? pr.body?.error ?? '').replace(/\n/g, ' ').slice(0, 130);
    const st = tgt?.status ?? pr.body?.summary?.status ?? pr.status;
    console.log(`  [${p.nodeType}] ${p.name}\n      → ${st} ${code} | ${msg}`);
  }
}

server.close();
media.close();
console.log(`\n工作区（临时）: ${ws}`);
