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
const { pickInitialZoom, fitZoomClamped, nextZoomStep, zoomStepLabel, ensureVisibleShift, READABLE_MIN_ZOOM, FIT_MIN_ZOOM, ZOOM_STEPS } = await import(pathToFileURL(OUT).href);

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

console.log('== D. 取景 C：整图居中后把入口节点带进可视区（最少平移、缩放不变）==');
{
  // 视口 1000×600，右侧面板占 340 → 真正能看的宽度 = 660/zoom
  // 小图：整图与入口都在中间 → 不移动
  const small = ensureVisibleShift({
    graphBox: { x: 0, y: 0, width: 400, height: 200 }, startBox: { x: 0, y: 0, width: 160, height: 80 },
    viewW: 1000, viewH: 600, panelW: 340, zoom: 1,
  });
  eq(small.shifted, false, 'D1. 图放得下且入口可见 → 不移动（不做多余取景）');
  eq(small.target, null, 'D2. 不移动时不产生目标框');

  // 宽图：整图宽 3000（居中后左边界 = -1000），入口在最左 → 需要往左拉回
  const wide = ensureVisibleShift({
    graphBox: { x: 0, y: 0, width: 3000, height: 200 }, startBox: { x: 0, y: 0, width: 160, height: 80 },
    viewW: 1000, viewH: 600, panelW: 340, zoom: 1,
  });
  eq(wide.shifted, true, 'D3. ★入口在可视区外 → 平移把它带进来');
  // 可视世界窗口：中心 = 整图中心 1500，宽 660 → [1170, 1830]；入口 [0,160] 在左边之外
  // → 最少平移 = 把窗口左边缘拉到入口左边缘：dx = 0 - 1170 = -1170（入口正好贴住可视左边缘）
  eq(wide.dx, -1170, 'D4. 平移量 = 刚好把入口左边缘拉到可视左边缘（最少移动）');
  eq(wide.dy, 0, 'D5. 纵向不需要动就不动');
  ok(!!wide.target && wide.target.width === 660, 'D6. 目标框宽度 = 视口 - 面板遮挡（660）');

  // 右侧面板遮挡：整图 [0,1200] 中心 600 → 可视窗口 [270,930]；入口 [1040,1200] 落在窗口右边之外
  // （屏幕上就是"被右侧面板压住"）→ dx 为正 = 内容左移，把入口从面板下拉出来
  const right = ensureVisibleShift({
    graphBox: { x: 0, y: 0, width: 1200, height: 200 }, startBox: { x: 1040, y: 0, width: 160, height: 80 },
    viewW: 1000, viewH: 600, panelW: 340, zoom: 1,
  });
  eq(right.shifted, true, 'D7. ★入口落在右侧面板底下（看似可见实则被盖） → 也要平移');
  eq(right.dx, 270, 'D8. 平移量 = 把入口右边缘拉到可视右边缘（dx>0 = 内容左移，从面板下拉出来）');

  // 缩放进公式：zoom=0.5 时可视世界宽度翻倍（1320）→ 窗口 [840,2160]，dx = 0-840
  const half = ensureVisibleShift({
    graphBox: { x: 0, y: 0, width: 3000, height: 200 }, startBox: { x: 0, y: 0, width: 160, height: 80 },
    viewW: 1000, viewH: 600, panelW: 340, zoom: 0.5,
  });
  eq(half.dx, -840, 'D9. 平移量随缩放换算（zoom=0.5 → 660/0.5=1320 可视宽，dx=-840）');

  // 找不到入口 → 不动（不能因为取不到 start 就乱移）
  eq(ensureVisibleShift({ graphBox: null, startBox: null, viewW: 1000, viewH: 600, panelW: 340, zoom: 1 }).shifted, false,
    'D10. 没有入口节点 → 不移动');
  // 视口尺寸还没就绪 → 不动（等下一帧）
  eq(ensureVisibleShift({ graphBox: { x: 0, y: 0, width: 100, height: 100 }, startBox: { x: 0, y: 0, width: 10, height: 10 }, viewW: 0, viewH: 0, zoom: 1 }).shifted, false,
    'D11. 视口尺寸为 0（未就绪）→ 不移动');
}

console.log(`\n=== viewZoom 画布缩放策略：${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
