// src/client/flowgram/runStatus.ts
// 运行状态外置 store：FlowGram 节点卡内部通过 useSyncExternalStore 订阅，
// 避免把 runStatus 注入 node.data 导致画布 document 反复 fromJSON 重建。

export interface RunStatusItem {
  status: string; // success | failed | skipped | running
  durationMs?: number;
  /** loop 节点专用（P3，2026-10-03）：本次运行实际迭代次数（取自 out.count） */
  count?: number;
  /** ★ 节点最终执行结果（2026-10-03 用户需求「可以在节点上看，可以是悬浮查看」）：
   *  悬浮节点卡时原样展示的 out + 错误详情 + 容错标记（都由 /run 的 summary.results 带出） */
  out?: unknown;
  error?: { code?: string; message?: string };
  /** 该失败已被 tolerate 开关放行（引擎标，界面据此显示「已容错」） */
  tolerated?: boolean;
}

type RSMap = Record<string, RunStatusItem>;

const state: { map: RSMap } = { map: {} };
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) {
    try { fn(); } catch { /* 忽略 */ }
  }
}

export const runStatusStore = {
  set(map: RSMap) {
    state.map = map ?? {};
    emit();
  },
  get(): RSMap {
    return state.map;
  },
  getSnapshot(): RSMap {
    return state.map;
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

// —— 运行路径高亮（外部运行态 → 画布连线）——
// ★ 2026-10-11：恢复 reactflow 时代的能力「运行路径标绿、其余淡化」，并按用户拍板**改成方案 C**：
//   语义 B ＝ **源节点成功即算运行路径**（绿线紧跟执行前沿，不再等两端都完成）；
//   在此之上分三态：'done' 已走通（常亮绿 + 外发光） / 'moving' 正在走（绿 + 光点跑） / 'dim' 还没到（淡化）。
//   为什么走外置 store：线的样式函数是 free-lines-plugin 的 `customLineProps`，它在 buildEditorProps 时
//   **只构建一次**（闭包固定，拿不到后面的 React props）——与节点徽标同样的理由，必须用模块级 store。
//   键统一成 `源|源端口|目标`（与 toFG 的 sourcePortID 一致；activeEdges/doneEdges 里是 RF 边 id）。
let _rpOn = false;
let _rpSrcDone = new Set<string>();
let _rpDone = new Set<string>();
/** ★ 2026-10-19 用户拍板（末版）：哪些走过的边**还该流动**。
 *  规则：流过（两端都执行过）的边在整轮运行期间一直流动，但——**如果这条边的目标节点失败且流程中断**
 *  （⛔ 停止这条支路 / ⏭ 跳过这条支路，下游不再执行），它立刻停；**失败被忽略**（🛟 忽略失败，下游照跑）
 *  则照常流动。整轮结束（成功/失败/取消）时全部转静态。 */
let _rpFlowing = new Set<string>();
/** 运行是否**仍在进行**：false 时"正在走"退化成静态绿（stalled），不再有光点动画。
 *  ★ 2026-10-11 用户真机反馈：「运行中的工作流取消了，能不能关闭这个光点动画」——运行结束/被取消后，
 *  「源成功、目标没成功」这个条件依然成立，光点会**永远转下去**，所以必须由"是否还在跑"来收口。 */
let _rpRunning = false;
const rpListeners = new Set<() => void>();

/** 线的运行路径键：`源|源端口|目标`（无端口时端口段为空） */
export function runPathKey(line: any): string {
  return `${line?.from?.id ?? ''}|${line?.fromPort?.portID ?? ''}|${line?.to?.id ?? ''}`;
}

export const runPathStore = {
  /** @param on 当前有没有运行态（有才淡化，没有就一切照旧）
   *  @param srcDone 两端都执行过的边（＝运行路径，绿）
   *  @param done 两端都成功的边（＝已走通，常亮绿 + 外发光）
   *  @param flowing 走过、且"支路还没被判死"的边（＝该流动的边；目标失败且流程中断的不在其中）
   *  @param running 运行是否仍在进行（true ⇒ flowing 的边都流动；false ⇒ 全部转静态） */
  set(on: boolean, srcDone: Set<string>, done: Set<string>, flowing: Set<string>, running: boolean) {
    _rpOn = on;
    _rpSrcDone = srcDone;
    _rpDone = done;
    _rpFlowing = flowing;
    _rpRunning = running;
    for (const fn of rpListeners) {
      try { fn(); } catch { /* 忽略 */ }
    }
  },
  isOn(): boolean {
    return _rpOn;
  },
  /** 'done' 已走通（两端成功，常亮绿+外发光）/ 'moving' 走过的线在流动（光点）/ 'stalled' 走过但停止流动
   *  （静态绿：整轮已结束，或这条边的目标失败且流程中断）/ 'dim' 还没到（淡化 40%）/ null 无运行态 */
  stateFor(line: any): 'done' | 'moving' | 'stalled' | 'dim' | null {
    if (!_rpOn) return null;
    const k = runPathKey(line);
    if (!_rpSrcDone.has(k)) return 'dim';                          // 没走过 ⇒ 淡化
    if (_rpRunning && _rpFlowing.has(k)) return 'moving';          // 走过 + 支路还活着 + 整轮在跑 ⇒ 流动
    return _rpDone.has(k) ? 'done' : 'stalled';                    // 否则静态：两端成功⇒常亮发光，其他⇒静态绿
  },
  subscribe(fn: () => void): () => void {
    rpListeners.add(fn);
    return () => rpListeners.delete(fn);
  },
};

// —— 选中节点同步（外部视图 → 画布高亮）——
let _selected = '';
const selListeners = new Set<() => void>();

export const selectionStore = {
  set(id: string) {
    const next = id ?? '';
    if (_selected === next) return;
    _selected = next;
    for (const fn of selListeners) {
      try { fn(); } catch { /* 忽略 */ }
    }
  },
  getSnapshot(): string {
    return _selected;
  },
  subscribe(fn: () => void): () => void {
    selListeners.add(fn);
    return () => selListeners.delete(fn);
  },
};
