// tmp-test/preflight-demo.mjs — 对磁盘上的真实演示工作流做「不执行」预检
// 用途：确认修掉 next schema 之后，点 ▶ 之前还会不会撞上结构/参数类的问题
import { build } from 'esbuild';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const WF_DIR = 'D:/workspace/pluginspace/.dag-flow/workflow';
const DEMO = join(WF_DIR, '全节点演示-技术简报.json');

const tmp = mkdtempSync(join(tmpdir(), 'dag-preflight-'));
const mk = async (entry, name, external = []) => {
  const out = join(tmp, name);
  await build({ entryPoints: [join(ROOT, entry)], bundle: true, format: 'esm', platform: 'node', target: 'node20', outfile: out, external, logLevel: 'silent' });
  return import(pathToFileURL(out).href);
};
const { parseAndValidate, nodeTag } = await mk('src/executor/parse.ts', 'parse.mjs');
const { checkWorkflowParams, formatParamProblems } = await mk('src/registry/params-check.ts', 'params.mjs');

const def = JSON.parse(readFileSync(DEMO, 'utf8'));
console.log(`文件：${DEMO}\n节点 ${def.nodes.length} 个 / edges ${(def.edges ?? []).length} 条`);

// 1) 结构与 schema
try {
  parseAndValidate(def);
  console.log('① 结构校验：✅ 通过');
} catch (e) {
  console.log('① 结构校验：❌', e.message);
}

// 2) 参数必填预检
const problems = checkWorkflowParams(def);
console.log(problems.length === 0
  ? '② 参数预检：✅ 无问题'
  : `② 参数预检：❌ ${problems.length} 项\n   ` + formatParamProblems(problems, (id) => nodeTag(def.nodes.find((n) => n.id === id), id)).split('；').join('\n   '));

// 3) 分支键形状清点（这次修复的对象）
for (const n of def.nodes) {
  const nx = n.next;
  if (nx && typeof nx === 'object' && !Array.isArray(nx)) {
    console.log(`③ 分支键 next：节点 ${nodeTag(n, n.id)}(${n.type}) → { ${Object.keys(nx).join(', ')} }`);
  }
}

// 4) subflow 依赖的子工作流是否在目录里
const files = readdirSync(WF_DIR).filter((f) => f.endsWith('.json'));
const subs = def.nodes.filter((n) => n.type === 'subflow');
for (const s of subs) {
  const want = String(s.params?.workflowName ?? '');
  const hit = files.some((f) => f === `${want}.json` || f.includes(want));
  console.log(`④ subflow 依赖：${want} → ${hit ? '✅ 存在' : '❌ 缺失'}（目录内 ${files.length} 个工作流）`);
}
if (subs.length === 0) console.log('④ subflow 依赖：无');

// 5) 人工确认节点：真机点 ▶ 会在这些节点暂停等你确认（2026-10-03 起 manual 真挂起）
const manuals = def.nodes.filter((n) => n.type === 'manual');
if (manuals.length === 0) {
  console.log('⑤ 人工确认节点：无（运行不会暂停）');
} else {
  for (const m of manuals) {
    console.log(`⑤ 人工确认节点：${nodeTag(m, m.id)} 会暂停等确认；prompt=${String(m.params?.prompt ?? '').slice(0, 40)}`);
  }
}
