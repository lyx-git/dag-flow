// src/registry/nodes/shared.ts — 内置节点共用小工具
// 提供 startedEnded / finish / resolveCodePath，被本目录 control/script/io/ai/web/doc 各节点文件共用；
// 节点实现 2026-10-14 重构轮 1 自 builtin.ts 纯搬运拆出，注册入口仍是上级 builtin.ts（注册顺序不变）。

import { join, isAbsolute } from 'node:path';
import type { NodeResult } from '../../types.js';
import { makeResult } from '../external.js';

export function startedEnded(): { startedAt: string; t0: number } {
  return { startedAt: new Date().toISOString(), t0: Date.now() };
}

/** codePath 解析（2026-10-02 用户需求「写格式化的代码文件，引入执行」）：
 *  相对路径锚定 <DSH_HOME>/.dag-flow/（如 'scripts/hello.py'）；绝对路径原样使用。
 *  此前直接 readFile(p.codePath) 是相对 host 进程 cwd 的——真机上根本找不到用户以为的文件。 */
export async function resolveCodePath(p: string): Promise<string> {
  if (isAbsolute(p)) return p;
  const { dagFlowDir } = await import('../../adapter/workspace.js');
  return join(await dagFlowDir(), p);
}

export function finish(t0: number, startedAt: string, r: Partial<NodeResult>): NodeResult {
  return { ...makeResult('success', r), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
}
