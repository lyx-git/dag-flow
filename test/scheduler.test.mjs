// test/scheduler.test.mjs — 定时调度器（scheduler.ts）：到点触发 / 不补跑 / skip 并发 / tick 永不崩
// 手法：esbuild stdin 入口把 scheduler + cron + running 打进同一 bundle；
//   全部外部依赖**注入**（假时钟 now()、内存 store、假执行器 run），所以不碰真实文件、不依赖真实时间。
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const WS = mkdtempSync(join(tmpdir(), 'df-sched-run-'));
process.chdir(WS);

const OUT = join(WS, 'scheduler.bundle.mjs');
await build({
  stdin: {
    contents: [
      "export * from './src/adapter/scheduler.ts';",
      "export * from './src/adapter/running.ts';",
      "export * from './src/adapter/cron.ts';",
      "export * from './src/adapter/schedules.ts';",
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', target: 'node20', outfile: OUT,
  external: ['@deepseek-ai/cordis', 'node:fs', 'node:fs/promises', 'node:path', 'node:url', 'node:os', 'node:process', 'node:sqlite', 'node:child_process'],
  logLevel: 'silent',
});

const { tickScheduler, startScheduler, schedulerInfo, __resetSchedulerInfo, __resetRunning, markRunning } = await import(pathToFileURL(OUT).href);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m}（actual=${JSON.stringify(a)} expected=${JSON.stringify(b)}）`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const silent = { info: () => {}, warn: () => {} };

/** 造一个可控环境：now 固定、store 在内存、执行器是桩 */
function makeEnv({ items, nowMs, runImpl, defs, running = [] }) {
  let file = { version: 1, items: items.map((x) => ({ ...x })) };
  const calls = [];
  const diffs = [];
  const env = {
    calls, diffs,
    get items() { return file.items; },
    item: (id) => file.items.find((x) => x.id === id),
    deps: {
      now: () => nowMs.value,
      logger: silent,
      read: async () => ({ file }),
      write: async (f) => { file = f; },
      patch: async (id, p) => { const it = file.items.find((x) => x.id === id); if (it) Object.assign(it, p); },
      loadDef: async (name) => (defs[name] ? { name, version: 1, nodes: [], ...defs[name] } : null),
      isRunning: (name) => running.includes(name),
      run: async (def, opts) => {
        calls.push({ name: def.name, opts });
        const r = runImpl ? await runImpl(def, opts) : { summary: { status: 'success', totalDurationMs: 12 } };
        return r;
      },
    },
  };
  return env;
}

const NOW = Date.parse('2026-10-04T01:00:00.000Z');
const PAST = new Date(NOW - 60_000).toISOString();
const FUTURE = new Date(NOW + 3600_000).toISOString();

// A. 未到点不触发
console.log('\n== A. 到点判据 ==');
{
  const nowMs = { value: NOW };
  const env = makeEnv({ items: [{ id: 's1', workflow: 'wf', cron: '0 9 * * *', enabled: true, nextRunAt: FUTURE }], nowMs, defs: { wf: {} } });
  const r = await tickScheduler(env.deps);
  eq(r.triggered.length, 0, 'A1. 未到点 → 不触发');
  eq(env.calls.length, 0, 'A2. 执行器一次都没被调用');
  eq(r.inflight.length, 0, 'A3. 没有执行中的 promise');
}

// B. 到点触发 + 独立 runId + 不交互 + inputs 透传
console.log('\n== B. 到点触发 ==');
{
  const nowMs = { value: NOW };
  const env = makeEnv({
    items: [{ id: 's1', workflow: 'wf', cron: '* * * * *', enabled: true, nextRunAt: PAST, inputs: { 主题: '每日' }, timeoutMs: 5000 }],
    nowMs, defs: { wf: {} },
  });
  const r = await tickScheduler(env.deps);
  eq(r.triggered.length, 1, 'B1. 到点 → 触发 1 次');
  eq(env.calls.length, 1, 'B2. 执行器被调用 1 次');
  eq(env.calls[0].opts.interactive, false, 'B3. interactive:false（无人值守；manual 节点自动通过）');
  eq(env.calls[0].opts.inputs.主题, '每日', 'B4. 定时项 inputs 透传给执行器');
  eq(env.calls[0].opts.timeoutMs, 5000, 'B5. timeoutMs 透传');
  ok(typeof env.calls[0].opts.runId === 'string' && env.calls[0].opts.runId.length > 0, 'B6. 每次触发带独立 runId（' + env.calls[0].opts.runId + '）');
  ok(Date.parse(env.item('s1').nextRunAt) > nowMs.value, 'B7. 触发后 nextRunAt 立刻推进到未来（防同一分钟重复触发）');
  await Promise.all(r.inflight);
  eq(env.item('s1').lastRun.status, 'success', 'B8. 跑完回写 lastRun.status=success');
  eq(env.item('s1').lastRun.durationMs, 12, 'B9. 回写耗时取自 summary.totalDurationMs');
  eq(env.item('s1').lastRun.runId, env.calls[0].opts.runId, 'B10. lastRun 记的就是这次 runId');
}

// C. 失败与异常
console.log('\n== C. 失败与异常 ==');
{
  const nowMs = { value: NOW };
  const env = makeEnv({
    items: [{ id: 's1', workflow: 'wf', cron: '* * * * *', enabled: true, nextRunAt: PAST }],
    nowMs, defs: { wf: {} },
    runImpl: async () => ({ summary: { status: 'failed', totalDurationMs: 33, error: { code: 'NODE_FAILED', message: '节点炸了' } } }),
  });
  const r = await tickScheduler(env.deps);
  await Promise.all(r.inflight);
  eq(env.item('s1').lastRun.status, 'failed', 'C1. 执行器报 failed → lastRun.status=failed');
  eq(env.item('s1').lastRun.error, '节点炸了', 'C2. 失败原因（summary.error.message）被记下');
  ok(Date.parse(env.item('s1').nextRunAt) > nowMs.value, 'C3. 失败不影响后续档期（nextRunAt 照常推进）');

  const env2 = makeEnv({
    items: [{ id: 's2', workflow: 'wf', cron: '* * * * *', enabled: true, nextRunAt: PAST }],
    nowMs, defs: { wf: {} },
    runImpl: async () => { throw new Error('执行器抛异常'); },
  });
  const r2 = await tickScheduler(env2.deps);
  await Promise.all(r2.inflight);
  eq(r2.triggered.length, 1, 'C4. 执行器抛异常时 tick 本身不崩（仍返回报告）');
  eq(env2.item('s2').lastRun.status, 'error', 'C5. 异常被记成 lastRun.status=error');
  ok(String(env2.item('s2').lastRun.error).includes('执行器抛异常'), 'C6. 异常消息落进 lastRun.error');
}

// D. skip 并发（用户拍板 B）
console.log('\n== D. 上一轮没跑完 → skip ==');
{
  const nowMs = { value: NOW };
  const env = makeEnv({
    items: [{ id: 's1', workflow: 'busy', cron: '* * * * *', enabled: true, nextRunAt: PAST }],
    nowMs, defs: { busy: {} }, running: ['busy'],
  });
  const r = await tickScheduler(env.deps);
  eq(r.triggered.length, 0, 'D1. 该工作流正在跑 → 本次不触发');
  eq(r.skipped.length, 1, 'D2. 记入 skipped');
  eq(env.calls.length, 0, 'D3. 执行器未被调用（不并发、不排队）');
  eq(env.item('s1').lastRun.status, 'skipped', 'D4. lastRun.status=skipped（面板可显示「本次跳过」）');
  ok(Date.parse(env.item('s1').nextRunAt) > nowMs.value, 'D5. 跳过后 nextRunAt 照常推进');
  __resetRunning();
}

// E. 不补跑（启动场景）
console.log('\n== E. dsh 重启不补跑（用户拍板 C）==');
{
  const nowMs = { value: NOW };
  const env = makeEnv({
    items: [{ id: 's1', workflow: 'wf', cron: '0 9 * * *', enabled: true, nextRunAt: new Date(NOW - 3 * 3600_000).toISOString() }],
    nowMs, defs: { wf: {} },
  });
  const r = await tickScheduler(env.deps, { catchUp: false });
  eq(r.triggered.length, 0, 'E1. 启动场景下过期项不触发（不补跑）');
  eq(env.calls.length, 0, 'E2. 执行器没被调用');
  ok(Date.parse(env.item('s1').nextRunAt) > nowMs.value, 'E3. 只把 nextRunAt 重算到未来（下一次照常）');
}

// F. 缺 nextRunAt / cron 非法 / 工作流不存在
console.log('\n== F. 异常配置 ==');
{
  const nowMs = { value: NOW };
  const env = makeEnv({
    items: [
      { id: 's1', workflow: 'wf', cron: '* * * * *', enabled: true },
      { id: 's2', workflow: 'wf', cron: '99 * * * *', enabled: true, nextRunAt: PAST },
      { id: 's3', workflow: 'gone', cron: '* * * * *', enabled: true, nextRunAt: PAST },
    ],
    nowMs, defs: { wf: {} },
  });
  const r = await tickScheduler(env.deps);
  eq(r.triggered.length, 0, 'F1. 缺 nextRunAt / cron 非法 / 工作流不存在 → 都不触发');
  ok(!!env.item('s1').nextRunAt, 'F2. 缺 nextRunAt 的条目被补算');
  eq(r.invalid.length, 2, 'F3. cron 非法与工作流不存在各记一条 invalid');
  ok(r.invalid.some((x) => String(x.reason).includes('不存在')), 'F4. 工作流不存在的提示说明「定时项保留」的语义');
}

// G. 多条并存 + 禁用 + 读失败
console.log('\n== G. 多条与容错 ==');
{
  const nowMs = { value: NOW };
  const env = makeEnv({
    items: [
      { id: 'a', workflow: 'wfA', cron: '* * * * *', enabled: true, nextRunAt: PAST },
      { id: 'b', workflow: 'wfB', cron: '* * * * *', enabled: false, nextRunAt: PAST },
      { id: 'c', workflow: 'wfC', cron: '* * * * *', enabled: true, nextRunAt: FUTURE },
    ],
    nowMs, defs: { wfA: {}, wfB: {}, wfC: {} },
  });
  const r = await tickScheduler(env.deps);
  eq(r.triggered.length, 1, 'G1. 只有「启用且到点」的那条触发');
  eq(r.triggered[0].workflow, 'wfA', 'G2. 触发的是 wfA');
  await Promise.all(r.inflight);
  const before = schedulerInfo().ticks;
  const broken = { ...env.deps, read: async () => { throw new Error('磁盘炸了'); } };
  const r2 = await tickScheduler(broken);
  eq(r2.triggered.length, 0, 'G3. 配置读不出来时 tick 返回空报告（不抛）');
  eq(schedulerInfo().ticks, before + 1, 'G4. 心跳照常计数（面板能看出调度器还活着）');
}

// H. 启动/停止与心跳
console.log('\n== H. startScheduler 与心跳 ==');
{
  __resetSchedulerInfo();
  const info0 = schedulerInfo();
  eq(info0.running, false, 'H1. 启动前 running=false（面板显示「调度器未运行」）');
  const nowMs = { value: NOW };
  const env = makeEnv({ items: [], nowMs, defs: {} });
  const s = startScheduler(env.deps);
  eq(s.registered, true, 'H2. startScheduler 返回 registered=true');
  eq(typeof s.dispose, 'function', 'H3. 返回 disposer（挂 ctx.effect）');
  eq(schedulerInfo().running, true, 'H4. 心跳 running=true');
  await sleep(30);
  s.dispose();
  eq(schedulerInfo().running, false, 'H5. dispose 后 running=false（且已 clearInterval，不会拖住进程）');
  eq(schedulerInfo().tickMs, 20000, 'H6. tick 间隔 20s（面板文案用）');
}

console.log(`\n=== scheduler 定时调度器：${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
