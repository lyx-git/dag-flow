// test/manual-await.test.mjs — 人工确认节点（manual）真暂停 + 恢复
//
// 背景（2026-10-03 用户反馈「画布中的人工确认节点好像都没作用，不需要人工确认就直接执行完成」）：
//   旧实现是 v0.1 空壳——run() 立即返回 success，不暂停不等待，任何工作流都一路跑完。
// 用户拍板方案 A：真暂停 + 恢复。本文件锁定四条契约：
//   ① 交互式运行（POST /run）撞上 manual → 202 { status:'awaiting', runId, awaiting }
//   ② GET  /run/status?runId= 能查回等待态（刷新页面/重挂面板的恢复依据）
//   ③ POST /run/resume { runId, value } → 备注进入 out.value，下游 {{manual.out.value}} 取到
//   ④ 非交互路径（run-node 单节点试跑 / subflow 子工作流内部）→ 自动通过 out.autoPassed=true，不挂起
// 另锁定：取消（DELETE /run?name=）能让挂起的运行收敛为失败；未知 runId → 404（dsh 重启的中断态）
import * as http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.chdir(mkdtempSync(join(tmpdir(), 'dag-manual-')));
const routes = [];
const logs = [];
const stubCtx = {
  logger: { info() {}, warn(...a) { logs.push(a); }, error() {} },
  webServer: { register(r) { routes.push(r); return () => {}; } },
};
const mod = await import('file:///D:/workspace/pluginspace/dag-flow/dist/index.js');
mod.apply(stubCtx);

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://x').pathname;
  const exact = routes.find((r) => r.kind === 'exact' && r.path === pathname);
  const prefix = routes.find((r) => r.kind === 'prefix' && (pathname === r.path || pathname.startsWith(r.path + '/')));
  const h = exact?.handler ?? prefix?.handler;
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
const post = async (p, body) => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const del = async (p) => {
  const r = await fetch(base + p, { method: 'DELETE' });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const get = async (p) => {
  const r = await fetch(base + p);
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
/** 轮询 /run/status 直到 completed（或超时） */
const waitDone = async (runId, ms = 5000) => {
  const t0 = Date.now();
  for (;;) {
    const r = await get(`/run/status?runId=${encodeURIComponent(runId)}`);
    if (r.status === 200 && r.body?.status === 'completed') return r.body;
    if (Date.now() - t0 > ms) return r.body;
    await new Promise((ok) => setTimeout(ok, 60));
  }
};

const dagDef = (name) => ({
  name, version: 1,
  nodes: [
    { id: 'start', type: 'start' },
    { id: 'note', type: 'log', params: { level: 'info', message: 'before-manual' } },
    { id: 'manual1', type: 'manual', label: '发布前确认', params: { prompt: '请核对【技术简报】正文与配图' } },
    { id: 'after', type: 'log', params: { level: 'info', message: '{{manual1.out.value}}' } },
    { id: 'end', type: 'end' },
  ],
  edges: [
    { from: 'start', to: 'note' }, { from: 'note', to: 'manual1' },
    { from: 'manual1', to: 'after' }, { from: 'after', to: 'end' },
  ],
});
const serialDef = (name) => ({
  name, version: 1,
  nodes: [
    { id: 'start', type: 'start', next: 'manual1' },
    // ★ 2026-10-04：补上 manual1 → after 的连线。原夹具漏了这一跳（manual1 没有 next，
    //   于是 after/end 成了孤点），旧执行器不跑孤点所以"看着没事"；
    //   归一化后所有定义都走 DAG（孤点会在第 0 层被当成入口执行），漏连线会直接触发
    //   数据依赖预检 DATAFLOW_ORDER。夹具改正后，同一份定义在两种模式下都必须能挂起。
    { id: 'manual1', type: 'manual', label: '发布前确认', params: { prompt: '串行模式的确认' }, next: 'after' },
    { id: 'after', type: 'log', params: { level: 'info', message: '{{manual1.out.value}}' }, next: 'end' },
    { id: 'end', type: 'end' },
  ],
});

// ===== A. DAG 模式：挂起 → 查状态 → 恢复 =====
let runId = '';
{
  const r = await post('/run', { def: dagDef('m-dag') });
  t('A1. /run 撞上 manual → 202 awaiting', r.status === 202 && r.body?.status === 'awaiting', `status=${r.status} body=${JSON.stringify(r.body)?.slice(0, 200)}`);
  t('A2. 返回 runId + awaiting.nodeId/prompt', typeof r.body?.runId === 'string' && r.body?.awaiting?.nodeId === 'manual1' && /核对/.test(r.body?.awaiting?.prompt ?? ''), JSON.stringify(r.body)?.slice(0, 240));
  runId = String(r.body?.runId ?? '');
}
{
  const r = await get(`/run/status?runId=${encodeURIComponent(runId)}`);
  t('A3. /run/status 查回等待态', r.status === 200 && r.body?.status === 'awaiting' && r.body?.awaiting?.nodeId === 'manual1', JSON.stringify(r.body)?.slice(0, 240));
  t('A4. status 带已完成节点结果（供画布徽标）', r.body?.results?.start?.status === 'success' && r.body?.results?.note?.status === 'success', JSON.stringify(r.body?.results));
}
{
  const r = await post('/run/resume', { runId, value: '已核对，图 2 需替换' });
  const res = r.body?.summary?.results ?? {};
  t('B1. /run/resume → 200 且运行成功', r.status === 200 && r.body?.ok === true && r.body?.summary?.status === 'success', JSON.stringify(r.body)?.slice(0, 240));
  t('B2. manual 节点 out 带用户备注', res.manual1?.out?.value === '已核对，图 2 需替换' && res.manual1?.out?.confirmed === true, JSON.stringify(res.manual1?.out));
  t('B3. 备注已透传到下游 {{manual1.out.value}}', res.after?.out === '已核对，图 2 需替换', JSON.stringify(res.after?.out));
  t('B4. end 之后无 await 残留（status 变 completed）', (await get(`/run/status?runId=${encodeURIComponent(runId)}`)).body?.status === 'completed');
}
{
  const r = await post('/run/resume', { runId, value: '再来一次' });
  t('B5. 重复 resume → 409（运行已结束）', r.status === 409, `status=${r.status} ${JSON.stringify(r.body)?.slice(0, 160)}`);
}
{
  const r = await get('/run/status?runId=run-不存在-xyz');
  t('C1. 未知 runId → 404（dsh 重启后的中断态依据）', r.status === 404, `status=${r.status}`);
  const r2 = await post('/run/resume', { runId: 'run-不存在-xyz', value: '' });
  t('C2. 未知 runId resume → 404', r2.status === 404, `status=${r2.status}`);
}

// ===== D. next-only（串行写法）模式：挂起 → 取消 =====
//   2026-10-04 轮 4：legacy 递归执行器已删除，**所有定义都走 DAG**（没有 edges 的先归一化），
//   所以这里不再需要"两种模式对照"，只跑一遍即可（原先的 DAG_FLOW_LEGACY_EXEC 对照已撤除）。
{
  const wfName = 'm-serial';
  const r = await post('/run', { def: serialDef(wfName) });
  t('D1. next-only 定义同样会挂起（202）', r.status === 202 && r.body?.status === 'awaiting', `status=${r.status} ${JSON.stringify(r.body)?.slice(0, 200)}`);
  const id = String(r.body?.runId ?? '');
  const c = await del(`/run?name=${encodeURIComponent(wfName)}`);
  t('D2. DELETE 取消等待中的运行 → 200', c.status === 200 && c.body?.ok === true, JSON.stringify(c.body));
  const done = await waitDone(id);
  const m1 = done?.summary?.results?.manual1;
  t('D3. 取消后 manual 节点转失败 MANUAL_CANCELLED', m1?.status === 'failed' && m1?.error?.code === 'MANUAL_CANCELLED', JSON.stringify(m1)?.slice(0, 200));
  t('D4. 运行整体收敛为 failed', done?.summary?.status === 'failed', JSON.stringify(done?.summary?.status));
}

// ===== E. 非交互路径：不挂起、自动通过 =====
{
  const r = await post('/run-node', { nodeType: 'manual', params: { prompt: '单节点试跑不应卡住' } });
  const out = r.body?.summary?.results?.target?.out;
  t('E1. run-node 试跑 manual → 直接 200（不挂起）', r.status === 200 && r.body?.summary?.status === 'success', `status=${r.status} ${JSON.stringify(r.body?.summary?.status)}`);
  t('E2. 自动通过标记 autoPassed=true + confirmed=true', out?.autoPassed === true && out?.confirmed === true, JSON.stringify(out));
  t('E3. 自动通过留了 warning 日志', logs.length > 0, `logs=${JSON.stringify(logs).slice(0, 160)}`);
}
{
  // subflow 内部：子工作流含 manual，不应把父流程挂起
  await post('/workflows/save', { name: 'm-child', def: {
    name: 'm-child', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'manual1' },
      // ★ 2026-10-04：补 manual1 → end 的连线（同上：漏连线会让 end 变成 DAG 里的第 0 层孤点）
      { id: 'manual1', type: 'manual', label: '子流程确认', params: { prompt: '子流程内的确认' }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  } });
  const parent = { name: 'm-parent', version: 1, nodes: [
    { id: 'start', type: 'start', next: 'sf' },
    { id: 'sf', type: 'subflow', params: { workflowName: 'm-child' }, next: 'end' },
    { id: 'end', type: 'end' },
  ] };
  const r = await post('/run', { def: parent });
  t('E4. subflow 内含 manual → 父流程直接 200（不挂起）', r.status === 200 && r.body?.summary?.status === 'success', `status=${r.status} ${JSON.stringify(r.body)?.slice(0, 200)}`);
}

// ===== F. 回归：没有 manual 的工作流仍是一次性 200 =====
{
  const r = await post('/run', { def: { name: 'm-plain', version: 1, nodes: [
    { id: 'start', type: 'start', next: 'log1' },
    { id: 'log1', type: 'log', params: { level: 'info', message: 'plain' }, next: 'end' },
    { id: 'end', type: 'end' },
  ] } });
  t('F1. 无 manual 的工作流 → 200 一次返回（未被改坏）', r.status === 200 && r.body?.ok === true, `status=${r.status}`);
}

server.close();
console.log(`\n=== manual-await: ${pass} passed, ${fail} failed ===`);
if (fail > 0) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
