// src/client/dialogs/versions-dialog.tsx — 🕘 历史版本弹窗（hook + 渲染对）
// 状态（开关/列表/加载/高度/上移偏移/落盘目录）与 openVersions/loadVersion 在 hook（在 FlowPanel 里调用）；
// 回载 = 受控保存两步（当前内容先存档、回载内容 snapshot:false 写入），与拆分前完全一致。
// 2026-10-14 弹窗专项批 1 自 FlowPanel.tsx 纯搬运拆出。

import { createElement, useCallback, useState } from 'react';
import type { WorkflowDef } from '../types';
import { ensurePickerStyles } from '../workflow-picker';
import { dataPathRow, verDisplayPath } from '../panel-utils';

/** 版本管理（#14-② + 2026-10-01 夜：手动保存生成快照到 versions/，此处弹窗列表与回载） */
export function useVersionsDialog({ def, saveDefToDisk, onDefChange, setDirty }: {
  def: WorkflowDef;
  saveDefToDisk: (target: WorkflowDef, snapshot: boolean) => Promise<string>;
  onDefChange: (d: WorkflowDef) => void;
  setDirty: (v: boolean) => void;
}) {
  const [verOpen, setVerOpen] = useState(false);
  const [verList, setVerList] = useState<{ ts: string }[]>([]);
  const [verLoading, setVerLoading] = useState(false);
  // 版本弹窗高度（2026-10-01 夜用户需求：上边缘可上下拖动，展示更多版本）
  const [verH, setVerH] = useState(420);
  // 版本弹窗「上移偏移」（2026-10-04 用户要求：弹窗位置与 ⏰ 定时任务弹窗保持一致——默认落点 14vh，
  //   拖上边缘时顶边跟随光标上移，偏移量记在这里；clamp 在 [0, 14vh-16px]，绝不让顶边越出视口）
  const [verOff, setVerOff] = useState(0);
  // 版本数据实际落盘目录（服务端 versions 列表响应携带 dir；弹窗里标注存储位置）
  const [verDir, setVerDir] = useState('');
  const openVersions = useCallback(async () => {
    ensurePickerStyles(); // 版本弹窗复用 picker 的 .dag-flow-picker-* 样式——没开过 📂 时也要有样式
    setVerOpen(true);
    // 每次打开都回到默认落点（14vh，与 ⏰ 定时任务弹窗一致）——上移偏移只影响本次打开期间；
    // 高度 verH 仍然记忆（用户上轮拖高看更多版本的需求，见 2026-10-01 夜）
    setVerOff(0);
    setVerLoading(true);
    try {
      const res = await fetch(`/api/dag-flow/workflows/${encodeURIComponent(def.name)}/versions`, { credentials: 'include' });
      const data = await res.json();
      setVerList(data.versions ?? []);
      setVerDir(String(data.dir ?? ''));
    } catch { setVerList([]); setVerDir(''); }
    setVerLoading(false);
  }, [def.name]);

  const loadVersion = useCallback(async (ts: string) => {
    try {
      const res = await fetch(`/api/dag-flow/workflows/${encodeURIComponent(def.name)}/versions/${encodeURIComponent(ts)}`, { credentials: 'include' });
      const data = await res.json();
      if (data?.workflow) {
        // 回载 = 受控保存两步：先以 snapshot:true 落盘当前内容（与最新版本相同则服务端去重跳过），
        // 回载前的当前内容成为新版本、随时可再退回；再以 snapshot:false 写入回载内容（回载本身不算一次保存）
        await saveDefToDisk(def, true).catch(() => {});
        await saveDefToDisk(data.workflow as WorkflowDef, false).catch(() => {});
        onDefChange(data.workflow);
        setVerOpen(false);
        setDirty(true);
      }
    } catch { /* 忽略 */ }
  }, [def, onDefChange, saveDefToDisk, setDirty]);
  return { verOpen, setVerOpen, verList, verLoading, verH, setVerH, verOff, setVerOff, verDir, openVersions, loadVersion };
}

export function VersionsDialogView({ d, defName, setImportMsg }: {
  d: ReturnType<typeof useVersionsDialog>;
  defName: string;
  setImportMsg: (m: { ok: boolean; text: string; onClick?: () => void } | null) => void;
}) {
  if (!d.verOpen) return null;
  return createElement(
    'div',
    {
      className: 'dag-flow-picker-overlay',
      // 2026-10-04 用户反馈「历史版本弹窗有点偏中下部了，最好和定时任务弹窗保持一致」：
      //   此前这里内联了 alignItems:'flex-end' + paddingBottom:'8vh'（底部锚定，弹窗落在中下部），
      //   现改为**不覆盖** —— 用 overlay 默认的顶部锚定（align-items:flex-start; padding-top:14vh），
      //   与 ⏰ 定时任务弹窗同一落点。「顶边跟随光标」的手感由下面 handle 的 verOff 偏移保留。
      onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) d.setVerOpen(false); },
    },
    createElement(
      'div',
      {
        className: 'dag-flow-picker dag-flow-picker-ver',
        // maxHeight 与顶部锚定配套：顶边在 14vh，可用高度 = 100vh-14vh，留 16px 下边距（原 90vh 会在顶部锚定下越出视口底部）
        style: { height: d.verH, maxHeight: 'calc(86vh - 16px)', marginTop: -d.verOff, display: 'flex', flexDirection: 'column' },
      },
      // 上边缘拖拽把手：向上拖 = 顶边跟随光标上移 + 加高；向下拖 = 收矮（钳位 280px ~ 视口剩余高度）
      createElement('div', {
        className: 'dag-flow-picker-resize-y',
        title: '上下拖动调整弹窗高度',
        onMouseDown: (e: React.MouseEvent) => {
          e.preventDefault();
          const startY = e.clientY;
          const startH = d.verH;
          const startOff = d.verOff;
          const vh = window.innerHeight;
          // 与 .dag-flow-picker-overlay 的 padding-top:14vh 对齐（默认锚点 = ⏰ 定时任务弹窗的落点）
          const baseTop = Math.round(vh * 0.14);
          const GAP = 16;
          const MIN_H = 280;
          const maxOff = Math.max(0, baseTop - GAP);
          const onMove = (ev: MouseEvent) => {
            const dy = startY - ev.clientY; // 向上拖为正
            // 顶边跟随光标上移（不越过视口上沿、也不低于默认锚点），高度同步长高
            const off = Math.min(Math.max(startOff + dy, 0), maxOff);
            const maxH = Math.max(MIN_H, vh - GAP - (baseTop - off));
            d.setVerOff(off);
            d.setVerH(Math.min(Math.max(startH + dy, MIN_H), maxH));
          };
          const onUp = () => {
            window.removeEventListener('mousemove', onMove, true);
            window.removeEventListener('mouseup', onUp, true);
          };
          window.addEventListener('mousemove', onMove, true);
          window.addEventListener('mouseup', onUp, true);
        },
      }),
      createElement('div', { className: 'dag-flow-picker-title', style: { fontSize: 16, flex: 'none' } },
        '🕘 历史版本',
        createElement('button', {
          className: 'dag-flow-picker-close', title: '关闭',
          onClick: () => d.setVerOpen(false),
        }, '✕'),
      ),
      createElement('div', { className: 'dag-flow-picker-body', style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
        createElement('div', { className: 'dag-flow-picker-hint', style: { fontSize: 11, opacity: 0.72, flex: 'none' } },
          '手动 💾 保存会生成一个版本快照（自动保存不计入）。点「回载」把该版本放回画布；回载前的当前内容如与最新版本不同，也会先存为一个版本，随时可再退回。'),
        // 数据存储位置标注（2026-10-01 夜用户要求；★ 2026-10-11 起**可点击打开**所在文件夹）
        dataPathRow(
          d.verDir ? verDisplayPath(d.verDir, defName) : '<DSH_HOME>/.dag-flow/workflow/versions/<名称>/<时间戳>.json',
          `workflow/versions/${defName}`,
          (m: string) => setImportMsg({ ok: false, text: m }),
        ),
        d.verLoading && createElement('div', { className: 'dag-flow-picker-hint', style: { fontSize: 11, opacity: 0.72 } }, '加载中…'),
        !d.verLoading && d.verList.length === 0
          ? createElement('div', { className: 'dag-flow-picker-hint', style: { fontSize: 11, opacity: 0.72 } }, '暂无历史版本——手动 💾 保存后即可在此回溯。')
          : createElement('div', { className: 'dag-flow-picker-ver-list', style: { flex: 1, minHeight: 0, overflowY: 'auto' } },
              ...d.verList.map((v) => {
                const ms = Number(String(v.ts).split('-')[0]);
                const when = Number.isFinite(ms) && ms > 0
                  ? new Date(ms).toLocaleString('zh-CN', { hour12: false })
                  : v.ts;
                return createElement('div', {
                  key: v.ts,
                  style: {
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    padding: '7px 4px', borderBottom: '1px solid var(--wf-border, #22304a)',
                  },
                },
                  createElement('span', { style: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12, color: 'var(--wf-text, #e6edf7)' } }, `🕒 ${when}`),
                  createElement('button', { className: 'dsh-wf-btn', onClick: () => void d.loadVersion(v.ts) }, '⤺ 回载'),
                );
              }),
            ),
      ),
    ),
  );
}
