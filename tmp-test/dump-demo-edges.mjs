// 核实扫描结果：打印全节点演示里 ai_summary / file_save_report / manual_ok 的入边与出边
import { readFileSync } from 'node:fs';
const def = JSON.parse(readFileSync('D:/workspace/pluginspace/.dag-flow/workflow/全节点演示-技术简报.json', 'utf8'));
const edges = def.edges ?? [];
for (const id of ['ai_summary', 'file_save_report', 'manual_ok', 'web_fetch1', 'web_search1', 'session_read', 'http_probe', 'subflow_call']) {
  const ins = edges.filter((e) => e.to === id).map((e) => e.from);
  const outs = edges.filter((e) => e.from === id).map((e) => e.to);
  const nx = def.nodes.find((n) => n.id === id)?.next;
  console.log(`${id.padEnd(18)} 入边=[${ins.join(', ')}]  出边=[${outs.join(', ')}]  next=${JSON.stringify(nx)}`);
}
console.log('\n全部边（按 from 排序）：');
for (const e of [...edges].sort((a, b) => String(a.from).localeCompare(String(b.from)))) console.log(`  ${e.from} → ${e.to}`);
