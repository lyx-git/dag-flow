// @ts-nocheck
// src/client/JsonView.tsx
// JSON 编辑视图：优先 Monaco Editor，不可用时回退 textarea；
// 右侧 ajv 实时 schema 校验。改动时双向同步到 FlowPanel 状态。

import { useEffect, useMemo, useState, createElement } from 'react';
import type { WorkflowDef } from './types';
import { getThemeMode } from './theme';

interface JsonViewProps {
  def: WorkflowDef;
  onChange: (def: WorkflowDef) => void;
}

const WORKFLOW_SCHEMA = {
  $id: 'https://dag-flow/schemas/workflow.json',
  type: 'object',
  required: ['name', 'version', 'nodes'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', pattern: '^[\\p{L}\\p{N}][\\p{L}\\p{N}_-]{0,63}$' },
    version: { const: 1 },
    description: { type: 'string' },
    inputs: { type: 'object', additionalProperties: true },
    nodes: {
      type: 'array',
      minItems: 2,
      items: {
        type: 'object',
        required: ['id', 'type'],
        additionalProperties: true,
        properties: {
          id: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_-]{0,63}$' },
          type: { type: 'string', minLength: 1 },
          params: { type: 'object', additionalProperties: true },
          // 与 host WORKFLOW_SCHEMA.next 同步（2026-10-02）：if 的 {true,false} 与 switch 的
          // { case值: 目标 } 共用同一 object 形状，必须是单个分支（并列会撞 oneOf）
          next: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
              { type: 'object', minProperties: 1, additionalProperties: { type: 'string' } },
              { type: 'null' },
            ],
          },
          onError: { type: ['string', 'object'] },
          tolerate: { type: 'boolean' },
          label: { type: 'string' },
        },
      },
    },
    layout: { type: 'object', additionalProperties: true },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        required: ['from', 'to'],
        additionalProperties: false,
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          when: { type: 'string' },
        },
      },
    },
  },
} as const;

export function JsonView({ def, onChange }: JsonViewProps) {
  const initialText = useMemo(() => JSON.stringify(def, null, 2), [def]);
  const [text, setText] = useState<string>(initialText);
  const [errors, setErrors] = useState<string[]>([]);
  const [valid, setValid] = useState<boolean>(true);

  // 同步：外部 def 变 → 重置 text
  useEffect(() => {
    setText(initialText);
  }, [initialText]);

  // 校验（用 ajv，不可用时回退手写 JSON.parse）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        if (!cancelled) {
          setValid(false);
          setErrors([`JSON 解析失败: ${(e as Error).message}`]);
        }
        return;
      }
      try {
        const Ajv = (await import('ajv')).default;
        const ajv = new Ajv({ allErrors: true, strict: false, unicodeRegExp: true });
        const validate = ajv.compile(WORKFLOW_SCHEMA);
        const ok = validate(parsed);
        if (cancelled) return;
        if (ok) {
          setValid(true);
          setErrors([]);
        } else {
          setValid(false);
          // ajv 英文消息 → 中文映射（与 server 端 parse.ts 同一套规则）
          const ZH: [RegExp, string][] = [
            [/must have required property '([^']+)'/, '缺少必填字段 "$1"'],
            [/must NOT have additional properties/, '存在不允许的多余字段'],
            [/must be (string|object|array|number|integer|boolean|null)/, '类型必须是 $1'],
            [/must match pattern '([^']+)'/, '必须匹配格式 $1'],
            [/must be equal to constant/, '值不匹配要求'],
            [/must NOT be shorter than (\d+)/, '长度不能少于 $1'],
            [/must NOT be longer than (\d+)/, '长度不能超过 $1'],
            [/must be >= (-?\d+)/, '不能小于 $1'],
            [/must be <= (-?\d+)/, '不能大于 $1'],
            [/must NOT have fewer than (\d+) items/, '数组至少需要 $1 项'],
            [/must NOT have more than (\d+) items/, '数组不能超过 $1 项'],
          ];
          const zh = (m: string): string => {
            for (const [re, tpl] of ZH) {
              const mm = m.match(re);
              if (mm) return tpl.replace(/\$(\d)/g, (_, i) => mm[Number(i)] ?? `$${i}`);
            }
            return m;
          };
          setErrors((validate.errors ?? []).map((e) => `${e.instancePath || '(根)'} ${zh(e.message ?? '')}`));
        }
      } catch {
        // ajv 不可用：只校验 JSON.parse
        if (!cancelled) {
          setValid(true);
          setErrors([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [text]);

  // 提交：校验通过 → 回写
  const commit = () => {
    try {
      const parsed = JSON.parse(text) as WorkflowDef;
      onChange(parsed);
    } catch { /* ignore */ }
  };

  // 尝试加载 Monaco（不可用就回退 textarea）
  const [MonacoEditor, setMonacoEditor] = useState<React.ComponentType<{
    value: string;
    onChange?: (v: string | undefined) => void;
    language?: string;
    height?: string | number;
    theme?: string;
    options?: Record<string, unknown>;
  }> | null>(null);
  const [monacoError, setMonacoError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import('@monaco-editor/react');
        if (!cancelled) setMonacoEditor(() => mod.default);
      } catch (e) {
        if (!cancelled) setMonacoError((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return createElement(
    'div',
    { className: 'dsh-wf-json-root' },
    // 左：编辑器
    createElement(
      'div',
      { className: 'dsh-wf-json-editor' },
      MonacoEditor
        ? createElement(MonacoEditor, {
            value: text,
            language: 'json',
            height: '100%',
            theme: getThemeMode() === 'nodeflow-light' || getThemeMode() === 'dsh' ? 'vs' : 'vs-dark',
            options: { minimap: { enabled: false }, fontSize: 12, wordWrap: 'on' },
            onChange: (v) => setText(v ?? ''),
          })
        : createElement('textarea', {
            className: 'dsh-wf-textarea',
            value: text,
            onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value),
            style: { width: '100%', height: '100%', border: 0, borderRadius: 0, fontSize: 12 },
            spellCheck: false,
          }),
      monacoError && createElement(
        'div',
        { style: { position: 'absolute', top: 8, right: 8, fontSize: 10, color: 'var(--dsh-wf-muted)' } },
        `Monaco 不可用 (${monacoError})，回退 textarea`,
      ),
    ),
    // 右：校验 + 提交
    createElement(
      'aside',
      { className: 'dsh-wf-json-side' },
      createElement('div', { className: 'dsh-wf-palette-section' }, 'Schema 校验'),
      valid
        ? createElement('div', { className: 'dsh-wf-json-valid' }, '✓ JSON 校验通过')
        : createElement(
            'div',
            null,
            createElement('div', { className: 'dsh-wf-json-error', style: { marginBottom: 8 } }, `✗ ${errors.length} 个错误`),
            ...errors.map((e, i) => createElement('div', { key: i, className: 'dsh-wf-json-err-item' }, e)),
          ),
      createElement('div', { className: 'dsh-wf-palette-section', style: { marginTop: 16 } }, '操作'),
      createElement(
        'button',
        {
          className: 'dsh-wf-btn dsh-wf-btn-primary',
          disabled: !valid,
          onClick: commit,
          style: { marginTop: 8 },
        },
        '应用 JSON',
      ),
      createElement(
        'p',
        { className: 'dsh-wf-text-muted', style: { fontSize: 11, marginTop: 8 } },
        '失焦 / 点"应用"即提交，校验失败不会写入。',
      ),
    ),
  );
}
