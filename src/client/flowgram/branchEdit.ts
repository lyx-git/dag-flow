// src/client/flowgram/branchEdit.ts
// 分支键编辑器状态（2026-10-03 方案 C）：连线中点的分支标签可点击 →
// 在锚点处弹出小面板直接选/改/清空该线所属分支键（不必绕去右侧面板改 cases）。
//
// 为什么用外置 store：标签由 free-lines-plugin 的 renderInsideLine 渲染（FlowGram 层），
// 编辑器面板渲染在 FlowPanel 自己的 React 树里（可 Portal 到 body，定位不受画布 transform 影响），
// 两者之间用 store 通信，与 runStatusStore/selectionStore 同一套路。

export interface BranchEditTarget {
  /** 线的源/目标节点 id（用于在 RF edges 里定位并改 sourceHandle） */
  source: string;
  target: string;
  /** 当前分支键（空串 = 未设置） */
  current: string;
  /** 源节点类型（if → true/false；switch → cases 键 + '*'） */
  nodeType: string;
  /** switch 的已有 case 键 */
  cases: string[];
  /** 弹窗锚点（鼠标 clientX/clientY——屏幕坐标，零换算） */
  anchor: { x: number; y: number };
}

let _target: BranchEditTarget | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) {
    try { fn(); } catch { /* 忽略 */ }
  }
}

export const branchEditStore = {
  open(t: BranchEditTarget): void {
    _target = t;
    emit();
  },
  close(): void {
    if (!_target) return;
    _target = null;
    emit();
  },
  getSnapshot(): BranchEditTarget | null {
    return _target;
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

/** 分支键显示名：真/假/其他（case 值原样）——与画布标签同一口径 */
export function branchKeyText(key: string): string {
  if (key === 'true') return '真';
  if (key === 'false') return '假';
  if (key === '*') return '其他';
  return key;
}
