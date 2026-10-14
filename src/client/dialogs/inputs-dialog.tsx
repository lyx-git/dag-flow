// src/client/dialogs/inputs-dialog.tsx — ✍️ 工作流参数编辑弹窗（hook + 渲染对）
// 状态与 handlers 在 useInputsDialog（**在 FlowPanel 里调用** ⇒ 状态仍活在面板实例上，改动即自动保存的数据流零变化）；
// InputsDialogView 只负责渲染。2026-10-14 弹窗专项批 1 自 FlowPanel.tsx 纯搬运拆出。

import { createElement, useCallback, useState } from 'react';
import type { JsonValue, WorkflowDef } from '../types';
import { ensurePickerStyles } from '../workflow-picker';

/** 工作流参数（def.inputs，原「工作流级输入/全局参数」）编辑弹窗——改动即自动保存（2026-10-02 用户需求） */
export function useInputsDialog({ def, onDefChange }: { def: WorkflowDef; onDefChange: (d: WorkflowDef) => void }) {
  const [inputsOpen, setInputsOpen] = useState(false);
  const [inputsRows, setInputsRows] = useState<{ k: string; v: string }[]>([]);
  const openInputs = useCallback(() => {
    ensurePickerStyles(); // 弹窗用 dag-flow-picker 样式——先于选择器打开时也要保证已注入
    const rows = Object.entries(def.inputs ?? {}).map(([k, v]) => ({ k, v: typeof v === 'string' ? v : JSON.stringify(v) }));
    // 默认一条空行（视觉占位；名称为空的行不写入 def，不算数据）
    setInputsRows(rows.length ? rows : [{ k: '', v: '' }]);
    setInputsOpen(true);
  }, [def.inputs]);
  // 行任意变更（输入/删除）→ 过滤掉名称为空的行 → 立即写回 def（磁盘落盘走既有 2s 防抖自动保存，不生成版本）
  const pushInputs = useCallback((rows: { k: string; v: string }[]) => {
    setInputsRows(rows);
    const inputs: Record<string, JsonValue> = {};
    for (const { k, v } of rows) {
      const key = k.trim();
      if (!key) continue;
      try { inputs[key] = JSON.parse(v); } catch { inputs[key] = v; }
    }
    onDefChange({ ...def, inputs });
  }, [def, onDefChange]);
  return { inputsOpen, setInputsOpen, inputsRows, setInputsRows, openInputs, pushInputs };
}

export function InputsDialogView({ d }: { d: ReturnType<typeof useInputsDialog> }) {
  if (!d.inputsOpen) return null;
  return createElement(
    'div',
    {
      className: 'dag-flow-picker-overlay',
      onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) d.setInputsOpen(false); },
    },
    createElement(
      'div',
      { className: 'dag-flow-picker' },
      createElement('div', { className: 'dag-flow-picker-title', style: { fontSize: 16 } },
        '✍️ 工作流参数',
        createElement('button', {
          className: 'dag-flow-picker-close', title: '关闭',
          onClick: () => d.setInputsOpen(false),
        }, '✕'),
      ),
      createElement('div', { className: 'dag-flow-picker-body' },
        createElement('div', { className: 'dag-flow-picker-hint', style: { fontSize: 11, opacity: 0.72 } },
          '仅当前工作流可用，随工作流一起保存（新建工作流时参数为空）。节点参数里用 {{inputs.名称}} 引用；值可填字符串或合法 JSON（对象/数字自动解析），改动即自动保存。'),
        d.inputsRows.map((row, i) => createElement('div', { key: i, style: { display: 'flex', gap: 6, marginBottom: 6 } },
          createElement('input', {
            className: 'dsh-wf-input', placeholder: '名称', value: row.k, style: { flex: '0 0 40%' },
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => d.pushInputs(d.inputsRows.map((r, j) => (j === i ? { ...r, k: e.target.value } : r))),
          }),
          createElement('input', {
            className: 'dsh-wf-input', placeholder: '值（字符串或 JSON）', value: row.v, style: { flex: 1 },
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => d.pushInputs(d.inputsRows.map((r, j) => (j === i ? { ...r, v: e.target.value } : r))),
          }),
          createElement('button', {
            className: 'dsh-wf-btn', title: '删除该参数',
            onClick: () => d.pushInputs(d.inputsRows.filter((_, j) => j !== i)),
          }, '✕'),
        )),
        // 底部 + 号：追加一条空行（名称为空的行不写入 def，输入内容后才计入自动保存）
        createElement('button', {
          className: 'dsh-wf-inputs-add', title: '添加一条参数',
          onClick: () => d.setInputsRows((rs) => [...rs, { k: '', v: '' }]),
        }, '+'),
      ),
    ),
  );
}
