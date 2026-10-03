// @ts-nocheck
// src/client/FormView.tsx
// 表单视图（原型 A）：左节点列表（可重排、添加、删除）+ 中参数表单 +
// 右运行记录。参数表单用 dsh-client-ui 槽位（如果 ctx.host.slots.inject 可用）。

import { useMemo, useState, createElement, useEffect } from 'react';
import type { WorkflowDef, ClientNode } from './types';
import { NODE_PALETTE, findMeta } from './types';

interface FormViewProps {
  def: WorkflowDef;
  onChange: (def: WorkflowDef) => void;
  host?: any;
}

interface RunRecord {
  id: string;
  status: 'success' | 'failed' | 'running';
  time: string;
  nodeCount: number;
  summary: string;
}

export function FormView({ def, onChange, host }: FormViewProps) {
  const [selectedId, setSelectedId] = useState<string>(def.nodes[0]?.id ?? '');
  // 真实运行历史：从运行记录（.dag-flow/runs/*.json）拉取最近 20 条
  const [records, setRecords] = useState<RunRecord[]>([]);
  const [recordsLoaded, setRecordsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/dag-flow/runs?workflowName=${encodeURIComponent(def.name)}`, { credentials: 'include' });
        if (!res.ok) throw new Error(`请求失败（HTTP ${res.status}）`);
        const data = await res.json();
        if (!cancelled) {
          const runs = (data.runs ?? []).map((r: any) => ({
            id: r.runId ?? '',
            status: r.status === 'success' ? 'success' : 'failed',
            time: r.startedAt ? String(r.startedAt).replace('T', ' ').slice(0, 19) : '',
            nodeCount: Number(r.totalNodes ?? 0),
            summary: `${r.status === 'success' ? '✓ 成功' : '✗ 失败'} · ${Number(r.totalDurationMs ?? 0)}ms`,
          }));
          setRecords(runs);
          setRecordsLoaded(true);
        }
      } catch {
        if (!cancelled) setRecordsLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [def.name]);

  const selected = useMemo(
    () => def.nodes.find((n) => n.id === selectedId) ?? null,
    [def, selectedId],
  );

  // 拖动重排
  const [dragId, setDragId] = useState<string | null>(null);
  const onDragStart = (id: string) => (e: React.DragEvent) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
  const onDrop = (targetId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragId || dragId === targetId) return;
    const nodes = [...def.nodes];
    const fromIdx = nodes.findIndex((n) => n.id === dragId);
    const toIdx = nodes.findIndex((n) => n.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [m] = nodes.splice(fromIdx, 1);
    nodes.splice(toIdx, 0, m);
    onChange({ ...def, nodes });
    setDragId(null);
  };

  // 添加节点
  const handleAdd = () => {
    const id = `node_${Date.now().toString(36)}`;
    const next: WorkflowDef = {
      ...def,
      nodes: [...def.nodes, { id, type: 'log', label: id, params: { level: 'info', message: '' } }],
    };
    onChange(next);
    setSelectedId(id);
  };

  // 删除节点
  const handleDelete = (id: string) => {
    onChange({
      ...def,
      nodes: def.nodes.filter((n) => n.id !== id),
      edges: def.edges?.filter((e) => e.from !== id && e.to !== id),
    });
    if (selectedId === id) setSelectedId(def.nodes[0]?.id ?? '');
  };

  // 修改节点参数
  const updateNode = (id: string, patch: Partial<ClientNode>) => {
    onChange({
      ...def,
      nodes: def.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    });
  };

  // 尝试用 host.slots.inject 拿一个表单渲染槽（不强制）
  const [slotRender, setSlotRender] = useState<((props: { schema: object; params: unknown; onChange: (p: unknown) => void }) => unknown) | null>(null);
  useEffect(() => {
    if (host?.slots?.inject && typeof host.slots.inject === 'function') {
      try {
        const Slot = host.slots.inject('form.schema');
        if (Slot) setSlotRender(() => Slot);
      } catch { /* 不可用就 fallback */ }
    }
  }, [host]);

  return createElement(
    'div',
    { className: 'dsh-wf-form-root' },
    // 左：节点列表
    createElement(
      'aside',
      { className: 'dsh-wf-form-list' },
      createElement('div', { className: 'dsh-wf-palette-section' }, '工作流节点'),
      ...def.nodes.map((n) => {
        const meta = findMeta(n.type);
        return createElement(
          'div',
          {
            key: n.id,
            className: `dsh-wf-form-list-item ${n.id === selectedId ? 'active' : ''}`,
            onClick: () => setSelectedId(n.id),
            draggable: true,
            onDragStart: onDragStart(n.id),
            onDragOver,
            onDrop: onDrop(n.id),
          },
          createElement('span', { className: 'dsh-wf-palette-emoji', style: { padding: '0 4px', background: meta?.color ?? '#64748b' } }, meta?.emoji ?? '⚙️'),
          createElement('span', { style: { flex: 1 } }, n.label ?? n.id),
          createElement(
            'button',
            {
              className: 'dsh-wf-btn',
              style: { padding: '2px 6px', fontSize: 10 },
              onClick: (e: React.MouseEvent) => { e.stopPropagation(); handleDelete(n.id); },
            },
            '×',
          ),
        );
      }),
      createElement(
        'div',
        { style: { padding: 12 } },
        createElement(
          'button',
          { className: 'dsh-wf-btn dsh-wf-w-full', onClick: handleAdd },
          '+ 添加节点',
        ),
      ),
    ),
    // 中：参数表单
    createElement(
      'main',
      { className: 'dsh-wf-form-detail' },
      selected
        ? createElement(ParamForm, {
            node: selected,
            onChange: (patch) => updateNode(selected.id, patch),
            slotRender,
          })
        : createElement('div', { className: 'dsh-wf-text-muted' }, '未选中节点'),
    ),
    // 右：运行记录（真实数据：GET /api/dag-flow/runs?workflowName=）
    createElement(
      'aside',
      { className: 'dsh-wf-form-record' },
      createElement('div', { className: 'dsh-wf-palette-section' }, '最近运行'),
      !recordsLoaded
        ? createElement('div', { className: 'dsh-wf-text-muted', style: { fontSize: 11, padding: 8 } }, '加载中…')
        : records.length === 0
          ? createElement('div', { className: 'dsh-wf-text-muted', style: { fontSize: 11, padding: 8 } },
              '暂无运行记录。点顶部「▶ 运行」后，这里会显示最近的执行历史。')
          : null,
      ...records.map((r) =>
        createElement(
          'div',
          {
            key: r.id,
            style: {
              padding: 8,
              marginBottom: 8,
              borderRadius: 6,
              background: r.status === 'success' ? 'rgba(16, 185, 129, 0.1)' : r.status === 'failed' ? 'rgba(244, 63, 94, 0.1)' : 'rgba(100, 116, 139, 0.1)',
              border: `1px solid ${r.status === 'success' ? '#10b981' : r.status === 'failed' ? '#f43f5e' : '#64748b'}`,
              fontSize: 11,
            },
          },
          createElement('div', { style: { display: 'flex', justifyContent: 'space-between' } },
            createElement('span', { style: { fontWeight: 500 } }, r.summary),
            createElement('span', { className: 'dsh-wf-text-muted' }, r.time),
          ),
          createElement('div', { className: 'dsh-wf-text-muted', style: { marginTop: 4 } }, `${r.nodeCount} 节点`),
        ),
      ),
    ),
  );
}

function ParamForm({ node, onChange, slotRender }: {
  node: ClientNode;
  onChange: (patch: Partial<ClientNode>) => void;
  slotRender: ((props: { schema: object; params: unknown; onChange: (p: unknown) => void }) => unknown) | null;
}) {
  const meta = findMeta(node.type);
  // 优先用 slot
  if (slotRender) {
    return createElement('div', null,
      createElement('h2', { style: { fontSize: 18, fontWeight: 600, marginBottom: 12 } }, `${meta?.emoji ?? '⚙️'} ${node.label ?? node.id}`),
      slotRender({
        schema: meta ? NODE_PALETTE.find((m) => m.type === node.type) ?? {} : {},
        params: node.params ?? {},
        onChange: (p) => onChange({ params: p as Record<string, unknown> }),
      }) as React.ReactElement,
    );
  }
  // fallback：手写 key-value 编辑
  return createElement(
    'div',
    null,
    createElement(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 } },
      createElement('span', { style: { fontSize: 24 } }, meta?.emoji ?? '⚙️'),
      createElement('div', null,
        createElement('h2', { style: { fontSize: 18, fontWeight: 600, margin: 0 } }, node.label ?? node.id),
        createElement('div', { className: 'dsh-wf-text-muted', style: { fontSize: 11 } }, `类型: ${node.type} · ID: ${node.id}`),
      ),
    ),
    createElement(
      'div',
      { style: { background: 'var(--dsh-wf-panel)', border: '1px solid var(--dsh-wf-border)', borderRadius: 8, padding: 16 } },
      createElement('div', { style: { marginBottom: 12 } },
        createElement('label', { className: 'dsh-wf-panel-label' }, '节点 ID'),
        createElement('input', { className: 'dsh-wf-input', value: node.id, readOnly: true }),
      ),
      createElement('div', { style: { marginBottom: 12 } },
        createElement('label', { className: 'dsh-wf-panel-label' }, '显示名 (label)'),
        createElement('input', {
          className: 'dsh-wf-input',
          defaultValue: node.label ?? node.id,
          onBlur: (e: React.FocusEvent<HTMLInputElement>) => onChange({ label: e.target.value }),
        }),
      ),
      createElement('div', { style: { marginBottom: 12 } },
        createElement('label', { className: 'dsh-wf-panel-label' }, '节点类型'),
        createElement(
          'select',
          {
            className: 'dsh-wf-select',
            value: node.type,
            onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onChange({ type: e.target.value }),
          },
          ...NODE_PALETTE.map((m) => createElement('option', { key: m.type, value: m.type }, `${m.emoji} ${m.label}`)),
        ),
      ),
      createElement('div', null,
        createElement('label', { className: 'dsh-wf-panel-label' }, '参数 (params, JSON)'),
        createElement('textarea', {
          className: 'dsh-wf-textarea',
          rows: 10,
          defaultValue: JSON.stringify(node.params ?? {}, null, 2),
          onBlur: (e: React.FocusEvent<HTMLTextAreaElement>) => {
            try {
              onChange({ params: JSON.parse(e.target.value || '{}') as Record<string, unknown> });
            } catch { /* ignore */ }
          },
        }),
      ),
    ),
  );
}
