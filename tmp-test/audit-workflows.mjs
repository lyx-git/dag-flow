// tmp-test/audit-workflows.mjs — 只读体检：四轮合并后，现有工作流有哪些"不适配/死配置/结构不一致"
//   （2026-10-04 轮 5 清尾用；不改任何文件）
// 检查项：
//   ① 非法节点 id（违反 schema 的 ^[a-zA-Z][a-zA-Z0-9_-]{0,63}$）→ 这种文件根本执行不了
//   ② 死配置：onError:'stop'（等于默认，无意义）/ onError:{goto} 目标在本节点之前或同层（轮 3 起不会生效）
//   ③ switch 的 params.cases 与出边 when 不一致（memory 里记过的"演示工作流被改坏"那一类）
//   ④ if/switch 出边缺分支键（线上无键 = 执行语义与意图不符）
// 用法：node tmp-test/audit-workflows.mjs [工作流目录]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.argv[2] ?? 'D:/workspace/pluginspace/.dag-flow/workflow';
const ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

function layersOf(def) {
  const nodes = def.nodes ?? [];
  let edges = def.edges ?? [];
  if (edges.length === 0) {
    edges = [];
    for (const n of nodes) {
      const nx = n.next;
      const list = typeof nx === 'string' ? [nx] : Array.isArray(nx) ? nx : (nx && typeof nx === 'object' ? Object.values(nx) : []);
      for (const to of list) if (typeof to === 'string') edges.push({ from: n.id, to });
    }
  }
  const ids = new Set(nodes.map((n) => n.id));
  const adj = new Map(nodes.map((n) => [n.id, []]));
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    adj.get(e.from).push(e.to);
    indeg.set(e.to, indeg.get(e.to) + 1);
  }
  const work = new Map(indeg);
  const layerOf = new Map();
  let frontier = [...work.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  let li = 0;
  while (frontier.length) {
    for (const id of frontier) layerOf.set(id, li);
    const next = [];
    for (const id of frontier) for (const to of adj.get(id) ?? []) { work.set(to, work.get(to) - 1); if (work.get(to) === 0) next.push(to); }
    frontier = next; li++;
  }
  return layerOf;
}

let problems = 0;
for (const f of readdirSync(DIR)) {
  if (!f.endsWith('.json') || f.startsWith('.')) continue;
  let def;
  try { def = JSON.parse(readFileSync(join(DIR, f), 'utf8')); } catch (e) { console.log(`\n${f}：❌ JSON 解析失败 ${e.message}`); problems++; continue; }
  const nodes = def.nodes ?? [];
  const edges = def.edges ?? [];
  const layerOf = layersOf(def);
  const out = [];

  for (const n of nodes) if (!ID_RE.test(n.id)) out.push(`  ① 非法 id：${n.id}（${n.type}）`);

  for (const n of nodes) {
    if (n.onError === 'stop') out.push(`  ② 死配置：${n.id} onError:'stop'（= 默认，可删）`);
    if (n.onError && typeof n.onError === 'object' && n.onError.goto) {
      const s = layerOf.get(n.id), t = layerOf.get(n.onError.goto);
      if (s !== undefined && t !== undefined && t <= s) out.push(`  ② 死配置：${n.id}(L${s}) onError.goto → ${n.onError.goto}(L${t}) 不会生效（轮 3 起只对后面的层生效）`);
    }
    if (n.onError === 'continue') {
      const outs = edges.filter((e) => e.from === n.id);
      if (outs.length === 0) out.push(`  ② 可疑：${n.id} onError:'continue' 但该节点没有出边（"跳过下游"无所指）`);
    }
  }

  for (const n of nodes.filter((x) => x.type === 'switch')) {
    const cases = Object.keys(n.params?.cases ?? {});
    const whens = edges.filter((e) => e.from === n.id).map((e) => e.when);
    const missing = cases.filter((c) => !whens.includes(c));
    const extra = whens.filter((w) => w && w !== '*' && !cases.includes(w));
    if (missing.length) out.push(`  ③ switch ${n.id}：case ${JSON.stringify(missing)} 没有对应出边（运行到该 case 时不会激活任何分支）`);
    if (extra.length) out.push(`  ③ switch ${n.id}：出边 when ${JSON.stringify(extra)} 不在 cases 里`);
  }

  for (const n of nodes.filter((x) => x.type === 'if' || x.type === 'switch')) {
    const bare = edges.filter((e) => e.from === n.id && (e.when === undefined || e.when === null || e.when === ''));
    if (bare.length) out.push(`  ④ ${n.type} ${n.id}：有 ${bare.length} 条出边没设分支键（${n.type === 'if' ? 'DAG 按恒激活处理，两个分支都会跑' : 'DAG 按未激活处理，目标会被跳过'}）`);
  }

  if (out.length) { console.log(`\n${f}（${nodes.length} 节点 / ${edges.length} 边）`); out.forEach((l) => console.log(l)); problems += out.length; }
}
console.log(`\n合计待修项：${problems}`);
