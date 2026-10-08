// 精确核对：8 个分析节点 → ai_final 的边，哪几条还在、哪几条丢了
import { readFileSync } from 'node:fs';
const def = JSON.parse(readFileSync('D:/workspace/pluginspace/.dag-flow/workflow/金融政策日报.json', 'utf8'));
const edges = def.edges ?? [];
const analysts = def.nodes.filter((n) => /^ai_/.test(n.id)).map((n) => n.id);
console.log('分析节点 → ai_final 的边：');
for (const id of analysts) {
  if (id === 'ai_final') continue;
  const inEdges = edges.some((e) => e.from === id && e.to === 'ai_final');
  const inNext = def.nodes.find((n) => n.id === id)?.next;
  console.log(`  ${id.padEnd(10)} edges里有=${inEdges ? '✓' : '✗ 丢了'}  next=${JSON.stringify(inNext)}`);
}
console.log('\n边总数：', edges.length, '｜nodes 总数：', def.nodes.length);
const dup = edges.map((e) => `${e.from}→${e.to}`).filter((v, i, a) => a.indexOf(v) !== i);
console.log('重复边：', dup.join(', ') || '（无）');
// next 与 edges 是否一致（找出所有不一致的节点）
const bad = [];
for (const n of def.nodes) {
  const outs = edges.filter((e) => e.from === n.id).map((e) => e.to);
  const nx = n.next === undefined ? [] : Array.isArray(n.next) ? n.next : typeof n.next === 'string' ? [n.next] : Object.values(n.next);
  if (outs.length !== nx.length || outs.some((t) => !nx.includes(t))) bad.push(`${n.id}: edges=[${outs}] next=[${nx}]`);
}
console.log('\nnext 与 edges 不一致的节点：\n  ' + (bad.join('\n  ') || '（无）'));
