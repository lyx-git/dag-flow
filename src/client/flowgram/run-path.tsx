// src/client/flowgram/run-path.tsx — 运行路径高亮（2026-10-11 用户拍板方案 C）与连线最终配色
// linePropsFor = free-lines-plugin customLineProps 扩展点（官方交互反馈 > 运行路径 > 分支配色）；
// CometDots = 「正在走」的光点（沿这条线自己的贝塞尔路径跑，offset-path 动画）；
// LineInside = renderInsideLine 挂载点（分支键标签 + 光点）；RunPathSync = 运行态 → 连线实体同步。
// 2026-10-14 重构轮 4 自 FlowGramCanvas.tsx 纯搬运拆出。

import { Fragment, createElement, useEffect, useMemo, useRef, useState } from 'react';
import { useClientContext } from '@flowgram.ai/free-layout-editor';
import { WorkflowLinesManager } from '@flowgram.ai/free-layout-editor';
import type { RFEdge } from '../util/flowDef';
import { runPathStore, runPathKey } from './runStatus';
import { LineBranchLabel } from './branch-editor';

/** 线条配色：true 绿 / false 红（选中、悬停、运行流动时不覆盖，保留官方交互反馈色）。
 *  ★ 只被下面的 linePropsFor 当兜底用，所以随运行路径配色一起放本文件（2026-10-14 轮 4）。 */
function branchColorProps(line: any, oldProps: any): any {
  try {
    const key = String(line?.fromPort?.portID ?? '');
    const color = key === 'true' ? '#10b981' : key === 'false' ? '#f43f5e' : null;
    return color ? { ...oldProps, color } : oldProps;
  } catch { return oldProps; }
}

/** ★ 运行路径高亮配色（2026-10-11 用户拍板方案 C：**源节点成功即算运行路径**，
 *  其中两端都成功＝已走通、只源成功＝正在走） */
const RUN_PATH_COLOR = '#35d39a';                       // 与旧 `--wf-edge-active` 同色
const RUN_PATH_GLOW = 'drop-shadow(0 0 3px rgba(53,211,154,.78))';
const RUN_PATH_DIM = 0.4;
/** 「正在走」的光点：沿边跑的小圆（候选 ②）。速度＝走完一条边 1.25s，尾巴用负延迟错开 */
const COMET_RUN_MS = 1250;
const COMET_TAIL = 3;

/** 线的最终样式（free-lines-plugin 的 `customLineProps` 扩展点：返回值可覆盖 `color`，也可覆盖
 *  `version` 来强制失效插件自己的渲染缓存）。优先级：官方交互反馈（选中/悬停/拖拽中/流动）
 *  > 运行路径 > 分支配色（true 绿 / false 红）。
 *  ★ 为什么 `version` 里要带运行态标记：只换颜色时插件的缓存判据不一定变（它比的是上一次的
 *  版本串），带上标记才能保证"无运行态 → 已走通/正在走/淡化"这一帧一定重渲染。 */
export function linePropsFor(line: any, oldProps: any): any {
  try {
    if (oldProps?.selected || oldProps?.hovered || line?.processing || line?.flowing) return oldProps;
    const runState = runPathStore.stateFor(line);
    if (runState === 'done') return { ...oldProps, color: RUN_PATH_COLOR, version: `${oldProps?.version ?? ''}|rp:done` };
    if (runState === 'moving') return { ...oldProps, color: RUN_PATH_COLOR, version: `${oldProps?.version ?? ''}|rp:move` };
    if (runState === 'stalled') return { ...oldProps, color: RUN_PATH_COLOR, version: `${oldProps?.version ?? ''}|rp:stall` };
    const base = branchColorProps(line, oldProps);
    return runState === 'dim' ? { ...base, version: `${base?.version ?? ''}|rp:dim` } : base;
  } catch { return oldProps; }
}

/** 「正在走」的光点（候选 ② 光点跑）：沿**这条线自己的贝塞尔路径**跑的小圆 + 尾巴。
 *  实现要点：路径 `d` 直接从同一条线的 `<svg><path>` 上读（lineProps 里没有几何信息），
 *  用 CSS `offset-path: path(...)` + `offset-distance` 动画；容器绝对定位在**线包装 div** 里，
 *  与那条 path 处在同一个坐标系（包装 div 的左上角 = svg 原点）。
 *  ★ 只在 'moving' 态渲染；`@supports` 兜底见 fg.css（不支持 offset-path 的浏览器整块隐藏）。 */
function CometDots(props: any) {
  const line = props.line;
  const state = runPathStore.stateFor(line);
  const moving = state === 'moving';
  const [d, setD] = useState('');
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!moving) { setD(''); return; }
    // ★ 别把「容器 div」也 gate 在 d 上 —— 那样 ref 永远是 null、d 永远读不到（鸡生蛋）。
    //   容器要**无条件**先渲染出来，路径 d 再从它身上读。
    const read = () => {
      const wrap = ref.current?.closest('.gedit-flow-activity-edge');
      const p = wrap?.querySelector('svg path');
      const next = p?.getAttribute('d') ?? '';
      if (next) setD(next);
      return !!next;
    };
    if (read()) return;
    // 同一次提交里 <svg> 可能还没挂上：补一帧再读（不无限重试）
    const raf = requestAnimationFrame(() => read());
    return () => cancelAnimationFrame(raf);
  }, [moving, props.version]);
  if (!moving) return null;
  const dots = d ? Array.from({ length: COMET_TAIL }, (_v, i) => createElement('i', {
    key: i,
    className: 'dot',
    style: {
      offsetPath: `path("${d}")`,
      animationDuration: `${COMET_RUN_MS / 1000}s`,
      animationDelay: `${(-i * COMET_RUN_MS / 1000 / (COMET_TAIL * 2.2)).toFixed(3)}s`,
      width: `${7 - i * 1.6}px`,
      height: `${7 - i * 1.6}px`,
      opacity: String(1 - i * 0.32),
    },
  })) : null;
  return createElement('div', { ref, className: 'dsh-wf-fg-comet' }, dots);
}

/** 挂在 free-lines-plugin `renderInsideLine` 上的东西：分支键标签 ＋ 运行路径光点 */
export function LineInside(props: any) {
  return createElement(
    Fragment,
    null,
    createElement(LineBranchLabel, props),
    createElement(CometDots, props),
  );
}

// ================= 运行路径高亮：运行态 → 连线 =================
// ★ 2026-10-11 用户拍板**方案 C**（原话：「现在是节点运行结束，线变成绿色，而不是运行中的时候，
//   变成绿色，这个效果是对的吗」→ 从 A/B/C 里选 C）：**源节点成功即算运行路径**（绿线紧跟执行前沿），
//   其上是「已走通＝常亮绿 + 外发光」与「正在走＝绿 + 光点跑（候选 ②）」的区分，其余边淡化。
//   数据来源：FlowPanel 算好的 `activeEdges`（源节点 status === 'success'）与
//   `doneEdges`（两端都 success，前者子集）。
//   三条通路各司其职：
//     ① 绿光色 → 实体 `highlightColor`（`getLineColor` 优先取它）+ `customLineProps` 里的最终裁决
//        （if/switch 的分支配色会覆写 color，所以运行路径必须在那一层也压得住）；
//     ② 淡化 / 外发光 → 实体 `uiState.style`（渲染时落到线容器 div 的 inline style）；
//     ③ 类名 `is-runpath-done` / `is-runpath-moving` / `is-runpath-dim` → CSS 与 CDP 断言的抓手；
//        光点本身由 `renderInsideLine` 上的 `CometDots` 画（③ 里那条线的包装 div 就是它的定位父级）。
//   为什么还要订阅线变化：fromJSON 重建、手动拖线新建都会产生新实体，必须重新套用。
export function RunPathSync(props: { edges: RFEdge[]; activeEdges?: Set<string>; doneEdges?: Set<string>; runActive?: boolean }) {
  const ctx = useClientContext();
  // 用内容签名当依赖：两个 Set 每次渲染都是新的，直接进 deps 会每帧重跑
  // ★ 2026-10-19 性能（P4）：三段签名各自 useMemo —— 原来每个 render 都要把全部边重新拼一遍字符串，
  //   而 RunPathSync 随 FlowPanel 每次重渲染都会跑（点选节点、运行状态刷新…）。
  const activeIds = useMemo(() => (props.activeEdges ? [...props.activeEdges].sort().join(',') : ''), [props.activeEdges]);
  const doneIds = useMemo(() => (props.doneEdges ? [...props.doneEdges].sort().join(',') : ''), [props.doneEdges]);
  const edgeSig = useMemo(() => props.edges.map((e) => `${e.id}:${e.source}|${e.sourceHandle ?? ''}|${e.target}`).join(','), [props.edges]);
  const sig = `${activeIds}##${doneIds}##${props.runActive ? 'run' : 'idle'}##${edgeSig}`;
  // 给闭包外的 apply 一个稳定的读点（延迟重放时也要拿到最新值）
  const runActiveRef = useRef(!!props.runActive);
  runActiveRef.current = !!props.runActive;

  const apply = (): void => {
    const on = !!props.activeEdges;
    const keys = new Set<string>();
    const done = new Set<string>();
    if (on) {
      for (const e of props.edges) {
        if (!props.activeEdges?.has(e.id)) continue;
        const k = `${e.source}|${e.sourceHandle ?? ''}|${e.target}`;
        keys.add(k);
        if (props.doneEdges?.has(e.id)) done.add(k);
      }
    }
    runPathStore.set(on, keys, done, runActiveRef.current);
    const lines: any[] = [];
    try {
      const lm: any = ctx.container.get(WorkflowLinesManager);
      for (const l of (lm.getAllLines?.() ?? [])) {
        // 拖拽中的线 / 被 FlowGram 隐藏的线（堆叠折叠）/ 锁定色的线：一概不碰，
        // 否则会破坏官方交互反馈色与"隐藏线"语义（isHidden 的判据就是 highlightColor === hidden 色）。
        if (!l || l.isDrawing || l.isHidden || l.lockedColor) continue;
        const st = runPathStore.stateFor(l);
        let err = '';
        try {
          const wantClass = st === 'done' ? 'is-runpath-done'
            : st === 'moving' ? 'is-runpath-moving'
              : st === 'stalled' ? 'is-runpath-stalled'
                : st === 'dim' ? 'is-runpath-dim' : '';
          const wantColor = st === 'dim' || !st ? '' : RUN_PATH_COLOR;
          if (String(l.highlightColor ?? '') !== wantColor) l.highlightColor = wantColor;
          // ★ 类名**不能直接赋值**：`get className()` 是只读 getter（= linesManager.setLineClassName(line)
          //   + `_uiState.className`）——在 ESM 严格模式下赋值会抛 TypeError，被下面的 catch 吞掉后
          //   连颜色与样式都一起跳过（2026-10-11 CDP 抓到这个：状态算对了、DOM 上一个类都没有）。
          //   正确入口是 `updateUIState({ className })`（它还会 fireChange → 插件重渲染）。
          l.updateUIState({
            className: wantClass,
            style: st === 'done' ? { filter: RUN_PATH_GLOW } : st === 'dim' ? { opacity: RUN_PATH_DIM } : {},
          });
        } catch (e) { err = String((e as any)?.message ?? e); /* 单条线失败不影响其它线 */ }
        // 诊断（CDP 断言与排障用）：状态 + 实体实际类名/画色 + 异常
        lines.push({ key: runPathKey(l), state: st, cls: String(l.className ?? ''), color: String(l.color ?? ''), err });
      }
    } catch { /* 线管理器还没就绪：静默（下次 apply 会补上） */ }
    (window as any).__df_runPath = { on, active: keys.size, done: done.size, lines };
  };

  useEffect(() => {
    apply();
    // fromJSON 重建线是异步的（React 提交后才挂载），补两次延迟重放覆盖那一帧
    const t1 = setTimeout(apply, 120);
    const t2 = setTimeout(apply, 420);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [sig]);

  useEffect(() => {
    let d: any = null;
    try {
      const lm: any = ctx.container.get(WorkflowLinesManager);
      d = lm?.onAvailableLinesChange?.(() => apply());
    } catch { /* 忽略 */ }
    return () => { try { d?.dispose?.(); } catch { /* 忽略 */ } };
  }, [ctx]);

  return null;
}
