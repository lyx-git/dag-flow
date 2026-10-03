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
const versions = new Map();                  // name -> [{ ts, workflow }] 新→旧
// 人工确认（2026-10-03）：def 含 manual 节点 → 202 awaiting；/run/status 与 /run/resume 查这张表。
// ★ 必须模块级——放进 createServer 回调里会每请求重建，resume 永远 404。
const MANUAL_STUB_PROMPT = '请核对【技术简报】正文与配图是否符合要求。';
let stubRunId = 0;
const awaitingRuns = new Map();              // runId -> { name, nodeId }
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
  // /api/dag-flow/run stub —— 验证运行按钮链路（POST {def} → {ok, summary}，结构对齐 adapter/api.ts）
  // ★ 2026-10-03：def 里含 manual 节点 → 返回 202 awaiting（对齐 host 的真实「人工确认挂起」语义）
  if (u.pathname === '/api/dag-flow/run' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const { def } = JSON.parse(body);
        if (!def) { json({ error: '缺少 def（工作流定义）' }, 400); return; }
        const results = {};
        for (const n of (def.nodes ?? [])) results[n.id] = { status: 'success', durationMs: 1 };
        const manual = (def.nodes ?? []).find((n) => n.type === 'manual');
        if (manual) {
          const runId = `run-stub-manual-${++stubRunId}`;
          awaitingRuns.set(runId, { name: def.name, nodeId: manual.id });
          json({ ok: true, status: 'awaiting', runId, workflowName: def.name, awaiting: { nodeId: manual.id, prompt: MANUAL_STUB_PROMPT } }, 202);
          return;
        }
        json({ ok: true, summary: { status: 'success', totalDurationMs: 5, results } });
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
