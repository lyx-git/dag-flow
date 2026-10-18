// src/client/flowgram/branch-editor.tsx — 分支键显形与就地编辑（连线标签 / 方案 C 编辑器 / switch 新线归属）
// LineBranchLabel：挂在 free-lines-plugin renderInsideLine 上的线中点标签（未设分支警示 / 分支键）；
// BranchKeyEditor：标签点击后在锚点处弹出的就地编辑器（Portal 到 body）；
// adoptChipCaseForNewLines：switch 按选中的 chip 给**刚画的**线定分支键（与命中端口无关）。
// 2026-10-14 重构轮 4 自 FlowGramCanvas.tsx 纯搬运拆出。

import { createElement, useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { WorkflowLinesManager } from '@flowgram.ai/free-layout-editor';
import { branchEditStore, branchKeyText, type BranchEditTarget } from './branchEdit';
import type { RFNode, RFEdge } from '../util/flowDef';
import { SWITCH_NO_CASE } from './nodes';
import { switchCaseStore } from './switchCaseStore';
import { editEdgeKeyRef, graphRef } from './canvas-utils';

/** 分支键显示名（真/假/其他；case 值原样）——与编辑器面板同一口径 */
function branchKeyLabel(key: string): string {
  return branchKeyText(key);
}

/** 连线中点的分支标签。挂在 free-lines-plugin 的 renderInsideLine 上：
 *  容器 = 「该线自身包围盒 + LINE_PADDING」的绝对定位盒（LineSVG 里 left=bounds.x-PADDING），
 *  所以 50%/50% + translate(-50%,-50%) 正好落在线中点，且随画布缩放/平移自动跟随。
 *  - 普通线（源节点非 if/switch）返回 null，不打扰原有观感
 *  - if/switch 的线：有分支键 → 显示标签；**没有分支键 → 琥珀色「未设分支」警示**（否则所有分支都会跑）
 *  - 点标签就地打开编辑器（方案 C） */
export function LineBranchLabel(props: any) {
  const line = props?.line;
  const rawKey = String(line?.fromPort?.portID ?? '');
  // ★ 源/目标节点用 line.from/line.to 取——它们与端口无关；未设分支键的线可能没有 fromPort
  //   （若用 fromPort.node.id 取，恰恰是这种最该报警的线取不到节点 → 警示永远不显示）
  const src = String(line?.from?.id ?? line?.fromPort?.node?.id ?? '');
  const dst = String(line?.to?.id ?? line?.toPort?.node?.id ?? '');
  const node = graphRef.current.nodes.find((n) => n.id === src);
  const nodeType = String(node?.type ?? '');
  const isBranchNode = nodeType === 'if' || nodeType === 'switch';
  if (!isBranchNode) return null;
  // ★ switch 单点端口（2026-10-03 用户拍板 B）：端口不再是分支键本身——'out' = 「这条线还没选分支键」，
  //   与 flowDef.fromRF 的映射一致（端口只决定拖线命中哪个锚点，分支键语义没变）。
  const key = nodeType === 'switch' && rawKey === 'out' ? '' : rawKey;
  // ★ 同一对 from→to 的多条线（多个 case 指向同一目标）标签会精确重叠：按它在同名线里的序号错开，
  //   否则叠成一坨读不出哪个 case 是哪个（?many 夹具就是 8 个 case 指向同一个目标）。
  const dupIdx = Math.max(0, graphRef.current.edges
    .filter((e) => e.source === src && e.target === dst)
    .findIndex((e) => String(e.sourceHandle ?? '') === rawKey));
  const dupStyle = dupIdx > 0 ? { marginTop: `${dupIdx * 13}px` } : undefined;
  const openEditor = (e: any): void => {
    e.stopPropagation();
    e.preventDefault();
    const cases = Object.keys(((node?.data ?? {}) as Record<string, unknown>).cases as object ?? {});
    branchEditStore.open({
      source: src, target: dst, current: key, nodeType, cases,
      anchor: { x: e.clientX ?? 0, y: e.clientY ?? 0 },
    });
  };
  if (!key) {
    return createElement('div', {
      className: 'dsh-wf-fg-line-label is-warn',
      style: dupStyle,
      title: nodeType === 'switch'
        ? '这条线还没选分支键（switch 里先画线、再点这条线的标签选 case）。不选的话它不会被执行'
        : '这条线没设分支键——运行时会把它当作恒激活（if/switch 的所有分支都会执行）。点击设置',
      onClick: openEditor,
    }, '未设分支');
  }
  const cls = key === 'true' ? 'is-true' : key === 'false' ? 'is-false' : key === '*' ? 'is-case' : 'is-case';
  return createElement('div', {
    className: `dsh-wf-fg-line-label ${cls}`,
    style: dupStyle,
    title: `分支键 ${key}（点击修改）`,
    onClick: openEditor,
  }, branchKeyLabel(key));
}

/** 分支键就地编辑器（方案 C）：连线标签点击后在锚点处弹出，直接选/改/清空分支键。
 *  渲染进 body（Portal）——画布层有 transform，面板内 fixed 定位会被包含块拖走。 */
export function BranchKeyEditor() {
  const target: BranchEditTarget | null = useSyncExternalStore(
    branchEditStore.subscribe, branchEditStore.getSnapshot, branchEditStore.getSnapshot,
  );
  const [custom, setCustom] = useState('');
  useEffect(() => { setCustom(''); }, [target?.source, target?.target, target?.current]);
  if (!target) return null;

  const isIf = target.nodeType === 'if';
  // if 只有 true/false 两个固定端口；switch 是已有 cases 键 + '*' 兜底
  const keys = isIf ? ['true', 'false'] : [...target.cases, '*'];
  const apply = (key: string, addCase = false): void => {
    if (!editEdgeKeyRef.current) return;
    editEdgeKeyRef.current({ source: target.source, target: target.target, key, addCase });
    branchEditStore.close();
  };
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const left = Math.max(8, Math.min(target.anchor.x, vw - 300));
  const top = Math.max(8, Math.min(target.anchor.y + 8, vh - 220));

  const btn = (key: string, label: string, addCase = false) => createElement('button', {
    key: `k-${key}`,
    type: 'button',
    className: `dsh-wf-fg-bedit-key${target.current === key ? ' is-current' : ''}`,
    onClick: () => apply(key, addCase),
  }, label);

  return createPortal(
    createElement('div', { className: 'dsh-wf-fg-bedit-mask', onClick: () => branchEditStore.close() },
      createElement('div', {
        className: 'dsh-wf-fg-bedit',
        style: { left, top },
        onClick: (e: any) => e.stopPropagation(),
      },
        createElement('div', { className: 'dsh-wf-fg-bedit-title' },
          '分支键',
          createElement('span', { className: 'dsh-wf-fg-bedit-node' }, `${target.source} → ${target.target}`),
          createElement('button', { className: 'dsh-wf-fg-bedit-close', title: '关闭', onClick: () => branchEditStore.close() }, '✕'),
        ),
        createElement('div', { className: 'dsh-wf-fg-bedit-hint' },
          isIf
            ? '条件分支只有 true/false 两条出口——这条线走哪一条？'
            : '多路分支：可选已有 case，或在下面输入新 case 名（会自动写进该节点的分支表并指向本线目标）。'),
        createElement('div', { className: 'dsh-wf-fg-bedit-keys' },
          keys.map((k) => btn(k, k === '*' ? '* 其他' : `${branchKeyText(k)}（${k}）`)),
          target.current || isIf ? null : btn(target.current, `当前：未设置`, false),
        ),
        !isIf && createElement('div', { className: 'dsh-wf-fg-bedit-custom' },
          createElement('input', {
            value: custom,
            placeholder: '新 case 名（回车确认）',
            onChange: (e: any) => setCustom(e.target.value),
            onKeyDown: (e: any) => {
              if (e.key === 'Enter' && custom.trim()) apply(custom.trim(), true);
              if (e.key === 'Escape') branchEditStore.close();
            },
          }),
          createElement('button', {
            type: 'button',
            className: 'dsh-wf-fg-bedit-add',
            disabled: !custom.trim(),
            onClick: () => { if (custom.trim()) apply(custom.trim(), true); },
          }, '＋ 新建 case'),
        ),
        createElement('div', { className: 'dsh-wf-fg-bedit-foot' },
          createElement('button', {
            type: 'button',
            className: 'dsh-wf-fg-bedit-clear',
            title: '清空分支键（该线变回恒激活——if/switch 的所有分支都会执行）',
            disabled: !target.current,
            onClick: () => apply(''),
          }, '清空分支键'),
          createElement('span', { className: 'dsh-wf-fg-bedit-warn' }, '未设置分支键的线 = 恒激活'),
        ),
      ),
    ),
    document.body,
  );
}

// ================= switch 新线的分支键归属 =================

/** ★ switch 新线的分支键归属（2026-10-03 用户拍板 B；10-03 真机反馈后改为**与命中端口无关**）。
 *  背景：用户要「switch 端口行去掉、只留 chips，选择哪个 chips，画线带出来的就是哪个分支」——但 switch 的
 *  出口端口在视觉上收成了同一个点（多端口同坐标叠着），鼠标命中的是哪个端口由 FlowGram 的绘制顺序决定。
 *  ★真机实测（用户反馈「这个没实现，没选择时画出来的是其他 else」）：引擎会把新线挂到 **`*` 兜底端口**上，
 *    我第一版只处理「挂在 `out` 端口上的新线」→ 真机一律不生效。现在**不再看引擎挂了哪个端口**：
 *  · 选中的 chip → 新线端口改写成这个 case（分支键仍走既有 portID↔when↔next 那套）
 *  · 没选中 → 新线端口改写成 `out`（＝未设分支，先画线、再在线上点选；绝不静默变成 `*` 兜底）
 *  · 老线一律不动（只认「同 from→to 的线数超出上一帧快照」的多出来的线），否则改一次选择会把历史线全带跑。
 *  就地改端口是既有机制（editEdgeKeyRef 同一路：line.updateInfo），不触发整文档重建、不会产生幽灵线。 */
export function adoptChipCaseForNewLines(ctx: any): void {
  try {
    const prev = graphRef.current.edges;
    const prevCount = new Map<string, number>();
    for (const e of prev) {
      const k = `${e.source}|${e.target}`;
      prevCount.set(k, (prevCount.get(k) ?? 0) + 1);
    }
    const typeOf = (id: string): string => String(graphRef.current.nodes.find((n) => n.id === id)?.type ?? '');
    const lm: any = ctx.container.get(WorkflowLinesManager);
    const seen = new Map<string, number>();
    for (const l of (lm.getAllLines?.() ?? [])) {
      if (l?.isDrawing) continue;
      const src = String(l?.from?.id ?? ''); const dst = String(l?.to?.id ?? '');
      if (!src || !dst || typeOf(src) !== 'switch') continue;
      const k = `${src}|${dst}`;
      const idx = (seen.get(k) ?? 0) + 1;
      seen.set(k, idx);
      if (idx <= (prevCount.get(k) ?? 0)) continue;                    // 老线：不动
      const sel = switchCaseStore.getSel(src);
      const hasPort = (p: string): boolean => !!l?.from?.ports?.getPortEntityByKey?.('output', p);
      const want = sel && hasPort(sel) ? sel : SWITCH_NO_CASE;         // 没选中（或 case 端口缺失）→ 归到 out
      const hit = String(l?.fromPort?.portID ?? '');
      if (hit === want) { (window as any).__df_lastLineAdopt = { src, dst, hit, want, applied: false, sel: sel ?? null }; continue; }
      if (!hasPort(want)) continue;
      l.updateInfo((info: any) => { info.fromPort = want; });
      (window as any).__df_lastLineAdopt = { src, dst, hit, want, applied: true, sel: sel ?? null };
    }
  } catch { /* 归属失败不阻断主流程（线仍在，只是留着「未设分支」） */ }
}

/** 保留 RF 图类型的本地引用说明：本文件经 graphRef 读当前画布图（见 canvas-utils.ts）。 */
export type { RFNode, RFEdge };
