// 扫描：真实工作流里"引用了某节点的输出、但两者之间没有连线路径"的情况（= 用户要禁的那类）
// 判据：把 edges ∪ next 归一化成图，算每个节点的**祖先集合**；引用者必须在该集合里，否则算违规。
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'D:/workspace/pluginspace/.dag-flow/workflow';
const RESERVED = new Set(['inputs', 'vars', 'env', 'item', 'loopItem', 'loopIndex']);
const REF_RE = /\{\{\s*([^}.\s]+)\.[^}]*\}\}/g;

function normEdges(def) {
  const out = new Set();
  const add = (a, b) => { if (a && b) out.add(`${a}\u0000${b}`); };
  for (const e of def.edges ?? []) add(e.from, e.to);
  for (const n of def.nodes ?? []) {
    const nx = n.next;
    if (typeof nx === 'string') add(n.id, nx);
    else if (Array.isArray(nx)) for (const t of nx) add(n.id, t);
    else if (nx && typeof nx === 'object') for (const t of Object.values(nx)) add(n.id, t);
  }
  return [...out].map((s) => s.split('\u0000'));
}

function ancestors(edges, target) {
  const back = new Map();
  for (const [a, b] of edges) { if (!back.has(b)) back.set(b, []); back.get(b).push(a); }
  const seen = new Set();
  const q = [...(back.get(target) ?? [])];
  while (q.length) {
    const cur = q.shift();
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const p of back.get(cur) ?? []) if (!seen.has(p)) q.push(p);
  }
  return seen;
}

let total = 0;
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
  const def = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  const ids = new Set((def.nodes ?? []).map((n) => n.id));
  const edges = normEdges(def);
  const rows = [];
  for (const n of def.nodes ?? []) {
    const text = JSON.stringify(n.params ?? {});
    const refs = new Set();
    REF_RE.lastIndex = 0;
    let m;
    while ((m = REF_RE.exec(text)) !== null) refs.add(m[1]);
    for (const r of refs) {
      if (RESERVED.has(r) || r === n.id) continue;
      if (!ids.has(r)) continue;                       // 引用不存在的节点是另一条规则（REF_UNKNOWN）
      const anc = ancestors(edges, n.id);
      if (!anc.has(r)) rows.push(`  ✗ ${n.id} 引用 ${r}（${r} 不是它的上游：无连线路径）`);
    }
  }
  total += rows.length;
  console.log(`\n${f}（${(def.nodes ?? []).length} 节点 / ${(def.edges ?? []).length} 边）：${rows.length ? rows.length + ' 处违规' : '✓ 无违规'}`);
  for (const r of rows.slice(0, 12)) console.log(r);
  if (rows.length > 12) console.log(`  …另有 ${rows.length - 12} 处`);
}
console.log(`\n合计违规 ${total} 处`);
