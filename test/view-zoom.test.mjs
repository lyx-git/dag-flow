// test/view-zoom.test.mjs — 画布缩放策略单测（2026-10-03 用户需求）
//   用户原话：「适应画布的按钮现在没啥用，现在刚进工作流画布的时候，画布上的节点太小了，无法看清，
//             最好可以一键放大缩小，方便修改」。
// 覆盖：进画布默认缩放夹取 [75%,100%] / 适应画布夹取 [50%,100%] / 一键放大缩小的档位跳变与端点。
// 手段：esbuild 即时打包 src/client/viewZoom.ts → 临时 mjs → 断言（纯函数，无 React/无 IO/无 CDP）
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg}（actual=${JSON.stringify(a)} expected=${JSON.stringify(b)}）`);

const dir = mkdtempSync(join(tmpdir(), 'df-view-zoom-'));
const OUT = join(dir, 'viewZoom.mjs');
await build({ entryPoints: ['src/client/viewZoom.ts'], bundle: true, format: 'esm', platform: 'node', outfile: OUT, logLevel: 'silent' });
const { pickInitialZoom, fitZoomClamped, nextZoomStep, zoomStepLabel, READABLE_MIN_ZOOM, FIT_MIN_ZOOM, ZOOM_STEPS } = await import(pathToFileURL(OUT).href);

console.log('== A. 进画布默认缩放：自适应但夹在 [75%,100%] ==');
{
  eq(pickInitialZoom(0.45), 0.75, 'A1. 大图 fit 只有 0.45 → 抬到 75%（看得清优先，不再塞成一片小点）');
  eq(pickInitialZoom(0.75), 0.75, 'A2. 正好 0.75 → 保持');
  eq(pickInitialZoom(1.2), 1, 'A3. 小图 fit 到 1.2 → 压到 100%（不放大糊掉）');
  eq(pickInitialZoom(1), 1, 'A4. 正好 1 → 保持');
  eq(pickInitialZoom(NaN), READABLE_MIN_ZOOM, 'A5. 量不到内容尺寸 → 用下限（不返回 NaN 把画布弄坏）');
  eq(pickInitialZoom(0), READABLE_MIN_ZOOM, 'A6. 非法值 0 → 用下限');
  eq(pickInitialZoom(-3), READABLE_MIN_ZOOM, 'A7. 负值 → 用下限');
  eq(READABLE_MIN_ZOOM, 0.75, 'A8. 下限常量就是 75%');
}

console.log('== B. 「⤢ 适应画布」：夹在 [50%,100%] ==');
{
  eq(fitZoomClamped(0.32), 0.5, 'B1. 23 节点全图 fit ~0.32 → 兜到 50%（宁可看不全也别看不清）');
  eq(fitZoomClamped(0.5), 0.5, 'B2. 正好 0.5 → 保持');
  eq(fitZoomClamped(0.85), 0.85, 'B3. 0.85 在区间内 → 原样（能全图可见就优先全图）');
  eq(fitZoomClamped(1.6), 1, 'B4. 小图 1.6 → 压到 100%');
  eq(fitZoomClamped(NaN), READABLE_MIN_ZOOM, 'B5. 非法值 → 用可读下限兜底');
  eq(FIT_MIN_ZOOM, 0.5, 'B6. 适应画布下限常量就是 50%');
  ok(pickInitialZoom(0.45) > fitZoomClamped(0.32), 'B7. 默认视图比「适应画布」更"看得清"（75% > 50%）');
}

console.log('== C. 一键放大/缩小：按档位跳 ==');
{
  eq(JSON.stringify(ZOOM_STEPS), JSON.stringify([0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]), 'C1. 档位表 = 25/50/75/100/125/150/200%');
  eq(nextZoomStep(1, 1), 1.25, 'C2. 100% 放大 → 125%');
  eq(nextZoomStep(1, -1), 0.75, 'C3. 100% 缩小 → 75%');
  eq(nextZoomStep(0.75, -1), 0.5, 'C4. 75% 缩小 → 50%');
  eq(nextZoomStep(0.31, -1), 0.25, 'C5. 非档位值（0.31）缩小 → 落到 25%');
  eq(nextZoomStep(0.31, 1), 0.5, 'C6. 非档位值（0.31）放大 → 落到 50%');
  eq(nextZoomStep(2, 1), 2, 'C7. 已到最大档 → 停在 200%（不超界）');
  eq(nextZoomStep(0.25, -1), 0.25, 'C8. 已到最小档 → 停在 25%');
  eq(nextZoomStep(1.4, 1), 1.5, 'C9. 档位之间（1.4）放大 → 150%');
  eq(nextZoomStep(NaN, -1), 0.75, 'C10. 非法当前值 → 按 100% 处理，缩到 75%');
  eq(zoomStepLabel(1), '100%', 'C11. 落在档位上 → 给出档位文案');
  eq(zoomStepLabel(0.83), null, 'C12. 不在档位上 → null（工具栏不误标）');
}

console.log(`\n=== viewZoom 画布缩放策略：${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
