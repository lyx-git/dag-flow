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
  /** ★ AI 调试信息（2026-10-04 用户问「试跑本节点能不能当 LLM 调试面板」→ 把调试要看的都采集出来）：
   *  实际提示词（模板已展开）、模型/提供方、耗时、token 用量、结束原因、是否走宿主。 */
  debug?: SubagentDebug;
}

/** AI 节点调试信息（进 NodeResult.debug → 试跑面板 + 运行日志共用；**不进 out**，不污染数据流） */
export interface SubagentDebug {
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
    ...rest,
  };
}

export class SubagentUnavailableError extends Error {
  /** 可选的节点级错误码：同一种病在不同路径要报同一个码（如空输出 SUBAGENT_EMPTY_OUTPUT），
   *  否则「host 路径 vs 直连路径」会给出不同 code（2026-10-03 契约测试 E1 暴露）。 */
  code?: string;
  constructor(reason: string, code?: string) {
    super(`subagent unavailable: ${reason}`);
    this.name = 'SubagentUnavailableError';
    if (code) this.code = code;
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
export function checkModelModality(endpoint: Pick<LlmEndpoint, 'input' | 'model' | 'providerName' | 'modelLabel'>, prompt: string): string | null {
  const needed = detectModalities(prompt);
  if (needed.length === 0) return null;
  const caps = endpoint.input?.length ? endpoint.input : ['text'];
  const missing = needed.filter((m) => !caps.includes(m));
  if (missing.length === 0) return null;
  const label: Record<string, string> = { image: '图片', video: '视频', file: '文件' };
  const missingLabel = missing.map((m) => label[m] ?? m).join('、');
  const suggest = missing.includes('image') ? '（如 dsh:custom-model:kimi-k3 / minimax-m3）' : '';
  // ★ 错误消息用**显示名**（2026-10-03 用户要求「不用模型id，不容易分辨」，与下拉文案同口径）：
  //   modelLabel（宿主显示名 / settings 的 name）→ providerName → model 三级回退。
  return `所选模型 ${endpoint.modelLabel ?? endpoint.providerName ?? endpoint.model} 不支持${missingLabel}输入（能力: ${caps.join(', ')}）——prompt 中引用了${missingLabel}文件。请换支持对应模态的模型${suggest}，或在 dsh settings.yaml 为该模型标注 input: [text, image]`;
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
  // ★ 去重键 = providerName 去掉 `llm:` 前缀（2026-10-03 用户拍板「要去重」）：
  //   host 发现的 `llm:<provider>:<model>` 与 settings 直读的 `<provider>:<model>` 是**同一批模型的两种来源**，
  //   去重后保留 host 发现的那条（先入为主 → 它带显示名 + host 路由标记）。
  //   ★ 注意只按「provider+model」去重，**不按 model 单独去重**：`custom-model` 与 `custom-model-vision`
  //     是同一模型的两条不同路由（后者多「自动识图」能力），按 model 去重会把它们误删、用户会丢能力。
  const seen = new Set<string>();
  const dedupeKey = (name: string) => name.replace(/^llm:/, '');
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
            const key = dedupeKey(name);
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({
              baseURL: '',
              apiKey: '',
              model: m.id,
              providerName: name,
              // ★ 显示名（2026-10-03）：只给 UI 用，存值/路由仍是 providerName + model
              modelLabel: typeof (m as { name?: unknown }).name === 'string' && (m as { name?: string }).name
                ? (m as { name?: string }).name : undefined,
              providerLabel: typeof (p as { name?: unknown }).name === 'string' && (p as { name?: string }).name
                ? (p as { name?: string }).name : undefined,
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
      const key = dedupeKey(name);
      if (seen.has(key)) continue;
      seen.add(key);
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
  if (envEp && !seen.has(dedupeKey(envEp.providerName ?? ''))) out.push(envEp);
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
      messages: [{ role: 'user', content: [{ type: 'text', text: opts.prompt }] }],
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
