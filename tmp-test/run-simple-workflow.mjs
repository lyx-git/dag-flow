// tmp-test/run-simple-workflow.mjs — 直接调 executor 跑一个真实简单工作流（start→python→end）
// 验证执行器本身可用（与按钮 UI 链路互证）。
// esbuild 打包（--format=cjs 不支持顶层 await）→ node tmp-test/run-simple-workflow.cjs
import { runWorkflow } from '../src/executor/run.js';
import { registerBuiltinNodes } from '../src/registry/builtin.js';

// ★ 执行器节点类型靠插件入口副作用注册（真实 host 会跑 registerNodesOnce）——冒烟脚本手动注册
registerBuiltinNodes();

const def = {
  name: 'smoke-simple',
  version: 1,
  nodes: [
    { id: 'start', type: 'start', params: {}, next: 'py' },
    { id: 'py', type: 'python', params: { code: "print('hello from dag-flow')", timeoutMs: 15000 }, next: 'end' },
    { id: 'end', type: 'end' },
  ],
};

async function main() {
  // RunOptions 需要 logger（api.ts 真实路由注入的是 createLogger()；冒烟用静音桩）
  const logger = { info() {}, warn() {}, error() {}, debug() {}, trace() {} };
  const result = await runWorkflow(def, { logger, cwd: process.cwd() });
  const s = result.summary;
  console.log('status:', s.status);
  console.log('totalDurationMs:', s.totalDurationMs);
  for (const [id, r] of Object.entries(s.results ?? {})) {
    console.log(`  ${id}: ${r.status}${r.output ? ' | ' + String(r.output).trim().slice(0, 80) : ''}${r.error ? ' | err: ' + String(r.error?.message ?? r.error).slice(0, 120) : ''}`);
  }
  return s.status;
}

main()
  .then((status) => process.exit(status === 'success' ? 0 : 2))
  .catch((e) => { console.error('执行器异常:', e?.message ?? e); process.exit(3); });
