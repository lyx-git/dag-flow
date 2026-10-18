// test/subflow-serial.test.mjs — 同一运行目录里并发调用同一个子工作流 ⇒ 串行（2026-10-20 用户要求）
//
// 用户原话：「子工作流如果被多个父工作流并发执行了，需要解决一下这个问题」
// 契约：
//   ① 同一个 key（`<runDir>|<子工作流名>`）的多个调用**严格串行**，后一个必须等前一个结束才进；
//   ② 不同 key（不同运行目录 / 不同子工作流）**互不排队**，仍可并行；
//   ③ 前一个失败不会卡死队列（后一个照常拿到机会）；④ 队列空了会自己从 Map 里消失。
// 跑法：node test/subflow-serial.test.mjs
import { tmpRoot } from './_tmp-root.mjs';
import './_isolate-home.mjs';
import { build } from 'esbuild';
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
const OUT = join(tmpRoot('subflow-serial-'), 'control.bundle.mjs');
await build({
  entryPoints: [join(ROOT, 'src/registry/nodes/control.ts')], bundle: true, format: 'esm', platform: 'node',
  outfile: OUT, logLevel: 'silent',
  external: ['@deepseek-ai/cordis', 'node:fs', 'node:fs/promises', 'node:path', 'node:url', 'node:os', 'node:process',
    'node:sqlite', 'node:child_process', 'node:crypto', 'node:stream', 'node:stream/promises', 'node:zlib',
    'node:http', 'node:https', 'node:events', 'node:buffer', 'node:util', 'node:timers', 'node:async_hooks'],
});
const { runSubflowSerialized } = await import(pathToFileURL(OUT).href);

console.log('\n== ① 同一 key：严格串行（不重叠） ==');
{
  const events = [];
  let active = 0;
  let maxActive = 0;
  const job = (id, ms) => runSubflowSerialized('run-1|子工作流', async () => {
    active++; maxActive = Math.max(maxActive, active);
    events.push('start:' + id);
    await sleep(ms);
    events.push('end:' + id);
    active--;
    return id;
  });
  const r = await Promise.all([job('a', 40), job('b', 10), job('c', 10)]);
  t('三个调用都完成且顺序返回', r.join(',') === 'a,b,c', r.join(','));
  t('任何时刻只有一个在跑（maxActive=1）', maxActive === 1, String(maxActive));
  t('事件序列是严格 start→end 交替', events.join(',') === 'start:a,end:a,start:b,end:b,start:c,end:c', events.join(','));
}

console.log('\n== ② 不同 key：仍可并行 ==');
{
  let active = 0;
  let maxActive = 0;
  const job = (key) => runSubflowSerialized(key, async () => {
    active++; maxActive = Math.max(maxActive, active);
    await sleep(30);
    active--;
  });
  await Promise.all([job('run-A|子工作流'), job('run-B|子工作流'), job('run-A|另一个子工作流')]);
  t('三个不同 key 同时跑（maxActive=3）', maxActive === 3, String(maxActive));
}

console.log('\n== ③ 前一个失败不卡死队列 ==');
{
  const done = [];
  const bad = runSubflowSerialized('run-2|子', async () => { throw new Error('boom'); }).catch((e) => 'caught:' + e.message);
  const good = runSubflowSerialized('run-2|子', async () => { done.push('good'); return 'ok'; });
  const [b, g] = await Promise.all([bad, good]);
  t('失败被调用方捕获（不冒泡成未处理拒绝）', b === 'caught:boom', String(b));
  t('排在后面的照常执行', g === 'ok' && done.length === 1, String(g));
}

console.log(`\n=== subflow-serial: ${pass} passed, ${fail} failed ===`);
if (fail) { console.error('失败项：' + failures.join(' / ')); process.exit(1); }
