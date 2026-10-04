// @ts-nocheck
// src/client/flowgram/failPolicyStore.ts
// 「失败策略」在画布上的**显形**（2026-10-04 轮 7 用户要的可选增强）。
//
// 背景：失败策略（面板唯一入口「🛟 本节点失败后」）此前只存在于右侧面板的下拉里——画布上完全看不出来，
//   尤其 goto（失败后跳转）的目标是个"看不见的跳转"，用户不点开面板就不知道配了它。
//
// 为什么用 store 而不是直接读节点：
//   策略存在 **def 节点**上（`node.onError` / `node.tolerate`），而 FlowGram 节点实体只暴露
//   form values(data) 与少量顶层字段；策略**不能塞进 data**——data 会被 fromRF 写回 `params`，
//   而各节点 params schema 是 additionalProperties:false，塞进去会让保存/执行直接校验失败。
//   所以由 FlowPanel 在 def 变化时把整份策略表同步进来，卡片用 useSyncExternalStore 订阅。
//
// 表项：{ kind: 'skip' | 'ignore' | 'goto', target?: string, targetLabel?: string }
//   默认 stop **不入表** ⇒ 卡片不显示 chip（默认策略不制造噪音，与"默认边不标注"一致）。
type Listener = () => void;
export interface FailPolicyItem { kind: 'skip' | 'ignore' | 'goto'; target?: string; targetLabel?: string }

const byNode = new Map<string, FailPolicyItem>();
const listeners = new Set<Listener>();
let version = 0;

function emit(): void {
  version += 1;
  for (const l of [...listeners]) {
    try { l(); } catch { /* 单个订阅者异常不影响其它 */ }
  }
}

export const failPolicyStore = {
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => { listeners.delete(l); };
  },
  /** 订阅用快照（版本号，primitive ⇒ 稳定） */
  getVersion(): number { return version; },
  get(nodeId: string): FailPolicyItem | null { return byNode.get(nodeId) ?? null; },
  /** 由 FlowPanel 在 def 变化时整体覆盖（节点数很少，整体替换最简单也最不易漏） */
  setAll(next: Record<string, FailPolicyItem>): void {
    const same = byNode.size === Object.keys(next).length
      && Object.keys(next).every((k) => {
        const a = byNode.get(k); const b = next[k];
        return a && b && a.kind === b.kind && a.target === b.target && a.targetLabel === b.targetLabel;
      });
    if (same) return;   // 内容没变 → 不触发重渲染（DefSync 常触发 def 变化）
    byNode.clear();
    for (const [k, v] of Object.entries(next)) if (v) byNode.set(k, v);
    emit();
  },
};
