// test/run-progress.test.mjs — 「运行进度 → 节点状态」映射单测（2026-10-03 用户需求：
//   画布每个节点都要有 待运行/运行中/完成/失败，按运行路径依次显示，不要最后一次性显示）
// 手段：esbuild 即时打包 src/client/runProgress.ts → 临时 mjs → 断言（纯函数，无 React/无 IO/无 CDP）
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}（actual=${JSON.stringify(a)} expected=${JSON.stringify(b)}）`);

const dir = mkdtempSync(join(tmpdir(), 'df-run-progress-'));
const OUT = join(dir, 'runProgress.mjs');
await build({
  entryPoints: ['src/client/runProgress.ts'],
  bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent',
});
const { progressToStatusMap, isTransientStatus } = await import(pathToFileURL(OUT).href);

const IDS = ['start', 'cfg', 'search', 'ai', 'end'];

console.log('== A. 起跑瞬间（还没有任何结果）==');
{
  const m = progressToStatusMap(IDS, {});
  eq(Object.keys(m).length, 5, 'A1. 每个节点都有状态（不再是空白）');
  eq(m.start.status, 'pending', 'A2. 一律 pending=待运行');
  eq(progressToStatusMap(IDS, { results: null, running: null }).end.status, 'pending', 'A3. results/running 为 null 也不炸');
}

console.log('== B. 运行路径依次点亮 ==');
{
  // start 完成、cfg 正在跑、其余还没轮到
  const m = progressToStatusMap(IDS, { results: { start: { status: 'success', durationMs: 30 } }, running: ['cfg'] });
  eq(m.start.status, 'success', 'B1. 已完成的 → success');
  eq(m.cfg.status, 'running', 'B2. 正在执行的 → running（画布显示「运行中…」）');
  eq(m.search.status, 'pending', 'B3. 还没轮到的 → pending（「待运行」）');
  eq(m.ai.status, 'pending', 'B4. 下游同样 pending');
  eq(m.start.durationMs, 30, 'B5. 耗时透传（徽标要显示 ms）');
}

console.log('== C. 失败 / 跳过 / 容错 / 循环次数 透传 ==');
{
  const m = progressToStatusMap(IDS, {
    results: {
      start: { status: 'success', durationMs: 5 },
      cfg: { status: 'failed', durationMs: 7, error: { code: 'FETCH_FAILED', message: 'HTTP 403' } },
      search: { status: 'failed', durationMs: 9, tolerated: true, error: { code: 'X', message: 'y' } },
      ai: { status: 'skipped' },
      end: { status: 'success', durationMs: 3, out: { count: 7 } },
    },
  });
  eq(m.cfg.status, 'failed', 'C1. 失败状态保留');
  eq(m.cfg.error.code, 'FETCH_FAILED', 'C2. 错误码透传（悬浮卡要看）');
  eq(m.search.tolerated, true, 'C3. 容错标记透传');
  eq(m.ai.status, 'skipped', 'C4. 跳过状态保留');
  eq(m.end.count, 7, 'C5. loop/汇总的 out.count 透传（徽标「循环 N 次」）');
  eq(m.end.out, { count: 7 }, 'C6. out 整体透传（悬浮卡展示输出）');
}

console.log('== D. 边界 ==');
{
  const m = progressToStatusMap(IDS, { results: { start: { status: 'success' }, 不存在的节点: { status: 'success' } } });
  ok(!('不存在的节点' in m), 'D1. def 里没有的 id 不输出（画布不会渲染幽灵状态）');
  // 同一 id 既有结果又在 running（宿主的 running 移除晚一帧）→ 以结果为准
  const m2 = progressToStatusMap(['a'], { results: { a: { status: 'success' } }, running: ['a'] });
  eq(m2.a.status, 'success', 'D2. 结果优先于 running（避免刚完成又显示运行中）');
  // 没有 status 字段的结果项按未完成处理
  const m3 = progressToStatusMap(['a'], { results: { a: {} } });
  eq(m3.a.status, 'pending', 'D3. 结果项缺 status → 仍算 pending');
  eq(progressToStatusMap([], {}), {}, 'D4. 空节点列表 → 空映射');
}

console.log('== E. 过程态判定 ==');
{
  ok(isTransientStatus('pending') && isTransientStatus('running'), 'E1. pending/running 是过程态');
  ok(!isTransientStatus('success') && !isTransientStatus('failed') && !isTransientStatus('skipped'), 'E2. 终态不是过程态');
  ok(!isTransientStatus(undefined), 'E3. undefined 不是过程态');
}

console.log(`\n=== runProgress 运行进度映射：${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
