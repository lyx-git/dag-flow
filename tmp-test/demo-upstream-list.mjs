// 用真实工作流演示「上游变量」到底是哪些（= 反向 BFS 的祖先集合，跨所有路径）
import { readFileSync } from 'node:fs';
const def = JSON.parse(readFileSync('D:/workspace/pluginspace/.dag-flow/workflow/金融政策日报.json', 'utf8'));

// 与画布/引擎同口径：edges ∪ next
const parents = new Map();
const add = (from, to) => { if (!parents.has(to)) parents.set(to, new Set()); parents.get(to).add(from); };
for (const e of def.edges ?? []) add(e.from, e.to);
for (const n of def.nodes ?? []) {
  const nx = n.next;
  if (typeof nx === 'string') add(n.id, nx);
  else if (Array.isArray(nx)) for (const t of nx) add(n.id, t);
}
const label = (id) => def.nodes.find((n) => n.id === id)?.label ?? id;

for (const id of ['ai_policy', 'ai_final', 'mail', 'end']) {
  const seen = new Set([id]);
  const q = [id];
  const out = [];
  while (q.length) {
    const cur = q.shift();
    for (const p of parents.get(cur) ?? []) if (!seen.has(p)) { seen.add(p); out.push(p); q.push(p); }
  }
  console.log(`\n【${id}（${label(id)}）】上游 ${out.length} 个：`);
  console.log('  ' + out.map((x) => label(x)).join('、'));
}
