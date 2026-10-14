// src/adapter/routes/ai.ts — AI 生成工作流路由（POST /ai-generate，支持 SSE 流式）
// 系统提示词在此拼装：固定红线部分（AI_SYSTEM_PROMPT）+ 注册表实时的节点参数 schema（buildSystemPrompt）；
// LLM 调用走 ../subagent.ts（callSubagent / callSubagentStream）。2026-10-14 重构轮 2 自 api.ts 纯搬运拆出。

import { WorkflowNodeRegistry } from '../../registry/external.js';
import { checkWorkflowParams, formatParamProblems } from '../../registry/params-check.js';
import { callSubagent, callSubagentStream } from '../subagent.js';
import type { ApiRouteDeps } from './helpers.js';

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

function extractJson(text: string): unknown {
  const m = text.match(/\{[\s\S]*\}/);
  const json = m ? m[0] : text;
  return JSON.parse(json);
}

export function registerAiRoutes({ route, sendJson, readJsonBody }: ApiRouteDeps): void {
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
}
