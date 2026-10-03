// test/storage-json.test.mjs — 存储层端到端验证：工作区 JSON 文件（无 SQLite）
// 用 esbuild 即时打包 src/adapter/storage.ts → 临时 mjs → 跑断言
import { build } from 'esbuild';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// 让 storage 的 process.cwd() 解析链落到临时目录（模拟"从工作区启动"）
const ROOT = process.cwd(); // 插件根目录（chdir 前先记下，入口路径要用）
const fakeWorkspace = mkdtempSync(join(tmpdir(), 'dsh-wf-test-'));
process.chdir(fakeWorkspace);

const OUT = join(fakeWorkspace, 'storage.test.bundle.mjs');
await build({
  entryPoints: [join(ROOT, 'src/adapter/storage.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile: OUT,
  external: ['@deepseek-ai/cordis', 'node:fs', 'node:path', 'node:url', 'node:os', 'node:process', 'node:sqlite'],
  logLevel: 'silent',
});

const { createStorage } = await import(pathToFileURL(OUT).href);
const storage = createStorage();

const info = await storage.describe();
console.log('[1] storage dir =', info.dir, '(source:', info.source + ')');
if (!info.dir.includes(join('.dag-flow', 'workflow'))) throw new Error('dir should contain .dag-flow/workflow');
if (!existsSync(info.dir)) throw new Error('dir should exist');

// 写 → 读 → 列
await storage.writeWorkflow('demo-flow', {
  name: 'demo-flow', version: 1, nodes: [
    { id: 'start', type: 'start', next: 'end' },
    { id: 'end', type: 'end' },
  ],
});
const back = await storage.readWorkflow('demo-flow');
console.log('[2] readWorkflow roundtrip =', back?.nodes?.length === 2 ? 'OK' : 'FAIL');
if (back?.nodes?.length !== 2) throw new Error('roundtrip failed');

// 磁盘上必须是可读 JSON
const raw = JSON.parse(readFileSync(join(info.dir, 'demo-flow.json'), 'utf8'));
console.log('[3] raw JSON on disk:', raw.name, '| pretty-printed:', raw.nodes ? 'yes' : 'no');

const list = await storage.listWorkflows();
console.log('[4] listWorkflows =', JSON.stringify(list));
if (!list.includes('demo-flow')) throw new Error('list should contain demo-flow');

// 运行记录
await storage.writeRunRecord('run-abc-1', { workflowName: 'demo-flow', status: 'success' });
const recs = await storage.listRunRecords('demo-flow');
const rec = await storage.readRunRecord('run-abc-1');
console.log('[5] runs:', JSON.stringify(recs), '| read:', rec?.status);
if (recs[0] !== 'run-abc-1' || rec?.status !== 'success') throw new Error('runs failed');

// 非法名拒绝
let rejected = false;
try { await storage.writeWorkflow('BAD NAME!', { name: 'BAD NAME!' }); } catch { rejected = true; }
console.log('[6] invalid name rejected:', rejected);
if (!rejected) throw new Error('invalid name should be rejected');

// 中文名（2026-10-01 起合法：src/name-rule.ts）
await storage.writeWorkflow('每日简报', { name: '每日简报', version: 1, nodes: [] });
const cn = await storage.readWorkflow('每日简报');
console.log('[7] chinese name roundtrip:', cn?.name);
if (cn?.name !== '每日简报') throw new Error('chinese name roundtrip failed');

console.log('\n✅ storage JSON 端到端全部通过');
