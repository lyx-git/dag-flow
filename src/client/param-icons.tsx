// src/client/param-icons.tsx — 「参数与试跑」弹窗里那两个「单行 / 多行」行内 SVG 图标
//   ★ 2026-10-19 从 params-editor.tsx 拆出：该文件已 596 行、离 600 行硬上限只剩几行
//     （规范 §3：单文件软上限 500 / 硬 600）。图标是自成一体的纯展示代码，搬出来零逻辑风险；
//     ParamsEditor 里只保留 `IconSingleLine` / `IconMultiLine` 的调用点。
//   ★ 历史：2026-10-11 用户反馈「单行输入和多行编辑框的 icon 有点丑」——原来用的是字体符号
//     ▭（U+25AD 空心方块）与 ⤢（冷僻箭头区字符），不属于常用字形，不同字体/字号下渲染差异极大，
//     小按钮里就成了"空心方块 + 歪箭头"。现改为一对语义直白的输入框图标（描边用 currentColor，
//     任何字体与缩放下都清晰）：单行 = 扁框内一横线；多行 = 高框内三横线。
import { createElement } from 'react';
import type { ReactElement } from 'react';

/** 两个图标共用的 SVG 属性（尺寸 / 描边 / 无障碍） */
const SVG_ICON = {
  width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.5, strokeLinecap: 'round', 'aria-hidden': 'true',
} as const;

/** 单行输入（扁框 + 一横线） */
export function IconSingleLine(): ReactElement {
  return createElement('svg', SVG_ICON,
    createElement('rect', { x: 2.6, y: 5.4, width: 10.8, height: 5.2, rx: 1.3 }),
    createElement('path', { d: 'M5.4 8h5.2' }),
  );
}

/** 多行编辑框（高框 + 三横线） */
export function IconMultiLine(): ReactElement {
  return createElement('svg', SVG_ICON,
    createElement('rect', { x: 2.6, y: 2.8, width: 10.8, height: 10.4, rx: 1.3 }),
    createElement('path', { d: 'M5.2 5.6h5.6M5.2 8h5.6M5.2 10.4h3.6' }),
  );
}
