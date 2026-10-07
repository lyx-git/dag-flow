// tmp-test/dump-fin-daily.mjs — 只读打印「金融政策日报」的结构，供改造前核对
import { readFileSync } from 'node:fs';

const FILE = 'D:\\workspace\\pluginspace\\.dag-flow\\workflow\\金融政策日报.json';
const def = JSON.parse(readFileSync(FILE, 'utf8'));

console.log('=== 根级字段 ===');
console.log(Object.keys(def).join(', '));
console.log('name =', def.name, '| nodes =', def.nodes.length, '| edges =', (def.edges ?? []).length);
if (def.inputs) console.log('inputs =', JSON.stringify(def.inputs));

console.log('\n=== 节点 ===');
for (const n of def.nodes) {
  const p = n.params ?? {};
  const bits = [];
  if (p.model) bits.push('model=' + p.model);
  if (p.provider) bits.push('provider=' + p.provider);
  if (p.query) bits.push('query=' + String(p.query).slice(0, 60));
  if (p.fileName) bits.push('fileName=' + p.fileName);
  if (p.message) bits.push('message=' + String(p.message).slice(0, 50));
  if (p.vars) bits.push('vars=' + JSON.stringify(p.vars).slice(0, 80));
  if (p.condition) bits.push('condition=' + String(p.condition).slice(0, 40));
  console.log(`  ${n.id.padEnd(18)} ${String(n.type).padEnd(14)} ${bits.join(' | ')}`);
}

console.log('\n=== 边 ===');
for (const e of def.edges ?? []) console.log(`  ${e.from} -> ${e.to}${e.when ? '  when=' + e.when : ''}`);

console.log('\n=== next ===');
for (const n of def.nodes) if (n.next !== undefined) console.log(`  ${n.id}: ${JSON.stringify(n.next)}`);

console.log('\n=== onError / tolerate ===');
for (const n of def.nodes) if (n.onError !== undefined || n.tolerate !== undefined) console.log(`  ${n.id}: onError=${JSON.stringify(n.onError)} tolerate=${n.tolerate}`);

const interesting = ['ai_matrix', 'save_doc', 'mail', 'log_done', 'end'];
for (const id of interesting) {
  const n = (def.nodes ?? []).find((x) => x.id === id);
  if (!n) { console.log(`\n=== ${id} 不存在 ===`); continue; }
  console.log(`\n=== ${id} (${n.type}) 全参数 ===`);
  console.log(JSON.stringify(n.params ?? {}, null, 1));
}
