// tmp-test/patch-fin-daily-drop-deadkey.mjs — 用户 2026-10-04 拍板：删掉「金融政策日报.json」里
//   ai_q_intl 节点上的 `onError:'stop'`（⛔ 停止是**默认行为**，面板默认项不落键 ⇒ 该字段是冗余死配置）。
//   `audit-workflows.mjs` 体检报的唯一一条待修项。
// 自检（四道，全过才写盘）：①JSON 合法 ②ai_q_intl 现在确实是 'stop' ③全文件里 onError==='stop' 的节点只有它一个
//   ④写盘后逐字段比对其它节点无变化、且恰好只少一行。幂等：重复执行报"已完成"。
// 用法：node tmp-test/patch-fin-daily-drop-deadkey.mjs
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const TARGET = '../.dag-flow/workflow/金融政策日报.json';
const BACKUP_DIR = 'tmp-test/backup-selfcheck-deadkey';
const NODE_ID = 'ai_q_intl';

if (!existsSync(TARGET)) { console.error('✗ 找不到目标文件: ' + TARGET); process.exit(1); }
const before = readFileSync(TARGET, 'utf8');
let def;
try { def = JSON.parse(before); } catch (e) { console.error('✗ JSON 不合法，拒绝改动: ' + e.message); process.exit(1); }

const node = (def.nodes ?? []).find((n) => n.id === NODE_ID);
if (!node) { console.error(`✗ 找不到节点 ${NODE_ID}`); process.exit(1); }
if (node.onError === undefined) { console.log(`✓ 已完成（${NODE_ID} 没有 onError），无需改动`); process.exit(0); }
if (node.onError !== 'stop') { console.error(`✗ ${NODE_ID}.onError = ${JSON.stringify(node.onError)}，不是预期的 'stop'，拒绝改动`); process.exit(1); }

const others = (def.nodes ?? []).filter((n) => n.onError === 'stop');
if (others.length !== 1) { console.error(`✗ 全文件里 onError==='stop' 的节点有 ${others.length} 个（预期 1），拒绝改动以免误删`); process.exit(1); }

const idIdx = before.indexOf(`"id": "${NODE_ID}"`);
if (idIdx < 0) { console.error('✗ 文本里找不到该节点的 id 行'); process.exit(1); }
const tailIdx = before.indexOf('"onError": "stop"', idIdx);
const nextBrace = before.indexOf('\n    }', idIdx);
if (tailIdx < 0 || (nextBrace > 0 && tailIdx > nextBrace)) { console.error('✗ 定位失败：onError 不在该节点块内'); process.exit(1); }

const lineStart = before.lastIndexOf('\n', tailIdx) + 1;
const lineEnd = before.indexOf('\n', tailIdx) + 1;
let after = before.slice(0, lineStart) + before.slice(lineEnd);
// ★ 若被删的是该对象**最后一个属性**，上一行会留下多余逗号（→ JSON 非法）。这里顺手去掉那个逗号。
//   （第一次写这个脚本时正是被自己的自检挡住：`Expected double-quoted property name`）
const nextChunk = before.slice(lineEnd);
if (/^\s*\}/.test(nextChunk)) {
  const prevText = before.slice(0, lineStart);
  const prevLineStart = prevText.lastIndexOf('\n', prevText.length - 2) + 1;
  const prevLine = prevText.slice(prevLineStart, prevText.length - 1);   // 不含行尾 \n
  if (/,\s*$/.test(prevLine)) {
    after = before.slice(0, prevLineStart) + prevLine.replace(/,\s*$/, '') + '\n' + before.slice(lineEnd);
    console.log('（注意：删的是最后一个属性，已同时去掉上一行末尾的多余逗号）');
  }
}

let afterDef;
try { afterDef = JSON.parse(after); } catch (e) { console.error('✗ 改动后 JSON 不合法（未写盘）: ' + e.message); process.exit(1); }
if (afterDef.nodes.find((n) => n.id === NODE_ID).onError !== undefined) { console.error('✗ 改动后仍有 onError（未写盘）'); process.exit(1); }
const stripON = (d) => JSON.stringify((d.nodes ?? []).map((n) => { const { onError, ...rest } = n; return rest; }));
if (stripON(def) !== stripON(afterDef)) { console.error('✗ 改动波及了其它节点（未写盘）'); process.exit(1); }
const removedLines = before.split('\n').length - after.split('\n').length;
if (removedLines !== 1) { console.error(`✗ 改动删了 ${removedLines} 行（预期 1 行，未写盘）`); process.exit(1); }

mkdirSync(BACKUP_DIR, { recursive: true });
const bak = `${BACKUP_DIR}/金融政策日报.json`;
if (!existsSync(bak)) copyFileSync(TARGET, bak);
writeFileSync(TARGET, after, 'utf8');
console.log(`✓ 已改：${NODE_ID} 的 onError:'stop' → 删除该字段（= 默认 ⛔ 停止这条支路，行为不变）`);
console.log('✓ 只删了 1 行；其它节点逐字段比对无变化；JSON 合法');
console.log(`✓ 备份：${bak}（回退就整份拷回）`);
