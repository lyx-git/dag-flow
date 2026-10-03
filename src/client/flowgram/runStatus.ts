// src/client/flowgram/runStatus.ts
// 运行状态外置 store：FlowGram 节点卡内部通过 useSyncExternalStore 订阅，
// 避免把 runStatus 注入 node.data 导致画布 document 反复 fromJSON 重建。

export interface RunStatusItem {
  status: string; // success | failed | skipped | running
  durationMs?: number;
  /** loop 节点专用（P3，2026-10-03）：本次运行实际迭代次数（取自 out.count） */
  count?: number;
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

// —— 选中节点同步（FormView/ThumbView → 画布高亮）——
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
