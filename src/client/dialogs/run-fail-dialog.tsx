// src/client/dialogs/run-fail-dialog.tsx — 运行失败/出错详情弹窗（hook + 渲染对）
// runResult（运行结果）与弹窗开关在 hook（在 FlowPanel 里调用 ⇒ handleRun/applyRunSummary/后台监视的读写零变化）；
// 渲染用 runFailureDetail（panel-utils）取「汇总错误 + 逐节点失败明细（显示名_id）」。
// 2026-10-14 弹窗专项批 1 自 FlowPanel.tsx 纯搬运拆出。

import { createElement, useState } from 'react';
import type { WorkflowDef } from '../types';
import { runFailureDetail } from '../panel-utils';
// ★ 2026-10-15 用户拍板「复制反馈在按钮本身」：复制按钮点了就地变「✓ 已复制」/「✗ 复制失败」（无浮窗）
import { useCopyFlash } from '../use-copy-flash';

export function useRunFailDialog() {
  const [runResult, setRunResult] = useState<{ status: string; summary?: unknown; error?: string } | null>(null);
  // ★ 运行失败详情弹窗（2026-10-02 用户需求：报错不再在 logo 后行内截断显示，改弹窗看全量）
  const [runDlgOpen, setRunDlgOpen] = useState(false);
  return { runResult, setRunResult, runDlgOpen, setRunDlgOpen };
}

export function RunFailDialogView({ d, def }: {
  d: ReturnType<typeof useRunFailDialog>;
  def: WorkflowDef;
  // ★ setImportMsg 不再解构：复制反馈已改到按钮本身（2026-10-15 拍板）；prop 保留以兼容 FlowPanel 调用点
  setImportMsg: (m: { ok: boolean; text: string; onClick?: () => void } | null) => void;
}) {
  const { runResult, runDlgOpen } = d;
  // hook 在早退之前调用（React 规则）
  const { flash: copyFlash, copy } = useCopyFlash();
  if (!runDlgOpen || !runResult || runResult.status === 'success') return null;
  return createElement(
    'div',
    {
      className: 'dag-flow-picker-overlay',
      onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) d.setRunDlgOpen(false); },
    },
    createElement(
      'div',
      { className: 'dag-flow-picker', style: { width: 560, maxWidth: '92vw' } },
      createElement('div', { className: 'dag-flow-picker-title', style: { fontSize: 16 } },
        runResult.status === 'error' ? '✗ 运行出错' : '⚠ 运行失败',
        createElement('button', {
          className: 'dag-flow-picker-close', title: '关闭',
          onClick: () => d.setRunDlgOpen(false),
        }, '✕'),
      ),
      createElement('div', { className: 'dag-flow-picker-body' },
        createElement('div', { className: 'dag-flow-picker-hint', style: { fontSize: 11, opacity: 0.72 } },
          `工作流「${def.name}」未运行成功——失败详情如下，可复制后反馈或对照节点修正。`),
        createElement('pre', {
          style: {
            margin: '8px 0 0', padding: 10, borderRadius: 8, fontSize: 11.5, lineHeight: 1.55,
            fontFamily: 'ui-monospace, Consolas, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            maxHeight: '46vh', overflowY: 'auto',
            background: 'var(--wf-bg, #08101e)', border: '1px solid var(--wf-border, #22304a)',
            color: 'var(--wf-danger, #f87171)',
          },
        }, runFailureDetail(runResult, def)),
        createElement('div', { style: { display: 'flex', gap: 8, marginTop: 10 } },
          createElement('button', {
            className: `dsh-wf-copy-btn${copyFlash?.key === 'detail' ? (copyFlash.kind === 'ok' ? ' is-done' : ' is-bad') : ''}`,
            title: '复制失败详情（便于反馈问题）',
            onClick: () => copy(runFailureDetail(runResult, def), 'detail'),
          }, copyFlash?.key === 'detail' ? (copyFlash.kind === 'ok' ? '✓ 已复制' : '✗ 复制失败') : '📋 复制详情'),
          createElement('span', { className: 'dag-flow-picker-hint', style: { fontSize: 10.5, opacity: 0.6, alignSelf: 'center' } },
            '关闭后可点头部「✗ 运行失败」徽标再次查看'),
        ),
      ),
    ),
  );
}
