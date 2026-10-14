// src/adapter/routes/run.ts — 运行域路由：/runs /run /run/status /run/resume /open-folder /selfcheck /run/log /run-node
// 同名互斥 + 可取消 + 人工确认挂起/恢复的语义都在这里；运行登记表在 ../runRegistry.ts（手动/定时共用）。
// runSelfcheck（运行前自检的宿主侧事实注入）也在这里——/run 与 /selfcheck 两条路由共用。
// 2026-10-14 重构轮 2 自 api.ts 纯搬运拆出。

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import type { WorkflowDef, JsonValue } from '../../types.js';
import { WorkflowNodeRegistry } from '../../registry/external.js';
import { runWorkflow, type RunSummary } from '../../executor/run.js';
import type { NodeRunDetail } from '../../executor/run.js';
import { newRunId, getAwaiting, resolveManual, rejectManual } from '../../executor/awaiting.js';
// ★ 运行前自检（2026-10-04 轮 1）：判据唯一真源在 src/executor/selfcheck.ts
import { selfcheck, type SelfcheckDeps, type SelfcheckResult } from '../../executor/selfcheck.js';
import { markRunning, unmarkRunning } from '../running.js';
import { registerRun, finishRun, getRunByName, getRunById, getLastCompleted, nodeResultOf, mergeNodeLog, getLogTarget, type ActiveRun } from '../runRegistry.js';
import { createStorage } from '../storage.js';
import { dagFlowDir, resolveDagFlowSub } from '../workspace.js';
import { resolveLlmEndpoint } from '../subagent.js';
import { listSchedules } from '../schedules.js';
import type { ApiRouteDeps } from './helpers.js';

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

export function registerRunRoutes({ route, sendJson, readJsonBody, storage, logger }: ApiRouteDeps): void {
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
        let summary = result.summary;
        // ★ 2026-10-11（用户要求修 ③）：单节点试跑最容易踩的坑——参数里引用了上游节点
        //   （如 over: '{{web_search1.out.results}}'）。试跑的 def 只有 start→target→end，那个上游
        //   根本不在图里，引擎会报 DATAFLOW_UNKNOWN「引用了不存在的节点」——读起来像工作流坏了，
        //   其实是「单节点测试没有上游」。这里补一句人话 + 出路。
        //   ★ 只改 message，**不动错误码**：引擎说的"引用了不存在的节点"在同一份 def 里是正确判据；
        //     也不要在这里 fail-fast，保持"真跑一遍再报"的既有行为，免得改坏客户端失败详情面板。
        if (summary?.status !== 'success' && summary?.error?.code === 'DATAFLOW_UNKNOWN') {
          summary = {
            ...summary,
            error: { ...summary.error, message: `${summary.error.message}——这是「单节点试跑」的固有限制：试跑只跑这一个节点，参数里引用的上游节点不在图里，所以解析不到。要看真实数据请整图运行；只想给这个节点喂数据，可以用 {{inputs.xxx}}（试跑面板能填输入）。` },
          };
        }
        sendJson(res, 200, { ok: summary.status === 'success', summary });
      } catch (e) {
        sendJson(res, 500, { error: (e as Error).message });
      }
    },
  });
}
