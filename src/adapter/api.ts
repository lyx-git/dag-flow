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
import { dagFlowDir, resolveDagFlowSub } from './workspace.js';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { normalizeWorkflowName } from '../name-rule.js';
import { WorkflowNodeRegistry } from '../registry/external.js';
import { checkWorkflowParams, formatParamProblems } from '../registry/params-check.js';
import { runWorkflow, type RunSummary } from '../executor/run.js';
import { newRunId, getAwaiting, resolveManual, rejectManual } from '../executor/awaiting.js';
import type { NodeRunDetail } from '../executor/run.js';
// ★ 运行前自检（2026-10-04 轮 1）：判据唯一真源在 src/executor/selfcheck.ts
import { selfcheck, type SelfcheckDeps, type SelfcheckResult } from '../executor/selfcheck.js';

/**
 * 跑自检并**注入宿主侧的外部事实**（2026-10-04 轮 3）：
 *   · knownWorkflows：工作区现有工作流名 → 查 subflow 依赖 / loop 循环体是否存在（自检本身是纯函数，读盘交给这里）
 *   · modelResolves：用**引擎同一个** `resolveLlmEndpoint` 预解析存值模型（只对 subagent 节点、按 id 去重）
 * 任何一项拿不到就跳过该项检查（保守：宁可少报，不误报）。
 */
async function runSelfcheck(def: WorkflowDef): Promise<SelfcheckResult> {
  const deps: SelfcheckDeps = {};
  try {
    deps.knownWorkflows = new Set(await createStorage().listWorkflows());
  } catch { /* 拿不到工作流清单 → 跳过依赖类检查 */ }
  try {
    const ids = [...new Set((def.nodes ?? [])
      .filter((n) => n.type === 'subagent')
      .map((n) => String((n.params as { model?: unknown } | undefined)?.model ?? '').trim())
      .filter(Boolean))];
    if (ids.length) {
      const okMap = new Map<string, boolean>();
      for (const m of ids) {
        try { await resolveLlmEndpoint(m); okMap.set(m, true); } catch { okMap.set(m, false); }
      }
      deps.modelResolves = (m) => okMap.get(m) ?? true;
    }
  } catch { /* 拿不到模型解析 → 跳过模型检查 */ }
  // 轮 4：本工作流是否挂了定时任务（含 manual 节点时提醒"定时那次不会停下来等确认"）
  try {
    const sc = await listSchedules(def.name);
    if (Array.isArray(sc.items)) deps.hasSchedule = sc.items.some((it) => it.workflow === def.name);
  } catch { /* 拿不到定时配置 → 跳过这项 */ }
  return selfcheck(def, deps);
}

import { callSubagent, callSubagentStream, listAllEndpoints, resolveLlmEndpoint } from './subagent.js';
import { listSessions, readSessionContent } from './sessions.js';
import { markRunning, unmarkRunning } from './running.js';
import { listSchedules, upsertSchedule, deleteSchedule, renameScheduleWorkflow, readSchedules, writeSchedules } from './schedules.js';
import { schedulerInfo, tickScheduler } from './scheduler.js';
import { registerRun, finishRun, getRunByName, getRunById, getLastCompleted, nodeResultOf, mergeNodeLog, getLogTarget, type ActiveRun } from './runRegistry.js';
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
分支语义：if 节点 next 用 {true,false}；switch 节点 params.cases 为 {case值: 目标节点id}，next 用 {case值: 目标,...}（可含 "*"）；并行多分支用数组 next，合流用 merge 节点；节点失败策略用 onError: "stop"|"continue"|{goto:"目标id"}（stop=只停本节点下游并算失败；continue=下游停且不算失败；goto=跳到目标继续，**目标必须排在该节点之后**，目标只执行一次）。
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
    //    ★ 运行登记表已抽到 src/adapter/runRegistry.ts：定时触发（scheduler.ts）登记到**同一张表**，
    //      这样 GET /run/status?name= 对手动/定时两种运行完全同构（画布才会在定时跑时也点亮）。

    route({
      kind: 'exact',
      path: '/api/dag-flow/run',
      handler: async (req: any, res: any) => {
        try {
          if (req.method === 'DELETE') {
            const url = new URL(req.url ?? '', 'http://localhost');
            const name = url.searchParams.get('name') ?? '';
            const rec = getRunByName(name);
            if (!rec) { sendJson(res, 404, { error: `工作流「${name}」没有正在运行的实例` }); return; }
            // 卡在人工确认的运行：先唤醒挂起节点（reject → 节点转 MANUAL_CANCELLED），再 abort 兜底
            if (rec.status === 'awaiting') rejectManual(rec.runId, '用户取消了等待中的人工确认');
            rec.ac.abort();
            sendJson(res, 200, { ok: true, cancelled: name });
            return;
          }
          const body = (await readJsonBody(req)) as { def?: WorkflowDef; skipSelfcheck?: boolean };
          if (!body.def) { sendJson(res, 400, { error: '缺少 def（工作流定义）' }); return; }
          const runName = body.def.name ?? '__anonymous__';
          if (getRunByName(runName)) {
            sendJson(res, 409, { error: `工作流「${runName}」正在运行中——等它结束，或点运行按钮旁的取消` });
            return;
          }

          // ★ 运行前自检（2026-10-04 用户拍板：运行前自动检查；有问题给出**报错提示 + 解决办法**并拦下做人工确认）
          //   有 error → 409 { blocked:true, selfcheck }；客户端弹窗后点「仍然运行」会带 skipSelfcheck:true 重发。
          //   warn 不拦（只随响应返回，客户端自行决定展示）。
          if (body.skipSelfcheck !== true) {
            const sc = await runSelfcheck(body.def);
            if (!sc.ok) {
              sendJson(res, 409, { blocked: true, selfcheck: sc });
              return;
            }
          }
          const ac = new AbortController();
          const runId = newRunId();
          const resultsAcc: ActiveRun['results'] = {};
          const rec: ActiveRun = {
            name: runName, runId, ac, status: 'running', results: resultsAcc, running: [], log: {}, logOrder: [],
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
            // ★ 运行日志（2026-10-04 用户需求「工作流执行黑盒」）：把执行器的两条通知（入参/出参）合并进本次运行
            onNodeLog: (d: NodeRunDetail) => { try { mergeNodeLog(rec, d); } catch { /* 日志采集失败不影响运行 */ } },
            onAwaiting: notifyAwaiting,
            onNodeStart: (id) => { if (!rec.running.includes(id)) rec.running.push(id); },
            onNodeDone: (id, r) => {
              // 逐节点累积（形状由 runRegistry.nodeResultOf 统一，手动/定时两条路径不会漂移）
              resultsAcc[id] = nodeResultOf(r);
              rec.running = rec.running.filter((x) => x !== id);
            },
          });
          markRunning(runName);   // 共享登记：调度器的 concurrency:'skip' 也要看得见手动运行
          registerRun(rec);
          // 收敛：成功/异常都要释放同名互斥锁并把状态标完成（否则异常路径会让该工作流永远 409）
          void rec.promise.then(
            (r) => { finishRun(rec, r.summary); unmarkRunning(runName); },
            () => { finishRun(rec); unmarkRunning(runName); },
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
          // ★ 2026-10-03 新增：支持按**工作流名**查在跑的实例（画布在 POST /run 还没返回时
          //   就能轮询到逐节点的进度——客户端拿不到 runId，因为那条请求要等运行结束才回）。
          const byName = url.searchParams.get('name') ?? '';
          // ★ 2026-10-03 定时任务轮：查不到「在跑的实例」时回退到**最近一次完成的运行** ——
          //   定时运行结束后 activeRuns 会摘掉，只靠它客户端最后一次轮询会 404，画布无法收敛到终态；
          //   回退后客户端能把节点点亮成最终态（进程内保留，dsh 重启即清空）。
          const rec = runId ? getRunById(runId) : (byName ? (getRunByName(byName) ?? getLastCompleted(byName)) : undefined);
          if (!rec) {
            sendJson(res, 404, { error: '查无此运行——可能已结束，或 dsh 重启导致暂停中的运行丢失' });
            return;
          }
          const live = getAwaiting(rec.runId); // 以挂起注册表为准（rec.status 可能滞后一瞬）
          sendJson(res, 200, {
            runId: rec.runId,
            workflowName: rec.name,
            status: live ? 'awaiting' : rec.status,
            origin: rec.origin ?? 'manual',
            ...(live ? { awaiting: { nodeId: live.nodeId, prompt: live.prompt } } : {}),
            ...(rec.status === 'completed' && rec.summary ? { summary: rec.summary } : {}),
            results: rec.results,
            running: rec.running,
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
          const rec = getRunById(runId);
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

    // 3.2 打开工作流数据文件夹（2026-10-02 用户需求：dock head 按钮 → 系统文件管理器打开 <DSH_HOME>/.dag-flow/）
    //     ★ 2026-10-11 用户需求：⏰ 定时任务弹窗 / 🧾 运行日志弹窗也要「标记数据存放位置 + 点一下打开文件夹」
    //     → 本路由接受**可选** body `{ sub }`（.dag-flow 下的相对子目录，如 'runs'、'workflow/versions/<名>'）。
    //     不带 sub = 打开 .dag-flow 根（dock 按钮的既有行为**一字未改** ✓）；越界路径由 resolveDagFlowSub 拦下。
    route({
      kind: 'exact',
      path: '/api/dag-flow/open-folder',
      handler: async (req: any, res: any) => {
        try {
          let sub = '';
          try {
            const body = (await readJsonBody(req)) as { sub?: unknown };
            sub = String((body as any)?.sub ?? '');
          } catch { /* 没有 body（fetch 不带 JSON）：按根目录处理 */ }
          const dir = await dagFlowDir();
          const target = resolveDagFlowSub(dir, sub);
          if (!target) { sendJson(res, 400, { error: `打开文件夹失败：子目录非法（${sub}）` }); return; }
          mkdirSync(target, { recursive: true }); // 目录尚不存在时先建（首次安装还没存过工作流）
          if (process.platform === 'win32') {
            // explorer.exe 的退出码不可靠（开成功也常返回 1），fire-and-forget 不等它
            spawn('explorer.exe', [target], { detached: true, stdio: 'ignore' }).unref();
          } else if (process.platform === 'darwin') {
            spawn('open', [target], { detached: true, stdio: 'ignore' }).unref();
          } else {
            spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
          }
          sendJson(res, 200, { ok: true, path: target });
        } catch (e) {
          sendJson(res, 500, { error: `打开文件夹失败: ${(e as Error).message}` });
        }
      },
    });

    // 3.4 运行前自检（2026-10-04 用户拍板：点运行 → **先自检**（按钮显示「自检中」）→ 自检通过后**人工确认**
    //     再真正开跑）。本路由**只自检不执行**，客户端拿到结果后决定：有 error 弹问题清单、没问题弹确认。
    //     `/run` 里那道自检仍然保留（绕过客户端直接调 API 时也要拦），客户端确认后再带 skipSelfcheck:true 调 /run。
    route({
      kind: 'exact',
      path: '/api/dag-flow/selfcheck',
      handler: async (req: any, res: any) => {
        try {
          const body = (await readJsonBody(req)) as { def?: WorkflowDef };
          if (!body.def) { sendJson(res, 400, { error: '缺少 def（工作流定义）' }); return; }
          sendJson(res, 200, await runSelfcheck(body.def));
        } catch (e) {
          sendJson(res, 500, { error: `自检失败: ${(e as Error).message}` });
        }
      },
    });

    // 3.14 运行日志（2026-10-04 用户需求：「参数传递是否正常、节点之间接收参数是否正常都没有日志，
    //      工作流执行黑盒」）。按工作流名查**在跑的那次**，跑完回退「最近一次完成」——客户端只有工作流名。
    route({
      kind: 'exact',
      path: '/api/dag-flow/run/log',
      handler: async (req: any, res: any) => {
        try {
          const url = new URL(req.url ?? '', 'http://localhost');
          const name = url.searchParams.get('name') ?? '';
          const runId = url.searchParams.get('runId') ?? '';
          const onlyNode = url.searchParams.get('node') ?? '';
          const live = name ? getRunByName(name) : undefined;
          const target = live ?? getLogTarget({ name, runId });
          if (!target) { sendJson(res, 404, { error: '查无运行日志——先运行一次这个工作流' }); return; }
          let entries = (target.logOrder ?? []).map((id) => target.log?.[id]).filter(Boolean);
          if (onlyNode) entries = entries.filter((e) => e.id === onlyNode);
          sendJson(res, 200, {
            ok: true,
            runId: target.runId,
            workflowName: target.name,
            runStatus: target.status,
            /** live=true：这次运行还在进行中（客户端据此继续轮询刷新日志） */
            live: !!live,
            origin: target.origin ?? 'manual',
            finishedAt: target.finishedAt,
            nodeCount: entries.length,
            entries,
            /** ★ 2026-10-11：运行记录落盘目录（弹窗里标注「数据存于 …」+ 点击打开用） */
            dir: await storage.runsDir(),
          });
        } catch (e) {
          sendJson(res, 500, { error: `读取运行日志失败: ${(e as Error).message}` });
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
            // ★ 2026-10-04：显式给出 edges，让单节点测试与画布工作流走**同一套** DAG 语义。
            //   （旧注释说"parse 的可达性检查只认 next，用 edges 会误报 unreachable"是**过时结论**：
            //     parse.ts 的可达性 BFS 同时看 next 与 edges，两种写法都不会误报。）
            edges: [
              { from: 'start', to: 'target' },
              { from: 'target', to: 'end' },
            ],
          };
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

    // 5. 保存工作流（POST { name, def, snapshot? }）→ 写入 <DSH_HOME>/.dag-flow/workflow/<name>.json
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
          // ★ 定时任务联动改名（2026-10-03 定时任务轮）：工作流改名后，指向旧名的定时项一起改，
          //   否则那些定时项会变成 orphan（配置还在、却永远指空）。失败不阻塞保存。
          let renamedSchedules = 0;
          if (renameFrom && renameFrom !== name) {
            try { renamedSchedules = await renameScheduleWorkflow(renameFrom, name); } catch { /* 联动失败不阻塞保存 */ }
          }
          sendJson(res, 200, { ok: true, name, ...(renamedSchedules ? { renamedSchedules } : {}) });
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

    // ===== 定时任务（2026-10-03 用户拍板方案 v1，docs/SCHEDULE-PLAN.md §4）+4 条路由 =====
    // 说明：宿主注册器按 (kind,path) 唯一（重复注册会抛 duplicate 并被跳过），所以拆成 4 条路径：
    //   GET  /schedules              列表（可 ?workflow= 过滤）+ 调度器心跳
    //   POST /schedules/save         新增/更新一条（cron 非法 → 400 且不落盘）
    //   POST /schedules/delete       删除一条（也接受 DELETE 方法）
    //   POST /schedules/run          立即运行一次（等价于真跑，UI 二次确认）
    route({
      kind: 'exact',
      path: '/api/dag-flow/schedules',
      handler: async (req: any, res: any) => {
        try {
          const url = new URL(req.url ?? '', 'http://localhost');
          const workflow = url.searchParams.get('workflow') ?? undefined;
          const r = await listSchedules(workflow);
          sendJson(res, 200, { items: r.items, dir: r.dir, scheduler: schedulerInfo(), ...(r.error ? { warning: r.error } : {}) });
        } catch (e) {
          sendJson(res, 500, { error: (e as Error).message });
        }
      },
    });

    route({
      kind: 'exact',
      path: '/api/dag-flow/schedules/save',
      handler: async (req: any, res: any) => {
        try {
          if (req.method !== 'POST') { sendJson(res, 405, { error: '请用 POST' }); return; }
          const body = (await readJsonBody(req)) as Record<string, unknown>;
          try {
            const item = await upsertSchedule(body as never);
            sendJson(res, 200, { ok: true, item });
          } catch (e) {
            // cron 非法 / 缺 workflow：**不落盘**，把中文原因交给面板显示红字
            sendJson(res, 400, { error: (e as Error).message });
          }
        } catch (e) {
          sendJson(res, 500, { error: (e as Error).message });
        }
      },
    });

    route({
      kind: 'exact',
      path: '/api/dag-flow/schedules/delete',
      handler: async (req: any, res: any) => {
        try {
          const url = new URL(req.url ?? '', 'http://localhost');
          let id = url.searchParams.get('id') ?? '';
          if (!id && req.method === 'POST') {
            const body = (await readJsonBody(req)) as { id?: string };
            id = String(body.id ?? '');
          }
          if (!id) { sendJson(res, 400, { error: '缺少 id' }); return; }
          const removed = await deleteSchedule(id);
          sendJson(res, removed ? 200 : 404, removed ? { ok: true, id } : { error: '该定时项不存在' });
        } catch (e) {
          sendJson(res, 500, { error: (e as Error).message });
        }
      },
    });

    route({
      kind: 'exact',
      path: '/api/dag-flow/schedules/run',
      handler: async (req: any, res: any) => {
        try {
          if (req.method !== 'POST') { sendJson(res, 405, { error: '请用 POST' }); return; }
          const body = (await readJsonBody(req)) as { id?: string };
          const id = String(body.id ?? '');
          if (!id) { sendJson(res, 400, { error: '缺少 id' }); return; }
          // 复用调度器的 tick 逻辑：把该条目的 nextRunAt 置为现在，再走一次真 tick ——
          // 并发 skip / 结果回写 / 独立 runId 的语义与定时触发**完全一致**（不会出现两套行为）。
          const { file } = await readSchedules();
          const it = file.items.find((x) => x.id === id);
          if (!it) { sendJson(res, 404, { error: '该定时项不存在' }); return; }
          it.nextRunAt = new Date().toISOString();
          await writeSchedules(file);
          const report = await tickScheduler();
          // 等这次执行跑完再回复（该请求 hold 到结束，与 /run 语义一致；无交互，不会挂起）
          await Promise.all(report.inflight);
          const after = await listSchedules(it.workflow);
          const updated = after.items.find((x) => x.id === id) ?? null;
          sendJson(res, 200, {
            ok: !!updated && updated.lastRun?.status === 'success',
            item: updated,
            skipped: report.skipped.some((s) => s.id === id),
          });
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
