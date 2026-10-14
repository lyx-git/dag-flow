// src/adapter/llm-endpoints.ts — LLM 端点发现与解析（三源合并）
// ① host llm 服务发现 → ② settings.yaml/patch 直读 → ③ 环境变量兜底；配置 schema 在 ../dsh-gate/llm-config.ts。
// SubagentUnavailableError 也定义在这里（端点解析与调用路径共用，经 subagent.ts 再导出保持符号路径不变）。
// 2026-10-14 重构轮 3 自 subagent.ts 纯搬运拆出（拆分后依赖单向：subagent.ts → 本文件，无循环）。

import { hostLlm as hostLlmRuntime } from '../dsh-gate/llm.js';
import {
  readLlmConfigFiles,
  buildLlmCandidates,
  envFallbackEndpoint,
  SETTINGS_KEY_PI,
  type LlmEndpoint,
} from '../dsh-gate/llm-config.js';

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

  throw new SubagentUnavailableError('dsh 配置（profile 的 cordis.patch.yml；旧版 settings.yaml）中没有可用的 LLM 端点（可设 DAG_FLOW_LLM_BASEURL / DAG_FLOW_LLM_KEY / DAG_FLOW_LLM_MODEL 环境变量兜底）');
}
