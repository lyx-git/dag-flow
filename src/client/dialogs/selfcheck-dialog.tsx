// src/client/dialogs/selfcheck-dialog.tsx — 自检拦截 / 自检通过 弹窗（hook + 渲染对）
// 两个状态在 useSelfcheckDialog；handleRun（FlowPanel）是**写方**——经 FlowPanel 解构出的 setter 原名读写，零数据流变化；
// 两个 View 只负责渲染（点条目选中节点经 setSelectedNodeId prop；「开始运行」经 onRun prop 回调 handleRun）。
// 2026-10-14 弹窗专项批 4 自 FlowPanel.tsx 纯搬运拆出。

import { createElement, useState } from 'react';

export function useSelfcheckDialog() {
  // ★ 运行前自检拦住（2026-10-04 轮 1）：存住 host 返回的问题清单（含解决办法），弹窗让用户人工确认
  const [selfcheckBlock, setSelfcheckBlock] = useState<{ items: { level?: string; code?: string; nodeId?: string; message?: string; fix?: string }[]; errorCount: number; warnCount?: number; stats?: { nodes?: number; edges?: number } } | null>(null);
  // 「点运行 → 先自检（按钮显示『自检中…』）→ 自检通过 → 人工确认 → 才真正开跑」的中间态
  const [selfcheckState, setSelfcheckState] = useState<null | { phase: 'checking' } | { phase: 'ok'; result: { items: any[]; errorCount: number; warnCount: number; stats: { nodes?: number; edges?: number } } }>(null);
  return { selfcheckBlock, setSelfcheckBlock, selfcheckState, setSelfcheckState };
}

/** ✓ 自检通过也要人工确认一次（2026-10-04 用户要求：「自检完成没问题后，手动确认，再开始真正运行」） */
export function SelfcheckOkDialogView({ d, onRun, setSelectedNodeId }: {
  d: ReturnType<typeof useSelfcheckDialog>;
  onRun: (runOpts?: { confirmed?: boolean }) => void;
  setSelectedNodeId: (id: string) => void;
}) {
  const sc = d.selfcheckState;
  if (!sc || sc.phase !== 'ok') return null;
  return createElement(
    'div',
    {
      className: 'dag-flow-picker-overlay',
      onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) d.setSelfcheckState(null); },
    },
    createElement(
      'div',
      { className: 'dag-flow-picker dsh-wf-selfcheck is-ok' },
      createElement('div', { className: 'dag-flow-picker-title', style: { fontSize: 16 } },
        '✓ 自检通过',
        createElement('button', { className: 'dag-flow-picker-close', title: '关闭（不运行）', onClick: () => d.setSelfcheckState(null) }, '✕'),
      ),
      createElement('div', { className: 'dag-flow-picker-body' },
        createElement('div', { className: 'dag-flow-picker-hint', style: { fontSize: 11.5, opacity: 0.8, lineHeight: 1.65 } },
          `已检查 ${sc.result.stats?.nodes ?? 0} 个节点 / ${sc.result.stats?.edges ?? 0} 条边：结构、连线引用、必填参数、分支键、环路、循环与子工作流依赖都没问题。`,
          sc.result.warnCount > 0 ? `另有 ${sc.result.warnCount} 条提醒（不影响运行，可先看看）：` : '点「开始运行」就真正执行，运行期间可以在头部取消。',
        ),
        sc.result.items.filter((i) => i.level === 'warn').length
          ? createElement('div', { className: 'dsh-wf-selfcheck-list' },
              sc.result.items.filter((i) => i.level === 'warn').map((it, i) =>
                createElement('div', {
                  key: i,
                  className: `dsh-wf-selfcheck-item is-warn${it.nodeId ? ' is-clickable' : ''}`,
                  onClick: () => { if (it.nodeId) { setSelectedNodeId(it.nodeId); d.setSelfcheckState(null); } },
                },
                  createElement('div', { className: 'dsh-wf-selfcheck-msg' }, `⚠ ${it.message ?? ''}`),
                  it.fix ? createElement('div', { className: 'dsh-wf-selfcheck-fix' }, `👉 解决办法：${it.fix}`) : null,
                )),
            )
          : null,
        createElement('div', { className: 'dsh-wf-manual-acts' },
          createElement('button', { className: 'dsh-wf-btn', onClick: () => d.setSelfcheckState(null) }, '✕ 取消'),
          createElement('span', { className: 'dsh-wf-manual-grow' }),
          createElement('button', {
            className: 'dsh-wf-btn dsh-wf-btn-primary',
            onClick: () => { d.setSelfcheckState(null); void onRun({ confirmed: true }); },
          }, '▶ 开始运行'),
        ),
      ),
    ),
  );
}

/** ⚠ 运行前自检未通过（2026-10-04 轮 1 用户拍板；★2026-10-08 用户收严：**不提供"仍然运行"**，
 *  自检有 error 就必须去改——「去修改」关弹窗并选中第一个出问题的节点，没有旁路按钮）。 */
export function SelfcheckBlockDialogView({ d, setSelectedNodeId }: {
  d: ReturnType<typeof useSelfcheckDialog>;
  setSelectedNodeId: (id: string) => void;
}) {
  const block = d.selfcheckBlock;
  if (!block) return null;
  return createElement(
    'div',
    {
      className: 'dag-flow-picker-overlay',
      onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) d.setSelfcheckBlock(null); },
    },
    createElement(
      'div',
      { className: 'dag-flow-picker dsh-wf-selfcheck' },
      createElement('div', { className: 'dag-flow-picker-title', style: { fontSize: 16 } },
        `⚠ 运行前自检未通过（${block.errorCount} 项）`,
        createElement('button', { className: 'dag-flow-picker-close', title: '关闭（不运行）', onClick: () => d.setSelfcheckBlock(null) }, '✕'),
      ),
      createElement('div', { className: 'dag-flow-picker-body' },
        createElement('div', { className: 'dag-flow-picker-hint', style: { fontSize: 11.5, opacity: 0.8, lineHeight: 1.65 } },
          '这些问题会让工作流跑不起来、或跑出意料之外的结果。请先按下面的「解决办法」改掉——自检不通过时不能运行。'),
        createElement('div', { className: 'dsh-wf-selfcheck-list' },
          block.items.filter((i) => i.level === 'error').map((it, i) =>
            createElement('div', {
              key: i,
              className: `dsh-wf-selfcheck-item${it.nodeId ? ' is-clickable' : ''}`,
              onClick: () => { if (it.nodeId) { setSelectedNodeId(it.nodeId); d.setSelfcheckBlock(null); } },
            },
              createElement('div', { className: 'dsh-wf-selfcheck-msg' }, `✕ ${it.message ?? ''}`),
              it.fix ? createElement('div', { className: 'dsh-wf-selfcheck-fix' }, `👉 解决办法：${it.fix}`) : null,
            )),
        ),
        createElement('div', { className: 'dsh-wf-manual-acts' },
          createElement('button', {
            className: 'dsh-wf-btn dsh-wf-btn-primary',
            onClick: () => {
              const first = block.items.find((i) => i.level === 'error' && i.nodeId);
              d.setSelfcheckBlock(null);
              if (first?.nodeId) setSelectedNodeId(first.nodeId);
            },
          }, '✕ 去修改'),
        ),
      ),
    ),
  );
}
