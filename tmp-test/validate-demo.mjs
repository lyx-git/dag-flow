// tmp-test/validate-demo.mjs — 演示工作流一致性验证（2026-10-02）
// 用法：node tmp-test/validate-demo.mjs
// 1) esbuild 打包 src 校验工具链（parseAndValidate / checkWorkflowParams / topoSort / extractRefs）
// 2) 读 <工作区>/.dag-flow/workflow/ 的两份演示 JSON
// 3) type 真名对齐 + next↔edges 对齐 + layout 键对齐（有修正即回写）
// 4) 引用存在性/拓扑序 + params 必填 + schema 校验
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = process.cwd();
const tmp = mkdtempSync(join(tmpdir(), 'dag-flow-demo-'));
const P = (...seg) => join(ROOT, 'src', ...seg);

const entry = join(tmp, 'entry.mjs');
writeFileSync(entry, [
  `export { parseAndValidate } from ${JSON.stringify(P('executor', 'parse.ts'))};`,
  `export { checkWorkflowParams } from ${JSON.stringify(P('registry', 'params-check.ts'))};`,
  `export { topoSort } from ${JSON.stringify(P('executor', 'topo.ts'))};`,
  `export { extractRefs } from ${JSON.stringify(P('executor', 'dataflow.ts'))};`,
  `export { registerBuiltinNodes } from ${JSON.stringify(P('registry', 'builtin.ts'))};`,
  `export { WorkflowNodeRegistry } from ${JSON.stringify(P('registry', 'external.ts'))};`,
].join('\n'));

const outfile = join(tmp, 'check.bundle.mjs');
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', target: 'node20', outfile, logLevel: 'silent', external: ['@deepseek-ai/cordis'] });
const lib = await import(pathToFileURL(outfile).href);

if (typeof lib.registerBuiltinNodes === 'function') lib.registerBuiltinNodes();
const registry = lib.WorkflowNodeRegistry;
const knownTypes = new Set(registry.list().map((d) => d.type));
console.log('[types]', [...knownTypes].sort().join(' '));

const wfDir = join(ROOT, '..', '.dag-flow', 'workflow');
const childPath = join(wfDir, '子工作流-文字整理.json');
const mainPath = join(wfDir, '全节点演示-技术简报.json');
for (const f of [childPath, mainPath]) {
  if (!existsSync(f)) { console.error('MISSING:', f); process.exit(1); }
}
const child = JSON.parse(readFileSync(childPath, 'utf8'));
const main = JSON.parse(readFileSync(mainPath, 'utf8'));

let fixes = 0;
let errors = 0;
const fix = (msg) => { console.warn('[fix]', msg); fixes++; };

// child 需要显式 edges（可达性/schema 校验与主流程同构；next-only 会被判定不可达）
if (!Array.isArray(child.edges) || child.edges.length === 0) {
  child.edges = [
    { from: 's_start', to: 's_vars' },
    { from: 's_vars', to: 's_log' },
    { from: 's_log', to: 's_end' },
  ];
  console.log('[fix] child: 补 edges 数组（start→vars→log→end）');
  fixes++;
}

function normalize(def, label) {
  const typeOf = (id) => def.nodes.find((n) => n.id === id)?.type ?? '';
  for (const n of def.nodes) {
    if (knownTypes.has(n.type)) continue;
    const hit = [...knownTypes].find((t) => t.toLowerCase() === String(n.type).toLowerCase());
    if (hit) { fix(`${label} ${n.id}: type ${n.type} → ${hit}`); n.type = hit; }
  }
  const ids = new Set(def.nodes.map((n) => n.id));
  if (Array.isArray(def.edges) && def.edges.length > 0) {
    const bySource = new Map();
    for (const e of def.edges) {
      const list = bySource.get(e.from) ?? [];
      list.push(e);
      bySource.set(e.from, list);
    }
    for (const n of def.nodes) {
      const list = bySource.get(n.id) ?? [];
      if (list.length === 0) {
        if (n.next !== undefined) { delete n.next; fix(`${label} ${n.id}: 无出边,删 next`); }
        continue;
      }
      const whens = list.map((e) => (e.when === undefined ? null : String(e.when)));
      let next;
      if (typeOf(n.id) === 'if' && whens.every((w) => w === 'true' || w === 'false')) {
        const t = list.find((e) => String(e.when) === 'true');
        const f = list.find((e) => String(e.when) === 'false');
        next = { true: t?.to ?? '', false: f?.to ?? '' };
      } else if (whens.every((w) => w !== null)) {
        // switch 的 case 映射 next 不被 WORKFLOW_SCHEMA 的 oneOf 接受（只认 string/array/{true,false}/null）
        // → 分支连接只保留在 edges 里（DAG 模式执行真相），删掉画布兜底 next
        if (n.next !== undefined) { delete n.next; fix(`${label} ${n.id}: switch 分支连接只留 edges,删 case-map next`); }
        continue;
      } else {
        const targets = list.map((e) => e.to);
        next = targets.length === 1 ? targets[0] : targets;
      }
      if (JSON.stringify(n.next ?? null) !== JSON.stringify(next)) { n.next = next; fix(`${label} ${n.id}: next 对齐 edges`); }
    }
  }
  if (def.layout) {
    for (const k of Object.keys(def.layout)) {
      if (!ids.has(k)) { delete def.layout[k]; fix(`${label}: layout 键 ${k} 无节点,删`); }
    }
    for (const n of def.nodes) {
      if (!def.layout[n.id]) { def.layout[n.id] = { x: 60, y: 40 }; fix(`${label} ${n.id}: 补 layout`); }
    }
  }
  // 死路自动接边（2026-10-02 用户报 log_http 无出边）：非 end 节点必须有出边（画布问题面板 warn：
  // FlowGramCanvas.tsx「无出边（死路）」）——接到 def 的第一个 end 节点
  const endNodeId = def.nodes.find((n) => n.type === 'end')?.id;
  if (endNodeId) {
    const sources = new Set(def.edges.map((e) => e.from));
    for (const n of def.nodes) {
      if (n.type === 'end' || sources.has(n.id)) continue;
      def.edges.push({ from: n.id, to: endNodeId });
      fix(`${label} ${n.id}: 死路 → 接到 end 节点 ${endNodeId}`);
    }
  }
}

normalize(main, 'main');
normalize(child, 'child');

function checkRefs(def, label) {
  const topo = lib.topoSort(def);
  if (!topo.ok) { console.error(`[${label}] 环路:`, topo.cyclePath); errors++; return; }
  const orderIdx = new Map(topo.order.map((id, i) => [id, i]));
  for (const node of def.nodes) {
    const { nodeRefs } = lib.extractRefs(node.params ?? {});
    for (const ref of nodeRefs) {
      if (!orderIdx.has(ref)) { console.error(`[${label}] REF-MISSING: ${node.id} → ${ref}`); errors++; continue; }
      if (orderIdx.get(ref) > orderIdx.get(node.id)) { console.error(`[${label}] REF-ORDER: ${node.id} → ${ref}`); errors++; }
    }
  }
}
checkRefs(main, 'main');
checkRefs(child, 'child');

for (const [label, def] of [['main', main], ['child', child]]) {
  const problems = lib.checkWorkflowParams(def);
  for (const pr of problems) console.log(`[params] ${label} ${pr.nodeId}(${pr.type}): ${pr.msg}`);
  console.log(`[params] ${label}: ${problems.length} 个问题`);
  try {
    lib.parseAndValidate(JSON.parse(JSON.stringify(def)));
    console.log(`[schema] ${label}: PASS`);
  } catch (e) {
    console.error(`[schema] ${label}: FAIL → ${e.message}`);
    errors++;
  }
}

if (fixes > 0) {
  writeFileSync(mainPath, JSON.stringify(main, null, 2) + '\n', 'utf8');
  writeFileSync(childPath, JSON.stringify(child, null, 2) + '\n', 'utf8');
  console.log(`[normalize] 修正 ${fixes} 处,已回写（重跑应 0 fix）`);
}
console.log(`RESULT: fixes=${fixes} errors=${errors}`);
if (errors > 0) process.exit(1);
