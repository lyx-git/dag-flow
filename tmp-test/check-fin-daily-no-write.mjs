// tmp-test/check-fin-daily-no-write.mjs — 确认改造后工作流里没有任何"落盘"动作
import { readFileSync } from 'node:fs';

const FILE = 'D:\\workspace\\pluginspace\\.dag-flow\\workflow\\金融政策日报.json';
const def = JSON.parse(readFileSync(FILE, 'utf8'));

console.log('=== 节点类型统计 ===');
const byType = {};
for (const n of def.nodes) byType[n.type] = (byType[n.type] ?? 0) + 1;
console.log('  ' + Object.entries(byType).map(([k, v]) => `${k}×${v}`).join(', '));
console.log('  file_save 节点数 =', def.nodes.filter((n) => n.type === 'file_save').length, '（应为 0）');

console.log('\n=== python 节点里疑似写文件的关键字 ===');
const KWS = ["open(", "'w'", '"w"', 'write(', 'mkdir', 'makedirs', 'shutil', 'to_csv', 'Path('];
for (const n of def.nodes.filter((n) => n.type === 'python')) {
  const c = String(n.params.code ?? '');
  const hits = KWS.map((kw) => [kw, c.split(kw).length - 1]).filter(([, c2]) => c2 > 0).map(([kw, c2]) => `${kw}×${c2}`);
  console.log(`  ${n.id.padEnd(12)} ${hits.join(', ') || '(无写文件痕迹)'}`);
}

console.log('\n=== mail 节点代码里的注入与关键行 ===');
const mail = def.nodes.find((n) => n.id === 'mail');
const code = String(mail.params.code ?? '');
for (const line of code.split('\n')) {
  if (/REPORT|WORKSPACE_HINT|ai_matrix|attachment|MIME|render_html\(/.test(line) && !line.trim().startsWith('#')) {
    console.log('  ' + line.trim().slice(0, 120));
  }
}
