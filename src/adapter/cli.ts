// src/adapter/cli.ts — /workflow 工具注册
// ★ 唯一允许调 DSH 工具注册 API 的地方
//
// 2026-09-06 重写：dsh 0.1.2-rc.1 没有 ctx.cli.registerCommand，
// 扩展点是 ctx.tools.register(defineTool({...}))（dsh-image-vision 同款）。
// 工具形态：dsh 的 tool = { name, description, parameters, output, execute(args, exec) }。

import { disabledApis } from './safety.js';
import { registerHostTool } from '../dsh-gate/registrar.js';
import { createStorage } from './storage.js';
import { createLogger } from './logger.js';
import { parseAndValidate } from '../executor/parse.js';
import { runWorkflow } from '../executor/run.js';
import { showWorkflow } from '../executor/record.js';
import type { WorkflowDef } from '../types.js';

const USAGE = `用法: /workflow <list|run|validate|new|show> [名称]`;

function fmtList(names: string[]): string {
  if (names.length === 0) return '(还没有已保存的工作流——JSON 文件在 <DSH_HOME>/.dag-flow/workflow/ 目录)';
  return names.map((n) => `  - ${n}`).join('\n');
}

function minimalTemplate(name: string): WorkflowDef {
  return {
    name,
    version: 1,
    description: `自动生成的工作流 "${name}"`,
    nodes: [
      { id: 'start', type: 'start' },
      { id: 'say', type: 'log', params: { level: 'info', message: `hello（来自 ${name}）` }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
  };
}

/**
 * 构造一个 DSH 工具注册对象（dsh-image-vision defineTool 同款形态）。
 * name 用 workflow.* 命名空间避免与现有工具冲突。
 */
export function buildWorkflowTool() {
  const storage = createStorage();
  const logger = createLogger();

  const list = async (): Promise<string> => {
    const names = await storage.listWorkflows();
    return `工作流列表:\n${fmtList(names)}`;
  };

  const create = async (name: string): Promise<string> => {
    const def = minimalTemplate(name);
    await storage.writeWorkflow(name, def);
    return `已创建 ${name}.json\n${JSON.stringify(def, null, 2)}`;
  };

  const validate = async (name: string): Promise<string> => {
    const def = await storage.readWorkflow(name);
    if (!def) return `工作流不存在: ${name}`;
    try {
      parseAndValidate(def);
      return `校验通过: ${name}`;
    } catch (e) {
      return `校验失败: ${name}\n${(e as Error).message}`;
    }
  };

  const show = async (name: string): Promise<string> => showWorkflow(name);

  const run = async (name: string, cwd: string): Promise<string> => {
    const def = await storage.readWorkflow(name);
    if (!def) return `工作流不存在: ${name}`;
    try {
      parseAndValidate(def);
    } catch (e) {
      return `校验失败: ${name}\n${(e as Error).message}`;
    }
    const result = await runWorkflow(def, { logger, cwd });
    return JSON.stringify(result.summary, null, 2);
  };

  return {
    name: 'workflow',
    description: '管理自定义工作流（list / run / validate / new / show）。' + USAGE,
    parameters: {
      action: { type: 'string', enum: ['list', 'run', 'validate', 'new', 'show'], required: true, description: '要执行的操作' },
      name: { type: 'string', required: false, description: '工作流名称（list 不需要）' },
    },
    output: { schema: { type: 'string' } },
    async execute(args: { action?: string; name?: string }, exec: { cwd?: string }) {
      try {
        const sub = args.action ?? 'list';
        const arg1 = args.name;
        switch (sub) {
          case 'list': return await list();
          case 'new': return await create(arg1 ?? '');
          case 'validate': return await validate(arg1 ?? '');
          case 'show': return await show(arg1 ?? '');
          case 'run': return await run(arg1 ?? '', exec?.cwd ?? process.cwd());
          default: return USAGE;
        }
      } catch (e) {
        logger.error('workflow tool failed', { err: (e as Error).message });
        return `执行出错: ${(e as Error).message}`;
      }
    },
  };
}

/** 由 src/index.ts 在 apply(ctx) 时调用。返回是否注册成功。 */
export function attachToHost(): { registered: boolean; reason?: string; dispose?: () => void } {
  // 只按本能力自己的漂移判断（2026-10-01）：去掉 isSafeMode() 叠加，避免误连累。
  if (disabledApis().includes('tools.register')) {
    return { registered: false, reason: 'tools.register 不可用，workflow 工具未注册' };
  }
  // tools.register 契约适配已收编防腐层（dsh-gate/registrar.ts）——dsh 升版改契约时只改那边。
  return registerHostTool(buildWorkflowTool());
}
