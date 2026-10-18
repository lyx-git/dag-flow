// src/client/FlowPanel.tsx
// 顶层面板：画布/JSON 视图共享同一份 WorkflowDef（lifted state）。
// 顶部 tab + 💾保存 + ▶运行；中部当前 tab；右侧节点详情。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createElement } from 'react';
// ★ 代码编辑弹窗用 Portal 渲染到 document.body——右侧面板有 backdrop-filter（blur 浮层），
//   会让面板内 position:fixed 的弹窗以面板为包含块（弹窗被困在面板里，2026-10-02 用户反馈）
import { createPortal } from 'react-dom';
import type { MountContext, ViewTab, WorkflowDef } from './types';
import { DEFAULT_WORKFLOW, findMeta, outSpecOf } from './types';
import { fieldsFromValue } from './outFields';
// ★ 2026-10-11：代码级文本编辑框抽成独立组件（参数编辑器的长文本值 / JSON 视图都用它）；
//   高亮函数随之搬到 code-text.tsx（python/bash 规则原样保留，另加 json / text 两种）。
import { ParamsEditor } from './params-editor';
// ★ 2026-10-11：变量抽屉用「与变量弹窗同源」的分组数据（组装在 NodeInspector 里，渲染交给 VarPicker）
import type { VarPickGroup } from './var-picker';
// ★ 2026-10-11 用户拍板方案 A：试跑本节点集成进「参数与试跑」弹窗（底部常驻试跑条）；
//   ★ 用户真机反馈后修正：试跑结果**只在弹窗里显示**，面板不再渲染一份 ⇒ 这里只留类型导入
//     （结果状态仍在 NodeInspector 里，作为 prop 传给弹窗）。
import type { TestResult } from './test-result';
// ★ 运行进度 → 节点状态（2026-10-03 用户需求：待运行/运行中/完成/失败，按运行路径依次显示）
import { progressToStatusMap } from './runProgress';
import { toRF, fromRF, canonicalizeDef, newNodeId, type RFNode, type RFEdge } from './util/flowDef';
import { buildGraphSvg, svgToPngBlob, type GraphImageNode, type GraphImageEdge } from './util/graphImage';
import { varMatch } from './util/varSearch';
import { applyAutoLayout } from './util/layout';
import { Canvas } from './flowgram/FlowGramCanvas';
import { disposeCanvasNode } from './flowgram/FlowGramCanvas';
// ★ 2026-10-16 用户拍板方案 B：撤销/重做走**自建快照栈**（FlowGram 自带 history 在本项目恒为空 ——
//   位移走自建拖拽引擎绕过 operationService，且每次 def→fromJSON 都触发 onReload→clear，详见该文件头注释）
import { resetUndoPending } from './undo-stack';
// ★ 2026-10-17：撤销/重做的接线（observe/applier/基线/快捷键/诊断钩子）抽到 undo-wiring.ts ——
//   本文件当时已 1587 行，越过项目 500 行软上限
import { useUndoWiring } from './undo-wiring';
// ★ 2026-10-14 重构轮 6：模块级工具与检查器字段表单拆至 panel-utils.ts / inspector-fields.tsx（纯搬运）
//   ★ 2026-10-14 弹窗专项收尾：轮 6 搬走的工具在主文件的引用随弹窗拆分全部迁入 dialogs/*
//   ★ 2026-10-15 画布/JSON 拆独立按钮后 TABS 不再被引用（panel-utils 里的 TABS 定义同步删除）
import { SessionInputFields, MediaFields, WebFields } from './inspector-fields';
// ★ 2026-10-14 重构轮 7：右侧检查器整体拆至 NodeInspector.tsx（840 行一个组件，不二次切）
import { NodeInspector } from './NodeInspector';
// ★ 2026-10-14 弹窗专项批 1：工作流参数/历史版本弹窗成对拆出（hook 状态留在本组件实例）
import { useInputsDialog, InputsDialogView } from './dialogs/inputs-dialog';
import { useVersionsDialog, VersionsDialogView } from './dialogs/versions-dialog';
import { useSchedulesDialog, SchedulesDialogView, ScheduleRunConfirmView } from './dialogs/schedule-dialog';
import { useRunLogDialog, RunLogDialogView } from './dialogs/run-log-dialog';
import { useRunResult } from './run-result';
import { useRunControl } from './panels/run-control';
import { useNodeEditing } from './panels/node-editing';
import { useWorkflowIo } from './panels/workflow-io';
import { renderBody } from './panels/render-body';
import { ManualDialogView } from './dialogs/manual-dialog';
import { useSelfcheckDialog, SelfcheckOkDialogView, SelfcheckBlockDialogView } from './dialogs/selfcheck-dialog';
// ★ 失败策略显形（2026-10-04 轮 7）：def 里的策略同步进 store，卡片订阅后显示 chip
import { failPolicyStore } from './flowgram/failPolicyStore';
import { JsonView } from './JsonView';
import { normalizeWorkflowName } from '../name-rule';
import { ensurePickerStyles } from './workflow-picker';
import { startResize8, readStoredJSON, saveJSON, clampNum, type RightGeom } from './util/edge-drag';
// ★ 定时任务的 cron 校验/中文预览已随 ⏰ 弹窗迁入 dialogs/schedule-dialog.tsx（复用宿主同一纯模块）
// ★ 全局悬浮提示接管（2026-10-13 用户要求：悬浮内容要能复制/选中，且外观与插件主题一致）——
//   模块副作用初始化（幂等）：真机入口与 CDP 夹具都从本模块进入 ⇒ 一处生效。
import { initHoverTips } from './hover-tip';
// ★ 2026-10-15 用户拍板：头部三颗图标换成 14px 线条 SVG（JSON＝大括号 / 导出/导入＝托盘+箭头）
//   ★ 同日追加「按钮大小/形式/颜色都统一下」⇒ 其余 6 颗 emoji 也一并换成同规格线条图标
import {
  iconJsonBraces, iconExportTray, iconImportTray,
  iconCanvas, iconParams, iconSave, iconHistory, iconSchedule, iconRunLog,
} from './header-icons';
initHoverTips();


interface FlowPanelProps {
  ctx: MountContext;
  onMount?: () => void;
  onClose?: () => void;
  onCache?: (def: WorkflowDef) => void;
  /** ★ 2026-10-15 用户要求：「将画布上部中间栏的工作流名和保存状态移到上面栏的自定义工作流，替换掉自定义工作流，
   *  图标也替换掉，中间栏的图标还是居中放置」⇒ 停靠模式把上面栏的占位容器传进来，标识区（logo + 名字输入框 +
   *  保存状态）整块 portal 过去；**没传**（legacy 窗口模式 / CDP 夹具）就仍然在 header 内原地渲染。
   *  一条分支两种形态：状态、改名、自动保存逻辑一行没改，只换渲染位置。 */
  chromeSlot?: HTMLElement | null;
}


export function FlowPanel({ ctx, onClose, onCache, chromeSlot }: FlowPanelProps) {
  const [tab, setTab] = useState<ViewTab>('canvas');
  const [def, setDef] = useState<WorkflowDef>(() => ctx.workflow ?? DEFAULT_WORKFLOW);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(() => {
    // ★ 从子工作流返回父工作流时，重挂载要选中「来源循环节点」（index.tsx 的 nav.focusNodeId）
    const f = (ctx as unknown as { focusNodeId?: string | null })?.focusNodeId;
    return f ?? null;
  });
  // ★ 子工作流导航（2026-10-03 用户需求：双击 loop/subflow 进入子工作流，header 一键返回）
  const nav = (ctx as unknown as { nav?: {
    crumbs?: string[];
    current?: string;
    enter?: (workflowName: string, fromNodeId: string) => Promise<{ ok?: true; error?: string }>;
    back?: () => { ok?: true; error?: string };
  } })?.nav;
  const [navMsg, setNavMsg] = useState('');
  const flashNavMsg = (msg: string): void => {
    setNavMsg(msg);
    window.setTimeout(() => setNavMsg((cur) => (cur === msg ? '' : cur)), 4000);
  };
  const [dirty, setDirty] = useState(false);
  // ★ 2026-10-19 用户拍板 A：**改名撞名绝不允许覆盖**（与「创建」那条路径同一把尺子）。
  //   这里存"当前名字已被别的工作流占用"，用于：状态栏红字提示 + 禁用保存 + 停掉自动保存。
  //   （服务端 storage.writeWorkflow 也会硬拦一层，这里只是让用户早点看到、别把改动丢掉。）
  const [nameTaken, setNameTaken] = useState(false);
  // ★ 2026-10-19（用户原话：「自动保存改为如果有工作流名称才自动创建，没有工作流名称，就不创建」）：
  //   **自动保存的判据＝有没有名字**（不再看磁盘存在性）：
  //   · 有名字 ⇒ 照常自动保存（含首次创建，用户输入名字即视为要保存）；
  //   · 没名字 ⇒ 只改内存，绝不写盘 ⇒ 删除工作流后回落的"未命名空画布"
  //     不会凭空在磁盘上建出任何文件（旧行为正是在这里写出 `my-workflow.json`）。
  //   空名也是一种正常状态：名字框为空（显示 placeholder「工作流名称」），画布可随便编，
  //   用户填了名字之后才开始自动保存。
  // ★ 自动保存状态机（2026-10-01 夜，用户需求实时/定时保存）：idle | pending（将自动保存）| saving | error
  const [autoSave, setAutoSave] = useState<'idle' | 'pending' | 'saving' | 'error'>('idle');
  // ★ 右侧编辑面板最小化（2026-10-01 夜）：单击选中节点时强制展开（见 handleSelectNode）
  const [rightMin, setRightMin] = useState(false);
  // ★ 右侧面板几何可拖八向调节（2026-10-01 夜用户需求：四周边缘线和角），localStorage 记忆；
  //   h=null 表示高度拉伸态（top/bottom 双锚），拖过 n/s 边后转为定高
  const rightRef = useRef<HTMLElement | null>(null);
  const [rightGeom, setRightGeom] = useState<RightGeom>(() => readStoredJSON<RightGeom>(
    'dag-flow:right-geom',
    { r: 14, y: 14, w: 340, h: null },
    (raw) => ({
      r: clampNum(raw?.r, 14, 0, 80),
      y: clampNum(raw?.y, 14, 0, 2000),
      w: clampNum(raw?.w, 340, 260, 560),
      h: typeof raw?.h === 'number' ? clampNum(raw.h, 400, 220, 1400) : null,
    }),
  ));

  // ★ 2026-10-15 用户拍板（头部按钮重排方案 A「频率对称带」+ 窄屏收纳）：
  //   ① 所有功能按钮收进一条 `.dsh-wf-btnband`，在「标识区之后到右边缘」之间居中（左右 auto margin，
  //      不用绝对定位 ⇒ 面板再窄也不会压到工作流名输入框）；内部排列＝越靠中间越常用：
  //      正中 ▶ 运行，紧邻 🎨 画布 / 💾 保存，再外 {} /🧾，最外 导出/导入/⏰/✍️。
  //   ② 面板窄到放不下时，把最低频的三颗（导入 / 导出 / ⏰ 定时任务）收进「⋯ 更多」菜单。
  //   ★ 标识区（logo + 工作流名输入框 + 保存状态）一个像素都不动 —— 用户明确要求「只动按钮」。
  const headerRef = useRef<HTMLElement | null>(null);
  const [headerNarrow, setHeaderNarrow] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreAt, setMoreAt] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    // 阈值：标识区约 272 + 按钮带满配约 406 + 内边距/间隙约 28 = 706，再留出运行中「⏹ 取消」约 90 的余量。
    // 收纳掉导入/导出/定时后按钮带约 295 ⇒ 窄屏下仍有富余。
    const NARROW_AT = 800;
    const apply = () => setHeaderNarrow(el.clientWidth < NARROW_AT);
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    apply();
    return () => ro.disconnect();
  }, []);

  // ================= 撤销/重做接线（抽到 undo-wiring.ts，2026-10-17）=================
  // def 是**唯一事实来源**，更新它的地方有 9 处 setDef（画布上抛 / 参数 / 增删节点 / 装饰 / JSON 视图…）
  // ⇒ 与其逐处插桩（易漏），不如在 def 变化处统一 observe（见 undo-wiring.ts 的 ① 与它的注释）。
  useUndoWiring(def, setDef, setDirty);

  // 自动缓存：def 变化即通过 onCache 上报（供关闭后重开恢复）
  useEffect(() => {
    try { onCache?.(def); } catch { /* 忽略 */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def]);

  // 派生 RF 视图（Canvas/Thumb 共享）
  const { nodes: rfNodes, edges: rfEdges } = useMemo(() => toRF(def), [def]);


  // 保存
  const handleSave = useCallback(() => {
    try {
      ctx.onChange?.(def);
      setDirty(false);
    } catch (e) {
      console.error('[dag-flow] save failed:', e);
    }
  }, [ctx, def]);

  // 运行
  // ★ 2026-10-19 用户拍板「画布里面不想要有运行失败的弹窗了……失败具体内容全部放到具体节点上」：
  //   运行失败详情弹窗（dialogs/run-fail-dialog.tsx）已整体移除，失败原因改由画布节点自己承载
  //   （节点徽标标红 + 悬停看悬浮卡；loop / subflow 的卡片还会带出子工作流内部失败的节点与原因）。
  //   这里只留下 summary 状态：变量面板的「实际有哪些变量」靠它反推。
  const runResultState = useRunResult();
  const { runResult } = runResultState;
  // ★ 弹窗样式挂载即注入（2026-10-02 用户报「报错信息在左下角」根因：dag-flow-picker 系弹窗
  //   样式由 ensurePickerStyles 注入，过去只有点开 📂 时才注入——停靠模式刷新后直接点 ▶，
  //   失败弹窗因缺样式渲染成面板底部的裸块。挂载即注入（幂等），全部弹窗不再依赖打开顺序）
  useEffect(() => { try { ensurePickerStyles(); } catch { /* 忽略 */ } }, []);



  // 自检拦截/自检通过弹窗：状态拆至 dialogs/selfcheck-dialog.tsx（handleRun 是写方，经解构出的 setter 原名读写，零数据流变化）
  const selfcheckDlg = useSelfcheckDialog();
  const { selfcheckBlock, setSelfcheckBlock, selfcheckState, setSelfcheckState } = selfcheckDlg;
  // ★ 运行控制整块抽到 panels/run-control.ts（2026-10-19 拆分第 1 批；只搬位置，行为零变化）：
  //   运行态（runResults/running/cancelling/cancelTick）+ 结果落定（applyRunSummary）
  //   + 运行入口（handleRun：自检→人工确认→真跑）+ 取消（cancelRun）+ 顶部提示（importMsg）
  //   + 人工确认弹窗（useManualDialog，它依赖 applyRunSummary 又要给 handleRun 提供 setter，只能一起搬）。
  //     而 handleRun 要写它的 setter ⇒ 渲染期赋值（与 nodesRef.current 同款手法），避开入参求值早于声明。
  const run = useRunControl({ def, dirty, handleSave, ctx, runOut: runResultState, selfcheckDlg });
  const {
    runResults, setRunResults,
    running, setRunning,
    cancelling, setCancelling, cancellingRef,
    cancelTick, setCancelTick,
    runAbortRef, manualRunRef,
    importMsg, setImportMsg,
    manualDlg,
    handleRun, cancelRun,
  } = run;
  const { manualWait, setManualWait, manualDlgOpen, setManualDlgOpen, manualNote, setManualNote, clearManualWait, MANUAL_STORE_KEY } = manualDlg;
  // ★ 节点编辑整块抽到 panels/node-editing.ts（2026-10-19 拆分第 2 批；只搬位置，行为零变化）。
  //   要放在运行控制之后：handleDefChange 会写顶部浮窗（setImportMsg 来自运行控制 hook）。
  const nodeEdit = useNodeEditing({
    def, setDef, setDirty, selectedNodeId, setSelectedNodeId, setTab, setRightMin, setImportMsg,
  });
  const { handleRFChange, handleDefChange, handleSelectNode, handleAddNode, handleDeleteNode, deleteNodeFull, handleNodeChange } = nodeEdit;
  // ★ 工作流 IO 整块抽到 panels/workflow-io.ts（2026-10-19 拆分第 3 批；只搬位置，行为零变化）
  const wfIo = useWorkflowIo({
    def, setDef, dirty, setDirty, autoSave, setAutoSave, nameTaken, setNameTaken,
    importMsg, setImportMsg, ctx, rfNodes, rfEdges, setTab, handleDefChange,
  });
  const {
    saveDefToDisk, handleSaveToDisk,
    exportMenuOpen, setExportMenuOpen, exportMenuAt, setExportMenuAt,
    handleRename, exportFile, exportImage, exportSvg, importFile, pickImportFile,
  } = wfIo;

  // 通知 host 当前 def（自动保存防丢）
  useEffect(() => {
    if (dirty) {
      try { ctx.onChange?.(def); } catch { /* host 未提供 onChange */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def]);

  // 全局快捷键（★ window capture）：Ctrl+Enter 运行 / Delete·Backspace 删除选中 / Ctrl+D 复制选中。
  // capture 原因（2026-10-01 夜）：单击选中后焦点落在 playground 内部，keydown 从内部元素发起时
  // 被 FlowGram 层 stopPropagation（与 mousemove 被吞同款问题），window bubble 收不到 → Del 失效；
  // window capture 是事件传播最早触发点，任何内层都无法拦截。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // 输入框/文本域/可编辑元素内不触发（避免打字误删）
      if (t && typeof t.closest === 'function' && t.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        void handleRun();
      } else if (!e.ctrlKey && !e.metaKey && (e.key === 'Delete' || e.key === 'Backspace')) {
        if (selectedNodeId) {
          e.preventDefault();
          e.stopPropagation();
          deleteNodeFull(selectedNodeId);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        e.stopPropagation();
        if (selectedNodeId) {
          const n = def.nodes.find((x) => x.id === selectedNodeId);
          if (n) {
            const newId = newNodeId(); // ★ 唯一生成器（2026-10-16 收口）
            // 复制节点（n8n 语义）：原边全部保留，额外克隆 newId 的入边+出边
            const extra = [];
            for (const ed of def.edges ?? []) {
              if (ed.from === n.id) extra.push({ ...ed, from: newId });
              if (ed.to === n.id) extra.push({ ...ed, to: newId });
            }
            handleDefChange({
              ...def,
              nodes: [...def.nodes, { ...n, id: newId }],
              edges: [...(def.edges ?? []), ...extra],
            });
            setSelectedNodeId(newId);
          }
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def, selectedNodeId, handleRun, deleteNodeFull, handleDefChange]);

  const selectedNode = selectedNodeId ? def.nodes.find((n) => n.id === selectedNodeId) : null;

  // ★ 双击 loop（有循环体）/ subflow（有目标）节点 → 进入子工作流（2026-10-03 用户需求）。
  //   跳转前先把当前工作流的未保存改动 flush 一次（重挂载会清掉 2s 防抖计时器，不 flush 会丢盘上最新状态）。
  const handleNodeDoubleClick = useCallback(async (nodeId: string): Promise<void> => {
    const n = def.nodes.find((x) => x.id === nodeId);
    if (!n) return;
    const target = n.type === 'loop'
      ? String((n.params?.body as { workflowName?: string } | undefined)?.workflowName ?? '').trim()
      : n.type === 'subflow'
        ? String(n.params?.workflowName ?? '').trim()
        : '';
    if (n.type !== 'loop' && n.type !== 'subflow') return; // 其他节点双击无行为
    if (!target) {
      flashNavMsg(n.type === 'loop'
        ? '该循环节点还没选循环体——在右侧「🔁 循环设置 → 循环体」里选一个子工作流'
        : '该 subflow 节点还没选子工作流——在右侧参数里选一个');
      return;
    }
    if (!nav?.enter) { flashNavMsg('当前环境不支持子工作流跳转'); return; }
    try { if (dirty) await saveDefToDisk(def, false); } catch { /* 存盘失败不阻断跳转 */ }
    const res = await nav.enter(target, nodeId);
    if (res?.error) flashNavMsg(res.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def, dirty, nav, saveDefToDisk]);

  /** 一键返回父工作流的来源节点（返回前同样 flush 当前子工作流的改动） */
  const handleNavBack = useCallback(async (): Promise<void> => {
    if (!nav?.back) return;
    try { if (dirty) await saveDefToDisk(def, false); } catch { /* 忽略 */ }
    const res = nav.back();
    if (res?.error) flashNavMsg(res.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def, dirty, nav, saveDefToDisk]);

  // 版本管理（#14-② + 2026-10-01 夜）：状态与 openVersions/loadVersion 拆至 dialogs/versions-dialog.tsx
  //   （hook 仍在本组件实例上调用；hook 本身不引用 setImportMsg——浮窗提示由 View 的 prop 接收）
  const verDlg = useVersionsDialog({ def, saveDefToDisk, onDefChange: handleDefChange, setDirty });
  const { verOpen, setVerOpen, verList, verLoading, verH, setVerH, verOff, setVerOff, verDir, openVersions, loadVersion } = verDlg;

  // 自动布局：按拓扑分层重排节点
  const handleAutoLayout = useCallback(() => {
    const next = applyAutoLayout(def);
    setDef(next);
    setDirty(true);
  }, [def]);


  // A3 工作流参数编辑弹窗：状态与 openInputs/pushInputs 拆至 dialogs/inputs-dialog.tsx
  //   （hook 仍在本组件实例上调用——改动即自动保存的数据流零变化）
  const inputsDlg = useInputsDialog({ def, onDefChange: handleDefChange });
  const { inputsOpen, setInputsOpen, inputsRows, setInputsRows, openInputs, pushInputs } = inputsDlg;

  // ===== 定时任务弹窗（⏰）：状态与 handlers 拆至 dialogs/schedule-dialog.tsx
  //   （hook 仍在本组件实例上调用；后台监视 effect 经解构出的 schedOpen/loadSchedules 照常读写，零数据流变化）
  const schedDlg = useSchedulesDialog({ def, setImportMsg });
  const { schedOpen, openSchedules, loadSchedules } = schedDlg;
  // ★ 运行日志弹窗：状态/轮询 effects/logView 拆至 dialogs/run-log-dialog.tsx
  //   （hook 仍在本组件实例上调用；「运行刚结束补拉一次」effect 的 running 经入参传入，行为不变）
  const logDlg = useRunLogDialog({ def, running });
  const { logOpen, setLogOpen } = logDlg;
  // ===== 后台运行监视（2026-10-03 用户真机反馈：「定时任务执行，工作流的状态不会变化」）=====
  //   根因：逐节点状态轮询原来只挂在**手动点运行**那条路径上，而定时触发是宿主调度器直接跑，
  //   客户端毫不知情 → 画布不点亮、头部也不显示运行态。
  //   现在：面板挂载期间后台轮询 GET /run/status?name=<当前工作流>，**任何来源**（手动/定时）的运行
  //   都会点亮画布；检测到在跑就切快档（600ms），跑完收敛到终态（宿主会回退到「最近一次完成的运行」），
  //   若 ⏰ 弹窗开着则顺手刷新「上次/下次」。与手动路径互不干扰：手动跑时 running=true，这里让位。
  const lastSigRef = useRef('');
  const nodesRef = useRef<string[]>([]);
  nodesRef.current = (def.nodes ?? []).map((n) => n.id);
  useEffect(() => {
    let stopped = false;
    let timer: number | null = null;
    const idleMs = 2500, fastMs = 600;
    let fast = false;
    const watch = async (): Promise<void> => {
      if (stopped) return;
      try {
        if (!manualRunRef.current) {
          // ★ quiet=1：宿主侧对「没有在跑的实例、也没有最近完成记录」回 200 {status:'idle'} 而不是 404
          //   —— 这条轮询在面板挂载期间每 2.5s 跑一次，用 404 会让浏览器把每条都打成红色网络错误
          //   （用户报「控制台一下 3 个错」的第一条就是这个）。
          const r = await fetch(`/api/dag-flow/run/status?name=${encodeURIComponent(def.name)}&quiet=1`);
          if (!r.ok && cancellingRef.current) {
            // 404 = 宿主已没有这次运行的记录（已经停了）→ 取消完成：**浮窗提示「取消成功」**（右侧结果条不动 ✗）
            cancellingRef.current = false;
            setCancelling(false);
            setRunning(false);
            setImportMsg({ ok: true, text: '取消成功' });
          }
          if (r.ok) {
            const j = (await r.json()) as {
              status?: string; origin?: string; results?: Record<string, unknown>; running?: string[];
            };
            // ★ status==='idle' = quiet 查询的「没有运行记录」：与旧的 404 等价 —— 画布结果**保持不动**
            //   （否则会把上次运行结束后留下的绿线/徽标清掉，那是用户可见的行为变化）。
            if (j.status !== 'idle') {
              const sig = JSON.stringify([j.status, j.results ?? {}, j.running ?? []]);
              if (sig !== lastSigRef.current) {
                lastSigRef.current = sig;
                setRunResults(progressToStatusMap(nodesRef.current, { results: j.results as never, running: j.running }));
              }
            }
            const active = j.status === 'running' || j.status === 'awaiting';
            // ★ 2026-10-08：取消中 → **不许**把界面写回"运行中"（那是用户报的"又恢复成运行中" ✗）；
            //   等 host 真的停了（active=false，或上面 404 分支）才清掉取消态并**浮窗提示「取消成功」**
            //   （右侧结果条不显示「已取消」✗——用户明确要求）。
            if (cancellingRef.current) {
              if (!active) {
                cancellingRef.current = false;
                setCancelling(false);
                setRunning(false);
                setImportMsg({ ok: true, text: '取消成功' });
                manualRunRef.current = false;
                if (fast) { fast = false; if (schedOpen) void loadSchedules(); }
              } else {
                setRunning(true);   // 仍在收尾：显示"取消中…"（头部按 cancelling 显示），但不是普通运行态
                fast = true;        // ★ 取消中必须**快档轮询**（600ms）——否则"取消中…"最长要等 2.5s 才落定
              }
            } else {
              // 定时/宿主侧发起的运行：让头部也进入运行态（手动路径自己会置位，这里不抢）
              setRunning(active);
              if (!active && fast) {
                fast = false;
                if (schedOpen) void loadSchedules();   // 刚跑完：刷新 ⏰ 弹窗的上次/下次
              }
              fast = active;
            }
          }
        }
      } catch { /* 轮询失败不打扰用户，下一轮再试 */ }
      if (!stopped) timer = window.setTimeout(() => { void watch(); }, fast ? fastMs : idleMs);
    };
    void watch();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [def.name, schedOpen, loadSchedules, cancelTick]);

  // ★ 失败策略显形（2026-10-04 轮 7）：把 def 里每个节点的失败策略同步进 failPolicyStore，
  //   画布卡片据此在底部显示一枚小 chip（默认 stop **不入表** = 不显示，避免噪音）。
  //   goto 额外带上目标节点的显示名，让"看不见的跳转"在画布上可读。
  useEffect(() => {
    const labelOf = (id: string): string => {
      const t = (def.nodes ?? []).find((x) => x.id === id);
      return t ? String(t.label ?? t.id) : id;
    };
    const map: Record<string, { kind: 'skip' | 'ignore' | 'goto'; target?: string; targetLabel?: string }> = {};
    for (const n of def.nodes ?? []) {
      if (n.tolerate === true) map[n.id] = { kind: 'ignore' };
      else if (n.onError === 'continue') map[n.id] = { kind: 'skip' };
      else if (n.onError && typeof n.onError === 'object' && n.onError.goto) {
        map[n.id] = { kind: 'goto', target: n.onError.goto, targetLabel: labelOf(n.onError.goto) };
      }
    }
    failPolicyStore.setAll(map);
  }, [def]);

  // A4 失败策略（onError：stop/continue/goto）
  const handleNodeError = useCallback((id: string, onError: 'stop' | 'continue' | { goto: string }) => {
    setDef((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => {
        if (n.id !== id) return n;
        const next = { ...n, onError };
        delete next.tolerate;   // ★ 轮 2：策略互斥——写 onError 就清掉 tolerate，避免两个字段打架
        return next;
      }),
    }));
    setDirty(true);
  }, []);

  // ★ 2026-10-04 轮 2（用户要求「失败策略和失败不影响流程合并到一起，避免歧义」）：
  //   面板上只剩一个「🛟 本节点失败后」下拉；**底层仍是两个既有字段**（零数据迁移），写入时互斥清理。
  //     停止(stop)   → onError:'stop' + 删 tolerate
  //     跳过(skip)   → onError:'continue' + 删 tolerate（下游不走，且不计运行失败）
  //     忽略(ignore) → tolerate:true + 删 onError（下游照常跑，不计运行失败）
  //   goto 本轮不提供选项（引擎侧待轮 3）；旧数据若已设 goto，面板显示为只读的当前项，不丢数据。
  const handleNodeFailPolicy = useCallback((id: string, policy: 'stop' | 'skip' | 'ignore') => {
    setDef((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => {
        if (n.id !== id) return n;
        const next = { ...n };
        if (policy === 'ignore') {
          next.tolerate = true;
          delete next.onError;
        } else {
          delete next.tolerate;
          next.onError = policy === 'skip' ? 'continue' : 'stop';
        }
        return next;
      }),
    }));
    setDirty(true);
  }, []);

  // 2026-10-01 深夜：A1 已保存工作流的删除/复制/重命名随管理视图移除——复制功能移植进打开/新建选择器

  // ★ 2026-10-15「工作流名 + 保存状态移到上面栏」：标识区三个节点抽成变量 ——
  //   上面栏的占位容器存在（停靠模式）时整块 portal 过去；不存在（legacy 窗口 / CDP 夹具）时就地渲染，
  //   且**顺序与原来逐字一致**（logo → 名字 → 导航 → 提示 → 保存状态），老路径行为零变化。
  const brandLogo = createElement('span', { className: 'dsh-wf-logo', key: 'logo', title: '工作流搭建器' },
    createElement('svg', {
      width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none',
      stroke: '#fff', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round',
    },
      createElement('rect', { x: '3', y: '3', width: '7', height: '7', rx: '1.5' }),
      createElement('rect', { x: '14', y: '14', width: '7', height: '7', rx: '1.5' }),
      createElement('circle', { cx: '17.5', cy: '6.5', r: '2.5' }),
      createElement('path', { d: 'M10 6.5h5M10 17.5h1.5M17.5 9v5' }),
    ),
  );
  const brandName = createElement('input', {
    key: 'name',
    className: 'dsh-wf-name-input',
    value: def.name,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => handleRename(e.target.value),
    // ★ 2026-10-19 用户：「删除工作流的时候…工作流名称那里改为未命名，名称是空的」
    //   ⇒ 空名不再显示「工作流名称」这种"待填字段"的提示，直接显示未命名状态。
    placeholder: '未命名',
    title: '自定义工作流名称（保存后用于识别）',
  });
  // ★ 2026-10-19 用户：「工作流如果没名称，禁止运行和自动保存、手动保存」
  //   ⇒ 三个入口共用这一个判据：自动保存守卫、运行按钮/保存按钮的 disabled、以及两个 handler 的兜底提示。
  const hasName = !!String(def.name ?? '').trim();
  /** 可保存 = 有名字 且 没撞名（撞名时服务端也会拒，这里提前禁掉按钮） */
  const canSave = hasName && !nameTaken;
  // 2026-10-01 深夜：移除「N 节点」计数（用户反馈没啥用）；title-sub 仅剩保存状态
  const brandStatus = createElement('span', { className: 'dsh-wf-title-sub', key: 'save' },
    // ★ 2026-10-19 用户拍板 A：改名撞名时最优先显示（否则用户会以为"改了但没保存"是 bug）
    nameTaken ? '⚠ 名称已存在，换个名字才能保存'
    // ★ 2026-10-19 用户：「删除工作流的时候，状态改为未保存」。
    //   空名状态**优先**于 dirty 判断：刚重置的画布 dirty=false，若按老顺序会显示「✓ 已保存」——
    //   那等于告诉用户"这份空白画布存过盘了"，既是假话也正好撞上他要的相反语义。
    : !hasName ? '● 未保存'
    : !dirty ? '✓ 已保存'
    : autoSave === 'saving' ? '⏳ 自动保存中…'
    : autoSave === 'error' ? '⚠ 自动保存失败（请手动保存）'
    : '● 未保存（将自动保存）');

  return createElement(
    'div',
    { className: 'dsh-wf-root' },
    // 顶部 header
    createElement(
      'header',
      { className: 'dsh-wf-header', ref: headerRef },
      // ★ 上面栏有占位容器（停靠模式）→ 标识区整块搬过去（见下面的 createPortal）；否则就地渲染
      ...(chromeSlot ? [] : [brandLogo, brandName]),
      // ★ 子工作流返回入口（变体 A，用户 2026-10-03 拍板）：返回胶囊紧邻工作流名，右侧面包屑显示层级
      //   （父 › 当前，嵌套多层时从外到内全显示，可逐级点回去）。
      ...(nav && (nav.crumbs?.length ?? 0) > 0
        ? [
            createElement('div', { className: 'dsh-wf-nav', key: 'nav' },
              createElement('button', {
                className: 'dsh-wf-nav-back',
                type: 'button',
                title: `返回「${nav.crumbs![nav.crumbs!.length - 1]}」并选中来源节点`,
                onClick: () => { void handleNavBack(); },
              }, `↩ 返回「${nav.crumbs![nav.crumbs!.length - 1]}」`),
              createElement('span', { className: 'dsh-wf-crumb' },
                ...nav.crumbs!.flatMap((c, i) => [
                  createElement('span', {
                    key: `c${i}`,
                    className: 'dsh-wf-crumb-item',
                    title: `返回第 ${i + 1} 层`,
                    onClick: () => { void handleNavBack(); },
                  }, c),
                  createElement('span', { key: `s${i}`, className: 'dsh-wf-crumb-sep' }, '›'),
                ]),
                createElement('b', { className: 'dsh-wf-crumb-cur', key: 'cur' }, nav.current || def.name),
              ),
            ),
          ]
        : []),
      // 双击跳转的提示条（子工作流不存在 / 没选循环体 / 成环等，4s 自动消失）
      navMsg ? createElement('span', { className: 'dsh-wf-navmsg', key: 'navmsg' }, `⚠ ${navMsg}`) : null,
      // 2026-10-01 深夜：移除「N 节点」计数（用户反馈没啥用）；title-sub 仅剩保存状态
      // ★ 2026-10-15：保存状态随标识区一起搬到上面栏（停靠模式）
      ...(chromeSlot ? [] : [brandStatus]),
      // ★ 2026-10-15 用户要求：画布 / JSON 拆成**独立按钮**（不再共用 tabs 组）；
      //   ★ 同日二次拍板：按使用频率重排成「频率对称带」——所有功能按钮收进下面这一条按钮带，
      //     在「标识区之后到右边缘」之间居中（`.dsh-wf-btnband` 用左右 auto margin，不用绝对定位，
      //     所以面板再窄也不会压到工作流名输入框）。排列＝**越靠中间越常用**：
      //     正中 ▶ 运行，紧邻 🎨 画布 / 💾 保存，再外 {} /🧾，最外 导出/导入/⏰/✍️。
      //   ★ 窄屏（headerNarrow，见组件顶部的 ResizeObserver）：把最低频的 导入 / 导出 / ⏰ 收进
      //     「⋯ 更多」菜单（渲染在 body 末尾 moreOpen 段）。
      //   ★ 标识区（logo + 工作流名输入框 + 保存状态）一个像素都不动 —— 用户明确要求「只动按钮」。
      createElement('div', { className: 'dsh-wf-btnband' },
      // —— 左外侧 → 内：导入、导出、JSON、画布（频率递增，最常用的紧邻中轴）——
      !headerNarrow && createElement(
        'button',
        { className: 'dsh-wf-btn', title: '从 .json 文件导入工作流', onClick: pickImportFile },
        iconImportTray(),
      ),
      // ★ 2026-10-09：导出从「直接导出 JSON」改成**导出菜单**（导出 JSON / 图片 PNG / 矢量图 SVG）——
      //   用户原话「导出 json 已经有导出按钮了，导出图片可以集成到一起」。
      !headerNarrow && createElement(
        'button',
        {
          className: `dsh-wf-btn${exportMenuOpen ? ' is-on' : ''}`,
          onClick: (e: { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } }) => {
            // 记下按钮位置 → 菜单锚定在它正下方（fixed 定位，不受头部 overflow 影响）
            const r = e?.currentTarget?.getBoundingClientRect?.();
            if (r) setExportMenuAt({ left: r.left, top: r.bottom + 6 });
            setExportMenuOpen((v) => !v);
          },
          title: '导出（JSON / 图片 PNG / 矢量图 SVG）',
        },
        iconExportTray(),
      ),
      createElement('button', {
        className: `dsh-wf-btn${tab === 'json' ? ' is-on' : ''}`,
        'aria-pressed': tab === 'json',
        title: '查看 / 编辑工作流 JSON',
        onClick: () => setTab('json'),
      }, iconJsonBraces()),
      createElement('button', {
        className: `dsh-wf-btn${tab === 'canvas' ? ' is-on' : ''}`,
        'aria-pressed': tab === 'canvas',
        title: '画布',
        onClick: () => setTab('canvas'),
      }, iconCanvas()),
      // —— 正中：运行（最高频）——
      // ★ 运行按钮：运行中变**动态**状态（方案 D = 弧线旋转环 + 按钮呼吸外发光 + 扫光 + 「运行中」；
      //   2026-10-03 用户在候选原型里拍板 D，弃漏斗/弃字符 ◌）；跑完恢复 ▶
      //   `is-icolike`＝静态时与相邻纯图标按钮**同宽**（否则 ▶ 这个字符只有 ~16px，比旁边窄一截）。
      // ★ 2026-10-19 两轮定稿：自检「**慢才显示**」——handleRun 里超过 400ms 才切 phase='checking'。
      //   快（真机中位 18ms）时用户看不到任何中间态，直接进确认窗（解决"闪一下容易误解"）；
      //   慢时这里才亮「自检中…」+ 转圈，避免"点了没反应像卡死"。
      createElement(
        'button',
        {
          className: `dsh-wf-btn is-icolike dsh-wf-btn-success${running ? ' is-running' : ''}${selfcheckState?.phase === 'checking' ? ' is-checking' : ''}`,
          onClick: () => void handleRun(),
          // ★ 2026-10-19：没名字不许运行（空名无法定位工作流，/run 必然被后端拒）
          disabled: running || selfcheckState?.phase === 'checking' || !hasName,
          title: !hasName
            ? '工作流还没有名字——先在上方名称框里起个名字才能运行'
            : running
            ? '工作流正在运行（点右侧「⏹ 取消」可中止）'
            : selfcheckState?.phase === 'checking'
              ? '正在做运行前自检…'
              : '运行工作流（先自检，通过后确认再执行）',
        },
        running
          ? createElement('span', { className: 'dsh-wf-run-label' },
              createElement('span', { className: 'dsh-wf-run-ring' }),
              cancelling ? '取消中…' : '运行中')
          : selfcheckState?.phase === 'checking'
            ? createElement('span', { className: 'dsh-wf-run-label' },
                createElement('span', { className: 'dsh-wf-run-ring' }),
                '自检中…')
            : '▶',
      ),
      // ★ 取消按钮：运行中才出现，紧跟运行按钮，且红色
      //   ★ 2026-10-08：取消是异步的（host 要等当前节点收尾）→ 取消中时按钮禁用、文案改「取消中…」，
      //   避免用户连点；真正的落定由后台监视器在 host 确认结束后完成。
      running && createElement(
        'button',
        {
          className: 'dsh-wf-btn is-danger',
          onClick: cancelRun,
          disabled: cancelling,
          title: cancelling ? '正在取消…（等当前节点收尾）' : '取消本次运行（通知执行器中止）',
        },
        cancelling ? '⏳ 取消中…' : '⏹ 取消',
      ),
      // —— 右侧：由内向外频率递减：保存 → 日志 → 历史 → 定时 → 参数 ——
      createElement(
        'button',
        {
          className: 'dsh-wf-btn',
          // ★ 2026-10-19：没名字禁止手动保存 / 撞名也不许存（服务端会拒，提前禁掉）
          disabled: !canSave,
          title: !hasName
            ? '工作流还没有名字——先在上方名称框里起个名字才能保存'
            : nameTaken
              ? `名称「${def.name}」已被其它工作流占用——换一个名字才能保存`
              : '保存工作流到磁盘（<DSH_HOME>/.dag-flow/workflow/）',
          onClick: async () => {
            try {
              await handleSaveToDisk();
              setDirty(false);
              try { ctx.onChange?.(def); } catch { /* */ }
              // 保存成功走顶部浮窗提示（✓ 已保存）——不再打 console.log（阶段五清理）
            } catch (e) {
              setImportMsg({ ok: false, text: `保存失败：${(e as Error).message}` });
              console.error('[dag-flow] save failed:', e);
            }
          },
        },
        iconSave(),
      ),
      // ★ 运行日志（2026-10-04 用户需求：「工作流执行黑盒」；用户当时明确要求它留在**头部这一排**）
      createElement(
        'button',
        {
          className: `dsh-wf-btn dsh-wf-log-btn${logOpen ? ' primary' : ''}`,
          title: '运行日志：每个节点的入参/引用/出参/错误/耗时（运行中自动刷新）',
          onClick: () => setLogOpen((v) => !v),
        },
        iconRunLog(),
      ),
      createElement(
        'button',
        { className: 'dsh-wf-btn', onClick: () => void openVersions(), title: '历史版本（手动保存生成快照，可回载）' },
        iconHistory(),
      ),
      // ★ 定时任务（2026-10-03 用户拍板方案 v1，docs/SCHEDULE-PLAN.md §6）：每个工作流可配多条 cron 定时
      !headerNarrow && createElement(
        'button',
        { className: 'dsh-wf-btn', onClick: openSchedules, title: '定时任务（cron 定时执行本工作流；dsh web 需常驻才会触发）' },
        iconSchedule(),
      ),
      createElement(
        'button',
        { className: 'dsh-wf-btn', onClick: openInputs, title: '工作流参数（仅当前工作流可用；节点参数里用 {{inputs.名称}} 引用）' },
        iconParams(),
      ),
      // ★ 窄屏收纳入口：只在这一条放不下时出现（菜单内容＝导入/导出三项/定时任务）
      headerNarrow && createElement(
        'button',
        {
          className: `dsh-wf-btn${moreOpen ? ' is-on' : ''}`,
          title: '更多（导入 / 导出 / 定时任务）',
          onClick: (e: { currentTarget?: { getBoundingClientRect?: () => { left: number; right: number; bottom: number } } }) => {
            const r = e?.currentTarget?.getBoundingClientRect?.();
            // 这颗按钮贴在最右，菜单**右对齐**才不会超出视口
            if (r) setMoreAt({ left: Math.max(8, r.right - 210), top: r.bottom + 6 });
            setMoreOpen((v) => !v);
          },
        },
        '⋯',
      ),
      // 人工确认等待态（2026-10-03 方案 A）：accent 描边徽标，点击重开确认弹窗
      //   ★ 放在按钮带**内部最右**——它是状态徽标不是按钮，但必须跟着带一起居中，否则会把带推歪
      manualWait && createElement(
        'span',
        {
          className: 'dsh-wf-run-result is-wait',
          title: '运行正等待人工确认——点击查看那个节点',
          style: { cursor: 'pointer', maxWidth: 160 },
          onClick: () => setManualDlgOpen(true),
        },
        '⏸ 等待人工确认',
      ),
      ),   // ← 按钮带结束
      // ★ 2026-10-15：标识区搬到上面栏——portal 不占中间栏的位置，于是中间栏只剩这条按钮带，
      //   靠左右 auto margin 真正居中（用户要求「中间栏的图标还是居中放置」）。
      chromeSlot ? createPortal(
        createElement('div', { className: 'dsh-wf-chrome' }, brandLogo, brandName, brandStatus),
        chromeSlot,
      ) : null,
      // ★ 2026-10-08 用户拍板：**右侧结果条整个撤掉** ✗（原来是「✓ 运行成功」/「✗ 运行失败」的可点徽标）——
      //   运行结果改由**顶部浮窗**提示（成功=自动消失；失败=常驻可点开详情），与「取消成功」同一形态。
      //   历史：2026-10-02 曾把行内报错改成这个徽标；2026-10-08 再改为浮窗（用户口径）。
    ),
    // body：不同 tab 不同布局
    renderBody({
      tab,
      def,
      rfNodes,
      rfEdges,
      selectedNode,
      ctx,
      runResults, // 运行状态可视化（画布节点徽标）
      // ★ 2026-10-11（用户真机反馈「运行中的工作流取消了，能不能关闭这个光点动画」）：
      //   运行**是否仍在进行**。"正在走"的光点只在此期间跑；一旦结束/被取消，
      //   那条没走完的边转成静态绿（is-runpath-stalled），不再有动画。
      //   取消中用 `!cancelling`：点了取消就立刻停动画（头部这时显示「取消中…」）。
      runActive: running && !cancelling,
      // 上次运行的真实输出（results.<id>.out）——面板用它反推「实际有哪些变量」，含用户自定义键
      runOuts: (runResult?.summary as { results?: Record<string, { status?: string; durationMs?: number; out?: unknown }> } | undefined)?.results ?? {},
      // A4 失败策略（onError：节点失败时的行为）
      onNodeError: handleNodeError,
      // ★ 2026-10-04 轮 2：失败策略与「失败不影响流程」已合并为面板上唯一的一个下拉
      onNodeFailPolicy: handleNodeFailPolicy,
      onDefChange: handleDefChange,
      onRFChange: handleRFChange,
      onSelectNode: handleSelectNode,
      // ★ 双击 loop（循环体）/ subflow（目标）节点 → 进入子工作流（2026-10-03 用户需求）
      onNodeDoubleClick: handleNodeDoubleClick,
      onAddNode: handleAddNode,
      onDeleteNode: deleteNodeFull,
      onNodeChange: handleNodeChange,
      rightMin,
      onRightMin: setRightMin,
      rightGeom,
      onRightGeom: setRightGeom,
      rightRef,
    }),
    // ✍️ 工作流参数弹窗 → dialogs/inputs-dialog.tsx（弹窗专项批 1：hook 状态 + View 渲染成对拆出）
    createElement(InputsDialogView, { d: inputsDlg }),
    // ⏰ 定时任务弹窗 → dialogs/schedule-dialog.tsx（弹窗专项批 2+3：hook 状态 + View 渲染成对拆出）
    //   ★ setImportMsg 必须传——View 里 dataPathRow 的「打开文件夹失败」提示要用（阶段五 tsc 摘 nocheck 时抓到的漏传）
    createElement(SchedulesDialogView, { d: schedDlg, defName: def.name, setImportMsg }),
    // 🕘 历史版本弹窗 → dialogs/versions-dialog.tsx（弹窗专项批 1：hook 状态 + View 渲染成对拆出）
    createElement(VersionsDialogView, { d: verDlg, defName: def.name, setImportMsg }),
    // ★ 2026-10-09 导出菜单（⬇ 按钮下方）：导出 JSON / 导出图片（PNG）。
    //   用一层透明背板实现"点外面关闭"（比 document 监听更省事、也不会漏解绑）。
    exportMenuOpen && createElement(
      'div',
      { style: { position: 'fixed', inset: 0, zIndex: 10000 }, onClick: () => setExportMenuOpen(false) },
      createElement(
        'div',
        {
          className: 'dsh-wf-export-menu',
          style: {
            position: 'fixed', left: exportMenuAt.left, top: exportMenuAt.top, minWidth: 200, padding: 6,
            background: 'var(--wf-panel, #101a2b)', border: '1px solid var(--wf-border2, #29405f)',
            borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.45)', fontSize: 12,
          },
          onClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
        },
        createElement(
          'button',
          {
            className: 'dsh-wf-export-item',
            onClick: exportFile,
            title: '把工作流定义存成 .json 文件',
          },
          '📄 导出 JSON',
        ),
        createElement(
          'button',
          {
            className: 'dsh-wf-export-item',
            onClick: () => void exportImage(),
            title: '把画布画成一张 PNG 图片（按当前布局矢量绘制，2 倍光栅化）',
          },
          '🖼 导出图片（PNG）',
        ),
        createElement(
          'button',
          {
            className: 'dsh-wf-export-item',
            onClick: exportSvg,
            title: '导出矢量图 SVG（同 PNG 的画法，但可无限缩放、可用设计工具再编辑）',
          },
          '🧩 导出矢量图（SVG）',
        ),
      ),
    ),
    // ★ 2026-10-15 窄屏收纳菜单（方案 A 的配套）：头部放不下时把 导入 / 导出三项 / 定时任务 收在这里。
    //   复用导出菜单那一套（透明背板点外面关闭 + `.dsh-wf-export-item` 行样式），不再造第二套菜单语言。
    moreOpen && createElement(
      'div',
      { style: { position: 'fixed', inset: 0, zIndex: 10000 }, onClick: () => setMoreOpen(false) },
      createElement(
        'div',
        {
          className: 'dsh-wf-export-menu dsh-wf-more-menu',
          style: {
            position: 'fixed', left: moreAt.left, top: moreAt.top, minWidth: 200, padding: 6,
            background: 'var(--wf-panel, #101a2b)', border: '1px solid var(--wf-border2, #29405f)',
            borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.45)', fontSize: 12,
          },
          onClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
        },
        createElement(
          'button',
          {
            className: 'dsh-wf-export-item',
            onClick: () => { setMoreOpen(false); exportFile(); },
            title: '把工作流定义存成 .json 文件',
          },
          '📄 导出 JSON',
        ),
        createElement(
          'button',
          {
            className: 'dsh-wf-export-item',
            onClick: () => { setMoreOpen(false); void exportImage(); },
            title: '把画布画成一张 PNG 图片（按当前布局矢量绘制，2 倍光栅化）',
          },
          '🖼 导出图片（PNG）',
        ),
        createElement(
          'button',
          {
            className: 'dsh-wf-export-item',
            onClick: () => { setMoreOpen(false); exportSvg(); },
            title: '导出矢量图 SVG（同 PNG 的画法，但可无限缩放、可用设计工具再编辑）',
          },
          '🧩 导出矢量图（SVG）',
        ),
        createElement(
          'button',
          {
            className: 'dsh-wf-export-item',
            onClick: () => { setMoreOpen(false); pickImportFile(); },
            title: '从 .json 文件导入工作流',
          },
          '📥 导入工作流',
        ),
        createElement(
          'button',
          {
            className: 'dsh-wf-export-item',
            onClick: () => { setMoreOpen(false); openSchedules(); },
            title: '定时任务（cron 定时执行本工作流；dsh web 需常驻才会触发）',
          },
          '⏰ 定时任务',
        ),
      ),
    ),
    // 结果/操作提示（保存/导出/导入/运行结果/取消成功）
    //   ★ 2026-10-08：顶部锚定 14vh（原在底部 18px ✗），与项目弹窗约定一致。
    //   ★ 2026-10-19 用户拍板「不要是方形，按设计规范设计一下；弹窗后也不要漂移」：
    //     ① 形态按项目规范：10px 圆角卡片 + 左侧 3px 状态色竖条 + 深空蓝底 + 阴影 0 10px 28px rgba(0,0,0,.5)，
    //        图标与文案分开排版（文案用正文色，只有图标带状态色），不再是一整行彩色方框；
    //     ② **居中不再用 transform**：原来 `left:50% + translateX(-50%)` 会被入场动画的 `transform: scale()`
    //        覆盖 ⇒ 动画期间元素以视口中心为**左边缘**（偏右半个宽度），动画结束才跳回居中，看起来就是"弹出来漂一下"。
    //        现在改成 `left:0/right:0/margin:auto` 的纯盒模型居中，配合 CSS 只做 opacity 淡入，位置一次到位。
    importMsg && createElement(
      'div',
      {
        className: `dsh-wf-toast ${importMsg.ok ? 'is-ok' : 'is-err'}`,
        title: importMsg.onClick ? '点击查看详情' : '点击关闭',
        style: {
          position: 'fixed', top: '14vh', left: 0, right: 0, margin: '0 auto', zIndex: 10001,
          width: 'max-content', maxWidth: 'min(560px, calc(100vw - 32px))',
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--wf-panel2, #162135)',
          border: '1px solid var(--wf-border3, #2b3d57)',
          borderLeft: `3px solid ${importMsg.ok ? 'var(--wf-success, #34d399)' : 'var(--wf-danger, #f87171)'}`,
          borderRadius: 10, padding: '10px 16px', fontSize: 12.5, lineHeight: 1.55,
          color: 'var(--wf-text, #dbe6f5)', textAlign: 'left', wordBreak: 'break-word',
          boxShadow: '0 10px 28px rgba(0, 0, 0, .5)',
          cursor: 'pointer',
        },
        onClick: () => { const act = importMsg.onClick; setImportMsg(null); act?.(); },
      },
      createElement('span', {
        style: { flex: '0 0 auto', fontWeight: 700, color: importMsg.ok ? 'var(--wf-success, #34d399)' : 'var(--wf-danger, #f87171)' },
      }, importMsg.ok ? '✓' : '✕'),
      createElement('span', { style: { flex: '1 1 auto', minWidth: 0 } }, importMsg.text),
    ),
    // 人工确认弹窗 → dialogs/manual-dialog.tsx（弹窗专项批 4：hook 状态 + View 渲染成对拆出）
    createElement(ManualDialogView, { d: manualDlg, def }),
    // ▶ 立即运行一次确认弹窗 → dialogs/schedule-dialog.tsx（弹窗专项批 2+3）
    createElement(ScheduleRunConfirmView, { d: schedDlg, defName: def.name }),
    // ✓ 自检通过确认弹窗 → dialogs/selfcheck-dialog.tsx（弹窗专项批 4）
    createElement(SelfcheckOkDialogView, { d: selfcheckDlg, onRun: handleRun, setSelectedNodeId }),
    // ⚠ 自检未通过拦截弹窗 → dialogs/selfcheck-dialog.tsx（弹窗专项批 4）
    createElement(SelfcheckBlockDialogView, { d: selfcheckDlg, setSelectedNodeId }),
    // 🧾 运行日志弹窗 → dialogs/run-log-dialog.tsx（弹窗专项批 2+3：hook 状态 + View 渲染成对拆出）
    createElement(RunLogDialogView, { d: logDlg, def, setSelectedNodeId, setImportMsg }),
    // 🧾 运行日志（2026-10-04 用户需求：工作流执行黑盒 → 能看到节点之间的参数传递）
  );
}
