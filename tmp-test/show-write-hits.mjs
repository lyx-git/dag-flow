// tmp-test/show-write-hits.mjs — 打印 python 节点里 open(/write( 的具体行，判定是"读"还是"写"
import { readFileSync } from 'node:fs';

const FILE = 'D:\\workspace\\pluginspace\\.dag-flow\\workflow\\金融政策日报.json';
const def = JSON.parse(readFileSync(FILE, 'utf8'));

for (const id of ['py_date', 'fetch_cctv', 'mail']) {
  const n = def.nodes.find((x) => x.id === id);
  if (!n) continue;
  console.log(`\n=== ${id} ===`);
  String(n.params.code ?? '').split('\n').forEach((l, i) => {
    if (/open\(|write\(/.test(l)) console.log(`  L${i + 1}: ${l.trim()}`);
  });
}
