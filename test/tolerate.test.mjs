// test/tolerate.test.mjs — 节点级容错开关 tolerate（「失败不影响流程」）专项验证 —— 2026-10-03 用户拍板 A 方案
//
// 背景：DAG 模式（def 带 edges）下**节点级 onError 完全不生效**（执行器从不读它），
//   一次抓取/发信失败就把整条流水线拖垮——用户当天连撞两次：邮件节点失败、抓取节点 403。
//   用户拍板方案 A：节点级开关，勾选后「失败不影响流程」。
//
// 契约（本文件钉死，改引擎前先看这里）：
//   ① 默认（不勾）= 原语义：失败 → 后续层不执行 + summary.status='failed' + failedCount=1
//   ② 勾选 → 节点自身仍是 status='failed' + tolerated=true，但**不计入** failedCount/firstError；
//      后续层照常执行；summary.status='success' 且带 toleratedCount
//   ③ 混合（容错失败 + 真失败）→ status='failed'，firstError.nodeId 指向**真失败**那个节点
//   ④ legacy 路径（只写 next、没有 edges）同样生效
//   ⑤ 容错节点的 out 仍是 {error:{code,message}}（下游能读到错因，不是空）
//
// 手段同 loop.test.mjs：伪造 cordis ctx → apply(dist/index.js) → 本地服务 → POST /run 读 summary。
// 跑法：node test/tolerate.test.mjs
import * as http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pass = 0, fail = 0;
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

// 1) 临时工作区（storage 的 cwd 解析链落到这里，不污染真实工作区）
const fakeWorkspace = mkdtempSync(join(tmpdir(), 'dag-flow-tol-'));
process.chdir(fakeWorkspace);
const API_BASE = '/api/dag-flow';

// 2) 伪造 cordis ctx
const routes = [];
const stubCtx = {
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  webServer: { register(route) { routes.push(route); return () => {}; } },
};
await import('file:///D:/workspace/pluginspace/dag-flow/dist/index.js').then((m) => m.apply(stubCtx));
t('apply(ctx) 捕获到路由', routes.length >= 8, `routes=${routes.length}`);

// 3) 本地服务（exact / prefix 语义同 dsh-host-webserver）
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
  try { body = JSON.parse(text); } catch { /* 非 JSON（500 等）→ 保留原文便于定位 */ }
  if (r.status !== 200) console.log(`    ↳ 原始响应 ${r.status}：${text.slice(0, 300)}`);
  return { httpStatus: r.status, summary: body?.summary ?? null };
};

/** 必定失败的 python 节点（秒返、不依赖网络/LLM）：sys.exit(非 0) → 节点 failed */
const failCode = 'import sys\nsys.exit(3)';
const failNode = (id, tolerate, next = 'lg') => ({
  id, type: 'python', params: { code: failCode }, next,
  ...(tolerate ? { tolerate: true } : {}),
});

// ───────────────────────── ① 默认不勾：原语义不受影响（红线：必须保持原逻辑）─────────────────────────
console.log('\n== ① 默认（不勾 tolerate）→ 失败即中断，原语义不变 ==');
{
  const { httpStatus, summary } = await run({
    name: 'tol-default__', version: 1,
    nodes: [
      { id: 'start', type: 'start', params: {}, next: 'fail1' },
      failNode('fail1', false),
      { id: 'lg', type: 'log', params: { level: 'info', message: '跑到了下游' }, next: 'end' },
      { id: 'end', type: 'end', params: { outputs: {} } },
    ],
    edges: [
      { from: 'start', to: 'fail1' }, { from: 'fail1', to: 'lg' }, { from: 'lg', to: 'end' },
    ],
  });
  t('HTTP 200（不是 500）', httpStatus === 200, `status=${httpStatus}`);
  t('汇总 status=failed', summary?.status === 'failed', JSON.stringify(summary?.status));
  t('failedCount=1', summary?.failedCount === 1, JSON.stringify(summary?.failedCount));
  t('toleratedCount 缺省（不写 0）', summary?.toleratedCount === undefined, JSON.stringify(summary?.toleratedCount));
  t('失败节点没被标 tolerated', summary?.results?.fail1?.tolerated === undefined, JSON.stringify(summary?.results?.fail1?.tolerated));
  t('下游 lg 未执行（DAG 默认 stop 语义保持）', summary?.results?.lg === undefined, JSON.stringify(Object.keys(summary?.results ?? {})));
  t('firstError.nodeId=fail1', summary?.error?.nodeId === 'fail1', JSON.stringify(summary?.error));
}

// ───────────────────────── ② 勾选 tolerate → 失败但不中断 ─────────────────────────
console.log('\n== ② 勾选 tolerate → 记失败但不中断，后续层照常执行 ==');
{
  const { summary } = await run({
    name: 'tol-on__', version: 1,
    nodes: [
      { id: 'start', type: 'start', params: {}, next: 'fail1' },
      failNode('fail1', true),
      { id: 'lg', type: 'log', params: { level: 'info', message: '跑到了下游' }, next: 'end' },
      { id: 'end', type: 'end', params: { outputs: {} } },
    ],
    edges: [
      { from: 'start', to: 'fail1' }, { from: 'fail1', to: 'lg' }, { from: 'lg', to: 'end' },
    ],
  });
  t('汇总 status=success（容错失败不计入 failedCount）', summary?.status === 'success', JSON.stringify(summary?.status));
  t('failedCount=0', summary?.failedCount === 0, JSON.stringify(summary?.failedCount));
  t('toleratedCount=1', summary?.toleratedCount === 1, JSON.stringify(summary?.toleratedCount));
  t('无 firstError（不弹失败详情）', summary?.error === undefined, JSON.stringify(summary?.error));
  t('节点自身仍是 failed（不伪装成功）', summary?.results?.fail1?.status === 'failed', JSON.stringify(summary?.results?.fail1?.status));
  t('节点被标记 tolerated=true', summary?.results?.fail1?.tolerated === true, JSON.stringify(summary?.results?.fail1?.tolerated));
  t('下游 lg 已执行', summary?.results?.lg?.status === 'success', JSON.stringify(summary?.results?.lg?.status));
  t('末端 end 已执行', summary?.results?.end?.status === 'success', JSON.stringify(summary?.results?.end?.status));
  // ⑤ 容错节点的错因仍可读（★ makeResult 把失败详情放在 result.error，不是 out）
  const errOut = summary?.results?.fail1?.error;
  t('容错节点的 error.code 可读', typeof errOut?.code === 'string' && errOut.code.length > 0, JSON.stringify(errOut));
  t('容错节点的 error.message 可读', typeof errOut?.message === 'string' && errOut.message.length > 0, JSON.stringify(errOut));
  t('容错节点没有 out（与硬失败一致，不凭空造输出）', summary?.results?.fail1?.out === undefined, JSON.stringify(summary?.results?.fail1?.out));
}

// ───────────────────────── ③ 混合：容错失败 + 真失败 ─────────────────────────
console.log('\n== ③ 混合场景：容错失败不该掩盖真失败 ==');
{
  const { summary } = await run({
    name: 'tol-mixed__', version: 1,
    nodes: [
      { id: 'start', type: 'start', params: {}, next: 'fail1' },
      failNode('fail1', true, 'fail2'),
      { id: 'fail2', type: 'python', params: { code: failCode }, next: 'end' },
      { id: 'end', type: 'end', params: { outputs: {} } },
    ],
    edges: [
      { from: 'start', to: 'fail1' }, { from: 'fail1', to: 'fail2' }, { from: 'fail2', to: 'end' },
    ],
  });
  t('汇总 status=failed（真失败仍然报错）', summary?.status === 'failed', JSON.stringify(summary?.status));
  t('failedCount=1（只数真失败）', summary?.failedCount === 1, JSON.stringify(summary?.failedCount));
  t('toleratedCount=1', summary?.toleratedCount === 1, JSON.stringify(summary?.toleratedCount));
  t('firstError 指向真失败节点 fail2（不是容错那个）', summary?.error?.nodeId === 'fail2', JSON.stringify(summary?.error));
  t('真失败后面的 end 未执行', summary?.results?.end === undefined, JSON.stringify(Object.keys(summary?.results ?? {})));
}

// ───────────────────────── ④ legacy 路径（只写 next，没有 edges）同样生效 ─────────────────────────
console.log('\n== ④ legacy 路径（无 edges、只有 next）==');
{
  const off = await run({
    name: 'tol-legacy-off__', version: 1,
    nodes: [
      { id: 'start', type: 'start', params: {}, next: 'fail1' },
      failNode('fail1', false),
      { id: 'lg', type: 'log', params: { level: 'info', message: '跑到了下游' }, next: 'end' },
      { id: 'end', type: 'end', params: { outputs: {} } },
    ],
  });
  t('legacy 不勾 → 下游不执行（原 onError=stop 语义不变）', off.summary?.results?.lg === undefined, JSON.stringify(Object.keys(off.summary?.results ?? {})));
  t('legacy 不勾 → status=failed', off.summary?.status === 'failed', JSON.stringify(off.summary?.status));

  const on = await run({
    name: 'tol-legacy-on__', version: 1,
    nodes: [
      { id: 'start', type: 'start', params: {}, next: 'fail1' },
      failNode('fail1', true),
      { id: 'lg', type: 'log', params: { level: 'info', message: '跑到了下游' }, next: 'end' },
      { id: 'end', type: 'end', params: { outputs: {} } },
    ],
  });
  t('legacy 勾选 → 下游照常执行', on.summary?.results?.lg?.status === 'success', JSON.stringify(Object.keys(on.summary?.results ?? {})));
  t('legacy 勾选 → toleratedCount=1', on.summary?.toleratedCount === 1, JSON.stringify(on.summary?.toleratedCount));
  t('legacy 勾选 → status=success', on.summary?.status === 'success', JSON.stringify(on.summary?.status));
}

// ───────────────────────── ⑤ schema：tolerate 是合法节点字段（UI 保存/执行不再被「多余字段」拒）─────────────────────────
console.log('\n== ⑤ tolerate 通过执行前结构校验（host WORKFLOW_SCHEMA）==');
{
  const { httpStatus, summary } = await run({
    name: 'tol-schema__', version: 1,
    nodes: [
      { id: 'start', type: 'start', params: {}, next: 'lg', tolerate: false },
      { id: 'lg', type: 'log', params: { level: 'info', message: 'x' }, next: 'end', tolerate: true },
      { id: 'end', type: 'end', params: { outputs: {} } },
    ],
    edges: [{ from: 'start', to: 'lg' }, { from: 'lg', to: 'end' }],
  });
  t('带 tolerate（含 false）的结构校验通过 → 能执行', httpStatus === 200 && summary?.results?.start !== undefined,
    `http=${httpStatus} err=${JSON.stringify(summary?.error ?? null)}`);
}

console.log(`\n=== tolerate 容错开关：${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
