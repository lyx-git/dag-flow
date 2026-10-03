// @ts-nocheck
// src/client/ManageView.tsx — 工作流管理视图
// 列出所有已保存的工作流 JSON（名称 + 节点数），支持打开/复制/重命名/删除，
// 支持名称过滤。存储：<工作区>/.dag-flow/workflow/<name>.json（工作区 JSON 文件）。

import { createElement, useMemo, useState } from 'react';

interface Props {
  meta: { name: string; nodes: number }[];
  onRefresh: () => void;
  onOpen: (name: string) => void;
  onDelete: (name: string) => Promise<void>;
  onCopy: (name: string) => Promise<void>;
  onRename: (oldName: string, newName: string) => Promise<void>;
}

export function ManageView({ meta, onRefresh, onOpen, onDelete, onCopy, onRename }: Props): any {
  const [filter, setFilter] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ name: string; value: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const shown = useMemo(
    () => meta.filter((m) => !filter || m.name.includes(filter.trim().toLowerCase())),
    [meta, filter],
  );

  const flash = (t: string): void => { setMsg(t); setTimeout(() => setMsg(null), 2500); };

  const doDelete = async (): Promise<void> => {
    if (!confirmDelete) return;
    try { await onDelete(confirmDelete); flash(`已删除「${confirmDelete}」`); }
    catch (e) { flash(`删除失败：${(e as Error).message}——请重试`); }
    setConfirmDelete(null);
  };

  const doRename = async (): Promise<void> => {
    if (!renaming) return;
    try { await onRename(renaming.name, renaming.value); flash(`已重命名为「${renaming.value}」`); }
    catch (e) { flash(`重命名失败：${(e as Error).message}——请重试`); }
    setRenaming(null);
  };

  return createElement('div', { className: 'dsh-wf-manage' },
    createElement('div', { className: 'dsh-wf-manage-head' },
      createElement('div', { className: 'dsh-wf-manage-title' }, '📋 工作流配置（' + meta.length + '）'),
      createElement('input', {
        className: 'dsh-wf-input',
        placeholder: '🔍 过滤名称…',
        value: filter,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setFilter(e.target.value),
        style: { maxWidth: 160, marginRight: 8 },
      }),
      createElement('button', {
        className: 'dsh-wf-btn',
        onClick: onRefresh,
        title: '刷新已保存的工作流列表',
      }, '🔄 刷新'),
    ),
    meta.length === 0
      ? createElement('div', { className: 'dsh-wf-manage-empty' },
          '暂无已保存的工作流。先在画布搭建流程，点「💾 保存」后即可在此管理；或从左上角入口直接新建。',
        )
      : shown.length === 0
        ? createElement('div', { className: 'dsh-wf-manage-empty' }, '没有匹配的工作流——调整过滤词试试。')
        : createElement('div', { className: 'dsh-wf-manage-list' },
            ...shown.map((m) => createElement('div', {
              key: m.name,
              className: 'dsh-wf-manage-item',
              onClick: () => onOpen(m.name),
              title: '打开「' + m.name + '」到画布编辑',
            },
              createElement('div', { className: 'dsh-wf-manage-item-name' }, '📄 ' + m.name),
              createElement('div', { className: 'dsh-wf-manage-item-meta' }, m.nodes + ' 节点'),
              createElement('div', { className: 'dsh-wf-manage-item-actions', style: { display: 'flex', gap: 4 }, onClick: (e: React.MouseEvent) => e.stopPropagation() },
                createElement('button', { className: 'dsh-wf-btn', title: '重命名', onClick: () => setRenaming({ name: m.name, value: m.name }) }, '✎'),
                createElement('button', { className: 'dsh-wf-btn', title: '复制一份', onClick: () => void onCopy(m.name) }, '⧉'),
                createElement('button', { className: 'dsh-wf-btn dsh-wf-btn-close', title: '删除（不可恢复）', onClick: () => setConfirmDelete(m.name) }, '🗑'),
              ),
              createElement('div', { className: 'dsh-wf-manage-item-action' }, '编辑 →'),
            )),
          ),
    // 删除确认弹窗
    confirmDelete && createElement('div', {
      className: 'dag-flow-picker-overlay',
      onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) setConfirmDelete(null); },
    },
      createElement('div', { className: 'dag-flow-picker' },
        createElement('div', { className: 'dag-flow-picker-title' }, `🗑 删除工作流「${confirmDelete}」？`),
        createElement('div', { className: 'dag-flow-picker-body' },
          createElement('div', { className: 'dag-flow-picker-hint' }, '将删除其 JSON 文件与全部历史版本，不可恢复。')),
        createElement('div', { className: 'dag-flow-picker-foot' },
          createElement('button', { onClick: () => setConfirmDelete(null) }, '取消'),
          createElement('button', {
            className: 'primary', style: { background: 'linear-gradient(135deg, #f87171, #ef4444)' },
            onClick: () => void doDelete(),
          }, '确认删除'),
        ),
      ),
    ),
    // 重命名弹窗
    renaming && createElement('div', {
      className: 'dag-flow-picker-overlay',
      onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) setRenaming(null); },
    },
      createElement('div', { className: 'dag-flow-picker' },
        createElement('div', { className: 'dag-flow-picker-title' }, `✎ 重命名「${renaming.name}」`),
        createElement('div', { className: 'dag-flow-picker-body' },
          createElement('div', { className: 'dag-flow-picker-hint' }, '小写字母/数字/连字符。'),
          createElement('input', {
            className: 'dsh-wf-input', value: renaming.value, autoFocus: true,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setRenaming({ name: renaming.name, value: e.target.value }),
            onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') void doRename(); },
          })),
        createElement('div', { className: 'dag-flow-picker-foot' },
          createElement('button', { onClick: () => setRenaming(null) }, '取消'),
          createElement('button', { className: 'primary', onClick: () => void doRename() }, '确认'),
        ),
      ),
    ),
    msg && createElement('div', {
      style: {
        position: 'fixed', bottom: 18, left: '50%', transform: 'translateX(-50%)', zIndex: 10001,
        background: 'var(--wf-panel, #101a2b)', border: '1px solid var(--wf-accent, #4f8cff)',
        borderRadius: 8, padding: '6px 14px', fontSize: 12, color: 'var(--wf-text, #e6edf7)',
      },
    }, msg),
  );
}
