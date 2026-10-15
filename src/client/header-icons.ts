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

// ============================================================================
// ★ 2026-10-15 用户追加要求：「按钮大小，形式，颜色等都统一下」。
//   盘点出的真问题：头部 10 颗按钮里只有 3 颗是线条 SVG，其余 6 颗还是彩色 emoji ——
//   ① 形式不一致（线条 vs 彩色字形）；② 颜色不一致（emoji 自带彩，不跟按钮状态色）；
//   ③ 尺寸不一致（emoji 内容宽约 19px ⇒ 按钮 35px；14px SVG ⇒ 按钮 30px，差 5px 肉眼可见）。
//   处置：把剩下 6 颗也换成**同一规格**（14px / strokeWidth 2 / currentColor / round）的线条图标，
//   于是尺寸与颜色自然统一（见 styles.css 的 `.dsh-wf-header .dsh-wf-btn` 段与 .is-icolike 下限）。
//   图标选型＝各语义最通用的 Lucide 标准形，逐条列在下面每个函数的注释里。
// ============================================================================

/** 画布视图（两个方块 + 连线 · Lucide workflow）——「搭流程图的那块画布」 */
export function iconCanvas() {
  return createElement(
    'svg',
    HEADER_ICON_BASE,
    createElement('rect', { key: 'a', width: 8, height: 8, x: 3, y: 3, rx: 2 }),
    createElement('path', { key: 'l', d: 'M7 11v4a2 2 0 0 0 2 2h4' }),
    createElement('rect', { key: 'b', width: 8, height: 8, x: 13, y: 13, rx: 2 }),
  );
}

/** 工作流参数（两条带滑块的线 · Lucide settings-2 的简化对偶）——「定义这份工作流要哪些输入」 */
export function iconParams() {
  return createElement(
    'svg',
    HEADER_ICON_BASE,
    createElement('path', { key: 'l1', d: 'M20 7h-9' }),
    createElement('path', { key: 'l2', d: 'M14 17H5' }),
    createElement('circle', { key: 'c1', cx: 17, cy: 17, r: 3 }),
    createElement('circle', { key: 'c2', cx: 7, cy: 7, r: 3 }),
  );
}

/** 保存到磁盘（软盘轮廓 · Lucide save）——「存快照 / 落盘」 */
export function iconSave() {
  return createElement(
    'svg',
    HEADER_ICON_BASE,
    createElement('path', { key: 'body', d: 'M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z' }),
    createElement('path', { key: 'slot', d: 'M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7' }),
    createElement('path', { key: 'shutter', d: 'M7 3v4a1 1 0 0 0 1 1h7' }),
  );
}

/** 历史版本（逆时针箭头 + 表针 · Lucide history）——「回载旧快照」 */
export function iconHistory() {
  return createElement(
    'svg',
    HEADER_ICON_BASE,
    createElement('path', { key: 'arc', d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }),
    createElement('path', { key: 'arrow', d: 'M3 3v5h5' }),
    createElement('path', { key: 'hand', d: 'M12 7v5l4 2' }),
  );
}

/** 定时任务（表盘 + 指针 · Lucide clock）——「cron 定时执行」 */
export function iconSchedule() {
  return createElement(
    'svg',
    HEADER_ICON_BASE,
    createElement('circle', { key: 'face', cx: 12, cy: 12, r: 10 }),
    createElement('polyline', { key: 'hand', points: '12 6 12 12 16 14' }),
  );
}

/** 运行日志（文档 + 三行正文 · Lucide file-text）——「每节点的入参/出参/错误/耗时」 */
export function iconRunLog() {
  return createElement(
    'svg',
    HEADER_ICON_BASE,
    createElement('path', { key: 'doc', d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' }),
    createElement('path', { key: 'fold', d: 'M14 2v4a2 2 0 0 0 2 2h4' }),
    createElement('path', { key: 'l1', d: 'M10 9H8' }),
    createElement('path', { key: 'l2', d: 'M16 13H8' }),
    createElement('path', { key: 'l3', d: 'M16 17H8' }),
  );
}
