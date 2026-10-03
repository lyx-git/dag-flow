// tmp-test/run-file.mjs — 从 JSON 文件读工作流并真实执行（验证用户可跑的工作流文件）
// 用法：esbuild --format=esm 打包后 node 执行：node tmp-test/run-file.bundle.mjs <workflow.json路径> [--temp-root]
// --temp-root：在系统临时目录自建 <root>/.dag-flow/scripts/<工作流名>/（把工作流文件旁 scripts/<名>/ 的
// 文件拷入），并 chdir 到临时根——避免冒烟污染插件仓库（cwd 兜底会在 cwd 下创建 .dag-flow/，
// 2026-10-02 用户明确要求插件仓库无此目录，发 GitHub 给别人装时不该有）。
import { readFileSync, mkdirSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { runWorkflow } from '../src/executor/run.js';
import { registerBuiltinNodes } from '../src/registry/builtin.js';

registerBuiltinNodes();

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
const useTempRoot = args.includes('--temp-root');
const scriptsSrcIdx = args.indexOf('--scripts-src');
const scriptsSrc = scriptsSrcIdx >= 0 ? args[scriptsSrcIdx + 1] : null;
if (!file) { console.error('用法: node run-file.bundle.mjs <workflow.json> [--temp-root] [--scripts-src <dir>]'); process.exit(1); }

const def = JSON.parse(readFileSync(file, 'utf8'));

if (useTempRoot) {
  // 自建临时存储根：把 --scripts-src 指定的 scripts/<name>/ 拷到 <root>/.dag-flow/scripts/<name>/
  const root = path.join(tmpdir(), 'dag-flow-smoke-' + Date.now());
  mkdirSync(root, { recursive: true }); // ★ 先建根——chdir 需要它存在
  if (scriptsSrc) {
    const srcScripts = path.join(scriptsSrc, def.name);
    if (existsSync(srcScripts)) {
      const dst = path.join(root, '.dag-flow', 'scripts', def.name);
      mkdirSync(dst, { recursive: true });
      for (const f of readdirSync(srcScripts)) copyFileSync(path.join(srcScripts, f), path.join(dst, f));
    }
  }
  process.chdir(root);
  console.log('[smoke] temp storage root:', root);
}

async function main() {
  const logger = { info() {}, warn() {}, error() {}, debug() {}, trace() {} };
  const result = await runWorkflow(def, { logger, cwd: process.cwd() });
  const s = result.summary;
  console.log('workflow:', s.workflowName, '| status:', s.status, '|', s.totalDurationMs + 'ms',
    '| nodes:', s.totalNodes, 'ok:', s.successCount, 'fail:', s.failedCount);
  for (const [id, r] of Object.entries(s.results ?? {})) {
    const outVal = r.output ?? r.out;
    console.log(`  ${id}(${r.status})${outVal !== undefined && outVal !== '' ? ' → ' + String(outVal).trim().slice(0, 120) : ''}${r.error ? ' | err: ' + String(r.error?.message ?? r.error).slice(0, 140) : ''}`);
  }
  return s.status;
}

main()
  .then((status) => process.exit(status === 'success' ? 0 : 2))
  .catch((e) => { console.error('执行器异常:', e?.message ?? e); process.exit(3); });
