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
  discoverSettingsEndpoints,
  readLlmConfigFiles,
  buildLlmCandidates,
  envFallbackEndpoint,
  SETTINGS_KEY_PI,
  type LlmEndpoint,
} from '../dsh-gate/llm-config.js';
import type { JsonValue, NodeResult } from '../types.js';

// —— 防腐层转发导出（llm-config.test.mjs 从本模块断言这些符号；勿删） ——
export { buildLlmCandidates, envFallbackEndpoint, SETTINGS_KEY_PI };
export { ENV_LLM_BASEURL, ENV_LLM_KEY, ENV_LLM_MODEL } from '../dsh-gate/llm-config.js';
export type { LlmEndpoint };

export interface SubagentOptions {
  prompt: string;
  model?: string;
  isolated?: boolean;
  agentPreset?: string;
  timeoutMs?: number;
  system?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface SubagentResult {
  text: string;
  raw?: JsonValue;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export class SubagentUnavailableError extends Error {
  constructor(reason: string) {
    super(`subagent unavailable: ${reason}`);
    this.name = 'SubagentUnavailableError';
  }
}

// ==================== 模型能力（多模态校验用） ====================

/** 模态 → 触发扩展名（prompt 中引用此类文件而模型不支持对应模态时提示） */
const MODALITY_EXTS: Record<string, RegExp> = {
  image: /\.(png|jpe?g|gif|webp|bmp|svg|ico|tiff?)\b/gi,
  video: /\.(mp4|mov|avi|mkv|webm|flv|wmv|m4v)\b/gi,
  file: /\.(pdf|docx?|xlsx?|pptx?|csv|txt|zip|rar|7z)\b/gi,
};

/** 从文本中检测引用的多模态类型集合（image/video/file） */
export function detectModalities(text: string): string[] {
  const out = new Set<string>();
  for (const [modality, re] of Object.entries(MODALITY_EXTS)) {
    re.lastIndex = 0;
    if (re.test(String(text))) out.add(modality);
  }
  return [...out];
}

/**
 * 运行前模态校验：prompt 引用了图片/视频/文件，而所选模型的 input 能力不含对应模态 → 返回提示消息；通过返回 null。
 * input 未标注的模型按 dsh 语义视为仅文本（['text']）。
 */
export function checkModelModality(endpoint: Pick<LlmEndpoint, 'input' | 'model' | 'providerName'>, prompt: string): string | null {
  const needed = detectModalities(prompt);
  if (needed.length === 0) return null;
  const caps = endpoint.input?.length ? endpoint.input : ['text'];
  const missing = needed.filter((m) => !caps.includes(m));
  if (missing.length === 0) return null;
  const label: Record<string, string> = { image: '图片', video: '视频', file: '文件' };
  const missingLabel = missing.map((m) => label[m] ?? m).join('、');
  const suggest = missing.includes('image') ? '（如 dsh:custom-model:kimi-k3 / minimax-m3）' : '';
  return `所选模型 ${endpoint.providerName ?? endpoint.model} 不支持${missingLabel}输入（能力: ${caps.join(', ')}）——prompt 中引用了${missingLabel}文件。请换支持对应模态的模型${suggest}，或在 dsh settings.yaml 为该模型标注 input: [text, image]`;
}

function parseOpenAICompat(endpoint: LlmEndpoint): { baseURL: string; apiKey: string; model: string } {
  // OpenAI 兼容接口统一走 /chat/completions
  const base = String(endpoint.baseURL ?? '').replace(/\/+$/, '');
  return { baseURL: base, apiKey: endpoint.apiKey, model: endpoint.model };
}

/**
 * 列出所有可用 LLM endpoint（2026-10-02 起三源合并）：
 *   ①★ host llm 服务发现（ctx.llm.listProviders × listModels）——DSH 自带模型
 *      （deepseek-account / deepseek-official 的内置目录）与全部已注册自定义 provider，
 *      与 DSH 自己的模型选择器同源；viaHost=true 标记，执行走 ctx.llm.stream 分发；
 *   ②settings.yaml/patch 直读（历史兜底，host llm 不可用时仍是全部来源）；
 *   ③环境变量兜底端点附在末尾。
 * 供设置页/节点选择器展示。用户自定义模型来源已移除（模型/密钥统一取自 dsh）。
 */
let _structureWarned = false; // 结构异常告警每次进程只发一次（避免 /models 反复拉取时刷屏）

export async function listAllEndpoints(): Promise<LlmEndpoint[]> {
  const out: LlmEndpoint[] = [];
  const seen = new Set<string>(); // providerName 去重（host 发现优先，直读补缺）
  // ① host llm 服务发现（自带模型 + 已注册自定义 provider）
  try {
    const llm = hostLlmRuntime();
    if (llm && typeof llm.listProviders === 'function' && typeof llm.listModels === 'function') {
      for (const p of await llm.listProviders()) {
        if (!p?.id) continue;
        try {
          for (const m of await llm.listModels(p.id)) {
            if (!m?.id) continue;
            const name = `llm:${p.id}:${m.id}`;
            if (seen.has(name)) continue;
            seen.add(name);
            out.push({
              baseURL: '',
              apiKey: '',
              model: m.id,
              providerName: name,
              input: Array.isArray(m.inputModalities) && m.inputModalities.length > 0
                ? (m.inputModalities.includes('text') ? [...m.inputModalities] : ['text', ...m.inputModalities])
                : ['text'],
              viaHost: true,
              hostProvider: p.id,
            });
          }
        } catch { /* 单 provider 发现失败不影响其余（如未登录账号） */ }
      }
    }
  } catch { /* host llm 不可用 → ② 仍可列出直读模型 */ }
  // ② settings.yaml / profile patch 直读（历史来源；host llm 缺席时的全部来源）
  const { settings, creds } = await readLlmConfigFiles();
  try {
    for (const ep of buildLlmCandidates(settings, creds)) {
      const name = ep.providerName ?? `${ep.model}`;
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(ep);
    }
  } catch { /* 忽略 */ }
  // 结构变化告警：llm-pi-ai 键存在但（直读+host）合计 0 个模型 → 大概率 dsh 改了 settings.yaml 结构，
  // yaml-lite 解析失败被静默吞掉。只在进程内告警一次。
  if (!_structureWarned && settings[SETTINGS_KEY_PI] != null && out.length === 0) {
    _structureWarned = true;
    // eslint-disable-next-line no-console
    console.warn('[dag-flow] dsh 配置（settings.yaml / profile cordis.patch.yml）存在 llm-pi-ai 段，但未解析出任何可用模型——dsh 的配置结构可能已变化。请检查 llm-pi-ai.providers[*].models 的字段形态（id/name），或把配置文件发给 dag-flow 维护者适配新结构');
  }
  // ③ 环境变量兜底端点附在末尾（dsh 发现的模型优先展示；放在告警判定之后，不吞掉 0 端点告警）
  const envEp = envFallbackEndpoint();
  if (envEp && !seen.has(envEp.providerName ?? '')) out.push(envEp);
  return out;
}

/**
 * 从 dsh 配置解析 LLM 端点，返回第一个可用 endpoint（或 host/env 兜底）；
 * 没有则抛 SubagentUnavailableError。
 * host.llm.chat 探测不在这里做（09-27 审计意见 3：删除原"短路返回空 endpoint"的坑——
 * 该空 endpoint 进入 callOpenAICompatible 必抛"baseURL 为空"，且流式路径不经过它，
 * 未来宿主真提供 llm.chat 时两路径行为矛盾）。host 优先统一在 callSubagent /
 * callSubagentStream 入口处理。
 * 若传入 modelId（节点选择的具体模型，如 dsh:custom-model:glm-5.3-flash），优先匹配它。
 */
export async function resolveLlmEndpoint(modelId?: string): Promise<LlmEndpoint> {
  // 1. modelId 明确指定时，优先匹配 dsh 发现的模型
  //    ★ 2026-10-02 方案B（修 viaHost 死代码 + AI 节点 404）：匹配源改为三源全量 listAllEndpoints
  //    （含 host 发现源）——此前只查 settings 直读源，下拉里的 llm:* host 模型永远匹配不上 →
  //    静默落到第一个直读端点（可能是 anthropic-messages 协议）→ 直连 404。
  if (modelId) {
    try {
      const all = await listAllEndpoints();
      const named = (e: LlmEndpoint) =>
        e.providerName === modelId || `dsh:${e.providerName}` === modelId || `dsh:${e.model}` === modelId;
      // ① host 发现源优先（viaHost=true：hostProvider 权威；baseURL 为空是合法形态，不能拒）
      const hostHit = all.find((e) => e.viaHost === true && (named(e) || e.model === modelId));
      if (hostHit) return hostHit;
      // ② settings/patch 直读源（防腐层已给 anthropic-messages 等非兼容协议标 viaHost，会落入①）
      const cfgHit = all.find((e) => !e.viaHost && named(e));
      if (cfgHit && cfgHit.baseURL && cfgHit.model) return cfgHit;
      // ③ 裸模型名兜底（settings 源，OpenAI 兼容才直连）
      const bareHit = all.find((e) => !e.viaHost && e.model === modelId);
      if (bareHit && bareHit.baseURL) return bareHit;
      // ④ 指定了模型但三源都没有 → 明确报错（不再静默改用其他端点——「选了A用B」陷阱）
      throw new SubagentUnavailableError(`未找到模型 "${modelId}"——请打开节点「选择模型」从 dsh 当前可用模型中重新选择`);
    } catch (e) {
      if (e instanceof SubagentUnavailableError) throw e;
      /* listAllEndpoints 意外异常 → 忽略，走下方直读兜底 */
    }
  }

  // 2. 读配置（settings.yaml 与 profile patch 合并源；0.2.0 起仅 patch 源也正常）
  //    读不到任何配置 → 走到末尾统一报错；creds 可选
  const { settings, creds } = await readLlmConfigFiles();

  // 3. 组装候选（schema 逻辑集中在防腐层 buildLlmCandidates）
  const candidates = buildLlmCandidates(settings, creds);

  // 4. 选第一个带 key 的 endpoint（优先），否则第一个有 baseURL 的
  const usable = candidates.find((c) => c.baseURL && c.apiKey) ?? candidates.find((c) => c.baseURL);
  if (usable) return usable;

  // 5. 逃生舱（09-27 用户拍板方案 C）：dsh 直读无可用端点时，环境变量兜底——
  //    dsh 发现仍是首选，本分支只在 settings/credentials 均无可用端点时生效。
  const envEp = envFallbackEndpoint();
  if (envEp) return envEp;

  throw new SubagentUnavailableError('dsh 配置（settings.yaml / profile cordis.patch.yml）中没有可用的 LLM 端点（可设 DAG_FLOW_LLM_BASEURL / DAG_FLOW_LLM_KEY / DAG_FLOW_LLM_MODEL 环境变量兜底）');
}

// ==================== 调用 ====================

/**
 * 直连 OpenAI 兼容接口调用大模型。
 * 自动探测协议：先试 /chat/completions（标准），再试 /v1/responses（Responses API）。
 * @returns 模型文本输出
 */
async function callOpenAICompatible(endpoint: LlmEndpoint, prompt: string, opts: SubagentOptions, signal: AbortSignal): Promise<string> {
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

  // 路径 1：标准 /chat/completions
  try {
    const resp = await fetch(`${baseURL}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (resp.ok) {
      const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
      const text = data.choices?.[0]?.message?.content ?? '';
      if (text) return text;
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
        const data = (await resp.json()) as { output?: { content?: { type?: string; text?: string }[] }[] };
        const text = (data.output ?? [])
          .flatMap((o) => o.content ?? [])
          .filter((c) => c.type === 'output_text' || c.type === 'text')
          .map((c) => c.text ?? '')
          .join('\n');
        if (text) return text;
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
async function callViaHostLlm(endpoint: LlmEndpoint, opts: SubagentOptions, onDelta?: (delta: string) => void): Promise<string> {
  const llm = hostLlmRuntime();
  if (!llm || typeof llm.stream !== 'function') {
    throw new SubagentUnavailableError('host llm 服务不可用（未注入或无 stream 方法）');
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const parts: string[] = [];
  try {
    const stream = llm.stream({
      provider: endpoint.hostProvider,
      model: endpoint.model,
      ...(opts.system ? { system: opts.system } : {}),
      messages: [{ role: 'user', content: opts.prompt }],
      ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      signal: ac.signal,
    });
    for await (const chunk of stream) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text) {
        parts.push(chunk.text);
        onDelta?.(chunk.text);
      } else if (chunk?.type === 'finish') {
        // host 把适配器失败归一成 finish{reason:'error'|'aborted', error}——转成显式失败，避免静默空输出
        const finish = chunk as unknown as { reason?: unknown; error?: { message?: string } };
        if (finish.reason === 'error' && finish.error?.message) {
          throw new SubagentUnavailableError(`host llm.stream 失败: ${finish.error.message}`);
        }
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
  return parts.join('');
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
    const text = await callViaHostLlm(endpoint, opts);
    return { text };
  }

  // 路径 2（方案 B）：直连 DSH 已配 LLM / 用户自定义模型
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const text = await callOpenAICompatible(endpoint, opts.prompt, opts, ac.signal);
    return { text };
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
    const text = await callViaHostLlm(endpoint, opts, onDelta);
    return { text };
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

/** 包装成 NodeResult（节点用）。 */
export async function runSubagentNode(
  params: { prompt: string; model?: string; isolated?: boolean; agentPreset?: string; timeoutMs?: number; system?: string },
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
    const r = await callSubagent(params);
    return {
      status: 'success',
      out: r.text,
      durationMs: Date.now() - t0,
      startedAt,
      endedAt: new Date().toISOString(),
    };
  } catch (e) {
    return {
      status: 'failed',
      error: { code: 'SUBAGENT_UNAVAILABLE', message: (e as Error).message },
      durationMs: Date.now() - t0,
      startedAt,
      endedAt: new Date().toISOString(),
    };
  }
}
