// test/run-artifacts.test.mjs — runs / images / logs 三类产物也归到「一次运行一个目录」规则下（2026-10-18 用户要求）
//
// 用户口径：「images/<名>/，runs/<名>/，tmp/logs/，这三个目录也要按照 tmp/<名>/<runId>/ 这个目录规则移动」
// 实现口径（写入搬、读取兼容；绝不丢历史）：
//   ① 运行记录写 `<runDir>/run.json`（`tmp/<名>/<runId>/run.json`），列表/读取会并上旧 `runs/<名>/` 里的历史；
//   ② 图片清单合并「历史库 images/<名>/」+「最近各次运行的 tmp/<名>/*/images/」，同名取新；
//   ③ 本次运行的日志额外追加到 `<runDir>/logs/run.log`，全局 tmp/logs/ 行为不变。
// 跑法：node test/run-artifacts.test.mjs
import { tmpRoot } from './_tmp-root.mjs';
import './_isolate-home.mjs';
import { build } from 'esbuild';
import { existsSync, mkdirSync, readFileSync, writeFileSync, utimesSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name); console.error(`  ✗ ${name}${detail ? '  —  ' + detail : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ROOT = resolve(import.meta.dirname, '..');
const HOME = tmpRoot('run-artifacts-');
process.env.DSH_HOME = HOME;
const DF = join(HOME, '.dag-flow');

const ENTRY = join(tmpRoot('run-artifacts-entry-'), 'entry.ts');
writeFileSync(ENTRY, [
  `export { createStorage } from ${JSON.stringify(join(ROOT, 'src/adapter/storage.ts').replace(/\\/g, '/'))};`,
  `export { listImageFiles } from ${JSON.stringify(join(ROOT, 'src/adapter/image-inputs.ts').replace(/\\/g, '/'))};`,
  `export { wrapLoggerForRun } from ${JSON.stringify(join(ROOT, 'src/executor/run.ts').replace(/\\/g, '/'))};`,
  '',
].join('\n'));
const OUT = join(ROOT, 'tmp-test', 'build');
mkdirSync(OUT, { recursive: true });
const BUNDLE = join(OUT, 'run-artifacts.bundle.mjs');
await build({
  entryPoints: [ENTRY], bundle: true, format: 'esm', platform: 'node', target: 'node20',
  outfile: BUNDLE,
  external: ['@deepseek-ai/cordis', 'node:fs', 'node:fs/promises', 'node:path', 'node:url', 'node:os',
    'node:process', 'node:sqlite', 'node:child_process', 'node:crypto', 'node:stream', 'node:stream/promises',
    'node:zlib', 'node:http', 'node:https', 'node:events', 'node:buffer', 'node:util', 'node:timers', 'node:async_hooks'],
  logLevel: 'silent',
});
const { createStorage, listImageFiles, wrapLoggerForRun } = await import(pathToFileURL(BUNDLE).href);
const st = createStorage();

console.log('\n== ① 运行记录落 <runDir>/run.json（tmp/<名>/<runId>/），不再写 runs/<名>/ ==');
{
  await st.writeRunRecord('run-111-aaa', { runId: 'run-111-aaa', workflowName: '工作流A', status: 'success' });
  const f = join(DF, 'tmp', '工作流A', 'run-111-aaa', 'run.json');
  t('文件在 tmp/<名>/<runId>/run.json', existsSync(f), f);
  t('内容可解析且 runId 对得上', existsSync(f) && JSON.parse(readFileSync(f, 'utf8')).runId === 'run-111-aaa');
  t('旧位置 runs/<名>/<runId>.json 不再生成', !existsSync(join(DF, 'runs', '工作流A', 'run-111-aaa.json')));
}

console.log('\n== ② 列表/读取并上 tmp 里的记录（GUI 运行历史不丢） ==');
{
  const ids = await st.listRunRecords('工作流A');
  t('listRunRecords 含新记录', ids.includes('run-111-aaa'), ids.join(','));
  const rec = await st.readRunRecord('run-111-aaa');
  t('readRunRecord 读得到（走缓存/临时目录）', rec && rec.workflowName === '工作流A', JSON.stringify(rec ?? null).slice(0, 80));
  const all = await st.listRunRecords();
  t('不带工作流的全量列表也含它', all.includes('run-111-aaa'), all.join(','));
}

console.log('\n== ③ 旧 runs/<名>/ 不再兼容（用户 2026-10-20「旧位置数据都删了」） ==');
{
  const legacyDir = join(DF, 'runs', '工作流B');
  mkdirSync(legacyDir, { recursive: true });
  writeFileSync(join(legacyDir, 'run-001-old.json'), JSON.stringify({ runId: 'run-001-old', workflowName: '工作流B', status: 'failed' }), 'utf8');
  const ids = await st.listRunRecords('工作流B');
  t('★列表里不出现旧记录', !ids.includes('run-001-old'), ids.join(','));
  const rec = await st.readRunRecord('run-001-old');
  t('★按 runId 也读不到旧记录', rec === null, JSON.stringify(rec ?? null).slice(0, 80));
}

console.log('\n== ④ 图片清单合并 images/<名>/ 与 tmp/<名>/*/images/ ==');
{
  const libDir = join(DF, 'images', '工作流C');      // 旧图片库：2026-10-20 起**不再参与**清单
  const runImg = join(DF, 'tmp', '工作流C', 'run-222', 'images');
  const otherRun = join(DF, 'tmp', '工作流C', 'run-333', 'images');
  for (const d of [libDir, runImg, otherRun]) mkdirSync(d, { recursive: true });
  writeFileSync(join(libDir, '库里的旧图.png'), Buffer.from([1]));
  writeFileSync(join(runImg, '旧图.png'), Buffer.from([2, 3]));
  writeFileSync(join(runImg, '新图.png'), Buffer.from([4]));
  writeFileSync(join(otherRun, '别的图.png'), Buffer.from([5]));
  const now = Date.now() / 1000;
  utimesSync(join(runImg, '旧图.png'), now - 10, now - 10);
  utimesSync(join(runImg, '新图.png'), now - 20, now - 20);
  utimesSync(join(otherRun, '别的图.png'), now - 30, now - 30);
  const list = await listImageFiles('工作流C');
  const names = list.map((x) => x.name);
  t('各次运行目录里的三张图都在', names.length === 3 && names.includes('新图.png') && names.includes('别的图.png'), names.join(','));
  t('按 mtime 倒序（新的在前）', names[0] === '旧图.png' && names[1] === '新图.png', names.join(','));
  t('★旧 images/<名>/ 里的图不再出现（不兼容旧位置）', !names.includes('库里的旧图.png'), names.join(','));
  t('别的工作流的运行目录不会被列进来', (await listImageFiles('工作流D')).length === 0);
}

console.log('\n== ⑤ 本次运行的日志额外落 <runDir>/logs/run.log（base logger 照常收到） ==');
{
  const runDir = join(DF, 'tmp', '工作流E', 'run-444');
  mkdirSync(runDir, { recursive: true });
  const seen = [];
  const base = { info: (m) => seen.push('info:' + m), warn: (m) => seen.push('warn:' + m), error: (m) => seen.push('error:' + m) };
  const log = wrapLoggerForRun(base, runDir);
  log.info('开始执行', { name: '工作流E' });
  log.warn('有个小问题');
  log.error('失败了', { node: 'py1' });
  await sleep(120);
  const f = join(runDir, 'logs', 'run.log');
  t('run.log 已生成', existsSync(f), f);
  const text = existsSync(f) ? readFileSync(f, 'utf8') : '';
  t('三个级别都写进去了', text.includes('[INFO] 开始执行') && text.includes('[WARN] 有个小问题') && text.includes('[ERROR] 失败了'));
  t('meta 以 JSON 追加在后面', text.includes('"name":"工作流E"') && text.includes('"node":"py1"'));
  t('原 logger 仍然收到全部三条', seen.length === 3, seen.join(' / '));
}

console.log(`\n=== run-artifacts: ${pass} passed, ${fail} failed ===`);
if (fail) { console.error('失败项：' + failures.join(' / ')); process.exit(1); }
