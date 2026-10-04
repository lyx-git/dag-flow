// src/client/viewZoom.ts — 画布缩放策略（纯函数，离线可测）
//
// 需求（2026-10-03 用户原话）：「适应画布的按钮现在没啥用，现在刚进工作流画布的时候，画布上的节点太小了，
//   无法看清，最好可以一键放大缩小，方便修改」。
//
// 两条策略分开：
//   · pickInitialZoom —— 进画布时的默认缩放：按内容自适应，但**夹在 [READABLE_MIN, 1]**：
//       下限保证"看得清"（大图不再被 fitView 塞成一片小点），上限 1 避免小图被放大到糊。
//   · fitZoomClamped  —— 点「⤢ 适应画布」时的缩放：夹在 [FIT_MIN, 1]，宁可看不全也别看不清。
//   · nextZoomStep    —— 「＋/−」一键放大缩小按**档位**跳（25%→50%→75%→100%→125%→150%→200%），
//       避免 1px 级连续缩放的抖动，也方便"一键回到常用档位"。
//
// ★ 2026-10-03 用户指示「70%挡位改为75%」：可读下限与档位两处一起改（保持"进画布那一刻的缩放
//   就是档位表里的某一档"，否则工具栏高亮/下一档提示会与当前值对不上）。「适应画布」下限 50% 不动。

/** 进画布默认缩放下限：低于这个值节点文字就看不清了（用户要"能看清、方便修改"） */
export const READABLE_MIN_ZOOM = 0.75;
/** 「适应画布」的缩放下限：23 节点全图 fit 只剩 ~0.3，看得全但看不清，所以兜一个底 */
export const FIT_MIN_ZOOM = 0.5;
/** 一键放大/缩小的档位 */
export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** 进画布默认缩放：自适应值（fitZoom）夹到 [READABLE_MIN, 1]；拿不到有效值就用下限 */
export function pickInitialZoom(fitZoom: number): number {
  if (!Number.isFinite(fitZoom) || fitZoom <= 0) return READABLE_MIN_ZOOM;
  return clamp(fitZoom, READABLE_MIN_ZOOM, 1);
}

/** 「适应画布」用的缩放：夹到 [0.5, 1]（能全图可见时优先全图，但不低于看得清的下限） */
export function fitZoomClamped(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return READABLE_MIN_ZOOM;
  return clamp(raw, FIT_MIN_ZOOM, 1);
}

/** 一键放大（dir=1）/ 缩小（dir=-1）：返回下一个档位；已在端点则停在端点 */
export function nextZoomStep(current: number, dir: 1 | -1): number {
  const eps = 1e-3;
  const cur = Number.isFinite(current) && current > 0 ? current : 1;
  if (dir > 0) return ZOOM_STEPS.find((z) => z > cur + eps) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) if (ZOOM_STEPS[i] < cur - eps) return ZOOM_STEPS[i];
  return ZOOM_STEPS[0];
}

/** 当前缩放落在哪个档位附近（工具栏高亮/提示用；无档位命中返回 null） */
export function zoomStepLabel(current: number): string | null {
  const hit = ZOOM_STEPS.find((z) => Math.abs(z - current) < 0.02);
  return hit ? `${Math.round(hit * 100)}%` : null;
}

// ================= 取景 C：整图居中之后把「入口节点」带进可视区（2026-10-04 用户拍板）=================
// 背景：进画布只设一次视图 = **整图内容居中**。图一大，入口（start）节点就可能落在视口边缘/外面，
//   用户得先拖着找"从哪儿开始"。用户从 A（不改）/ B（一律对准入口）/ C（折中）里选了 **C**：
//   保持整图居中，**仅当入口节点不在可视区内时**做一次**最少平移**把它带进来 —— 缩放不变。
// ★ 为什么必须减掉右侧面板宽度：`.dsh-wf-right` 是绝对定位浮层（约 340px），会盖住画布右边；
//   不减的话"以为可见、其实藏在面板底下"（2026-10-03 switch-chips 3/3 失败就是这个坑）。

export interface WorldRect { x: number; y: number; width: number; height: number }

/**
 * 纯函数：算出"把 startBox 带进可视区"的最少平移量（世界坐标；单位与 box 相同）。
 * @param graphBox 当前居中的整图包围盒（决定可视区在世界坐标里的位置）
 * @param startBox 入口节点包围盒（null = 找不到入口，不移动）
 * @param viewW/viewH 视口尺寸（屏幕像素）
 * @param panelW 右侧浮层遮挡宽度（屏幕像素，0 = 无遮挡）
 * @param zoom 当前缩放（世界 → 屏幕）
 */
export function ensureVisibleShift(opts: {
  graphBox: WorldRect | null; startBox: WorldRect | null;
  viewW: number; viewH: number; panelW?: number; zoom: number;
}): { shifted: boolean; dx: number; dy: number; target: WorldRect | null } {
  const { graphBox, startBox, viewW, viewH, zoom } = opts;
  const panelW = Math.max(0, opts.panelW ?? 0);
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  if (!startBox || !Number.isFinite(viewW) || !Number.isFinite(viewH) || viewW <= 0 || viewH <= 0) {
    return { shifted: false, dx: 0, dy: 0, target: null };
  }
  // 真正能看的区域（世界坐标）：视口减掉右侧面板，整体除以 zoom
  const safeW = Math.max(80, viewW - panelW) / z;
  const safeH = Math.max(80, viewH) / z;
  const base = graphBox ?? startBox;
  const cx = base.x + base.width / 2;
  const cy = base.y + base.height / 2;
  const left = cx - safeW / 2;
  const top = cy - safeH / 2;
  const right = left + safeW;
  const bottom = top + safeH;
  // 最少平移：只把越界的那一侧拉回来
  let dx = 0;
  let dy = 0;
  if (startBox.x < left) dx = startBox.x - left;
  else if (startBox.x + startBox.width > right) dx = startBox.x + startBox.width - right;
  if (startBox.y < top) dy = startBox.y - top;
  else if (startBox.y + startBox.height > bottom) dy = startBox.y + startBox.height - bottom;
  if (dx === 0 && dy === 0) return { shifted: false, dx: 0, dy: 0, target: null };
  return { shifted: true, dx, dy, target: { x: left + dx, y: top + dy, width: safeW, height: safeH } };
}
