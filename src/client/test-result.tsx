// src/client/test-result.tsx
// 单节点试跑的结果块（2026-10-11 抽出共用）：面板结果区与「参数与试跑」弹窗底部结果区共用同一套渲染。
// 内容：①状态行（✗ 原因 / ✓ 节点状态 · 耗时）②AI 调试（模型/提供方 · 走宿主还是直连 · token 用量 ·
// 结束原因（max-tokens 显式提醒截断）· 实际提示词）③输出 JSON（截断 600 字）。
// ★ 标记与抽出前**逐字一致**（面板里的既有断言/样式都依赖这些 class 与文案）。
import { createElement } from 'react';

export type TestResult = {
  ok?: boolean;
  error?: string;
  status?: string;
  ms?: number;
  output?: unknown;
  debug?: {
    model?: string;
    modelLabel?: string;
    provider?: string;
    viaHost?: boolean;
    usage?: { inputTokens?: number; outputTokens?: number };
    finishReason?: string;
    prompt?: unknown;
  };
};

export function TestResultView({ result }: { result: TestResult | null }) {
  if (!result) return null;
  return createElement('div', { className: `dsh-wf-test-result ${result.error ? 'is-err' : result.ok ? 'is-ok' : 'is-fail'}` },
    createElement('div', null,
      result.error
        ? `✗ ${result.error}`
        : `${result.ok ? '✓' : '✗'} 节点状态: ${result.status}${result.ms != null ? ` · ${Math.round(result.ms)}ms` : ''}`,
    ),
    // ★ AI 调试信息（2026-10-04 用户问「试跑本节点能不能当 LLM 调试面板」→ 能，这里把它补全）：
    //   模型/提供方 · token 用量 · 结束原因 · 实际提示词——调 AI 节点时最需要看的几项
    result.debug && createElement('div', { className: 'dsh-wf-test-debug' },
      createElement('div', { className: 'dsh-wf-test-debug-head' },
        `🤖 ${result.debug.modelLabel ?? result.debug.model}${result.debug.provider ? `（${result.debug.provider}）` : ''}`
        + ` · ${result.debug.viaHost ? '走宿主' : '直连'}`
        + (result.debug.usage
            ? ` · tokens 入 ${result.debug.usage.inputTokens ?? '?'} / 出 ${result.debug.usage.outputTokens ?? '?'}`
            : ' · tokens：宿主未提供')
        + (result.debug.finishReason ? ` · 结束 ${result.debug.finishReason}` : '')
        + (result.debug.finishReason === 'max-tokens' ? '（⚠ 撞到 maxTokens 上限，输出被截断）' : ''),
      ),
      createElement('div', { className: 'dsh-wf-test-debug-title' }, '实际提示词（模板已展开 = 模型真正看到的）'),
      createElement('pre', { className: 'dsh-wf-test-debug-pre' }, String(result.debug.prompt ?? '').slice(0, 1200)),
    ),
    result.output != null && createElement('pre', null, JSON.stringify(result.output, null, 2).slice(0, 600)),
  );
}
