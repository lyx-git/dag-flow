// @ts-nocheck
// src/client/flowgram/switchCaseStore.ts
// switch「当前选中的分支 chip」存储（2026-10-03 用户拍板 B）。
//
// 用户原话：「switch 节点里面的端口行去掉，保留 chips，选择哪个 chips，画线带出来的就是哪个分支，
//   如果有很多分支或者 chips 没展示出来，就在节点里面写明情况说明，先画线，再在线上选择需要的 case 分支，
//   节点保持和其他的节点大小一致」。
//
// 为什么要有这个 store：
//   switch 的端口收成了一个视觉点（所有 case 端口同坐标），**端口列表顺序**决定「拖线命中哪个端口」
//   （DOM 越靠后 ⇒ 绘在越上层 ⇒ 命中它）。所以「选中哪个 chip」必须能在画布层被读出来：
//     · 卡片点击 chip → setSel(nodeId, case)
//     · 卡片与 formMeta 生成端口时 → 把选中的 case 排到最后
//     · 没选中 → 排最后的是 'out'（无分支键：先画线，再在线上点选分支）
//   用 useSyncExternalStore 订阅，保证 chip 高亮与端口顺序在同一帧里一致。
//
// 注意：分支键的**原逻辑没有变**——每条线的 case 仍然是 FlowGram 端口 portID（flowDef 的
// sourceHandle ↔ when、执行器读 node.next、多个 case 指向同一目标等都照旧），这里只记录「本次拖线想带哪个」。

type Listener = () => void;

const selByNode = new Map<string, string>();
const listeners = new Set<Listener>();
let version = 0;

function emit(): void {
  version += 1;
  for (const l of [...listeners]) {
    try { l(); } catch { /* 单个订阅者异常不影响其它 */ }
  }
}

export const switchCaseStore = {
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => { listeners.delete(l); };
  },
  /** 订阅用快照（版本号，primitive ⇒ 稳定） */
  getVersion(): number { return version; },
  getSel(nodeId: string): string | null { return selByNode.get(nodeId) ?? null; },
  setSel(nodeId: string, key: string | null): void {
    const v = key || null;
    if ((selByNode.get(nodeId) ?? null) === v) return;
    if (v) selByNode.set(nodeId, v); else selByNode.delete(nodeId);
    emit();
  },
  /** 点同一个 chip 再点一次 = 取消选中（回到「先画线，再在线上点选」） */
  toggleSel(nodeId: string, key: string): void {
    this.setSel(nodeId, this.getSel(nodeId) === key ? null : key);
  },
};
