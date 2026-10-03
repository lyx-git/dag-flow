// src/client/navStack.ts — 子工作流导航栈（2026-10-03 用户需求）
//
// 需求原话：「如果选择了要执行的子工作流，那么双击 loop 循环节点可以直接跳到子工作流里面，
//          子工作流也可以一键切回到父工作流的循环节点」
// 用户拍板：返回入口 = header 返回胶囊 + 面包屑（变体 A）；适用范围 = loop（循环体）+ subflow（子工作流）。
//
// 为什么单独成模块：真正的「换 def」在两种宿主里不一样——
//   · 生产：index.tsx 的 setDockDef(def, bump=true) → 停靠面板重挂载 FlowPanel；
//   · CDP 夹具：grab-test.tsx 的 React setState + key 变化重挂载（同样效果）。
// 两者都只提供「swap(def, focusNodeId)」这一件事（bindNavSwap），栈/守卫/错误提示全在这里，
// 保证夹具测的就是生产那份逻辑（不在测试里复制一份假的）。
import type { WorkflowDef } from './types';

export interface DagNavEntry { def: WorkflowDef; nodeId: string; name: string }

/** 换 def 的宿主能力：生产=重挂停靠面板；夹具=setState + key 重挂 */
type NavSwap = (def: WorkflowDef, focusNodeId: string | null) => void;

const stack: DagNavEntry[] = [];
let swapFn: NavSwap | null = null;
let currentDef: WorkflowDef | null = null;
let focusNodeId: string | null = null;

/** 宿主绑定「换 def」实现（index.tsx 在 apply 时绑定；夹具在挂载时绑定） */
export function bindNavSwap(fn: NavSwap | null): void { swapFn = fn; }

/** 当前工作流 def 同步（FlowPanel 每次 onCache 时调用）——进入子工作流要把「父 def 快照」压栈 */
export function setNavCurrent(def: WorkflowDef): void { currentDef = def; }

/** 面包屑的父链（从外到内，不含当前工作流） */
export function navCrumbs(): string[] { return stack.map((e) => e.name); }
/** 当前工作流名 */
export function navCurrentName(): string { return currentDef?.name ?? ''; }
/** 从子工作流返回后要重新选中的节点 id（来源循环节点） */
export function navFocusNodeId(): string | null { return focusNodeId; }
/** 清空栈（测试用；生产不需要） */
export function resetNav(): void { stack.length = 0; focusNodeId = null; }
/** 栈深度（测试断言用） */
export function navDepth(): number { return stack.length; }

/**
 * 进入当前节点引用的子工作流（loop 的 `params.body.workflowName` / subflow 的 `params.workflowName`）。
 * 返回 `{ error }` 表示没有跳转：未选子工作流 / 子工作流不存在 / 自引用或成环 / 内容为空。
 */
export async function enterSubWorkflow(workflowName: string, fromNodeId: string): Promise<{ ok?: true; error?: string }> {
  const name = String(workflowName ?? '').trim();
  if (!name) return { error: '该节点还没选要执行的子工作流（loop 循环体 / subflow 目标）——先在右侧面板里选一个' };
  if (!swapFn) return { error: '当前环境不支持子工作流跳转' };
  const parent = currentDef;
  if (!parent) return { error: '当前工作流还没就绪，稍后再试' };
  if (name === parent.name) return { error: `「${name}」就是当前工作流，不能进入自己` };
  if (stack.some((e) => e.name === name)) return { error: `「${name}」已在返回路径上（会形成循环引用），不能进入` };
  let child: WorkflowDef;
  try {
    const r = await fetch(`/api/dag-flow/workflows/${encodeURIComponent(name)}`, { credentials: 'include' });
    if (!r.ok) return { error: `子工作流「${name}」不存在或读取失败（HTTP ${r.status}）` };
    child = ((await r.json()) as { workflow?: WorkflowDef })?.workflow as WorkflowDef;
  } catch (e) {
    return { error: `读取子工作流「${name}」失败：${(e as Error).message}` };
  }
  if (!child?.nodes?.length) return { error: `子工作流「${name}」内容为空，无法编辑` };
  stack.push({ def: parent, nodeId: fromNodeId, name: parent.name });
  focusNodeId = null;
  currentDef = child;
  swapFn(child, null);
  return { ok: true };
}

/** 一键切回父工作流的来源节点（栈空 = 已是最外层）。 */
export function backToParentWorkflow(): { ok?: true; error?: string } {
  const entry = stack.pop();
  if (!entry) return { error: '已经在最外层工作流了' };
  focusNodeId = entry.nodeId;
  currentDef = entry.def;
  swapFn?.(entry.def, entry.nodeId);
  return { ok: true };
}
