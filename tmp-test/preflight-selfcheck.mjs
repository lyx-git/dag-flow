// tmp-test/preflight-selfcheck.mjs — 用插件的**同一份自检**体检工作区里的真实工作流
//   （2026-10-04 轮 3：loop 边界/循环体、merge 上游、subflow 依赖、存值模型；依赖项按真实工作区注入）
// 用法：node tmp-test/preflight-selfcheck.mjs
import { build } from 'esbuild';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const WF_DIR = '../.dag-flow/workflow';
const dir = mkdtempSync(join(tmpdir(), 'df-selfcheck-'));
const OUT = join(dir, 'sc.mjs');
await build({ entryPoints: ['src/executor/selfcheck.ts'], bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent' });
const { selfcheck } = await import(pathToFileURL(OUT).href);

const names = readdirSync(WF_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
const knownWorkflows = new Set(names);
let totalErr = 0, totalWarn = 0;

for (const f of readdirSync(WF_DIR).filter((x) => x.endsWith('.json'))) {
  const def = JSON.parse(readFileSync(join(WF_DIR, f), 'utf8'));
  const r = selfcheck(def, { knownWorkflows });
  const errs = r.items.filter((i) => i.level === 'error');
  const warns = r.items.filter((i) => i.level === 'warn');
  totalErr += errs.length; totalWarn += warns.length;
  console.log(`\n${f}（${def.nodes?.length ?? 0} 节点 / ${def.edges?.length ?? 0} 边）→ ${r.ok ? '✅ 通过' : '❌ ' + errs.length + ' 个 error'}`);
  for (const it of r.items) console.log(`   ${it.level === 'error' ? '✗' : '⚠'} [${it.code}] ${it.message}`);
}
console.log(`\n合计：${totalErr} 个 error / ${totalWarn} 个 warn`);
