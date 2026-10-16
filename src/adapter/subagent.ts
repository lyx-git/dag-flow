// src/adapter/subagent.ts — AI 大模型节点调用
//
// ★ 2026-10-02 防腐层改造：dsh 配置 schema（settings.yaml / cordis.patch.yml /
//   .credentials.yaml 的 llm 键结构）收编 dsh-gate/llm-config.ts——dsh 改配置结构
//   时只改那边；本文件保留「怎么调用」（host 分发 + 直连 fetch 双路）与业务校验。
//   buildLlmCandidates / envFallbackEndpoint / ENV_LLM_* / LlmEndpoint 由防腐层
//   转发导出（llm-config.test.mjs 直接打包本文件断言，路径与符号不可变）。
//
// 调用链（2026-10-02 定档）：
//   1) host llm.chat 兼容探测（宿主若提供一次性 chat 则优先；0.2.0 实测无）
//   2) viaHost 端点 → ctx.llm.stream 分发（DSH 自带模型，Messages 协议由 host 适配器解决）
//   3) 方案 B 直连（OpenAI 兼容 /chat/completions，兼容 /v1/responses）——用户自定义模型

import { promises as fs } from 'node:fs';
import { humanizeFetchError } from './fetch-errors.js';
import { hostLlm as hostLlmRuntime } from '../dsh-gate/llm.js';
import {
  buildLlmCandidates,
  envFallbackEndpoint,
  SETTINGS_KEY_PI,
  type LlmEndpoint,
} from '../dsh-gate/llm-config.js';
import type { JsonValue, NodeResult } from '../types.js';
import { listAllEndpoints, resolveLlmEndpoint, SubagentUnavailableError } from './llm-endpoints.js';
import { checkModelModality, checkImageModality } from './llm-modality.js';
// ★ 2026-10-16 P1 多模态传图：宿主附件服务门面 + images 参数的解析/载入（纯函数 + IO，零依赖）
import { hostAttachments, type HostImageRef } from '../dsh-gate/attachments.js';
import { ImageInputError, countImageEntries, loadImageInputs, parseImageList } from './image-inputs.js';

// —— 防腐层转发导出（llm-config.test.mjs 从本模块断言这些符号；勿删） ——
export { buildLlmCandidates, envFallbackEndpoint, SETTINGS_KEY_PI };
export { ENV_LLM_BASEURL, ENV_LLM_KEY, ENV_LLM_MODEL } from '../dsh-gate/llm-config.js';
export type { LlmEndpoint };
// ★ 2026-10-14 重构轮 3：端点发现/解析拆到 ./llm-endpoints.ts、模态校验拆到 ./llm-modality.ts
//  （SubagentUnavailableError 类定义随之移入 llm-endpoints.ts，依赖保持单向）——
//  对外符号全部从本模块**原样再导出**，api.ts / 路由 / 测试的导入路径与符号不变。
export { listAllEndpoints, resolveLlmEndpoint, SubagentUnavailableError };
export { detectModalities, checkModelModality, checkImageModality, MODALITY_SCAN_MAX_CHARS } from './llm-modality.js';

interface SubagentOptions {
  prompt: string;
  model?: string;
  isolated?: boolean;
  agentPreset?: string;
  timeoutMs?: number;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  /** ★ 2026-10-16 P1：图片输入原始值（每行一个本地路径或 URL；容忍数组——上游 `{{img.out.images}}`） */
  images?: unknown;
  /** ★ 内部字段：已落盘到宿主附件服务的引用（由 runSubagentNode 备好，调用方不传） */
  imageRefs?: HostImageRef[];
  /** ★ 内部字段：与 imageRefs 对应的展示名（只用于 debug 面板） */
  imageNames?: string[];
}

interface SubagentResult {
  text: string;
  raw?: JsonValue;
  /** ★ AI 调试信息（2026-10-04 用户问「试跑本节点能不能当 LLM 调试面板」→ 把调试要看的都采集出来）：
   *  实际提示词（模板已展开）、模型/提供方、耗时、token 用量、结束原因、是否走宿主。 */
  debug?: SubagentDebug;
}

/** AI 节点调试信息（进 NodeResult.debug → 试跑面板 + 运行日志共用；**不进 out**，不污染数据流） */
interface SubagentDebug {
  /** 实际发出的提示词（模板已展开——这就是"AI 到底看到了什么"） */
  prompt: string;
  system?: string;
  /** 存值模型 id（workflow 里写的那个） */
  model: string;
  /** 实际提供方（host provider / settings provider 键名） */
  provider?: string;
  /** 显示名（宿主给的模型名） */
  modelLabel?: string;
  /** true = 走宿主 llm.stream；false = 直连 OpenAI 兼容端点 */
  viaHost: boolean;
  /** 本次调用耗时 */
  durationMs: number;
  /** 结束原因（stop / max-tokens / 直连的 finish_reason） */
  finishReason?: string;
  /** token 用量（宿主给 usage chunk 才有；直连读响应里的 usage） */
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  /** 请求的 maxTokens（配合 finishReason 判断"是不是被上限截断"） */
  maxTokens?: number;
  /** 返回文本长度 */
  textChars?: number;
  /** ★ 2026-10-16 P1：随本次调用一起发出去的图片（数量 + 文件名；空/缺省＝纯文本调用） */
  images?: { count: number; names: string[] };
}

const DEFAULT_TIMEOUT_MS = 120_000;

/** 组装 AI 调试信息（2026-10-04）：把"这次调用到底发生了什么"打包给上层（试跑面板 + 运行日志共用） */
function baseDebug(
  endpoint: LlmEndpoint,
  opts: SubagentOptions,
  rest: Pick<SubagentDebug, 'viaHost' | 'durationMs'> & Partial<Pick<SubagentDebug, 'finishReason' | 'usage' | 'textChars'>>,
): SubagentDebug {
  return {
    prompt: opts.prompt,
    ...(opts.system ? { system: opts.system } : {}),
    model: String(opts.model ?? endpoint.model ?? ''),
    ...(endpoint.providerName ? { provider: endpoint.providerName } : {}),
    ...(endpoint.modelLabel ? { modelLabel: endpoint.modelLabel } : {}),
    ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}),
    ...(opts.imageRefs?.length ? { images: { count: opts.imageRefs.length, names: opts.imageNames ?? [] } } : {}),
    ...rest,
  };
}

// ==================== 模型能力（多模态校验用）→ 已拆至 ./llm-modality.ts（2026-10-14 轮 3） ====================

function parseOpenAICompat(endpoint: LlmEndpoint): { baseURL: string; apiKey: string; model: string } {
  // OpenAI 兼容接口统一走 /chat/completions
  const base = String(endpoint.baseURL ?? '').replace(/\/+$/, '');
  return { baseURL: base, apiKey: endpoint.apiKey, model: endpoint.model };
}

// ==================== 端点发现/解析 → 已拆至 ./llm-endpoints.ts（2026-10-14 轮 3，符号经上方再导出） ====================

// ==================== 调用 ====================

/**
 * 直连 OpenAI 兼容接口调用大模型。
 * 自动探测协议：先试 /chat/completions（标准），再试 /v1/responses（Responses API）。
 * @returns 模型文本输出
 */
async function callOpenAICompatible(endpoint: LlmEndpoint, prompt: string, opts: SubagentOptions, signal: AbortSignal): Promise<{ text: string; usage?: SubagentDebug['usage']; finishReason?: string }> {
  const { baseURL, apiKey, model } = parseOpenAICompat(endpoint);
  if (!baseURL) throw new SubagentUnavailableError('端点 baseURL 为空');
  const messages = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  messages.push({ role: 'user', content: prompt });
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  };
  const body = {
    model,
    messages,
    max_tokens: opts.maxTokens ?? 4096,
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
  };
  const lastErr: string[] = [];
  /** OpenAI 兼容响应里的 usage → 统一形状（2026-10-04：AI 调试面板要显示 token 用量） */
  const usageOf = (u: unknown): SubagentDebug['usage'] | undefined => {
    if (!u || typeof u !== 'object') return undefined;
    const x = u as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; input_tokens?: number; output_tokens?: number };
    const input = x.input_tokens ?? x.prompt_tokens;
    const output = x.output_tokens ?? x.completion_tokens;
    if (input === undefined && output === undefined) return undefined;
    return { inputTokens: input, outputTokens: output, totalTokens: x.total_tokens ?? ((input ?? 0) + (output ?? 0)) };
  };

  // 路径 1：标准 /chat/completions
  try {
    const resp = await fetch(`${baseURL}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (resp.ok) {
      const data = (await resp.json()) as { choices?: { message?: { content?: string }; finish_reason?: string }[]; usage?: unknown };
      const text = data.choices?.[0]?.message?.content ?? '';
      if (text) return { text, usage: usageOf(data.usage), finishReason: data.choices?.[0]?.finish_reason };
    } else {
      let detail = '';
      try { detail = (await resp.text()).slice(0, 300); } catch { /* */ }
      lastErr.push(`chat/completions 接口返回 ${resp.status}: ${detail}`);
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    lastErr.push(`chat/completions 请求异常: ${humanizeFetchError(e)}`);
  }

  // 路径 2：Responses API（/v1/responses）
  const respBody = { model, input: prompt, max_output_tokens: opts.maxTokens ?? 4096 };
  for (const p of ['/v1/responses', '/responses']) {
    try {
      const resp = await fetch(`${baseURL}${p}`, { method: 'POST', headers, body: JSON.stringify(respBody), signal });
      if (resp.ok) {
        const data = (await resp.json()) as { output?: { content?: { type?: string; text?: string }[] }[]; usage?: unknown; status?: string };
        const text = (data.output ?? [])
          .flatMap((o) => o.content ?? [])
          .filter((c) => c.type === 'output_text' || c.type === 'text')
          .map((c) => c.text ?? '')
          .join('\n');
        if (text) return { text, usage: usageOf(data.usage), finishReason: data.status };
      } else {
        let detail = '';
        try { detail = (await resp.text()).slice(0, 300); } catch { /* */ }
        lastErr.push(`responses 接口返回 ${resp.status}（路径 ${p}）: ${detail}`);
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      lastErr.push(`responses 请求异常（路径 ${p}）: ${humanizeFetchError(e)}`);
    }
  }

  throw new SubagentUnavailableError(`LLM 调用失败: ${lastErr.join(' | ') || '没有任何端点响应'}`);
}

/** viaHost 端点执行：走 host llm.stream 分发（自带模型 Messages 协议/凭证全由 host 适配器解决）。
 *  onDelta 传入时逐段推送增量文本（流式路径复用）；返回聚合全文。 */
async function callViaHostLlm(endpoint: LlmEndpoint, opts: SubagentOptions, onDelta?: (delta: string) => void): Promise<{ text: string; usage?: SubagentDebug['usage']; finishReason?: string }> {
  const t0 = Date.now();
  let usage: SubagentDebug['usage'] | undefined;
  let finishReason: string | undefined;
  const llm = hostLlmRuntime();
  if (!llm || typeof llm.stream !== 'function') {
    throw new SubagentUnavailableError('host llm 服务不可用（未注入或无 stream 方法）');
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const parts: string[] = [];
  const seen: string[] = []; // ★ 收到的 chunk 摘要（诊断用：空流时把"到底收到了什么"写进错误消息）
  try {
    const stream = llm.stream({
      provider: endpoint.hostProvider,
      model: endpoint.model,
      ...(opts.system ? { system: opts.system } : {}),
      // ★ content 必须是**内容块数组**（dsh-llm 的 RequestUserInput.content = readonly ContentBlock[]，
      //   TextBlock = {type:'text',text}）。2026-10-03 前这里传的是字符串 → 宿主适配器校验失败 →
      //   finish{kind:'error',failure} → 被旧代码当正常结束 → 空输出。这是「AI 节点成功但正文为空」的真根因。
      // ★ 2026-10-16 P1（多模态传图）：图片以**内容块**形式与文本同处一条 user message
      //   （`{type:'image', attachment: ImageAttachmentRef}`）；base64/上传全由宿主适配器负责。
      //   没有 images 时数组就只有一个 text 块 ⇒ 纯文本路径的行为与改动前完全一致。
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: opts.prompt },
          ...(opts.imageRefs ?? []).map((ref) => ({ type: 'image', attachment: ref })),
        ],
      }],
      ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      signal: ac.signal,
    });
    for await (const chunk of stream) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text) {
        parts.push(chunk.text);
        onDelta?.(chunk.text);
      } else if (chunk?.type === 'finish') {
        // ★ host 的 finish 契约（2026-10-03 按 dsh-llm 的 FinishReasonMap 校正）：
        //   reason = { kind:'stop' | 'tool-calls' | 'max-tokens' } 或 { kind:'error'|'aborted', failure:LlmFailure }
        //   其中 LlmFailure = { message, code, status? }。
        //   旧实现同时犯两个错：①按**字符串** 'error' 判 kind（实际是对象）②读不存在的 `finish.error.message`
        //   → 任何宿主失败都被当成正常结束 → 节点 success + out=''（真机 9ms 空输出、落盘简报 AI 段全空）。
        const finish = chunk as unknown as { reason?: unknown; error?: { message?: string } };
        const reason = finish.reason;
        const kind = typeof reason === 'string'
          ? reason
          : (reason && typeof reason === 'object' ? String((reason as { kind?: unknown }).kind ?? '') : '');
        const failure = (reason && typeof reason === 'object'
          ? (reason as { failure?: { message?: string; code?: string; status?: number } }).failure
          : undefined);
        if (kind === 'error' || kind === 'aborted') {
          const bits = [
            failure?.code,
            failure?.message ?? finish.error?.message,
            failure?.status != null ? `HTTP ${failure.status}` : '',
          ].filter(Boolean);
          const detail = bits.length
            ? bits.join(' / ')
            : (typeof reason === 'string' ? '（host 没有提供错误详情）' : JSON.stringify(reason));
          throw new SubagentUnavailableError(`host llm.stream ${kind === 'aborted' ? '被中止' : '失败'}: ${detail}`);
        }
        finishReason = kind || (typeof reason === 'string' ? reason : JSON.stringify(reason));
        seen.push(`finish:${typeof reason === 'string' ? reason : JSON.stringify(reason)}`);
      } else if ((chunk as { type?: string })?.type === 'usage') {
        // ★ dsh-llm 的 usage chunk（适配器在 finish **之前**发出）：TokenUsage = { inputTokens, outputTokens, totalTokens? }
        //   —— 2026-10-04 从宿主类型定义里确认它存在，token 用量由此而来
        const u = (chunk as { usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } }).usage;
        if (u && typeof u === 'object') usage = { inputTokens: u.inputTokens, outputTokens: u.outputTokens, totalTokens: u.totalTokens };
      } else if (chunk?.type) {
        seen.push(String(chunk.type));
      }
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new SubagentUnavailableError(`AI 节点超时（${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms）`);
    }
    if (e instanceof SubagentUnavailableError) throw e;
    throw new SubagentUnavailableError(`host llm.stream 调用失败: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
  // ★ 空流不许当成功（2026-10-03，用户报「ai_summary 成功但正文为空」）：收集到空文本说明这轮调用
  //   没有任何输出，过去直接 return '' → 节点 success → 下游/落盘拿到空内容。这里显式抛错。
  const text = parts.join('');
  if (!text.trim()) {
    const detail = seen.length ? seen.join(',') : '（host 一个 chunk 都没产出）';
    // eslint-disable-next-line no-console
    console.warn(`[dag-flow] host llm.stream 空流：provider=${endpoint.hostProvider ?? '?'} model=${endpoint.model} chunks=[${detail}]`);
    throw new SubagentUnavailableError(`host llm.stream 未返回任何文本（provider=${endpoint.hostProvider ?? '?'} model=${endpoint.model}；收到的 chunk：${detail}）——请确认该模型在 dsh 里可用，或在节点「选择模型」里换一个`, 'SUBAGENT_EMPTY_OUTPUT');
  }
  return { text, usage, finishReason };
}

/** 业务代码调这个。内部决定走 DSH host、直连 fetch、还是抛 Unavailable。 */
export async function callSubagent(opts: SubagentOptions): Promise<SubagentResult> {
  // 路径 1：host.llm.chat（未来 dsh 提供则优先）
  // 2026-10-01：走 hostService（ctx.get）——裸 ctx.llm 在 0.2.0 会抛 without inject，
  // 且这行不在 try/catch 内，会让整个 AI 节点直接崩。实测 dsh 0.2.0 的 llm 服务是
  // LlmRuntime（listProviders/resolveModel/prepareCall…，没有 chat 方法）→ 这里恒为
  // undefined → 正常落到路径 2（方案 B 直连 fetch）。
  const hostLlm = hostLlmRuntime();
  const hostChat = hostLlm?.chat;
  if (typeof hostChat === 'function') {
    try {
      const raw = await hostChat.call(hostLlm, {
        prompt: opts.prompt,
        ...(opts.system ? { system: opts.system } : {}),
        ...(opts.model ? { model: opts.model } : {}),
      });
      const text = typeof raw === 'string' ? raw : (raw as { text?: string })?.text ?? '';
      return { text };
    } catch (e) {
      throw new SubagentUnavailableError(`host llm.chat 调用出错: ${(e as Error).message}`);
    }
  }

  // 路径 1.5（2026-10-02）：DSH 自带模型（viaHost 端点）→ ctx.llm.stream host 分发。
  // Messages 协议 / 账号 token / api-key / 重试全由 host 适配器解决——直连 fetch 无法承载。
  const endpoint = await resolveLlmEndpoint(opts.model);
  if (endpoint.viaHost) {
    const t0 = Date.now();
    const r = await callViaHostLlm(endpoint, opts);
    return { text: r.text, debug: baseDebug(endpoint, opts, { viaHost: true, durationMs: Date.now() - t0, finishReason: r.finishReason, usage: r.usage, textChars: r.text.length }) };
  }

  // ★ 2026-10-16 P1：图片只能经宿主附件服务 + 宿主适配器发出；直连（用户自定义 OpenAI 兼容模型）
  //   拿不到 attachments 服务、也组不出 image 内容块 ⇒ **明确失败**，绝不静默把图丢掉。
  if (opts.imageRefs?.length) {
    throw new SubagentUnavailableError(
      '当前模型走直连调用（非 dsh 宿主路由），不支持图片输入——请换一个 dsh 里的模型（下拉里带「· 📷 图片」的），或清空 images 参数',
      'IMAGE_DIRECT_UNSUPPORTED',
    );
  }

  // 路径 2（方案 B）：直连 DSH 已配 LLM / 用户自定义模型
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const t1 = Date.now();
  try {
    const r = await callOpenAICompatible(endpoint, opts.prompt, opts, ac.signal);
    return { text: r.text, debug: baseDebug(endpoint, opts, { viaHost: false, durationMs: Date.now() - t1, finishReason: r.finishReason, usage: r.usage, textChars: r.text.length }) };
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new SubagentUnavailableError(`AI 节点超时（${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms）`);
    }
    if (e instanceof SubagentUnavailableError) throw e;
    throw new SubagentUnavailableError(`AI 节点调用失败: ${(e as Error).message}`);
  } finally {
    clearTimeout(t);
  }
}

/**
 * 流式版（A8）：调用 LLM 并把增量文本通过 onDelta 回调推送。
 * 走 /chat/completions + stream:true（SSE）；失败时回退非流式 callSubagent。
 */
export async function callSubagentStream(
  opts: SubagentOptions,
  onDelta: (delta: string) => void,
): Promise<SubagentResult> {
  // host 优先（与 callSubagent 路径 1 对齐，09-27 审计意见 3）：宿主提供 llm.chat 时
  // 流式也走 host——host 接口无增量语义，整段文本一次性推送。
  const hostLlm = hostLlmRuntime();
  const hostChat = hostLlm?.chat;
  if (typeof hostChat === 'function') {
    try {
      const raw = await hostChat.call(hostLlm, {
        prompt: opts.prompt,
        ...(opts.system ? { system: opts.system } : {}),
        ...(opts.model ? { model: opts.model } : {}),
      });
      const text = typeof raw === 'string' ? raw : (raw as { text?: string })?.text ?? '';
      if (text) onDelta(text);
      return { text };
    } catch (e) {
      throw new SubagentUnavailableError(`host llm.chat 调用出错: ${(e as Error).message}`);
    }
  }

  // ★ viaHost 端点（DSH 自带模型）：走 host llm.stream，真实流式增量（2026-10-02）
  const endpoint = await resolveLlmEndpoint(opts.model);
  if (endpoint.viaHost) {
    const t0 = Date.now();
    const r = await callViaHostLlm(endpoint, opts, onDelta);
    return { text: r.text, debug: baseDebug(endpoint, opts, { viaHost: true, durationMs: Date.now() - t0, finishReason: r.finishReason, usage: r.usage, textChars: r.text.length }) };
  }

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const { baseURL, apiKey, model } = parseOpenAICompat(endpoint);
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` };
    const body = {
      model,
      stream: true,
      messages: [
        ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
        { role: 'user', content: opts.prompt },
      ],
      ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
      ...(opts.maxTokens != null ? { max_tokens: opts.maxTokens } : {}),
    };
    const resp = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST', headers, body: JSON.stringify(body), signal: ac.signal,
    });
    if (!resp.ok || !resp.body) throw new Error(`流式响应错误（HTTP ${resp.status}）`);
    const reader = (resp.body as unknown as { getReader: () => { read: () => Promise<{ done: boolean; value?: Uint8Array }> } }).getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let full = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;
        const payload = s.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const j = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
          const delta = j.choices?.[0]?.delta?.content ?? '';
          if (delta) { full += delta; onDelta(delta); }
        } catch { /* keep-alive 注释行等忽略 */ }
      }
    }
    if (!full) throw new Error('流式响应为空');
    return { text: full };
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new SubagentUnavailableError(`AI 节点超时（${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms）`);
    }
    // 流式失败 → 回退非流式（保证功能可用）
    try {
      return await callSubagent(opts);
    } catch (e2) {
      throw new SubagentUnavailableError(`AI 节点流式调用失败: ${(e2 as Error).message}`);
    }
  } finally {
    clearTimeout(t);
  }
}

/** ★ 2026-10-16 P1（多模态传图）：images 参数 → 宿主附件服务里的图片引用。
 *  空值 ⇒ 空数组（纯文本路径零变化）；非法项**抛 ImageInputError**（明确失败，不静默丢图）。 */
async function prepareImageRefs(images: unknown): Promise<{ imageRefs: HostImageRef[]; imageNames: string[] }> {
  const specs = parseImageList(images);          // 纯函数：格式/数量校验
  if (specs.length === 0) return { imageRefs: [], imageNames: [] };
  const svc = hostAttachments();
  if (!svc || typeof svc.saveImages !== 'function') {
    throw new ImageInputError('IMAGE_ATTACH_UNAVAILABLE', '宿主附件服务不可用，无法传图——请重启 dsh web（插件启动日志里应有「attachments ok」那一行），或清空 images 后重试');
  }
  const inputs = await loadImageInputs(specs);   // 本地读 / URL 下载 + 大小校验
  const refs = await svc.saveImages(inputs);     // 宿主内容寻址入库（同图自动去重）
  return { imageRefs: [...refs], imageNames: inputs.map((i) => i.name) };
}

/** 包装成 NodeResult（节点用）。 */
export async function runSubagentNode(
  params: { prompt: string; model?: string; isolated?: boolean; agentPreset?: string; timeoutMs?: number; system?: string; images?: unknown },
): Promise<NodeResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  try {
    const endpoint = await resolveLlmEndpoint(params.model);
    // 多模态提前校验：prompt 引用图片/视频/文件而模型能力不含对应模态 → 明确失败并提示（不浪费一次 LLM 调用）
    const modalityHint = checkModelModality(endpoint, params.prompt ?? '');
    if (modalityHint) {
      return {
        status: 'failed',
        error: { code: 'MODEL_MODALITY_MISMATCH', message: modalityHint },
        durationMs: Date.now() - t0,
        startedAt,
        endedAt: new Date().toISOString(),
      };
    }
    // ★ 2026-10-16 P2（**不静默降级**）：再按 `images` 的**真实条数**判一次模态——
    //   配了图而模型不支持图片输入时**直接失败**（既不发一次注定丢图的调用，也不静默只发文本）。
    //   与上面那条 prompt 扫描互补：那条防"让模型读文件"白跑，这条防"图被静默丢掉"。
    const imageCount = countImageEntries(params.images);
    const imageHint = checkImageModality(endpoint, imageCount);
    if (imageHint) {
      return {
        status: 'failed',
        error: { code: 'MODEL_MODALITY_MISMATCH', message: imageHint },
        durationMs: Date.now() - t0,
        startedAt,
        endedAt: new Date().toISOString(),
      };
    }
    // ★ 2026-10-16 P1：真传图——images 解析 → 读字节/下载 → 落盘宿主附件服务 → 引用随本次调用发出
    const { imageRefs, imageNames } = await prepareImageRefs(params.images);
    const r = await callSubagent({ ...params, imageRefs, imageNames });
    // ★ 空输出兜底（2026-10-03）：任何调用路径拿到空文本都不许报成功——否则下游静默拿到空数据
    //   （演示工作流落盘简报的「AI 简报正文」段就是全空）。code=SUBAGENT_EMPTY_OUTPUT。
    if (!String(r.text ?? '').trim()) {
      return {
        status: 'failed',
        error: { code: 'SUBAGENT_EMPTY_OUTPUT', message: 'AI 节点返回空内容（模型没有输出）——已不再按成功处理；请换一个可用模型，或检查 prompt/上游数据是否为空' },
        durationMs: Date.now() - t0,
        startedAt,
        endedAt: new Date().toISOString(),
      };
    }
    return {
      status: 'success',
      out: r.text,
      // ★ AI 调试信息（2026-10-04）：prompt/模型/token 用量/结束原因——试跑面板与运行日志共用
      ...(r.debug ? { debug: r.debug as unknown as JsonValue } : {}),
      durationMs: Date.now() - t0,
      startedAt,
      endedAt: new Date().toISOString(),
    };
  } catch (e) {
    return {
      status: 'failed',
      // 带 code 的用带过来的（如空输出的 SUBAGENT_EMPTY_OUTPUT），其余归 SUBAGENT_UNAVAILABLE
      error: { code: (e as SubagentUnavailableError).code ?? 'SUBAGENT_UNAVAILABLE', message: (e as Error).message },
      durationMs: Date.now() - t0,
      startedAt,
      endedAt: new Date().toISOString(),
    };
  }
}
