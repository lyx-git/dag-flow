// 核实：金融政策日报里 ai_intl 的出边情况（next + edges 两处）
import { readFileSync } from 'node:fs';
const def = JSON.parse(readFileSync('D:/workspace/pluginspace/.dag-flow/workflow/金融政策日报.json', 'utf8'));
const id = 'ai_intl';
const node = def.nodes.find((n) => n.id === id);
console.log(`${id} 的 next：`, JSON.stringify(node?.next));
const out = (def.edges ?? []).filter((e) => e.from === id);
console.log(`${id} 的 edges 出边：`, out.map((e) => `${e.from}→${e.to}${e.when ? '@' + e.when : ''}`).join(', ') || '（无）');
const into = (def.edges ?? []).filter((e) => e.to === id);
console.log(`${id} 的入边：`, into.map((e) => `${e.from}→${e.to}`).join(', ') || '（无）');

// 全图：所有"非 end 且无出边"的节点（问题面板那条 warn 的判据）
const ends = new Set(def.nodes.filter((n) => n.type === 'end').map((n) => n.id));
const hasOut = new Set((def.edges ?? []).map((e) => e.from));
const dead = def.nodes.filter((n) => !ends.has(n.id) && !hasOut.has(n.id)).map((n) => `${n.id}(${n.type})`);
console.log('\n非 end 且无出边的节点：', dead.join(', ') || '（无）');
console.log('end 节点：', [...ends].join(', '));
console.log('节点数/边数：', def.nodes.length, '/', (def.edges ?? []).length);
