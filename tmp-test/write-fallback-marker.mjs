// tmp-test/write-fallback-marker.mjs — 把兜底迁移的一次性标记预先写进真实工作区
//   为什么需要预写：迁移在本机**已经跑过**（那几个文件早就迁进来了）。若不预写，下次宿主启动时
//   代码会认为"还没迁过"而再走一遍 —— 好在目标文件当前都在、不会重写，但这仍是一次多余的检查；
//   更要紧的是：如果你在重启前先删掉它们，那一次检查就会把它们复制回来（又要多经历一次"复活"）。
import { existsSync, writeFileSync } from 'node:fs';

const DIR = 'D:\\workspace\\pluginspace\\.dag-flow\\workflow';
const MARKER = DIR + '\\.fallback-migrated';

if (existsSync(MARKER)) {
  console.log('标记已存在，无需处理：' + MARKER);
  process.exit(0);
}
const payload = {
  migratedAt: new Date().toISOString(),
  from: 'C:\\Users\\lmz\\.dsh\\workflows',
  files: 2,
  note: '预先写入（2026-10-04 修复「删掉的工作流会复活」）：本工作区早已完成兜底迁移，此后不再补迁。',
};
writeFileSync(MARKER, JSON.stringify(payload) + '\n', 'utf8');
console.log('✓ 已写入标记：' + MARKER);
console.log('  ' + JSON.stringify(payload));
