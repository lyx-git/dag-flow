// src/dsh-gate/llm-config.ts — 防腐层·DSH 配置 schema（LLM 端点发现）
//
// ★ dag-flow 依赖的 dsh 配置结构（dsh 升版改配置时只改本文件）：
//   0.1.x settings.yaml:         llm-pi-ai.providers[<pid>].{ baseURL, apiKeyEnv, models: [{ id|name, input? }] }
//                                llm-deepseek.baseURL（简写形态，模型取 agent-default-model）
//   0.2.x profiles/*/cordis.patch.yml:  顶层数组条目 - id: <上述键名> / config: <同上形状>（dsh-settings 迁移写入）
//   .credentials.yaml（两代同）:  refs.<ENV名> = key（或同名环境变量）
// 读取链：settings.yaml 优先，缺键时以 profile patch 补齐（readLlmConfigFiles）。
// 行为锁定：test/llm-config.test.mjs（A/B/C/D/F/G/H 组，两代 schema fixture）。
// 注：schema 解析此前在 adapter/subagent.ts（2026-09-27 审计意见 5 集中管理），
//     2026-10-02 防腐层改造收编至此；subagent.ts 转发导出保持测试/外部兼容。

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from '../adapter/yaml-lite.js';
import { settingsYamlPath, credentialsYamlPath, profilesDir, profilePatchPath } from './paths.js';

// —— dsh 配置文件路径（模块顶层固化：llm-config.test.mjs 依赖「import 前设 DSH_HOME」语义） ——
export const SETTINGS_PATH = settingsYamlPath();
export const CREDENTIALS_PATH = credentialsYamlPath();

/** LLM 端点（防腐层稳定形状：执行/发现/前端展示共用） */
export interface LlmEndpoint {
  baseURL: string;
  apiKey: string;
  model: string;
  providerName?: string;
  /** 模型输入模态（dsh settings.yaml models[].input，未标注视为 ['text'] 仅文本） */
  input?: string[];
  /** ★ host llm 服务路由（2026-10-02）：true = 走 ctx.llm.stream 分发（DSH 自带模型，
   *  Messages 协议/账号 token/api-key 均由 host 适配器解决），baseURL/apiKey 为空不参与直连 */
  viaHost?: boolean;
  /** host llm 注册的 provider 路由名（viaHost=true 时供 GenerateOptions.provider 用） */
  hostProvider?: string;
}

// ==================== dsh 配置 schema 键名 ====================
export const SETTINGS_KEY_PI = 'llm-pi-ai';
const SETTINGS_KEY_DEEPSEEK = 'llm-deepseek';
const SETTINGS_KEY_DEFAULT_MODEL = 'agent-default-model';
const CREDENTIALS_KEY_REFS = 'refs';

/** 读 settings.yaml + .credentials.yaml（均容忍缺失：返回空对象，调用方各自处理） */
export async function readLlmConfigFiles(): Promise<{ settings: Record<string, unknown>; creds: Record<string, unknown> }> {
  let settings: Record<string, unknown> = {};
  let creds: Record<string, unknown> = {};
  try {
    settings = parseYaml(await fs.readFile(SETTINGS_PATH, 'utf8')) as Record<string, unknown>;
  } catch { /* settings.yaml 不存在/不可读 → 空 */ }
  try {
    creds = parseYaml(await fs.readFile(CREDENTIALS_PATH, 'utf8')) as Record<string, unknown>;
  } catch { /* creds 可选 */ }
  // 2026-10-01（dsh 0.2.0）：settings.yaml 被移除，配置段落迁入 profile 的 cordis.patch.yml——
  // settings.yaml 缺键时以 profile patch 补齐。合并语义=顶层键级让位（settings.yaml 有 llm-pi-ai
  // 就整体不取 patch 同名键）：迁移过渡期两源是同一份配置的新旧形态，键级让位防双源重复端点。
  const patch = await readProfilePatchSettings();
  for (const [k, v] of Object.entries(patch)) {
    if (settings[k] === undefined) settings[k] = v;
  }
  return { settings, creds };
}

/**
 * 扫描 dshHome 下每个 profile 的 cordis.patch.yml（dsh 0.2.0 的配置持久层），提取 dag-flow 依赖的
 * 配置段落（llm-pi-ai / llm-deepseek / agent-default-model 条目的 config）。容忍缺失/坏文件。
 * 无 DSH_PROFILE 环境变量可辨当前 profile → 全部 profile 合并（后扫描的只补缺键）。
 */
async function readProfilePatchSettings(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const wanted = new Set([SETTINGS_KEY_PI, SETTINGS_KEY_DEEPSEEK, SETTINGS_KEY_DEFAULT_MODEL]);
  let profiles: string[] = [];
  try {
    profiles = (await fs.readdir(profilesDir(), { withFileTypes: true }))
      .filter((d) => d.isDirectory()).map((d) => d.name);
  } catch { return out; /* profiles 目录不存在（旧版 dsh）→ 空 */ }
  for (const p of profiles) {
    let raw: string;
    try {
      raw = await fs.readFile(profilePatchPath(p), 'utf8');
    } catch { continue; /* 该 profile 无 patch 文件 */ }
    let doc: unknown;
    try {
      doc = parseYaml(raw);
    } catch { continue; /* 坏文件跳过 */ }
    const entries = Array.isArray(doc) ? doc : [];
    for (const entry of entries) {
      const e = entry as { id?: string; config?: Record<string, unknown> };
      if (!e || typeof e !== 'object' || !e.id || !wanted.has(e.id)) continue;
      if (e.config && typeof e.config === 'object' && out[e.id] === undefined) {
        out[e.id] = e.config;
      }
    }
  }
  return out;
}

/** credentials refs / 同名环境变量双路取 key */
function keyFor(credRefs: Record<string, string>, envName: string | undefined): string {
  if (!envName) return '';
  if (credRefs[envName]) return credRefs[envName];
  if (process.env[envName]) return process.env[envName];
  return '';
}

/** 读 models[].input 能力数组（缺省/形态异常 → ['text'] 仅文本） */
function readInput(m: unknown): string[] {
  const input = (m as { input?: unknown })?.input;
  if (Array.isArray(input) && input.length > 0 && input.every((x) => typeof x === 'string')) {
    const arr = input as string[];
    return arr.includes('text') ? arr : ['text', ...arr];
  }
  return ['text'];
}

/**
 * 从已解析的 settings/creds 对象组装候选 LLM endpoint。
 * ★ dsh 改 settings.yaml/.credentials.yaml 结构时只改本函数——
 * 供 /models 发现（listAllEndpoints）与执行取端点（resolveLlmEndpoint）共用。
 * 行为由 test/llm-config.test.mjs 用两代 schema fixture 锁定。
 */
export function buildLlmCandidates(settings: Record<string, unknown>, creds: Record<string, unknown>): LlmEndpoint[] {
  const credRefs = (creds?.[CREDENTIALS_KEY_REFS] ?? {}) as Record<string, string>;
  const candidates: LlmEndpoint[] = [];
  // llm-pi-ai.providers：完整结构（baseURL + apiKeyEnv + models[]；models 兼容数组/对象两种形态）
  const pi = (settings?.[SETTINGS_KEY_PI] ?? {}) as { providers?: Record<string, unknown> };
  for (const [pid, pv] of Object.entries(pi.providers ?? {})) {
    const prov = pv as { baseURL?: string; apiKeyEnv?: string; api?: string; models?: unknown };
    const baseURL = String(prov.baseURL ?? '');
    const apiKey = keyFor(credRefs, prov.apiKeyEnv);
    // ★ 协议防御（2026-10-02 方案B，修 AI 节点 404）：provider 声明了非 OpenAI 兼容协议
    //   （如 anthropic-messages——路径/鉴权头/报文全不同）→ OpenAI 直连必 404，
    //   标 viaHost 强制走 host llm 路由（host 适配器会说该协议）；host 不可用时执行侧
    //   报「host llm 服务不可用」，准确优于莫名 404。
    //   判定用「openai* 白名单」：openai / openai-compatible / openai-responses 等
    //   openai 前缀协议都由直连承载（callOpenAICompatible 自带 chat/completions + responses
    //   双路径回退）；其余已声明协议一律 host 路由。未声明（空）= 历史默认 OpenAI 兼容。
    const api = String(prov.api ?? '').trim().toLowerCase();
    const needsHost = api !== '' && !api.startsWith('openai');
    // models 兼容数组/对象两种形态（yaml 解析差异防御）；input 数组 = 模型输入模态（未标注视为仅文本）
    const models = Array.isArray(prov.models) ? prov.models : prov.models && typeof prov.models === 'object' ? Object.values(prov.models) : [];
    for (const m of models) {
      const modelId = (m as { id?: string; name?: string })?.id ?? (m as { name?: string })?.name;
      if (modelId) {
        candidates.push({
          baseURL, apiKey, model: modelId, providerName: `${pid}:${modelId}`, input: readInput(m),
          ...(needsHost ? { viaHost: true, hostProvider: pid } : {}),
        });
      }
    }
  }
  // llm-deepseek 简写：只有 baseURL，模型取 agent-default-model 或默认 deepseek-chat
  const ds = (settings?.[SETTINGS_KEY_DEEPSEEK] ?? {}) as { baseURL?: string };
  if (ds.baseURL) {
    const adm = (settings?.[SETTINGS_KEY_DEFAULT_MODEL] ?? {}) as { model?: string };
    candidates.push({
      baseURL: String(ds.baseURL),
      apiKey: keyFor(credRefs, 'DEEPSEEK_API_KEY') || keyFor(credRefs, 'ARK_CODE_LATEST_API_KEY'),
      model: adm.model ?? 'deepseek-chat',
      providerName: 'llm-deepseek',
      input: ['text'],
    });
  }
  return candidates;
}

// —— 环境变量逃生舱（2026-09-27 用户拍板方案 C）——
// 仅当 dsh settings.yaml/credentials 直读无可用端点时作为兜底，dsh 发现仍是首选；
// 不落盘：三个变量均从进程环境读取。
export const ENV_LLM_BASEURL = 'DAG_FLOW_LLM_BASEURL';
export const ENV_LLM_KEY = 'DAG_FLOW_LLM_KEY';
export const ENV_LLM_MODEL = 'DAG_FLOW_LLM_MODEL';

/** 读取环境变量兜底端点；DAG_FLOW_LLM_BASEURL 未设时返回 null。导出供测试直接断言。 */
export function envFallbackEndpoint(): LlmEndpoint | null {
  const baseURL = process.env[ENV_LLM_BASEURL];
  if (!baseURL) return null;
  return {
    baseURL: String(baseURL).replace(/\/+$/, ''),
    apiKey: process.env[ENV_LLM_KEY] ?? '',
    model: process.env[ENV_LLM_MODEL] || 'deepseek-chat',
    providerName: 'env-fallback',
    input: ['text'],
  };
}

/** 仅从 dsh 配置发现端点（读 settings.yaml + .credentials.yaml + profile patch，容忍缺失）。 */
export async function discoverSettingsEndpoints(): Promise<LlmEndpoint[]> {
  try {
    const { settings, creds } = await readLlmConfigFiles();
    return buildLlmCandidates(settings, creds);
  } catch {
    return [];
  }
}
