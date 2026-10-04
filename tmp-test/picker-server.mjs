// tmp-test/picker-server.mjs — picker/画布 CDP 测试的本地 fixture 服务器
// 提供：复刻页/测试页静态文件 + 工作流列表/读取/保存/删除 + 版本快照语义（与 adapter/storage.ts 对齐）
// 快照语义（2026-10-01 夜）：POST save { name, def, snapshot } —— snapshot!==false 且「本次内容」
// 与最新版本不同 → 存档为新版本（保留 20 份）。自动保存传 snapshot:false 不生成版本。
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const port = 34177;
const root = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const SEED = ['日报生成', '每周汇总', '数据清洗', '图片批处理', '内容翻译', '会议纪要', '代码审查', '竞品周报', '用户访谈', '发布清单', '复盘记录', '灵感收集'];
let names = [...SEED];                       // 列表页种子（picker 复刻测试用）
const defs = new Map();                      // name -> def（保存后的内容）

// /run stub 的假输出：形状对齐各节点的真实 out —— 变量面板「按真实运行输出反推字段」的 CDP 断言要用它
//（loop 的 count=7 是刻意哨兵值，与夹具里配的 3/50 无关，供「· 循环 N 次」徽标断言）
function stubOut(n) {
  switch (n.type) {
    case 'web_search':
      return {
        query: n.params?.query ?? 'q', engine: 'bing', viaHost: false, count: 2,
        results: [
          { title: '标题一', url: 'https://example.com/a', snippet: '摘要一' },
          { title: '标题二', url: 'https://example.com/b', snippet: '摘要二' },
        ],
      };
    case 'set_var': return { ...(n.params?.vars ?? {}) };
    case 'python': case 'bash': case 'subagent': case 'log': return `STUB_${n.type}_OUT`;
    case 'http': return { status: 200, body: { ok: true, count: 2 } };
    case 'loop': return { count: 7, items: [{ a: 1 }] };
    case 'switch': return { matched: 'quick', target: 'log_mode' };
    case 'if': return true;
    case 'file_save': return { path: 'out.txt', relativePath: 'out.txt', absolutePath: 'D:/tmp/out.txt', bytes: 12, source: 'text', preview: 'hi' };
    case 'manual': return { prompt: '（stub）继续？', confirmed: true, value: 'v', autoPassed: false };
    case 'end': return { ok: true, summary: 'done' };
    case 'start': return { mode: 'quick' };
    default: return { stub: n.type };
  }
}
const versions = new Map();                  // name -> [{ ts, workflow }] 新→旧
// 人工确认（2026-10-03）：def 含 manual 节点 → 202 awaiting；/run/status 与 /run/resume 查这张表。
// ★ 必须模块级——放进 createServer 回调里会每请求重建，resume 永远 404。
const MANUAL_STUB_PROMPT = '请核对【技术简报】正文与配图是否符合要求。';
let stubRunId = 0;
const awaitingRuns = new Map();              // runId -> { name, nodeId }
// ★ 慢速运行模式（2026-10-03 新增，供 CDP 观测「待运行/运行中/依次点亮」）：
//   POST /__run-mode {mode:'slow'} 打开 → /run 分阶段推进、立刻返回（不 hold），
//   /run/status?name=<工作流名> 返回逐节点进度（对齐 host ActiveRun 的 results + running）。
let runMode = 'fast';
let slowRun = null;                          // { name, ids, stage }
let hostRun = null;                          // { name, ids, stage } —— 宿主侧（定时）触发的运行模拟
const SLOW_STEP_MS = 500;
// /models stub 的返回模式（2026-10-03 模型显示名回归锁）：'empty'（默认，= 老行为 404 → 空列表）| 'name'
let modelsMode = 'empty';
// ===== ⏰ 定时任务弹窗 stub 状态（2026-10-04 CDP 用例 test-schedule-dialog）=====
// 内存态、跨请求保持；测试用**唯一工作流名**隔离，所以不需要持久化。
// schedLog = 诊断口（GET /__sched-log）：按发生顺序记下每次 save/delete/run 的要点（cron/enabled/id），
// 供用例断言「本地非法 cron 根本没发请求」「开关保存的值正确」。
let schedItems = [];
const schedLog = [];
/** ★ 运行日志 stub（2026-10-04，CDP 用）：最近一次 POST /run 的逐节点日志，GET /run/log 返回它 */
let lastRunLog = null;
// ★ 自检控制口（2026-10-04 轮 1/2，CDP 用）：POST /__selfcheck-block { on, delayMs?, payload? }
//   设置后：`/api/dag-flow/selfcheck` 返回该 payload（可延迟 delayMs 毫秒，用于断言「自检中…」状态），
//   且 errorCount>0 时 `/api/dag-flow/run` 返回 409 { blocked:true, selfcheck }（不带 skipSelfcheck 时）。
let selfcheckPayload = null;
let selfcheckDelayMs = 0;
const SCHED_TICK_MS = 20000;
const STATIC = new Set(['/picker-replica.html', '/picker-test.js', '/grab-test.html', '/grab-test.js', '/grab-test.css', '/dom-debug.html', '/cdp-host.html']);

const seedNodes = (n) => 2 + (SEED.indexOf(n) % 7);
const snapshotDef = (name, def) => {
  const list = versions.get(name) ?? [];
  const nextStr = JSON.stringify(def);
  if (list.length && JSON.stringify(list[0].workflow) === nextStr) return; // 与最新版本相同 → 去重
  const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
  list.unshift({ ts, workflow: def });
  if (list.length > 20) list.length = 20;
  versions.set(name, list);
};

createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const json = (obj, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
  if (STATIC.has(u.pathname)) {
    res.setHeader('content-type', u.pathname.endsWith('.html') ? 'text/html; charset=utf-8'
      : u.pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8');
    res.end(readFileSync(join(root, u.pathname.slice(1))));
    return;
  }
  // /api/dag-flow/models stub —— 默认返回空列表（= 老行为：没 stub 时 fetch 404 → 客户端 models=[]），
  // 由测试用 POST /__models-mode 切换成 'name' 模式，返回带 label（模型显示名）的条目。
  if (u.pathname === '/api/dag-flow/models') {
    if (modelsMode !== 'name') { json({ models: [] }); return; }
    json({
      models: [
        // ① 显示名与内部 id 完全不同（断言「下拉里出现显示名、不出现 llm: 内部串」）
        { id: 'dsh:llm:probe-provider:probe-flash', name: 'llm:probe-provider:probe-flash', model: 'probe-flash', label: 'Probe-V41-Flash', providerLabel: '探针提供方', kind: 'dsh', input: ['text', 'image'], hasImage: true },
        // ② 与 ① 同显示名 → 必须补提供方名消歧
        { id: 'dsh:llm:other-provider:probe-flash', name: 'llm:other-provider:probe-flash', model: 'probe-flash', label: 'Probe-V41-Flash', providerLabel: '另一家', kind: 'dsh', input: ['text'], hasImage: false },
        // ③ 宿主没给显示名（settings 直读源）→ 回退 model id，不得显示成 llm:provider:model
        { id: 'dsh:custom-model:glm-x', name: 'custom-model:glm-x', model: 'glm-x', kind: 'dsh', input: ['text'], hasImage: false },
      ],
    });
    return;
  }
  // 测试控制口：运行模式（'fast' 默认 | 'slow' 分阶段推进，供 CDP 看中间状态）
  if (u.pathname === '/__run-mode' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try { const j = JSON.parse(body || '{}'); runMode = j.mode === 'slow' ? 'slow' : 'fast'; slowRun = null; json({ ok: true, mode: runMode }); }
      catch { res.writeHead(400); res.end('bad json'); }
    });
    return;
  }
  // ★ 自检控制口（2026-10-04 轮 1/2，CDP 用）：POST /__selfcheck-block { on, delayMs?, payload? }
  if (u.pathname === '/__selfcheck-block' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const p = JSON.parse(body || '{}');
        selfcheckDelayMs = Number(p.delayMs ?? 0) || 0;
        selfcheckPayload = p.on
          ? (p.payload ?? {
            ok: false, errorCount: 2, warnCount: 0, stats: { nodes: 2, edges: 1 },
            items: [
              { level: 'error', code: 'REF_UNKNOWN', nodeId: 'end', message: '节点「结束」的参数里引用了不存在的节点 "ghost"（{{ghost.out…}}）', fix: '把引用改成实际存在的上游节点：选中该节点，右侧面板「🔗 上游变量」里点一下就复制到正确引用。' },
              { level: 'error', code: 'CYCLE', message: '工作流存在环路：a → b → a', fix: '断开环上的那条回边；要"失败后重试"请用 loop 节点的「循环体=子工作流」。' },
            ],
          })
          : null;
        json({ ok: true, on: !!selfcheckPayload, delayMs: selfcheckDelayMs });
      } catch { res.writeHead(400); res.end('bad json'); }
    });
    return;
  }
  // ★ 运行前自检 stub（2026-10-04 轮 2）：只自检不执行；默认返回"通过"
  if (u.pathname === '/api/dag-flow/selfcheck' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let def = {};
      try { def = JSON.parse(body || '{}').def ?? {}; } catch { /* */ }
      const pass = {
        ok: true, errorCount: 0, warnCount: 0, items: [],
        stats: { nodes: (def.nodes ?? []).length, edges: (def.edges ?? []).length },
      };
      const out = selfcheckPayload
        ? { ...selfcheckPayload, stats: selfcheckPayload.stats ?? pass.stats }
        : pass;
      if (selfcheckDelayMs > 0) setTimeout(() => json(out), selfcheckDelayMs);
      else json(out);
    });
    return;
  }
  // 测试控制口：设置 /models 的返回模式（'empty' 默认 | 'name'）
  if (u.pathname === '/__models-mode' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try { const j = JSON.parse(body || '{}'); modelsMode = j.mode === 'name' ? 'name' : 'empty'; json({ ok: true, mode: modelsMode }); }
      catch { res.writeHead(400); res.end('bad json'); }
    });
    return;
  }
  // 测试控制口：定时任务请求日志（按发生顺序；断言「本地非法 cron 没发请求」用）
  if (u.pathname === '/__sched-log') { json({ log: schedLog }); return; }
  // 测试控制口：模拟「宿主侧（定时）触发的运行」——POST {name, ids, stage}；stage 到位数即结束（completed）。
  //   客户端没点过 ▶，所以能不能在画布上看到状态，全靠后台监视器轮询 /run/status?name=。
  if (u.pathname === '/__host-run' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const j = JSON.parse(body || '{}');
        if (j.clear) { hostRun = null; json({ ok: true, cleared: true }); return; }
        hostRun = {
          name: String(j.name ?? ''),
          ids: Array.isArray(j.ids) ? j.ids.map(String) : [],
          stage: Number(j.stage ?? 0) || 0,
          // 逐节点自定义 out（用于模拟「manual 节点在非交互运行里自动通过」等形状）
          outs: (j.outs && typeof j.outs === 'object') ? j.outs : {},
        };
        json({ ok: true, hostRun });
      } catch { res.writeHead(400); res.end('bad json'); }
    });
    return;
  }
  // 测试控制口：把 nextRunAt 固定成给定值。★真实产品的 nextRunAt 由宿主 cron.ts 计算，夹具这里只是占位
  //   （默认 now+20s）；截图/断言需要「像真的一样」的下次时间时用它，例如把 cron.ts 算出来的周一 09:00 灌进来。
  if (u.pathname === '/__sched-preset' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const j = JSON.parse(body || '{}');
        schedItems = schedItems.map((it) => ({ ...it, nextRunAt: j.nextRunAt ?? it.nextRunAt }));
        json({ ok: true, items: schedItems });
      } catch { res.writeHead(400); res.end('bad json'); }
    });
    return;
  }
  // ===== 定时任务 stub（2026-10-04：⏰ 定时任务弹窗 CDP 用例）=====
  // 列表：支持 ?workflow= 过滤；每条带 nextRunAt（未来时间即可），有 lastRun 时原样带出。
  if (u.pathname === '/api/dag-flow/schedules') {
    const workflow = u.searchParams.get('workflow') ?? '';
    json({
      items: schedItems
        .filter((it) => !workflow || it.workflow === workflow)
        .map((it) => ({ ...it, nextRunAt: it.nextRunAt ?? new Date(Date.now() + SCHED_TICK_MS).toISOString() })),
      dir: '<stub>/.dag-flow/schedules.json',
      scheduler: { running: true, lastTickAt: new Date().toISOString(), ticks: 3, tickMs: SCHED_TICK_MS },
    });
    return;
  }
  // 保存（新增/更新一条）：body 带 id → 更新；不带 → 新建（sch_ + 4 位随机）。请求**先**记进诊断口。
  if (u.pathname === '/api/dag-flow/schedules/save' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const b = JSON.parse(body || '{}');
        schedLog.push({ op: 'save', id: b.id ?? null, workflow: b.workflow ?? null, cron: b.cron ?? null, enabled: b.enabled });
        const idx = b.id ? schedItems.findIndex((it) => it.id === b.id) : -1;
        const base = idx >= 0 ? schedItems[idx] : { id: 'sch_' + Math.random().toString(36).slice(2, 6), createdAt: new Date().toISOString() };
        const next = {
          ...base, workflow: b.workflow, cron: String(b.cron ?? ''), enabled: b.enabled !== false,
          inputs: b.inputs, nextRunAt: new Date(Date.now() + SCHED_TICK_MS).toISOString(),
        };
        if (idx >= 0) schedItems[idx] = next; else schedItems.push(next);
        json({ ok: true, item: next });
      } catch { res.writeHead(400); res.end('bad json'); }
    });
    return;
  }
  // 删除：按 id 删；找不到也算成功（用例只断言「列表里没了 + log 里有 delete」）
  if (u.pathname === '/api/dag-flow/schedules/delete' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const { id } = JSON.parse(body || '{}');
        schedLog.push({ op: 'delete', id: id ?? null });
        schedItems = schedItems.filter((it) => it.id !== id);
        json({ ok: true });
      } catch { res.writeHead(400); res.end('bad json'); }
    });
    return;
  }
  // 立即运行一次：把该条 lastRun 置成一次成功运行（4100ms → 面板「✓ 成功（4.1s）」）
  if (u.pathname === '/api/dag-flow/schedules/run' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const { id } = JSON.parse(body || '{}');
        schedLog.push({ op: 'run', id: id ?? null });
        const it = schedItems.find((x) => x.id === id);
        if (!it) { json({ error: '该定时项不存在' }, 404); return; }
        it.lastRun = { at: new Date().toISOString(), status: 'success', durationMs: 4100, runId: 'run-stub-sched' };
        json({ ok: true, item: it });
      } catch { res.writeHead(400); res.end('bad json'); }
    });
    return;
  }
  if (u.pathname === '/api/dag-flow/workflows') {
    const all = [...new Set([...names, ...defs.keys()])];
    // path 字段对齐真实接口（2026-10-03 用户需求：下拉里名称后置灰显示所在路径）
    const dir = 'D:\\workspace\\pluginspace\\.dag-flow\\workflow';
    json({
      workflows: all.map((n) => ({
        name: n,
        nodes: defs.has(n) ? (defs.get(n).nodes?.length ?? 0) : seedNodes(n),
        path: `${dir}\\${n}.json`,
      })),
      storage: { dir, source: 'workspace' },
    });
    return;
  }
  // save 路由必须在按名匹配之前（否则会被下面的正则当名字 'save' 吃掉）
  if (u.pathname === '/api/dag-flow/workflows/save' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const { name, def, snapshot } = JSON.parse(body);
        if (snapshot !== false) snapshotDef(name, def);
        defs.set(name, def);
        if (!names.includes(name)) names.push(name);
        json({ ok: true, name });
      } catch { res.writeHead(400); res.end('bad json'); }
    });
    return;
  }
  // fixture 断言报告落盘（POST 文本 → report.txt，兼容旧 grab-test.html 内嵌断言）
  if (u.pathname === '/report' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      writeFileSync(join(root, 'report.txt'), body);
      res.writeHead(200); res.end('ok');
    });
    return;
  }
  // ★ 运行日志 stub（2026-10-04 CDP 用）：按工作流名返回最近一次的逐节点日志
  if (u.pathname === '/api/dag-flow/run/log') {
    const byName = u.searchParams.get('name') ?? '';
    const onlyNode = u.searchParams.get('node') ?? '';
    if (!lastRunLog || (byName && lastRunLog.name !== byName)) { json({ error: '查无运行日志——先运行一次这个工作流' }, 404); return; }
    let entries = lastRunLog.entries;
    if (onlyNode) entries = entries.filter((e) => e.id === onlyNode);
    json({
      ok: true, runId: lastRunLog.runId, workflowName: lastRunLog.name, runStatus: 'completed',
      live: false, finishedAt: Date.now(), nodeCount: entries.length, entries,
    });
    return;
  }
  // /api/dag-flow/run stub —— 验证运行按钮链路（POST {def} → {ok, summary}，结构对齐 adapter/api.ts）
  // ★ 2026-10-03：def 里含 manual 节点 → 返回 202 awaiting（对齐 host 的真实「人工确认挂起」语义）
  if (u.pathname === '/api/dag-flow/run' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const { def, skipSelfcheck } = JSON.parse(body);
        if (!def) { json({ error: '缺少 def（工作流定义）' }, 400); return; }
        // ★ 运行前自检拦截（2026-10-04 轮 1/2，CDP 用）：控制口设了"有问题"的 payload 时，
        //   不带 skipSelfcheck 的 /run 返回 409 { blocked, selfcheck }（模拟宿主 /run 里那道兜底自检）。
        if (selfcheckPayload && Number(selfcheckPayload.errorCount ?? 0) > 0 && !skipSelfcheck) {
          json({ blocked: true, selfcheck: selfcheckPayload }, 409);
          return;
        }
        const results = {};
        for (const n of (def.nodes ?? [])) {
          results[n.id] = { status: 'success', durationMs: 1, out: stubOut(n) };
        }
        const manual = (def.nodes ?? []).find((n) => n.type === 'manual');
        // ★ 慢速模式（CDP 用）：逐节点推进，先返回「运行中」进度，最后才给完整 summary
        if (runMode === 'slow' && !manual) {
          const ids = (def.nodes ?? []).map((n) => n.id);
          slowRun = { name: def.name, ids, stage: 0, def };
          const acc = {};
          ids.forEach((id, i) => {
            setTimeout(() => {
              if (!slowRun || slowRun.name !== def.name) return;
              acc[id] = { status: 'success', durationMs: 20, out: stubOut((def.nodes ?? []).find((n) => n.id === id)) };
              slowRun.stage = i + 1;
            }, SLOW_STEP_MS * (i + 1));
          });
          setTimeout(() => {
            const done = { ok: true, summary: { status: 'success', totalDurationMs: SLOW_STEP_MS * ids.length, results: acc } };
            slowRun = null;
            json(done);
          }, SLOW_STEP_MS * (ids.length + 1));
          return;
        }
        if (manual) {
          const runId = `run-stub-manual-${++stubRunId}`;
          awaitingRuns.set(runId, { name: def.name, nodeId: manual.id });
          json({ ok: true, status: 'awaiting', runId, workflowName: def.name, awaiting: { nodeId: manual.id, prompt: MANUAL_STUB_PROMPT } }, 202);
          return;
        }
        json({ ok: true, summary: { status: 'success', totalDurationMs: 5, results } });
        // ★ 运行日志 stub（2026-10-04 CDP 用）：每个节点造一条「原始参数（含 {{}}）→ 实际入参 → 引用上游 → 出参」
        lastRunLog = {
          name: def.name, runId: 'run-stub-log',
          entries: (def.nodes ?? []).map((n, i) => ({
            id: n.id, type: n.type, status: 'success', durationMs: 11 + i,
            rawParams: { code: 'print("{{start.out}}")', level: 'info' },
            params: { code: 'print("ok")', level: 'info' },
            refs: i === 0 ? { nodeRefs: [], varsUsed: [], inputsUsed: [] } : { nodeRefs: ['start'], varsUsed: ['loopIndex'], inputsUsed: [] },
            out: stubOut(n),
          })),
        };
      } catch { res.writeHead(400); res.end('bad json'); }
    });
    return;
  }
  if (u.pathname === '/api/dag-flow/run' && req.method === 'DELETE') {
    const name = u.searchParams.get('name') ?? '';
    for (const [id, r] of [...awaitingRuns]) if (r.name === name) awaitingRuns.delete(id);
    json({ ok: true, cancelled: name });
    return;
  }
  // /run/status：等待中 → awaiting；已被 DELETE 取消 → completed(failed)
  if (u.pathname === '/api/dag-flow/run/status') {
    const runId = u.searchParams.get('runId') ?? '';
    const byName = u.searchParams.get('name') ?? '';
    // ★ 宿主侧（定时）触发的运行模拟（2026-10-03 用户反馈「定时任务执行，工作流的状态不会变化」）：
    //   由 POST /__host-run 控制，客户端**没点过 ▶** 也能在这里查到运行态 —— 正是后台监视器要覆盖的场景。
    if (hostRun && byName && hostRun.name === byName) {
      const results = {};
      for (let i = 0; i < hostRun.stage && i < hostRun.ids.length; i++) {
        const id = hostRun.ids[i];
        results[id] = { status: 'success', durationMs: 12, out: (hostRun.outs ?? {})[id] ?? `HOST-RUN-${id}` };
      }
      const done = hostRun.stage >= hostRun.ids.length;
      json({
        runId: 'run-stub-host', workflowName: hostRun.name, origin: 'schedule',
        status: done ? 'completed' : 'running',
        results,
        running: done ? [] : [hostRun.ids[hostRun.stage]],
      });
      return;
    }
    // ★ 慢速运行：按工作流名回报「逐节点进度 + 正在执行的节点」（对齐 host 的 results/running）
    if (slowRun && byName && slowRun.name === byName) {
      const results = {};
      for (let i = 0; i < slowRun.stage && i < slowRun.ids.length; i++) {
        // ★ 逐节点带上 out（对齐宿主 2026-10-03 的新行为：节点一跑完就能在悬浮卡看到输出）
        results[slowRun.ids[i]] = {
          status: 'success', durationMs: 20,
          out: stubOut((slowRun.def?.nodes ?? []).find((n) => n.id === slowRun.ids[i])),
        };
      }
      const running = slowRun.stage < slowRun.ids.length ? [slowRun.ids[slowRun.stage]] : [];
      json({ runId: 'run-stub-slow', workflowName: slowRun.name, status: 'running', results, running });
      return;
    }
    const rec = awaitingRuns.get(runId);
    if (rec) {
      json({ runId, workflowName: rec.name, status: 'awaiting', awaiting: { nodeId: rec.nodeId, prompt: MANUAL_STUB_PROMPT }, results: {} });
      return;
    }
    if (String(runId).startsWith('run-stub-manual-')) {
      json({ runId, workflowName: '', status: 'completed', summary: { status: 'failed', totalDurationMs: 3, results: { [runId]: { status: 'failed', error: { code: 'MANUAL_CANCELLED', message: '人工确认未完成' } } }, error: { code: 'MANUAL_CANCELLED', message: '人工确认未完成：用户取消了等待中的人工确认' } } });
      return;
    }
    json({ error: '查无此运行' }, 404);
    return;
  }
  // /run/resume：唤醒挂起 → 返回完整 summary（对齐 host：该请求 hold 到跑完）
  if (u.pathname === '/api/dag-flow/run/resume' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const { runId, value } = JSON.parse(body);
        const rec = awaitingRuns.get(runId);
        if (!rec) { json({ error: '查无此运行' }, 404); return; }
        awaitingRuns.delete(runId);
        const results = { [rec.nodeId]: { status: 'success', durationMs: 1, out: { prompt: MANUAL_STUB_PROMPT, confirmed: true, value: value ?? '' } } };
        json({ ok: true, summary: { status: 'success', totalDurationMs: 6, results } });
      } catch { res.writeHead(400); res.end('bad json'); }
    });
    return;
  }
  // /api/dag-flow/run-node stub —— 单节点试跑链路验证（结构对齐 adapter/api.ts：summary.results.target）
  if (u.pathname === '/api/dag-flow/run-node' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const { nodeType } = JSON.parse(body);
        json({ ok: true, summary: { status: 'success', totalDurationMs: 5, results: { target: { status: 'success', durationMs: 5, out: `STUB_OUTPUT_${nodeType}` } } } });
      } catch { res.writeHead(400); res.end('bad json'); }
    });
    return;
  }
  const m = u.pathname.match(/^\/api\/dag-flow\/workflows\/(.+)$/);
  if (m) {
    const parts = m[1].split('/').map((s) => decodeURIComponent(s));
    const name = parts[0];
    if (parts[1] === 'versions') {
      const list = versions.get(name) ?? [];
      if (parts[2]) {
        const hit = list.find((v) => v.ts === parts[2]);
        if (!hit) { res.writeHead(404); res.end('not found'); return; }
        json({ workflow: hit.workflow });
        return;
      }
      json({ versions: list.map((v) => ({ ts: v.ts })), dir: 'C:\\工作区\\.dag-flow\\workflow' });
      return;
    }
    if (req.method === 'DELETE') {
      names = names.filter((n) => n !== name);
      defs.delete(name);
      versions.delete(name);
      res.writeHead(200); res.end();
      return;
    }
    if (defs.has(name)) { json({ workflow: defs.get(name) }); return; }
    if (names.includes(name)) {
      json({ workflow: { name, version: 1, nodes: [{ id: 'start', type: 'start', next: 'end' }, { id: 'end', type: 'end' }] } });
      return;
    }
    res.writeHead(404); res.end('not found');
    return;
  }
  res.writeHead(404); res.end();
}).listen(port, () => console.log('picker fixture listening on ' + port));
