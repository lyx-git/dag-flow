// tmp-test/db-mem-query.mjs — 只读查记忆库：核对某前缀的完整 id / 状态 / 归属（短前缀有歧义，更新前必查）
// 用法：node tmp-test/db-mem-query.mjs [前缀]   默认 '0muscof'（邮件改造相关的 lesson/fact/project 三条）
import { DatabaseSync } from 'node:sqlite';

const prefix = process.argv[2] ?? '0muscof';
const db = new DatabaseSync('D:/workspace/pluginspace/.dsh-meow/memory.db');
const levels = ['soul', 'user', 'project', 'fact', 'lesson', 'topic', 'rules'];
let n = 0;
for (const lv of levels) {
  let rows = [];
  try {
    rows = db.prepare(`select id, status, substr(content,1,64) as head from ${lv} where id like ? order by id`).all(`${prefix}%`);
  } catch { continue; }   // 表不存在/字段缺失则跳过
  for (const r of rows) { n++; console.log(`${lv.padEnd(7)} ${r.id}  [${r.status}]\n        ${r.head.replace(/\n/g, ' ')}`); }
}
console.log(`\n前缀 "${prefix}" 命中 ${n} 条`);
