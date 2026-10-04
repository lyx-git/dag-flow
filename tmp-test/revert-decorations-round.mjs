// tmp-test/revert-decorations-round.mjs — 回退「开始 group」轮（2026-10-04 用户指示）
//   本脚本负责**数据侧**：①把所有将被回退的源文件备份到 tmp-test/backup-decorations-round/
//   ②把工作流 JSON 里被写进去的根级 `canvas` 字段删掉（撤掉 schema 后它会变成"多余字段"→ 校验失败）
// 用法：node tmp-test/revert-decorations-round.mjs [--strip-data]
//   不加 --strip-data 只备份；加了才动工作流数据（带四道自检）
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const APPLY_DATA = process.argv.includes('--strip-data');
const BACKUP = 'tmp-test/backup-decorations-round';
mkdirSync(BACKUP, { recursive: true });

// 本轮改动过的源文件（备份成 路径__用__双下划线 的扁平名，便于整份拷回）
const FILES = [
  'src/types.ts',
  'src/client/flowgram/decorations.ts',
  'src/client/flowgram/nodes.tsx',
  'src/client/flowgram/FlowGramCanvas.tsx',
  'src/client/util/flowDef.ts',
  'src/client/FlowPanel.tsx',
  'src/client/styles.css',
  'src/index.ts',
  'src/client/index.tsx',
  'test/decorations.test.mjs',
  'tmp-test/cdp/test-decorations.mjs',
  'tmp-test/cdp/run-all.mjs',
  'tmp-test/cdp/diag-deco.mjs',
  'tmp-test/cdp/shot-decorations.mjs',
  'package.json',
];
let n = 0;
for (const f of FILES) {
  if (!existsSync(f)) { console.log(`  （跳过，不存在）${f}`); continue; }
  const dest = `${BACKUP}/${f.replace(/[/\\]/g, '__')}`;
  copyFileSync(f, dest);
  n++;
}
console.log(`✓ 已备份 ${n} 个源文件 → ${BACKUP}/`);

// —— 数据侧：删掉工作流 JSON 里的根级 canvas ——
const WF_DIR = '../.dag-flow/workflow';
const targets = readdirSync(WF_DIR).filter((f) => f.endsWith('.json'));
for (const f of targets) {
  const p = `${WF_DIR}/${f}`;
  const raw = readFileSync(p, 'utf8');
  let def;
  try { def = JSON.parse(raw); } catch (e) { console.log(`  ✗ ${f} JSON 不合法，跳过：${e.message}`); continue; }
  if (def.canvas === undefined) continue;
  if (!APPLY_DATA) { console.log(`  （待处理）${f} 含根级 canvas：${JSON.stringify(def.canvas).slice(0, 120)}`); continue; }
  // 精确定位并删掉根级 "canvas": { ... }（含前后逗号处理），再做四道自检
  const key = '\n  "canvas": {';
  const i = raw.indexOf(key);
  if (i < 0) { console.log(`  ✗ ${f} 文本里定位不到根级 canvas，跳过（保守）`); continue; }
  // 从 key 起做括号配对，找到该对象的结束位置
  let depth = 0, j = raw.indexOf('{', i), end = -1;
  for (let k = j; k < raw.length; k++) {
    const ch = raw[k];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = k; break; } }
  }
  if (end < 0) { console.log(`  ✗ ${f} 括号配对失败，跳过`); continue; }
  // 结束符之后：若是 `,\n` → 连逗号一起删；否则前面还有逗号，删前一个
  let from = i, to = end + 1;
  const tail = raw.slice(to, to + 2);
  if (/^\s*,/.test(tail)) to = to + tail.indexOf(',') + 1;
  else {
    const before = raw.slice(0, from);
    const comma = before.lastIndexOf(',');
    if (comma >= 0 && before.slice(comma + 1).trim() === '') from = comma;
  }
  const nextRaw = raw.slice(0, from) + raw.slice(to);
  // 自检：①JSON 合法 ②canvas 没了 ③其它根键一字不少 ④节点/边数量不变
  let nextDef;
  try { nextDef = JSON.parse(nextRaw); } catch (e) { console.log(`  ✗ ${f} 删后 JSON 非法，未写盘：${e.message}`); continue; }
  if (nextDef.canvas !== undefined) { console.log(`  ✗ ${f} canvas 仍在，未写盘`); continue; }
  const keysBefore = Object.keys(def).filter((k) => k !== 'canvas').sort().join(',');
  const keysAfter = Object.keys(nextDef).sort().join(',');
  if (keysBefore !== keysAfter) { console.log(`  ✗ ${f} 根键集合变了，未写盘：${keysBefore} → ${keysAfter}`); continue; }
  if ((def.nodes ?? []).length !== (nextDef.nodes ?? []).length || (def.edges ?? []).length !== (nextDef.edges ?? []).length) {
    console.log(`  ✗ ${f} 节点/边数量变了，未写盘`); continue;
  }
  if (!existsSync(`${BACKUP}/${f}`)) copyFileSync(p, `${BACKUP}/${f}`);
  writeFileSync(p, nextRaw, 'utf8');
  console.log(`  ✓ ${f}：已删除根级 canvas（${JSON.stringify(def.canvas).length} 字），节点/边/其它根键未变`);
}
