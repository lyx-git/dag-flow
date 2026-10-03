// @ts-nocheck
// src/client/SettingsPage.tsx
// 设置页「工作流」分区：仅主题切换。
// 模型/密钥不在 dag-flow 手配——AI 节点自动发现并列出 dsh 已配置的全部模型（settings.yaml），
// 执行所需密钥均取自 dsh（credentials.yaml / 环境变量）。

import { createElement, useState } from 'react';
import { getThemeMode, applyTheme, THEMES } from './theme';

const THEME_LABELS: Record<string, string> = {
  dsh: '跟随 DSH 风格',
  nodeflow: 'Node-Flow 深色',
  'nodeflow-light': 'Node-Flow 浅色',
  auto: '自动（跟随 DSH）',
};

export function SettingsPage(_props: any): any {
  const [themeMode, setThemeMode] = useState<string>(() => getThemeMode());

  const setMode = (mode: string): void => {
    setThemeMode(mode);
    try { applyTheme(mode); } catch { /* 忽略 */ }
  };

  return createElement(
    'div',
    { className: 'dsh-wf-settings' },
    createElement(
      'div',
      { className: 'dsh-wf-panel-row' },
      createElement('label', { className: 'dsh-wf-panel-label' }, '🎨 画布主题'),
      createElement(
        'select',
        {
          className: 'dsh-wf-input',
          value: themeMode,
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setMode(e.target.value),
        },
        Object.entries(THEME_LABELS).map(([k, v]) => createElement('option', { key: k, value: k }, v)),
      ),
    ),
    createElement(
      'div',
      { className: 'dsh-wf-panel-hint' },
      'AI 节点使用的模型自动取自 dsh 已配置的模型（settings.yaml），无需在此配置。',
    ),
  );
}
