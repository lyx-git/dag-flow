// test/status-midrun.test.mjs — 「运行中的逐节点结果」契约（2026-10-03 用户反馈）
//
// 用户原话：「画布节点悬浮弹窗的执行结果，为何要等工作流全部执行完才能显示，不应该是执行完一个节点，
//           悬浮窗内容就应该正常显示执行结果吗，并且结果也要给下个节点使用的」
//
// 本文件钉死两件事（一条链路同时验证）：
//   ① GET /run/status 在**流程还在跑**时，就已完成的节点必须带 out（此前只带 status/durationMs，
//      所以悬浮卡要等 POST /run 返回完整 summary 才显示结果）；
//   ② 上游结果在下游**执行时**就已可用（{{上游.out}} 真被解析），不是等最后才汇总——
//      用 a(输出 HELLO-A) → b(睡 2s，打印 B-GOT:<a.out>) → c(log 记录 C-SAW:<b.out>) 证明。
//
// 手段同 tolerate.test.mjs：伪造 cordis ctx → apply(dist/index.js) → 本地服务 → 不 await 地 POST /run，
// 同时轮询 /run/status 抓"运行中"窗口。跑法：node test/status-midrun.test.mjs
import * as http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pass = 0, fail = 0;
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fakeWorkspace = mkdtempSync(join(tmpdir(), 'dag-flow-midrun-'));
process.chdir(fakeWorkspace);
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

// a：纯输出；b：睡 2 秒（制造"运行中"窗口）并把 a.out 拼进自己的输出；c：log 记录 b.out
const def = {
  name: 'midrun-status', version: 1,
  nodes: [
    { id: 'start', type: 'start' },
    { id: 'a', type: 'python', params: { code: 'print("HELLO-A", end="")' } },
    { id: 'b', type: 'python', params: { code: 'import time\ntime.sleep(2)\nprint("B-GOT:{{a.out}}", end="")' } },
    { id: 'c', type: 'log', params: { level: 'info', message: 'C-SAW:{{b.out}}' } },
    { id: 'end', type: 'end' },
  ],
  edges: [
    { from: 'start', to: 'a' },
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
    { from: 'c', to: 'end' },
  ],
};

console.log('== A. 运行中（流程未结束）就已完成的节点带 out ==');
const finished = fetch(`${base}/run`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ def }),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

let mid = null;
for (let i = 0; i < 40 && !mid; i++) {
  await sleep(150);
  const r = await fetch(`${base}/run/status?name=${encodeURIComponent(def.name)}`);
  if (!r.ok) continue;
  const j = await r.json();
  // 抓到「a 已完成（带 out）+ 流程仍在跑」的那一刻
  if (j.status === 'running' && j.results?.a?.out !== undefined) mid = j;
}
t('A1. 抓到了「运行中 + a 已完成」的窗口', !!mid, mid ? '' : '40 次轮询内没有出现（a 的 out 一直缺）');
t('A2. 运行中 a 的结果带 out 且内容正确', String(mid?.results?.a?.out ?? '') === 'HELLO-A', JSON.stringify(mid?.results?.a));
t('A3. 同一时刻 b 正在执行（running 列表含 b）', (mid?.running ?? []).includes('b'), JSON.stringify(mid?.running));
t('A4. 运行中状态仍是 running（不是等跑完才给结果）', mid?.status === 'running', String(mid?.status));
t('A5. 运行中未轮到的节点不在 results 里（不会伪造结果）', mid?.results?.c === undefined, JSON.stringify(mid?.results?.c));
t('A6. 运行中 a 的 durationMs 也在（徽标要显示耗时）', typeof mid?.results?.a?.durationMs === 'number', JSON.stringify(mid?.results?.a));

console.log('== B. 最终 summary：链式数据传递 ==');
const done = await finished;
t('B0. 整条流程成功', done.status === 200 && done.body?.summary?.status === 'success', JSON.stringify(done.body?.summary?.error));
const res = done.body?.summary?.results ?? {};
t('B1. a.out = HELLO-A', String(res.a?.out ?? '') === 'HELLO-A', JSON.stringify(res.a));
t('B2. b 执行时拿到了上游 a 的结果（{{a.out}} 被解析）', String(res.b?.out ?? '') === 'B-GOT:HELLO-A', JSON.stringify(res.b));
t('B3. c 又拿到 b 的结果（链式传递）', String(res.c?.out ?? '') === 'C-SAW:B-GOT:HELLO-A', JSON.stringify(res.c));
t('B4. 最终结果的 out 未被裁剪（短输出原样）', typeof res.a?.out === 'string', typeof res.a?.out);

console.log('== C. 契约不变 ==');
const none = await fetch(`${base}/run/status`);
t('C1. 既不带 name 也不带 runId → 404（既有语义不变）', none.status === 404, `HTTP ${none.status}`);

// ===== D. 定时触发的运行同样可见（2026-10-03 用户真机反馈：「定时任务执行，工作流的状态不会变化」）=====
//   根因：状态轮询只挂在手动点运行那条路径上，而定时是宿主调度器直跑、不进登记表 → 画布毫无反应。
//   修法：定时运行登记到**同一张表**（runRegistry），并在结束后按工作流名留一份「最近一次完成」供收敛。
console.log('== D. 定时触发的运行也要能点亮画布 ==');
const schedDef = {
  name: 'sched-visible', version: 1,
  nodes: [
    { id: 'start', type: 'start' },
    { id: 'slow', type: 'python', params: { code: 'import time\ntime.sleep(1.5)\nprint("SLOW-DONE", end="")' } },
    { id: 'end', type: 'end' },
  ],
  edges: [{ from: 'start', to: 'slow' }, { from: 'slow', to: 'end' }],
};
const saved = await fetch(`${base}/workflows/save`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: schedDef.name, def: schedDef }),
});
t('D1. 工作流已保存（定时项按名字跑）', saved.status === 200, `HTTP ${saved.status}`);

const mk = await fetch(`${base}/schedules/save`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ workflow: schedDef.name, cron: '* * * * *', enabled: true }),
});
const mkBody = await mk.json().catch(() => ({}));
t('D2. 建了一条定时项', mk.status === 200 && !!mkBody?.item?.id, `HTTP ${mk.status} ${JSON.stringify(mkBody).slice(0, 160)}`);
// 先确认「没跑时」查不到在跑的实例（避免后面的断言是假阳性）
const idle = await fetch(`${base}/run/status?name=${encodeURIComponent(schedDef.name)}`);
t('D3. 还没跑时 /run/status?name= 查不到运行（404）', idle.status === 404, `HTTP ${idle.status}`);

// 触发「立即运行一次」但**不等它**（该请求会 hold 到跑完），同时轮询状态 —— 这正是定时到点时的时序
const schedRunPromise = fetch(`${base}/schedules/run`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ id: mkBody.item.id }),
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

let hostMid = null;
for (let i = 0; i < 60 && !hostMid; i++) {
  await sleep(100);
  const r = await fetch(`${base}/run/status?name=${encodeURIComponent(schedDef.name)}`);
  if (!r.ok) continue;
  const j = await r.json();
  if (j.status === 'running') hostMid = j;
}
t('D4. 定时运行在跑时，/run/status?name= 能看到「运行中」（此前完全看不到 → 画布不动）', !!hostMid, hostMid ? '' : '60 次轮询内没见到 running');
t('D5. 该运行被标为定时来源 origin=schedule', hostMid?.origin === 'schedule', String(hostMid?.origin));
t('D6. 运行中带正在执行的节点（画布据此点亮「运行中」）', (hostMid?.running ?? []).includes('slow'), JSON.stringify(hostMid?.running));

const schedDone = await schedRunPromise;
t('D7. 「立即运行一次」返回成功', schedDone.status === 200 && schedDone.body?.ok === true, JSON.stringify(schedDone.body).slice(0, 200));
const after = await fetch(`${base}/run/status?name=${encodeURIComponent(schedDef.name)}`);
const afterBody = await after.json().catch(() => ({}));
t('D8. 跑完后按名字仍能查到**最近一次完成**（客户端据此收敛到终态，而不是 404 卡住）',
  after.status === 200 && afterBody?.status === 'completed', `HTTP ${after.status} status=${afterBody?.status}`);
t('D9. 收敛用的结果里 slow 节点是 success 且带 out',
  afterBody?.results?.slow?.status === 'success' && String(afterBody?.results?.slow?.out ?? '') === 'SLOW-DONE',
  JSON.stringify(afterBody?.results?.slow));
t('D10. 定时项已回写上次执行结果', !!schedDone.body?.item?.lastRun?.at, JSON.stringify(schedDone.body?.item?.lastRun));

server.close();
console.log(`\n=== status-midrun：${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
