// src/executor/awaiting.ts — 人工确认（manual 节点）挂起注册表
//
// 语义（2026-10-03 用户拍板「方案 A：真暂停 + 恢复」）：
//   manual 节点在**交互式运行**（HTTP POST /run）中挂起，等 POST /run/resume 带用户备注唤醒；
//   非交互路径（CLI /workflow 工具、subflow 子工作流内部）不挂起——无人可点，自动通过并记 warning。
//
// 边界（用户已知悉）：
//   注册表在 host 内存 —— 刷新页面 / 重挂面板能用 GET /run/status 查回等待态；
//   dsh web 重启即丢失，API 侧回「运行已中断」，不会静默变僵尸。
//
// 为什么单独一个模块：executor（manual 节点）与 adapter（/run、/run/resume 路由）都要用它，
//   放在任一方向都会造成 registry → adapter 或 adapter → registry 的反向依赖。

export interface ManualAwaitingInfo {
  runId: string;
  nodeId: string;
  prompt: string;
  createdAt: string;
}

export interface ManualResolution {
  /** 用户在确认弹窗里填的备注（可为空串） */
  value: string;
}

interface Pending {
  info: ManualAwaitingInfo;
  resolve: (r: ManualResolution) => void;
  reject: (e: Error) => void;
  onAbort?: () => void;
}

const pendings = new Map<string, Pending>();

/** 生成运行 id（API 层需要在运行结束前就拿到它——awaiting 响应要带上） */
export function newRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** manual 节点调用：登记等待并返回未决 promise。
 *  - signal 中止（用户点「取消本次运行」/ 头部 ⏹）→ reject（节点转 failed RUN_CANCELLED 语义）
 *  - /run/resume → resolve 用户备注 */
export function waitForManual(info: ManualAwaitingInfo, signal?: AbortSignal): Promise<ManualResolution> {
  return new Promise<ManualResolution>((resolve, reject) => {
    const runId = info.runId;
    let settled = false;
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      pendings.delete(runId);
      reject(new Error('运行已由用户取消'));
    };
    const settle = (): boolean => {
      if (settled) return false;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      pendings.delete(runId);
      return true;
    };
    const entry: Pending = {
      info,
      onAbort,
      resolve: (r) => { if (settle()) resolve(r); },
      reject: (e) => { if (settle()) reject(e); },
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    pendings.set(runId, entry);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** 查询某次运行是否正卡在人工确认（/run/status 用） */
export function getAwaiting(runId: string): ManualAwaitingInfo | undefined {
  return pendings.get(runId)?.info;
}

/** /run/resume：唤醒挂起的 manual 节点；返回 false = 该运行没有在等待人工确认 */
export function resolveManual(runId: string, value: string): boolean {
  const p = pendings.get(runId);
  if (!p) return false;
  p.resolve({ value });
  return true;
}

/** 取消/清理：唤醒挂起节点并让其失败（返回 false = 本来就不在等待） */
export function rejectManual(runId: string, message: string): boolean {
  const p = pendings.get(runId);
  if (!p) return false;
  p.reject(new Error(message));
  return true;
}
