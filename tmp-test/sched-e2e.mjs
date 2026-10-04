// tmp-test/sched-e2e.mjs — 定时任务「真执行器」集成验证（2026-10-03 定时任务轮）
// 与 test/scheduler.test.mjs 的区别：那边全部依赖注入（假时钟 + 假执行器 + 内存 store）；
// 这边用**真的** storage / 真的 runWorkflow / 真的 .dag-flow/schedules.json，只把「到点」手动化：
//   ①在临时工作区建一个真工作流（start→log1→end）
//   ②upsert 一条 cron 定时 → 把 nextRunAt 改成 1 秒前（模拟到点）
//   ③跑一次真 tick → 应触发；等它跑完 → lastRun.status=success + .dag-flow/runs/ 真的有记录
//   ④紧接着再跑一次 tick → 不该重复触发（nextRunAt 已推进）
// 用法：node tmp-test/sched-e2e.mjs   （工作目录 = dag-flow 仓库根）
import { build } from 'esbuild';
import { mkdtempSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const WS = mkdtempSync(join(tmpdir(), 'df-sched-e2e-'));
process.chdir(WS);

const OUT = join(WS, 'sched-e2e.bundle.mjs');
await build({
  stdin: {
    contents: [
      "export * from './src/adapter/schedules.ts';",
      "export * from './src/adapter/scheduler.ts';",
      "export * from './src/adapter/storage.ts';",
      "export * from './src/adapter/running.ts';",
      "export * from './src/executor/run.ts';",
      "export * from './src/registry/builtin.ts';",
      "export * from './src/registry/external.ts';",
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', target: 'node20', outfile: OUT,
  external: ['@deepseek-ai/cordis', 'node:fs', 'node:fs/promises', 'node:path', 'node:url', 'node:os', 'node:process', 'node:sqlite', 'node:child_process'],
  logLevel: 'silent',
});

const M = await import(pathToFileURL(OUT).href);
const { upsertSchedule, listSchedules, patchSchedule, readSchedules, tickScheduler, createStorage, registerBuiltinNodes, WorkflowNodeRegistry, runWorkflow } = M;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m}（actual=${JSON.stringify(a)} expected=${JSON.stringify(b)}）`);

registerBuiltinNodes();
console.log('工作区 =', WS, '| 已注册节点 =', WorkflowNodeRegistry.list().length);

// ① 真工作流（用 next 线性链：开始 → 运行日志 → 结束）
const WF = '定时集成流程';
await createStorage().writeWorkflow(WF, {
  name: WF, version: 1,
  nodes: [
    { id: 'start', type: 'start', next: 'log1' },
    { id: 'log1', type: 'log', params: { message: '定时任务集成验证' }, next: 'end' },
    { id: 'end', type: 'end' },
  ],
});

// ② 配一条定时，并把 nextRunAt 拨到 1 秒前（模拟到点；不真等一分钟）
const item = await upsertSchedule({ workflow: WF, cron: '* * * * *' });
ok(item.id.startsWith('sch_'), `① 定时项已写入配置（${item.id}）`);
await patchSchedule(item.id, { nextRunAt: new Date(Date.now() - 1000).toISOString() });
const before = (await readSchedules()).file.items.find((x) => x.id === item.id);
ok(Date.parse(before.nextRunAt) <= Date.now(), '① nextRunAt 已被拨到过去（模拟到点）');

// ③ 真 tick：真执行器 + 真文件
console.log('\n== 真 tick ==');
const r = await tickScheduler();
eq(r.triggered.length, 1, '② 到点 → 真 tick 触发 1 次');
eq(r.skipped.length, 0, '② 没有被跳过');
eq(r.invalid.length, 0, '② 没有非法条目');
await Promise.all(r.inflight);
const after = (await readSchedules()).file.items.find((x) => x.id === item.id);
eq(after.lastRun?.status, 'success', '③ 真跑完 → lastRun.status=success');
ok(typeof after.lastRun?.durationMs === 'number', `③ 记下真实耗时（${after.lastRun?.durationMs}ms）`);
ok(!!after.lastRun?.runId, '③ 记下本次 runId');
ok(Date.parse(after.nextRunAt) > Date.now(), '③ 触发后 nextRunAt 推进到未来（下一分钟）');

// 运行记录落盘（.dag-flow/runs/）
const runsDir = join(WS, '.dag-flow', 'runs');
const runs = existsSync(runsDir) ? readdirSync(runsDir).filter((f) => f.endsWith('.json')) : [];
ok(runs.length >= 1, `④ 真实运行记录落盘 .dag-flow/runs/（${runs.length} 份）`);
if (runs.length) {
  const rec = JSON.parse(readFileSync(join(runsDir, runs[0]), 'utf8'));
  ok(rec?.summary?.status === 'success' || rec?.status === 'success', '④ 运行记录里 status=success');
}

// ④ 紧接着再 tick：不该重复触发
console.log('\n== 幂等（不重复触发）==');
const r2 = await tickScheduler();
eq(r2.triggered.length, 0, '⑤ 同一分钟再 tick → 不重复触发');
eq((await listSchedules(WF)).items.length, 1, '⑤ 配置里仍是 1 条（没有被写坏/重复）');

// ⑤ 禁用后不再触发
console.log('\n== 禁用开关 ==');
await patchSchedule(item.id, { enabled: false, nextRunAt: new Date(Date.now() - 1000).toISOString() });
const r3 = await tickScheduler();
eq(r3.triggered.length, 0, '⑥ enabled=false → 即使到点也不触发（用户可随时停用）');

console.log(`\n=== 定时任务真执行器集成：${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
