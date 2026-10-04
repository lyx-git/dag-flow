// test/schedules.test.mjs — 定时任务配置存储（schedules.ts）+ 共享运行登记（running.ts）
// 手法：esbuild 用 stdin 入口把 schedules/running/cron 打进**同一个** bundle（共享模块实例，
//   这样 markRunning 的效果能被 listSchedules 看到），跑在临时工作区里（chdir 后 storage 解析到它）。
import { build } from 'esbuild';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const WS = mkdtempSync(join(tmpdir(), 'df-sched-'));
process.chdir(WS);

const OUT = join(WS, 'schedules.bundle.mjs');
await build({
  stdin: {
    contents: [
      "export * from './src/adapter/schedules.ts';",
      "export * from './src/adapter/running.ts';",
      "export * from './src/adapter/cron.ts';",
      "export * from './src/adapter/storage.ts';",
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', target: 'node20', outfile: OUT,
  external: ['@deepseek-ai/cordis', 'node:fs', 'node:fs/promises', 'node:path', 'node:url', 'node:os', 'node:process', 'node:sqlite', 'node:child_process'],
  logLevel: 'silent',
});

const M = await import(pathToFileURL(OUT).href);
const {
  readSchedules, writeSchedules, listSchedules, upsertSchedule, deleteSchedule,
  renameScheduleWorkflow, patchSchedule, schedulesPath, newScheduleId,
  markRunning, unmarkRunning, isWorkflowRunning, __resetRunning, createStorage,
} = M;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m}（actual=${JSON.stringify(a)} expected=${JSON.stringify(b)}）`);
const throwsAsync = async (fn, needle) => {
  try { await fn(); return { threw: false }; }
  catch (e) { const msg = String(e && e.message ? e.message : e); return { threw: true, msg, hit: !needle || msg.includes(needle) }; }
};

const file = await schedulesPath();
console.log('schedules 路径 =', file);
ok(file.endsWith(join('.dag-flow', 'schedules.json')), '配置文件落在 <工作区>/.dag-flow/schedules.json（与 workflow/ 同级）');

// A. 初始状态
console.log('\n== A. 初始与落盘 ==');
{
  const r = await readSchedules();
  eq(r.file.items.length, 0, 'A1. 文件不存在时读为空列表');
  eq(r.error, undefined, 'A2. 文件不存在不算错误（不报 warning）');
  const wf = createStorage();
  await wf.writeWorkflow('甲流程', { name: '甲流程', version: 1, nodes: [{ id: 'start', type: 'start', next: 'end' }, { id: 'end', type: 'end' }] });
  const it = await upsertSchedule({ workflow: '甲流程', cron: '0 9 * * 1-5' });
  ok(it.id.startsWith('sch_'), 'A3. 新建返回 sch_ 前缀 id（' + it.id + '）');
  eq(it.enabled, true, 'A4. 新建默认启用');
  eq(it.concurrency, 'skip', 'A5. 并发策略固定为 skip（用户拍板 B）');
  ok(!!it.nextRunAt && Date.parse(it.nextRunAt) > Date.now(), 'A6. 新建即写入未来的 nextRunAt（' + it.nextRunAt + '）');
  ok(existsSync(file), 'A7. 配置文件已落盘');
  const disk = JSON.parse(readFileSync(file, 'utf8'));
  eq(disk.items.length, 1, 'A8. 磁盘结构 { version, items }，1 条');
  eq(disk.version, 1, 'A9. version=1');
  ok(!readdirSync(join(WS, '.dag-flow')).some((f) => f.endsWith('.tmp')), 'A10. 原子写不留 .tmp 残留（tmp+rename）');
}

// B. cron 非法 / 缺 workflow —— 拒绝且不落盘
console.log('\n== B. 写入前校验（不落盘）==');
{
  const before = (await readSchedules()).file.items.length;
  for (const [cron, label] of [['99 * * * *', '越界'], ['*/0 * * * *', '步长 0'], ['0 9 * * 1-5 extra', '6 字段'], ['0 9 * * L', '不支持的 L']]) {
    const r = await throwsAsync(() => upsertSchedule({ workflow: '甲流程', cron }), '');
    ok(r.threw, `B. ${label}的 cron 被拒绝（${r.msg ?? '未抛错'}）`);
  }
  const r2 = await throwsAsync(() => upsertSchedule({ cron: '0 9 * * *' }), 'workflow');
  ok(r2.threw && r2.hit, 'B. 缺 workflow 被拒绝且消息点名 workflow');
  eq((await readSchedules()).file.items.length, before, 'B. 以上失败写入都没有落盘（条数不变）');
}

// C. 更新 / 列表过滤 / orphan / running 派生
console.log('\n== C. 更新、过滤与派生字段 ==');
{
  const first = (await readSchedules()).file.items[0];
  const upd = await upsertSchedule({ id: first.id, workflow: '甲流程', cron: '*/30 * * * *', enabled: false });
  eq((await readSchedules()).file.items.length, 1, 'C1. 带 id 的写入是更新而不是新增');
  eq(upd.cron, '*/30 * * * *', 'C2. cron 已更新');
  eq(upd.enabled, false, 'C3. enabled 已更新');
  const wf = createStorage();
  await wf.writeWorkflow('乙流程', { name: '乙流程', version: 1, nodes: [{ id: 'start', type: 'start', next: 'end' }, { id: 'end', type: 'end' }] });
  await upsertSchedule({ workflow: '乙流程', cron: '0 8 * * *' });
  await upsertSchedule({ workflow: '丙不存在', cron: '0 7 * * *' });
  const all = await listSchedules();
  eq(all.items.length, 3, 'C4. 列表默认返回全部 3 条');
  eq((await listSchedules('甲流程')).items.length, 1, 'C5. ?workflow= 过滤生效');
  const orphan = all.items.find((x) => x.workflow === '丙不存在');
  eq(orphan?.orphan, true, 'C6. 工作流不存在 → orphan=true（提示用，不自动删）');
  eq(all.items.find((x) => x.workflow === '甲流程')?.orphan, false, 'C7. 工作流存在 → orphan=false');
  __resetRunning();
  markRunning('乙流程');
  const withRun = await listSchedules();
  eq(withRun.items.find((x) => x.workflow === '乙流程')?.running, true, 'C8. 运行中 → running=true（派生自共享登记）');
  eq(withRun.items.find((x) => x.workflow === '甲流程')?.running, false, 'C9. 未运行 → running=false');
  unmarkRunning('乙流程');
  eq(isWorkflowRunning('乙流程'), false, 'C10. 取消登记后 isWorkflowRunning=false');
}

// D. lastRun 回写 / 下次时间过期预览
console.log('\n== D. 回写与预览 ==');
{
  const it = (await readSchedules()).file.items[0];
  await patchSchedule(it.id, { lastRun: { at: new Date().toISOString(), status: 'success', durationMs: 41230, runId: 'run_x' } });
  const back = (await readSchedules()).file.items.find((x) => x.id === it.id);
  eq(back?.lastRun?.status, 'success', 'D1. patchSchedule 回写 lastRun.status');
  eq(back?.lastRun?.durationMs, 41230, 'D2. 回写 durationMs');
  // 把 nextRunAt 改成过去 → 列表给一个新鲜的下次时间（不落盘）
  await patchSchedule(it.id, { nextRunAt: new Date(Date.now() - 86400_000).toISOString() });
  const listed = (await listSchedules()).items.find((x) => x.id === it.id);
  ok(Date.parse(listed.nextRunAt) > Date.now(), 'D3. 过期的 nextRunAt 在列表里被重算成未来时间（供面板显示）');
  const onDisk = (await readSchedules()).file.items.find((x) => x.id === it.id);
  ok(Date.parse(onDisk.nextRunAt) < Date.now(), 'D4. 读操作不落盘：磁盘上仍是那个过期值（预览是派生的）');
}

// E. 改名联动
console.log('\n== E. 工作流改名联动 ==');
{
  const n = await renameScheduleWorkflow('甲流程', '甲流程改');
  eq(n, 1, 'E1. 改名联动改写 1 条定时项');
  eq((await listSchedules()).items.some((x) => x.workflow === '甲流程改'), true, 'E2. 该定时项指向新名');
  eq(await renameScheduleWorkflow('甲流程', '甲流程改'), 0, 'E3. 旧名已无匹配 → 返回 0（幂等）');
}

// F. 删除
console.log('\n== F. 删除 ==');
{
  const target = (await readSchedules()).file.items.find((x) => x.workflow === '丙不存在');
  eq(await deleteSchedule(target.id), true, 'F1. 删除存在的条目 → true');
  eq((await listSchedules()).items.some((x) => x.id === target.id), false, 'F2. 删除后列表里没有它');
  eq(await deleteSchedule('sch_nope'), false, 'F3. 删除不存在的 id → false');
  const ids = (await readSchedules()).file.items.map((x) => x.id);
  eq(new Set(ids).size, ids.length, 'F4. 剩余条目 id 唯一');
}

// G. 损坏降级
console.log('\n== G. 损坏降级 ==');
{
  writeFileSync(file, '{ 这不是 JSON', 'utf8');
  const r = await readSchedules();
  eq(r.file.items.length, 0, 'G1. 文件损坏 → 降级为空列表（不抛）');
  ok(!!r.error && r.error.includes('schedules.json'), 'G2. 降级时带回中文原因（交调用方记日志）');
  const l = await listSchedules();
  ok(!!l.error, 'G3. listSchedules 把原因放在 error 里（面板可提示）');
  writeFileSync(file, JSON.stringify({ version: 1, items: 'oops' }), 'utf8');
  const r2 = await readSchedules();
  eq(r2.file.items.length, 0, 'G4. items 不是数组同样降级');
  // 恢复
  await writeSchedules({ version: 1, items: [] });
  eq((await readSchedules()).file.items.length, 0, 'G5. 重新写入可恢复（原子写覆盖损坏文件）');
  ok((await schedulesPath()).endsWith('schedules.json'), 'G6. 路径稳定');
  ok(newScheduleId() !== newScheduleId(), 'G7. newScheduleId 不重复');
}

console.log(`\n=== schedules 定时配置存储：${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
