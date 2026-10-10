import './_isolate-home.mjs';   // ★ 2026-10-11：隔离 DSH_HOME（存储根 = <DSH_HOME>/.dag-flow）
// test/goto-edge.test.mjs — DAG 失败跳转 onError:{goto} 专项（2026-10-04 轮 3）
//
// 背景：轮 2 把 stop/continue 搬进 DAG 后，goto 一直"暂时按 stop 处理"（面板也只显示只读项）。
//   轮 3 补齐：**失败边**语义 —— 节点失败且未容错 → 跳过本节点的下游，直接跳到目标节点继续。
//
// 契约（本文件钉死）：
//   A. goto 到**还没跑到的层**：目标被"指定必跑"（本来会因失败节点的出边作废而被跳过）→ 执行；
//      失败节点的其它下游仍然跳过；汇合点只要有活入边就继续。
//   B. 目标只执行一次：目标若在本节点**之前**（已执行过）→ 跳转不生效、按"停止这条支路"处理，
//      并把原因写进该节点的错误消息（悬浮卡/失败详情可见，不静默）。
//   C. 目标已过层（同层或更早但未执行）→ 同样不重复执行 + 写明原因。
//   D. goto 失败本身仍计入运行失败（failedCount/firstError 指向它），与 stop 一致的记账。
//   E. goto 目标的下游照常继续（跳转不是终点）。
//
// 手段同 fail-policy.test.mjs：伪造 cordis ctx → apply(dist/index.js) → 本地服务 → POST /run 读 summary。
// 跑法：node test/goto-edge.test.mjs
import * as http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pass = 0, fail = 0;
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

const fakeWorkspace = mkdtempSync(join(tmpdir(), 'dag-flow-goto-'));
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
const lg = (id, msg = 'ok') => ({ id, type: 'log', params: { level: 'info', message: msg } });

// ───────── A. goto 到后续层的目标（本来会被跳过）→ 目标必须执行 ─────────
console.log('\n== A. goto 到还没跑到的节点 → 目标执行（它本来会因失败节点的出边作废而被跳过）==');
{
  const { httpStatus, summary } = await run({
    name: 'goto-forward__', version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'boom', type: 'python', params: { code: failCode }, onError: { goto: 'T' } },
      lg('T', '兜底路径'), lg('d_boom', '正常路径'), { id: 'end', type: 'end' },
    ],
    edges: [
      { from: 'start', to: 'boom' },
      { from: 'boom', to: 'd_boom' },   // 失败节点的正常下游 → 跳过
      { from: 'boom', to: 'T' },        // goto 目标（靠 goto 才跑）
      { from: 'd_boom', to: 'end' }, { from: 'T', to: 'end' },
    ],
  });
  const R = summary?.results ?? {};
  t('HTTP 200', httpStatus === 200, `status=${httpStatus}`);
  t('A1. ★goto 目标执行成功（失败边生效）', R.T?.status === 'success', JSON.stringify(R.T?.status));
  t('A2. 失败节点的正常下游仍被跳过', R.d_boom?.status === 'skipped', JSON.stringify(R.d_boom?.status));
  t('A3. 汇合点 end 执行（它有 T 这条活入边）', R.end?.status === 'success', JSON.stringify(R.end?.status));
  t('A4. 失败节点自身仍 failed', R.boom?.status === 'failed', JSON.stringify(R.boom?.status));
  t('A5. 记入运行失败 + firstError 指向它（goto 不当成"已处理"）', summary?.status === 'failed' && summary?.error?.nodeId === 'boom',
    JSON.stringify({ s: summary?.status, err: summary?.error }));
  t('A6. skippedCount=1（只跳过了正常下游）', summary?.skippedCount === 1, JSON.stringify(summary?.skippedCount));
}

// ───────── B. 目标在本节点之前（已执行过）→ 只执行一次：不重复执行 + 写明原因 ─────────
console.log('\n== B. 目标已经跑过 → 不重复执行（只执行一次）+ 错误详情写明原因 ==');
{
  const { summary } = await run({
    name: 'goto-backward__', version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      lg('pre', '前面的节点'),
      { id: 'boom', type: 'python', params: { code: failCode }, onError: { goto: 'pre' } },
      { id: 'end', type: 'end' },
    ],
    edges: [
      { from: 'start', to: 'pre' }, { from: 'pre', to: 'boom' }, { from: 'boom', to: 'end' },
    ],
  });
  const R = summary?.results ?? {};
  t('B1. pre 正常执行过一次', R.pre?.status === 'success', JSON.stringify(R.pre?.status));
  t('B2. 跳转不生效 → 按"停止这条支路"处理（end 跳过）', R.end?.status === 'skipped', JSON.stringify(R.end?.status));
  t('B3. ★错误消息写明"未重复执行"（不静默）',
    typeof R.boom?.error?.message === 'string' && R.boom.error.message.includes('未重复执行') && R.boom.error.message.includes('pre'),
    JSON.stringify(R.boom?.error?.message));
  t('B4. 仍然计入运行失败', summary?.status === 'failed' && summary?.failedCount === 1, JSON.stringify({ s: summary?.status, f: summary?.failedCount }));
}

// ───────── C. 目标与失败节点同层（已过层）→ 不重复执行 ─────────
console.log('\n== C. 目标在同一层（已过层）→ 不重复执行 ==');
{
  const { summary } = await run({
    name: 'goto-samelayer__', version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      lg('sib'),                                                   // 与 boom 同层（都只连 start）
      { id: 'boom', type: 'python', params: { code: failCode }, onError: { goto: 'sib' } },
      { id: 'end', type: 'end' },
    ],
    edges: [
      { from: 'start', to: 'sib' }, { from: 'start', to: 'boom' }, { from: 'boom', to: 'end' },
    ],
  });
  const R = summary?.results ?? {};
  t('C1. 同层兄弟节点正常执行（它有自己的活入边）', R.sib?.status === 'success', JSON.stringify(R.sib?.status));
  t('C2. 错误消息写明未重复执行', typeof R.boom?.error?.message === 'string' && R.boom.error.message.includes('未重复执行'), JSON.stringify(R.boom?.error?.message));
  t('C3. boom 的下游 end 跳过', R.end?.status === 'skipped', JSON.stringify(R.end?.status));
}

// ───────── D. 目标的下游继续跑（跳转不是终点）─────────
console.log('\n== D. goto 目标的下游照常继续 ==');
{
  const { summary } = await run({
    name: 'goto-chain__', version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'boom', type: 'python', params: { code: failCode }, onError: { goto: 'T' } },
      lg('T'), lg('t2'), { id: 'end', type: 'end' },
    ],
    edges: [
      { from: 'start', to: 'boom' },
      { from: 'boom', to: 'T' },
      { from: 'T', to: 't2' }, { from: 't2', to: 'end' },
    ],
  });
  const R = summary?.results ?? {};
  t('D1. 目标执行', R.T?.status === 'success', JSON.stringify(R.T?.status));
  t('D2. ★目标的下游继续执行', R.t2?.status === 'success', JSON.stringify(R.t2?.status));
  t('D3. 再下游 end 也执行', R.end?.status === 'success', JSON.stringify(R.end?.status));
}

// ───────── E. 与 tolerate 的优先级：tolerate=true 时不走 goto（忽略失败优先）─────────
console.log('\n== E. tolerate 优先于 goto（两个字段都写时以"忽略失败"为准）==');
{
  const { summary } = await run({
    name: 'goto-vs-tolerate__', version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'boom', type: 'python', params: { code: failCode }, onError: { goto: 'T' }, tolerate: true },
      lg('T'), lg('d_boom'), { id: 'end', type: 'end' },
    ],
    edges: [
      { from: 'start', to: 'boom' }, { from: 'boom', to: 'd_boom' }, { from: 'boom', to: 'T' },
      { from: 'd_boom', to: 'end' }, { from: 'T', to: 'end' },
    ],
  });
  const R = summary?.results ?? {};
  t('E1. tolerate=true → 走「忽略失败」：正常下游照常执行', R.d_boom?.status === 'success', JSON.stringify(R.d_boom?.status));
  t('E2. 不计入运行失败', summary?.status === 'success' && summary?.toleratedCount === 1, JSON.stringify({ s: summary?.status, tol: summary?.toleratedCount }));
  t('E3. 目标也执行（它有活的入边）', R.T?.status === 'success', JSON.stringify(R.T?.status));
}

server.close();
console.log(`\n=== goto-edge DAG 失败跳转：${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
