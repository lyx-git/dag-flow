import { tmpRoot } from './_tmp-root.mjs';
import './_isolate-home.mjs';   // ★ 2026-10-11：隔离 DSH_HOME（存储根 = <DSH_HOME>/.dag-flow）
// test/loop.test.mjs — loop 节点语义专项验证
//
// 背景（2026-10-03 用户要求「验证 loop 功能」）：api-e2e 此前只覆盖了 loop.over 一条，
// count / over / 无边界 / 上限守卫 / 边界优先级 / 每轮条件 / 打断全部有钉子。（while 条件循环 2026-10-19 已移除）
// 并对演示工作流「全节点演示-技术简报」做**接线回归锁**（loop 节点 + switch 边自洽）。
//
// 手段：伪造 cordis ctx → 调 dist/index.js 的 apply(ctx) → 把捕获路由挂成本地服务
//       → fetch 真实 POST /api/dag-flow/run，读 summary.results 断言。
// 跑法：node test/loop.test.mjs
import * as http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
function info(msg) { console.log(`  ℹ ${msg}`); }

// 1) 临时工作区（storage 的 cwd 解析链会落到这里，不污染真实工作区）
const fakeWorkspace = tmpRoot('dag-flow-loop-');
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
/** 跑一个 def，返回 summary.results（节点 id → NodeResult）
 *  ★ 2026-10-04 自检轮 3：本文件测的是**引擎侧**的 loop/merge/subflow 语义，显式跳过运行前自检那道门
 *    （不带 skipSelfcheck 时，"故意不合法"的 def 会被自检以 409 拦下，见文件末尾 §自检门 段） */
async function run(def) {
  const r = await post('/run', { skipSelfcheck: true, def });
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

// ★ 2026-10-19（用户拍板 A：让「超上限」可见）：count / over 超 maxIterations 以前是**静默截断**
//   （out.count 只显示 1000，看不出还有几千项没跑）⇒ 现在真截断时 out 里带 truncated / requested / processed；
//   没截断时 out 形态与以前一字不差（既有下游引用零影响）。
{
  const { results } = await run({
    name: 'loop-trunc-over', version: 1,
    nodes: [
      { id: 'start', type: 'start', params: { items: ['a', 'b', 'c', 'd'] }, next: 'lp' },
      { id: 'lp', type: 'loop', params: { over: '{{start.out.items}}', maxIterations: 2 }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  });
  const o = results.lp?.out ?? {};
  t('over 截断时 out 标 truncated:true', o.truncated === true, JSON.stringify(o));
  t('over 截断时 requested=4 / processed=2', o.requested === 4 && o.processed === 2, JSON.stringify(o));
}
{
  const { results } = await run({
    name: 'loop-trunc-count', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'lp' },
      { id: 'lp', type: 'loop', params: { count: 5, maxIterations: 2 }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  });
  const o = results.lp?.out ?? {};
  t('count 截断同样标出（requested=5 / processed=2）', o.truncated === true && o.requested === 5 && o.processed === 2, JSON.stringify(o));
}
{
  const { results } = await run({
    name: 'loop-nocap', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'lp' },
      { id: 'lp', type: 'loop', params: { count: 2 }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  });
  const o = results.lp?.out ?? {};
  t('没截断时 out 只有 count / items（形态与改动前一致）', Object.keys(o).sort().join(',') === 'count,items', JSON.stringify(o));
}

// ★ 2026-10-19 第二轮（用户原话「不填应该是按照默认数组实际有多少数据执行的吧，填了才是按照数据截断」，
//   拍板 A）：count / over **留空＝不限** —— 以前那个"不填＝1000"的隐形上限取消，按数据实际长度跑。
{
  const { results } = await run({
    name: 'loop-blank-over', version: 1,
    nodes: [
      { id: 'start', type: 'start', params: { items: Array.from({ length: 1200 }, (_, i) => i) }, next: 'lp' },
      { id: 'lp', type: 'loop', params: { over: '{{start.out.items}}' }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  });
  const o = results.lp?.out ?? {};
  t('over 1200 项 + 不填上限 → 跑满 1200（不再截断到 1000）', o.count === 1200, JSON.stringify({ count: o.count, truncated: o.truncated }));
  t('不填上限且没触及硬保护 → 不带 truncated', o.truncated === undefined, JSON.stringify(o.truncated));
}
{
  const { results } = await run({
    name: 'loop-blank-count', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'lp' },
      { id: 'lp', type: 'loop', params: { count: 1200 }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  });
  t('count 1200 + 不填上限 → 跑满 1200', results.lp?.out?.count === 1200, JSON.stringify(results.lp?.out?.count));
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

console.log('\n== C2. over 配了但解析出来不是数组（2026-10-19 用户拍板「改」）==');
//  以前会一路落到 count / while ⇒ 最后报 LOOP_NO_BOUND「缺少循环边界」，把"没配"和"配了但取值失败"混成一句，
//  用户看到只会以为自己没填。现在给专属码 + 实际类型 + 检查方向。
{
  const { results } = await run({
    name: 'loop-over-not-array', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'lp' },
      { id: 'lp', type: 'loop', params: { over: 'not-an-array' }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  });
  t('★ over 是字符串（不是数组）→ 专属码 LOOP_OVER_NOT_ARRAY',
    results.lp?.error?.code === 'LOOP_OVER_NOT_ARRAY', JSON.stringify(results.lp?.error?.code));
  const m = String(results.lp?.error?.message ?? '');
  t('★ 消息给出实际类型 + 检查方向（"不是数组" / "string" / "out.items"）',
    /不是数组/.test(m) && /string/.test(m) && /out\.items/.test(m), m.slice(0, 220));
}
{
  // 空串（面板刚切到 over、还没填值）**不算配了** ⇒ 仍按"没有边界"处理，不能被新判据抢走
  const { results } = await run({
    name: 'loop-over-empty', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'lp' },
      { id: 'lp', type: 'loop', params: { over: '' }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  });
  t('over 空串仍报 LOOP_NO_BOUND（不误判成"配了但类型错"）',
    results.lp?.error?.code === 'LOOP_NO_BOUND', JSON.stringify(results.lp?.error?.code));
}

// ★ 2026-10-19（用户拍板：while 条件循环整条移除）：原 D 段「while 条件」的全部用例已删除
//   （while=false / while 达上限 LOOP_MAX_ITER / dangerouslyAllowInfinite / 自引用求值失败都随之退役）。
//   "跑到满足条件为止"改用循环体里的条件节点 + end 输出 break: true（见 C6）。

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
  t('count/over 全缺 → failed', results.lp?.status === 'failed', results.lp?.status);
  t('错误码 LOOP_NO_BOUND', results.lp?.error?.code === 'LOOP_NO_BOUND', JSON.stringify(results.lp?.error));
}

console.log('\n== E2. /run-node 单节点测试通路（客户端「测试节点」按钮）==');
{
  const r = await post('/run-node', { nodeType: 'loop', params: { count: 2 } });
  t('POST /run-node loop count=2 → 200 ok:true', r.status === 200 && r.body?.ok === true, JSON.stringify(r.body?.summary?.status));
  t('/run-node 目标节点 out.count=2', r.body?.summary?.results?.target?.out?.count === 2, JSON.stringify(r.body?.summary?.results?.target?.out));

  const bad = await post('/run-node', { nodeType: 'loop', params: { maxIterations: 5 } });
  t('/run-node 无边界 loop → ok:false + LOOP_NO_BOUND', bad.status === 200 && bad.body?.ok === false && bad.body?.summary?.results?.target?.error?.code === 'LOOP_NO_BOUND', JSON.stringify(bad.body?.summary?.results?.target?.error?.code));

  // ★ 2026-10-11（用户要求 ③）真机诊断结论：失败发生在**执行器解析模板**那一步（不在 loop 节点里）——
  //   整轮 error.code = DATAFLOW_UNKNOWN、message「节点 "target" 引用了不存在的节点 "web_search1"」，
  //   而 target 节点**根本没有结果**（它在解析阶段就被拦下、没跑起来）。
  //   现在 /run-node 会给这句补上「单节点试跑没有上游」+ 出路（只改文案，错误码不动）。
  const up = await post('/run-node', { nodeType: 'loop', params: { over: '{{web_search1.out.results}}' } });
  t('/run-node 的 over 引用上游 → 失败（试跑没有上游）', up.body?.ok === false, JSON.stringify(up.body?.summary?.status));
  t('★ 错误码仍是 DATAFLOW_UNKNOWN（引擎判据未改）', up.body?.summary?.error?.code === 'DATAFLOW_UNKNOWN', JSON.stringify(up.body?.summary?.error?.code));
  {
    const m = String(up.body?.summary?.error?.message ?? '');
    t('★ 消息补上「单节点试跑」的固有限制', /单节点试跑/.test(m), m.slice(0, 170));
    t('★ 消息给出出路：整图运行 / {{inputs.xxx}}', /整图运行/.test(m) && /inputs/.test(m));
    t('★ 消息不含 Markdown 星号', !/\*\*/.test(m));
  }
  info('单节点试跑 over 引用上游：' + JSON.stringify(up.body?.summary?.error?.code));
  // 合法的喂数据方式：{{inputs.xxx}}（试跑面板支持填输入）——锁住它别被上面的"顺手一拦"误伤
  const viaInputs = await post('/run-node', { nodeType: 'loop', params: { over: '{{inputs.list}}' }, inputs: { list: [1, 2, 3] } });
  t('★ 用 {{inputs.list}} 给试跑喂数组 → 成功且逐项迭代 3 次', viaInputs.body?.ok === true && viaInputs.body?.summary?.results?.target?.out?.count === 3, JSON.stringify(viaInputs.body?.summary?.results?.target?.out));
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

  // ⑤ ★ 2026-10-19（用户原话：「父子工作流，如果子工作流失败了，看不到是哪个节点失败了，失败的原因是啥」）
  //    父层必须带出「第几轮 / 哪个节点 / 什么错误码 / 说了什么」；out 里同时给结构化字段（纯加法，不动 count/items）。
  const msg4 = String(r4.results.lp?.error?.message ?? '');
  t('G8. 默认 stop：message 带出子工作流里失败的节点与错误码', /节点「boom」失败 —— PYTHON_EXIT/.test(msg4), msg4.slice(0, 220));
  t('G9. 默认 stop：out 带 failedRound / failedNode，原 count/items 不变', r4.results.lp?.out?.failedRound === 1 && r4.results.lp?.out?.failedNode?.id === 'boom' && r4.results.lp?.out?.count === 0, JSON.stringify(r4.results.lp?.out)?.slice(0, 220));
  const it0 = r5.results.lp?.out?.items?.[0];
  t('G10. continue：失败轮占位同样带 failedNode 与节点明细', it0?.failedNode?.id === 'boom' && /节点「boom」失败/.test(String(it0?.error?.message ?? '')), JSON.stringify(it0)?.slice(0, 220));

  // subflow 节点（非循环）走同一条路：子工作流内部失败 → 父层一句话说清
  const subBad = {
    name: 'subflow-bad-run', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'sf' },
      { id: 'sf', type: 'subflow', params: { workflowName: 'loop-body-bad', inputs: {} }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  };
  const r6 = await run(subBad);
  t('G11. subflow：message 带出子工作流内部失败节点与错误码', r6.results.sf?.status === 'failed' && /节点「boom」失败 —— PYTHON_EXIT/.test(String(r6.results.sf?.error?.message ?? '')), String(r6.results.sf?.error?.message ?? '').slice(0, 220));
  t('G12. subflow：out.failedNode 结构化保留（供面板/日志）', r6.results.sf?.out?.failedNode?.id === 'boom' && r6.results.sf?.out?.failedNode?.code === 'PYTHON_EXIT', JSON.stringify(r6.results.sf?.out)?.slice(0, 220));
}

// ★ 2026-10-19（用户拍板：while 条件循环整条移除）：原 C3 段「while 引用上一轮输出 / 轮次序号」的 ①~④ 已删除。
//   其中"条件表达式求值器"那条能力仍然有效，用 if 条件继续钉住 ↓
console.log('\n== C3. 表达式求值器（while 已移除，用 if 条件继续钉）==');
{
  const r6 = await run({
    name: 'expr-orop', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'br' },
      { id: 'br', type: 'if', params: { condition: 'false || true' }, next: { true: 't', false: 'f' } },
      { id: 't', type: 'log', params: { message: 'T' }, next: 'end' },
      { id: 'f', type: 'log', params: { message: 'F' }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  });
  t('★ 表达式 `||` 不再静默失效（false || true ⇒ 走 true 分支）',
    r6.results.t?.status === 'success', `t=${JSON.stringify(r6.results.t?.status)} f=${JSON.stringify(r6.results.f?.status)}`);
}

console.log('\n== C4. 循环体传参拿上一轮输出（2026-10-19 用户选 A：{{vars.lastOutput}}）==');
{
  // 专用子工作流：把收到的 text 原样从 end 回显（声明了工作流参数 text）。
  const echoChild = {
    name: 'loop-echo-child', version: 1,
    inputs: { text: '' },
    nodes: [
      { id: 'start', type: 'start', next: 'end' },
      { id: 'end', type: 'end', params: { outputs: { text: '{{inputs.text}}' } } },
    ],
  };
  await post('/workflows/save', { name: 'loop-echo-child', def: echoChild });
  // 每轮把"上一轮回显的 text"再接一个 x ⇒ 长度必须逐轮 +1（只依赖长度，对首轮 undefined 的具体形态不敏感）
  const r = await run({
    name: 'loop-lastoutput-input', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'lp' },
      { id: 'lp', type: 'loop', params: {
        count: 3,
        body: { workflowName: 'loop-echo-child', inputs: { text: '{{vars.lastOutput.text}}x' } },
      }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  });
  const it = r.results.lp?.out?.items ?? [];
  const len = (i) => String(it[i]?.text ?? '').length;
  t('★ 循环体传参可引用上一轮输出（{{vars.lastOutput.text}}：每轮回显长度 +1）',
    it.length === 3 && len(1) === len(0) + 1 && len(2) === len(1) + 1,
    JSON.stringify(it)?.slice(0, 240));
}

// ★ 2026-10-19（用户拍板：while + whileMode 整条移除）：原 C5 段「while 两种模式（真/假继续）」3 条用例已删除。
//   "跑到满足条件为止"改用 count + 每轮条件 + 循环体里的 break（见 C6 / C7）。

console.log('\n== C6. 从循环体里打断循环（end 输出 break: true，2026-10-19 用户拍板 A）==');
{
  // ① 恒定打断：子工作流每轮都回 break: true ⇒ 第 1 轮跑完就停（count 5 也只用 1 轮）
  const breakYes = {
    name: 'loop-break-yes', version: 1, inputs: { n: 0 },
    nodes: [
      { id: 'start', type: 'start', next: 'end' },
      { id: 'end', type: 'end', params: { outputs: { n: '{{inputs.n}}', break: true } } },
    ],
  };
  await post('/workflows/save', { name: 'loop-break-yes', def: breakYes });
  const r1 = await run({
    name: 'loop-break-always', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'lp' },
      { id: 'lp', type: 'loop', params: { count: 5, body: { workflowName: 'loop-break-yes', inputs: { n: '{{vars.loopIndex}}' } } }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  });
  const o1 = r1.results.lp?.out ?? {};
  t('★ end 输出 break:true ⇒ 本轮跑完就停（count=5 只跑 1 轮，节点仍 success）',
    r1.results.lp?.status === 'success' && o1.count === 1 && o1.broken === true && o1.breakAt === 1,
    JSON.stringify({ status: r1.results.lp?.status, out: o1 })?.slice(0, 200));

  // ② 不写 break ⇒ 行为与改动前完全一致（不出现 broken 字段）
  const breakNo = {
    name: 'loop-break-no', version: 1, inputs: { n: 0 },
    nodes: [
      { id: 'start', type: 'start', next: 'end' },
      { id: 'end', type: 'end', params: { outputs: { n: '{{inputs.n}}' } } },
    ],
  };
  await post('/workflows/save', { name: 'loop-break-no', def: breakNo });
  const r2 = await run({
    name: 'loop-break-never', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'lp' },
      { id: 'lp', type: 'loop', params: { count: 3, body: { workflowName: 'loop-break-no', inputs: { n: '{{vars.loopIndex}}' } } }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  });
  const o2 = r2.results.lp?.out ?? {};
  t('没有 break 信号 ⇒ 跑满 3 轮且不带 broken（纯加法，老循环一字不变）',
    o2.count === 3 && !('broken' in o2) && !('breakAt' in o2), JSON.stringify(o2)?.slice(0, 160));

  // ③ 推荐配方：子工作流里用 if + set_var 决定是否打断（end 会自动把 vars 带进输出）
  const breakCond = {
    name: 'loop-break-cond', version: 1, inputs: { n: 0 },
    nodes: [
      { id: 'start', type: 'start', next: 'br' },
      { id: 'br', type: 'if', params: { condition: 'inputs.n == 1' }, next: { true: 'sv', false: 'end' } },
      { id: 'sv', type: 'set_var', params: { vars: { break: true } }, next: 'end' },
      { id: 'end', type: 'end', params: { outputs: { n: '{{inputs.n}}' } } },
    ],
  };
  await post('/workflows/save', { name: 'loop-break-cond', def: breakCond });
  const r3 = await run({
    name: 'loop-break-cond-main', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'lp' },
      { id: 'lp', type: 'loop', params: { count: 5, body: { workflowName: 'loop-break-cond', inputs: { n: '{{vars.loopIndex}}' } } }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  });
  const o3 = r3.results.lp?.out ?? {};
  t('★ 条件打断（if → set_var break=true）：count=5 在第 2 轮（n==1）后停 ⇒ count=2 / breakAt=2',
    o3.count === 2 && o3.broken === true && o3.breakAt === 2, JSON.stringify(o3)?.slice(0, 200));
}

console.log('\n== C7. 每轮条件 roundIf：为真才执行本轮，为假跳过继续下一轮（2026-10-19 用户拍板 A）==');
{
  // 复用 C6 的 loop-break-no（把收到的 n 原样回显）当循环体
  const r1 = await run({
    name: 'loop-roundif-skip', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'lp' },
      { id: 'lp', type: 'loop', params: {
        count: 4, roundIf: 'loopIndex != 1',
        body: { workflowName: 'loop-break-no', inputs: { n: '{{vars.loopIndex}}' } },
      }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  });
  const o1 = r1.results.lp?.out ?? {};
  const ns = (o1.items ?? []).map((x) => x?.n).join(',');
  t('★ roundIf 为假的轮被跳过（count=4、条件 loopIndex != 1 ⇒ 执行 0,2,3 三轮）',
    r1.results.lp?.status === 'success' && o1.count === 3 && ns === '0,2,3',
    JSON.stringify({ status: r1.results.lp?.status, count: o1.count, ns })?.slice(0, 200));
  t('配了 roundIf ⇒ out 里带 rounds=4 / skipped=1',
    o1.rounds === 4 && o1.skipped === 1, JSON.stringify({ rounds: o1.rounds, skipped: o1.skipped }));

  // ② 每轮条件写错（引用不存在的变量）⇒ 专属失败，不许静默当 false 一路跳过
  const r2 = await run({
    name: 'loop-roundif-bad', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'lp' },
      { id: 'lp', type: 'loop', params: {
        count: 2, roundIf: 'nope.x == 1',
        body: { workflowName: 'loop-break-no', inputs: { n: '{{vars.loopIndex}}' } },
      }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  });
  t('roundIf 求值失败 ⇒ LOOP_COND_ERROR 且文案指向「每轮条件」',
    r2.results.lp?.error?.code === 'LOOP_COND_ERROR' && /每轮条件/.test(String(r2.results.lp?.error?.message ?? '')),
    JSON.stringify(r2.results.lp?.error)?.slice(0, 200));

  // ③ 没有循环体时不生效（loop 只产出迭代序列），out 形态也不带 rounds/skipped
  const r3 = await run({
    name: 'loop-roundif-nobody', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'lp' },
      { id: 'lp', type: 'loop', params: { count: 3, roundIf: 'false' }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  });
  const o3 = r3.results.lp?.out ?? {};
  t('没配循环体 ⇒ roundIf 不生效（仍产出 3 项，且不带 rounds/skipped）',
    o3.count === 3 && !('rounds' in o3) && !('skipped' in o3), JSON.stringify(o3));
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
  // ★ 2026-10-03 改为**自洽断言**：这是用户随时在画布上编辑的验收文件，不能硬编码 count=3
  //   （真机就发生过：用户把 loop_demo 改成「循环体=子工作流」+ count 0，锁在旧值上会假红）。
  //   这里只要求「是个能跑的 loop 配置」：count 是数字 / 有 over / 有 body 至少其一（while 已移除，不再算）。
  const lcBound = typeof lc?.params?.count === 'number' || lc?.params?.over != null || lc?.params?.body != null;
  t('loop_demo 存在且边界/循环体配置齐全（自洽，不锁具体次数）', lc?.type === 'loop' && lcBound, JSON.stringify(lc?.params));

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

  // ★ 数据体检（**advisory：只报告，不算测试失败**）。
  //   原因（2026-10-03）：这个文件是用户随时在画布上编辑的验收载体，把它当冻结夹具会让
  //   「用户正在编辑」误报成「引擎回归」——真机上就发生过一次（switch_mode 的 when 键在画布上被改乱 +
  //   loop_demo 改挂循环体）。引擎语义由 H 段与真机 live-demo-run 负责，数据体检只提示不判死。
  const sig = (e) => `${e.from}→${e.to}@${e.when ?? ''}`;
  const dupes = edges.map(sig).filter((s, i, a) => a.indexOf(s) !== i);
  const sw = byId.get('switch_mode');
  const swCases = Object.keys(sw?.params?.cases ?? {});
  const swEdges = edges.filter((e) => e.from === 'switch_mode');
  const orphanWhen = swEdges.filter((e) => !swCases.includes(e.when)).map((e) => e.when);
  const caseNoEdge = swCases.filter((k) => !swEdges.some((e) => e.when === k));
  const health = { 重复边: dupes, 孤儿线: orphanWhen, 缺连线的case: caseNoEdge };
  const healthBad = dupes.length > 0 || orphanWhen.length > 0 || caseNoEdge.length > 0;
  if (healthBad) {
    info(`⚠ 演示工作流数据体检发现可疑项（不影响本测试判定；这是画布编辑残留，建议在画布上核对）：${JSON.stringify(health)}`);
  } else {
    info('演示工作流数据体检：边无重复 / 无孤儿线 / 每个 case 都有连线');
  }

  // ★ 共享目标形态：仅当文件里确实存在「多 case 同目标」时锁引擎行为（H 段已独立锁死语义）
  const targets = swEdges.map((e) => e.to);
  const sharedT = [...new Set(targets.filter((v, i) => targets.indexOf(v) !== i))];
  if (sharedT.length >= 1) info(`演示里 switch_mode 存在「多 case 同目标」形态：${sharedT.join(',')}（语义锁在 H 段）`);

  // ★ if 节点：true/false 双分支齐全（同样是用户可编辑数据 → advisory）
  const ifEdges = edges.filter((e) => e.from === 'if_has_search').map((e) => e.when);
  if (!(ifEdges.includes('true') && ifEdges.includes('false'))) {
    info(`⚠ if_has_search 的分支边不全（实际：${ifEdges.join(',') || '无'}）——画布上核对一下`);
  }

  // 真实节点定义跑通：把演示里的 loop_demo 原样搬进最小 def 执行（防止演示节点被改成跑不动的参数）
  // ★ 若 loop_demo 挂了循环体（body.workflowName）：那个子工作流在**真实工作区**里，而本测试跑在
  //   临时工作区（见文件头 chdir）→ 先在**执行前**于同名位置放一个最小替身子工作流，才能验到循环体调用路径。
  const bodyName = lc.params?.body?.workflowName;
  if (bodyName) {
    await post('/workflows/save', {
      name: bodyName, def: {
        name: bodyName, version: 1,
        nodes: [{ id: 'start', type: 'start', next: 'end' }, { id: 'end', type: 'end', params: { outputs: { ok: '{{inputs.v}}' } } }],
      },
    });
  }
  const { results } = await run({
    name: 'demo-loop-node', version: 1,
    nodes: [
      { id: 'start', type: 'start', next: 'loop_demo' },
      { id: 'loop_demo', type: 'loop', params: lc.params, next: 'end_final' },
      { id: 'end_final', type: 'end', params: { outputs: { loopCount: '{{loop_demo.out.count}}' } } },
    ],
  });
  // ★ 自洽断言（不锁 3）：拿文件里**实际**的 params 跑一遍，断言引擎按它自己的配置给出对应结果
  //   （count 是数字时 out.count 必须等于它；有 body 时还得真跑循环体不报错）。
  const expectCount = typeof lc.params?.count === 'number' ? lc.params.count : null;
  const okCount = expectCount === null ? typeof results.loop_demo?.out?.count === 'number' : results.loop_demo?.out?.count === expectCount;
  t('演示 loop_demo 原样定义可跑通（out.count 与文件配置自洽）', results.loop_demo?.status === 'success' && okCount,
    `params=${JSON.stringify(lc.params)} out=${JSON.stringify(results.loop_demo?.out)?.slice(0, 160)}`);
  t('演示 end_final 的 {{loop_demo.out.count}} 能解析', results.end_final?.out?.loopCount === results.loop_demo?.out?.count,
    JSON.stringify(results.end_final?.out));
}

// ===== 自检门（2026-10-04 轮 3）：上面用 skipSelfcheck 走引擎侧；这里锁"新门"会**提前**拦住同一批错误 =====
{
  const badLoop = await post('/run', { def: { name: 'lp-gate', version: 1, nodes: [
    { id: 'start', type: 'start', next: 'lp' }, { id: 'lp', type: 'loop', params: {} }, { id: 'end', type: 'end' },
  ] } });
  t('自检门：loop 无边界 → 409 + LOOP_NO_BOUND（不必等运行时才失败）',
    badLoop.status === 409 && badLoop.body?.selfcheck?.items?.some((i) => i.code === 'LOOP_NO_BOUND'),
    JSON.stringify({ status: badLoop.status, codes: badLoop.body?.selfcheck?.items?.map((i) => i.code) }));
  t('自检门：拦下时给出解决办法（fix）',
    (badLoop.body?.selfcheck?.items ?? []).every((i) => typeof i.fix === 'string' && i.fix.length > 8),
    JSON.stringify((badLoop.body?.selfcheck?.items ?? []).map((i) => String(i.fix).slice(0, 30))));

  const badBody = await post('/run', { def: { name: 'lp-body-gate', version: 1, nodes: [
    { id: 'start', type: 'start', next: 'lp' },
    { id: 'lp', type: 'loop', params: { count: 1, body: { workflowName: '不存在的子流-xyz' } } },
    { id: 'end', type: 'end' },
  ] } });
  t('自检门：循环体子工作流不存在 → 409 + LOOP_BODY_MISSING（提前报，不等每轮失败）',
    badBody.status === 409 && badBody.body?.selfcheck?.items?.some((i) => i.code === 'LOOP_BODY_MISSING'),
    JSON.stringify({ status: badBody.status, codes: badBody.body?.selfcheck?.items?.map((i) => i.code) }));
}

server.close();
console.log(`\n=== loop 专项：${pass} passed, ${fail} failed ===`);
if (fail) console.log('失败项：' + failures.join(' | '));
process.exit(fail ? 1 : 0);
