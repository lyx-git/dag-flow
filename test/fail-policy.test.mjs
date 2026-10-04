// test/fail-policy.test.mjs — DAG 失败策略专项（2026-10-04 轮 2，用户拍板「合并执行模型」第二棒）
//
// 背景：旧 DAG 执行器只有一个失败语义——`failedCount>0 → break`，**全图停**；
//   节点级 onError（stop/continue/goto）当时只在 legacy next 递归路径被读取（该路径已于轮 4 删除），
//   画布工作流上一律无效。轮 2 把失败策略搬进 DAG，语义定为：**只停该节点的下游，其它分支继续**。
//
// 契约（本文件钉死）：
//   A. stop（默认）：失败节点的出边全部作废 → 它的下游跳过；**其它分支照常跑完**；运行记 failed + firstError
//   B. skip（onError:'continue'）：同样只停下游，但**不计入** failedCount/firstError → status=success + toleratedCount
//   C. ignore（tolerate:true）：下游**照常执行**，不计失败
//   D. 跨源：目标只要有**任意一条活入边**就必须执行（旧实现"逐源累加"会误跳过 → 本轮修）
//   E. 传递性：节点被跳过 ⇒ 它的出边也作废（孙节点不能被执行）
//   F. 条件分支：switch 未命中分支的下游（孙节点）也必须跳过（旧实现会执行）
//
// 手段同 tolerate.test.mjs：伪造 cordis ctx → apply(dist/index.js) → 本地服务 → POST /run 读 summary。
// 跑法：node test/fail-policy.test.mjs
import * as http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pass = 0, fail = 0;
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

const fakeWorkspace = mkdtempSync(join(tmpdir(), 'dag-flow-failpol-'));
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
const run = async (def) => {
  const r = await fetch(`http://127.0.0.1:${port}${API_BASE}/run`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ def }),
  });
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* 保留原文 */ }
  if (r.status !== 200) console.log(`    ↳ 原始响应 ${r.status}：${text.slice(0, 300)}`);
  return { httpStatus: r.status, summary: body?.summary ?? null };
};

const failCode = 'import sys\nsys.exit(3)';
const boom = (id, extra = {}) => ({ id, type: 'python', params: { code: failCode }, ...extra });
const lg = (id, msg = 'ok') => ({ id, type: 'log', params: { level: 'info', message: msg } });
const SKIP = 'skipped';

// ───────── A. stop（默认）：只停下游，其它分支照常跑完 ─────────
console.log('\n== A. stop（默认）：失败节点的下游跳过；**其它分支继续**（旧实现是全图停）==');
{
  const { httpStatus, summary } = await run({
    name: 'fp-stop__', version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      boom('boom'), lg('ok'), lg('d_boom'), lg('d_ok'),
      { id: 'end', type: 'end' },
    ],
    edges: [
      { from: 'start', to: 'boom' }, { from: 'start', to: 'ok' },
      { from: 'boom', to: 'd_boom' }, { from: 'ok', to: 'd_ok' },
      { from: 'd_boom', to: 'end' }, { from: 'd_ok', to: 'end' },
    ],
  });
  const R = summary?.results ?? {};
  t('HTTP 200', httpStatus === 200, `status=${httpStatus}`);
  t('A1. 失败节点 status=failed', R.boom?.status === 'failed', JSON.stringify(R.boom?.status));
  t('A2. 它的直接下游被标 skipped', R.d_boom?.status === SKIP, JSON.stringify(R.d_boom?.status));
  t('A3. ★另一条分支的下游**照常执行**（旧实现：全图停 → 这里什么都没有）', R.d_ok?.status === 'success', JSON.stringify(R.d_ok?.status));
  t('A4. ★汇合点 end 照常执行（它有 d_ok 这条活入边）', R.end?.status === 'success', JSON.stringify(R.end?.status));
  t('A5. 汇总 status=failed + failedCount=1', summary?.status === 'failed' && summary?.failedCount === 1, JSON.stringify({ s: summary?.status, f: summary?.failedCount }));
  t('A6. firstError 指向失败节点（带错误码）', summary?.error?.nodeId === 'boom' && typeof summary?.error?.code === 'string' && summary.error.code.length > 0, JSON.stringify(summary?.error));
  t('A7. skippedCount=1', summary?.skippedCount === 1, JSON.stringify(summary?.skippedCount));
}

// ───────── B. skip（面板「跳过这条支路，不算运行失败」= onError:'continue'）─────────
console.log('\n== B. skip：同样只停下游，但这次失败不计入运行失败 ==');
{
  const { summary } = await run({
    name: 'fp-skip__', version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      boom('boom', { onError: 'continue' }), lg('ok'), lg('d_boom'), lg('d_ok'),
      { id: 'end', type: 'end' },
    ],
    edges: [
      { from: 'start', to: 'boom' }, { from: 'start', to: 'ok' },
      { from: 'boom', to: 'd_boom' }, { from: 'ok', to: 'd_ok' },
      { from: 'd_boom', to: 'end' }, { from: 'd_ok', to: 'end' },
    ],
  });
  const R = summary?.results ?? {};
  t('B1. 下游同样被标 skipped（与 A 一致：只停下游）', R.d_boom?.status === SKIP, JSON.stringify(R.d_boom?.status));
  t('B2. 其它分支照常执行', R.d_ok?.status === 'success' && R.end?.status === 'success', JSON.stringify({ d_ok: R.d_ok?.status, end: R.end?.status }));
  t('B3. 节点自身仍是 failed + tolerated=true（不伪装成功）', R.boom?.status === 'failed' && R.boom?.tolerated === true, JSON.stringify({ s: R.boom?.status, tol: R.boom?.tolerated }));
  t('B4. 不计入 failedCount → 汇总 status=success', summary?.status === 'success' && summary?.failedCount === 0, JSON.stringify({ s: summary?.status, f: summary?.failedCount }));
  t('B5. toleratedCount=1 且无 firstError（不弹失败详情）', summary?.toleratedCount === 1 && summary?.error === undefined, JSON.stringify({ tol: summary?.toleratedCount, err: summary?.error }));
}

// ───────── C. ignore（面板「忽略失败，下游照常执行」= tolerate）─────────
console.log('\n== C. ignore：下游**照常执行**（与 B 的唯一区别就在这一条）==');
{
  const { summary } = await run({
    name: 'fp-ignore__', version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      boom('boom', { tolerate: true }), lg('ok'), lg('d_boom'), lg('d_ok'),
      { id: 'end', type: 'end' },
    ],
    edges: [
      { from: 'start', to: 'boom' }, { from: 'start', to: 'ok' },
      { from: 'boom', to: 'd_boom' }, { from: 'ok', to: 'd_ok' },
      { from: 'd_boom', to: 'end' }, { from: 'd_ok', to: 'end' },
    ],
  });
  const R = summary?.results ?? {};
  t('C1. ★下游照常执行（与 B 的 skipped 形成对照）', R.d_boom?.status === 'success', JSON.stringify(R.d_boom?.status));
  t('C2. end 照常执行', R.end?.status === 'success', JSON.stringify(R.end?.status));
  t('C3. 不计失败：status=success + toleratedCount=1', summary?.status === 'success' && summary?.toleratedCount === 1, JSON.stringify({ s: summary?.status, tol: summary?.toleratedCount }));
  t('C4. skippedCount=0（没有节点被跳过）', summary?.skippedCount === 0, JSON.stringify(summary?.skippedCount));
}

// ───────── D. 跨源：目标只要有任意一条活入边就必须执行（本轮修的 bug）─────────
console.log('\n== D. 跨源：目标被另一条活边喂入时必须执行（旧"逐源累加"会误跳过）==');
{
  const { summary } = await run({
    name: 'fp-cross__', version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      boom('boom'), lg('ok'), lg('T'), { id: 'end', type: 'end' },
    ],
    edges: [
      { from: 'start', to: 'boom' }, { from: 'start', to: 'ok' },
      { from: 'boom', to: 'T' }, { from: 'ok', to: 'T' }, { from: 'T', to: 'end' },
    ],
  });
  const R = summary?.results ?? {};
  t('D1. ★T 有一条活入边（ok→T）→ 必须执行（不被 boom 的失败连带跳过）', R.T?.status === 'success', JSON.stringify(R.T?.status));
  t('D2. 下游 end 照常执行', R.end?.status === 'success', JSON.stringify(R.end?.status));
}

// ───────── E. 传递性：被跳过节点的出边也作废 ─────────
console.log('\n== E. 传递性：失败 → 中游跳过 → 孙节点也不能执行 ==');
{
  const { summary } = await run({
    name: 'fp-chain__', version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      boom('boom'), lg('m'), lg('deep'), { id: 'end', type: 'end' },
    ],
    edges: [
      { from: 'start', to: 'boom' },
      { from: 'boom', to: 'm' }, { from: 'm', to: 'deep' }, { from: 'deep', to: 'end' },
    ],
  });
  const R = summary?.results ?? {};
  t('E1. 中游被跳过', R.m?.status === SKIP, JSON.stringify(R.m?.status));
  t('E2. ★孙节点 deep 也被跳过（旧实现会执行它——空输入跑一遍）', R.deep?.status === SKIP, JSON.stringify(R.deep?.status));
  t('E3. 末端 end 同样跳过（整条链都死了）', R.end?.status === SKIP, JSON.stringify(R.end?.status));
  t('E4. skippedCount=3', summary?.skippedCount === 3, JSON.stringify(summary?.skippedCount));
}

// ───────── F. 条件分支：未命中分支的**下游**也必须跳过 ─────────
console.log('\n== F. 条件分支：switch 未命中 case 的下游（孙节点）也要跳过 ==');
{
  const { summary } = await run({
    name: 'fp-branch__', version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'sw', type: 'switch', params: { value: 'a', cases: { a: 'ta', b: 'tb' } } },
      lg('ta'), lg('tb'), lg('ta2'), lg('tb2'),
      { id: 'end', type: 'end' },
    ],
    edges: [
      { from: 'start', to: 'sw' },
      { from: 'sw', to: 'ta', when: 'a' }, { from: 'sw', to: 'tb', when: 'b' },
      { from: 'ta', to: 'ta2' }, { from: 'tb', to: 'tb2' },
      { from: 'ta2', to: 'end' }, { from: 'tb2', to: 'end' },
    ],
  });
  const R = summary?.results ?? {};
  t('F1. 命中 case 的分支执行', R.ta?.status === 'success' && R.ta2?.status === 'success', JSON.stringify({ ta: R.ta?.status, ta2: R.ta2?.status }));
  t('F2. 未命中 case 的分支被跳过', R.tb?.status === SKIP, JSON.stringify(R.tb?.status));
  t('F3. ★它的下游 tb2 也跳过（旧实现：只跳过 tb，tb2 会照跑）', R.tb2?.status === SKIP, JSON.stringify(R.tb2?.status));
  t('F4. 汇合点 end 照常执行（ta2 那条活边）', R.end?.status === 'success', JSON.stringify(R.end?.status));
}

server.close();
console.log(`\n=== fail-policy DAG 失败策略：${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
