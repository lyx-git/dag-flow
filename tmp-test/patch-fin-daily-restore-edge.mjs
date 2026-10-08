// 补回金融政策日报里丢失的边 ai_intl → ai_final（幂等 + 前后自检 + 备份）
// 用法：node tmp-test/patch-fin-daily-restore-edge.mjs        演练
//       node tmp-test/patch-fin-daily-restore-edge.mjs --write 写盘
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';

const SRC = 'D:/workspace/pluginspace/.dag-flow/workflow/金融政策日报.json';
const BACKUP_DIR = 'tmp-test/backup-fin-daily-edge';
const WRITE = process.argv.includes('--write');
const FROM = 'ai_intl';
const TO = 'ai_final';

const def = JSON.parse(readFileSync(SRC, 'utf8'));
const problems = [];
const edges = def.edges ?? [];
const node = def.nodes.find((n) => n.id === FROM);

if (!node) problems.push(`找不到节点 ${FROM}`);
if (!def.nodes.find((n) => n.id === TO)) problems.push(`找不到节点 ${TO}`);
const already = edges.some((e) => e.from === FROM && e.to === TO);
const beforeSig = JSON.stringify(edges.map((e) => `${e.from}→${e.to}`).sort());

if (problems.length === 0 && !already) {
  // 插到 ai_bank→ai_final 之后（保持 DIMS 顺序），找不到就追加
  const idx = edges.findIndex((e) => e.from === 'ai_bank' && e.to === TO);
  if (idx >= 0) edges.splice(idx + 1, 0, { from: FROM, to: TO });
  else edges.push({ from: FROM, to: TO });
  def.edges = edges;
  node.next = TO;

  // —— 后置自检 ——
  if (edges.length !== 37) problems.push(`边数应为 37，实际 ${edges.length}`);
  if (edges.filter((e) => e.from === FROM && e.to === TO).length !== 1) problems.push('新边不唯一');
  if (node.next !== TO) problems.push(`${FROM}.next 未写入`);
  const others = edges.filter((e) => !(e.from === FROM && e.to === TO)).map((e) => `${e.from}→${e.to}`).sort();
  const beforeOthers = JSON.parse(beforeSig).filter((k) => k !== `${FROM}→${TO}`);
  if (JSON.stringify(others) !== JSON.stringify(beforeOthers)) problems.push('其它边发生了变化（不该发生）');
  if (def.nodes.length !== 31) problems.push(`节点数应为 31，实际 ${def.nodes.length}`);
  for (const n of def.nodes) {
    const outs = edges.filter((e) => e.from === n.id).map((e) => e.to);
    const nx = n.next === undefined ? [] : Array.isArray(n.next) ? n.next : [n.next];
    if (outs.length !== nx.length || outs.some((t) => !nx.includes(t))) problems.push(`${n.id} 的 next 与 edges 仍不一致`);
  }
}

console.log(already ? `${FROM}→${TO} 已存在（幂等，无需改动）` : `${FROM}→${TO} ${problems.length ? '待补' : '已补（内存中）'}`);
console.log(`边 ${edges.length} 条；自检问题 ${problems.length} 项`);
for (const p of problems) console.log('  ✗ ' + p);
if (problems.length) { console.log('→ 自检未通过，不写盘'); process.exit(1); }
if (already) process.exit(0);
if (!WRITE) { console.log('（演练模式：加 --write 才写盘）'); process.exit(0); }

mkdirSync(BACKUP_DIR, { recursive: true });
const bak = `${BACKUP_DIR}/金融政策日报.${Date.now()}.json`;
if (!existsSync(bak)) copyFileSync(SRC, bak);
writeFileSync(SRC, JSON.stringify(def, null, 2), 'utf8');
console.log(`已写入 ${SRC}\n备份 ${bak}`);
