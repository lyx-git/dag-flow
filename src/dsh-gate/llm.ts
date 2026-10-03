// src/dsh-gate/llm.ts — 防腐层·宿主 LLM 服务门面
//
// ★ DSH llm 服务（LlmRuntime）的形状假设只在本文件声明。dsh 升版改 llm 服务
//   API（方法名/chunk 形状/GenerateOptions 字段）时只改这里 + dsh-gate/README.md。
//
// 2026-10-02 经 cordis_inspect host 服务清单实证：
//   listProviders(): {id,name?}[]
//   listModels(provider): {id,name?,description?,inputModalities?}[]
//   stream(GenerateOptions): AsyncIterable<chunk>
//     chunk = { type:'text-delta', text } | { type:'finish', reason:'stop'|'error'|'aborted', error? }
//   （另保留 chat? 兼容路径——若宿主未来提供一次性 chat 接口则优先生效）
// 自带模型经 DeepSeek 适配器（Anthropic Messages 协议）分发，密钥由 dsh 统一管理。

import { hostService } from './host.js';

/** DSH llm 服务的稳定形状（业务代码只依赖本接口，不依赖 DSH 原生类型） */
export interface HostLlmRuntime {
  listProviders?: () => { id: string; name?: string }[] | Promise<{ id: string; name?: string }[]>;
  listModels?: (provider: string) => Promise<
    { id: string; name?: string; description?: string; inputModalities?: readonly string[] }[]
  >;
  /** 流式生成。chunk 形状见文件头；finish{reason:'error'} 必须转成显式失败（业务侧处理） */
  stream?: (options: unknown) => AsyncIterable<{ type: string; text?: string }>;
  /** 兼容路径：宿主若提供一次性 chat 则优先生效（0.2.0 实测不存在） */
  chat?: (options: unknown) => Promise<unknown>;
}

/** 取宿主 llm 服务（未注入/不可用时返回 undefined，调用方自行回退直连方案）。 */
export function hostLlm(): HostLlmRuntime | undefined {
  return hostService('llm') as HostLlmRuntime | undefined;
}
