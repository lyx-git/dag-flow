// @ts-nocheck
// src/client/AiGenView.tsx
// AI 生成视图：自然语言 → /api/dag-flow/ai-generate（SSE 流式）→ 渐进显示 → 应用到工作流。
// 失败时明确报错（不再回退假数据）——错误信息含原因与下一步建议。

import { useState, createElement } from 'react';
import type { WorkflowDef } from './types';

interface AiGenViewProps {
  def: WorkflowDef;
  onApply: (def: WorkflowDef) => void;
  host?: any;
}

export function AiGenView({ def, onApply }: AiGenViewProps) {
  const [prompt, setPrompt] = useState<string>(
    '写一个工作流：拉取 GitHub API 仓库的 issues → 用 python 过滤掉已关闭的 → 按标签分类统计 → AI 总结',
  );
  const [streamText, setStreamText] = useState<string>('');
  const [generating, setGenerating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [parsedPreview, setParsedPreview] = useState<WorkflowDef | null>(null);

  const handleGenerate = async (): Promise<void> => {
    setError(null);
    setStreamText('');
    setParsedPreview(null);
    setGenerating(true);

    try {
      const r = await fetch('/api/dag-flow/ai-generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, stream: true }),
      });
      if (!r.ok) {
        let detail = '';
        try { const d = await r.json(); detail = d?.error ?? ''; } catch { /* */ }
        throw new Error(detail || `HTTP ${r.status}`);
      }
      // 解析 SSE：data: {"delta"} / data: {"done":true,...}
      const reader = (r.body as unknown as { getReader: () => { read: () => Promise<{ done: boolean; value?: Uint8Array }> } }).getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let full = '';
      let finalEvent: { ok?: boolean; error?: string; def?: WorkflowDef } | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const s = line.trim();
          if (!s.startsWith('data:')) continue;
          try {
            const evt = JSON.parse(s.slice(5).trim());
            if (evt.delta) { full += evt.delta; setStreamText(full); }
            if (evt.done) finalEvent = evt;
          } catch { /* 忽略不完整行 */ }
        }
      }
      if (finalEvent?.error) throw new Error(finalEvent.error);
      if (finalEvent?.ok && finalEvent.def) {
        setParsedPreview(finalEvent.def);
        setStreamText(JSON.stringify(finalEvent.def, null, 2));
      } else if (!finalEvent) {
        throw new Error('连接中断——未收到完整结果，请重试');
      }
    } catch (e) {
      setError(`${(e as Error).message}。可重试；若反复失败，请检查 dsh 的模型配置（settings.yaml）中是否有可用模型。`);
    } finally {
      setGenerating(false);
    }
  };

  const handleApply = (): void => {
    if (parsedPreview) onApply(parsedPreview);
  };

  return createElement(
    'div',
    { className: 'dsh-wf-ai-root' },
    createElement(
      'h2',
      { style: { fontSize: 20, fontWeight: 700, margin: '0 0 8px' } },
      '🤖 AI 生成工作流',
    ),
    createElement(
      'p',
      { className: 'dsh-wf-text-muted', style: { fontSize: 12, marginBottom: 16 } },
      '描述需求 → AI 按已注册节点的参数 schema 生成 JSON（流式输出）。生成后点「应用」覆盖当前工作流。',
    ),
    createElement('label', { className: 'dsh-wf-panel-label' }, '需求描述'),
    createElement('textarea', {
      className: 'dsh-wf-ai-prompt',
      value: prompt,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setPrompt(e.target.value),
      rows: 4,
      placeholder: '例：每周一上午拉取 GitHub Trending → 总结 top 10 → 邮件给我',
    }),
    createElement(
      'div',
      { style: { display: 'flex', gap: 8, marginTop: 12 } },
      createElement(
        'button',
        {
          className: 'dsh-wf-btn dsh-wf-btn-primary',
          onClick: () => void handleGenerate(),
          disabled: generating || !prompt.trim(),
        },
        generating ? '⏳ 生成中（流式）…' : '🤖 生成',
      ),
      parsedPreview && createElement(
        'button',
        { className: 'dsh-wf-btn dsh-wf-btn-success', onClick: handleApply },
        `✓ 应用到工作流（${parsedPreview.nodes.length} 节点）`,
      ),
    ),
    error && createElement(
      'div',
      {
        style: {
          marginTop: 12, padding: 8, fontSize: 12, borderRadius: 4,
          background: 'color-mix(in srgb, var(--wf-danger, #f87171) 10%, transparent)',
          border: '1px solid var(--wf-danger, #f87171)', color: 'var(--wf-danger, #f87171)',
        },
      },
      '⚠️ ', error,
    ),
    streamText && createElement(
      'div',
      { style: { marginTop: 16 } },
      createElement('label', { className: 'dsh-wf-panel-label' }, parsedPreview ? '生成结果（已校验）' : '生成中…'),
      createElement('pre', { className: 'dsh-wf-ai-result' }, streamText),
    ),
  );
}
