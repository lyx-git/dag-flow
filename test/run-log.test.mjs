import './_isolate-home.mjs';   // ★ 2026-10-11：隔离 DSH_HOME（存储根 = <DSH_HOME>/.dag-flow）
// test/run-log.test.mjs — 「运行日志」专项验证（2026-10-03 用户需求）
//
// 用户原话：「现在每个节点的执行情况没有日志打印，参数传递是否正常，下个节点接收参数是否正常
//           都没有日志可以看到，无法判断流程中间执行日志情况，节点之间的交互情况也没有，
//           工作流执行黑盒」。
//
// 契约（本文件钉死，改引擎/API 前先看这里）：
//   ① 每个**执行到**的节点都有一条日志：phase='resolved'（入参已解析）→ phase='done'（出参/耗时）
//   ② resolved 记录里 params = **模板已展开**的实际入参（节点真正收到的），rawParams = 原始参数（保留 {{}}）
//   ③ refs 记录「引用了哪些上游节点/变量/输入」——这就是「节点之间的交互」
//   ④ 未命中的分支节点也会记一条 status='skipped'（解释「为什么没跑」）
//   ⑤ 失败节点的 error/tolerated 进日志；容错后下游照常执行
//   ⑥ GET /run/log?name= 按节点合并 resolved+done（同 id 只出现一条，顺序=执行顺序），支持 ?node= 过滤
//
// 手段：伪造 cordis ctx → apply(dist/index.js) → 本地服务 → POST /run 后读 GET /run/log。
// 跑法：node test/run-log.test.mjs
import * as http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pass = 0, fail = 0;
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

const fakeWorkspace = mkdtempSync(join(tmpdir(), 'dag-flow-log-'));
process.chdir(fakeWorkspace);
// ★ 2026-10-04：隔离宿主目录（dsh-home 会解析 DSH_HOME），别让测试碰真实 ~/.dsh
process.env.DSH_HOME = join(fakeWorkspace, '.dsh-home');
const API_BASE = '/api/dag-flow';

const routes = [];
const stubCtx = {
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  webServer: { register(route) { routes.push(route); return () => {}; } },
};
await import('file:///D:/workspace/pluginspace/dag-flow/dist/index.js').then((m) => m.apply(stubCtx));
t('apply(ctx) 捕获到路由', routes.length >= 8, `routes=${routes.length}`);

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
const base = `http://127.0.0.1:${port}${API_BASE}`;

const postRun = async (def) => {
  const r = await fetch(`${base}/run`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ def }),
  });
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* 非 JSON → 保留原文 */ }
  if (r.status !== 200) console.log(`    ↳ 原始响应 ${r.status}：${text.slice(0, 300)}`);
  return { httpStatus: r.status, summary: body?.summary ?? null };
};
const getLog = async (name, node = '') => {
  const r = await fetch(`${base}/run/log?name=${encodeURIComponent(name)}${node ? `&node=${encodeURIComponent(node)}` : ''}`);
  const body = await r.json().catch(() => null);
  return { httpStatus: r.status, body };
};

// ===== 工作流 1：参数传递 + 分支跳过 =====
// cfg(print hello) → use(print got-<cfg.out>) → gate(恒假) -true→ yes / -false→ no → end
const wfBranch = {
  name: 'log-branch', version: 1,
  nodes: [
    { id: 'start', type: 'start' },
    { id: 'cfg', type: 'python', params: { code: 'print("hello", end="")' } },
    { id: 'use', type: 'python', params: { code: 'print("got-{{cfg.out}}")' } },
    { id: 'gate', type: 'if', params: { condition: '1 == 2' } },
    { id: 'yes', type: 'python', params: { code: 'print("yes")' } },
    { id: 'no', type: 'python', params: { code: 'print("no")' } },
    { id: 'end', type: 'end' },
  ],
  edges: [
    { from: 'start', to: 'cfg' },
    { from: 'cfg', to: 'use' },
    { from: 'use', to: 'gate' },
    { from: 'gate', to: 'yes', when: 'true' },
    { from: 'gate', to: 'no', when: 'false' },
    { from: 'yes', to: 'end' },
    { from: 'no', to: 'end' },
  ],
};

console.log('== A. 逐节点日志（入参 → 出参）==');
{
  const { summary } = await postRun(wfBranch);
  t('A0. 工作流跑通（前置条件）', summary?.status === 'success', JSON.stringify(summary?.error));
  const { httpStatus, body } = await getLog('log-branch');
  t('A1. GET /run/log 返回 200', httpStatus === 200, `HTTP ${httpStatus} ${JSON.stringify(body)?.slice(0, 160)}`);
  const entries = body?.entries ?? [];
  const byId = Object.fromEntries(entries.map((e) => [e.id, e]));
  t('A2. live=false（跑完的运行）', body?.live === false, JSON.stringify(body?.live));
  t('A3. 覆盖到执行的每个节点', ['cfg', 'use', 'gate', 'no', 'end'].every((id) => byId[id]), `ids=${entries.map((e) => e.id).join(',')}`);
  t('A4. 同 id 只出现一条（resolved+done 已合并）', entries.length === new Set(entries.map((e) => e.id)).size, `n=${entries.length}`);
  t('A5. 顺序 = 执行顺序（cfg 在 use 之前，use 在 gate 之前）',
    entries.findIndex((e) => e.id === 'cfg') < entries.findIndex((e) => e.id === 'use')
    && entries.findIndex((e) => e.id === 'use') < entries.findIndex((e) => e.id === 'gate'),
    entries.map((e) => e.id).join('→'));

  t('A6. cfg 出参可见（stdout 含 hello）', String(byId.cfg?.out ?? '').includes('hello'), JSON.stringify(byId.cfg?.out));
  t('A7. cfg 状态 success', byId.cfg?.status === 'success', String(byId.cfg?.status));
  t('A8. cfg 耗时被记录', typeof byId.cfg?.durationMs === 'number' && byId.cfg.durationMs >= 0, String(byId.cfg?.durationMs));
}

console.log('== B. 参数传递（原始参数 vs 实际入参）+ 节点间引用 ==');
{
  const { body } = await getLog('log-branch');
  const byId = Object.fromEntries((body?.entries ?? []).map((e) => [e.id, e]));
  const use = byId.use ?? {};
  t('B1. 原始参数保留 {{}} 引用', String(use.rawParams?.code ?? '').includes('{{cfg.out}}'), JSON.stringify(use.rawParams));
  t('B2. 实际入参已展开（不再含 {{）', String(use.params?.code ?? '').includes('got-hello') && !String(use.params?.code ?? '').includes('{{'), JSON.stringify(use.params));
  t('B3. 记录引用到的上游节点 cfg', (use.refs?.nodeRefs ?? []).includes('cfg'), JSON.stringify(use.refs));
  t('B4. 出参可见（use 跑的是展开后的代码）', String(use.out ?? '').includes('got-hello'), JSON.stringify(use.out));
  t('B5. cfg 无上游引用（nodeRefs 为空）', (byId.cfg?.refs?.nodeRefs ?? []).length === 0, JSON.stringify(byId.cfg?.refs));
}

console.log('== C. 未命中分支的节点也留痕（skipped）==');
{
  const { body } = await getLog('log-branch');
  const byId = Object.fromEntries((body?.entries ?? []).map((e) => [e.id, e]));
  t('C1. true 分支的 yes 记 skipped', byId.yes?.status === 'skipped', JSON.stringify(byId.yes));
  t('C2. false 分支的 no 真的跑了（status=success）', byId.no?.status === 'success', JSON.stringify(byId.no));
  t('C3. gate 的出参是真假值（分支判定可见）', byId.gate?.out === false, JSON.stringify(byId.gate?.out));
  t('C4. gate 的实际入参含条件表达式（参数传递可核对）', String(byId.gate?.params?.condition ?? '').includes('1 == 2'), JSON.stringify(byId.gate?.params));
}

// ===== 工作流 2：失败 + 容错（tolerate）=====
// start → g1 → g2(引用 g1) → bad(勾了容错、必定失败) → end
const wfFail = {
  name: 'log-fail', version: 1,
  nodes: [
    { id: 'start', type: 'start' },
    { id: 'g1', type: 'python', params: { code: 'print("A", end="")' } },
    { id: 'g2', type: 'python', params: { code: 'print("B-{{g1.out}}")' } },
    { id: 'bad', type: 'python', params: { code: 'import sys\nsys.exit(3)' }, tolerate: true },
    { id: 'end', type: 'end' },
  ],
  edges: [
    { from: 'start', to: 'g1' },
    { from: 'g1', to: 'g2' },
    { from: 'g2', to: 'bad' },
    { from: 'bad', to: 'end' },
  ],
};
console.log('== D. 失败节点 + 容错在日志里可见 ==');
{
  const { summary } = await postRun(wfFail);
  t('D0. 容错失败不拖垮整条流程（summary=success）', summary?.status === 'success', JSON.stringify(summary?.error));
  const { body } = await getLog('log-fail');
  const byId = Object.fromEntries((body?.entries ?? []).map((e) => [e.id, e]));
  t('D1. bad 记 failed', byId.bad?.status === 'failed', JSON.stringify(byId.bad?.status));
  t('D2. bad 的错误原因进日志', !!byId.bad?.error?.code, JSON.stringify(byId.bad?.error));
  t('D3. bad 标 tolerated（已容错放行）', byId.bad?.tolerated === true, JSON.stringify(byId.bad?.tolerated));
  t('D4. g2 实际入参已展开（B-A）', String(byId.g2?.params?.code ?? '').includes('B-A'), JSON.stringify(byId.g2?.params));
  t('D5. g2 记录了引用了 g1', (byId.g2?.refs?.nodeRefs ?? []).includes('g1'), JSON.stringify(byId.g2?.refs));
  t('D6. 容错后下游 end 照常执行（日志里有 success 的 end）', byId.end?.status === 'success', JSON.stringify(byId.end?.status));
}

console.log('== E. 端点行为 ==');
{
  const one = await getLog('log-branch', 'cfg');
  t('E1. ?node= 过滤只回一条', (one.body?.entries ?? []).length === 1 && one.body.entries[0].id === 'cfg', JSON.stringify(one.body?.entries));
  const none = await getLog('从来没有跑过的工作流');
  t('E2. 查无日志 → 404', none.httpStatus === 404, `HTTP ${none.httpStatus}`);
  const dup = await getLog('log-branch');
  t('E3. 条目数 = 工作流节点数（7：含 skipped 的 yes，不重复）', (dup.body?.entries ?? []).length === 7, `n=${(dup.body?.entries ?? []).length}`);
}

server.close();
console.log(`\n=== run-log: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
