// src/adapter/api.ts — client 侧 HTTP API（dsh webServer 路由）
//
// dsh 0.1.2-rc.1 的 webServer.register 形态（dsh-image-vision 同款）：
//   ctx.webServer.register({ kind: 'exact', path, handler: async (req, res) => {...} })
//
// 暴露给 client（浏览器）的路由（exact 除非注明 prefix）：
//   GET  /api/dag-flow/nodes                 — 已注册节点列表
//   POST /api/dag-flow/ai-generate           — AI 生成工作流 JSON（支持 SSE 流式）
//   GET  /api/dag-flow/runs                  — 运行历史列表（?workflowName=）
//   POST /api/dag-flow/run                   — 运行工作流（同名互斥；卡在 manual 节点 → 202 awaiting）
//   GET  /api/dag-flow/run/status?runId=<id> — 查询运行状态（刷新/重挂面板后恢复等待态与节点结果）
//   POST /api/dag-flow/run/resume            — 人工确认 { runId, value } 唤醒挂起的 manual 节点
//   DELETE /api/dag-flow/run?name=<name>     — 取消运行中的工作流（含等待中的人工确认）
//   POST /api/dag-flow/run-node              — 单节点试跑（start→target→end 最小流程）
//   GET  /api/dag-flow/workflows             — 列出已保存工作流（含节点数与存储位置）
//   GET/DELETE /api/dag-flow/workflows/<name>            — 读取/删除（prefix）
//   GET  /api/dag-flow/workflows/<name>/versions[/<ts>]   — 版本列表/读取某版本（prefix）
//   POST /api/dag-flow/workflows/save        — 保存工作流
//   GET  /api/dag-flow/models                — 自动发现 dsh 已配置的模型（只读）
//   GET  /api/dag-flow/sessions              — 列出工作区会话
//   GET  /api/dag-flow/sessions/<id>         — 读取会话内容（prefix）
import { disabledApis } from './safety.js';
import { createHostRouteRegistrar } from '../dsh-gate/registrar.js';
import { createStorage } from './storage.js';
import { createLogger } from './logger.js';
import { dagFlowDir } from './workspace.js';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { normalizeWorkflowName } from '../name-rule.js';
import { WorkflowNodeRegistry } from '../registry/external.js';
import { checkWorkflowParams, formatParamProblems } from '../registry/params-check.js';
import { runWorkflow, type RunSummary } from '../executor/run.js';
import { newRunId, getAwaiting, resolveManual, rejectManual } from '../executor/awaiting.js';
import { callSubagent, callSubagentStream, listAllEndpoints } from './subagent.js';
import { listSessions, readSessionContent } from './sessions.js';
import type { WorkflowDef, JsonValue } from '../types.js';

const AI_SYSTEM_PROMPT = `你是一个工作流 JSON 生成器。
用户用自然语言描述需求，你必须只输出一个 JSON 对象，结构必须符合以下 schema：
{
  "name": string（工作流名，可用中文/字母/数字/连字符，如 "每日简报" 或 "daily-briefing"）,
  "version": 1,
  "description"?: string,
  "inputs"?: object（工作流级输入，节点参数里用 {{inputs.key}} 引用）,
  "nodes": [
    { "id": string, "type": string, "label"?: string, "params"?: object, "next"?: string | string[] | { true: string; false: string } | { [case值]: string } | null }
  ],
  "edges"?: [
    { "from": string, "to": string, "when"?: "true"|"false"|"always"|string（switch 的 case 值，'*' 为兜底分支） }
  ]
}
分支语义：if 节点 next 用 {true,false}；switch 节点 params.cases 为 {case值: 目标节点id}，next 用 {case值: 目标,...}（可含 "*"）；并行多分支用数组 next，合流用 merge 节点；节点失败策略用 onError: "stop"|"continue"|{goto}。
不要解释，不要 markdown 代码块，只输出 JSON。

【必填参数红线】每个节点的 params 必填字段必须完整，缺任何一个都会被直接拒绝：
- subagent: prompt + model（model 必填，只能用下方可用节点列表里给出的 dsh 模型 id）
- http: url；if: condition；switch: value + cases；log: message；manual: prompt
- set_var: vars（非空对象）；subflow: workflowName；file_save: filename
- python/bash: code；web_search: query；web_fetch: url；image_generate: prompt + baseURL；video_generate: submitUrl + pollUrl
宁可少生成一个节点，也不要生成缺必填参数的节点。`;

/** 拼接 13+ 节点的类型与参数 schema（让 AI 精确知道每个节点的参数），失败时静默降级 */
function buildSystemPrompt(): string {
  let doc = '';
  try {
    for (const d of WorkflowNodeRegistry.list()) {
      doc += `\n- type="${d.type}" params schema: ${JSON.stringify(d.schema ?? {}).slice(0, 400)}`;
    }
  } catch { /* 忽略 */ }
  return `${AI_SYSTEM_PROMPT}\n可用节点（type 与 params schema）如下，只能使用这些 type：\n${doc}`;
}

function sendJson(res: any, status: number, body: unknown): void {
  try {
    res.statusCode = status;
    res.setHeader?.('content-type', 'application/json');
    res.end?.(JSON.stringify(body));
  } catch (e) {
    try { res.end?.(JSON.stringify({ error: String((e as Error).message) })); } catch { /* */ }
  }
}

function readJsonBody(req: any): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on?.('data', (c: Buffer) => { buf += c.toString(); });
    req.on?.('end', () => {
      try { resolve(buf ? JSON.parse(buf) : {}); } catch (e) { reject(e); }
    });
    req.on?.('error', reject);
  });
}

function extractJson(text: string): unknown {
  const m = text.match(/\{[\s\S]*\}/);
  const json = m ? m[0] : text;
  return JSON.parse(json);
}

export function registerApiRoutes(): { registered: boolean; reason?: string; dispose?: () => void } {
  // 只按本能力自己的漂移判断（2026-10-01）：不再叠加 isSafeMode()——那会让 tools 的
  // 漂移连累路由注册，且未初始化时默认 true 会静默跳过全部路由（404 成因之一）。
  if (disabledApis().includes('webServer.register')) {
    return { registered: false, reason: 'webServer.register 不可用' };
  }
  // webServer 注册契约适配已收编防腐层（dsh-gate/registrar.ts）——dsh 升版改注册契约时只改那边。
  // 防腐层同时管理 disposer 列表：dsh webServer.register 返回 disposer，且重复注册同一
  // (kind,path) 会抛 webserver: duplicate ... route；profile 是 patchReload:"live"，
  // 插件热重载必须先注销旧路由（index.ts 把 dispose 挂到 ctx.effect）。
  const logger = createLogger();
  const reg = createHostRouteRegistrar(logger);
  if ('error' in reg) {
    return { registered: false, reason: reg.error };
  }
  const storage = createStorage();
  const dispose = (): void => reg.dispose();
  const route = (spec: { kind?: 'exact' | 'prefix'; path: string; handler: (req: any, res: any) => unknown }): void =>
    reg.register(spec);

  try {
    // 1. 节点列表
    route({
      kind: 'exact',
      path: '/api/dag-flow/nodes',
      handler: async (_req: any, res: any) => {
        sendJson(res, 200, { nodes: WorkflowNodeRegistry.list().map((d) => d.type) });
      },
    });

    // 2. AI 生成工作流（支持 SSE 流式：POST {prompt, stream:true}）
    route({
      kind: 'exact',
      path: '/api/dag-flow/ai-generate',
      handler: async (req: any, res: any) => {
        try {
          const body = (await readJsonBody(req)) as { prompt?: string; stream?: boolean };
          if (!body.prompt) { sendJson(res, 400, { error: '缺少 prompt' }); return; }
          const system = buildSystemPrompt();

          // SSE 流式：增量推送 delta，结束时推送完整校验后的 def
          if (body.stream === true) {
            try {
              res.writeHead?.(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
            } catch { res.setHeader?.('content-type', 'text/event-stream'); }
            let full = '';
            try {
              await callSubagentStream(
                { prompt: body.prompt, system, timeoutMs: 300_000 },
                (delta) => { try { res.write?.(`data: ${JSON.stringify({ delta })}\n\n`); } catch { /* */ } },
              );
              const parsed = extractJson(full) as { name?: unknown; nodes?: unknown; version?: unknown };
              if (!parsed || typeof parsed !== 'object' || typeof parsed.name !== 'string' || !Array.isArray(parsed.nodes) || parsed.nodes.length < 2) {
                res.write?.(`data: ${JSON.stringify({ done: true, ok: false, error: 'AI 输出结构不合法：需要 name(string) + nodes(array>=2)' })}\n\n`);
              } else {
                if (parsed.version === undefined) parsed.version = 1;
                // 必填参数校验：缺必填项的生成结果直接拒绝（附明细，指导下一轮修复）
                const problems = checkWorkflowParams({ nodes: parsed.nodes as never });
                if (problems.length > 0) {
                  // labels：AI 生成结果里也带节点显示名（生成 def 可能没有 label → 回退 id）
                  const nodeLabels = (parsed.nodes as { id?: string; label?: string }[]) ?? [];
                  res.write?.(`data: ${JSON.stringify({ done: true, ok: false, error: `生成的节点缺少必填参数（请修正后重试）：${formatParamProblems(problems, (id) => nodeLabels.find((n) => n.id === id)?.label ?? id)}` })}\n\n`);
                } else {
                  res.write?.(`data: ${JSON.stringify({ done: true, ok: true, def: parsed })}\n\n`);
                }
              }
            } catch (e) {
              res.write?.(`data: ${JSON.stringify({ done: true, ok: false, error: (e as Error).message })}\n\n`);
            }
            try { res.end?.(); } catch { /* */ }
            return;
          }

          const r = await callSubagent({
            prompt: body.prompt,
            system,
            timeoutMs: 300_000,
          });
          const parsed = extractJson(r.text) as { name?: unknown; nodes?: unknown; version?: unknown };
          // 宽松校验：AI 输出只要结构基本合法即可（name 可非 kebab-case，稍后规范化）
          // 严格校验（name 形态 + minItems 2）留给运行时 run 之前，避免误拒 AI 输出
          if (!parsed || typeof parsed !== 'object' || typeof parsed.name !== 'string' || !Array.isArray(parsed.nodes) || parsed.nodes.length < 2) {
            sendJson(res, 400, { error: 'AI 输出结构不合法：需要 name(string) + nodes(array>=2)' });
            return;
          }
          if (parsed.version === undefined) parsed.version = 1;
          // 必填参数校验：缺必填项的生成结果直接拒绝（附明细）
          const problems = checkWorkflowParams({ nodes: parsed.nodes as never });
          if (problems.length > 0) {
            const nodeLabels = (parsed.nodes as { id?: string; label?: string }[]) ?? [];
            sendJson(res, 400, { error: `生成的节点缺少必填参数（请修正后重试）：${formatParamProblems(problems, (id) => nodeLabels.find((n) => n.id === id)?.label ?? id)}` });
            return;
          }
          sendJson(res, 200, { ok: true, def: parsed });
        } catch (e) {
          sendJson(res, 500, { error: (e as Error).message, debugStack: (e as Error).stack?.split('\n').slice(0, 6).join(' | ') });
        }
      },
    });

    // 2.5 运行历史列表（GET /runs?workflowName=xxx，最近 20 条）
    route({
      kind: 'exact',
      path: '/api/dag-flow/runs',
      handler: async (req: any, res: any) => {
        try {
          const url = new URL(req.url ?? '', 'http://localhost');
          const wf = url.searchParams.get('workflowName') ?? undefined;
          const ids = await storage.listRunRecords(wf ?? undefined);
          const recent = ids.slice(0, 20);
          const runs = await Promise.all(recent.map(async (id) => {
            try {
              const rec = (await storage.readRunRecord(id)) as Record<string, unknown> | null;
              return {
                runId: id,
                status: (rec?.status as string) ?? 'unknown',
                workflowName: (rec?.workflowName as string) ?? wf ?? '',
                totalDurationMs: rec?.totalDurationMs ?? null,
                startedAt: rec?.startedAt ?? null,
                failedCount: rec?.failedCount ?? 0,
              };
            } catch { return { runId: id, status: 'unknown' }; }
          }));
          sendJson(res, 200, { runs });
        } catch (e) {
          sendJson(res, 500, { error: (e as Error).message });
        }
      },
    });

    // 3. 运行工作流（同名互斥 + 可取消 + 人工确认挂起/恢复：2026-10-03 用户拍板方案 A）
    //    语义：POST /run **不 hold 长连接**——要么跑完直接返回 summary（200），
    //    要么撞上 manual 节点返回 202 { status:'awaiting', runId, awaiting }，
    //    用户确认后 POST /run/resume（该请求 hold 到跑完，返回完整 summary）。
    interface ActiveRun {
      name: string;
      runId: string;
      ac: AbortController;
      status: 'running' | 'awaiting' | 'completed';
      promise: Promise<{ summary: RunSummary }>;
      awaiting?: { nodeId: string; prompt: string; createdAt: string };
      summary?: RunSummary;
      /** 已完成节点结果（/run/status 供画布徽标实时更新） */
      results: Record<string, { status: string; durationMs?: number }>;
      finishedAt?: number;
    }
    const activeRuns = new Map<string, ActiveRun>();   // 按工作流名互斥（保持既有语义）
    const runsById = new Map<string, ActiveRun>();     // 按 runId 供 status/resume 定位
    /** 已完成的运行只留最近 20 条（等待中的永不淘汰） */
    const pruneRuns = (): void => {
      const done = [...runsById.values()].filter((r) => r.status === 'completed');
      if (done.length <= 20) return;
      done.sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
      for (const r of done.slice(0, done.length - 20)) runsById.delete(r.runId);
    };

    route({
      kind: 'exact',
      path: '/api/dag-flow/run',
      handler: async (req: any, res: any) => {
        try {
          if (req.method === 'DELETE') {
            const url = new URL(req.url ?? '', 'http://localhost');
            const name = url.searchParams.get('name') ?? '';
            const rec = activeRuns.get(name);
            if (!rec) { sendJson(res, 404, { error: `工作流「${name}」没有正在运行的实例` }); return; }
            // 卡在人工确认的运行：先唤醒挂起节点（reject → 节点转 MANUAL_CANCELLED），再 abort 兜底
            if (rec.status === 'awaiting') rejectManual(rec.runId, '用户取消了等待中的人工确认');
            rec.ac.abort();
            sendJson(res, 200, { ok: true, cancelled: name });
            return;
          }
          const body = (await readJsonBody(req)) as { def?: WorkflowDef };
          if (!body.def) { sendJson(res, 400, { error: '缺少 def（工作流定义）' }); return; }
          const runName = body.def.name ?? '__anonymous__';
          if (activeRuns.has(runName)) {
            sendJson(res, 409, { error: `工作流「${runName}」正在运行中——等它结束，或点运行按钮旁的取消` });
            return;
          }
          const ac = new AbortController();
          const runId = newRunId();
          const resultsAcc: ActiveRun['results'] = {};
          const rec: ActiveRun = {
            name: runName, runId, ac, status: 'running', results: resultsAcc,
            promise: Promise.resolve({ summary: undefined as unknown as RunSummary }),
          };
          let notifyAwaiting: (info: { runId: string; nodeId: string; prompt: string }) => void = () => { /* 未挂起前 */ };
          const awaitingSeen = new Promise<{ nodeId: string; prompt: string }>((resolve) => {
            notifyAwaiting = (info) => resolve({ nodeId: info.nodeId, prompt: info.prompt });
          });
          // ★ interactive:true 是「会挂起等人确认」的唯一开关；CLI 工具/子工作流不传 → 自动通过
          rec.promise = runWorkflow(body.def, {
            logger, cwd: process.cwd(), signal: ac.signal,
            runId, interactive: true,
            onAwaiting: notifyAwaiting,
            onNodeDone: (id, r) => { resultsAcc[id] = { status: r.status, durationMs: r.durationMs }; },
          });
          activeRuns.set(runName, rec);
          runsById.set(runId, rec);
          // 收敛：成功/异常都要释放同名互斥锁并把状态标完成（否则异常路径会让该工作流永远 409）
          void rec.promise.then(
            (r) => { rec.status = 'completed'; rec.summary = r.summary; rec.finishedAt = Date.now(); if (activeRuns.get(runName) === rec) activeRuns.delete(runName); pruneRuns(); },
            () => { rec.status = 'completed'; rec.finishedAt = Date.now(); if (activeRuns.get(runName) === rec) activeRuns.delete(runName); pruneRuns(); },
          );

          // 关键：要么挂起（202），要么直接跑完（200）——都不 hold 超过必要时长
          const first = await Promise.race([
            awaitingSeen.then((info) => ({ kind: 'awaiting' as const, info })),
            rec.promise.then((r) => ({ kind: 'done' as const, r })),
          ]);
          if (first.kind === 'done') {
            sendJson(res, 200, { ok: first.r.summary.status === 'success', summary: first.r.summary });
            return;
          }
          rec.status = 'awaiting';
          rec.awaiting = { nodeId: first.info.nodeId, prompt: first.info.prompt, createdAt: new Date().toISOString() };
          // activeRuns 保留（同名互斥 + ⏹ 取消入口），直到 resume 后跑完
          sendJson(res, 202, {
            ok: true, status: 'awaiting', runId, workflowName: runName,
            awaiting: { nodeId: first.info.nodeId, prompt: first.info.prompt },
          });
        } catch (e) {
          sendJson(res, 500, { error: (e as Error).message });
        }
      },
    });

    // 3.1 运行状态查询（刷新页面 / 重挂面板后恢复等待态；也供画布徽标刷新）
    route({
      kind: 'exact',
      path: '/api/dag-flow/run/status',
      handler: async (req: any, res: any) => {
        try {
          const url = new URL(req.url ?? '', 'http://localhost');
          const runId = url.searchParams.get('runId') ?? '';
          const rec = runsById.get(runId);
          if (!rec) {
            sendJson(res, 404, { error: '查无此运行——可能已结束，或 dsh 重启导致暂停中的运行丢失' });
            return;
          }
          const live = getAwaiting(runId); // 以挂起注册表为准（rec.status 可能滞后一瞬）
          sendJson(res, 200, {
            runId,
            workflowName: rec.name,
            status: live ? 'awaiting' : rec.status,
            ...(live ? { awaiting: { nodeId: live.nodeId, prompt: live.prompt } } : {}),
            ...(rec.status === 'completed' && rec.summary ? { summary: rec.summary } : {}),
            results: rec.results,
          });
        } catch (e) {
          sendJson(res, 500, { error: (e as Error).message });
        }
      },
    });

    // 3.15 人工确认：唤醒挂起的 manual 节点（该请求 hold 到跑完，返回完整 summary）
    route({
      kind: 'exact',
      path: '/api/dag-flow/run/resume',
      handler: async (req: any, res: any) => {
        try {
          if (req.method !== 'POST') { sendJson(res, 405, { error: '请用 POST' }); return; }
          const body = (await readJsonBody(req)) as { runId?: string; value?: string };
          const runId = String(body.runId ?? '');
          const rec = runsById.get(runId);
          if (!rec) { sendJson(res, 404, { error: '查无此运行——dsh 重启会丢失暂停中的运行，请重新运行工作流' }); return; }
          if (!getAwaiting(runId)) {
            sendJson(res, 409, { error: rec.status === 'completed' ? '该运行已结束' : '该运行当前不在等待人工确认' });
            return;
          }
          if (!resolveManual(runId, String(body.value ?? ''))) {
            sendJson(res, 409, { error: '唤醒失败：运行已不在等待人工确认' });
            return;
          }
          rec.status = 'running';
          rec.awaiting = undefined;
          const r = await rec.promise;
          sendJson(res, 200, { ok: r.summary.status === 'success', summary: r.summary });
        } catch (e) {
          sendJson(res, 500, { error: (e as Error).message });
        }
      },
    });

    // 3.2 打开工作流数据文件夹（2026-10-02 用户需求：dock head 按钮 → 系统文件管理器打开 <工作区>/.dag-flow/）
    route({
      kind: 'exact',
      path: '/api/dag-flow/open-folder',
      handler: async (_req: any, res: any) => {
        try {
          const dir = await dagFlowDir();
          mkdirSync(dir, { recursive: true }); // 目录尚不存在时先建（首次安装还没存过工作流）
          if (process.platform === 'win32') {
            // explorer.exe 的退出码不可靠（开成功也常返回 1），fire-and-forget 不等它
            spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref();
          } else if (process.platform === 'darwin') {
            spawn('open', [dir], { detached: true, stdio: 'ignore' }).unref();
          } else {
            spawn('xdg-open', [dir], { detached: true, stdio: 'ignore' }).unref();
          }
          sendJson(res, 200, { ok: true, path: dir });
        } catch (e) {
          sendJson(res, 500, { error: `打开文件夹失败: ${(e as Error).message}` });
        }
      },
    });

    // 3.5 单节点试跑（#1）：start→target→end 最小流程真实执行，输入经 {{inputs.*}} 注入
    route({
      kind: 'exact',
      path: '/api/dag-flow/run-node',
      handler: async (req: any, res: any) => {
        try {
          const body = (await readJsonBody(req)) as {
            nodeType?: string;
            params?: Record<string, unknown>;
            inputs?: Record<string, unknown>;
          };
          const nodeType = String(body.nodeType ?? '');
          if (!nodeType || nodeType === 'start' || nodeType === 'end') {
            sendJson(res, 400, { error: '缺少 nodeType（且不能是 start/end）' });
            return;
          }
          if (!WorkflowNodeRegistry.list().some((d) => d.type === nodeType)) {
            sendJson(res, 400, { error: `未知节点类型: ${nodeType}` });
            return;
          }
          const def: WorkflowDef = {
            name: 'node-testrun',
            version: 1,
            nodes: [
              { id: 'start', type: 'start', next: 'target' },
              { id: 'target', type: nodeType, params: (body.params ?? {}) as Record<string, JsonValue>, next: 'end' },
              { id: 'end', type: 'end' },
            ],
          };
          // 用 next 线性链（不用 edges）：parse 的可达性检查只认 next，避免误报 unreachable
          const result = await runWorkflow(def, { logger, cwd: process.cwd(), inputs: (body.inputs ?? {}) as Record<string, JsonValue> });
          sendJson(res, 200, { ok: result.summary.status === 'success', summary: result.summary });
        } catch (e) {
          sendJson(res, 500, { error: (e as Error).message });
        }
      },
    });

    // 4. 保存/读取工作流
    route({
      kind: 'exact',
      path: '/api/dag-flow/workflows',
      handler: async (_req: any, res: any) => {
        const names = await storage.listWorkflows();
        // 附上每个工作流的节点数 + **落盘路径**（2026-10-03 用户需求：下拉里名称后置灰显示所在路径）
        const info = await storage.describe();
        const withMeta = await Promise.all(names.map(async (n) => {
          const file = path.join(info.dir, `${n}.json`);
          try {
            const def = await storage.readWorkflow(n);
            return { name: n, nodes: def?.nodes?.length ?? 0, path: file };
          } catch { return { name: n, nodes: 0, path: file }; }
        }));
        sendJson(res, 200, { workflows: withMeta, storage: info });
      },
    });

    // 4b. 读取单个已保存工作流（GET /workflows/<name>）+ 历史版本（#14-②）
    // ★ prefix 路由不能带尾斜杠（dsh-host-webserver 契约：no trailing slash，
    //   p 匹配 p 与 p/<x>；带尾斜杠会导致 /workflows/<name> 永远 404）
    route({
      kind: 'prefix',
      path: '/api/dag-flow/workflows',
      handler: async (req: any, res: any) => {
        try {
          const url = new URL(req.url ?? '', 'http://localhost');
          const rest = url.pathname.replace('/api/dag-flow/workflows/', '').split('/');
          const name = decodeURIComponent(rest[0] ?? '');
          if (!name) { sendJson(res, 400, { error: '缺少工作流名称' }); return; }
          // DELETE /workflows/<name> → 删除工作流（含历史版本）
          if (req.method === 'DELETE' && !rest[1]) {
            await storage.deleteWorkflow(name);
            sendJson(res, 200, { ok: true, deleted: name });
            return;
          }
          // GET /workflows/<name>/versions          → 版本列表
          // GET /workflows/<name>/versions/<ts>     → 读取某版本
          if (rest[1] === 'versions') {
            const ts = decodeURIComponent(rest[2] ?? '');
            if (ts) {
              const def = await storage.readVersion(name, ts);
              if (!def) { sendJson(res, 404, { error: `版本不存在: ${name}@${ts}` }); return; }
              sendJson(res, 200, { workflow: def });
              return;
            }
            // dir 附实际落盘目录（2026-10-01 夜：版本弹窗标注数据存储位置）
            sendJson(res, 200, { versions: await storage.listVersions(name), dir: (await storage.describe()).dir });
            return;
          }
          const def = await storage.readWorkflow(name);
          if (!def) { sendJson(res, 404, { error: `工作流不存在: ${name}` }); return; }
          sendJson(res, 200, { workflow: def });
        } catch (e) {
          sendJson(res, 400, { error: (e as Error).message });
        }
      },
    });

    // 5. 保存工作流（POST { name, def, snapshot? }）→ 写入 <工作区>/.dag-flow/workflow/<name>.json
    //    snapshot=true（默认）生成版本快照（versions/<name>/<ts>.json，存本次保存内容）；false 不生成（自动保存用）
    route({
      kind: 'exact',
      path: '/api/dag-flow/workflows/save',
      handler: async (req: any, res: any) => {
        try {
          const body = (await readJsonBody(req)) as { name?: string; def?: WorkflowDef; snapshot?: boolean; renameFrom?: string };
          if (!body.name || !body.def) { sendJson(res, 400, { error: '缺少 name 或 def' }); return; }
          // name 规范化：支持中文/字母/数字/连字符（规则唯一源见 src/name-rule.ts）
          const name = normalizeWorkflowName(String(body.name)) || 'my-workflow';
          // snapshot 缺省视为 true（手动保存/复制/重命名均生成版本）；自动保存显式传 false 不生成
          // renameFrom=旧名（重命名保存时 client 带上）→ storage 层删旧文件 + versions/scripts 子目录搬移
          const renameFrom = body.renameFrom ? (normalizeWorkflowName(String(body.renameFrom)) || undefined) : undefined;
          await storage.writeWorkflow(name, { ...body.def, name }, { snapshot: body.snapshot !== false, renameFrom });
          sendJson(res, 200, { ok: true, name });
        } catch (e) {
          sendJson(res, 400, { error: (e as Error).message });
        }
      },
    });

    // 6. 可用模型（自动发现 dsh settings.yaml 已配置模型；不再支持手配/密钥录入）
    //    input = 模型输入模态（settings.yaml models[].input，未标注视为 ['text'] 仅文本）；hasImage 供前端提示
    route({
      kind: 'exact',
      path: '/api/dag-flow/models',
      handler: async (_req: any, res: any) => {
        try {
          const endpoints = await listAllEndpoints();
          const models = endpoints.map((e, i) => ({
            id: `dsh:${e.providerName ?? `model-${i}`}`,
            name: e.providerName ?? e.model,
            model: e.model,
            // ★ 显示名（2026-10-03 用户要求「下拉显示模型显示名称，不用 id」）：
            //   label = 宿主给的模型显示名（如 DeepSeek-V41-Flash）；宿主没给（settings 直读源）时
            //   回退到 model id（是能认的模型名，不会退化成 llm:provider:model 这种内部串）。
            //   name/id 字段保持原样不动（存值/执行/旧断言都不受影响），label 纯展示用。
            label: e.modelLabel ?? e.model,
            providerLabel: e.providerLabel ?? '',
            baseURL: e.baseURL,
            kind: 'dsh',
            input: e.input ?? ['text'],
            hasImage: (e.input ?? ['text']).includes('image'),
          }));
          sendJson(res, 200, { models });
        } catch (e) {
          sendJson(res, 500, { error: (e as Error).message });
        }
      },
    });

    // 6.5 图片 API 连通性/模型支持性测试（image_generate 节点「提前测试」用）
    //     真实发一次最小生成请求验证 baseURL+key+model 组合；会产生一张测试图的最小费用。
    route({
      kind: 'exact',
      path: '/api/dag-flow/test-image-api',
      handler: async (req: any, res: any) => {
        try {
          const body = (await readJsonBody(req)) as { baseURL?: string; apiKey?: string; apiKeyEnv?: string; model?: string; size?: string };
          const baseURL = String(body.baseURL ?? '').replace(/\/+$/, '');
          if (!baseURL) { sendJson(res, 400, { error: '缺少 baseURL' }); return; }
          const apiKey = body.apiKey || (body.apiKeyEnv ? process.env[body.apiKeyEnv] || '' : '');
          if (!apiKey) { sendJson(res, 400, { error: '缺少 API Key（apiKey 或 apiKeyEnv）' }); return; }
          const model = String(body.model ?? 'wanx-v1');
          const size = String(body.size ?? '1024*1024');
          const ac = new AbortController();
          const t = setTimeout(() => ac.abort(), 60_000);
          try {
            const resp = await fetch(`${baseURL}/images/generations`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
              body: JSON.stringify({ model, prompt: 'a small blue circle on white background', size, n: 1 }),
              signal: ac.signal,
            });
            const text = await resp.text().catch(() => '');
            if (resp.ok) {
              sendJson(res, 200, { ok: true, model, size, note: '连接成功且模型可用（已生成 1 张测试图）' });
              return;
            }
            const hint = resp.status === 401 || resp.status === 403
              ? 'API Key 无效或无权限'
              : resp.status === 404
                ? '路径或模型不存在——检查 baseURL 是否为 .../compatible-mode/v1 形态、model 是否为该服务支持的模型'
                : resp.status === 400
                  ? '请求被拒——常见原因：模型不支持该 size/参数，或模型名不对（见 detail）'
                  : '调用失败（见 detail）';
            sendJson(res, 200, { ok: false, status: resp.status, hint, detail: text.slice(0, 400) });
          } finally {
            clearTimeout(t);
          }
        } catch (e) {
          const msg = (e as Error).name === 'AbortError' ? '超时（60s）' : (e as Error).message;
          sendJson(res, 200, { ok: false, status: 0, hint: '网络/地址错误', detail: msg.slice(0, 400) });
        }
      },
    });

    // 8. 列出工作区会话（供「会话输入」节点选择）
    route({
      kind: 'exact',
      path: '/api/dag-flow/sessions',
      handler: async (req: any, res: any) => {
        try {
          const url = new URL(req.url ?? '', 'http://localhost');
          const ws = url.searchParams.get('workspace') ?? undefined;
          const sessions = await listSessions(ws);
          if (sessions === null) { sendJson(res, 200, { sessions: [] }); return; }
          sendJson(res, 200, { sessions });
        } catch (e) {
          sendJson(res, 500, { error: (e as Error).message });
        }
      },
    });

    // 9. 读取会话内容（供「会话输入」节点执行时用；prefix 无尾斜杠，理由同 4b）
    route({
      kind: 'prefix',
      path: '/api/dag-flow/sessions',
      handler: async (req: any, res: any) => {
        try {
          const url = new URL(req.url ?? '', 'http://localhost');
          const rest = url.pathname.replace('/api/dag-flow/sessions/', '').split('/');
          const sessionId = decodeURIComponent(rest[0] ?? '');
          const limit = Number(url.searchParams.get('limit') ?? '10') || 10;
          const ws = url.searchParams.get('workspace') ?? undefined;
          if (!sessionId) { sendJson(res, 400, { error: '缺少会话 id' }); return; }
          const content = await readSessionContent(sessionId, limit, ws);
          if (content === null) { sendJson(res, 404, { error: '会话不存在' }); return; }
          sendJson(res, 200, { sessionId, limit, content });
        } catch (e) {
          sendJson(res, 500, { error: (e as Error).message });
        }
      },
    });

    logger.info(`[dag-flow] API routes registered: ${reg.count()} 条`);
    return { registered: true, dispose };
  } catch (e) {
    dispose(); // 半途失败：已注册的也要撤掉，避免留下残路由
    return { registered: false, reason: (e as Error).message };
  }
}
