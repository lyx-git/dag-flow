// src/client/util/edge-drag.ts — 面板边缘/角落拖拽通用逻辑（2026-10-01 夜）
// 用于：FlowGram 左侧节点面板、右侧参数面板、缩略图（readStoredWidth）。
// 事件必须挂 window capture（FlowGram 在 document capture 层 stopImmediatePropagation 会吞
// document 级事件——见 lesson 0mupf12a2），window capture 是最早触发点。
// React 合成事件与原生事件都可直接传（两者都有 clientX/preventDefault/stopPropagation）。

/** 读 localStorage 数值宽度（minimap 等比缩放用），非法/越界回退 */
export function readStoredWidth(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(Math.max(n, min), max);
  } catch {
    return fallback;
  }
}

export function clampNum(v: unknown, fallback: number, min: number, max: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/** 左侧节点面板几何：x/y=左/上偏移，h=null 表示高度拉伸态（top/bottom 双锚） */
export interface PaletteGeom { x: number; y: number; w: number; h: number | null }

/** 右侧参数面板几何：r=右偏移，y=上偏移，h=null 表示高度拉伸态 */
export interface RightGeom { r: number; y: number; w: number; h: number | null }

/** 读/存面板几何 JSON（sanitize 由调用方提供，负责钳位与兜底） */
export function readStoredJSON<T>(key: string, fallback: T, sanitize: (raw: any) => T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return sanitize(JSON.parse(raw));
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 忽略 */ }
}

/** 八向窗口式缩放的起始几何：h 必须已是数字（面板处于上下拉伸态时由调用方先量测实体高度） */
export interface Resize8Start { x: number; y: number; w: number; h: number }

/** 八向窗口式缩放：w/n 方向拖拽会移动面板位置（左/顶缘跟随光标），e/s 方向只改尺寸。
 *  dir 取 'n'/'s'/'e'/'w'/'ne'/'nw'/'se'/'sw'（可组合，如 'se' = 下+右）。
 *  onFrame 每次移动回调解析后的绝对几何；onEnd 拖拽结束回调（持久化用）。 */
export function startResize8(
  e: { clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void },
  dir: string,
  start: Resize8Start,
  opts: { minW: number; maxW: number; minH: number; maxH: number },
  onFrame: (g: Resize8Start) => void,
  onEnd: (g: Resize8Start) => void,
): void {
  e.preventDefault();
  e.stopPropagation();
  const sx = e.clientX;
  const sy = e.clientY;
  let g: Resize8Start = { ...start };
  const onMove = (ev: MouseEvent): void => {
    const dx = ev.clientX - sx;
    const dy = ev.clientY - sy;
    let w = start.w;
    let h = start.h;
    if (dir.includes('e')) w = start.w + dx;
    if (dir.includes('w')) w = start.w - dx;
    w = Math.min(Math.max(w, opts.minW), opts.maxW);
    if (dir.includes('s')) h = start.h + dy;
    if (dir.includes('n')) h = start.h - dy;
    h = Math.min(Math.max(h, opts.minH), opts.maxH);
    // 左/顶缘跟随光标（w/n 方向）；e/s 方向位置不变
    const x = dir.includes('w') ? start.x + (start.w - w) : start.x;
    const y = dir.includes('n') ? start.y + (start.h - h) : start.y;
    g = { x, y, w, h };
    onFrame(g);
  };
  const onUp = (): void => {
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseup', onUp, true);
    onEnd(g);
  };
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mouseup', onUp, true);
}
