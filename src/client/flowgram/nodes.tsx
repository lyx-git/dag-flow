// @ts-nocheck
// src/client/flowgram/nodes.tsx
// FlowGram 节点注册表：20 个内置节点 → FlowNodeRegistry。
// 节点卡视觉 = formMeta.render（nodeEngine 表单引擎渲染进节点体）；
// 端口：start 只有 output，end 只有 input，if 双输出（true/false），其余 左入右出。

import { createElement } from 'react';
import { useSyncExternalStore } from 'react';
import { DataEvent, Field, FlowNodeRegistry, useNodeRender } from '@flowgram.ai/free-layout-editor';
import { findMeta } from '../types';
import { runStatusStore, selectionStore } from './runStatus';

/** loop 卡片副标题（P1，2026-10-03 用户拍板）：按**实际生效的边界**显示。
 *  引擎优先级 over > count > while——旧实现只认 count，配了 over/while 的循环卡片显示 `count=?`（错信息）。 */
function loopSubtitle(data: Record<string, unknown>): string {
  const cap = typeof data.maxIterations === 'number' ? ` · 上限 ${data.maxIterations}` : '';
  const over = data.over;
  if (Array.isArray(over)) return `遍历 ${over.length} 项${cap}`;
  if (typeof over === 'string' && over.trim()) return (`遍历 ${over.trim()}`).slice(0, 48) + cap;
  if (typeof data.count === 'number') return `循环 ${data.count} 次${cap}`;
  if (typeof data.while === 'string' && data.while.trim()) return (`while: ${data.while.trim()}`).slice(0, 48) + cap;
  return '⚠ 无循环边界';
}

/** 节点副标题（沿用旧 Canvas 的 pickSubtitle 逻辑） */
function pickSubtitle(type: string, data: Record<string, unknown>): string {
  switch (type) {
    case 'python': return `3.12 内置 · timeout ${(data.timeoutMs as number) ?? 30000}ms`;
    case 'bash': return `便携 bash · timeout ${(data.timeoutMs as number) ?? 30000}ms`;
    case 'http': return `${(data.method as string) ?? 'GET'} ${(data.url as string) ?? ''}`;
    case 'web_search': return `${(data.provider as string) || 'auto'} · ${(data.count as number) ?? 8} 条 · ${(data.query as string) || ''}`.slice(0, 60);
    case 'web_fetch': return `→ ${(data.url as string) || '（未填网址）'}`.slice(0, 60);
    case 'subagent': return `${(data.model as string) || 'AI 子代理'}`;
    case 'if': return (data.condition as string) ?? 'condition';
    case 'switch': {
      const caseCount = Object.keys((data.cases as object) ?? {}).length;
      return `value=${(data.value as string) ?? ''} · ${caseCount} 个分支${caseCount >= 7 ? '（紧凑）' : ''}`;
    }
    case 'loop': return loopSubtitle(data);
    case 'set_var': return Object.keys((data.vars as object) ?? {}).join(', ') || '(empty)';
    case 'log': return `${(data.level as string) ?? 'info'}: ${(data.message as string) ?? ''}`;
    case 'manual': return (data.prompt as string) ?? 'awaiting user';
    case 'session_input': return `session ${(data.sessionId as string) || 'current'} · limit ${(data.limit as number) ?? 10}`;
    case 'merge': return '合流上游输出';
    case 'subflow': return `↳ ${(data.workflowName as string) || '（未命名子工作流）'}`;
    case 'image_generate': return `${(data.model as string) || 'wanx-v1'} · ${(data.size as string) || '1024*1024'}`;
    case 'video_generate': return `轮询 ${(data.pollIntervalMs as number) ?? 5000}ms · max ${Math.round(((data.maxWaitMs as number) ?? 600000) / 1000)}s`;
    case 'file_save': return `→ ${(data.filename as string) || 'output.txt'}`;
    case 'start': return '入口';
    case 'end': return '出口';
    default: return '';
  }
}

/** switch 端口行距 / 卡内标签策略（2026-10-03 用户拍板 A+A+：case 过多会把节点撑得很大、不利于看流程）。
 *  case ≥ 7 进入紧凑：端口行距 30→12px + **卡内标签隐藏**（每条连线中点本来就有分支键标签，信息不丢）。
 *  端口是连线的锚点、不能隐藏，所以压缩只能落在行距与卡内标签上。 */
const SWITCH_TIGHT_FROM = 7;
function switchLayout(caseCount: number): { gap: number; showLabels: boolean } {
  return caseCount >= SWITCH_TIGHT_FROM ? { gap: 12, showLabels: false } : { gap: 30, showLabels: true };
}

/** 节点卡内容（渲染在 FlowGram 节点体内） */
function NodeCardBody({ type }: { type: string }) {
  const { node, form } = useNodeRender();
  const meta = findMeta(type);
  if (!meta) return null;
  const values = (form?.values ?? {}) as Record<string, unknown>;
  const label = (values.label as string) ?? node.id;
  const sub = pickSubtitle(type, values);
  const rsSelector = () => runStatusStore.getSnapshot()[node.id];
  const rs = useSyncExternalStore(runStatusStore.subscribe, rsSelector, rsSelector);
  const selSelector = () => selectionStore.getSnapshot() === node.id;
  const isSelected = useSyncExternalStore(selectionStore.subscribe, selSelector, selSelector);
  const statusCls = rs?.status === 'success' ? 'is-ok' : rs?.status === 'failed' ? 'is-err' : rs?.status === 'skipped' ? 'is-skip' : '';
  // ★ 分支端口标签（2026-10-03 用户需求 B）：端口是多输出动态生成的，位置固定在
  //   top = 22 + i*30（if 的 ['true','false']、switch 的 cases 键 + '*' 兜底，与 formMeta
  //   里的 locationConfig.top 一致）。标签贴在卡片右内侧，与端口同高，一眼看出该从哪个口拖线。
  const caseKeys = type === 'switch' ? Object.keys((values.cases as Record<string, unknown>) ?? {}) : [];
  const branchKeys: string[] = type === 'if'
    ? (((values.portKeys as string[]) ?? ['true', 'false']).slice(0, 2))
    : type === 'switch' && caseKeys.length
      ? [...caseKeys, '*']
      : [];
  // ★ 紧凑策略（A+A+）：switch 分支多时行距压到 12px 并隐藏卡内标签，避免把整条流程拉散
  const { gap, showLabels } = type === 'switch' ? switchLayout(caseKeys.length) : { gap: 30, showLabels: true };
  const branchLabels = showLabels ? branchKeys.map((k, i) => createElement(
    'div',
    {
      key: `branch-${k}`,
      className: `dsh-wf-fg-branch-label${k === 'true' ? ' is-true' : k === 'false' ? ' is-false' : k === '*' ? ' is-star' : ''}`,
      style: { top: `${22 + i * gap}px` },
      title: `${type === 'switch' ? 'case' : '分支'}：${k === '*' ? '*（无匹配时的兜底）' : k}`,
    },
    k === '*' ? '其他' : k === 'true' ? '真' : k === 'false' ? '假' : k,
  )) : [];
  // ★ 卡片随分支数增高：端口位置 = top 22 + i*gap，卡片不跟着长高时最后一个端口（'*' 兜底）会落到卡片外。
  const portMinHeight = branchKeys.length ? 22 + (branchKeys.length - 1) * gap + 24 : undefined;
  return createElement(
    'div',
    {
      className: `dsh-wf-fg-card${statusCls ? ' ' + statusCls : ''}${isSelected ? ' fg-selected' : ''}`,
      style: {
        ['--kind' as string]: meta.color,
        ...(portMinHeight ? { minHeight: `${portMinHeight}px` } : {}),
      },
    },
    // 运行耗时徽标（右上）
    rs?.durationMs != null
      ? createElement('span', { className: `dsh-wf-fg-badge${rs.status === 'failed' ? ' err' : ''}${type === 'loop' && rs.count != null ? ' is-loop' : ''}` },
          `${rs.status === 'failed' ? '✕' : rs.status === 'skipped' ? '○' : '✓'} ${Math.round(rs.durationMs)}ms${type === 'loop' && rs.count != null ? ` · 循环 ${rs.count} 次` : ''}`)
      : rs?.status === 'skipped'
        ? createElement('span', { className: 'dsh-wf-fg-badge' }, '○ skip')
        : null,
    createElement('div', { className: 'dsh-wf-fg-card-head' },
      createElement('div', { className: 'dsh-wf-fg-card-icon' }, meta.emoji),
      createElement('div', { className: 'dsh-wf-fg-card-titles' },
        createElement('div', { className: 'dsh-wf-fg-card-title' }, label),
        createElement('div', { className: 'dsh-wf-fg-card-type' }, `${meta.label} · ${node.id}`),
      ),
    ),
    createElement('div', { className: 'dsh-wf-fg-card-sub', title: sub }, sub),
    branchLabels.length ? branchLabels : null,
  );
}

/** 通用 formMeta：卡片内容渲染 */
function makeFormMeta(type: string) {
  return {
    render: () => createElement(NodeCardBody, { type }),
  };
}

/** if 节点 formMeta：动态双输出端口（true 绿 / false 红，右侧上下分布） */
function makeIfFormMeta() {
  const PORT_KEYS = ['true', 'false'];
  const TOPS = [22, 52];
  return {
    formatOnInit: (value) => ({ portKeys: PORT_KEYS, ...(value ?? {}) }),
    effect: {
      portKeys: [
        {
          event: DataEvent.onValueInitOrChange,
          effect: ({ value, context }) => {
            const { node } = context;
            const ports = [{ type: 'input' }];
            (value ?? PORT_KEYS).forEach((portID, i) => {
              ports.push({
                type: 'output',
                portID,
                location: 'right',
                locationConfig: { right: 0, top: TOPS[i] ?? 22 + i * 30 },
              });
            });
            node.ports.updateAllPorts(ports);
          },
        },
      ],
    },
    render: () => createElement(NodeCardBody, { type: 'if' }),
  };
}

/** switch 动态多输出端口：按 data.cases 的键生成（每 case 一个，'*' 兜底置底） */
function makeSwitchFormMeta() {
  return {
    formatOnInit: (value) => ({ ...(value ?? {}) }),
    effect: {
      cases: [
        {
          event: DataEvent.onValueInitOrChange,
          effect: ({ value, context }) => {
            const { node } = context;
            const keys = Object.keys((value as Record<string, unknown>)?.cases ?? {});
            const { gap } = switchLayout(keys.length); // 紧凑策略与卡片渲染同源（A+A+）
            const ports: unknown[] = [{ type: 'input' }];
            keys.forEach((k, i) => {
              ports.push({
                type: 'output',
                portID: k,
                location: 'right',
                locationConfig: { right: 0, top: 22 + i * gap },
              });
            });
            if (keys.length) {
              ports.push({
                type: 'output',
                portID: '*',
                location: 'right',
                locationConfig: { right: 0, top: 22 + keys.length * gap },
              });
            }
            node.ports.updateAllPorts(ports);
          },
        },
      ],
    },
    render: () => createElement(NodeCardBody, { type: 'switch' }),
  };
}

function registry(type: string, metaExtra: Record<string, unknown>): FlowNodeRegistry {
  const meta = { defaultExpanded: true, ...(metaExtra ?? {}) };
  return { type, meta, formMeta: makeFormMeta(type) };
}

/** 20 节点注册表（与 NODE_PALETTE 一一对应） */
export const DSH_NODE_REGISTRIES: FlowNodeRegistry[] = [
  registry('start', { defaultPorts: [{ type: 'output' }] }),
  registry('end', { defaultPorts: [{ type: 'input' }] }),
  { type: 'if', meta: { defaultExpanded: true, defaultPorts: [{ type: 'input' }] }, formMeta: makeIfFormMeta() },
  { type: 'switch', meta: { defaultExpanded: true, defaultPorts: [{ type: 'input' }] }, formMeta: makeSwitchFormMeta() },
  registry('merge', { defaultPorts: [{ type: 'input' }, { type: 'input' }, { type: 'output' }] }),
  registry('subflow', { defaultPorts: [{ type: 'input' }, { type: 'output' }] }),
  registry('image_generate', { defaultPorts: [{ type: 'input' }, { type: 'output' }] }),
  registry('video_generate', { defaultPorts: [{ type: 'input' }, { type: 'output' }] }),
  registry('file_save', { defaultPorts: [{ type: 'input' }, { type: 'output' }] }),
  registry('loop', { defaultPorts: [{ type: 'input' }, { type: 'output' }] }),
  registry('manual', { defaultPorts: [{ type: 'input' }, { type: 'output' }] }),
  registry('python', { defaultPorts: [{ type: 'input' }, { type: 'output' }] }),
  registry('bash', { defaultPorts: [{ type: 'input' }, { type: 'output' }] }),
  registry('http', { defaultPorts: [{ type: 'input' }, { type: 'output' }] }),
  registry('web_search', { defaultPorts: [{ type: 'input' }, { type: 'output' }] }),
  registry('web_fetch', { defaultPorts: [{ type: 'input' }, { type: 'output' }] }),
  registry('subagent', { defaultPorts: [{ type: 'input' }, { type: 'output' }] }),
  // ★ session_input 必须有 input 端口（2026-10-02 用户反馈：拖线创建会话输入节点后不连线）——
  //   buildLine 按 inputPorts.length>0 门控，此前只注册 output 端口导致拖线创建后静默不连线；
  //   执行器对它有上游边也只是拓扑排序靠后，无副作用。
  registry('session_input', { defaultPorts: [{ type: 'input' }, { type: 'output' }] }),
  registry('set_var', { defaultPorts: [{ type: 'input' }, { type: 'output' }] }),
  registry('log', { defaultPorts: [{ type: 'input' }] }),
];

export { pickSubtitle };
export { Field }; // re-export 供 FlowGramCanvas 使用（Field 目前未直接用，保留类型一致性）
