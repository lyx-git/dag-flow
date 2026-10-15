// src/client/header-icons.ts
// 头部按钮图标（2026-10-15 用户拍板）——全部是 14×14 线条 SVG，与 picker 行复制按钮的 copy-plus 同一家族。
//
// 为什么单独一个文件：这三个图标要在 FlowPanel（头部）里被 createElement 直接调用，
//   写成独立工厂函数便于 marker 断言（tmp-test/verify-build-markers.mjs 直接 grep 下面的 path 字符串）
//   以及将来统一调粗细/尺寸（只改这一处 BASE）。
//
// ★ 用户拍板记录：JSON 视图＝大括号（A 方案）；导入/导出＝托盘+箭头（J 方案）。
//   语义：导出＝把工作流写成文件（托盘+下箭头，download 语汇）；
//        导入＝把 .json 文件读进来（托盘+上箭头，upload 语汇）。
import { createElement } from 'react';

/** 三个图标共用的 svg 属性：14px、线性、currentColor（跟随按钮状态色变） */
export const HEADER_ICON_BASE = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** JSON 视图（大括号 · Lucide braces） */
export function iconJsonBraces() {
  return createElement(
    'svg',
    HEADER_ICON_BASE,
    createElement('path', { key: 'l', d: 'M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1' }),
    createElement('path', { key: 'r', d: 'M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1' }),
  );
}

/** 导出（托盘 + 下箭头 · Lucide download）——导出 JSON / PNG / SVG 菜单的锚点按钮 */
export function iconExportTray() {
  return createElement(
    'svg',
    HEADER_ICON_BASE,
    createElement('path', { key: 'tray', d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }),
    createElement('polyline', { key: 'head', points: '7 10 12 15 17 10' }),
    createElement('line', { key: 'stem', x1: 12, x2: 12, y1: 15, y2: 3 }),
  );
}

/** 导入（托盘 + 上箭头 · Lucide upload）——从 .json 文件导入工作流 */
export function iconImportTray() {
  return createElement(
    'svg',
    HEADER_ICON_BASE,
    createElement('path', { key: 'tray', d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }),
    createElement('polyline', { key: 'head', points: '17 8 12 3 7 8' }),
    createElement('line', { key: 'stem', x1: 12, x2: 12, y1: 3, y2: 15 }),
  );
}
