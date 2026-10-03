// @ts-nocheck
// src/client/index.tsx
// DSH 客户端入口：暴露 apply(ctx)。
//
// bundle 协议：window.__ModuleLoader__.load({ id, factory: (require) => ... })
// factory 返回 module.exports，DSH loader 自动调 module.exports.apply(ctx)。
// （协议 banner/footer 在 scripts/build-client.mjs——客户端防腐点清单见 src/client/dsh-gate.ts）
//
// v20261003-copy-toast：变量复制反馈改浮窗（用户 2026-10-03 原话：「画布的右侧编辑画板里面，上游变量复制和输出变量复制，
//   提示信息，改为浮窗提示：已复制xxxx」）——原实现是在面板底部补一行行内小字（`.dsh-wf-panel-hint`「已复制：xxx」），
//   面板一长就得往下找、还占版面。现在：Portal 到 document.body 的 fixed 浮窗 `.dsh-wf-copy-toast`（底部居中、
//   入场轻微上浮、约 1.6s 自动消失、`pointer-events:none` 不挡操作），文案「📋 已复制 <复制到的变量引用>」。
//   状态用 `{text,n}` 记次数：连点同一个 chip 也能重新弹出（只存字符串时 React 不重渲染、计时器不重置）。
//   作用范围仅「上游变量 / 本节点输出 / 全局变量」三组 chip 的复制反馈；节点悬浮卡的复制按钮（nodes.tsx 的
//   「✓ 已复制」）与失败详情弹窗的复制提示不在本次范围内，未改。
// v20261003-view-zoom：画布视图控件（用户 2026-10-03 原话：「适应画布的按钮现在没啥用，现在刚进工作流画布的时候，
//   画布上的节点太小了，无法看清，最好可以一键放大缩小，方便修改」）——根因：onAllLayersRendered 里**每次渲染都
//   fitView**，大图被硬塞进视口（~30%），节点看不清；而且「适应画布」按钮与这个自动行为重复，所以"没啥用"。
//   ①进画布只设一次初始视图：自适应但夹在 [75%,100%]，**取景保持原样 = 整图内容居中**，此后不再自动改视图
//     （用户自己缩放/拖动后不会被抢回去）；
//   ②「⤢ 适应画布」只由点击触发，缩放下限 50%（大图仍能一键看全貌）；
//   ③「−/＋」按档位一键放大缩小（25/50/75/100/125/150/200%），百分比读数可点 = 「1:1」= 一键回 100%；
//     缩放围绕**当前视口中心**，视觉上不跳。
//   ★ 2026-10-03 用户指示「70%挡位改为75%」：可读下限与档位表一起改（否则进画布那一刻的缩放不在档位上）。
//   ★ 踩坑（真机回归）：初版把居中目标写成起始节点（nodeBounds(start)），等于把整张图往右推——右半边被插件
//     自己的右侧检查器面板（.dsh-wf-right，absolute 浮层）盖住，端口点 elementFromPoint 命中面板，连拖线都
//     起不来（CDP switch-chips 3/3 挂）。改为整图内容居中后恢复。
// v20261003-switch-chips：switch 分支键改「横排 chips」（用户 2026-10-03 反馈：截图里 quick/full/video/image/
//   其他 五个键在卡内**逐行竖着堆**，「很别扭，也会遮挡」→ 原型三选一后拍板 A）。三档策略（端口位置与连线
//   行为一律不变，全部出自同一个 `switchLayout()`）：
//     ≤3 个 case：`labels` 逐行标签（保持原行为，行数少不别扭）
//     4~6 个    ：`chips` 端口行只留极淡序号 ①②③…（右侧与端口同高），分支键**横排成一行 chips** 贴在
//                卡片底部做图例（`1·quick` `2·full` … `★其他`），悬停 chip → 对应行序号高亮放大，拖线不认错；
//                 行距 30→16px、端口起点仍是 22px，5 个 case 卡高 166→**136px**
//     ≥7 个     ：`tight` 行距 12px + 卡内不留字（20 个 case 时 chips 会换很多行，故不启用）
//   ★ 为什么 chips 在底部而不是标题下：实测卡片头部（图标+标题+类型+副标题）本身 ~80px，chips 若放标题下、
//     端口就得整体下移到 112px 起，卡片反而从 166px 涨到 192px（「优化」把节点撑更高，被否）。放底部做图例后
//     端口仍从 22px 起，卡片反而更矮。
// v20261003-loop-jump：子工作流跳转（用户 2026-10-03 原话：「如果选择了要执行的子工作流，那么双击 loop 循环节点
//   可以直接跳到子工作流里面，子工作流也可以一键切回到父工作流的循环节点」）——用户拍板：返回入口用
//   **header 返回胶囊 + 面包屑**（变体 A），适用范围 **loop（循环体）+ subflow（引用的子工作流）**。
//   ① 双击节点 → FlowGramCanvas 的原生 dblclick（此前双击无绑定）→ FlowPanel 判定：
//      loop 取 `params.body.workflowName`、subflow 取 `params.workflowName`，为空则提示「还没选」；
//   ② 跳转前先把当前工作流 flush 一次（重挂载会清掉 2s 防抖计时器，不 flush 会丢盘上最新状态）；
//   ③ 导航栈/守卫/错误提示在 src/client/navStack.ts（**与 CDP 夹具共用同一份逻辑**，夹具只模拟「换 def」）；
//      栈里存**父 def 快照**（含未保存编辑）+ 来源节点 id，返回时原样恢复并**重新选中那个循环节点**；
//   ④ 守卫：未选子工作流 / 子工作流不存在（404）/ 自引用 / 会成环 → 只出提示不跳转。
// v20261003-model-label-top：模型下拉「重进就定位到已选模型」+「已选项带选中标记」（用户 2026-10-03 反馈：
//   重进下拉选没有自动定位到已选择的模型；补充口径：点开下拉时已选中的那条要有一个选中状态标记它，
//   没有已选模型时则任何项都不带标记）——①已选中的那条**挪到列表最前**（紧跟占位项），原生 select 展开即在
//   最上面，不用翻几十条；只调顺序、不复制、不改 value；②当前已选那条的文案前加 **`✓ `**（含「存值不在当前
//   列表」的 `✓ ⚠ …（当前值）` 那条）——原生 option 不能设背景/图标，只能用文案前缀，且它在展开列表与收起
//   显示里都会出现；未选任何模型时（selectedModel===''）任何一项都不带 ✓；③同一个节点被换掉 def 时（换工作流/
//   撤销/别处编辑）用一个 effect 把下拉 value 同步回 def（组件按 node.id 加了 key，切节点会重挂载，换 def 不会）。
// v20261003-model-label：AI 节点模型下拉显示**显示名**（用户 2026-10-03 原话：「ai子代理节点里面的选择模型，
//   最好是改成下拉选显示名称改成模型显示名称，不用模型id，不容易分辨，代码里面可以用模型id确定调用的模型」）。
//   option 文案 = 宿主 llm listModels 给的显示名（deepseek-flash → DeepSeek-V41-Flash），同名时补 provider
//   显示名消歧，宿主没给显示名时回退 model id；**option 的 value 仍是 id**（存值/执行不变），下拉下方细字
//   始终给出「执行 id」便于对照 JSON。旧工作流存了列表里没有的 id 时仍按原样显式列出（行为不变）。
// v20261003-loop-body：循环体 = 子工作流（用户拍板方案 A：能复用就复用，不自研）——loop 节点新增
//   `body:{workflowName, inputs}`，每轮按 `{{vars.loopItem}}`（当轮的项/轮次序号）与 `{{vars.loopIndex}}`
//   解析 inputs 后调用该子工作流，**子工作流 end 节点的输出依次收进 `loop.out.items`**——下游写法与无 body 时
//   完全一致（`{{loop1.out.items}}` / `{{loop1.out.items.0.field}}` / `{{loop1.out.count}}`）。
//   `onIterationError:'continue'` 时失败轮写占位继续跑，默认 stop 则整节点失败但已完成轮次保留在 items 便于排查。
//   引擎侧：run.ts 对 loop 的 body **延迟解析**（body.inputs 里引用了每轮才存在的 loopItem/loopIndex，
//   运行前解析必 DATAFLOW_REF）；面板侧：右侧「🔁 循环设置」新增循环体下拉 + 输入映射 + 失败策略。
//   实现只扩 loop 的 run、复用 subflow 调用机制，不动 topoSort/DAG、不需要画布回边。
// v20261003-switch-compact：switch 分支过多把节点撑大、把流程拉散（用户 2026-10-03 反馈）——自适应紧凑
//   （用户拍板 A+A+）：case ≥ 7 时端口行距 30→12px、**卡内标签隐藏**（每条连线中点本来就有分支键标签，
//   信息不丢）、副标题显示「N 个分支」。端口是连线锚点不能隐藏，所以只压行距与卡内标签。
//   实测 20 个 case：卡片 646px → 286px（-56%），8 case 夹具 286→142px；≤6 个 case 行为完全不变（行距 30）。
// v20261003-loop-visible：loop 循环可见化（用户拍板 P1+P2+P3）——loop 此前在画布上「存在感缺失」
//   （卡片副标题只认 count，配了 over/while 就显示错的 `count=?`；出边与普通线无差别；参数只能去 JSON 改）。
//   P1 卡片副标题按**实际生效边界**显示（引擎优先级 over > count > while）：`循环 3 次` / `遍历 5 项` /
//      `遍历 {{上游.out.数组}}` / `while: 表达式` / `⚠ 无循环边界`，并带上 `· 上限 N`；count/while/over 全缺
//      时问题面板同时报 error（运行必 LOOP_NO_BOUND）。
//   P2 右侧面板新增「🔁 循环设置」区（对齐 switch「🔀 分支设置」）：边界类型下拉 + 对应输入框 + 最大迭代
//      次数 + while 的 dangerouslyAllowInfinite 开关；切换类型时清掉其余两种边界（避免"以为生效其实没生效"）。
//   P3 画布循环标记：loop 出边中点挂紫色「循环」小标（明示下游只执行一次），运行后节点徽标追加
//      `· 循环 N 次`（取自 out.count，落 runStatusStore 的 count 字段）。
// v20261003-branch-fix：修「switch 在线上改分支键：切不回原 case、切换很慢」——根因是改键走
//   DefSync 整文档 fromJSON 重建，而 FlowGram 对被替换掉的线回收不完整：每次编辑都在画布上留一条
//   带旧分支键的幽灵线（实测 8→9→10），看着像"没切过去"，线越积越多还越来越慢。修法：
//   ①改键主路径改为**就地改线**（line.updateInfo → rebindLinePorts + fireChange，官方拖线重连内部走它），
//     并把新 sig 标记为「画布自己产生的变更」让 DefSync 跳过重建 → def 1-6ms、画布标签 3-60ms、无残留；
//   ②DefSync 重建前先 dispose「不在目标边集合里」的现存线——兜住新建 case 等仍走重建的路径，
//     也顺带修掉历史上任何结构变更残留的幽灵线。
// v20261003-branch-edit：分支键就地编辑（方案 C）+ 微调——连线中点的分支标签可点击，在锚点处
//   弹出小面板直接选/改/清空分支键（switch 输入新 case 名会同时写进节点 params.cases 并指向本线目标）；
//   if/switch 的出边若没有分支键 → 琥珀虚线「未设分支」告警 + 问题面板同时列出（执行器对这种线按恒激活，
//   即所有分支都会跑）；标签文案改口语「真/假/其他」（原始键名放 title）；switch 卡随分支数自动增高。
// v20261003-branch-labels：分支条件在画布上显形（用户需求 B）——连线中点显示分支键标签
//   （if: true/false，switch: case 名，'*' → 其他）+ true 绿 / false 红描边（走 free-lines-plugin
//   的 renderInsideLine / customLineProps，singleton 覆盖预设空实例）；节点卡右侧给每个输出
//   端口加同高标签（top = 22 + i*30，与 formMeta 的 locationConfig 对齐）。
// v20261003-picker-path：「打开/新建工作流」下拉里，每个工作流名称后置灰显示它的落盘路径
//   （GET /workflows 每项新增 path 字段；路径跟随目录分隔符、单行省略、完整值放 title；
//    复制出的新行也按 storage.dir 推算路径）。
// v20261003-manual-confirm：manual（手动确认）节点从 v0.1 空壳改为真暂停 + 恢复——
//   POST /run 撞上 manual → 202 { status:'awaiting', runId, awaiting }（不 hold 连接），
//   客户端头部 ⏸ 徽标 + 确认弹窗（底部左「✕ 取消本次运行」右「✓ 确认并继续」，右上 ✕ 只关弹窗），
//   备注经 POST /run/resume 进入 out.value 供下游 {{节点id.out.value}} 取用；
//   GET /run/status 支持刷新后恢复等待态；非交互路径（CLI 工具/subflow 内部）自动通过 + warning。
// v20261002-next-map：分支键 next（if 的 {true,false} / switch 的 { case值: 目标 }）收编为
//   WORKFLOW_SCHEMA.next.oneOf 的单个 object 分支——原来 host schema 只认 {true,false}，
//   画布 fromRF 每次保存都在产 case 映射 → 保存过的 switch 工作流全部报「结构校验未通过」。
//   客户端 JsonView 的精简 schema 同步对齐；校验报错折叠成一条并带「显示名_id(类型)」。
// v20261002-acl1：slots/layout 宿主形状假设收编 src/client/dsh-gate.ts（客户端防腐层）——
//   DSH 客户端升版改 slots/layout API 时只改那边；本文件只做业务编排。
//   之前版本在这里吃过的亏：inject 了宿主没有的服务 → 抛错被 mountContribution
//   路径 catch 不住 → 整个插件静默失败（v0.3→v0.4 教训，已固化为防腐层探测）。

import { Component, createElement, useEffect, useRef, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FlowPanel } from './FlowPanel';
import { SettingsPage } from './SettingsPage';
import { DEFAULT_WORKFLOW, type WorkflowDef } from './types';
import { applyTheme, getThemeMode } from './theme';
import { mountSidebarEntry } from './sidebar';
import { openWorkflowPicker } from './workflow-picker';
// 子工作流导航（2026-10-03 用户需求）：栈/守卫在 navStack.ts，与 CDP 夹具共用同一份逻辑
import { bindNavSwap, backToParentWorkflow, enterSubWorkflow, navCrumbs, navCurrentName, navFocusNodeId, setNavCurrent } from './navStack';
import {
  CLIENT_INJECT,
  registerSettingsSection,
  registerMainPanel,
  dumpMainPanelKeys,
  selectPanel as gateSelectPanel,
  type ClientHost,
} from './dsh-gate';
import './styles.css'; // ★ 注入插件独立主题样式（esbuild dsh-css-inject 转运行时 <style>）

let activeRoot: Root | null = null;
let activeEl: HTMLElement | null = null;

// ==================== 窗口化面板（legacy，2026-10-01 起默认停靠模式，入口不再调用） ====================
// 缓存键：停靠模式的「内容缓存」（切换回会话保留，重开继续编辑）
const WF_CACHE_KEY = 'dag-flow:def-cache';

interface WinState {
  el: HTMLElement;
  titleBar: HTMLElement;
  body: HTMLElement;
  mode: 'normal' | 'max' | 'min';
  pos: { x: number; y: number };
  size: { w: number; h: number };
}
let win: WinState | null = null;

function clearCache(): void {
  try { localStorage.removeItem(WF_CACHE_KEY); } catch { /* 忽略 */ }
}

function makeWinBtn(text: string, title: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `dsh-wf-win-btn${cls ? ' ' + cls : ''}`;
  b.textContent = text;
  b.title = title;
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

function applyWinLayout(): void {
  if (!win) return;
  const { el, body, mode, pos, size } = win;
  if (mode === 'min') {
    // 最小化：左下角小标签，只留标题栏
    el.style.cssText = 'position:fixed;left:16px;bottom:16px;width:220px;height:38px;z-index:9999;min-width:0;min-height:0;';
    body.style.display = 'none';
    el.classList.add('dsh-wf-win-min');
  } else if (mode === 'max') {
    el.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:9999;';
    body.style.display = 'flex';
    el.classList.remove('dsh-wf-win-min');
  } else {
    el.style.cssText = `position:fixed;left:${pos.x}px;top:${pos.y}px;width:${size.w}px;height:${size.h}px;z-index:9999;`;
    body.style.display = 'flex';
    el.classList.remove('dsh-wf-win-min');
  }
}

function minimizeWin(): void { if (win) { win.mode = 'min'; applyWinLayout(); } }
function toggleMaxWin(): void {
  if (!win) return;
  win.mode = win.mode === 'max' ? 'normal' : 'max';
  applyWinLayout();
}
function restoreFromMin(): void { if (win && win.mode === 'min') { win.mode = 'normal'; applyWinLayout(); } }

function closeWin(): void {
  if (!win) return;
  // 关闭面板即清空未保存数据（重新打开需重新做工作流再保存）
  clearCache();
  unmount();
  win.el.remove();
  win = null;
}

function openWorkflowWindow(initialDef?: WorkflowDef): void {
  // 已打开 → 恢复（最小化时回到正常）；若带 initialDef 则切换面板内容为新工作流
  if (win) {
    if (win.mode === 'min') restoreFromMin();
    win.el.style.zIndex = '9999';
    if (initialDef) mountWorkflowPanel(win.body, { workflow: initialDef });
    return;
  }
  const el = document.createElement('div');
  el.id = 'dag-flow-win';
  el.className = 'dsh-wf-win';

  // 标题栏（可拖拽）
  const titleBar = document.createElement('div');
  titleBar.className = 'dsh-wf-win-titlebar';
  const title = document.createElement('span');
  title.className = 'dsh-wf-win-title';
  title.textContent = '⚡ 自定义工作流';
  const btns = document.createElement('div');
  btns.className = 'dsh-wf-win-btns';
  btns.appendChild(makeWinBtn('—', '最小化', minimizeWin));
  btns.appendChild(makeWinBtn('▢', '最大化 / 还原', toggleMaxWin));
  btns.appendChild(makeWinBtn('✕', '关闭（清缓存）', closeWin, 'dsh-wf-win-btn-close'));
  titleBar.appendChild(title);
  titleBar.appendChild(btns);

  // 内容区（React 挂载 FlowPanel）
  const body = document.createElement('div');
  body.className = 'dsh-wf-win-body';

  el.appendChild(titleBar);
  el.appendChild(body);
  document.body.appendChild(el);

  // 中等大小：居中 780×560
  const W = Math.min(780, window.innerWidth - 60);
  const H = Math.min(560, window.innerHeight - 80);
  win = {
    el, titleBar, body,
    mode: 'normal',
    pos: { x: Math.max(8, Math.round((window.innerWidth - W) / 2)), y: Math.max(8, Math.round((window.innerHeight - H) / 2)) },
    size: { w: W, h: H },
  };
  applyWinLayout();

  // 标题栏拖拽移动
  let dragging = false;
  let offX = 0; let offY = 0;
  titleBar.addEventListener('mousedown', (e: MouseEvent) => {
    if (win!.mode === 'max' || win!.mode === 'min') return;
    dragging = true;
    offX = e.clientX - win!.pos.x;
    offY = e.clientY - win!.pos.y;
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (!dragging || !win || win.mode !== 'normal') return;
    win.pos.x = Math.max(0, e.clientX - offX);
    win.pos.y = Math.max(0, e.clientY - offY);
    applyWinLayout();
  });
  window.addEventListener('mouseup', () => { dragging = false; });
  // 双击标题栏最大化
  titleBar.addEventListener('dblclick', (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.dsh-wf-win-btns')) return;
    toggleMaxWin();
  });

  // 挂载 FlowPanel（带 initialDef = 从弹窗选定的/新建的工作流；无则用默认工作流）
  mountWorkflowPanel(body, { workflow: initialDef });
}

function mountWorkflowPanel(target: HTMLElement, opts: any = {}): void {
  if (activeRoot) unmount();
  activeEl = target;
  activeRoot = createRoot(target);
  // 兜底：opts 为空对象时注入默认工作流，避免 FlowPanel 白屏
  const ctx = { ...opts, workflow: opts.workflow ?? DEFAULT_WORKFLOW };
  activeRoot.render(
    createElement(FlowPanel, {
      ctx,
      onMount: () => {},
      onClose: opts.onClose ?? (() => closeWin()),
      onCache: opts.onCache,
    })
  );
}

function unmount(): void {
  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
  }
  if (activeEl) {
    activeEl.innerHTML = '';
    activeEl = null;
  }
}

// inject 名单唯一来源 = 客户端防腐层（slots=设置页分区/主区面板；layout=面板切换）
export const inject: string[] = CLIENT_INJECT;

// ==================== 停靠模式（2026-10-01）：画布进驻 DSH 中央面板 ====================
// 依据 live Slots 树：`main` 是 keyed slot（"Central panel selected by sidebar entry id"，
// 已占用 key: conversation，开放域可注册新 key）——注册 key='dag-flow' 的面板，点击
// 侧栏入口（sidebar.ts 自愈注入）即在会话区域位置展示画布。槽位注册/面板切换的
// DSH 形状假设全在 src/client/dsh-gate.ts（客户端防腐层）。

let hostCtx: ClientHost = null;
let dockOpenRequest: (() => void) | null = null;

// 停靠画布的 def 外置存储：FlowPanel onCache 静默同步（不触发重挂，保住内部编辑态）；
// 选择/新建/入口点击时 bump 版本号，让 DockedMainPanel 以新 def 重挂载。
let dockDef: WorkflowDef | null = null;
/** 从子工作流返回父工作流时要重新选中的节点（navStack 通过 bindNavSwap 回传） */
let dockFocusNodeId: string | null = null;
let dockVersion = 0;
const dockListeners = new Set<() => void>();

function readCacheDef(): WorkflowDef | null {
  try {
    const raw = localStorage.getItem(WF_CACHE_KEY);
    return raw ? (JSON.parse(raw) as WorkflowDef) : null;
  } catch { return null; }
}

function setDockDef(def: WorkflowDef, bump: boolean): void {
  dockDef = def;
  try { localStorage.setItem(WF_CACHE_KEY, JSON.stringify(def)); } catch { /* 忽略 */ }
  if (bump) { dockVersion++; dockListeners.forEach((l) => l()); }
}

function subscribeDock(listener: () => void): () => void {
  dockListeners.add(listener);
  return () => { dockListeners.delete(listener); };
}

// ================= 子工作流导航（2026-10-03 用户需求）=================
// 需求原话：「如果选择了要执行的子工作流，那么双击 loop 循环节点可以直接跳到子工作流里面，
//          子工作流也可以一键切回到父工作流的循环节点」→ 用户拍板返回入口用「header 返回胶囊 + 面包屑」，
//          适用范围 loop（循环体）+ subflow（引用的子工作流）。
// 栈与守卫在 src/client/navStack.ts（与 CDP 夹具共用同一份真实逻辑）；这里只提供「换 def」能力：
// 停靠面板 bump 版本号重挂载 FlowPanel（与「打开已有工作流」同一条通路）。
bindNavSwap((def, focus) => {
  dockFocusNodeId = focus;
  setDockDef(def, true);
});

/** 回到会话面板（防腐层 selectPanel；layout 不可用时静默）。 */
function backToConversation(): void {
  gateSelectPanel(hostCtx, 'conversation');
}

/** 渲染错误的可视化边界：停靠面板出错时显示错误详情而非空白（方便真机排障） */
class DockErrorBoundary extends Component<{ children: any }, { error: Error | null }> {
  constructor(props: any) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: unknown) {
    console.error('[dag-flow] dock render error:', error, info);
  }
  render() {
    if (this.state.error) {
      return createElement('div', { style: { padding: 20, color: '#f87171', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 } },
        createElement('div', null, `停靠面板渲染失败：${String(this.state.error?.message ?? this.state.error)}`),
        createElement('pre', { style: { whiteSpace: 'pre-wrap', fontSize: 11, marginTop: 10 } }, String(this.state.error?.stack ?? '')),
      );
    }
    return this.props.children;
  }
}

/** main 区的停靠面板：头部工具行 + 独立 React root 承载 FlowPanel。
 *  ★ 与 legacy 窗口模式同款挂载方式（createRoot 独立挂载，真机验证过）——
 *  在宿主 React 树内直接渲染 FlowPanel/FlowGram 会触发打包内 TDZ 崩溃
 *  （Cannot access 'o' before initialization，2026-10-01 真机实测）；
 *  dockVersion 变化时重挂以切换工作流。 */
function DockedMainPanel(): any {
  const bodyRef = useRef(null);
  useSyncExternalStore(subscribeDock, () => dockVersion);
  useEffect(() => {
    if (!bodyRef.current) return;
    const def = dockDef ?? readCacheDef() ?? DEFAULT_WORKFLOW;
    console.log('[dag-flow] dock mount v' + dockVersion, 'def=' + (def?.name ?? '(null)'));
    mountWorkflowPanel(bodyRef.current, {
      workflow: def,
      onCache: (d: WorkflowDef) => {
        setNavCurrent(d);              // 让导航栈知道当前 def（进入子工作流时要压「父 def 快照」）
        setDockDef(d, false);
      },
      onClose: () => backToConversation(),
      // 子工作流导航（loop 循环体 / subflow 目标）：进入 + 一键返回父工作流的来源节点
      nav: {
        crumbs: navCrumbs(),           // 从外到内的父链（不含当前）
        current: navCurrentName() || def.name || '',
        enter: enterSubWorkflow,
        back: backToParentWorkflow,
      },
      // 返回父工作流时要重新选中的节点（来源循环节点）；进入子工作流时为 null
      focusNodeId: navFocusNodeId(),
    });
    return () => { unmount(); };
  }, [dockVersion]);
  return createElement('div', { className: 'dsh-wf-dock' },
    createElement('div', { className: 'dsh-wf-dock-head' },
      createElement('span', { className: 'dsh-wf-dock-title' }, '⚡ 自定义工作流'),
      createElement('span', { className: 'dsh-wf-dock-sub' }, '停靠在会话区域 · 数据落 <工作区>/.dag-flow/'),
      createElement('div', { className: 'dsh-wf-dock-actions' },
        createElement('button', {
          className: 'dsh-wf-dock-btn', type: 'button',
          onClick: () => {
            // 打开当前工作区的工作流数据文件夹（<工作区>/.dag-flow/，系统文件管理器）
            fetch('/api/dag-flow/open-folder', { method: 'POST', credentials: 'include' })
              .then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`); })
              .catch((e) => { console.error('[dag-flow] open folder failed:', e); alert('打开文件夹失败：' + (e as Error).message); });
          },
          title: '打开工作流数据文件夹（<工作区>/.dag-flow/）',
        }, '📁 工作流文件夹'),
        createElement('button', {
          className: 'dsh-wf-dock-btn', type: 'button',
          onClick: () => dockOpenRequest?.(), title: '选择历史工作流或新建',
        }, '➕ 打开 / 新建'),
        createElement('button', {
          className: 'dsh-wf-dock-btn dsh-wf-dock-btn-primary', type: 'button',
          onClick: () => backToConversation(), title: '回到会话（画布内容保留，可随时回来）',
        }, '返回会话'),
      ),
    ),
    createElement('div', { className: 'dsh-wf-dock-body', ref: bodyRef }),
  );
}

export function apply(ctx: any): void {
  // 初始化主题（从 localStorage 恢复 data-wf-theme，默认跟随 DSH）
  try { applyTheme(getThemeMode()); } catch { /* 忽略 */ }
  // 顶层 try/catch：任何 inject 失败不影响其它
  try {
    hostCtx = ctx ?? null;

    // 1. settings.section — 设置页"工作流配置"分区（形状假设/容错在防腐层）
    registerSettingsSection(ctx, { id: 'dag-flow.settings', order: 80, label: '工作流配置' }, SettingsPage);

    // 2. 侧栏入口（左上方"新会话"按钮下方）：点击 = 直接切到主区域停靠画布
    //    （与"新会话"切到会话面板同款交互，不弹窗）。宿主 DOM 锚点/样式拷贝在 sidebar.ts（专职 DOM 防腐点）。
    try {
      mountSidebarEntry(() => {
        setDockDef(dockDef ?? readCacheDef() ?? DEFAULT_WORKFLOW, true);
        gateSelectPanel(hostCtx, 'dag-flow');
      });
    } catch (e) {
      console.warn('[dag-flow] sidebar entry mount failed:', e);
    }

    // 3. 主区域停靠面板（keyed main，与 conversation/plugins 同机制）。
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

    // 选择/新建工作流 → 换 def 并切到停靠画布
    dockOpenRequest = () => openWorkflowPicker((def) => {
      setDockDef(def, true);
      gateSelectPanel(hostCtx, 'dag-flow');
    });

    // ★ bundle 版本标记：真机 DevTools 控制台可确认加载的是新构建（旧缓存 bundle 无此行）
    console.log('[dag-flow] client v20261003-copy-toast · apply OK');
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
export { SettingsPage } from './SettingsPage';
export { NODE_PALETTE } from './types';
export type { WorkflowDef, MountContext } from './types';
