// test/sessions.test.mjs — 会话读取层回归（2026-09-27 sessions.v3 布局漂移修复 + 命名解耦；2026-10-01 v4 + 多帧 zstd；
// 2026-10-02 会话标题提取：listSessions 返回首条 user 消息摘要 + mtime + 按最后活动倒序）
// 锁定：①新文件名 session.v4.jsonl.zstd 可读；②v3 兼容；③旧 session.jsonl.zstd 兼容；
// ④工作区目录名转义漂移不影响正确性（sessionId 全局唯一，全盘扫描兜底）；
// ⑤多帧追加式 zstd 逐帧解压；⑥标题=首条 user 消息（≤40 字截断）；⑦mtime 字段；⑧按最后活动倒序。
// 手段：esbuild 即时打包 src/adapter/sessions.ts → 临时 mjs → fixture 目录断言。
import { build } from 'esbuild';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { zstdCompressSync } from 'node:zlib';

const ROOT = process.cwd();
const fixture = mkdtempSync(join(tmpdir(), 'dag-flow-sessions-'));
const dshRoot = join(fixture, '.dsh');
const sessionsRoot = join(dshRoot, 'sessions');

// fixture 五形态：v4 多帧 / v3 单帧 / 旧明文 / 旧转义目录 / 超长首条消息（标题截断）
const wsV4 = join(sessionsRoot, '--D-workspace-pluginspace--', 'session-v4');
mkdirSync(wsV4, { recursive: true });
// 多帧 + 事件流行形状（2026-10-01 真机实测）：帧 1 = session header；帧 2 = user/assistant 消息事件行
const frame1 = Buffer.from(JSON.stringify({ type: 'session', version: 4, id: 'session-v4' }), 'utf8');
const frame2 = Buffer.from([
  JSON.stringify({ type: 'step/start', seq: 6, data: { turn: 1, step: 1 } }),
  JSON.stringify({ type: 'user/message', seq: 7, data: { content: [{ type: 'text', text: 'hello v4 event' }], role: 'user', id: 'm1' } }),
  JSON.stringify({ type: 'assistant/message', seq: 8, data: { content: [{ type: 'text', text: 'hi from assistant event' }], role: 'assistant', id: 'm2' } }),
  JSON.stringify({ type: 'tool/call', seq: 9, data: { tool: 'x' } }),
  '',
].join('\n'), 'utf8');
const frame3 = Buffer.from(JSON.stringify({ type: 'user/message', seq: 10, data: { content: [{ type: 'text', text: 'tail from frame3' }], role: 'user', id: 'm3' } }), 'utf8');
const v4MultiFrame = Buffer.concat([zstdCompressSync(frame1), zstdCompressSync(frame2), zstdCompressSync(frame3)]);
writeFileSync(join(wsV4, 'session.v4.jsonl.zstd'), v4MultiFrame);

const wsV3 = join(sessionsRoot, '--D-workspace-pluginspace--', 'session-abc');
mkdirSync(wsV3, { recursive: true });
const jsonl = [
  JSON.stringify({ role: 'user', content: 'hello v3' }),
  JSON.stringify({ role: 'assistant', content: 'hi there' }),
  '',
].join('\n');
writeFileSync(join(wsV3, 'session.v3.jsonl.zstd'), zstdCompressSync(Buffer.from(jsonl, 'utf8')));

const wsLegacy = join(sessionsRoot, '--legacy~5Cws--', 'session-old');
mkdirSync(wsLegacy, { recursive: true });
writeFileSync(join(wsLegacy, 'session.jsonl.zstd'), Buffer.from(JSON.stringify({ role: 'user', content: 'legacy plain' }), 'utf8'));

// 标题截断夹具：首条 user 消息 76 个汉字 → 标题应截到 40 字 + …
const wsLong = join(sessionsRoot, '--D-workspace-pluginspace--', 'session-long');
mkdirSync(wsLong, { recursive: true });
const longText = '这是一条特别长的首条用户消息用来验证标题截断逻辑是否正确落在四十个汉字处'.repeat(2);
writeFileSync(join(wsLong, 'session.v3.jsonl.zstd'), zstdCompressSync(Buffer.from(JSON.stringify({ role: 'user', content: longText }), 'utf8')));

// ★ session/title 事件夹具（2026-10-02 用户需求：DSH 重命名/LLM 自动起名的会话名要优先显示）：
// fallback 标题（seq 12）在前、重命名标题（seq 20）在后——最终名应取 seq 大者「我会话的重命名标题」
const wsTitled = join(sessionsRoot, '--D-workspace-pluginspace--', 'session-titled');
mkdirSync(wsTitled, { recursive: true });
const titledFrames = Buffer.concat([
  zstdCompressSync(Buffer.from(JSON.stringify({ type: 'session', version: 4, id: 'session-titled' }), 'utf8')),
  zstdCompressSync(Buffer.from(JSON.stringify({ type: 'user/message', seq: 10, data: { content: [{ type: 'text', text: '初始消息内容作为后备标题' }], role: 'user', id: 'm1' } }), 'utf8')),
  zstdCompressSync(Buffer.from(JSON.stringify({ type: 'session/title', seq: 12, data: { title: '初始消息内容作为后备标题'.slice(0, 10), messageSeqs: [10], source: { kind: 'fallback' } } }), 'utf8')),
  zstdCompressSync(Buffer.from(JSON.stringify({ type: 'session/title', seq: 20, data: { title: '我会话的重命名标题', messageSeqs: [10], source: { kind: 'user' } } }), 'utf8')),
]);
writeFileSync(join(wsTitled, 'session.v4.jsonl.zstd'), titledFrames);

// ★ 必须在 import bundle 前设 DSH_HOME（sessions.ts 模块顶层常量走 dshHome()）
process.env.DSH_HOME = dshRoot;

const OUT = join(fixture, 'sessions.bundle.mjs');
await build({
  entryPoints: [join(ROOT, 'src/adapter/sessions.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile: OUT,
  logLevel: 'silent',
});
const { listSessions, readSessionContent } = await import(pathToFileURL(OUT).href);

let pass = 0, fail = 0;
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

// 1. 列会话：v4/v3/旧文件名/长标题夹具都能被发现（4 个）
const all = await listSessions();
t('S1 v4+v3+旧文件名+长标题+title事件夹具都能列出（5 个会话）', Array.isArray(all) && all.length === 5, JSON.stringify(all));

// 2. 读 v4 会话（多帧 zstd + 事件流行：消息包在 data.content 数组，非 message 事件跳过）
const cV4 = await readSessionContent('session-v4', 5, 'D:\\workspace\\pluginspace');
t('S2 v4 多帧 + 事件流可读（跨帧拼接、data.content 提取、tool/call 跳过）', cV4 !== null && cV4.includes('hello v4 event') && cV4.includes('hi from assistant event') && cV4.includes('tail from frame3') && !cV4.includes('tool'), JSON.stringify(cV4)?.slice(0, 160));

// 3. 读 v3 会话（zstd + JSONL 解析 + 新版目录转义 : \ → -）
const c1 = await readSessionContent('session-abc', 5, 'D:\\workspace\\pluginspace');
t('S3 v3 文件名 + 新版目录转义可读', c1 !== null && c1.includes('hello v3') && c1.includes('hi there'), JSON.stringify(c1)?.slice(0, 120));

// 4. 旧文件名 + 旧转义目录可读（未压缩明文兜底分支）
const c2 = await readSessionContent('session-old', 5, 'legacy\\ws');
t('S4 旧文件名 + 旧转义目录可读（明文兜底）', c2 !== null && c2.includes('legacy plain'), JSON.stringify(c2)?.slice(0, 120));

// 5. 命名解耦：workspace 传错/转义不匹配时全盘扫描仍按 sessionId 命中
const c3 = await readSessionContent('session-abc', 5, '完全无关的工作区');
t('S5 workspace 名对不上 → 全盘扫描兜底命中', c3 !== null && c3.includes('hello v3'), JSON.stringify(c3)?.slice(0, 120));

// 6. limit 生效（只取最后 N 条）
const c4 = await readSessionContent('session-abc', 1, 'D:\\workspace\\pluginspace');
t('S6 limit=1 只取最后 1 条', c4 !== null && !c4.includes('hello v3') && c4.includes('hi there'), JSON.stringify(c4));

// 7. v4 会话 limit 也跨帧生效（最后 1 条 = frame3 的事件消息）
const cV4b = await readSessionContent('session-v4', 1, 'D:\\workspace\\pluginspace');
t('S7 v4 limit=1 跨帧取尾条', cV4b !== null && cV4b.includes('tail from frame3') && !cV4b.includes('frame2'), JSON.stringify(cV4b));

// 8. 不存在的会话 → null（不抛错）
const c5 = await readSessionContent('no-such-session', 5);
t('S8 不存在的会话 → null', c5 === null);

// 9. 会话标题（2026-10-02 用户需求：下拉里全是 session id 分不清）——首条 user 消息摘要
const byId = new Map((all ?? []).map((s) => [s.id, s]));
t('S9a v4 会话标题=首条 user 消息摘要', byId.get('session-v4')?.name === 'hello v4 event', JSON.stringify(byId.get('session-v4')));
t('S9b v3 会话标题', byId.get('session-abc')?.name === 'hello v3', JSON.stringify(byId.get('session-abc')));
t('S9c 旧明文会话标题', byId.get('session-old')?.name === 'legacy plain', JSON.stringify(byId.get('session-old')));
t('S9d 超长首条消息截断 40 字 + …', byId.get('session-long')?.name === longText.slice(0, 40) + '…', JSON.stringify(byId.get('session-long')?.name));
t('S9e mtime 字段存在（ISO 串）', typeof byId.get('session-abc')?.mtime === 'string' && !Number.isNaN(Date.parse(byId.get('session-abc')?.mtime ?? '')));
// ★ session/title 事件优先：重命名标题（seq 20）应压过 fallback 标题（seq 12）——用户在 DSH 里改的会话名直接可用
t('S9f session/title 事件优先且取 seq 最大者', byId.get('session-titled')?.name === '我会话的重命名标题', JSON.stringify(byId.get('session-titled')));

// 10. 排序：按最后活动时间倒序（把 legacy 会话 mtime 设到未来 → 应排最前）
const legacyFile = join(wsLegacy, 'session.jsonl.zstd');
const future = new Date(Date.now() + 60_000);
utimesSync(legacyFile, future, future);
const sorted = await listSessions();
t('S10 按最后活动倒序（最近会话排最前）', (sorted ?? [])[0]?.id === 'session-old', JSON.stringify((sorted ?? []).map((s) => s.id)));

console.log(`\n=== sessions: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
