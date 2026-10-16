// src/registry/nodes/ai.ts — AI/媒体生成节点：subagent / image_generate / video_generate
// subagent 调 ../../adapter/subagent（dsh 配置的模型，多模态提前校验）；image/video 走 HTTP API + assets 落盘。
// 拆分自 builtin.ts（2026-10-14 重构轮 1，纯搬运）。

import type { Context, NodeDefinition, NodeResult, JsonValue } from '../../types.js';
import { makeResult, safeNodeRun } from '../external.js';
import { runSubagentNode } from '../../adapter/subagent.js';
import { saveAsset, downloadAsset } from '../../adapter/assets.js';
import { humanizeFetchError } from '../../adapter/fetch-errors.js';
import { startedEnded, finish } from './shared.js';

// ---------- subagent ----------
interface SubagentParams { prompt: string; model?: string; isolated?: boolean; agentPreset?: string; timeoutMs?: number; system?: string; images?: string }
export const subagentDef: NodeDefinition<SubagentParams> = {
  type: 'subagent',
  schema: {
    type: 'object',
    required: ['prompt', 'model'],
    additionalProperties: false,
    properties: {
      prompt: { type: 'string', minLength: 1 },
      model: { type: 'string', description: '必填：dsh 已配置的模型 id（如 dsh:glm-5.3-flash），缺模型节点不执行' },
      isolated: { type: 'boolean' },
      agentPreset: { type: 'string' },
      system: { type: 'string' },
      timeoutMs: { type: 'integer', minimum: 1, maximum: 600_000 },
      // ★ 2026-10-16 P1（多模态传图）：每行一个本地路径或 URL；只支持 png/jpeg/webp/gif、≤20 张、单张 ≤20MB。
      //   留空 = 纯文本调用（与加这个参数之前的行为完全一致）。真正发出图片需要走宿主模型路由。
      images: {
        type: 'string',
        description: '图片输入：每行一个本地路径或 http(s) URL（png/jpeg/webp/gif，最多 20 张、单张不超 20MB）。相对路径以统一图片目录 <DSH_HOME>/.dag-flow/images/ 为基准（写文件名即可），也兼容 .dag-flow/images/x.png 这类相对 <DSH_HOME> 的写法（上游 image_generate 的 out.images[].path 就是这个形态）；留空则按纯文本调用',
      },
    },
  },
  run: async (_ctx, p) => safeNodeRun(async () => {
    // 模型必选：未选执行模型 → 不调 LLM，明确失败（上层 UI 已拦截，此处为执行层兜底）
    if (!String(p.model ?? '').trim()) {
      const { startedAt, t0 } = startedEnded();
      return { ...makeResult('failed', { error: { code: 'MODEL_REQUIRED', message: '未选择执行模型——在节点配置的「选择模型」中选择 dsh 已配置的模型后重试' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    }
    // 留空不执行：prompt 为空（未填或上游引用解析为空）→ 节点失败并中断流程（默认 stop 语义），
    // 避免拿着空提示词浪费一次 LLM 调用、生成无意义内容
    if (!String(p.prompt ?? '').trim()) {
      const { startedAt, t0 } = startedEnded();
      return { ...makeResult('failed', { error: { code: 'SUBAGENT_EMPTY_PROMPT', message: 'prompt 为空——AI 节点未执行，流程已在此中断。检查上游输出是否为空，或填入提示词后重试' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    }
    return runSubagentNode(p);
  }),
  describe: () => ({ label: 'AI 子代理', category: 'ai' }),
};

// ---------- image_generate（#多模态：图片生成，OpenAI images 兼容） ----------
interface ImageGenParams {
  prompt: string; baseURL: string; model?: string; apiKey?: string; apiKeyEnv?: string;
  size?: string; n?: number; filenamePrefix?: string; timeoutMs?: number;
}
/** 从 JsonValue 按点路径取值（'output.task_id'） */
function getPath(v: unknown, dotPath: string): unknown {
  let cur: unknown = v;
  for (const k of dotPath.split('.').filter(Boolean)) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}
async function runImageGen(p: ImageGenParams, ctx: Context): Promise<NodeResult> {
  const { startedAt, t0 } = startedEnded();
  if (!p.prompt?.trim()) return { ...makeResult('failed', { error: { code: 'IMAGE_NO_PROMPT', message: 'prompt 为空——填入画面描述后再试' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  if (!p.baseURL?.trim()) return { ...makeResult('failed', { error: { code: 'IMAGE_NO_BASEURL', message: 'baseURL 为空——填图片 API 地址（如 https://dashscope.aliyuncs.com/compatible-mode/v1）' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  const apiKey = p.apiKey || (p.apiKeyEnv ? process.env[p.apiKeyEnv] || '' : '');
  if (!apiKey) return { ...makeResult('failed', { error: { code: 'IMAGE_NO_KEY', message: '缺少 API Key——填 apiKey，或填 apiKeyEnv 引用环境变量' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  const ac = new AbortController();
  const timeoutMs = p.timeoutMs ?? 120_000;
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const url = `${p.baseURL.replace(/\/+$/, '')}/images/generations`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: p.model ?? 'wanx-v1', prompt: p.prompt, size: p.size ?? '1024*1024', n: Math.min(p.n ?? 1, 4) }),
      signal: ac.signal,
    });
    const text = await resp.text();
    if (!resp.ok) return { ...makeResult('failed', { error: { code: 'IMAGE_API_ERROR', message: `图片 API 错误（HTTP ${resp.status}）: ${text.slice(0, 200)}` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    const data = JSON.parse(text) as { data?: { url?: string; b64_json?: string }[] };
    const items = data.data ?? [];
    if (items.length === 0) return { ...makeResult('failed', { error: { code: 'IMAGE_EMPTY', message: `API 未返回图片：${text.slice(0, 200)}` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    const images: { url?: string; path: string; bytes: number }[] = [];
    const prefix = p.filenamePrefix ?? 'image';
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      const fname = `${prefix}-${Date.now()}-${i}.png`;
      if (it.url) {
        const saved = await downloadAsset(it.url, fname);
        images.push({ url: it.url, path: saved.relativePath, bytes: saved.bytes });
      } else if (it.b64_json) {
        const saved = await saveAsset(fname, it.b64_json, 'base64');
        images.push({ path: saved.relativePath, bytes: saved.bytes });
      }
    }
    if (images.length === 0) return { ...makeResult('failed', { error: { code: 'IMAGE_SAVE_FAILED', message: 'API 返回的图片既无 url 也无 b64_json' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    void ctx;
    return finish(t0, startedAt, { out: { images, count: images.length } });
  } catch (e) {
    if ((e as Error).name === 'AbortError') return { ...makeResult('failed', { error: { code: 'IMAGE_TIMEOUT', message: `图片生成超时（${timeoutMs}ms）` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    return { ...makeResult('failed', { error: { code: 'IMAGE_ERROR', message: humanizeFetchError(e) } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  } finally {
    clearTimeout(t);
  }
}
export const imageGenDef: NodeDefinition<ImageGenParams> = {
  type: 'image_generate',
  schema: {
    type: 'object', required: ['prompt', 'baseURL'], additionalProperties: false,
    properties: {
      prompt: { type: 'string', minLength: 1 },
      baseURL: { type: 'string', minLength: 1 },
      model: { type: 'string' },
      apiKey: { type: 'string' }, apiKeyEnv: { type: 'string' },
      size: { type: 'string' }, n: { type: 'integer', minimum: 1, maximum: 4 },
      filenamePrefix: { type: 'string' }, timeoutMs: { type: 'integer', minimum: 1000 },
    },
  },
  run: async (ctx, p) => safeNodeRun(() => runImageGen(p as never, ctx)),
  describe: () => ({ label: '图片生成', category: 'media' }),
};

// ---------- video_generate（#多模态：视频生成，通用异步任务模式） ----------
interface VideoGenParams {
  submitUrl: string; submitMethod?: string; submitHeaders?: Record<string, string>; submitBody?: Record<string, JsonValue>;
  taskIdPath?: string; pollUrl: string; pollHeaders?: Record<string, string>;
  pollIntervalMs?: number; maxWaitMs?: number;
  statusPath?: string; doneValue?: string;
  videoUrlPath?: string; filename?: string; apiKey?: string; apiKeyEnv?: string;
}
async function runVideoGen(p: VideoGenParams, ctx: Context): Promise<NodeResult> {
  const { startedAt, t0 } = startedEnded();
  const apiKey = p.apiKey || (p.apiKeyEnv ? process.env[p.apiKeyEnv] || '' : '');
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(p.submitHeaders ?? {}) };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  if (!p.submitUrl?.trim()) return { ...makeResult('failed', { error: { code: 'VIDEO_NO_SUBMIT', message: 'submitUrl 为空——填视频 API 的任务提交地址' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  if (!p.pollUrl?.trim()) return { ...makeResult('failed', { error: { code: 'VIDEO_NO_POLL', message: 'pollUrl 为空——填任务查询地址（可含 {taskId} 占位）' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  const interval = Math.max(p.pollIntervalMs ?? 5_000, 1_000);
  const maxWait = Math.max(p.maxWaitMs ?? 600_000, interval);
  const statusPath = p.statusPath ?? 'output.task_status';
  const doneValue = p.doneValue ?? 'succeeded';
  const videoUrlPath = p.videoUrlPath ?? 'output.video_url';
  try {
    // 1. 提交任务
    const sr = await fetch(p.submitUrl, {
      method: p.submitMethod ?? 'POST', headers,
      body: JSON.stringify(p.submitBody ?? {}),
    });
    const stext = await sr.text();
    if (!sr.ok) return { ...makeResult('failed', { error: { code: 'VIDEO_SUBMIT_ERROR', message: `任务提交失败（HTTP ${sr.status}）: ${stext.slice(0, 200)}` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    const sjson = JSON.parse(stext) as unknown;
    const taskId = String(getPath(sjson, p.taskIdPath ?? 'output.task_id') ?? '');
    if (!taskId) return { ...makeResult('failed', { error: { code: 'VIDEO_NO_TASK', message: `提交响应中未找到任务 ID（taskIdPath 不对？）：${stext.slice(0, 200)}` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    // 2. 轮询（节点内循环，画布外避免环）
    const pollHeaders: Record<string, string> = { ...(p.pollHeaders ?? {}) };
    if (apiKey && !pollHeaders.authorization) pollHeaders.authorization = `Bearer ${apiKey}`;
    const deadline = Date.now() + maxWait;
    let lastStatus = '';
    let videoUrl = '';
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval));
      if (ctx.signal?.aborted) return { ...makeResult('failed', { error: { code: 'RUN_CANCELLED', message: '视频轮询期间运行被取消' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
      const pollUrl = p.pollUrl.includes('{taskId}') ? p.pollUrl.replace('{taskId}', encodeURIComponent(taskId)) : p.pollUrl;
      const pr = await fetch(pollUrl, { headers: pollHeaders });
      const pj = await pr.json().catch(() => ({})) as unknown;
      lastStatus = String(getPath(pj, statusPath) ?? '');
      const vu = getPath(pj, videoUrlPath);
      if (typeof vu === 'string' && vu) videoUrl = vu;
      if (videoUrl || (lastStatus && lastStatus !== 'running' && lastStatus !== 'pending' && lastStatus !== 'PENDING' && lastStatus !== 'RUNNING' && lastStatus !== doneValue)) break;
    }
    if (!videoUrl) {
      return { ...makeResult('failed', { error: { code: 'VIDEO_NOT_READY', message: `轮询 ${Math.round(maxWait / 1000)}s 后仍未完成（最后状态：${lastStatus || 'unknown'}）。增大 maxWaitMs 或检查任务状态` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    }
    // 3. 下载视频到 .dag-flow/ 产出目录
    const saved = await downloadAsset(videoUrl, p.filename ?? `video-${Date.now()}.mp4`);
    return finish(t0, startedAt, {
      out: { taskId, videoUrl, path: saved.relativePath, bytes: saved.bytes, waitedMs: Date.now() - t0 },
    });
  } catch (e) {
    return { ...makeResult('failed', { error: { code: 'VIDEO_ERROR', message: humanizeFetchError(e) } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }
}
export const videoGenDef: NodeDefinition<VideoGenParams> = {
  type: 'video_generate',
  schema: {
    type: 'object', required: ['submitUrl', 'pollUrl'], additionalProperties: false,
    properties: {
      submitUrl: { type: 'string', minLength: 1 },
      submitMethod: { type: 'string' },
      submitHeaders: { type: 'object', additionalProperties: { type: 'string' } },
      submitBody: { type: 'object', additionalProperties: true },
      taskIdPath: { type: 'string' },
      pollUrl: { type: 'string', minLength: 1 },
      pollHeaders: { type: 'object', additionalProperties: { type: 'string' } },
      pollIntervalMs: { type: 'integer', minimum: 1000 },
      maxWaitMs: { type: 'integer', minimum: 1000 },
      statusPath: { type: 'string' }, doneValue: { type: 'string' },
      videoUrlPath: { type: 'string' }, filename: { type: 'string' },
      apiKey: { type: 'string' }, apiKeyEnv: { type: 'string' },
    },
  },
  run: async (ctx, p) => safeNodeRun(() => runVideoGen(p as never, ctx)),
  describe: () => ({ label: '视频生成', category: 'media' }),
};
