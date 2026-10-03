// test/loop.test.mjs — loop 节点语义专项验证
//
// 背景（2026-10-03 用户要求「验证 loop 功能」）：api-e2e 此前只覆盖了 loop.over 一条，
// count / while / 无边界 / 上限守卫 / 边界优先级全部没有钉子。本文件把它们逐个钉死，
// 并对演示工作流「全节点演示-技术简报」做**接线回归锁**（loop 节点 + switch 边自洽）。
//
// 手段：伪造 cordis ctx → 调 dist/index.js 的 apply(ctx) → 把捕获路由挂成本地服务
//       → fetch 真实 POST /api/dag-flow/run，读 summary.results 断言。
// 跑法：node test/loop.test.mjs
import * as http from 'node:http';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
function info(msg) { console.log(`  ℹ ${msg}`); }

// 1) 临时工作区（storage 的 cwd 解析链会落到这里，不污染真实工作区）
const fakeWorkspace = mkdtempSync(join(tmpdir(), 'dag-flow-loop-'));
process.chdir(fakeWorkspace);
const API_BASE = '/api/dag-flow';

// 2) 伪造 cordis ctx
const routes = [];
const stubCtx = {
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  webServer: { register(route) { routes.push(route); return () => {}; } },
};

// 3) 真实宿主 bundle
await import('file:///D:/workspace/pluginspace/dag-flow/dist/index.js').then((m) => m.apply(stubCtx));
t('apply(ctx) 捕获到路由', routes.length >= 8, `routes=${routes.length}`);

// 4) 本地服务挂载（exact / prefix 语义同 dsh-host-webserver）
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
const post = async (p, body) => {
  const r = await fetch(`http://127.0.0.1:${port}${API_BASE}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
/** 跑一个 def，返回 summary.results（节点 id → NodeResult） */
async function run(def) {
  const r = await post('/run', { def });
  return { status: r.status, results: r.body?.summary?.results ?? {}, raw: r.body };
}

console.log('\n== A. count 固定次数 ==');
{
  const { status, results } = await run({
    name: 'loop-count', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'lp' },
      { id: 'lp', type: 'loop', params: { count: 3 }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  });
  t('count=3 → count 3', status === 200 && results.lp?.out?.count === 3, JSON.stringify(results.lp?.out));
  t('count=3 → items=[0,1,2]', JSON.stringify(results.lp?.out?.items) === '[0,1,2]', JSON.stringify(results.lp?.out?.items));
  t('count=3 → 状态 success', results.lp?.status === 'success', results.lp?.status);
}

{
  const { results } = await run({
    name: 'loop-count-0', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'lp' },
      { id: 'lp', type: 'loop', params: { count: 0 }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  });
  t('count=0 → 0 次（不报错）', results.lp?.status === 'success' && results.lp?.out?.count === 0, JSON.stringify(results.lp?.out));
}

console.log('\n== B. over 遍历上游数组（模板解析）==');
{
  const { results } = await run({
    name: 'loop-over', version: 1,
    nodes: [
      { id: 'start', type: 'start', params: { items: ['x', 'y', 'z'] }, next: 'lp' },
      { id: 'lp', type: 'loop', params: { over: '{{start.out.items}}' }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  });
  t('over={{start.out.items}} → count 3', results.lp?.out?.count === 3, JSON.stringify(results.lp?.out));
  t('over 逐项收集（顺序保真）', JSON.stringify(results.lp?.out?.items) === '["x","y","z"]', JSON.stringify(results.lp?.out?.items));
}

{
  // 数组元素是对象（真实场景：web_search.out.results）
  const { results } = await run({
    name: 'loop-over-obj', version: 1,
    nodes: [
      { id: 'start', type: 'start', params: { rows: [{ t: 'a' }, { t: 'b' }] }, next: 'lp' },
      { id: 'lp', type: 'loop', params: { over: '{{start.out.rows}}' }, next: 'log' },
      { id: 'log', type: 'log', params: { message: '{{lp.out.items.1.t}}' }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  });
  t('over 元素为对象 → 下游可索引 {{lp.out.items.1.t}}', results.log?.out === 'b', JSON.stringify(results.log?.out));
}

console.log('\n== C. maxIterations 截断 / 边界优先级 ==');
{
  const { results } = await run({
    name: 'loop-cap', version: 1,
    nodes: [
      { id: 'start', type: 'start', params: { items: ['a', 'b', 'c', 'd'] }, next: 'lp' },
      { id: 'lp', type: 'loop', params: { over: '{{start.out.items}}', maxIterations: 2 }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  });
  t('over 4 项 + maxIterations=2 → 截断到 2', results.lp?.out?.count === 2, JSON.stringify(results.lp?.out));
  t('截断取前 N 项', JSON.stringify(results.lp?.out?.items) === '["a","b"]', JSON.stringify(results.lp?.out?.items));
}

{
  const { results } = await run({
    name: 'loop-prio', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'lp' },
      { id: 'lp', type: 'loop', params: { count: 5, over: ['only-one'] }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  });
  t('over 与 count 同时给 → over 优先（count 被忽略）', results.lp?.out?.count === 1, JSON.stringify(results.lp?.out));
}

console.log('\n== D. while 条件 ==');
{
  const { results } = await run({
    name: 'loop-while-false', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'lp' },
      { id: 'lp', type: 'loop', params: { while: 'false' }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  });
  t('while=false → 0 次且 success', results.lp?.status === 'success' && results.lp?.out?.count === 0, JSON.stringify(results.lp?.out));
}

{
  const { results } = await run({
    name: 'loop-while-cap', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'lp' },
      { id: 'lp', type: 'loop', params: { while: 'true', maxIterations: 3 }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  });
  t('while=true 达上限且未授权 → failed', results.lp?.status === 'failed', results.lp?.status);
  t('错误码 LOOP_MAX_ITER', results.lp?.error?.code === 'LOOP_MAX_ITER', JSON.stringify(results.lp?.error));
  t('错误消息含 maxIterations 与 dangerouslyAllowInfinite', /dangerouslyAllowInfinite/.test(String(results.lp?.error?.message)), String(results.lp?.error?.message));
}

{
  const { results } = await run({
    name: 'loop-while-inf', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'lp' },
      { id: 'lp', type: 'loop', params: { while: 'true', maxIterations: 3, dangerouslyAllowInfinite: true }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  });
  t('while=true + dangerouslyAllowInfinite → 跑满 3 次 success', results.lp?.status === 'success' && results.lp?.out?.count === 3, JSON.stringify(results.lp?.out));
}

{
  // 自引用条件（loop 自己的 out 在运行中不存在）→ 文档化的能力边界
  const { results } = await run({
    name: 'loop-while-self', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'lp' },
      { id: 'lp', type: 'loop', params: { while: 'lp.out.count < 3', maxIterations: 10 }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  });
  // ★ 实测（2026-10-03）：自引用 while 不是静默 0 次，而是以 UNCAUGHT 收场，
  //   消息 "表达式求值失败: undefined variable: lp" 且夹带完整 stack。
  //   这是体验缺口（用户写「循环到 3 次」很自然）：建议后续换成专属错误码
  //   LOOP_WHILE_EXPR + 一句「while 只能引用运行前已完成的节点」。改进后同步改本断言。
  info('while 自引用实测：' + JSON.stringify({ status: results.lp?.status, code: results.lp?.error?.code }));
  t('while 引用自身 out → failed（能力边界已锁定）', results.lp?.status === 'failed', JSON.stringify(results.lp?.out));
  t('while 自引用错误码当前为 UNCAUGHT（待改进为专属码）', results.lp?.error?.code === 'UNCAUGHT', JSON.stringify(results.lp?.error?.code));
  t('错误消息点明 undefined variable', /undefined variable/.test(String(results.lp?.error?.message)), String(results.lp?.error?.message));
  info('while 只能看运行前已完成的节点；循环体内部状态无法反映到条件里（v0.1 限制）');
}

console.log('\n== E. 无边界守卫 ==');
{
  const { results } = await run({
    name: 'loop-nobound', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'lp' },
      { id: 'lp', type: 'loop', params: { maxIterations: 5 }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  });
  t('count/while/over 全缺 → failed', results.lp?.status === 'failed', results.lp?.status);
  t('错误码 LOOP_NO_BOUND', results.lp?.error?.code === 'LOOP_NO_BOUND', JSON.stringify(results.lp?.error));
}

console.log('\n== E2. /run-node 单节点测试通路（客户端「测试节点」按钮）==');
{
  const r = await post('/run-node', { nodeType: 'loop', params: { count: 2 } });
  t('POST /run-node loop count=2 → 200 ok:true', r.status === 200 && r.body?.ok === true, JSON.stringify(r.body?.summary?.status));
  t('/run-node 目标节点 out.count=2', r.body?.summary?.results?.target?.out?.count === 2, JSON.stringify(r.body?.summary?.results?.target?.out));

  const bad = await post('/run-node', { nodeType: 'loop', params: { maxIterations: 5 } });
  t('/run-node 无边界 loop → ok:false + LOOP_NO_BOUND', bad.status === 200 && bad.body?.ok === false && bad.body?.summary?.results?.target?.error?.code === 'LOOP_NO_BOUND', JSON.stringify(bad.body?.summary?.results?.target?.error?.code));

  // 已知边界：单节点测试没有上游，over 里的 {{...}} 解析不到
  const up = await post('/run-node', { nodeType: 'loop', params: { over: '{{web_search1.out.results}}' } });
  t('/run-node 的 over 引用上游 → 失败（单节点无上游，已知边界）', up.body?.ok === false, JSON.stringify(up.body?.summary?.status));
  info('单节点测试的 over 引用上游：' + JSON.stringify(up.body?.summary?.results?.target?.error?.code));
}

console.log('\n== G. 循环体 = 子工作流（方案 A，2026-10-03 用户拍板）==');
{
  // 先保存一个「循环体」子工作流：start → end（end.outputs 引用 inputs）
  const child = {
    name: 'loop-body-child', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'end' },
      { id: 'end', type: 'end', params: { outputs: { got: '{{inputs.text}}', idx: '{{inputs.n}}' } } },
    ],
  };
  const saved = await post('/workflows/save', { name: 'loop-body-child', def: child });
  t('G0. 循环体子工作流已落盘', saved.status === 200, JSON.stringify(saved.body)?.slice(0, 140));

  // ① count + body：loopItem=轮次序号
  const r1 = await run({
    name: 'loop-body-count', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'lp' },
      { id: 'lp', type: 'loop', params: { count: 3, body: { workflowName: 'loop-body-child', inputs: { text: '{{vars.loopItem}}-x', n: '{{vars.loopIndex}}' } } }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  });
  const lp1 = r1.results.lp;
  t('G1. 循环体跑满 3 轮且节点 success', lp1?.status === 'success' && lp1?.out?.count === 3, JSON.stringify(lp1?.out)?.slice(0, 200));
  t('G2. 每轮结果依次收进 out.items（含注入的项与序号）',
    JSON.stringify(lp1?.out?.items?.[0]) === '{"got":"0-x","idx":0}' && JSON.stringify(lp1?.out?.items?.[2]) === '{"got":"2-x","idx":2}',
    JSON.stringify(lp1?.out?.items)?.slice(0, 240));

  // ② over + body：loopItem=数组元素本身
  const r2 = await run({
    name: 'loop-body-over', version: 1,
    nodes: [
      { id: 'start', type: 'start', params: { rows: ['a', 'b'] }, next: 'lp' },
      { id: 'lp', type: 'loop', params: { over: '{{start.out.rows}}', body: { workflowName: 'loop-body-child', inputs: { text: '{{vars.loopItem}}!', n: '{{vars.loopIndex}}' } } }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  });
  t('G3. over 模式：item 与序号都注入到位', JSON.stringify(r2.results.lp?.out?.items) === '[{"got":"a!","idx":0},{"got":"b!","idx":1}]', JSON.stringify(r2.results.lp?.out?.items)?.slice(0, 240));

  // ③ 循环体不存在 → 明确失败
  const r3 = await run({
    name: 'loop-body-missing', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'lp' },
      { id: 'lp', type: 'loop', params: { count: 1, body: { workflowName: '根本没有这个子工作流' } }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  });
  t('G4. 循环体不存在 → WORKFLOW_NOT_FOUND', r3.results.lp?.error?.code === 'WORKFLOW_NOT_FOUND', JSON.stringify(r3.results.lp?.error)?.slice(0, 160));

  // ④ 某轮失败：默认 stop（保留已完成轮次）/ continue（写占位继续）
  const badChild = {
    name: 'loop-body-bad', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'boom' },
      { id: 'boom', type: 'python', params: { code: 'import sys\nsys.exit(1)', timeoutMs: 5000 }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  };
  await post('/workflows/save', { name: 'loop-body-bad', def: badChild });
  const mkBad = (extra) => ({
    name: 'loop-body-bad-run', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'lp' },
      { id: 'lp', type: 'loop', params: { count: 2, body: { workflowName: 'loop-body-bad', inputs: {} }, ...extra }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  });
  const r4 = await run(mkBad({}));
  t('G5. 默认 stop：某轮失败 → LOOP_BODY_FAILED', r4.results.lp?.status === 'failed' && r4.results.lp?.error?.code === 'LOOP_BODY_FAILED', JSON.stringify(r4.results.lp?.error)?.slice(0, 220));
  t('G6. 失败时 out.items 保留已完成轮次（便于排查）', Array.isArray(r4.results.lp?.out?.items) && r4.results.lp?.out?.count === 0, JSON.stringify(r4.results.lp?.out)?.slice(0, 160));
  const r5 = await run(mkBad({ onIterationError: 'continue' }));
  t('G7. continue：失败轮写占位并继续跑完', r5.results.lp?.status === 'success' && r5.results.lp?.out?.count === 2 && r5.results.lp?.out?.items?.[0]?.error?.code === 'SUBFLOW_FAILED', JSON.stringify(r5.results.lp?.out)?.slice(0, 240));
}

console.log('\n== H. switch 多 case 共用一个目标节点（2026-10-03 log_mode 被误跳过回归锁）==');
/** 被条件分支排除的节点：引擎会写一条 status='skipped' 的占位结果 */
const isSkipped = (r) => r?.status === 'skipped';
{
  // 背景：switch 的多个 case 可以指向同一个下游节点（演示工作流里 quick→log_mode 与 image→log_mode）。
  // 旧实现逐条「未激活边」就往 skipped 里塞目标，于是激活的那条 + 未激活的另一条 → 目标被错误跳过。
  // 本段把它钉死：只要有任意一条激活入边，目标就必须执行。
  const mk = (value) => ({
    name: `switch-shared-${value}`, version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'sw' },
      { id: 'sw', type: 'switch', params: { value, cases: { a: 't', b: 't', c: 'u' } } },
      { id: 't', type: 'set_var', params: { vars: { hit: 'yes' } }, next: 'end' },
      { id: 'u', type: 'set_var', params: { vars: { hit: 'no' } }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
    edges: [
      { from: 'start', to: 'sw' },
      { from: 'sw', to: 't', when: 'a' },
      { from: 'sw', to: 't', when: 'b' },
      { from: 'sw', to: 'u', when: 'c' },
      { from: 't', to: 'end' },
      { from: 'u', to: 'end' },
    ],
  });

  const h1 = await run(mk('a'));
  t('H1. 命中 case a：共享目标 t 正常执行（不被未激活的 b 连带跳过）',
    h1.results.t?.status === 'success', JSON.stringify(h1.results.t)?.slice(0, 200));
  t('H2. 未命中的 case c 目标 u 仍被跳过',
    isSkipped(h1.results.u), JSON.stringify(h1.results.u)?.slice(0, 160));
  t('H3. switch 输出 matched 与 target 可观测',
    h1.results.sw?.out?.matched === 'a' && h1.results.sw?.out?.target === 't', JSON.stringify(h1.results.sw?.out));
  t('H4. end 汇总成功（两条分支都没把整图带崩）', h1.results.end?.status === 'success', JSON.stringify(h1.results.end?.status));

  // 反向验证：同一个共享目标在**另一条** case 命中时同样要执行（不是「只对第一条边生效」）
  const h2 = await run(mk('b'));
  t('H5. 命中 case b：同一个共享目标 t 同样执行', h2.results.t?.status === 'success', JSON.stringify(h2.results.t)?.slice(0, 160));

  // 真正没被激活的目标必须仍然是 skipped（别把修复改成「一律不跳过」）
  const h3 = await run(mk('c'));
  t('H6. 命中 case c：t 被正确跳过、u 执行', isSkipped(h3.results.t) && h3.results.u?.status === 'success',
    `t=${h3.results.t?.status} u=${h3.results.u?.status}`);
}

console.log('\n== F. 演示工作流接线回归锁（全节点演示-技术简报）==');
const DEMO = process.env.DEMO_WF ?? 'D:/workspace/pluginspace/.dag-flow/workflow/全节点演示-技术简报.json';
if (!existsSync(DEMO)) {
  info(`演示工作流不在本机（${DEMO}）——跳过该段，不误报`);
} else {
  const demo = JSON.parse(readFileSync(DEMO, 'utf8'));
  const nodes = demo.nodes ?? [];
  const edges = demo.edges ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const loopNodes = nodes.filter((n) => n.type === 'loop');

  t('演示含 2 个 loop 节点（固定次数 + 遍历上游数据）', loopNodes.length === 2, loopNodes.map((n) => n.id).join(','));

  const lc = byId.get('loop_demo');
  t('loop_demo 存在且按 count 演示', lc?.type === 'loop' && lc?.params?.count === 3, JSON.stringify(lc?.params));

  const lo = byId.get('loop_over');
  t('loop_over 存在', lo?.type === 'loop', String(lo?.type));
  t('loop_over 以 over 遍历上游搜索结果为数组', lo?.params?.over === '{{web_search1.out.results}}', String(lo?.params?.over));
  t('loop_over 带 maxIterations 上限', typeof lo?.params?.maxIterations === 'number', String(lo?.params?.maxIterations));

  const hasEdge = (from, to, when) => edges.some((e) => e.from === from && e.to === to && (when === undefined || e.when === when));
  t('边：web_search1 → loop_over', hasEdge('web_search1', 'loop_over'));
  t('边：loop_over → end_final', hasEdge('loop_over', 'end_final'));
  t('边：prep_vars → loop_demo → end_final（原有循环仍在链路上）', hasEdge('prep_vars', 'loop_demo') && hasEdge('loop_demo', 'end_final'));

  const endOut = byId.get('end_final')?.params?.outputs ?? {};
  t('end_final 汇总 loop_demo.out.count', endOut.loopCount === '{{loop_demo.out.count}}', String(endOut.loopCount));
  t('end_final 汇总 loop_over.out.count', endOut.loopOverCount === '{{loop_over.out.count}}', String(endOut.loopOverCount));

  // ★ 重复边回归锁：同 from+to+when 只允许一条（用户真机「switch 切不回去」的 def 侧残留形态）
  const sig = (e) => `${e.from}→${e.to}@${e.when ?? ''}`;
  const dupes = edges.map(sig).filter((s, i, a) => a.indexOf(s) !== i);
  t('演示边无重复（同 from+to+when 唯一）', dupes.length === 0, dupes.join(' | '));

  // ★ switch 数据自洽：每条边的 when 必须是该 switch 声明的 case（否则画布有线、运行必跳过）
  const sw = byId.get('switch_mode');
  const swCases = Object.keys(sw?.params?.cases ?? {});
  const swEdges = edges.filter((e) => e.from === 'switch_mode');
  const orphanWhen = swEdges.filter((e) => !swCases.includes(e.when)).map((e) => e.when);
  t('switch_mode 出边的 when 都在 cases 里（无孤儿线）', orphanWhen.length === 0, orphanWhen.join(','));
  const caseNoEdge = swCases.filter((k) => !swEdges.some((e) => e.when === k));
  t('switch_mode 每个 case 都有连线（2026-10-03 补齐 image→log_mode）', caseNoEdge.length === 0, '缺连线的 case：' + caseNoEdge.join(','));

  // ★ 共享目标回归锁（H 段的真实触发场景）：switch_mode 有多个 case 指向同一个下游节点，
  //   引擎必须让该节点在执行侧照跑（否则 log_mode 又会被静默跳过）。
  const targets = swEdges.map((e) => e.to);
  const sharedT = [...new Set(targets.filter((v, i) => targets.indexOf(v) !== i))];
  t('switch_mode 存在「多 case 同目标」形态（共享目标的现实场景）', sharedT.length >= 1, 'targets=' + targets.join(','));

  // ★ if 节点：true/false 双分支齐全
  const ifNode = byId.get('if_has_search');
  const ifEdges = edges.filter((e) => e.from === 'if_has_search').map((e) => e.when);
  t('if_has_search 同时有 true 与 false 分支边', ifEdges.includes('true') && ifEdges.includes('false'), ifEdges.join(','));

  // 真实节点定义跑通：把演示里的 loop_demo 原样搬进最小 def 执行（防止演示节点被改成跑不动的参数）
  const { results } = await run({
    name: 'demo-loop-node', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'loop_demo' },
      { id: 'loop_demo', type: 'loop', params: lc.params, next: 'end_final' },
      { id: 'end_final', type: 'end', params: { outputs: { loopCount: '{{loop_demo.out.count}}' } } },
    ],
  });
  t('演示 loop_demo 原样定义可跑通且输出 count=3', results.loop_demo?.status === 'success' && results.loop_demo?.out?.count === 3, JSON.stringify(results.loop_demo?.out));
  t('演示 end_final 的 {{loop_demo.out.count}} 能解析', results.end_final?.out?.loopCount === 3, JSON.stringify(results.end_final?.out));
}

server.close();
console.log(`\n=== loop 专项：${pass} passed, ${fail} failed ===`);
if (fail) console.log('失败项：' + failures.join(' | '));
process.exit(fail ? 1 : 0);
