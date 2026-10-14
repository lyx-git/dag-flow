// src/client/dialogs/manual-dialog.tsx — ⏸ 人工确认弹窗（hook + 渲染对）
// 状态（manual* 5 个）与 clearManualWait/confirmManual/cancelManualRun/refreshManualState + 挂载恢复 effect
// 在 useManualDialog（**在 FlowPanel 里调用**，须在 applyRunSummary 声明之后——hook 入参引用它）；
// handleRun / cancelRun / 头部 ⏸ 徽标经 FlowPanel 解构出的原名读写，零数据流变化。
// 2026-10-14 弹窗专项批 4 自 FlowPanel.tsx 纯搬运拆出。

import { createElement, useCallback, useEffect, useState } from 'react';
import type { WorkflowDef } from '../types';
import { displayTag } from '../panel-utils';

/** 人工确认（2026-10-03 用户拍板方案 A）：manual 节点挂起 → 头部 ⏸ 徽标 + 确认弹窗 */
export function useManualDialog({ def, applyRunSummary, setRunning, setCancelling, setCancelTick, cancellingRef, manualRunRef, runAbortRef }: {
  def: WorkflowDef;
  applyRunSummary: (data: any) => void;
  setRunning: (v: boolean) => void;
  setCancelling: (v: boolean) => void;
  setCancelTick: (update: (n: number) => number) => void;
  cancellingRef: { current: boolean };
  manualRunRef: { current: boolean };
  runAbortRef: { current: AbortController | null };
}) {
  const [manualWait, setManualWait] = useState<{ runId: string; nodeId: string; prompt: string } | null>(null);
  const [manualDlgOpen, setManualDlgOpen] = useState(false);
  const [manualNote, setManualNote] = useState('');
  const [manualBusy, setManualBusy] = useState(false);
  /** 中断态：刷新后查回却发现运行已丢（dsh web 重启）→ 明确收尾，不静默变僵尸 */
  const [manualBroken, setManualBroken] = useState<string | null>(null);
  const MANUAL_STORE_KEY = 'dag-flow:manual-wait';

  /** 结束人工确认态（确认/取消/中断都要清） */
  const clearManualWait = useCallback((): void => {
    setManualWait(null);
    setManualDlgOpen(false);
    setManualNote('');
    setManualBroken(null);
    try { localStorage.removeItem('dag-flow:manual-wait'); } catch { /* 忽略 */ }
  }, []);

  /** 确认并继续：POST /run/resume（该请求 hold 到跑完，返回完整 summary） */
  const confirmManual = useCallback(async () => {
    if (!manualWait) return;
    setManualBusy(true);
    try {
      const res = await fetch('/api/dag-flow/run/resume', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runId: manualWait.runId, value: manualNote }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 404 = 运行已丢（dsh 重启）；409 = 状态不符（多半已结束）
        setManualBroken(`${data?.error ?? `HTTP ${res.status}`}\n运行：${manualWait.runId}`);
        setManualDlgOpen(true);
        return;
      }
      clearManualWait();
      applyRunSummary(data);
    } catch (e) {
      setManualBroken(`确认失败：${(e as Error).message}`);
    } finally {
      setManualBusy(false);
      if (!cancellingRef.current) setRunning(false);   // ★ 取消中：保持取消态，交给监视器收尾（同上）
      manualRunRef.current = false;   // 人工确认路径结束 → 后台监视恢复接管
      runAbortRef.current = null;
    }
  }, [manualWait, manualNote, clearManualWait, applyRunSummary]);

  /** 取消本次运行（弹窗内）：走既有 DELETE 通道——host 会 reject 挂起的 manual 节点再 abort */
  const cancelManualRun = useCallback(() => {
    // ★ 2026-10-08：与头部取消按钮同一套语义——进入"取消中"态，不立刻把 running 置回 false ✗，
    //   等监视器确认宿主真的停了再**浮窗提示「取消成功」**（右侧结果条不动 ✗）。
    cancellingRef.current = true;
    setCancelling(true);
    setCancelTick((n) => n + 1);   // 立刻踢一次监视器轮询（同上）
    void fetch(`/api/dag-flow/run?name=${encodeURIComponent(def.name)}`, { method: 'DELETE', credentials: 'include' }).catch(() => {});
    runAbortRef.current?.abort();
    clearManualWait();
    manualRunRef.current = false;
  }, [def.name, clearManualWait]);

  /** 撤销误发的 DELETE（刷新后查回等待态时用）：发现状态不符就清掉本地等待标记 */
  const refreshManualState = useCallback(async (info: { runId: string; nodeId: string; prompt: string }): Promise<void> => {
    try {
      const res = await fetch(`/api/dag-flow/run/status?runId=${encodeURIComponent(info.runId)}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.status === 'awaiting') {
        setManualWait(info);
        setManualDlgOpen(true);
        setRunning(true);
        return;
      }
      if (res.ok && data?.status === 'completed' && data?.summary) {
        clearManualWait();
        applyRunSummary({ ok: (data.summary as { status?: string })?.status === 'success', summary: data.summary });
        return;
      }
      if (!res.ok) {
        // 运行已丢（dsh 重启）→ 明确收尾
        setManualBroken(`${data?.error ?? `HTTP ${res.status}`}\n运行：${info.runId}（节点 ${info.nodeId}）`);
        setManualWait(info);
        setManualDlgOpen(true);
        return;
      }
      clearManualWait();
    } catch { clearManualWait(); }
  }, [clearManualWait, applyRunSummary]);

  // 挂载时恢复等待态（刷新页面 / 重挂面板后仍能看到 ⏸ 与确认弹窗）
  useEffect(() => {
    let info: { runId: string; nodeId: string; prompt: string } | null = null;
    try {
      const raw = localStorage.getItem('dag-flow:manual-wait');
      if (raw) info = JSON.parse(raw);
    } catch { info = null; }
    if (info?.runId) void refreshManualState(info);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    manualWait, setManualWait, manualDlgOpen, setManualDlgOpen, manualNote, setManualNote,
    manualBusy, manualBroken, clearManualWait, confirmManual, cancelManualRun, refreshManualState,
    MANUAL_STORE_KEY,
  };
}

export function ManualDialogView({ d, def }: {
  d: ReturnType<typeof useManualDialog>;
  def: WorkflowDef;
}) {
  const { manualWait, manualDlgOpen, manualBroken, manualNote } = d;
  if (!manualWait || !manualDlgOpen) return null;
  return createElement(
    'div',
    {
      className: 'dag-flow-picker-overlay',
      onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) d.setManualDlgOpen(false); },
    },
    createElement(
      'div',
      { className: 'dag-flow-picker' },
      createElement('div', { className: 'dag-flow-picker-title' },
        manualBroken ? '⚠ 运行已中断' : '⏸ 等待人工确认',
        createElement('button', {
          className: 'dag-flow-picker-close',
          title: '关闭（运行继续等待，可从头部 ⏸ 徽标重新打开）',
          onClick: () => d.setManualDlgOpen(false),
        }, '✕'),
      ),
      createElement('div', { className: 'dag-flow-picker-body' },
        createElement('div', { className: 'dag-flow-picker-hint', style: manualBroken ? { fontSize: 11, opacity: 0.72 } : undefined },
          manualBroken
            ? '这次运行停在人工确认上，但已不在 host 内存中（通常是 dsh web 重启过）——运行无法继续，请重新运行工作流。'
            : `工作流「${def.name}」已暂停——确认后从该节点继续执行，取消则终止本次运行。`),
        createElement('div', { className: 'dsh-wf-manual-tag' },
          '✋ ',
          createElement('b', null, displayTag(def, manualWait.nodeId)),
          createElement('span', { className: 'kind' }, '(manual)'),
        ),
        createElement('pre', { className: 'dsh-wf-manual-prompt', style: manualBroken ? { color: 'var(--wf-danger, #f87171)' } : undefined },
          manualBroken ?? manualWait.prompt),
        !manualBroken && createElement('div', null,
          createElement('div', { className: 'dsh-wf-manual-lab' },
            '备注（可选，透传给下游 ', createElement('code', null, `{{${manualWait.nodeId}.out.value}}`), '）'),
          createElement('textarea', {
            className: 'dsh-wf-manual-note',
            value: manualNote,
            placeholder: '例如：已核对，图 2 需替换（留空则不传值）',
            onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => d.setManualNote(e.target.value),
          }),
        ),
        createElement('div', { className: 'dsh-wf-manual-acts' },
          manualBroken
            ? createElement('span', { className: 'dsh-wf-manual-grow' })
            : createElement('button', {
                className: 'dsh-wf-btn dsh-wf-btn-danger',
                title: '终止整个运行（已完成节点不回滚）',
                onClick: d.cancelManualRun,
              }, '✕ 取消本次运行'),
          createElement('span', { className: 'dsh-wf-manual-grow' }),
          !manualBroken && createElement('span', { className: 'dsh-wf-manual-tip' }, '取消会终止整个运行，已完成节点不回滚'),
          manualBroken
            ? createElement('button', { className: 'dsh-wf-btn', onClick: d.clearManualWait }, '知道了')
            : createElement('button', {
                className: 'dsh-wf-btn dsh-wf-btn-primary',
                disabled: d.manualBusy,
                onClick: () => void d.confirmManual(),
              }, d.manualBusy ? '⏳ 继续中…' : '✓ 确认并继续'),
        ),
      ),
    ),
  );
}
