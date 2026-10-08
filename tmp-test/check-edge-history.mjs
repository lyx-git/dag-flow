// 查版本快照：ai_intl→ai_final 这条边是哪一次保存时消失的
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const dir = 'D:/workspace/pluginspace/.dag-flow/workflow/versions/金融政策日报';
let files = [];
try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { console.log('无 versions 目录：' + dir); process.exit(0); }
files.sort();
console.log(`快照 ${files.length} 份：`);
for (const f of files) {
  const p = join(dir, f);
  const def = JSON.parse(readFileSync(p, 'utf8'));
  const edges = def.edges ?? [];
  const has = edges.some((e) => e.from === 'ai_intl' && e.to === 'ai_final');
  const mt = statSync(p).mtime.toISOString().replace('T', ' ').slice(0, 19);
  console.log(`  ${f.padEnd(26)} 节点 ${String(def.nodes?.length).padStart(2)} 边 ${String(edges.length).padStart(2)}  ai_intl→ai_final=${has ? '有' : '无'}  mtime ${mt}`);
}
const cur = JSON.parse(readFileSync('D:/workspace/pluginspace/.dag-flow/workflow/金融政策日报.json', 'utf8'));
const curHas = (cur.edges ?? []).some((e) => e.from === 'ai_intl' && e.to === 'ai_final');
console.log(`\n当前文件：节点 ${cur.nodes.length} 边 ${(cur.edges ?? []).length} ai_intl→ai_final=${curHas ? '有' : '无'}`);
