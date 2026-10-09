// test/cancel.test.mjs — 取消运行（2026-10-08 用户报「点取消没用，又恢复到运行中」的回归锁）
//
// 用户原话：「工作流运行中的时候，点取消按钮没用，又恢复到运行中了，没取消掉工作流运行」。
// 修法分两处（本文件锁**引擎侧**那处）：
//   ① python / bash 节点此前**完全不接 ctx.signal** ✗（只有超时 kill）→ 正在跑的脚本无法中断，
//      取消要等它自己跑完、甚至撞 300s 超时 ✗。现在 abort → SIGKILL 子进程 + 立刻 RUN_CANCELLED。
//   ② 客户端"取消中"状态（不归本文件管，见 CDP selfcheck/live-status 与 FlowPanel）。
// 手段：真实宿主 bundle + 本地 http 挂路由（与 loop.test.mjs 同一套），POST /run 后中途 DELETE。
import http from 'node:http';

let pass = 0, fail = 0;
const t = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => t(JSON.stringify(a) === JSON.stringify(b), `${msg}（actual=${JSON.stringify(a)} expected=${JSON.stringify(b)}）`);

const API_BASE = '/api/dag-flow';
const routes = [];
const stubCtx = {
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  webServer: { register(route) { routes.push(route); return () => {}; } },
};
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
const url = (p) => `http://127.0.0.1:${port}${API_BASE}${p}`;

const pySleep = (sec, name) => ({
  name, version: 1,
  nodes: [
    { id: 'start', type: 'start' },
    { id: 'slow', type: 'python', params: { code: `import time\nprint("STARTED", flush=True)\ntime.sleep(${sec})\nprint("DONE")`, timeoutMs: 60000 } },
    { id: 'end', type: 'end' },
  ],
  edges: [{ from: 'start', to: 'slow' }, { from: 'slow', to: 'end' }],
});

console.log('== A. python 节点：运行中取消 → 立刻 RUN_CANCELLED（不再等脚本跑完） ==');
{
  const name = `cancel-py-${Date.now()}`;
  const started = Date.now();
  const running = fetch(url('/run'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ skipSelfcheck: true, def: pySleep(20, name) }),
  });
  // 等它真的跑起来（宿主已登记这次运行）再取消
  let registered = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const s = await fetch(url(`/run/status?name=${encodeURIComponent(name)}`));
    if (s.ok) { registered = true; break; }
  }
  t(registered, 'A1. 运行已登记（/run/status 查得到）');
  const del = await fetch(url(`/run?name=${encodeURIComponent(name)}`), { method: 'DELETE' });
  const delBody = await del.json().catch(() => ({}));
  t(del.status === 200 && delBody?.ok === true, `A2. DELETE /run → 200 {ok:true}（实际 ${del.status}）`);

  const r = await running;
  const body = await r.json().catch(() => ({}));
  const elapsed = Date.now() - started;
  const slow = body?.summary?.results?.slow;
  t(elapsed < 10_000, `A3. ★取消后**很快**返回（实际 ${elapsed}ms；脚本本身要 sleep 20s——说明被 kill 了）`);
  eq(slow?.status, 'failed', 'A4. slow 节点记 failed');
  eq(slow?.error?.code, 'RUN_CANCELLED', 'A5. ★错误码 RUN_CANCELLED（与其它节点同码）');
  eq(body?.summary?.status, 'failed', 'A6. 整轮 summary=failed');
  t(body?.summary?.error?.code === 'RUN_CANCELLED', `A7. 运行级 firstError 也是 RUN_CANCELLED（实际 ${body?.summary?.error?.code}）`);
}

console.log('\n== B. 取消永不算容错（tolerate 也救不了它） ==');
{
  const name = `cancel-tol-${Date.now()}`;
  const def = pySleep(20, name);
  def.nodes[1].tolerate = true;
  const running = fetch(url('/run'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ skipSelfcheck: true, def }),
  });
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const s = await fetch(url(`/run/status?name=${encodeURIComponent(name)}`));
    if (s.ok) break;
  }
  await fetch(url(`/run?name=${encodeURIComponent(name)}`), { method: 'DELETE' });
  const body = await (await running).json().catch(() => ({}));
  const slow = body?.summary?.results?.slow;
  eq(slow?.tolerated, undefined, 'B1. ★RUN_CANCELLED 永不算容错（tolerated 不置位）');
  eq(body?.summary?.status, 'failed', 'B2. 整轮仍 failed（不会被容错洗成 success）');
}

console.log('\n== C. 取消后 /run/status 不再报在跑（客户端据此落定"已取消"） ==');
{
  const name = `cancel-st-${Date.now()}`;
  const running = fetch(url('/run'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ skipSelfcheck: true, def: pySleep(20, name) }),
  });
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const s = await fetch(url(`/run/status?name=${encodeURIComponent(name)}`));
    if (s.ok) break;
  }
  await fetch(url(`/run?name=${encodeURIComponent(name)}`), { method: 'DELETE' });
  await running;
  const s = await fetch(url(`/run/status?name=${encodeURIComponent(name)}`));
  const j = s.ok ? await s.json() : {};
  t(j.status !== 'running', `C1. ★取消后 status 不再是 running（实际 ${j.status ?? '（无记录）'}）`);
}

console.log('\n== D. 正常跑完的运行不受影响（没取消时行为不变） ==');
{
  const name = `cancel-ok-${Date.now()}`;
  const r = await fetch(url('/run'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ skipSelfcheck: true, def: {
      name, version: 1,
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'py', type: 'python', params: { code: 'print("hello")' } },
        { id: 'end', type: 'end' },
      ],
      edges: [{ from: 'start', to: 'py' }, { from: 'py', to: 'end' }],
    } }),
  });
  const body = await r.json().catch(() => ({}));
  eq(body?.summary?.status, 'success', 'D1. 没取消 → 正常 success（python 节点行为未变）');
  t(String(body?.summary?.results?.py?.out ?? '').includes('hello'), 'D2. 输出正常返回');
}

server.close();
console.log(`\n=== cancel（取消运行）：${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
