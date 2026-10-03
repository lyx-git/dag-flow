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
