// test/cron.test.mjs — 分钟级 cron 解析与「下次触发时间」单测（docs/SCHEDULE-PLAN.md 步骤 1）
// 锁住：5 字段解析（* / 单值 / 范围 / 步长 / 范围步长 / 逗号列表）、去重升序、周日 0/7 归一化、
//       字段数·越界·*/0·start>end·L/W/#/? 与 6 字段的中文报错、cronError 与 isValidCron、
//       nextRunAt 的跨小时/跨天/跨月/跨年、闰年 2 月 29、小月跳过 31 日、日∨周的 OR 语义、
//       from 落在触发点时取下一个，以及 describeCron 的各种形态。
// 手段：照 test/view-zoom.test.mjs —— esbuild build() 即时打包 src/adapter/cron.ts → 临时 mjs → 断言。
// ★ 与真实时钟无关：nextRunAt 一律传显式 from，断言只看**本机时区**的年月日时分（不用 ISO/UTC）。
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg}（actual=${JSON.stringify(a)} expected=${JSON.stringify(b)}）`);

const dir = mkdtempSync(join(tmpdir(), 'df-cron-'));
const OUT = join(dir, 'cron.mjs');
await build({ entryPoints: ['src/adapter/cron.ts'], bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent' });
const { parseCron, isValidCron, cronError, nextRunAt, describeCron } = await import(pathToFileURL(OUT).href);

/** 本机时区的「年-月-日 时:分」（只读 getter，避开 ISO/UTC 与机器时区耦合） */
const stamp = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} `
  + `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
/** 构造「本机时区」的某天某时某分（与被测实现同口径） */
const at = (y, mo, d, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s, 0);
/** 仅用于日志可读性：带秒（断言仍然只比年月日时分，见 stamp） */
const stampSec = (d) => `${stamp(d)}:${String(d.getSeconds()).padStart(2, '0')}`;
/** nextRunAt 断言：传显式 from，比对本机时区的年月日时分 */
const runFrom = (expr, from, expect) => eq(stamp(nextRunAt(expr, from)), expect, `${expr}｜from=${stampSec(from)} → ${expect}`);
/** 断言抛出中文错误且消息含全部片段 */
const throwsZh = (fn, includes, msg) => {
  try { fn(); fail++; console.error(`  ✗ ${msg}（预期抛错但没有）`); }
  catch (e) {
    const m = String(e?.message ?? '');
    ok(/[\u4e00-\u9fa5]/.test(m) && includes.every((s) => m.includes(s)), `${msg}（message=${m}）`);
  }
};

console.log('== A. 5 字段合法解析 ==');
{
  const all = parseCron('* * * * *');
  eq(all.minutes.length, 60, 'A1. 分 `*` → 0-59 共 60 个');
  eq(all.hours.length, 24, 'A2. 时 `*` → 0-23 共 24 个');
  eq(all.days.length, 31, 'A3. 日 `*` → 1-31 共 31 个');
  eq(all.months.length, 12, 'A4. 月 `*` → 1-12 共 12 个');
  eq(all.weekdays.length, 7, 'A5. 周 `*` → 0-6 共 7 个');

  const single = parseCron('5 9 1 3 2');
  eq(JSON.stringify([single.minutes, single.hours, single.days, single.months, single.weekdays]),
    JSON.stringify([[5], [9], [1], [3], [2]]), 'A6. 单值 5 9 1 3 2 逐字段就位');
  eq(JSON.stringify(parseCron('1-5 * * * *').minutes), JSON.stringify([1, 2, 3, 4, 5]), 'A7. 范围 `1-5` → [1,2,3,4,5]');
  eq(JSON.stringify(parseCron('*/15 * * * *').minutes), JSON.stringify([0, 15, 30, 45]), 'A8. 步长 `*/15` → [0,15,30,45]');
  eq(JSON.stringify(parseCron('1,3,5 * * * *').minutes), JSON.stringify([1, 3, 5]), 'A9. 逗号列表 `1,3,5`');
  eq(JSON.stringify(parseCron('1-5/2 * * * *').minutes), JSON.stringify([1, 3, 5]), 'A10. 范围步长 `1-5/2` → [1,3,5]');
  eq(JSON.stringify(parseCron('0 9 * * 1-5').weekdays), JSON.stringify([1, 2, 3, 4, 5]), 'A11. 周 `1-5`（工作日）');
  eq(JSON.stringify(parseCron('0,30 9,12 * * *').hours), JSON.stringify([9, 12]), 'A12. 列表出现在「时」字段');
}

console.log('== B. 去重升序与周日 0/7 归一化 ==');
{
  eq(JSON.stringify(parseCron('5,1,3,1 * * * *').minutes), JSON.stringify([1, 3, 5]), 'B1. 乱序+重复 → 去重升序 [1,3,5]');
  eq(JSON.stringify(parseCron('*/20,10 * * * *').minutes), JSON.stringify([0, 10, 20, 40]), 'B2. 步长与单值混写 → [0,10,20,40]');
  eq(JSON.stringify(parseCron('0 0 * * 7').weekdays), JSON.stringify([0]), 'B3. 周日写 7 → 归一化为 0');
  eq(JSON.stringify(parseCron('0 0 * * 0-7').weekdays), JSON.stringify([0, 1, 2, 3, 4, 5, 6]), 'B4. `0-7` → 0-6（7 折进 0，不重复）');
  eq(JSON.stringify(parseCron('0 0 * * 5,7').weekdays), JSON.stringify([0, 5]), 'B5. `5,7` → [0,5]（7 折成 0 后仍升序）');
}

console.log('== C. 非法表达式：字段数与空值 ==');
{
  throwsZh(() => parseCron('0 9 * *'), ['5', '4'], 'C1. 4 个字段 → 报错并写明当前字段数 4');
  throwsZh(() => parseCron('0 9 * * * *'), ['5', '6', '秒'], 'C2. 6 个字段 → 报错、写明 6、说明不支持秒级');
  throwsZh(() => parseCron(''), ['5'], 'C3. 空表达式 → 报错（提示应为 5 字段）');
  throwsZh(() => parseCron('   '), ['5'], 'C4. 纯空白表达式 → 报错');
  throwsZh(() => parseCron('1,,3 * * * *'), ['空项'], 'C5. 逗号列表有空项 → 报错');
}

console.log('== D. 非法表达式：越界 / 步长 / 范围 ==');
{
  throwsZh(() => parseCron('60 * * * *'), ['分', '0-59'], 'D1. 分 60 越界 → 指出字段与合法范围');
  throwsZh(() => parseCron('* 24 * * *'), ['时', '0-23'], 'D2. 时 24 越界');
  throwsZh(() => parseCron('* * 32 * *'), ['日', '1-31'], 'D3. 日 32 越界');
  throwsZh(() => parseCron('* * 0 * *'), ['日', '1-31'], 'D4. 日 0 越界（下限 1）');
  throwsZh(() => parseCron('* * * 13 *'), ['月', '1-12'], 'D5. 月 13 越界');
  throwsZh(() => parseCron('* * * * 8'), ['周', '0-6'], 'D6. 周 8 越界（并说明 7 也表示周日）');
  throwsZh(() => parseCron('*/0 * * * *'), ['步长'], 'D7. 步长 0 → 报错');
  throwsZh(() => parseCron('1-5/0 * * * *'), ['步长'], 'D8. 范围步长 `/0` → 报错');
  throwsZh(() => parseCron('5-1 * * * *'), ['范围', '5-1'], 'D9. 范围起点 > 终点 → 报错');
  throwsZh(() => parseCron('1-5-7 * * * *'), ['格式'], 'D10. 三段横线 → 格式非法');
  throwsZh(() => parseCron('*/2/3 * * * *'), ['步长'], 'D11. 双重斜杠 → 步长非法');
}

console.log('== E. 不支持的方言 ==');
{
  throwsZh(() => parseCron('0 9 L * *'), ['不支持', 'L'], 'E1. `L` → 不支持（说明支持范围）');
  throwsZh(() => parseCron('0 9 * * 1W'), ['不支持', 'W'], 'E2. `W` → 不支持');
  throwsZh(() => parseCron('0 9 * * 1#2'), ['不支持', '#'], 'E3. `#` → 不支持');
  throwsZh(() => parseCron('0 0 ? * *'), ['不支持', '?'], 'E4. `?` → 不支持');
  throwsZh(() => parseCron('0 9 * * MON'), ['不支持'], 'E5. 英文星期名 MON → 不支持');
  throwsZh(() => parseCron('0 0 12 * * ?'), ['6', '秒'], 'E6. 秒级 6 字段 → 报错并说明不支持秒级');
}

console.log('== F. isValidCron 与 cronError（不抛异常，UI 用） ==');
{
  eq(isValidCron('0 9 * * 1-5'), true, 'F1. 合法表达式 → true');
  eq(isValidCron('*/15 * * * *'), true, 'F2. 步长表达式 → true');
  eq(isValidCron('60 * * * *'), false, 'F3. 越界 → false');
  eq(isValidCron('0 9 * *'), false, 'F4. 字段数不足 → false');
  eq(isValidCron(''), false, 'F5. 空串 → false');
  eq(isValidCron(null), false, 'F6. 非字符串 → false（不抛）');
  eq(cronError('0 9 * * 1-5'), null, 'F7. 合法 → cronError 返回 null');
  eq(cronError('60 * * * *') !== null, true, 'F8. 非法 → cronError 返回非 null');
  let allZh = true;
  for (const bad of ['60 * * * *', '0 9 * *', '*/0 * * * *', '5-1 * * * *', '0 9 L * *', '', '0 0 12 * * ?']) {
    const m = cronError(bad);
    if (typeof m !== 'string' || !/[\u4e00-\u9fa5]/.test(m) || m.length === 0) allZh = false;
  }
  ok(allZh, 'F9. 各种非法输入的中文原因齐备（无一为空/英文）');
  eq(cronError('60 * * * *').includes('60'), true, 'F10. 红字文案里带上了出错的取值 60');
}

console.log('== G. nextRunAt：严格晚于 from（本机时区） ==');
{
  runFrom('* * * * *', at(2026, 6, 3, 10, 20, 30), '2026-06-03 10:21');
  runFrom('* * * * *', at(2026, 6, 3, 10, 20, 0), '2026-06-03 10:21');
  runFrom('*/15 * * * *', at(2026, 6, 3, 10, 7), '2026-06-03 10:15');
  runFrom('*/15 * * * *', at(2026, 6, 3, 10, 45), '2026-06-03 11:00');
  runFrom('0 9 * * *', at(2026, 6, 3, 10, 0), '2026-06-04 09:00');
  eq(nextRunAt('30 9 * * *', at(2026, 6, 3, 9, 10)).getSeconds(), 0, 'G6. 结果落在一分钟整点（秒=0）');
}

console.log('== H. nextRunAt：from 恰好落在触发点 → 取下一个 ==');
{
  runFrom('30 9 * * *', at(2026, 6, 3, 9, 30), '2026-06-04 09:30');
  runFrom('0 0 1 1 *', at(2026, 1, 1, 0, 0), '2027-01-01 00:00');
  runFrom('0 9 * * *', at(2026, 6, 3, 9, 0), '2026-06-04 09:00');
}

console.log('== I. nextRunAt：跨月 / 跨年 / 小月跳过 31 日 ==');
{
  runFrom('0 9 1 * *', at(2026, 1, 15, 0, 0), '2026-02-01 09:00');
  runFrom('0 9 * * *', at(2026, 12, 31, 10, 0), '2027-01-01 09:00');
  runFrom('0 9 1 1 *', at(2026, 3, 5, 0, 0), '2027-01-01 09:00');
  runFrom('0 9 31 * *', at(2026, 4, 1, 0, 0), '2026-05-31 09:00');
  runFrom('0 9 31 * *', at(2026, 5, 31, 10, 0), '2026-07-31 09:00');
  throwsZh(() => nextRunAt('0 9 30 2 *', at(2026, 3, 1, 0, 0)), ['4', '年'], 'I6. 2 月 30 日永远不成立 → 找满 4 年后报错');
}

console.log('== J. nextRunAt：闰年 2 月 29 日 ==');
{
  runFrom('0 0 29 2 *', at(2027, 3, 1, 0, 0), '2028-02-29 00:00');
  runFrom('0 0 29 2 *', at(2028, 3, 1, 0, 0), '2032-02-29 00:00');
  runFrom('0 12 * * *', at(2028, 2, 28, 13, 0), '2028-02-29 12:00');
}

console.log('== K. nextRunAt：日的匹配规则（单边 AND / 双侧 OR） ==');
{
  runFrom('0 9 * * 1-5', at(2026, 6, 6, 15, 0), '2026-06-08 09:00');   // 2026-06-06 周六 → 下周一
  runFrom('0 12 * * 1', at(2026, 6, 3, 10, 0), '2026-06-08 12:00');     // 只限定周 → 只看周一（AND）
  runFrom('0 12 8 6 *', at(2026, 6, 3, 10, 0), '2026-06-08 12:00');     // 只限定日 → 只看 6 月 8 日（AND）
  runFrom('0 12 1 * 1', at(2026, 6, 3, 10, 0), '2026-06-08 12:00');     // 双侧限定 → OR（周一 6/8 早于 7/1）
  runFrom('0 12 5 6 1', at(2026, 6, 3, 10, 0), '2026-06-05 12:00');     // OR：6/5 只满足「日」，照样触发
  runFrom('0 9 31 8 1', at(2026, 8, 26, 10, 0), '2026-08-31 09:00');    // OR：8/31 是周一，且满足「日 31」
}

console.log('== L. nextRunAt：非法输入 ==');
{
  throwsZh(() => nextRunAt('60 * * * *', at(2026, 6, 3)), ['分', '0-59'], 'L1. 非法 cron → 抛中文错（不静默）');
  throwsZh(() => nextRunAt('0 9 * *', at(2026, 6, 3)), ['5', '4'], 'L2. 字段数错 → 抛中文错');
  throwsZh(() => nextRunAt('0 9 * * *', new Date('不是日期')), ['起始时间'], 'L3. from 非法日期 → 抛中文错');
}

console.log('== M. describeCron 中文预览 ==');
{
  eq(describeCron('0 9 * * 1-5'), '工作日 09:00', 'M1. 工作日 09:00');
  eq(describeCron('*/30 * * * *'), '每 30 分钟', 'M2. 每 30 分钟');
  eq(describeCron('0 9 * * *'), '每天 09:00', 'M3. 每天 09:00');
  eq(describeCron('0 9 1 * *'), '每月 1 日 09:00', 'M4. 每月 1 日 09:00');
  eq(describeCron('30 8 * * 1'), '每周一 08:30', 'M5. 每周一 08:30');
  eq(describeCron('*/15 * * * *'), '每 15 分钟', 'M6. 每 15 分钟');
  eq(describeCron('* * * * *'), '每分钟', 'M7. 每分钟');
  eq(describeCron('0 * * * *'), '每小时整点', 'M8. 每小时整点');
  eq(describeCron('0 9 * * 0,6'), '周末 09:00', 'M9. 周末 09:00（周 0,6）');
  eq(describeCron('0 9 * * 0'), '每周日 09:00', 'M10. 每周日 09:00（周日 0 归一化后仍显示周日）');
  eq(describeCron('0 0 1 1 *'), '每年 1 月 1 日 00:00', 'M11. 每年 1 月 1 日 00:00');
  eq(describeCron('0,30 9 * * *'), '每天 09:00、09:30', 'M12. 一天两个时间点');
  eq(describeCron('0 9 1 * 1'), '每月 1 日 或 每周一 09:00', 'M13. 日/周双侧限定时体现 OR');
  throwsZh(() => describeCron('60 * * * *'), ['分'], 'M14. 非法表达式同样抛中文错');
}

console.log(`\n=== cron 解析与下次时间：${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
