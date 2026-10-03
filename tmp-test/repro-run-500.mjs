// tmp-test/repro-run-500.mjs v3 — 「id is not defined」修复验证 + 全链路冒烟
// stub host（llm 提供 stream 生成器）→ apply → runWorkflow 直接跑演示工作流全图
import { readFileSync, readdirSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

process.env.DSH_HOME = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? '', '.dsh');
const ROOT = 'D:/workspace/pluginspace/dag-flow';
const mod = await import(`file://${ROOT}/dist/index.js`);

const stubCtx = {
  logger: { info() {}, warn() {}, error() {} },
  tools: { register() { return () => {}; } },
  webServer: { register() { return () => {}; } },
  workspaceRegistry: { list: async () => [] },
  llm: {
    listProviders: () => [],
    listModels: async () => [],
    stream: async function* () {
      yield { type: 'text-delta', text: '【stub】这是 host llm 流式返回的演示简报正文。' };
      yield { type: 'finish', reason: 'stop' };
    },
  },
  effect: () => {},
};
mod.apply(stubCtx);

// repro cwd=插件仓库 → storage 根=仓库 .dag-flow：把子工作流临时拷进来让 subflow 可解析（结束会清理）
const wsWfDir = 'D:/workspace/pluginspace/.dag-flow/workflow';
const repoWfDir = 'D:/workspace/pluginspace/dag-flow/.dag-flow/workflow';
mkdirSync(repoWfDir, { recursive: true });
copyFileSync(join(wsWfDir, '子工作流-文字整理.json'), join(repoWfDir, '子工作流-文字整理.json'));

const wfDir = wsWfDir;
const wfFile = readdirSync(wfDir).find((f) => f.includes('全节点')) ?? '全节点演示-技术简报.json';
const def = JSON.parse(readFileSync(join(wfDir, wfFile), 'utf8'));
console.log('[wf]', def.name, '| nodes:', def.nodes?.length, '| edges:', def.edges?.length);

const logger = { info() {}, warn() {}, error() {}, debug() {}, trace() {} };
try {
  const { summary } = await mod.runWorkflow(def, { logger, cwd: process.cwd() });
  console.log('[status]', summary.status);
  for (const [id, r] of Object.entries(summary.results ?? {})) {
    console.log(`  ${id}: ${r.status}${r.error ? ' → ' + JSON.stringify(r.error).slice(0, 200) : ''}`);
  }
  const end = summary.results?.end_final;
  if (end?.out) console.log('[end outputs]', JSON.stringify(end.out).slice(0, 700));
  console.log('[firstError]', JSON.stringify(summary.error ?? null));
} catch (e) {
  console.error('[THROWN]', e?.message);
  console.error(e?.stack ?? '(no stack)');
}
process.exit(0);
