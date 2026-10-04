// tmp-test/delete-workflow.mjs — 按用户拍板删除工作流文件（**先备份，可整份恢复**）
//   2026-10-04 用户对「演示-你好dagflow.json」（4 个空参数节点 + 7 个不可达节点）的答复：删掉该文件。
// 自检：①文件存在且 JSON 合法 ②备份写入成功且与原文逐字节一致 ③删除后原文件确实不存在
// 用法：node tmp-test/delete-workflow.mjs <工作流名>   （默认 演示-你好dagflow）
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const name = process.argv[2] ?? '演示-你好dagflow';
const TARGET = `../.dag-flow/workflow/${name}.json`;
const BACKUP_DIR = 'tmp-test/backup-deleted-workflows';
const BAK = `${BACKUP_DIR}/${name}.json`;

if (!existsSync(TARGET)) { console.log(`✓ 已完成（${TARGET} 不存在），无需删除`); process.exit(0); }
const text = readFileSync(TARGET, 'utf8');
try { JSON.parse(text); } catch (e) { console.error('✗ JSON 不合法，拒绝删除: ' + e.message); process.exit(1); }

mkdirSync(BACKUP_DIR, { recursive: true });
if (!existsSync(BAK)) writeFileSync(BAK, text, 'utf8');
if (readFileSync(BAK, 'utf8') !== text) { console.error('✗ 备份与原文不一致，拒绝删除'); process.exit(1); }

rmSync(TARGET);
if (existsSync(TARGET)) { console.error('✗ 删除失败（文件仍在）'); process.exit(1); }
console.log(`✓ 已删除工作流：${name}`);
console.log(`✓ 备份（整份，可直接拷回恢复）：${BAK}`);
