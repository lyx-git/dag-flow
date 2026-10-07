// tmp-test/delete-resurrected-junk.mjs — 删除被"复活"的两个测试工作流（用户 2026-10-04 确认）
//   安全措施：①先打印解析后的绝对路径供核对 ②先备份到 tmp-test/backup-resurrected-junk/
//            ③只删这两个确切文件名 ④删完复核（文件没了、标记还在、其它工作流没动）
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'D:\\workspace\\pluginspace\\.dag-flow\\workflow';
const BAK = join('tmp-test', 'backup-resurrected-junk');
const TARGETS = ['test.json', '测试.json'];

console.log('目标目录（解析后绝对路径）：' + DIR);
console.log('标记文件存在：' + existsSync(join(DIR, '.fallback-migrated')));
console.log('删除前目录内容：' + readdirSync(DIR).join(', '));

mkdirSync(BAK, { recursive: true });
for (const t of TARGETS) {
  const src = join(DIR, t);
  if (!existsSync(src)) { console.log(`跳过（不存在）：${t}`); continue; }
  copyFileSync(src, join(BAK, t));
  console.log(`已备份 → ${join(BAK, t)}`);
}
for (const t of TARGETS) {
  const src = join(DIR, t);
  if (!existsSync(src)) continue;
  rmSync(src);
  console.log(`已删除：${t}`);
}

console.log('\n=== 复核 ===');
console.log('删除后目录内容：' + readdirSync(DIR).join(', '));
console.log('test.json 还在吗：' + existsSync(join(DIR, 'test.json')) + '（应为 false）');
console.log('测试.json 还在吗：' + existsSync(join(DIR, '测试.json')) + '（应为 false）');
console.log('一次性标记还在吗：' + existsSync(join(DIR, '.fallback-migrated')) + '（应为 true）');
console.log('金融政策日报.json 还在吗：' + existsSync(join(DIR, '金融政策日报.json')) + '（应为 true）');
