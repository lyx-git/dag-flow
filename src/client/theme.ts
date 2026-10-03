// src/client/theme.ts — 双主题 token 体系
//
// 需求：工作流 UI 可切换两种主题——
//   A. dsh —— 跟随 DSH 宿主风格（消费 --dsw-alias-* 官方语义 token，深浅自适应）
//   B. nodeflow —— 独立现代 Node-Flow 风格（深空蓝基底，--kind 类型色光晕）
//
// 实现：所有组件只消费 ThemeTokens（useTheme()），切换=替换 token 对象，
// 不维护两套 CSS。CSS 侧用 [data-wf-theme="dsh|nodeflow"] 属性选择器 + 变量。

export type ThemeMode = 'dsh' | 'nodeflow' | 'nodeflow-light' | 'auto';

export interface ThemeTokens {
  name: ThemeMode;
  // 背景/面板
  bg: string;
  panel: string;
  panel2: string;
  // 边框
  border: string;
  borderStrong: string;
  // 文字
  text: string;
  text2: string;
  muted: string;
  // 强调
  accent: string;
  accentHover: string;
  onAccent: string;
  // 状态色
  success: string;
  danger: string;
  warn: string;
  // 节点
  nodeBorder: string;
  nodeBorderStrong: string;
  // 连线语义色
  edgeFlow: string;
  edgePass: string;
  edgeFail: string;
  edgeContext: string;
  edgeData: string;
  // 端口（蓝进橙出）
  portIn: string;
  portOut: string;
  // 阴影
  shadow: string;
  shadowLg: string;
  // 字体/圆角
  fontFamily: string;
  radiusSm: number;
  radiusMd: number;
  radiusLg: number;
  // 节点类型色光晕强度（nodeflow 特有；dsh 用官方 token 淡化）
  kindGlow: number;
  backdropBlur: boolean;
}

/**
 * 主题 A：跟随 DSH 宿主。
 * 用 var(--dsw-alias-*) 引用宿主语义 token，未定义时回退到中性的 slate 值。
 * 深/浅色由宿主主题自动决定（CSS 变量本身自适应）。
 */
export const DSH_THEME: ThemeTokens = {
  name: 'dsh',
  bg: 'var(--dsw-alias-bg-base, #f8fafc)',
  panel: 'var(--dsw-alias-bg-layer-1, #ffffff)',
  panel2: 'var(--dsw-alias-bg-layer-2, #f1f5f9)',
  border: 'var(--dsw-alias-border-l1, #e2e8f0)',
  borderStrong: 'var(--dsw-alias-border-l2, #cbd5e1)',
  text: 'var(--dsw-alias-label-primary, #0f172a)',
  text2: 'var(--dsw-alias-label-secondary, #334155)',
  muted: 'var(--dsw-alias-label-tertiary, #64748b)',
  accent: 'var(--dsw-alias-brand-primary, #3b82f6)',
  accentHover: 'var(--dsw-alias-brand-hover, #2563eb)',
  onAccent: 'var(--dsw-alias-label-primary-inverse, #ffffff)',
  success: 'var(--dsw-alias-state-success-primary, #10b981)',
  danger: 'var(--dsw-alias-state-error-primary, #f43f5e)',
  warn: 'var(--dsw-alias-state-warn-primary, #f59e0b)',
  nodeBorder: 'var(--dsw-alias-border-l2, #cbd5e1)',
  nodeBorderStrong: 'var(--dsw-alias-border-l3, #94a3b8)',
  edgeFlow: '#94a3b8',
  edgePass: '#10b981',
  edgeFail: '#f43f5e',
  edgeContext: '#d9a441',
  edgeData: '#4a9fd8',
  portIn: '#3d8bfd',
  portOut: '#ff8a4c',
  shadow: '0 1px 3px rgba(0,0,0,.08)',
  shadowLg: '0 12px 32px rgba(0,0,0,.14)',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  radiusSm: 6,
  radiusMd: 8,
  radiusLg: 12,
  kindGlow: 0,
  backdropBlur: false,
};

/**
 * 主题 B：独立现代 Node-Flow 风格（深空蓝基底）。
 * 参考 dsh-node-flow 的设计系统：#0b1120 深空蓝 + --kind 类型色光晕。
 */
export const NODE_FLOW_THEME: ThemeTokens = {
  name: 'nodeflow',
  bg: '#0b1120',
  panel: '#101a2b',
  panel2: '#162135',
  border: '#22304a',
  borderStrong: '#2a3a56',
  text: '#e6edf7',
  text2: '#f1f5fb',
  muted: '#8b9bb3',
  accent: '#4f8cff',
  accentHover: '#5f97ff',
  onAccent: '#0b1120',
  success: '#34d399',
  danger: '#f87171',
  warn: '#fbbf24',
  nodeBorder: '#3a4d68',
  nodeBorderStrong: '#475569',
  edgeFlow: '#475569',
  edgePass: '#34d399',
  edgeFail: '#f87171',
  edgeContext: '#d9a441',
  edgeData: '#4a9fd8',
  portIn: '#3d8bfd',
  portOut: '#ff8a4c',
  shadow: '0 4px 16px rgba(0,0,0,.32)',
  shadowLg: '0 12px 36px rgba(0,0,0,.45)',
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  radiusSm: 8,
  radiusMd: 10,
  radiusLg: 16,
  kindGlow: 0.55,
  backdropBlur: true,
};

/** 主题 B 浅色变体（可选） */
export const NODE_FLOW_LIGHT_THEME: ThemeTokens = {
  ...NODE_FLOW_THEME,
  name: 'nodeflow-light',
  bg: '#f4f6fa',
  panel: '#ffffff',
  panel2: '#eef1f6',
  border: '#dfe5ee',
  borderStrong: '#c8d2e0',
  text: '#1a2333',
  text2: '#24344f',
  muted: '#6b7a93',
  onAccent: '#ffffff',
  edgeFlow: '#c8d2e0',
  shadow: '0 4px 16px rgba(30,50,90,.12)',
  shadowLg: '0 12px 36px rgba(30,50,90,.18)',
};

/** 主题注册表 */
export const THEMES: Record<ThemeMode, ThemeTokens> = {
  dsh: DSH_THEME,
  nodeflow: NODE_FLOW_THEME,
  'nodeflow-light': NODE_FLOW_LIGHT_THEME,
  auto: DSH_THEME, // auto 解析为 dsh（跟随宿主）
};

const STORAGE_KEY = 'dag-flow:theme';

/** 读取当前主题模式（localStorage，默认 nodeflow 深空蓝——对齐 dsh-node-flow） */
export function getThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && v in THEMES) return v as ThemeMode;
  } catch { /* 忽略 */ }
  return 'nodeflow';
}

/** 保存主题模式并应用到 document（data-wf-theme 属性驱动 CSS 变量） */
export function applyTheme(mode: ThemeMode): ThemeTokens {
  try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* 忽略 */ }
  const root = document.documentElement;
  if (mode === 'auto') mode = 'nodeflow';
  root.setAttribute('data-wf-theme', mode);
  return THEMES[mode];
}

/** 获取当前生效的 token（不写存储，用于运行时读） */
export function getActiveTheme(): ThemeTokens {
  return THEMES[getThemeMode()];
}

/**
 * CSS 侧接入：
 * [data-wf-theme="dsh"] 下组件用 var(--dsw-alias-*)（宿主原生）；
 * [data-wf-theme="nodeflow"] 下组件用 --wf-* 变量（映射自 NODE_FLOW_THEME）。
 * 组件代码不直接写两套 —— 统一用 CSS 变量名（--wf-bg / --wf-text ...），
 * 两套主题在 :root[data-wf-theme=...] 下各自定义这些变量即可。
 */
