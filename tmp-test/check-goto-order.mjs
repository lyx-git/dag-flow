// tmp-test/check-goto-order.mjs — 只读体检：现有工作流里的 onError:{goto} 目标**在源节点之前还是之后**
// 为什么要查：轮 3 的 DAG goto 语义是「目标只执行一次」——目标若排在源节点之前（已执行/已过层），
//   跳转不会生效（按"停止这条支路"处理）。这个脚本用与引擎同一套拓扑分层给出结论。
// 用法：node tmp-test/check-goto-order.mjs [工作流目录]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.argv[2] ?? 'D:/workspace/pluginspace/.dag-flow/workflow';

/** 与 src/executor/topo.ts 同语义的分层（Kahn，按 edges；边缺失时用 next 兜底） */
function layersOf(def) {
  const nodes = def.nodes ?? [];
  let edges = def.edges ?? [];
  if (edges.length === 0) {
    edges = [];
    for (const n of nodes) {
      const nx = n.next;
      const list = typeof nx === 'string' ? [nx]
        : Array.isArray(nx) ? nx
          : (nx && typeof nx === 'object' ? Object.values(nx) : []);
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
    for (const id of frontier) {
      for (const to of adj.get(id) ?? []) {
        work.set(to, work.get(to) - 1);
        if (work.get(to) === 0) next.push(to);
      }
    }
    frontier = next;
    li++;
  }
  return layerOf;
}

for (const f of readdirSync(DIR)) {
  if (!f.endsWith('.json') || f.startsWith('.')) continue;
  let def;
  try { def = JSON.parse(readFileSync(join(DIR, f), 'utf8')); } catch { continue; }
  const gotos = (def.nodes ?? []).filter((n) => n.onError && typeof n.onError === 'object' && n.onError.goto);
  if (gotos.length === 0) continue;
  const layerOf = layersOf(def);
  console.log(`\n${f}（${(def.nodes ?? []).length} 节点 / ${(def.edges ?? []).length} 边）`);
  for (const n of gotos) {
    const s = layerOf.get(n.id), t = layerOf.get(n.onError.goto);
    const verdict = s === undefined || t === undefined ? '层未知（源或目标不可达）'
      : t > s ? '✅ 会生效（目标在后面）'
        : '⚠️ 不会生效（目标在同层/更前，按"停止这条支路"处理）';
    console.log(`  ${n.id}(L${s}) → ${n.onError.goto}(L${t})  ${verdict}`);
  }
}
