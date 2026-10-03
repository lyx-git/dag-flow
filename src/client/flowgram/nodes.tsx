// @ts-nocheck
// src/client/flowgram/nodes.tsx
// FlowGram 节点注册表：20 个内置节点 → FlowNodeRegistry。
// 节点卡视觉 = formMeta.render（nodeEngine 表单引擎渲染进节点体）；
// 端口：start 只有 output，end 只有 input，if 双输出（true/false），其余 左入右出。

import { createElement } from 'react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { DataEvent, Field, FlowNodeRegistry, useNodeRender } from '@flowgram.ai/free-layout-editor';
import { findMeta } from '../types';
import { runStatusStore, selectionStore } from './runStatus';
import { switchCaseStore } from './switchCaseStore';

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
      // 2026-10-03 起 switch 卡片只留一行 chips（选中的分支键与操作提示见 switchSubtitle），
      // 端口行/紧凑档已删除——这里只报「值 + 分支数」。
      return `value=${(data.value as string) ?? ''} · ${caseCount} 个分支`;
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

/** switch 卡片策略（2026-10-03 用户拍板 B）——用户原话：
 *  「switch 节点里面的端口行去掉，保留 chips，选择哪个 chips，画线带出来的就是哪个分支，
 *    如果有很多分支或者 chips 没展示出来，就在节点里面写明情况说明，先画线，再在线上选择需要的 case 分支，
 *    节点保持和其他的节点大小一致」。
 *  实现（**原逻辑零改动**：分支键仍是 FlowGram 端口 portID ↔ flowDef 的 sourceHandle/when，
 *  执行器读 node.next、多个 case 指向同一目标等一切照旧）：
 *   · 端口行删除：每个 case 仍各有端口（连线锚点/分支键/共享目标都靠它），但全部放在**同一个点**上
 *     （卡片右侧中部，与普通节点的输出口同高）→ 视觉上只剩一个圆点；
 *   · 拖线带哪个分支：把「当前选中的 chip」端口排到端口列表**最后**（DOM 最后 ⇒ 绘在最上层、命中它）；
 *     没选中任何 chip 时排最后的是 'out'（= 这条线先不带分支键，画完再在线上点选）；
 *   · 卡片高度恒定：一行 chips（放不下时末尾「+N」）+ 只在放不下时多一行说明，
 *     与 case 数无关（普通节点是 head+sub ≈ 59px，switch 多一行 chips）。 */
const SWITCH_CHIP_MAX = 4;    // 一行最多几个 chip（超出 → 前 3 个 + 「+N」）
const SWITCH_CARD_MIN_H = 91; // 恒定高度（实测：普通节点 78px，switch + 一行 chips = 91px；溢出再加一行说明 107px）
const SWITCH_NO_CASE = 'out'; // 「还没选分支键」的端口：flowDef.fromRF 把它按未设分支处理

/** switch 端口列表（真源：formMeta 用；顺序恒定，端口集合恒定 ⇒ 改 case 只增删对应端口，绝不动别的）
 *  ★ 拖线命中哪个端口**不作为分支键的依据**——同坐标叠了多个端口元素，命中顺序由 FlowGram 绘制顺序决定，
 *    实测会命中任意 case。真正的分支键来源是「节点上选中的 chip」，由 FlowGramCanvas 在**新线落地时**
 *    就地改端口（见 adoptChipCaseForNewLines）。 */
function switchPorts(keys: string[]): unknown[] {
  const all = [...keys, ...(keys.length ? ['*'] : []), SWITCH_NO_CASE];
  return [
    { type: 'input' },
    // ★ 不给 locationConfig：与普通节点的单出口一样由引擎**垂直居中**——所有 case 端口锚在同一像素上，
    //   视觉上只有一个圆点（给显式 top 实测反而让「有连线的端口」和「out 端口」差出 14px → 两个圆点）
    ...all.map((k) => ({ type: 'output', portID: k })),
  ];
}

/** switch 副标题：值 + 分支数 + 「这次拉线会带哪个分支」（不额外占行，卡片高度不因此增长） */
function switchSubtitle(values: Record<string, unknown>, selected: string | null, caseCount: number): string {
  const head = `value=${(values.value as string) ?? ''} · ${caseCount} 个分支`;
  return selected
    ? `${head} · 已选 ${selected === '*' ? '其他' : selected}（拉线即带）`
    : `${head} · 先画线，再在线上点选分支`;
}

/** switch 卡片上的一个 chip。
 *  ★ 为什么用**原生监听器**而不是 React 的 onClick：节点卡渲染在 FlowGram 的节点层里，卡内的
 *    click/mousedown 冒泡会被画布的节点拖拽/选中处理 stopPropagation 掉——实测 React 的委托 onClick
 *    在卡内根本收不到事件（native `chip.click()` 都不触发），而直接在元素上加监听器能收到。
 *    同时把 mousedown/pointerdown 停住，避免点 chip 被画布当成节点拖拽/框选。 */
function SwitchChip(props: { text: string; title: string; cls: string; onPick: () => void }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const cbRef = useRef(props.onPick);
  cbRef.current = props.onPick;
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const stop = (e: Event): void => { e.stopPropagation(); };
    const pick = (e: Event): void => { e.stopPropagation(); e.preventDefault(); cbRef.current(); };
    el.addEventListener('click', pick);
    el.addEventListener('mousedown', stop);
    el.addEventListener('pointerdown', stop);
    el.addEventListener('mouseup', stop);
    return () => {
      el.removeEventListener('click', pick);
      el.removeEventListener('mousedown', stop);
      el.removeEventListener('pointerdown', stop);
      el.removeEventListener('mouseup', stop);
    };
  }, []);
  return createElement('span', { ref, className: props.cls, title: props.title }, props.text);
}

/** switch 卡片（渲染在 FlowGram 节点体内） */
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
  // ★ switch 卡片（2026-10-03 用户拍板 B）：端口行删除，只留一行 chips ——
  //   点 chip 选分支 → 之后从本节点拉出的线**自带**该分支键；没选 → 拉出的线不带分支键（先画线、再在线上点选）。
  const caseKeys = type === 'switch' ? Object.keys((values.cases as Record<string, unknown>) ?? {}) : [];
  const caseSel = useSyncExternalStore(
    switchCaseStore.subscribe,
    () => switchCaseStore.getSel(node.id),
    () => switchCaseStore.getSel(node.id),
  );
  const chipKeys = type === 'switch' && caseKeys.length ? [...caseKeys, '*'] : [];
  // ★ 折叠的 chips 要能展开（2026-10-03 真机反馈「手动再选择没看到 case」）：默认一行（放不下显示 +N），
  //   点 +N → 展开成多行把所有 case 都露出来（卡片随之变高，用户主动触发），再点「收起」还原。
  const [chipsOpen, setChipsOpen] = useState(false);
  const foldAt = Math.max(1, SWITCH_CHIP_MAX - 1);
  const foldedCount = Math.max(0, chipKeys.length - foldAt);
  const shownChips = (chipsOpen || chipKeys.length <= SWITCH_CHIP_MAX) ? chipKeys : chipKeys.slice(0, foldAt);
  const hiddenChips = chipKeys.length - shownChips.length;
  const pickChip = (k: string): void => {
    switchCaseStore.toggleSel(node.id, k);
    // 诊断钩子（真机/CDP 排查「点了没反应 / 拉线没带分支」）
    (window as any).__df_lastChipClick = { node: node.id, key: k, sel: switchCaseStore.getSel(node.id), at: Date.now() };
  };
  const switchChips = chipKeys.length ? createElement(
    'div',
    { className: `dsh-wf-fg-chips${chipsOpen ? ' is-expanded' : ''}` },
    ...shownChips.map((k) => createElement(SwitchChip, {
      key: `chip-${k}`,
      cls: `dsh-wf-fg-chip${k === '*' ? ' is-star' : ''}${caseSel === k ? ' is-sel' : ''}`,
      title: `case：${k === '*' ? '*（无匹配时的兜底）' : k} —— ${caseSel === k
        ? '已选中：从本节点拉出的新线自带这个分支键（再点一次取消）'
        : '点击选中：之后从本节点拉线即带这个分支键'}`,
      text: `${caseSel === k ? '✓ ' : ''}${k === '*' ? '其他' : k}`,
      onPick: () => pickChip(k),
    })),
    foldedCount > 0
      ? createElement(SwitchChip, {
          key: 'chip-more',
          cls: `dsh-wf-fg-chip is-more${chipsOpen ? ' is-open' : ''}`,
          title: chipsOpen ? '收起（恢复成一行）' : `展开全部 ${chipKeys.length} 个分支（卡片会变高，展开后可点任意 case）`,
          text: chipsOpen ? '收起' : `+${foldedCount}`,
          onPick: () => setChipsOpen((v) => !v),
        })
      : null,
  ) : null;
  /** 情况说明（用户要求）：chips 一行放不下时在卡片里写明还有多少分支、怎么操作 */
  const switchNote = !chipsOpen && hiddenChips > 0
    ? createElement('div', {
        className: 'dsh-wf-fg-card-note',
        title: `还有 ${hiddenChips} 个分支未展示——点 chips 行末尾的「+${hiddenChips}」可展开全部，也可以先画线、再在线上点选分支`,
      }, `还有 ${hiddenChips} 个分支未展示 · 点「+${hiddenChips}」展开，或先画线再在线上点选分支`)
    : null;
  // if 节点保持原样（2026-10-03 需求 B）：双端口 + 与端口同高的逐行标签
  const ifLabels = type === 'if'
    ? (((values.portKeys as string[]) ?? ['true', 'false']).slice(0, 2)).map((k, i) => createElement(
      'div',
      {
        key: `branch-${k}`,
        className: `dsh-wf-fg-branch-label${k === 'true' ? ' is-true' : k === 'false' ? ' is-false' : ''}`,
        style: { top: `${22 + i * 30}px` },
        title: `分支：${k === '*' ? '*（无匹配时的兜底）' : k}`,
      },
      k === 'true' ? '真' : k === 'false' ? '假' : k,
    ))
    : [];
  // ★ 高度：switch 恒定（与 case 数无关，用户要「和其他节点大小一致」）；if 随两个端口行定高
  const minHeight = type === 'switch'
    ? SWITCH_CARD_MIN_H
    : (ifLabels.length ? 22 + (ifLabels.length - 1) * 30 + 24 : 0);
  const subText = type === 'switch' ? switchSubtitle(values, caseSel, caseKeys.length) : sub;
  return createElement(
    'div',
    {
      className: `dsh-wf-fg-card${type === 'switch' ? ' is-switch' : ''}${statusCls ? ' ' + statusCls : ''}${isSelected ? ' fg-selected' : ''}`,
      style: {
        ['--kind' as string]: meta.color,
        ...(minHeight ? { minHeight: `${minHeight}px` } : {}),
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
    createElement('div', { className: 'dsh-wf-fg-card-sub', title: subText }, subText),
    switchChips,
    switchNote,
    ifLabels.length ? ifLabels : null,
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

/** switch 端口（2026-10-03 用户拍板 B）：**不再按 case 分行**——所有出口端口放在同一个点，
 *  视觉上只剩一个圆点（端口行「消失」），但每个 case 仍有自己的端口 ⇒ 分支键/lines 锚点/
 *  多个 case 指向同一目标的原逻辑一字未改。
 *  端口顺序 = 拖线命中优先级（DOM 最后 ⇒ 绘在最上层）：选中的 chip 排最后；没选中则 'out' 排最后
 *  （'out' = 这条线先不带分支键，画完在线上点选）。 */
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
            // 端口集合恒定（cases + '*' + 'out'）→ 改 case 只重排不增删，已画出的线不会掉
            node.ports.updateAllPorts(switchPorts(keys) as never);
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
export { SWITCH_NO_CASE }; // switch「还没选分支键」的端口 id：FlowGramCanvas 的新线归属要用它
export { Field }; // re-export 供 FlowGramCanvas 使用（Field 目前未直接用，保留类型一致性）
