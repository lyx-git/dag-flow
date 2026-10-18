// src/client/perf-marks.ts — 画布首屏里程碑诊断（**不参与任何业务逻辑**，只往 window 上写一个对象）
/**
 * 为什么要有这个文件：画布首屏在 CDP 夹具里实测 150–182ms（6–23 节点），但夹具复刻不了真机的三件事 ——
 *   ① `client.js` 是 1.79MB minified（夹具是未压缩的单文件，解析/执行特征不同）；
 *   ② 真机要过 `dock.tsx` 的停靠外壳（主题 CSS 注入、chromeSlot portal、宿主面板尺寸协商）；
 *   ③ 真实 def 体量与「内存 → 本地缓存 → 默认值」这条 def 来源路径。
 * 与其按夹具数字猜、去优化一个可能不存在的瓶颈，不如让真机自己报数。
 *
 * 读法（打开画布后，DevTools 控制台一行）：
 *   copy(JSON.stringify(window.__df_firstPaint))
 * 结果形如：
 *   {"at":1760..., "nodes":6, "marks":{"panelMount":0,"canvasMount":38,"initialView":121,"veilGone":129}}
 * 所有 mark 都是**自 panelMount 起的毫秒数**，同名只记第一次；每次重新挂载（切换工作流 / 重开画布）都会重置。
 * ★ 只在挂载/首帧各写一次，没有定时器、没有监听器，不进渲染路径。
 */
const KEY = '__df_firstPaint';

let t0 = 0;
let marks: Record<string, number> = {};
let info: { nodes?: number; edges?: number } = {};

function now(): number {
  try { return performance.now(); } catch { return Date.now(); }
}

function publish(): void {
  try {
    (window as any)[KEY] = { at: Date.now(), nodes: info.nodes, edges: info.edges, marks: { ...marks } };
  } catch { /* 没有 window 的宿主环境：静默 */ }
}

/** 开始新一轮计时（每次画布挂载时调用，`panelMount` 恒为 0 基准点） */
export function fpReset(): void {
  t0 = now();
  marks = { panelMount: 0 };
  info = {};
  publish();
}

/** 记一个里程碑（相对 panelMount 的 ms；同名幂等，不会被后续调用覆盖） */
export function fpMark(name: string): void {
  if (!t0 || marks[name] !== undefined) return;
  marks[name] = Math.round(now() - t0);
  publish();
}

/** 补充统计（节点/边数），与里程碑一起发布 */
export function fpInfo(patch: { nodes?: number; edges?: number }): void {
  info = { ...info, ...patch };
  publish();
}
