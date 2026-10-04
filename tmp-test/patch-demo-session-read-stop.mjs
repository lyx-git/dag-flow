// tmp-test/patch-demo-session-read-stop.mjs — 用户拍板方案 A（2026-10-04）：
//   把「全节点演示-技术简报.json」里 session_read 的失败策略从 ⏭「跳过这条支路」(onError:'continue')
//   改回 ⛔「停止这条支路」= **删除该字段**（stop 是默认值，面板也是删键不落 false/stop）。
//   为什么（用户已确认的理解）：该节点的输出被 ai_summary / file_save_report 引用，
//   "静默通过"救不了数据依赖 —— 失败照样让下游取值报错，还把根因埋在下游。
// 自检（四道，全过才写盘）：①文件存在且 JSON 合法 ②session_read 现在确实是 continue
//   ③全文件里只有这一个节点是 continue（否则拒绝，避免误删） ④写盘后逐字节确认"只少了那一行"
// 幂等：重复执行会报"已完成"并退出 0。用法：node tmp-test/patch-demo-session-read-stop.mjs
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const TARGET = '../.dag-flow/workflow/全节点演示-技术简报.json';
const BACKUP_DIR = 'tmp-test/backup-selfcheck-session-read';
const NODE_ID = 'session_read';

if (!existsSync(TARGET)) { console.error('✗ 找不到目标文件: ' + TARGET); process.exit(1); }
const before = readFileSync(TARGET, 'utf8');
let def;
try { def = JSON.parse(before); } catch (e) { console.error('✗ JSON 不合法，拒绝改动: ' + e.message); process.exit(1); }

const node = (def.nodes ?? []).find((n) => n.id === NODE_ID);
if (!node) { console.error(`✗ 找不到节点 ${NODE_ID}`); process.exit(1); }
if (node.onError === undefined) { console.log(`✓ 已完成（${NODE_ID} 没有 onError = 已是 ⛔ 停止），无需改动`); process.exit(0); }
if (node.onError !== 'continue') { console.error(`✗ ${NODE_ID}.onError = ${JSON.stringify(node.onError)}，不是预期的 'continue'，拒绝改动`); process.exit(1); }

const others = (def.nodes ?? []).filter((n) => n.onError === 'continue');
if (others.length !== 1) { console.error(`✗ 全文件里 onError==='continue' 的节点有 ${others.length} 个（预期 1），拒绝改动以免误删`); process.exit(1); }

// 精确定位：从 `"id": "session_read"` 之后，删掉紧随其后（同一节点块内）的那一行 onError
const idIdx = before.indexOf(`"id": "session_read"`);
if (idIdx < 0) { console.error('✗ 文本里找不到 session_read 的 id 行'); process.exit(1); }
const tailIdx = before.indexOf('"onError": "continue"', idIdx);
const nextBrace = before.indexOf('\n    }', idIdx);   // 该节点块的收尾
if (tailIdx < 0 || (nextBrace > 0 && tailIdx > nextBrace)) { console.error('✗ 定位失败：onError 不在 session_read 节点块内'); process.exit(1); }

// 删掉整行（含其前导空白与行尾换行）
const lineStart = before.lastIndexOf('\n', tailIdx) + 1;
const lineEnd = before.indexOf('\n', tailIdx) + 1;
const after = before.slice(0, lineStart) + before.slice(lineEnd);

// —— 写盘前先把内存里的改法验一遍 ——
let afterDef;
try { afterDef = JSON.parse(after); } catch (e) { console.error('✗ 改动后 JSON 不合法（未写盘）: ' + e.message); process.exit(1); }
const afterNode = afterDef.nodes.find((n) => n.id === NODE_ID);
if (afterNode.onError !== undefined) { console.error('✗ 改动后 session_read 仍有 onError（未写盘）'); process.exit(1); }
const stripON = (d) => JSON.stringify((d.nodes ?? []).map((n) => { const { onError, ...rest } = n; return rest; }));
if (stripON(def) !== stripON(afterDef)) { console.error('✗ 改动波及了其它节点（未写盘）'); process.exit(1); }
const removedLines = before.split('\n').length - after.split('\n').length;
if (removedLines !== 1) { console.error(`✗ 改动删了 ${removedLines} 行（预期 1 行，未写盘）`); process.exit(1); }
const diffOnlyLine = before.split('\n').filter((l) => l.includes('"onError": "continue"')).length === 1;
if (!diffOnlyLine) { console.error('✗ 文件里 onError:continue 行不止一处（未写盘）'); process.exit(1); }

// —— 备份 + 写盘 ——
mkdirSync(BACKUP_DIR, { recursive: true });
const bak = `${BACKUP_DIR}/全节点演示-技术简报.json`;
if (!existsSync(bak)) copyFileSync(TARGET, bak);
writeFileSync(TARGET, after, 'utf8');
console.log(`✓ 已改：session_read 的 onError:'continue' → 删除该字段（= ⛔ 停止这条支路）`);
console.log(`✓ 只删了 1 行；其它节点逐字段比对无变化；JSON 合法`);
console.log(`✓ 备份：${bak}（回退就整份拷回）`);
