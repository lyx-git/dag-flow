// src/adapter/running.ts
// 进程内「正在跑的工作流」登记（2026-10-03 定时任务轮新增）。
//
// 为什么要单独一个模块：/run 路由（api.ts）自己维护 `activeRuns`（按工作流名互斥 + 取消入口），
// 而**调度器**也要知道「这个工作流的上一轮是不是还没跑完」才能做 `concurrency: 'skip'`（用户拍板 B：
// 上次没跑完 → 本次跳过并记 skipped）。两边各存一份就会互相看不见（定时触发时手动点运行 = 双份烧钱），
// 所以抽一个最小共享登记：只登记名字，不持有执行状态（执行状态仍归 api.ts 的 activeRuns 所有）。
//
// 语义：纯进程内、不落盘；dsh web 重启即清空（与调度器的「不补跑」语义一致）。

const running = new Set<string>();

/** 标记某工作流开始运行（同名重复调用幂等） */
export function markRunning(name: string): void {
  if (name) running.add(name);
}

/** 标记某工作流运行结束 */
export function unmarkRunning(name: string): void {
  if (name) running.delete(name);
}

/** 该工作流当前是否有运行中的实例（调度器 skip 判据 + 状态查询用） */
export function isWorkflowRunning(name: string): boolean {
  return !!name && running.has(name);
}

/** 当前所有运行中的工作流名（诊断/测试用） */
export function listRunning(): string[] {
  return [...running];
}

/** 仅供测试：清空登记 */
export function __resetRunning(): void {
  running.clear();
}
