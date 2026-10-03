// tmp-test/preflight-any.mjs — 对任意工作流文件做「不执行」预检（preflight-demo.mjs 的通用版）
// 用法：node tmp-test/preflight-any.mjs <工作流文件路径>（相对 cwd 或绝对）
// 检查：①parseAndValidate（结构 + schema）②checkWorkflowParams（必填/参数）③分支键 next 清点
//       ④subflow 依赖是否存在 ⑤manual 暂停点 ⑥模板引用指向的节点是否存在 ⑦环检测
import { build } from 'esbuild';
import { readFileSync, readdirSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const target = process.argv[2];
if (!target) { console.error('用法：node tmp-test/preflight-any.mjs <工作流 json 路径>'); process.exit(1); }
if (!existsSync(target)) { console.error('文件不存在：' + target); process.exit(1); }

const tmp = mkdtempSync(join(tmpdir(), 'dag-preflight-'));
const mk = async (entry, name) => {
  const out = join(tmp, name);
  await build({ entryPoints: [join(ROOT, entry)], bundle: true, format: 'esm', platform: 'node', target: 'node20', outfile: out, logLevel: 'silent' });
  return import(pathToFileURL(out).href);
};
const { parseAndValidate, nodeTag } = await mk('src/executor/parse.ts', 'parse.mjs');
const { checkWorkflowParams, formatParamProblems } = await mk('src/registry/params-check.ts', 'params.mjs');

const def = JSON.parse(readFileSync(target, 'utf8'));
const WF_DIR = dirname(target);
console.log(`文件：${target}\n工作流「${def.name}」· 节点 ${def.nodes.length} 个 / edges ${(def.edges ?? []).length} 条 / 工作流参数 ${Object.keys(def.inputs ?? {}).length} 个`);

let bad = 0;
try { parseAndValidate(def); console.log('① 结构校验：✅ 通过'); }
catch (e) { bad++; console.log('① 结构校验：❌', e.message); }

const problems = checkWorkflowParams(def);
if (problems.length === 0) console.log('② 参数预检：✅ 无问题');
else { bad++; console.log(`② 参数预检：❌ ${problems.length} 项\n   ` + formatParamProblems(problems, (id) => nodeTag(def.nodes.find((n) => n.id === id), id)).split('；').join('\n   ')); }

const branches = def.nodes.filter((n) => n.next && typeof n.next === 'object' && !Array.isArray(n.next));
console.log(branches.length ? '③ 分支键 next：' + branches.map((n) => `${n.id}(${n.type})→{${Object.keys(n.next).join(',')}}`).join(' ') : '③ 分支键 next：无（纯顺序/并行）');

const files = readdirSync(WF_DIR).filter((f) => f.endsWith('.json'));
const subs = def.nodes.filter((n) => n.type === 'subflow');
if (subs.length) for (const s of subs) {
  const want = String(s.params?.workflowName ?? '');
  const hit = files.some((f) => f === `${want}.json`);
  if (!hit) bad++;
  console.log(`④ subflow 依赖：${want} → ${hit ? '✅ 存在' : '❌ 缺失'}`);
} else console.log('④ subflow 依赖：无');

const manuals = def.nodes.filter((n) => n.type === 'manual');
console.log(manuals.length ? '⑤ 人工确认：' + manuals.map((m) => m.id).join(',') + ' 会暂停等确认（无人值守的定时运行要留意）' : '⑤ 人工确认节点：无（运行不会暂停）');

// ⑥ 模板引用
const ids = new Set(def.nodes.map((n) => n.id));
const refs = new Set();
const scan = (v) => {
  if (typeof v === 'string') { for (const m of v.matchAll(/\{\{\s*([A-Za-z0-9_\-\u4e00-\u9fa5]+)\./g)) refs.add(m[1]); }
  else if (v && typeof v === 'object') { for (const x of Object.values(v)) scan(x); }
};
for (const n of def.nodes) scan(n.params);
const missing = [...refs].filter((r) => !['inputs', 'vars', 'results'].includes(r) && !ids.has(r));
if (missing.length) bad++;
console.log(missing.length ? '⑥ 模板引用：❌ 指向不存在的节点 ' + missing.join(', ') : `⑥ 模板引用：✅ ${refs.size} 个前缀全部存在`);

// ⑦ 环检测
const edges = def.edges ?? [];
const adj = new Map(def.nodes.map((n) => [n.id, edges.filter((e) => e.from === n.id).map((e) => e.to)]));
const state = new Map(); let cycle = '';
const dfs = (id, path) => {
  if (state.get(id) === 1) { cycle = [...path, id].join('→'); return; }
  if (state.get(id) === 2) return;
  state.set(id, 1);
  for (const t of adj.get(id) ?? []) if (!cycle) dfs(t, [...path, id]);
  state.set(id, 2);
};
for (const n of def.nodes) if (!cycle) dfs(n.id, []);
if (cycle) bad++;
console.log(cycle ? '⑦ 环检测：❌ ' + cycle : '⑦ 环检测：✅ 无环（DAG 合法）');

console.log(bad === 0 ? '\n✅ 预检全部通过（未执行任何节点）' : `\n❌ 预检发现 ${bad} 类问题`);
process.exit(bad === 0 ? 0 : 1);
