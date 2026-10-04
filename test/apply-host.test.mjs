// test/apply-host.test.mjs — 宿主接入层测试（dsh 0.2.0 语义 / 404 回归防线）
//
// 背景（2026-10-01 线上故障）：前端「新建工作流」报
//   创建失败: 请求失败（HTTP 404）:not found
// 根因（2026-10-01 真机日志 13:06:34 定案）：cordis 4.x 的 fiber.store 只快照本插件
//   inject 名单里的服务（fiber.ts _checkImpl / this.store），0.1.7 起 apply 在未声明依赖
//   就绪前就会运行——inject 为空时 ctx.get('webServer') 拿到 undefined，裸属性访问又抛
//   `cannot get property "X" without inject`，detectApiDrift 把整套能力判成 drift →
//   路由与 /workflow 工具全不注册 → 请求落到共享 /api 处理器 → 404 not found。
//   （仅改 hostService() 走 ctx.get 不够——真机复验仍 404；本测试曾据此错误地断言
//   "inject 保持为空"，现已反转为"inject 必须含 webServer + tools"。）
// 修法：index.ts 声明 inject = ['webServer', 'tools']（apply 等服务就绪才跑）；
//   宿主服务访问仍统一走 hostService()（strict get → 非严格 get → 属性访问三层容错）；
//   路由 disposer 挂 ctx.effect（profile patchReload:"live"，重载后重复注册同一 (kind,path)
//   会抛 `webserver: duplicate ... route`）。
//
// 本测试直接对 dist/index.js 的 apply(ctx) 断言"可观测效果"，不依赖真实 DSH：
//   1) 伪造 0.2.0 Proxy ctx（裸属性访问抛 inject 错，ctx.get 供服务，ctx.effect 收 disposer）
//   2) 伪造 dsh-host-webserver.register（重复 (kind,path) 抛错 + 返回注销函数）
//   3) 用 node:http 把捕获的路由按 dsh 的 match() 语义（exact 优先，其次最长前缀）挂起来，
//      用真实 fetch 复现 UI 的建工作流请求
// 跑法：node test/apply-host.test.mjs
import * as http from 'node:http';
import { mkdtempSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ===== 伪造宿主 =====

const WS = mkdtempSync(join(tmpdir(), 'dag-flow-apply-'));

/** 伪造 0.2.0 cordis ctx：自有属性只有 get / effect，其余属性裸访问一律抛 inject 错。 */
function makeProxyCtx(services) {
  const effects = [];
  const logs = [];
  const target = {
    get(name) {
      return Object.prototype.hasOwnProperty.call(services, name) ? services[name] : undefined;
    },
    effect(cb, label) {
      // cordis fiber.effect(callback, label)：回调返回值（disposer）在 fiber 卸载时执行
      const ret = cb();
      const entry = { label, dispose: typeof ret === 'function' ? ret : undefined, alive: true };
      effects.push(entry);
      return () => { entry.alive = false; };
    },
  };
  const ctx = new Proxy(target, {
    get(t, prop, recv) {
      if (prop in t) return Reflect.get(t, prop, recv);
      if (typeof prop === 'symbol') return undefined;
      throw new Error(`cannot get property "${String(prop)}" without inject`);
    },
    has(t, prop) { return prop in t; },
  });
  return { ctx, effects, logs };
}

/** 伪造 dsh-host-webserver：register(route) 捕获路由，重复 (kind,path) 抛错，返回注销函数。 */
function makeWebServer(state) {
  return {
    register(route) {
      const key = `${route.kind ?? 'exact'} ${route.path}`;
      if (state.routes.some((r) => `${r.kind ?? 'exact'} ${r.path}` === key)) {
        throw new Error(`webserver: duplicate ${route.kind ?? 'exact'} route "${route.path}"`);
      }
      const stored = { kind: route.kind ?? 'exact', path: route.path, handler: route.handler };
      state.routes.push(stored);
      return () => {
        const i = state.routes.indexOf(stored);
        if (i >= 0) state.routes.splice(i, 1);
      };
    },
  };
}

/** 伪造 dsh-tools：register(tool) 捕获工具，重复名替换（真实 dsh 不抛）。 */
function makeTools(state) {
  return {
    register(tool) {
      const stored = { name: tool.name, tool };
      state.tools.push(stored);
      return () => {
        const i = state.tools.indexOf(stored);
        if (i >= 0) state.tools.splice(i, 1);
      };
    },
  };
}

function makeLoggerService(logs) {
  return {
    info(msg, meta) { logs.push({ level: 'info', msg, meta }); },
    warn(msg, meta) { logs.push({ level: 'warn', msg, meta }); },
    error(msg, meta) { logs.push({ level: 'error', msg, meta }); },
  };
}

// 每个场景共享同一份"宿主状态"，模拟同一个 dsh 进程内的多次 apply / 重载
const state = { routes: [], tools: [] };

// ===== 按 dsh-host-webserver 的 match() 语义挂真实 HTTP 服务 =====
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://x').pathname;
  const exact = state.routes.find((r) => r.kind === 'exact' && r.path === pathname);
  const prefix = state.routes
    .filter((r) => r.kind === 'prefix' && (pathname === r.path || pathname.startsWith(r.path + '/')))
    .sort((a, b) => b.path.length - a.path.length)[0];
  const route = exact ?? prefix;
  if (!route) { res.statusCode = 404; res.end('not found'); return; }   // 无匹配 → dsh fallback/404
  try {
    Promise.resolve(route.handler(req, res)).catch((e) => {
      try { res.statusCode = 500; res.end(String(e?.message ?? e)); } catch {}
    });
  } catch (e) {
    res.statusCode = 500; res.end(String(e?.message ?? e));
  }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const reqJson = async (method, p, body) => {
  const r = await fetch(base + p, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

// ===== 加载宿主 bundle =====
const mod = await import('file:///D:/workspace/pluginspace/dag-flow/dist/index.js');
t('dist/index.js 导出 apply / name / inject', typeof mod.apply === 'function' && mod.name === 'dag-flow' && Array.isArray(mod.inject));
t('inject 必须声明 webServer + tools + workspaceRegistry + llm（apply 等服务就绪）',
  mod.inject.includes('webServer') && mod.inject.includes('tools') && mod.inject.includes('workspaceRegistry') && mod.inject.includes('llm') && mod.inject.length === 4,
  JSON.stringify(mod.inject));

const EXPECTED = [
  'exact /api/dag-flow/nodes',
  'exact /api/dag-flow/ai-generate',
  'exact /api/dag-flow/runs',
  'exact /api/dag-flow/run',
  'exact /api/dag-flow/run/status',
  'exact /api/dag-flow/run/resume',
  'exact /api/dag-flow/run-node',
  'exact /api/dag-flow/open-folder',
  'exact /api/dag-flow/workflows',
  'prefix /api/dag-flow/workflows',
  'exact /api/dag-flow/workflows/save',
  'exact /api/dag-flow/models',
  'exact /api/dag-flow/test-image-api',
  'exact /api/dag-flow/sessions',
  'prefix /api/dag-flow/sessions',
  // ★ 2026-10-03 定时任务轮：+4 条（/schedules 列表、/schedules/save 写入、/schedules/delete 删除、/schedules/run 立即运行）
  'exact /api/dag-flow/schedules',
  'exact /api/dag-flow/schedules/save',
  'exact /api/dag-flow/schedules/delete',
  'exact /api/dag-flow/schedules/run',
  // ★ 2026-10-04 自检轮 1/2：+1 条（/selfcheck 只自检不执行；点运行 → 自检中 → 通过后人工确认才 /run）
  'exact /api/dag-flow/selfcheck',
  // ★ 2026-10-04 运行日志：+1 条（GET /run/log 按工作流名查在跑/最近一次完成的日志）
  'exact /api/dag-flow/run/log',
];
const routeKeys = () => state.routes.map((r) => `${r.kind} ${r.path}`).sort();

// ===== 场景 1：dsh 0.2.0 Proxy ctx（inject 校验开启）=====
console.log('\n[1] dsh 0.2.0 Proxy ctx（裸属性访问抛 inject 错）');
let s1 = null;   // 场景 2 要拿它的 effect disposer 模拟 fiber 卸载
{
  const logs = [];
  const { ctx, effects } = makeProxyCtx({
    tools: makeTools(state),
    webServer: makeWebServer(state),
    fs: { resolve: (p) => p },
    logger: makeLoggerService(logs),
    workspace: { cwd: WS },
    // llm（2026-10-02）：host llm 服务桩——自带模型发现走 ctx.llm.listProviders/listModels
    llm: { listProviders: () => [], listModels: async () => [] },
  });

  // 先证明伪造的 ctx 真的复刻了 0.2.0 的 inject 语义
  let bareErr = null;
  try { void ctx.webServer; } catch (e) { bareErr = e; }
  t('伪造 ctx 裸访问 ctx.webServer 抛 inject 错（复刻 0.2.0）', /without inject/.test(String(bareErr?.message ?? '')));
  t('伪造 ctx 裸访问 ctx.tools 抛 inject 错', (() => { try { void ctx.tools; return false; } catch { return true; } })());

  mod.apply(ctx);   // 真实 DSH loader 的调用点
  s1 = { ctx, effects, logs };

  t('apply(ctx) 注册 21 条路由（15 条既有 + 4 条定时任务 + 1 条自检 + 1 条运行日志；无一条静默失败）', state.routes.length === 21, `routes=${state.routes.length} ${routeKeys().join(' | ')}`);
  t('路由清单与源码一致', JSON.stringify(routeKeys()) === JSON.stringify([...EXPECTED].sort()), routeKeys().join(' | '));
  t('workflow 工具注册成功', state.tools.length === 1 && state.tools[0].name === 'workflow', JSON.stringify(state.tools.map((x) => x.name)));

  const drift = mod.getDriftReport();
  const core = ['tools.register', 'webServer.register', 'fs.resolve', 'effect'];
  t('核心能力探测全部通过（drift 不含 tools/webServer/fs/effect）', core.every((c) => !drift.drifted.includes(c)), JSON.stringify(drift.drifted));
  t('safeMode = false（不再被 inject 误判拖入安全模式）', mod.isSafeMode() === false && drift.safeMode === false);
  t('getDriftReport().details 无核心能力条目', core.every((c) => drift.details[c] === undefined), JSON.stringify(drift.details));

  t('三条 effect 已挂载（工具 + 路由 + 定时调度器 disposer）', effects.length === 3, JSON.stringify(effects.map((e) => e.label)));
  t('effect 标签可辨识', effects.some((e) => /tool/i.test(e.label ?? '')) && effects.some((e) => /api/i.test(e.label ?? '')) && effects.some((e) => /schedul/i.test(e.label ?? '')), JSON.stringify(effects.map((e) => e.label)));

  const infoLine = logs.filter((l) => l.level === 'info').map((l) => String(l.msg)).find((m) => m.includes('[dag-flow] loaded')) ?? '';
  t('加载日志同时报告 tool / api 的注册结果', /workflow tool registered/.test(infoLine) && /api registered/.test(infoLine), infoLine);
  t('加载日志不再声称 safe mode', !/safe mode active/.test(infoLine), infoLine);

  // 文件日志（工作区 .dag-flow/logs/）——修复前这条证据完全缺失
  await sleep(400);
  const logDir = join(WS, '.dag-flow', 'logs');
  const logFiles = existsSync(logDir) ? readdirSync(logDir).filter((f) => f.endsWith('.log')) : [];
  t('dag-flow 自己的文件日志已落盘', logFiles.length === 1, logFiles.join(','));
  const logText = logFiles.length ? readFileSync(join(logDir, logFiles[0]), 'utf8') : '';
  t('文件日志含路由注册条数与 loaded 行', /API routes registered: 21/.test(logText) && /\[dag-flow\] loaded/.test(logText), logText.slice(-300));

  // 存储根来自 host-ctx（ctx.get('workspace').cwd），全部写入临时工作区
  t('storage 根解析为宿主工作区（host-ctx）', existsSync(join(WS, '.dag-flow', 'workflow')), join(WS, '.dag-flow'));

  // ===== 复现 UI 的「新建工作流」请求 =====
  const save = await reqJson('POST', '/api/dag-flow/workflows/save', {
    name: 'test-folw',
    def: { name: 'test-folw', version: 1, nodes: [{ id: 'start', type: 'start', next: 'end' }, { id: 'end', type: 'end' }] },
  });
  t('POST /workflows/save → 200（修复前此处 404 not found）', save.status === 200, `${save.status} ${JSON.stringify(save.body)}`);
  t('响应 { ok:true, name:"test-folw" }', save.body?.ok === true && save.body?.name === 'test-folw', JSON.stringify(save.body));
  t('工作流 JSON 已落盘', existsSync(join(WS, '.dag-flow', 'workflow', 'test-folw.json')));

  const list = await reqJson('GET', '/api/dag-flow/workflows');
  t('GET /workflows → 200 且列出 test-folw', list.status === 200 && (list.body?.workflows ?? []).some((w) => w.name === 'test-folw'), JSON.stringify(list.body)?.slice(0, 200));
  const one = await reqJson('GET', '/api/dag-flow/workflows/test-folw');
  t('GET /workflows/test-folw（prefix 路由）→ 200 且返回工作流本体', one.status === 200 && one.body?.workflow?.name === 'test-folw', `${one.status} ${JSON.stringify(one.body)?.slice(0, 160)}`);
  const nodes = await reqJson('GET', '/api/dag-flow/nodes');
  const nodeList = nodes.body?.nodes ?? [];
  t('GET /nodes → 200 且列出内置节点类型', nodes.status === 200 && nodeList.length >= 13 && ['start', 'end', 'subagent', 'web_search'].every((n) => nodeList.includes(n)), `${nodes.status} n=${nodeList.length}`);
  const miss = await reqJson('GET', '/api/dag-flow/nope');
  t('未注册路径仍 404（不吞掉 fallback 语义）', miss.status === 404, String(miss.status));
}

// ===== 场景 2：live patchReload —— 卸载后重载不得出现 duplicate 路由 =====
console.log('\n[2] 热重载（patchReload:"live"）：先注销再重载');
{
  const logs = [];
  // cordis 卸载 fiber 时按注册逆序执行 effect 返回的 disposer
  for (const e of [...s1.effects].reverse()) if (e.dispose) e.dispose();
  t('旧 fiber 卸载后路由全部注销', state.routes.length === 0, `routes=${state.routes.length}`);
  t('旧 fiber 卸载后工具注销', state.tools.length === 0, `tools=${state.tools.length}`);

  // 第二次 apply 用同一份 ctx（同一 dsh 进程内的重载）
  const { ctx: ctx2, effects: effects2 } = makeProxyCtx({
    tools: makeTools(state),
    webServer: makeWebServer(state),
    fs: { resolve: (p) => p },
    logger: makeLoggerService(logs),
    workspace: { cwd: WS },
  });
  mod.apply(ctx2);
  const warnDup = logs.filter((l) => /duplicate|注册失败/.test(String(l.msg)));
  t('重载后 21 条路由全部重新注册', state.routes.length === 21, `routes=${state.routes.length}`);
  t('重载后无 duplicate / 注册失败告警', warnDup.length === 0, JSON.stringify(warnDup.map((l) => l.msg)));
  t('重载后 workflow 工具仍只有 1 个', state.tools.length === 1, `tools=${state.tools.length}`);
  t('重载后新 fiber 挂载 3 条 effect', effects2.length === 3, JSON.stringify(effects2.map((e) => e.label)));

  // 卸载新 fiber，恢复干净状态
  for (const e of [...effects2].reverse()) if (e.dispose) e.dispose();
  t('再次卸载后回到 0 路由', state.routes.length === 0);
}

// ===== 场景 3：能力降级 —— 有 tools 无 webServer =====
console.log('\n[3] 降级：宿主只有 tools，没有 webServer');
{
  const logs = [];
  const { ctx } = makeProxyCtx({
    tools: makeTools(state),
    fs: { resolve: (p) => p },
    logger: makeLoggerService(logs),
    workspace: { cwd: WS },
  });
  mod.apply(ctx);
  const infoLine = logs.map((l) => String(l.msg)).find((m) => m.includes('[dag-flow] loaded')) ?? '';
  t('webServer 缺失时 /workflow 工具仍注册（按能力解耦）', state.tools.length === 1, `tools=${state.tools.length}`);
  t('路由被跳过且原因可读', state.routes.length === 0 && /api skipped \(webServer\.register 不可用\)/.test(infoLine), infoLine);
  t('webServer.register 出现在 drift 中', (mod.getDriftReport()?.drifted ?? []).includes('webServer.register'));
  t('tools.register 未误报 drift', !(mod.getDriftReport()?.drifted ?? []).includes('tools.register'));
  t('仅 tools 漂移时不进安全模式（safeMode 只看 tools+effect）', mod.isSafeMode() === false);
  for (const x of state.tools.splice(0)) { /* 清理 */ void x; }
}

// ===== 场景 4：旧宿主（0.1.x 普通对象 ctx，无 ctx.get / ctx.effect）=====
console.log('\n[4] 旧宿主兼容：普通对象 ctx（无 get / effect）');
{
  const logs = [];
  const legacyCtx = {
    tools: makeTools(state),
    webServer: makeWebServer(state),
    fs: { resolve: (p) => p },
    logger: makeLoggerService(logs),
    workspace: { cwd: WS },
  };
  mod.apply(legacyCtx);
  t('旧宿主仍注册 21 条路由（属性访问兜底）', state.routes.length === 21, `routes=${state.routes.length}`);
  t('旧宿主仍注册 workflow 工具', state.tools.length === 1, `tools=${state.tools.length}`);
  t('无 ctx.effect 时不抛错（disposer 无处挂，降级为不注销）', true);
  const infoLine = logs.map((l) => String(l.msg)).find((m) => m.includes('[dag-flow] loaded')) ?? '';
  t('旧宿主加载日志报告全部 registered', /workflow tool registered/.test(infoLine) && /api registered/.test(infoLine), infoLine);
  for (const r of state.routes.splice(0)) { void r; }
  for (const x of state.tools.splice(0)) { void x; }
}

// ===== 场景 5：宿主彻底不可用（无 tools / 无 webServer）=====
console.log('\n[5] 极端降级：空 ctx');
{
  const logs = [];
  const { ctx } = makeProxyCtx({ logger: makeLoggerService(logs), workspace: { cwd: WS } });
  let threw = null;
  try { mod.apply(ctx); } catch (e) { threw = e; }
  t('apply 绝不抛错（fail-soft）', threw === null, String(threw?.message ?? ''));
  t('无宿主能力时 0 路由 0 工具', state.routes.length === 0 && state.tools.length === 0);
  const infoLine = logs.map((l) => String(l.msg)).find((m) => m.includes('[dag-flow] loaded')) ?? '';
  t('两个能力各自报告 skipped 原因', /workflow tool skipped \(tools\.register 不可用/.test(infoLine) && /api skipped \(webServer\.register 不可用\)/.test(infoLine), infoLine);
  t('空 ctx 下 safeMode = true（核心能力缺失）', mod.isSafeMode() === true);
}

server.close();
console.log(`\n=== apply-host: ${pass} passed, ${fail} failed ===`);
if (fail > 0) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
