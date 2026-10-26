// src/client/index.tsx
// DSH 客户端入口：暴露 apply(ctx)（bundle 协议在 scripts/build-client.mjs；客户端防腐点在 src/client/dsh-gate.ts）。
// 装配：主题初始化 + 侧栏入口 + 主区域停靠面板（DockedMainPanel）+ 停靠切面板接线 + bundle 版本标记。
// ★ 各版本的变更原因与用户原话已归档：docs/CLIENT-VERSION-NOTES.md（本文件不再追加历史）。
// 当前版本标记：见下方 `CLIENT_VERSION` 常量（**唯一出处** —— 2026-10-17 起头注释不再写死版本串：
// 原先"头注释 + apply() 的 console.log"两处手写，升位时容易漏改一处；改客户端必升位）。

/** ★ 客户端版本标记的唯一出处（升位只改这一行）。产物级闸门＝tmp-test/verify-build-markers.mjs。 */
export const CLIENT_VERSION = 'v20261022-noagentpreset';

import { applyTheme, getThemeMode } from './theme';
import { mountSidebarEntry } from './sidebar';
import {
  CLIENT_INJECT,
  registerMainPanel,
  dumpMainPanelKeys,
} from './dsh-gate';
import { mountWorkflowPanel, unmount } from './panel-mount';
import { DockedMainPanel, setDockHost, openDockedCanvas, wireDockOpenRequest, pruneStaleCachedDef } from './dock';
import './styles.css'; // ★ 注入插件独立主题样式（esbuild dsh-css-inject 转运行时 <style>）
import './styles-dialogs.css'; // ★ 第二段（弹窗/浮层群）：紧邻上一条 import，运行时 <style> 顺序 = 拆分前段落顺序

// inject 名单唯一来源 = 客户端防腐层（slots=设置页分区/主区面板；layout=面板切换）
export const inject: string[] = CLIENT_INJECT;

export function apply(ctx: any): void {
  // 初始化主题（从 localStorage 恢复 data-wf-theme，默认跟随 DSH）
  try { applyTheme(getThemeMode()); } catch { /* 忽略 */ }
  // 顶层 try/catch：任何 inject 失败不影响其它
  try {
    setDockHost(ctx ?? null);

    // 1. 侧栏入口（左上方"新会话"按钮下方）：点击 = 直接切到主区域停靠画布
    //    （与"新会话"切到会话面板同款交互，不弹窗）。宿主 DOM 锚点/样式拷贝在 sidebar.ts（专职 DOM 防腐点）。
    try {
      mountSidebarEntry(() => openDockedCanvas());
    } catch (e) {
      console.warn('[dag-flow] sidebar entry mount failed:', e);
    }

    // 2. 主区域停靠面板（keyed main，与 conversation/plugins 同机制）。
    //    ★ generator + yield 注册形态与 selectPanel 的 key 校验假设都在防腐层
    //      （注册未生效时切换会抛 "main panel ... not registered"，2026-10-01 真机踩坑）。
    //    ★ 不注册 sidebar.panellist 行：入口按钮即切换，无需额外面板按钮（用户反馈）。
    if (!ctx?.layout || typeof ctx.layout.selectPanel !== 'function') {
      console.warn('[dag-flow] ctx.layout.selectPanel missing; dock switch disabled');
    }
    registerMainPanel(ctx, { key: 'dag-flow' }, DockedMainPanel);
    dumpMainPanelKeys(ctx, 'apply');
    setTimeout(() => dumpMainPanelKeys(ctx, 't+1.5s'), 1500);
    setTimeout(() => dumpMainPanelKeys(ctx, 't+5s'), 5000);

    // 选择/新建工作流 → 换 def 并切到停靠画布（接线收进 dock 模块）
    wireDockOpenRequest();

    // ★ 2026-10-19（第二轮修「删了还能看到」）：清掉「指向已删工作流」的历史画布缓存。
    //   只在删除那一刻清缓存是不够的——用户可能在新版本之前就删完了，删除事件早过去了。
    //   这里在启动时做一次存在性校验（详见 dock.tsx 的 pruneStaleCachedDef 注释）。
    void pruneStaleCachedDef().then((pruned) => {
      if (pruned) console.log('[dag-flow] 已清掉指向已删工作流的本地画布缓存（画布回落到空白工作流）');
    });

    // ★ bundle 版本标记：真机 DevTools 控制台可确认加载的是新构建（旧缓存 bundle 无此行）
    console.log(`[dag-flow] client ${CLIENT_VERSION} · apply OK`);
  } catch (e) {
    console.error('[dag-flow] client apply failed:', e);
  }
}

// 也保留 mount/unmount 给外部用
export { mountWorkflowPanel as mount, unmount };

// 默认导出 = { apply, inject, mount, unmount } —— DSH loader 看 .apply 自动调
export default { apply, inject, mount: mountWorkflowPanel, unmount };

// 辅助 re-export
export { FlowPanel } from './FlowPanel';
export { NODE_PALETTE } from './types';
export type { WorkflowDef, MountContext } from './types';
