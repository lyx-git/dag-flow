// tmp-test/inspect-fin-daily-nofile.mjs — 改造前核实：layout 形状、save_doc 的全部引用、描述/版本
import { readFileSync } from 'node:fs';

const FILE = 'D:\\workspace\\pluginspace\\.dag-flow\\workflow\\金融政策日报.json';
const raw = readFileSync(FILE, 'utf8');
const def = JSON.parse(raw);

console.log('version =', def.version, '| description =', JSON.stringify(def.description));

console.log('\n=== layout 形状 ===');
const lay = def.layout;
console.log('layout 类型 =', Array.isArray(lay) ? 'array' : typeof lay, '| 键数 =', lay ? (Array.isArray(lay) ? lay.length : Object.keys(lay).length) : 0);
if (lay && !Array.isArray(lay)) {
  const keys = Object.keys(lay);
  console.log('前 5 个键 =', keys.slice(0, 5).join(', '));
  console.log('save_doc 在 layout 里 =', keys.includes('save_doc'));
  console.log('示例值 =', JSON.stringify(lay[keys[0]]));
  console.log('save_doc 的值 =', JSON.stringify(lay['save_doc']));
  console.log('mail 的值 =', JSON.stringify(lay['mail']));
}

console.log('\n=== 原始 JSON 里 "save_doc" 出现的行 ===');
raw.split('\n').forEach((l, i) => { if (l.includes('save_doc')) console.log(`  L${i + 1}: ${l.trim().slice(0, 150)}`); });

console.log('\n=== 其它可能引用了落盘结果的字段 ===');
for (const n of def.nodes) {
  const s = JSON.stringify(n.params ?? {});
  if (s.includes('save_doc')) console.log(`  ${n.id}: ${s.slice(0, 200)}`);
}

console.log('\n=== file_save 节点 schema 必填项核对（save_doc 的参数）===');
const sd = def.nodes.find((n) => n.id === 'save_doc');
console.log(JSON.stringify(sd, null, 1));

console.log('\n=== 节点 id 列表（用于比对改造前后）===');
console.log(def.nodes.map((n) => n.id).join(', '));
