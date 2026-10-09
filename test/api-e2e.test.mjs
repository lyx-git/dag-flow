// test/api-e2e.test.mjs — HTTP API 端到端测试（不安装到 DSH）
// 手段：伪造 cordis ctx（webServer.register 捕获路由）→ 调 dist/index.js 的 apply(ctx)
//       → 用 node:http 把捕获的路由挂成本地服务 → 用 fetch 真实请求逐条断言。
// 覆盖：节点列表 / 保存 / 列表 / 读取 / 404 / ai-models CRUD / sessions / run 真实执行。
// 跑法：node test/api-e2e.test.mjs
import * as http from 'node:http';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

// 1) 临时工作区（storage 的 process.cwd() 解析链会落到这里）
const fakeWorkspace = mkdtempSync(join(tmpdir(), 'dag-flow-e2e-'));
process.chdir(fakeWorkspace);
const API_BASE = '/api/dag-flow';

// 2) 伪造 cordis ctx：捕获 webServer 路由
const routes = [];
const stubCtx = {
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  webServer: {
    register(route) { routes.push(route); return () => {}; },
  },
};

// 3) 加载宿主 bundle（绝对路径，不依赖任何真实 DSH 服务）并 apply
const mod = await import('file:///D:/workspace/pluginspace/dag-flow/dist/index.js');
mod.apply(stubCtx);
t('apply(ctx) 完成且捕获到路由', routes.length >= 8, `routes=${routes.length}`);

// 4) 本地 http 服务挂载捕获的路由（exact / prefix 语义与 dsh-host-webserver 一致）
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
const get = async (p) => { const r = await fetch(url(p)); return { status: r.status, body: await r.json().catch(() => null) }; };
const post = async (p, body) => { const r = await fetch(url(p), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
const del = async (p, body) => { const r = await fetch(url(p), { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };

// ===== 1. 节点列表 =====
{
  const r = await get('/nodes');
  t('GET /nodes → 200', r.status === 200);
  const types = r.body?.nodes ?? [];
  t('节点列表含 13 内置类型', ['start', 'end', 'python', 'bash', 'http', 'subagent', 'if', 'switch', 'loop', 'set_var', 'log', 'manual', 'session_input'].every((x) => types.includes(x)), JSON.stringify(types));
}

// ===== 2. 保存 / 列表 / 读取 / 404（工作区 JSON 落盘）=====
{
  const def = {
    name: 'e2e-demo', version: 1,
    nodes: [{ id: 'start', type: 'start', next: 'end' }, { id: 'end', type: 'end' }],
  };
  const saved = await post('/workflows/save', { name: 'E2E Demo!', def });
  t('POST /workflows/save → 200 且名称规范化', saved.status === 200 && saved.body?.name === 'e2e-demo', JSON.stringify(saved.body));

  const disk = join(fakeWorkspace, '.dag-flow', 'workflow', 'e2e-demo.json');
  t('工作流已落盘为工作区 JSON（.dag-flow/workflow/）', existsSync(disk));
  if (existsSync(disk)) {
    const raw = JSON.parse(readFileSync(disk, 'utf8'));
    t('落盘内容是 pretty JSON 且 name 规范化', raw?.name === 'e2e-demo' && Array.isArray(raw.nodes));
  }

  const list = await get('/workflows');
  t('GET /workflows → 200 且含 e2e-demo', list.status === 200 && (list.body?.workflows ?? []).some((w) => w.name === 'e2e-demo'));
  t('列表携带存储位置说明（.dag-flow/workflow）', typeof list.body?.storage?.dir === 'string' && list.body.storage.dir.includes(join('.dag-flow', 'workflow')), JSON.stringify(list.body?.storage));
  // 2026-10-03 用户需求：下拉里名称后要置灰显示每个工作流所在路径 → 列表每项都带自己的 path
  t('列表每项带落盘路径 path（指向该工作流自己的 .json）', (list.body?.workflows ?? []).length > 0
    && (list.body.workflows).every((w) => typeof w.path === 'string' && w.path.endsWith(`${w.name}.json`) && w.path.includes(join('.dag-flow', 'workflow'))),
    JSON.stringify((list.body?.workflows ?? []).slice(0, 2)));

  const one = await get(`/workflows/e2e-demo`);
  t('GET /workflows/<name> 读回定义', one.status === 200 && one.body?.workflow?.name === 'e2e-demo');

  // 中文名（2026-10-01 起支持：normalizeWorkflowName 保留中文，src/name-rule.ts）
  const cnDef = { name: '每日简报', version: 1, nodes: [{ id: 'start', type: 'start', next: 'end' }, { id: 'end', type: 'end' }] };
  const cnSaved = await post('/workflows/save', { name: '每日简报', def: cnDef });
  t('POST /workflows/save 中文名 → 200 且原名保留', cnSaved.status === 200 && cnSaved.body?.name === '每日简报', JSON.stringify(cnSaved.body));
  const cnGet = await get(`/workflows/${encodeURIComponent('每日简报')}`);
  t('GET /workflows/每日简报 → 200 读回中文名工作流', cnGet.status === 200 && cnGet.body?.workflow?.name === '每日简报');
  const cnList = await get('/workflows');
  t('GET /workflows 列表含中文名', cnList.status === 200 && (cnList.body?.workflows ?? []).some((w) => w.name === '每日简报'));

  const missing = await get('/workflows/definitely-not-exist');
  t('读取不存在的工作流 → 404', missing.status === 404);
}

// ===== 5.5 run-node 单节点试跑（#1）+ 版本管理（#14-②）=====

// ===== 4. models（DSH settings.yaml 模型发现，只读真实配置）=====
{
  const r = await get('/models');
  t('GET /models → 200 且 models 为数组', r.status === 200 && Array.isArray(r.body?.models), JSON.stringify(r.body)?.slice(0, 120));
}

// ===== 5. sessions（读真实 ~/.dsh/sessions，只读）=====
{
  const r = await get('/sessions');
  t('GET /sessions → 200 且 sessions 为数组', r.status === 200 && Array.isArray(r.body?.sessions));
  const content = await get('/sessions/definitely-not-a-session/content?limit=3');
  t('读取不存在会话 → 404', content.status === 404);
}

// ===== 5. run：start→end 纯控制流真实执行 =====
{
  const r = await post('/run', {
    def: { name: 'e2e-run', version: 1, nodes: [{ id: 'start', type: 'start', next: 'end' }, { id: 'end', type: 'end' }] },
  });
  t('POST /run → 200', r.status === 200);
  t('start→end 工作流执行成功', r.body?.ok === true && r.body?.summary?.status === 'success', JSON.stringify(r.body?.summary)?.slice(0, 200));
  t('运行摘要含节点级结果', Array.isArray(r.body?.summary?.results) || typeof r.body?.summary?.totalDurationMs === 'number');
}

// ===== 6. run：python 节点在 runtime 缺失时优雅失败（不炸服务）=====
{
  const r = await post('/run', {
    def: {
      name: 'e2e-py', version: 1,
      nodes: [
        { id: 'start', type: 'start', next: 'p' },
        { id: 'p', type: 'python', params: { code: 'print(1)', timeoutMs: 3000 }, next: 'end' },
        { id: 'end', type: 'end' },
      ],
    },
  });
  const status = r.body?.summary?.status;
  t('POST /run(python) → 200 且摘要状态合法', r.status === 200 && ['success', 'failed'].includes(status), JSON.stringify(r.body?.summary)?.slice(0, 200));
}

// ===== 5.5 run-node 单节点试跑（#1）+ 版本管理（#14-②）=====
{
  // 单节点试跑：python 节点用 inputs 注入
  const r = await post('/run-node', {
    nodeType: 'python',
    params: { code: 'print("ok-e2e")', timeoutMs: 5000 },
    inputs: { msg: 'hello-e2e' },
  });
  t('POST /run-node(python) → 200', r.status === 200, JSON.stringify(r.body)?.slice(0, 200));
  const target = r.body?.summary?.results?.target;
  t('试跑摘要包含 target 节点结果', Boolean(target), JSON.stringify(r.body?.summary)?.slice(0, 200));

  // 未知类型拒绝
  const bad = await post('/run-node', { nodeType: 'not-a-type' });
  t('POST /run-node 未知类型 → 400', bad.status === 400);

  // 版本管理：修改再保存 → versions 至少 1 → 读回某版本
  const defV1 = { name: 'e2e-ver', version: 1, nodes: [{ id: 'start', type: 'start', next: 'end' }, { id: 'end', type: 'end' }] };
  await post('/workflows/save', { name: 'e2e-ver', def: defV1 });
  const defV2 = { ...defV1, nodes: [...defV1.nodes, { id: 'log', type: 'log', params: { message: 'v2' } }] };
  await post('/workflows/save', { name: 'e2e-ver', def: defV2 });
  const vl = await get('/workflows/e2e-ver/versions');
  t('GET /workflows/<name>/versions → 200 且 ≥1 版本', vl.status === 200 && (vl.body?.versions?.length ?? 0) >= 1, JSON.stringify(vl.body)?.slice(0, 160));
  const ts = vl.body?.versions?.[0]?.ts;
  const one = await get(`/workflows/e2e-ver/versions/${ts}`);
  t('GET /workflows/<name>/versions/<ts> 读回快照', one.status === 200 && Array.isArray(one.body?.workflow?.nodes));
  const cur = await get('/workflows/e2e-ver');
  t('当前文件是最新内容（含 log 节点）', (cur.body?.workflow?.nodes ?? []).some((n) => n.id === 'log'));
}

// ===== 6. switch 泛化分支 + merge 合流 + subflow 子工作流 =====
{
  // switch：value 表达式求值为 'b' → 激活 when:'b'，'a' 分支 skip；双分支汇入 merge
  const def = {
    name: 'e2e-switch', version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'sw', type: 'switch', params: { value: '"b"', cases: { a: 'la', b: 'lb' } } },
      { id: 'la', type: 'log', params: { level: 'info', message: 'branch-a' } },
      { id: 'lb', type: 'log', params: { level: 'info', message: 'branch-b' } },
      { id: 'mg', type: 'merge', params: {} },
      { id: 'end', type: 'end' },
    ],
    edges: [
      { from: 'start', to: 'sw' },
      { from: 'sw', to: 'la', when: 'a' },
      { from: 'sw', to: 'lb', when: 'b' },
      { from: 'la', to: 'mg' },
      { from: 'lb', to: 'mg' },
      { from: 'mg', to: 'end' },
    ],
  };
  const r = await post('/run', { def });
  t('switch+merge 流程 → 200', r.status === 200, JSON.stringify(r.body)?.slice(0, 200));
  const res = r.body?.summary?.results ?? {};
  t('switch 激活 b 分支（lb success）', res.lb?.status === 'success', JSON.stringify(res.lb)?.slice(0, 120));
  t('a 分支被跳过（skipped）', res.la?.status === 'skipped', JSON.stringify(res.la)?.slice(0, 120));
  t('merge 合流输出含上游键', res.mg?.status === 'success' && res.mg?.out && 'la' in res.mg.out && 'lb' in res.mg.out, JSON.stringify(res.mg)?.slice(0, 200));

  // subflow：先保存子工作流，再在主流程里调用
  const sub = { name: 'e2e-sub', version: 1, nodes: [
    { id: 'start', type: 'start', next: 'log' },
    { id: 'log', type: 'log', params: { level: 'info', message: 'from-sub' }, next: 'end' },
    { id: 'end', type: 'end' },
  ] };
  await post('/workflows/save', { name: 'e2e-sub', def: sub });
  const main = { name: 'e2e-main', version: 1, nodes: [
    { id: 'start', type: 'start', next: 'sf' },
    { id: 'sf', type: 'subflow', params: { workflowName: 'e2e-sub' }, next: 'end' },
    { id: 'end', type: 'end' },
  ] };
  const r2 = await post('/run', { def: main });
  const sf = r2.body?.summary?.results?.sf;
  t('subflow 调用子工作流成功且带 output', r2.status === 200 && sf?.status === 'success' && sf?.out?.output != null, JSON.stringify(sf)?.slice(0, 200));
}

// ===== 7. 删除 + 运行历史列表 =====
{
  const del = { name: 'e2e-del', version: 1, nodes: [{ id: 'start', type: 'start', next: 'end' }, { id: 'end', type: 'end' }] };
  await post('/workflows/save', { name: 'e2e-del', def: del });
  const gone = await fetch(url('/workflows/e2e-del'), { method: 'DELETE' });
  t('DELETE /workflows/<name> → 200', gone.status === 200);
  const after = await get('/workflows/e2e-del');
  t('删除后读取 → 404', after.status === 404);

  const runs = await get('/runs?workflowName=e2e-switch');
  t('GET /runs?workflowName → 200 且含记录', runs.status === 200 && Array.isArray(runs.body?.runs) && runs.body.runs.length >= 1);
}

// ===== 8. DAG 失败边（goto）/ 归一化走 DAG / loop.over / def.inputs 注入 / 取消路由 =====
{
  // ★ 2026-10-04 轮 4：legacy 执行器已删除，节点级 onError 全部由 DAG 承担（回退开关一并撤除）。
  //   onError:{goto:'fallback'} = **失败边**：跳过本节点的下游、跳到 fallback 继续（目标只执行一次）。
  //   这里刻意用**显式 edges**：fallback 只有一条来自 boom 的入边，而该边会因 boom 失败而作废，
  //   所以 fallback 能跑起来只可能是"失败边"的功劳（不是孤点被顺带执行）。
  const r1 = await post('/run', { def: {
    name: 'e2e-err-goto', version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'boom', type: 'python', params: { code: 'import sys\nsys.exit(1)', timeoutMs: 5000 }, onError: { goto: 'fallback' } },
      { id: 'fallback', type: 'log', params: { level: 'warn', message: 'fallback-path' } },
      { id: 'end', type: 'end' },
    ],
    edges: [
      { from: 'start', to: 'boom' },
      { from: 'boom', to: 'fallback' },   // 失败节点的出边 → 靠失败边保活
      { from: 'fallback', to: 'end' },
    ],
  }});
  const res1 = r1.body?.summary?.results ?? {};
  t('DAG 失败边：失败节点 failed', r1.status === 200 && res1.boom?.status === 'failed', JSON.stringify(res1)?.slice(0, 160));
  t('DAG 失败边：goto 目标执行成功', res1.fallback?.status === 'success', JSON.stringify(res1.fallback)?.slice(0, 120));
  t('DAG 失败边：目标的下游继续跑', res1.end?.status === 'success', JSON.stringify(res1.end)?.slice(0, 120));

  // ★ 轮 4：legacy 的 PARALLEL_FAILED 已退役 —— 并行扇出里某个分支失败时，
  //   firstError 指向**那个具体节点**，而不是笼统的"一个或多个并行分支失败"；其它分支照常跑完。
  const rFanFail = await post('/run', { def: {
    name: 'e2e-fanout-fail', version: 1,
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'boom', type: 'python', params: { code: 'import sys\nsys.exit(3)' } },
      { id: 'ok', type: 'log', params: { level: 'info', message: 'ok' } },
      { id: 'end', type: 'end' },
    ],
    edges: [
      { from: 'start', to: 'boom' }, { from: 'start', to: 'ok' },
      { from: 'boom', to: 'end' }, { from: 'ok', to: 'end' },
    ],
  }});
  const rf = rFanFail.body?.summary ?? {};
  t('并行分支失败：firstError 指向具体节点（不再是 PARALLEL_FAILED）', rf?.error?.nodeId === 'boom' && rf?.error?.code !== 'PARALLEL_FAILED', JSON.stringify(rf?.error));
  t('并行分支失败：另一分支照常跑完', rf?.results?.ok?.status === 'success', JSON.stringify(rf?.results?.ok?.status));
  t('并行分支失败：失败节点的下游 end 仍执行（它有 ok 这条活入边）', rf?.results?.end?.status === 'success', JSON.stringify(rf?.results?.end?.status));

  // ★ 归一化：同一份 **next-only**（不带 edges）的定义，不带 flag 时也走 DAG。
  //   用「并行扇出 + merge」当判别式：legacy 的数组 next 只 Promise.all 跑两个分支、
  //   **不跟随分支自己的 next**（merge 永远不执行）；归一化后分支的 out 边生效，merge 真的跑起来。
  const rFan = await post('/run', { def: {
    name: 'e2e-normalize-fanout', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: ['a', 'b'] },
      { id: 'a', type: 'log', params: { level: 'info', message: 'A' }, next: 'm' },
      { id: 'b', type: 'log', params: { level: 'info', message: 'B' }, next: 'm' },
      { id: 'm', type: 'merge', next: 'end' },
      { id: 'end', type: 'end' },
    ],
  }});
  const resFan = rFan.body?.summary?.results ?? {};
  t('归一化：next-only 定义也走 DAG（分支自身的 next 被跟随 → merge 执行）', resFan.m?.status === 'success', JSON.stringify(resFan)?.slice(0, 200));
  t('归一化：merge 收到两条上游的输出', !!(resFan.m?.out && typeof resFan.m.out === 'object' && 'a' in resFan.m.out && 'b' in resFan.m.out), JSON.stringify(resFan.m?.out)?.slice(0, 160));
  t('归一化：扇出两条分支都执行成功', resFan.a?.status === 'success' && resFan.b?.status === 'success', JSON.stringify({ a: resFan.a?.status, b: resFan.b?.status }));
  t('归一化：汇总状态为成功', rFan.body?.summary?.status === 'success', JSON.stringify(rFan.body?.summary)?.slice(0, 160));

  // 归一化：next 的 {true,false} 分支映射（if）——命中分支执行、另一支被跳过
  const rIf = await post('/run', { def: {
    name: 'e2e-normalize-if', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'cond' },
      { id: 'cond', type: 'if', params: { condition: '1 == 1' }, next: { true: 'log_t', false: 'log_f' } },
      { id: 'log_t', type: 'log', params: { level: 'info', message: 'true 分支' }, next: 'end' },
      { id: 'log_f', type: 'log', params: { level: 'info', message: 'false 分支' }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  }});
  const resIf = rIf.body?.summary?.results ?? {};
  t('归一化：if 的 {true,false} → when 边，命中分支执行', resIf.log_t?.status === 'success', JSON.stringify({ log_t: resIf.log_t?.status })?.slice(0, 120));
  t('归一化：未命中分支被标 skipped（不再"凭空消失"）', resIf.log_f?.status === 'skipped', JSON.stringify({ log_f: resIf.log_f?.status }));

  // 归一化：next 的 switch case 映射——命中 case 的分支执行、其余跳过
  const rSw = await post('/run', { def: {
    name: 'e2e-normalize-switch', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'sw' },
      { id: 'sw', type: 'switch', params: { value: 'quick', cases: { quick: 'log_q', full: 'log_f' } }, next: { quick: 'log_q', full: 'log_f' } },
      { id: 'log_q', type: 'log', params: { level: 'info', message: 'quick 分支' }, next: 'end' },
      { id: 'log_f', type: 'log', params: { level: 'info', message: 'full 分支' }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  }});
  const resSw = rSw.body?.summary?.results ?? {};
  t('归一化：switch 的 case 映射 → when 边，命中 case 执行', resSw.log_q?.status === 'success', JSON.stringify({ log_q: resSw.log_q?.status }));
  t('归一化：未命中的 case 被标 skipped', resSw.log_f?.status === 'skipped', JSON.stringify({ log_f: resSw.log_f?.status }));

  // loop.over：数组迭代
  const r2 = await post('/run', { def: {
    name: 'e2e-loop-over', version: 1,
    nodes: [
      { id: 'start', type: 'start', params: { items: ['x', 'y', 'z'] }, next: 'lp' },
      { id: 'lp', type: 'loop', params: { over: '{{start.out.items}}' }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  }});
  const lp = r2.body?.summary?.results?.lp;
  t('loop.over 迭代 3 项', r2.status === 200 && lp?.out?.count === 3 && Array.isArray(lp?.out?.items), JSON.stringify(lp)?.slice(0, 160));

  // def.inputs 注入：log message 经 {{inputs.greeting}} 解析
  const r3 = await post('/run', { def: {
    name: 'e2e-inputs', version: 1,
    inputs: { greeting: 'hello-inputs' },
    nodes: [
      { id: 'start', type: 'start', next: 'log' },
      { id: 'log', type: 'log', params: { level: 'info', message: '{{inputs.greeting}}' }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  }});
  const logOut = r3.body?.summary?.results?.log?.out;
  t('def.inputs 注入（{{inputs.greeting}} 解析）', r3.status === 200 && logOut === 'hello-inputs', JSON.stringify(logOut));

  // 取消路由：无活跃运行 → 404
  const cancel = await fetch(url('/run?name=nothing-running'), { method: 'DELETE' });
  t('取消不存在的运行 → 404', cancel.status === 404);
}

// ===== 9. 多模态节点：image_generate / video_generate / file_save（mock API 落盘到工作区）=====
{
  // mock 媒体 API：图片生成 + 视频提交/轮询/下载
  let pollCount = 0;
  const mediaSrv = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    if (u.pathname === '/images/generations' && req.method === 'POST') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [{ url: `http://127.0.0.1:${mediaPort}/files/test-image.png` }] }));
      return;
    }
    if (u.pathname === '/video/submit' && req.method === 'POST') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ output: { task_id: 'vt-001' } }));
      return;
    }
    if (u.pathname === '/video/task') {
      pollCount++;
      res.setHeader('content-type', 'application/json');
      if (pollCount < 3) res.end(JSON.stringify({ output: { task_id: 'vt-001', task_status: 'running' } }));
      else res.end(JSON.stringify({ output: { task_id: 'vt-001', task_status: 'succeeded', video_url: `http://127.0.0.1:${mediaPort}/files/test-video.mp4` } }));
      return;
    }
    if (u.pathname === '/files/test-image.png') {
      res.setHeader('content-type', 'image/png');
      res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]));
      return;
    }
    if (u.pathname === '/files/test-video.mp4') {
      res.setHeader('content-type', 'video/mp4');
      res.end(Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50]));
      return;
    }
    res.statusCode = 404; res.end('mock 404');
  });
  await new Promise((ok) => mediaSrv.listen(0, '127.0.0.1', ok));
  const mediaPort = mediaSrv.address().port;

  // image_generate：真实调 mock API 并落盘
  const ig = await post('/run-node', {
    nodeType: 'image_generate',
    params: { prompt: 'a city at night', baseURL: `http://127.0.0.1:${mediaPort}`, model: 'test-img', size: '512*512', filenamePrefix: 'e2e-img', apiKey: 'sk-e2e' },
  });
  const igOut = ig.body?.summary?.results?.target?.out;
  t('image_generate → 200 且输出图片路径', ig.status === 200 && Array.isArray(igOut?.images) && igOut.images.length === 1, JSON.stringify(igOut)?.slice(0, 200));
  t('图片已落盘到 .dag-flow/ 根下', String(igOut?.images?.[0]?.path ?? '').startsWith('.dag-flow/') === true, igOut?.images?.[0]?.path);
  t('图片文件真实存在', existsSync(join(fakeWorkspace, igOut?.images?.[0]?.path ?? 'none')));

  // video_generate：提交→轮询 2 次 running→succeeded→自动下载
  const vg = await post('/run-node', {
    nodeType: 'video_generate',
    params: {
      submitUrl: `http://127.0.0.1:${mediaPort}/video/submit`,
      pollUrl: `http://127.0.0.1:${mediaPort}/video/task?taskId={taskId}`,
      taskIdPath: 'output.task_id', statusPath: 'output.task_status',
      videoUrlPath: 'output.video_url', pollIntervalMs: 100, maxWaitMs: 15000,
      filename: 'e2e-video.mp4',
    },
  });
  const vgOut = vg.body?.summary?.results?.target?.out;
  t('video_generate → 200 且轮询到 video_url', vg.status === 200 && typeof vgOut?.videoUrl === 'string', JSON.stringify(vgOut)?.slice(0, 200));
  t('视频已落盘（轮询 3 次完成）', String(vgOut?.path ?? '').startsWith('.dag-flow/') === true && pollCount >= 3, `poll=${pollCount}`);
  t('视频文件真实存在', existsSync(join(fakeWorkspace, vgOut?.path ?? 'none')));

  // file_save：文本落盘 + URL 下载落盘 + 路径穿越拒绝
  const fs1 = await post('/run-node', { nodeType: 'file_save', params: { source: 'text', content: 'hello dag-flow asset', filename: 'notes/hello.txt' } });
  const f1 = fs1.body?.summary?.results?.target?.out;
  t('file_save(text) → 200 且写入子目录（.dag-flow/ 下）', fs1.status === 200 && f1?.path === '.dag-flow/notes/hello.txt', JSON.stringify(f1));
  t('文本资产真实存在', existsSync(join(fakeWorkspace, f1?.path ?? 'none')));
  const fs2 = await post('/run-node', { nodeType: 'file_save', params: { source: 'url', url: `http://127.0.0.1:${mediaPort}/files/test-video.mp4`, filename: 'download.mp4' } });
  t('file_save(url) → 200 下载落盘', fs2.status === 200 && fs2.body?.summary?.results?.target?.out?.bytes > 0, JSON.stringify(fs2.body)?.slice(0, 160));
  const trav = await post('/run-node', { nodeType: 'file_save', params: { source: 'text', content: 'x', filename: '../escape.txt' } });
  const travOut = trav.body?.summary?.results?.target?.out;
  t('路径穿越被拒绝或安全规范化', !(travOut?.path && String(travOut.path).includes('..')), JSON.stringify(travOut)?.slice(0, 160));

  mediaSrv.close();
}

// ===== 10. 分支键 next（画布/ AI 产出的形状）真实执行 =====
// 背景（2026-10-02 用户报错）：第 6 节的 switch 用例只给 edges、完全没写 next，
//   于是「switch 的 next 是 { case值: 目标 } 对象」这条画布 fromRF 每次保存都在产、
//   AI_SYSTEM_PROMPT 也在产的形状，从未过过一次 host schema 校验。
// 这里把画布保存前后的两种形状（串行 next / DAG next+edges）都锁进真实 /run。
{
  const swNodes = [
    { id: 'start', type: 'start', next: 'sw' },
    { id: 'sw', type: 'switch', label: '多路分支：运行模式', params: { value: 'quick', cases: { quick: 'log_q', full: 'log_f' } }, next: { quick: 'log_q', full: 'log_f' } },
    { id: 'log_q', type: 'log', params: { level: 'info', message: 'quick 分支' }, next: 'end' },
    { id: 'log_f', type: 'log', params: { level: 'info', message: 'full 分支' }, next: 'end' },
    { id: 'end', type: 'end' },
  ];
  // 10.1 串行（next 推导）——画布保存前的形状
  const r1 = await post('/run', { def: { name: 'e2e-next-sw-serial', version: 1, nodes: swNodes } });
  const e1 = String(r1.body?.error ?? '');
  t('10.1 switch case 映射 next（串行）→ 200 且不报结构校验未通过', r1.status === 200 && !e1.includes('结构校验未通过'), (e1 || JSON.stringify(r1.body?.summary?.error ?? {}))?.slice(0, 240));
  const s1 = r1.body?.summary?.results ?? {};
  t('10.2 switch case 映射 next（串行）→ 命中 quick 分支、未走 full', s1.log_q?.status === 'success' && s1.log_f?.status !== 'success', JSON.stringify(s1)?.slice(0, 240));
  // 10.3 DAG（edges 覆盖 next）——画布保存后的形状（next 与 edges 并存）
  const r2 = await post('/run', { def: { name: 'e2e-next-sw-dag', version: 1, nodes: swNodes, edges: [
    { from: 'start', to: 'sw' },
    { from: 'sw', to: 'log_q', when: 'quick' },
    { from: 'sw', to: 'log_f', when: 'full' },
    { from: 'log_q', to: 'end' },
    { from: 'log_f', to: 'end' },
  ] } });
  const s2 = r2.body?.summary?.results ?? {};
  t('10.4 switch case 映射 next + edges（DAG）→ quick 执行、full skipped', r2.status === 200 && s2.log_q?.status === 'success' && s2.log_f?.status === 'skipped', JSON.stringify(r2.body)?.slice(0, 240));
  // 10.5 if 的 {true,false} 对象：oneOf 合并后不得撞车（并列两 object 分支会让所有 if 失效）
  const ifNodes = [
    { id: 'start', type: 'start', next: 'cond' },
    { id: 'cond', type: 'if', label: '是否有搜索结果', params: { condition: '1 == 1' }, next: { true: 'log_t', false: 'log_f' } },
    { id: 'log_t', type: 'log', params: { level: 'info', message: 'true 分支' }, next: 'end' },
    { id: 'log_f', type: 'log', params: { level: 'info', message: 'false 分支' }, next: 'end' },
    { id: 'end', type: 'end' },
  ];
  const r3 = await post('/run', { def: { name: 'e2e-next-if', version: 1, nodes: ifNodes } });
  const s3 = r3.body?.summary?.results ?? {};
  t('10.5 if {true,false} next → 200 且 true 分支执行', r3.status === 200 && s3.log_t?.status === 'success' && s3.log_f?.status !== 'success', JSON.stringify(r3.body)?.slice(0, 240));
  // 10.6 非法 next：**运行前自检**先拦（2026-10-04 轮 1 用户拍板：运行前自动检查 → 报错 + 解决办法 + 人工确认）。
  //   ★ 契约变更：非法 def 从「500 + error 文本」变成「409 { blocked:true, selfcheck }」——
  //     结构错误信息原样保留在 selfcheck.items[0].message 里（仍然是折叠后的单条人话）。
  const bad = await post('/run', { def: { name: 'e2e-next-bad', version: 1, nodes: [
    { id: 'start', type: 'start', next: 'sw' },
    { id: 'sw', type: 'switch', label: '多路分支：运行模式', params: { value: 'quick', cases: { quick: 'end' } }, next: 123 },
    { id: 'end', type: 'end' },
  ] } });
  const sc = bad.body?.selfcheck ?? {};
  const badMsg = String(sc.items?.[0]?.message ?? '');
  t('10.6 非法 next → 被自检拦下（409 + blocked + STRUCT_INVALID）',
    bad.status === 409 && bad.body?.blocked === true && sc.items?.[0]?.code === 'STRUCT_INVALID',
    JSON.stringify({ status: bad.status, blocked: bad.body?.blocked, code: sc.items?.[0]?.code }));
  t('10.7 拦下时仍给出折叠后的单条人话（含 显示名_id(类型)，不喷 9 条 ajv 原文）',
    badMsg.includes('结构不符合任一允许的形式') && badMsg.includes('多路分支：运行模式_sw(switch)') && !badMsg.includes('缺少必填字段 "true"'),
    badMsg.slice(0, 240));
  t('10.8 ★拦下的提示必须带「解决办法」（用户明确要求：报错提示 + 解决办法）',
    typeof sc.items?.[0]?.fix === 'string' && sc.items[0].fix.length > 10, JSON.stringify(sc.items?.[0]?.fix ?? '').slice(0, 120));
  // 10.9 人工确认「仍然运行」= 带 skipSelfcheck:true 重发 → 回到既有路径（结构错仍然是 500 + error 文本）
  const forced = await post('/run', { skipSelfcheck: true, def: { name: 'e2e-next-bad2', version: 1, nodes: [
    { id: 'start', type: 'start', next: 'sw' },
    { id: 'sw', type: 'switch', label: '多路分支：运行模式', params: { value: 'quick', cases: { quick: 'end' } }, next: 123 },
    { id: 'end', type: 'end' },
  ] } });
  t('10.9 仍然运行（skipSelfcheck:true）→ 绕开自检，走回引擎原路径（500 + error）',
    forced.status === 500 && String(forced.body?.error ?? '').includes('结构不符合任一允许的形式'),
    JSON.stringify({ status: forced.status, err: String(forced.body?.error ?? '').slice(0, 120) }));

  // ===== 11. 运行前自检专用路由（2026-10-04 轮 2：点运行 → 先 /selfcheck（按钮显示自检中）→ 通过后人工确认才 /run）
  const scClean = await post('/selfcheck', { def: { name: 'sc-clean', version: 1, nodes: [
    { id: 'start', type: 'start' }, { id: 'log1', type: 'log', params: { level: 'info', message: 'hi' } }, { id: 'end', type: 'end' },
  ], edges: [{ from: 'start', to: 'log1' }, { from: 'log1', to: 'end' }] } });
  t('11.1 POST /selfcheck → 200 且纯工作流通过（errorCount=0）',
    scClean.status === 200 && scClean.body?.errorCount === 0 && scClean.body?.ok === true,
    JSON.stringify(scClean.body)?.slice(0, 200));
  t('11.2 /selfcheck 返回统计（节点/边数）供确认弹窗展示',
    scClean.body?.stats?.nodes === 3 && scClean.body?.stats?.edges === 2, JSON.stringify(scClean.body?.stats));

  const scBad = await post('/selfcheck', { def: { name: 'sc-bad', version: 1, nodes: [
    { id: 'start', type: 'start' }, { id: 'py', type: 'python', params: {} }, { id: 'end', type: 'end' },
  ], edges: [{ from: 'start', to: 'py' }, { from: 'py', to: 'end' }] } });
  t('11.3 必填参数缺失 → /selfcheck 报 PARAM_REQUIRED（轮 2 新检查）',
    scBad.status === 200 && scBad.body?.items?.[0]?.code === 'PARAM_REQUIRED' && scBad.body?.errorCount === 1,
    JSON.stringify(scBad.body?.items?.[0] ?? {}).slice(0, 200));
  t('11.4 ★每条问题都带「解决办法」（fix）',
    typeof scBad.body?.items?.[0]?.fix === 'string' && scBad.body.items[0].fix.length > 10,
    JSON.stringify(scBad.body?.items?.[0]?.fix ?? ''));
  t('11.5 缺 def → /selfcheck 400（不静默通过）', (await post('/selfcheck', {})).status === 400);
  t('11.6 ★/selfcheck 只自检不执行（把必填缺失的 def 发给它，不会真的跑起来）',
    scBad.body?.ok === false && !scBad.body?.summary && !scBad.body?.runId,
    JSON.stringify({ ok: scBad.body?.ok, hasSummary: !!scBad.body?.summary }));

  // ===== 12. 自检轮 3：loop 边界/循环体、merge 上游、subflow 依赖（依赖项用**真实工作区**清单）=====
  const scLoop = await post('/selfcheck', { def: { name: 'sc-loop', version: 1, nodes: [
    { id: 'start', type: 'start' }, { id: 'lp', type: 'loop', params: {} }, { id: 'end', type: 'end' },
  ], edges: [{ from: 'start', to: 'lp' }, { from: 'lp', to: 'end' }] } });
  t('12.1 loop 无循环边界 → LOOP_NO_BOUND（error，运行必失败）',
    scLoop.body?.items?.some((i) => i.code === 'LOOP_NO_BOUND' && i.level === 'error'),
    JSON.stringify(scLoop.body?.items?.map((i) => i.code)));

  const scDep = await post('/selfcheck', { def: { name: 'sc-dep', version: 1, nodes: [
    { id: 'start', type: 'start' }, { id: 'sf', type: 'subflow', params: { workflowName: '肯定不存在的工作流-xyz' } },
    { id: 'mg', type: 'merge', params: {} }, { id: 'end', type: 'end' },
  ], edges: [{ from: 'start', to: 'sf' }, { from: 'sf', to: 'mg' }, { from: 'mg', to: 'end' }] } });
  t('12.2 subflow 依赖的工作流不存在 → SUBFLOW_MISSING（用真实工作区清单判定）',
    scDep.body?.items?.some((i) => i.code === 'SUBFLOW_MISSING' && i.level === 'error'),
    JSON.stringify(scDep.body?.items?.map((i) => i.code)));
  t('12.3 merge 只有 1 条上游 → MERGE_NO_UPSTREAM（error）',
    scDep.body?.items?.some((i) => i.code === 'MERGE_NO_UPSTREAM'),
    JSON.stringify(scDep.body?.items?.map((i) => i.code)));
  t('12.4 ★每条都带解决办法（fix）',
    (scDep.body?.items ?? []).every((i) => typeof i.fix === 'string' && i.fix.length > 8),
    JSON.stringify((scDep.body?.items ?? []).map((i) => String(i.fix).slice(0, 24))));

  const scAi = await post('/selfcheck', { def: { name: 'sc-ai', version: 1, nodes: [
    { id: 'start', type: 'start' }, { id: 'ai', type: 'subagent', params: { model: 'definitely-not-a-model-xyz', prompt: 'hi' } }, { id: 'end', type: 'end' },
  ], edges: [{ from: 'start', to: 'ai' }, { from: 'ai', to: 'end' }] } });
  t('12.5 存值模型解析不到 → 只给 warn（不拦运行：LLM 服务此刻不可用属正常）',
    scAi.body?.items?.some((i) => i.code === 'MODEL_UNRESOLVED' && i.level === 'warn') && scAi.body?.errorCount === 0,
    JSON.stringify({ codes: scAi.body?.items?.map((i) => i.code), errorCount: scAi.body?.errorCount }));

  // ===== 13. 自检轮 4：建议类（全部 warn，绝不拦运行）=====
  const scMedia = await post('/selfcheck', { def: { name: 'sc-media', version: 1, nodes: [
    { id: 'start', type: 'start' }, { id: 'img', type: 'image_generate', params: { prompt: 'cat', baseURL: 'https://x', model: 'm' } },
    { id: 'end', type: 'end' },
  ], edges: [{ from: 'start', to: 'img' }, { from: 'img', to: 'end' }] } });
  t('13.1 含图片生成节点 → MEDIA_COST（warn，提醒会产生费用）',
    scMedia.body?.items?.some((i) => i.code === 'MEDIA_COST' && i.level === 'warn') && scMedia.body?.errorCount === 0,
    JSON.stringify({ codes: scMedia.body?.items?.map((i) => i.code), errorCount: scMedia.body?.errorCount }));
  const scLoopBig = await post('/selfcheck', { def: { name: 'sc-bigloop', version: 1, nodes: [
    { id: 'start', type: 'start' }, { id: 'lp', type: 'loop', params: { count: 60 } }, { id: 'end', type: 'end' },
  ], edges: [{ from: 'start', to: 'lp' }, { from: 'lp', to: 'end' }] } });
  t('13.2 大循环（60 次）→ BIG_LOOP（warn，提醒耗时/数据量放大）',
    scLoopBig.body?.items?.some((i) => i.code === 'BIG_LOOP' && i.level === 'warn') && scLoopBig.body?.errorCount === 0,
    JSON.stringify({ codes: scLoopBig.body?.items?.map((i) => i.code), errorCount: scLoopBig.body?.errorCount }));
  t('13.3 ★建议类一律不拦运行（这两个 def 的 errorCount 都是 0）',
    scMedia.body?.ok === true && scLoopBig.body?.ok === true,
    JSON.stringify({ media: scMedia.body?.ok, loop: scLoopBig.body?.ok }));
}

// ===== 14. 引用即依赖（2026-10-08 用户拍板）：引擎侧也要拦 —— DATAFLOW_NO_EDGE =====
{
  // 14.1 引用了一个**没有连线**的节点 → 引擎拒绝执行
  const bad = await post('/run', { skipSelfcheck: true, def: { name: 'e2e-ref-no-edge', version: 1, nodes: [
    { id: 'start', type: 'start' },
    { id: 'producer', type: 'set_var', params: { vars: { v: 'x' } } },
    { id: 'consumer', type: 'log', params: { level: 'info', message: '{{producer.out}}' } },
    { id: 'end', type: 'end' },
  ], edges: [
    { from: 'start', to: 'producer' }, { from: 'start', to: 'consumer' }, { from: 'consumer', to: 'end' },
  ] } });
  const err = bad.body?.summary?.error;
  t('14.1 ★引用无连线的节点 → 引擎拒绝执行（DATAFLOW_NO_EDGE）',
    bad.body?.summary?.status === 'failed' && err?.code === 'DATAFLOW_NO_EDGE',
    JSON.stringify({ status: bad.body?.summary?.status, code: err?.code, msg: err?.message }));
  t('14.2 错误消息点明"没有连线 / 不是它的上游"并给出连线动作',
    /没有连线/.test(err?.message ?? '') && /上游/.test(err?.message ?? '') && /拖一条线/.test(err?.message ?? ''),
    String(err?.message).slice(0, 200));

  // 14.3 补上连线 → 正常跑（证明只拦"没依赖"，不拦合理工作流）
  const good = await post('/run', { skipSelfcheck: true, def: { name: 'e2e-ref-with-edge', version: 1, nodes: [
    { id: 'start', type: 'start' },
    { id: 'producer', type: 'set_var', params: { vars: { v: 'x' } } },
    { id: 'consumer', type: 'log', params: { level: 'info', message: '{{producer.out}}' } },
    { id: 'end', type: 'end' },
  ], edges: [
    { from: 'start', to: 'producer' }, { from: 'producer', to: 'consumer' }, { from: 'consumer', to: 'end' },
  ] } });
  t('14.3 补上 producer→consumer 连线 → 正常运行（success）',
    good.body?.summary?.status === 'success',
    JSON.stringify({ status: good.body?.summary?.status, code: good.body?.summary?.error?.code }));

  // 14.4 ★可达性口径：隔着中间节点也算有依赖（否则 end 引用远处上游会被误拦）
  const transitive = await post('/run', { skipSelfcheck: true, def: { name: 'e2e-ref-transitive', version: 1, nodes: [
    { id: 'start', type: 'start' },
    { id: 'a', type: 'set_var', params: { vars: { v: 'x' } } },
    { id: 'b', type: 'log', params: { level: 'info', message: 'mid' } },
    { id: 'end', type: 'end', params: { outputs: { got: '{{a.out}}' } } },
  ], edges: [
    { from: 'start', to: 'a' }, { from: 'a', to: 'b' }, { from: 'b', to: 'end' },
  ] } });
  t('14.4 ★隔着节点引用（end 引用 a，路径 a→b→end）→ 放行（可达性口径，不误拦）',
    transitive.body?.summary?.status === 'success',
    JSON.stringify({ status: transitive.body?.summary?.status, code: transitive.body?.summary?.error?.code }));
}

server.close();
console.log(`\n=== api-e2e: ${pass} passed, ${fail} failed ===`);
if (fail > 0) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
