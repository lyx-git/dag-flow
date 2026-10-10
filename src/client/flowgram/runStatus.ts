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
