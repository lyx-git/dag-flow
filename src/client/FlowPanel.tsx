// @ts-nocheck
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
import { toRF, fromRF, canonicalizeDef, type RFNode, type RFEdge } from './util/flowDef';
import { buildGraphSvg, svgToPngBlob, type GraphImageNode, type GraphImageEdge } from './util/graphImage';
import { varMatch } from './util/varSearch';
import { applyAutoLayout } from './util/layout';
import { Canvas } from './flowgram/FlowGramCanvas';
import { disposeCanvasNode } from './flowgram/FlowGramCanvas';
// ★ 2026-10-14 重构轮 6：模块级工具与检查器字段表单拆至 panel-utils.ts / inspector-fields.tsx（纯搬运）
import {
  TABS, dataPathRow, displayTag, fmtAgo, fmtLastRun, fmtLogValue, fmtRefs, fmtWhen,
  fieldsCacheOf, joinDisplay, logEntryText, logSearchText, logStatusLabel,
  openFolderAt, paramsSummary, codeSummary, reqMark, runFailureDetail, runLogText,
  truncLabel, verDisplayPath,
} from './panel-utils';
import { SessionInputFields, MediaFields, WebFields } from './inspector-fields';
// ★ 2026-10-14 重构轮 7：右侧检查器整体拆至 NodeInspector.tsx（840 行一个组件，不二次切）
import { NodeInspector } from './NodeInspector';
// ★ 2026-10-14 弹窗专项批 1：工作流参数/历史版本/运行失败详情三弹窗成对拆出（hook 状态留在本组件实例）
import { useInputsDialog, InputsDialogView } from './dialogs/inputs-dialog';
import { useVersionsDialog, VersionsDialogView } from './dialogs/versions-dialog';
import { useRunFailDialog, RunFailDialogView } from './dialogs/run-fail-dialog';
import { useSchedulesDialog, SchedulesDialogView, ScheduleRunConfirmView } from './dialogs/schedule-dialog';
import { useRunLogDialog, RunLogDialogView } from './dialogs/run-log-dialog';
// ★ 失败策略显形（2026-10-04 轮 7）：def 里的策略同步进 store，卡片订阅后显示 chip
import { failPolicyStore } from './flowgram/failPolicyStore';
import { JsonView } from './JsonView';
import { normalizeWorkflowName } from '../name-rule';
import { ensurePickerStyles } from './workflow-picker';
import { startResize8, readStoredJSON, saveJSON, clampNum, type RightGeom } from './util/edge-drag';
// ★ 定时任务（⏰，2026-10-03 用户拍板方案 v1，docs/SCHEDULE-PLAN.md §6）：cron 校验/中文预览
//   直接复用宿主同一个纯模块 —— 面板预览与宿主实际执行必然同一套语义。
import { cronError, describeCron } from '../adapter/cron';
// ★ 全局悬浮提示接管（2026-10-13 用户要求：悬浮内容要能复制/选中，且外观与插件主题一致）——
//   模块副作用初始化（幂等）：真机入口与 CDP 夹具都从本模块进入 ⇒ 一处生效。
import { initHoverTips } from './hover-tip';
initHoverTips();


interface FlowPanelProps {
  ctx: MountContext;
  onMount?: () => void;
  onClose?: () => void;
  onCache?: (def: WorkflowDef) => void;
}


export function FlowPanel({ ctx, onClose, onCache }: FlowPanelProps) {
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

  // 自动缓存：def 变化即通过 onCache 上报（供关闭后重开恢复）
  useEffect(() => {
    try { onCache?.(def); } catch { /* 忽略 */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def]);

  // 派生 RF 视图（Canvas/Thumb 共享）
  const { nodes: rfNodes, edges: rfEdges } = useMemo(() => toRF(def), [def]);

  // 节点变更：同步到 WorkflowDef + 通知 host
  const handleRFChange = useCallback(
    (newNodes: RFNode[], newEdges: RFEdge[]) => {
      const next = fromRF(def, newNodes, newEdges);
      setDef(next);
      setDirty(true);
    },
    [def],
  );

  // 装饰节点的编辑桥 + 新建：**必须放在 handleDefChange 之后**（它依赖那个 const；
  //   本项目踩过"后置 const 引用 → TDZ：Cannot access before initialization"的坑）
  // JsonView 直接修改 def
  // ★ 2026-10-08 用户拍板：**写盘统一到 edges**——这些入口拿到的是"原始 def"（JSON 视图就是
  //   JSON.parse 出来的对象），先 canonicalizeDef 归一化（把 next 合并进 edges 并删掉 next），
  //   再落盘；确实发生归一化时给一条浮层提示，免得用户以为"我写的 next 被吞了"。
  const handleDefChange = useCallback((next: WorkflowDef) => {
    const { def: canon, changed } = canonicalizeDef(next);
    setDef(canon);
    setDirty(true);
    if (changed) setImportMsg({ ok: true, text: '已统一为 edges 连线（原 next 已合并进去并移除）——引擎与画布都以 edges 为准' });
  }, []);

  // 节点选中（画布单击 / 缩略图点击 / 表单点击 三处都汇总到这）
  const handleSelectNode = useCallback((id: string | null) => {
    setSelectedNodeId(id);
    // 单击节点即切到画布视图
    if (id) setTab('canvas');
    // ★ 单击选中必展开右侧参数面板（重复点同一节点也要展开——覆盖手动最小化的状态）
    if (id) setRightMin(false);
  }, []);

  // 节点添加（从 palette 拖入：Canvas 自行处理；这里也供 AiGen 等使用）
  const handleAddNode = useCallback(
    (type: string) => {
      const id = `node_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const meta = findMeta(type);
      const newNode = {
        id,
        type,
        label: meta ? `${meta.label}_${id.slice(-4)}` : id,
        params: { ...(meta?.defaultParams ?? {}) },
      };
      const next: WorkflowDef = { ...def, nodes: [...def.nodes, newNode] };
      setDef(next);
      setDirty(true);
      return id;
    },
    [def],
  );

  // 节点删除
  const handleDeleteNode = useCallback(
    (id: string) => {
      const next: WorkflowDef = {
        ...def,
        nodes: def.nodes.filter((n) => n.id !== id),
        edges: def.edges?.filter((e) => e.from !== id && e.to !== id),
      };
      setDef(next);
      setDirty(true);
      if (selectedNodeId === id) setSelectedNodeId(null);
    },
    [def, selectedNodeId],
  );

  // ★ 完整删除 = 先同步 dispose 画布实体，再走 def 更新（2026-10-02 用户反馈：右侧面板
  //   「删除节点」按钮只清面板、画布节点不消失——按钮此前只调 handleDeleteNode，def→画布
  //   的 fromJSON 管线是延迟的；与 Del 快捷键同款两步走，两条入口统一走这里）。
  const deleteNodeFull = useCallback(
    (id: string) => {
      disposeCanvasNode(id);
      handleDeleteNode(id);
    },
    [handleDeleteNode],
  );

  // 节点参数修改
  const handleNodeChange = useCallback(
    (id: string, params: Record<string, unknown>) => {
      // ★ 参数补丁语义修正（2026-10-03，P2 循环设置暴露）：null = 删除该键。
      //   旧实现是浅合并 `{...n.params, ...params}`，于是 {count: null} 会在 def 里留下 "count": null——
      //   节点 schema 里 count 是 integer、over 是 array，落盘后是脏数据。codePath 清空等既有调用点
      //   本来就按「清掉这个键」的意图传 null，所以这里统一成 delete 才是各方真正的期望。
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(params)) if (v !== null) patch[k] = v;
      const next: WorkflowDef = {
        ...def,
        nodes: def.nodes.map((n) => {
          if (n.id !== id) return n;
          const merged: Record<string, unknown> = { ...(n.params ?? {}), ...patch };
          for (const [k, v] of Object.entries(params)) if (v === null) delete merged[k];
          return { ...n, params: merged as typeof n.params };
        }),
      };
      setDef(next);
      setDirty(true);
    },
    [def],
  );

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
  // ★ 运行失败详情弹窗（2026-10-02）：状态/开关拆至 dialogs/run-fail-dialog.tsx
  //   （hook 仍在本组件实例上调用——applyRunSummary/handleRun/头部失败徽标的读写零变化）
  const runDlg = useRunFailDialog();
  const { runResult, setRunResult, runDlgOpen, setRunDlgOpen } = runDlg;
  // ★ 弹窗样式挂载即注入（2026-10-02 用户报「报错信息在左下角」根因：dag-flow-picker 系弹窗
  //   样式由 ensurePickerStyles 注入，过去只有点开 📂 时才注入——停靠模式刷新后直接点 ▶，
  //   失败弹窗因缺样式渲染成面板底部的裸块。挂载即注入（幂等），全部弹窗不再依赖打开顺序）
  useEffect(() => { try { ensurePickerStyles(); } catch { /* 忽略 */ } }, []);
  const [runResults, setRunResults] = useState<Record<string, { status: string; durationMs?: number; count?: number; out?: unknown; error?: { code?: string; message?: string }; tolerated?: boolean }>>({});
  const [running, setRunning] = useState(false);
  // ★ 2026-10-08 用户报「点取消没用、又恢复到运行中」的修复：取消是**异步**的（host 要等当前节点
  //   收尾/被 kill 才真的停），而取消后控制权会交还后台监视器 ✗ → 它一看到 host 还在跑就把界面
  //   点回"运行中" ✗。所以加一个"取消中"状态：期间监视器**不许**写回 running，直到 host 确认
  //   这次运行真的结束（或 404）才清掉取消态，并**浮窗提示「取消成功」**（不在右侧结果条显示「已取消」✗）。
  const [cancelling, setCancelling] = useState(false);
  const cancellingRef = useRef(false);
  // ★ 取消时**立刻踢一次监视器轮询**：否则"取消中"要等监视器下一轮（空闲档 2.5s）才落定 ✗，
  //   期间运行按钮仍是 disabled → 用户（或用例）马上再点 ▶ 会被静默吞掉（2026-10-08 CDP 实测）。
  const [cancelTick, setCancelTick] = useState(0);
  const runAbortRef = useRef<AbortController | null>(null);
  // ★ 人工确认（2026-10-03 用户拍板方案 A）：manual 节点挂起 → 头部 ⏸ 徽标 + 确认弹窗
  const [manualWait, setManualWait] = useState<{ runId: string; nodeId: string; prompt: string } | null>(null);
  const [manualDlgOpen, setManualDlgOpen] = useState(false);
  const [manualNote, setManualNote] = useState('');
  const [manualBusy, setManualBusy] = useState(false);
  /** 中断态：刷新后查回却发现运行已丢（dsh web 重启）→ 明确收尾，不静默变僵尸 */
  const [manualBroken, setManualBroken] = useState<string | null>(null);
  const MANUAL_STORE_KEY = 'dag-flow:manual-wait';

  // ★ 写盘核心（无校验）：自动保存与手动保存共用；snapshot 控制是否生成版本快照
  //   （2026-10-01 夜 用户需求：手动保存生成版本方便回退；自动保存不生成——否则版本太多）
  // ★ 必须声明在 loadVersion 之前——loadVersion 依赖数组渲染期引用它，声明在后 = const TDZ
  //   （与下方 right 面板注释同款坑，2026-10-01 夜真实踩过两次）
  const saveDefToDisk = useCallback(async (target: WorkflowDef, snapshot: boolean): Promise<string> => {
    const res = await fetch('/api/dag-flow/workflows/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // renameFrom=重命名前的旧名（handleRename 记录）→ host 删旧 json + versions/scripts 目录搬移；
      // 保存成功即清空（后续保存不再重复携带）
      body: JSON.stringify({ name: target.name, def: target, snapshot, renameFrom: renameFromRef.current ?? undefined }),
    });
    if (!res.ok) {
      let detail = '';
      try { const d = await res.json(); detail = d?.error ?? ''; } catch { /* */ }
      throw new Error(detail || `HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data.ok) throw new Error(data?.error ?? 'save failed');
    renameFromRef.current = null;
    return data.name as string;
  }, []);

  /** 把 /run 与 /run/resume 的响应统一落到界面（两条路径的 summary 语义相同，避免重复代码） */
  const applyRunSummary = useCallback((data: any): void => {
    setRunResult({ status: data?.ok ? 'success' : 'failed', summary: data?.summary });
    // ★ 2026-10-08 用户拍板：**右侧结果条整个撤掉** ✗ —— 运行成功/失败也改成**浮窗提示**（与「取消成功」同一形态）。
    //   成功 → 自动消失的浮窗（约 2.6s）；失败 → **常驻浮窗 + 点击打开详情弹窗**（失败详情仍要能点开 ✓）。
    if (data?.ok) setImportMsg({ ok: true, text: '运行成功' });
    else setImportMsg({ ok: false, text: '运行失败——点这里看详情', onClick: () => setRunDlgOpen(true) });
    const results = data?.summary?.results as Record<string, { status?: string; durationMs?: number; out?: { count?: number }; error?: { code?: string; message?: string }; tolerated?: boolean }> | undefined;
    if (results) {
      const map: Record<string, { status: string; durationMs?: number; count?: number; out?: unknown; error?: { code?: string; message?: string }; tolerated?: boolean }> = {};
      for (const [id, r] of Object.entries(results)) {
        // ★ P3（2026-10-03）：loop 节点的实际迭代次数取自 out.count，带进画布徽标
        map[id] = {
          status: r.status ?? 'unknown',
          durationMs: r.durationMs,
          ...(typeof r.out?.count === 'number' ? { count: r.out.count } : {}),
          // ★ 悬浮查看节点最终结果（2026-10-03 用户需求）：原样带出 out / error / 容错标记
          ...(r.out !== undefined ? { out: r.out } : {}),
          ...(r.error ? { error: r.error } : {}),
          ...(r.tolerated ? { tolerated: true } : {}),
        };
      }
      setRunResults(map);
    }
  }, []);

  /** 结束人工确认态（确认/取消/中断都要清） */
  const clearManualWait = useCallback((): void => {
    setManualWait(null);
    setManualDlgOpen(false);
    setManualNote('');
    setManualBroken(null);
    try { localStorage.removeItem('dag-flow:manual-wait'); } catch { /* 忽略 */ }
  }, []);

  const handleRun = useCallback(async (runOpts?: { confirmed?: boolean }) => {
    if (dirty) handleSave();
    // AI 节点必须选模型：未选 → 不执行，给出引导
    const noModel = (def.nodes ?? []).filter((n) => n.type === 'subagent' && !String(n.params?.model ?? '').trim());
    if (noModel.length > 0) {
      setRunResult({ status: 'error', error: `以下 AI 节点未选择执行模型，未运行：${noModel.map((n) => n.id).join('、')}。点击节点 → 「选择模型」中选择后重试。` });
      setRunDlgOpen(true);
      return;
    }

    // ===== 第一段（2026-10-04 用户拍板）：点运行 → **先自检**，按钮显示「🔍 自检中…」，此阶段不执行 =====
    if (!runOpts?.confirmed) {
      setSelfcheckState({ phase: 'checking' });
      try {
        const sr = await fetch('/api/dag-flow/selfcheck', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ def }),
        });
        const sd = await sr.json().catch(() => ({}));
        if (!sr.ok) {
          setSelfcheckState(null);
          setRunResult({ status: 'error', error: sd?.error ?? `自检请求失败 HTTP ${sr.status}` });
          setRunDlgOpen(true);
          return;
        }
        const result = {
          items: Array.isArray(sd.items) ? sd.items : [],
          errorCount: Number(sd.errorCount ?? 0),
          warnCount: Number(sd.warnCount ?? 0),
          stats: sd.stats ?? { nodes: (def.nodes ?? []).length, edges: (def.edges ?? []).length },
        };
        if (result.errorCount > 0) {
          // 有问题 → 逐条「报错提示 + 解决办法」，**只给「去修改」**（2026-10-08 用户收严：不提供"仍然运行"旁路）
          setSelfcheckState(null);
          setSelfcheckBlock(result);
          return;
        }
        // 没问题 → 也要人工确认一次（用户要求：自检完成没问题后，手动确认再开始真正运行）
        setSelfcheckState({ phase: 'ok', result });
        return;
      } catch (e) {
        setSelfcheckState(null);
        setRunResult({ status: 'error', error: `自检失败：${(e as Error).message}` });
        setRunDlgOpen(true);
        return;
      }
    }

    // ===== 第二段：自检通过且人工确认过了 → 真正开跑（带 skipSelfcheck:true，不再被 /run 里的自检拦一次）
    //   ★ 只有「✓ 自检通过」弹窗的「开始运行」能走到这里；自检有 error 时弹窗没有运行入口（2026-10-08）。=====
    setSelfcheckState(null);
    setRunning(true);
    manualRunRef.current = true;   // 告诉后台监视让位（手动路径自己轮询并把终态落定）
    setRunResult(null);
    // ★ 2026-10-03 用户需求「画布每个节点都要有状态：待运行/运行中/完成/失败，按运行路径依次显示，
    //   不要最后一次性显示」：起跑先把所有节点置为「待运行」，随后每 600ms 轮询 host 的
    //   /run/status?name=（ActiveRun 累积的逐节点结果 + 正在执行的节点 id），依次点亮；
    //   最终态仍由 POST /run 返回的 summary 落定（applyRunSummary 覆盖过程态）。
    //   为什么按名字查：客户端拿不到 runId —— POST /run 要等运行结束才返回，runId 在响应体里。
    const nodeIds = (def.nodes ?? []).map((n) => n.id);
    setRunResults(progressToStatusMap(nodeIds, {}));
    let stopPoll = false;
    let pollTimer: number | null = null;
    const pollProgress = async (): Promise<void> => {
      if (stopPoll) return;
      try {
        const r = await fetch(`/api/dag-flow/run/status?name=${encodeURIComponent(def.name)}`);
        if (r.ok) {
          const j = (await r.json()) as { status?: string; results?: Record<string, { status?: string }>; running?: string[] };
          if (!stopPoll && (j?.status === 'running' || j?.status === 'awaiting')) {
            setRunResults(progressToStatusMap(nodeIds, { results: j.results, running: j.running }));
          }
        }
      } catch { /* 轮询失败不打扰用户，下一轮再试 */ }
      if (!stopPoll) pollTimer = window.setTimeout(() => { void pollProgress(); }, 600);
    };
    void pollProgress();
    let keepRunning = false; // 撞上人工确认：运行还在继续，不能把 running 收掉
    const ac = new AbortController();
    runAbortRef.current = ac;
    try {
      // 优先走 host onRun（若已接）；否则直接调 run API
      if (typeof ctx.onRun === 'function') {
        await ctx.onRun();
        return;
      }
      const res = await fetch('/api/dag-flow/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ def, skipSelfcheck: true }),
        signal: ac.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 兜底：绕过客户端自检直接调 /run 时，/run 里的自检仍会拦（409 blocked）
        if (res.status === 409 && data?.blocked && data?.selfcheck) {
          const sc = data.selfcheck;
          setSelfcheckBlock({ items: Array.isArray(sc.items) ? sc.items : [], errorCount: Number(sc.errorCount ?? 0), warnCount: Number(sc.warnCount ?? 0), stats: sc.stats });
          setRunning(false);
          manualRunRef.current = false;
          return;
        }
        setRunResult({ status: 'error', error: data?.error ?? `HTTP ${res.status}` });
        setRunDlgOpen(true);
        return;
      }
      // ★ 202 人工确认挂起（2026-10-03）：不 hold 连接，等用户点「确认并继续」再 POST /run/resume
      if (data?.status === 'awaiting' && data?.runId) {
        keepRunning = true;
        const info = { runId: String(data.runId), nodeId: String(data.awaiting?.nodeId ?? ''), prompt: String(data.awaiting?.prompt ?? '') };
        setManualWait(info);
        setManualNote('');
        setManualDlgOpen(true);
        try { localStorage.setItem(MANUAL_STORE_KEY, JSON.stringify(info)); } catch { /* 忽略 */ }
        return;
      }
      applyRunSummary(data);
    } catch (e) {
      // ★ 2026-10-08 用户要求：取消**不要**在右侧结果条显示「✗ 已取消」✗——所以这里不再写 runResult，
      //   只让取消流程静默结束；「取消成功」由监视器在宿主确认结束后用浮窗提示。
      if ((e as Error).name !== 'AbortError') { setRunResult({ status: 'error', error: (e as Error).message }); setRunDlgOpen(true); }
    } finally {
      stopPoll = true;
      if (pollTimer != null) window.clearTimeout(pollTimer);
      if (!keepRunning) {
        // ★ 2026-10-08：**取消中不要立刻把 running 置回 false** ✗——本地 fetch 被 abort 会立刻走到这里，
        //   于是头部先闪回「▶ 待运行」、取消按钮消失，随后监视器发现宿主还在跑又把界面点回「取消中…」
        //   （用户实测："先回到待运行、再跳回取消中"）。取消态统一交给监视器在宿主确认结束后收尾。
        if (!cancellingRef.current) setRunning(false);
        manualRunRef.current = false;   // 手动路径结束，后台监视恢复接管（定时运行照常点亮；取消时它负责探测"真的停了"）
        runAbortRef.current = null;
      }
    }
  }, [ctx, dirty, handleSave, def, applyRunSummary, MANUAL_STORE_KEY]);

  /** 确认并继续：POST /run/resume（该请求 hold 到跑完，返回完整 summary） */
  const confirmManual = useCallback(async () => {
    if (!manualWait) return;
    setManualBusy(true);
    try {
      const res = await fetch('/api/dag-flow/run/resume', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runId: manualWait.runId, value: manualNote }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 404 = 运行已丢（dsh 重启）；409 = 状态不符（多半已结束）
        setManualBroken(`${data?.error ?? `HTTP ${res.status}`}\n运行：${manualWait.runId}`);
        setManualDlgOpen(true);
        return;
      }
      clearManualWait();
      applyRunSummary(data);
    } catch (e) {
      setManualBroken(`确认失败：${(e as Error).message}`);
    } finally {
      setManualBusy(false);
      if (!cancellingRef.current) setRunning(false);   // ★ 取消中：保持取消态，交给监视器收尾（同上）
      manualRunRef.current = false;   // 人工确认路径结束 → 后台监视恢复接管
      runAbortRef.current = null;
    }
  }, [manualWait, manualNote, clearManualWait, applyRunSummary]);

  /** 取消本次运行（弹窗内）：走既有 DELETE 通道——host 会 reject 挂起的 manual 节点再 abort */
  const cancelManualRun = useCallback(() => {
    // ★ 2026-10-08：与头部取消按钮同一套语义——进入"取消中"态，不立刻把 running 置回 false ✗，
    //   等监视器确认宿主真的停了再**浮窗提示「取消成功」**（右侧结果条不动 ✗）。
    cancellingRef.current = true;
    setCancelling(true);
    setCancelTick((n) => n + 1);   // 立刻踢一次监视器轮询（同上）
    void fetch(`/api/dag-flow/run?name=${encodeURIComponent(def.name)}`, { method: 'DELETE', credentials: 'include' }).catch(() => {});
    runAbortRef.current?.abort();
    clearManualWait();
    manualRunRef.current = false;
  }, [def.name, clearManualWait]);

  /** 撤销误发的 DELETE（刷新后查回等待态时用）：发现状态不符就清掉本地等待标记 */
  const refreshManualState = useCallback(async (info: { runId: string; nodeId: string; prompt: string }): Promise<void> => {
    try {
      const res = await fetch(`/api/dag-flow/run/status?runId=${encodeURIComponent(info.runId)}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.status === 'awaiting') {
        setManualWait(info);
        setManualDlgOpen(true);
        setRunning(true);
        return;
      }
      if (res.ok && data?.status === 'completed' && data?.summary) {
        clearManualWait();
        applyRunSummary({ ok: (data.summary as { status?: string })?.status === 'success', summary: data.summary });
        return;
      }
      if (!res.ok) {
        // 运行已丢（dsh 重启）→ 明确收尾
        setManualBroken(`${data?.error ?? `HTTP ${res.status}`}\n运行：${info.runId}（节点 ${info.nodeId}）`);
        setManualWait(info);
        setManualDlgOpen(true);
        return;
      }
      clearManualWait();
    } catch { clearManualWait(); }
  }, [clearManualWait, applyRunSummary]);

  // 挂载时恢复等待态（刷新页面 / 重挂面板后仍能看到 ⏸ 与确认弹窗）
  useEffect(() => {
    let info: { runId: string; nodeId: string; prompt: string } | null = null;
    try {
      const raw = localStorage.getItem('dag-flow:manual-wait');
      if (raw) info = JSON.parse(raw);
    } catch { info = null; }
    if (info?.runId) void refreshManualState(info);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 取消运行：本地 abort + 通知服务端 abort（RUN_CANCELLED）
   *  ★ 2026-10-08：进入"取消中"状态——不再立刻把 running 交还给后台监视器（它会把界面点回运行中 ✗），
   *  由监视器轮询到 host 确认结束后**浮窗提示「取消成功」**（右侧结果条不显示「已取消」✗）。 */
  const cancelRun = useCallback(() => {
    cancellingRef.current = true;
    setCancelling(true);
    setCancelTick((n) => n + 1);   // 立刻踢一次监视器轮询
    runAbortRef.current?.abort();
    void fetch(`/api/dag-flow/run?name=${encodeURIComponent(def.name)}`, { method: 'DELETE', credentials: 'include' }).catch(() => {});
    if (manualWait) { clearManualWait(); setManualNote(''); }
  }, [def.name, manualWait, clearManualWait]);

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
            const newId = `node_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
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

  // 手动保存到 <DSH_HOME>/.dag-flow/workflow/<name>.json（调 host API；2026-10-11 起与工作区无关）；AI 节点必须已选模型；
  // ★ 手动保存生成版本快照（服务端把本次保存的内容存档到 versions/，可回载回退）
  // （自动保存跳过此校验——自动保存永不阻塞，模型缺失由运行时校验兜底）
  const handleSaveToDisk = useCallback(async (): Promise<string> => {
    const noModel = (def.nodes ?? []).filter((n) => n.type === 'subagent' && !String(n.params?.model ?? '').trim());
    if (noModel.length > 0) {
      throw new Error(`以下 AI 节点未选择执行模型：${noModel.map((n) => n.id).join('、')}。请在节点配置的「选择模型」中选择后重试。`);
    }
    return saveDefToDisk(def, true);
  }, [def, saveDefToDisk]);

  // ★ 自动保存（防抖）：def 变更后 2s 无新变更即写盘；拖拽等高频变更期间不断重置不刷盘。
  //   手动保存/自动保存写同一文件，先到先得、内容幂等。
  const autoSaveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!dirty) return;
    setAutoSave('pending');
    if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = window.setTimeout(() => {
      autoSaveTimer.current = null;
      setAutoSave('saving');
      // ★ 自动保存不生成版本快照（snapshot:false）——版本只由手动保存产生
      saveDefToDisk(def, false)
        .then(() => { setAutoSave('idle'); setDirty(false); })
        .catch(() => { setAutoSave('error'); });
    }, 2000);
    return () => { if (autoSaveTimer.current) { window.clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null; } };
  }, [def, dirty, saveDefToDisk]);

  // 2026-10-01 深夜：管理视图随「📋 管理」tab 移除——列表/打开/复制/删除/重命名统一收进打开/新建选择器
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string; onClick?: () => void } | null>(null);
  // ★ 2026-10-09：导出菜单（⬇ 按钮 → 导出 JSON / 导出图片 PNG）；menuAt = 按钮位置，用于 fixed 锚定
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportMenuAt, setExportMenuAt] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  // ★ 2026-10-08：**成功类浮窗自动消失**（约 2.6s）——否则「取消成功」这类提示会一直挂着等用户点 ✗；
  //   失败类（ok:false）保留"点击关闭"，避免错误信息被自动吞掉。
  useEffect(() => {
    if (!importMsg?.ok) return;
    const t = window.setTimeout(() => setImportMsg(null), 2600);
    return () => window.clearTimeout(t);
  }, [importMsg]);
  // 版本管理（#14-② + 2026-10-01 夜）：状态与 openVersions/loadVersion 拆至 dialogs/versions-dialog.tsx
  //   （hook 仍在本组件实例上调用；须在 setImportMsg 声明之后——hook 入参引用它，放前面会 const TDZ）
  const verDlg = useVersionsDialog({ def, saveDefToDisk, onDefChange: handleDefChange, setDirty, setImportMsg });
  const { verOpen, setVerOpen, verList, verLoading, verH, setVerH, verOff, setVerOff, verDir, openVersions, loadVersion } = verDlg;

  // 自动布局：按拓扑分层重排节点
  const handleAutoLayout = useCallback(() => {
    const next = applyAutoLayout(def);
    setDef(next);
    setDirty(true);
  }, [def]);

  // ★ 重命名联动（2026-10-02 用户需求「名称改了，响应使用的地方也要改，保持一致」）：
  //   renameFromRef 记录本次会话内**最初**的旧名（每键 onChange 都会进来，不覆盖已记录值），
  //   保存时随 body 带给 host——storage 层删旧 json + versions/scripts 子目录搬移。
  const renameFromRef = useRef<string | null>(null);
  // 名称修改
  const handleRename = useCallback((name: string) => {
    setDef((prev) => {
      const newName = name || 'my-workflow';
      const oldName = prev.name;
      if (oldName !== newName && !renameFromRef.current) renameFromRef.current = oldName;
      // def 内引用同步：a) python/bash 的 codePath 前缀 scripts/<旧名>/ → scripts/<新名>/
      //                  b) subflow 的 workflowName === 旧名 → 新名
      const oldPrefix = `scripts/${oldName}/`;
      const newPrefix = `scripts/${newName}/`;
      const nodes = prev.nodes.map((n) => {
        if (n.type === 'python' || n.type === 'bash') {
          const cp = n.params?.codePath;
          if (typeof cp === 'string' && cp.startsWith(oldPrefix)) {
            return { ...n, params: { ...(n.params ?? {}), codePath: newPrefix + cp.slice(oldPrefix.length) } };
          }
        }
        if (n.type === 'subflow' && n.params?.workflowName === oldName) {
          return { ...n, params: { ...(n.params ?? {}), workflowName: newName } };
        }
        return n;
      });
      return { ...prev, name: newName, nodes };
    });
    setDirty(true);
  }, []);

  // A2 文件导出/导入（工作流 JSON 文件）
  const exportFile = useCallback(() => {
    setExportMenuOpen(false);
    try {
      const blob = new Blob([JSON.stringify(def, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${def.name || 'workflow'}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setImportMsg({ ok: false, text: `导出失败：${(e as Error).message}` });
    }
  }, [def]);

  /**
   * ★ 2026-10-09 用户需求「导出 json 已经有导出按钮了，导出图片可以集成到一起」：
   * 用**自己画的 SVG → PNG**（零依赖；官方 free-export-plugin 未安装、html2canvas 会新增依赖 ✗）。
   * 坐标取画布 RF 位置（所见布局），节点卡沿用 NODE_PALETTE 的类型色/图标/显示名。
   */
  const exportImage = useCallback(async () => {
    setExportMenuOpen(false);
    try {
      const nodes: GraphImageNode[] = rfNodes.map((n) => {
        const label = (n.data as { label?: unknown } | undefined)?.label;
        return {
          id: n.id,
          type: n.type,
          ...(typeof label === 'string' && label ? { label } : {}),
          x: n.position?.x ?? 0,
          y: n.position?.y ?? 0,
        };
      });
      const edges: GraphImageEdge[] = rfEdges.map((e) => ({
        from: e.source,
        to: e.target,
        ...(e.label ? { when: String(e.label) } : {}),
      }));
      const svg = buildGraphSvg({
        title: def.name,
        nodes,
        edges,
        metaOf: (t) => {
          const m = findMeta(t);
          return m ? { label: m.label, emoji: m.emoji, color: m.color } : undefined;
        },
      });
      const blob = await svgToPngBlob(svg, 2);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${def.name || 'workflow'}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
      setImportMsg({ ok: true, text: `已导出图片（${nodes.length} 节点 · ${edges.length} 连线）` });
    } catch (e) {
      setImportMsg({ ok: false, text: `导出图片失败：${(e as Error).message}` });
    }
  }, [def.name, rfNodes, rfEdges]);
  /** 导出 SVG（矢量）——与 PNG 同一份 SVG，只是直接落盘（更清晰、可再编辑/无限缩放） */
  const exportSvg = useCallback(() => {
    setExportMenuOpen(false);
    try {
      const nodes: GraphImageNode[] = rfNodes.map((n) => {
        const label = (n.data as { label?: unknown } | undefined)?.label;
        return {
          id: n.id,
          type: n.type,
          ...(typeof label === 'string' && label ? { label } : {}),
          x: n.position?.x ?? 0,
          y: n.position?.y ?? 0,
        };
      });
      const edges: GraphImageEdge[] = rfEdges.map((e) => ({
        from: e.source,
        to: e.target,
        ...(e.label ? { when: String(e.label) } : {}),
      }));
      const svg = buildGraphSvg({
        title: def.name,
        nodes,
        edges,
        metaOf: (t) => {
          const m = findMeta(t);
          return m ? { label: m.label, emoji: m.emoji, color: m.color } : undefined;
        },
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
      a.download = `${def.name || 'workflow'}.svg`;
      a.click();
      URL.revokeObjectURL(a.href);
      setImportMsg({ ok: true, text: `已导出矢量图 SVG（${nodes.length} 节点 · ${edges.length} 连线）` });
    } catch (e) {
      setImportMsg({ ok: false, text: `导出 SVG 失败：${(e as Error).message}` });
    }
  }, [def.name, rfNodes, rfEdges]);

  const importFile = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.nodes) || parsed.nodes.length < 2) {
        throw new Error('需要包含 nodes（≥2 个节点）的工作流 JSON');
      }
      if (!parsed.name) parsed.name = normalizeWorkflowName(file.name.replace(/\.json$/i, '')) || 'imported';
      if (!parsed.version) parsed.version = 1;
      handleDefChange(parsed);
      setTab('canvas');
      setImportMsg({ ok: true, text: `已导入「${parsed.name}」（${parsed.nodes.length} 节点），记得💾保存落盘` });
    } catch (e) {
      setImportMsg({ ok: false, text: `导入失败：${(e as Error).message}。请确认是工作流 JSON 文件（可先在 JSON 视图检查格式）。` });
    }
  }, [handleDefChange]);

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
  // ★ 运行前自检拦住（2026-10-04 轮 1）：存住 host 返回的问题清单（含解决办法），弹窗让用户人工确认
  const [selfcheckBlock, setSelfcheckBlock] = useState<{ items: { level?: string; code?: string; nodeId?: string; message?: string; fix?: string }[]; errorCount: number; warnCount?: number; stats?: { nodes?: number; edges?: number } } | null>(null);
  // 「点运行 → 先自检（按钮显示『自检中…』）→ 自检通过 → 人工确认 → 才真正开跑」的中间态
  const [selfcheckState, setSelfcheckState] = useState<null | { phase: 'checking' } | { phase: 'ok'; result: { items: any[]; errorCount: number; warnCount: number; stats: { nodes?: number; edges?: number } } }>(null);
  // ===== 后台运行监视（2026-10-03 用户真机反馈：「定时任务执行，工作流的状态不会变化」）=====
  //   根因：逐节点状态轮询原来只挂在**手动点运行**那条路径上，而定时触发是宿主调度器直接跑，
  //   客户端毫不知情 → 画布不点亮、头部也不显示运行态。
  //   现在：面板挂载期间后台轮询 GET /run/status?name=<当前工作流>，**任何来源**（手动/定时）的运行
  //   都会点亮画布；检测到在跑就切快档（600ms），跑完收敛到终态（宿主会回退到「最近一次完成的运行」），
  //   若 ⏰ 弹窗开着则顺手刷新「上次/下次」。与手动路径互不干扰：手动跑时 running=true，这里让位。
  const lastSigRef = useRef('');
  // 手动点运行进行中（handleRun 自己轮询并落定终态）→ 后台监视让位，避免两套轮询互相覆盖
  const manualRunRef = useRef(false);
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
          const r = await fetch(`/api/dag-flow/run/status?name=${encodeURIComponent(def.name)}`);
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
            const sig = JSON.stringify([j.status, j.results ?? {}, j.running ?? []]);
            if (sig !== lastSigRef.current) {
              lastSigRef.current = sig;
              setRunResults(progressToStatusMap(nodesRef.current, { results: j.results as never, running: j.running }));
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

  return createElement(
    'div',
    { className: 'dsh-wf-root' },
    // 顶部 header
    createElement(
      'header',
      { className: 'dsh-wf-header' },
      createElement('span', { className: 'dsh-wf-logo', title: '工作流搭建器' },
        createElement('svg', {
          width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none',
          stroke: '#fff', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round',
        },
          createElement('rect', { x: '3', y: '3', width: '7', height: '7', rx: '1.5' }),
          createElement('rect', { x: '14', y: '14', width: '7', height: '7', rx: '1.5' }),
          createElement('circle', { cx: '17.5', cy: '6.5', r: '2.5' }),
          createElement('path', { d: 'M10 6.5h5M10 17.5h1.5M17.5 9v5' }),
        ),
      ),
      createElement('input', {
        className: 'dsh-wf-name-input',
        value: def.name,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => handleRename(e.target.value),
        placeholder: '工作流名称',
        title: '自定义工作流名称（保存后用于识别）',
      }),
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
      createElement('span', { className: 'dsh-wf-title-sub' },
        !dirty ? '✓ 已保存'
        : autoSave === 'saving' ? '⏳ 自动保存中…'
        : autoSave === 'error' ? '⚠ 自动保存失败（请手动保存）'
        : '● 未保存（将自动保存）'),
      createElement('div', { className: 'dsh-wf-tabs' }, ...TABS.map((t) =>
        createElement(
          'button',
          {
            key: t.id,
            className: `dsh-wf-tab ${tab === t.id ? 'active' : ''}`,
            onClick: () => setTab(t.id),
            title: t.label, // 紧凑模式：只显示图标，汉字悬停提示
          },
          `${t.emoji}`,
        ),
      )),
      // ⬇⬆ 导入导出紧跟 JSON 标签（2026-10-02 用户指定头部排列）
      //   ★ 2026-10-09：⬇ 从「直接导出 JSON」改成**导出菜单**（导出 JSON / 导出图片 PNG）——
      //   用户原话「导出 json 已经有导出按钮了，导出图片可以集成到一起」。
      createElement(
        'button',
        {
          className: `dsh-wf-btn${exportMenuOpen ? ' is-on' : ''}`,
          onClick: (e: { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } }) => {
            // 记下按钮位置 → 菜单锚定在它正下方（fixed 定位，不受头部 overflow 影响）
            const r = e?.currentTarget?.getBoundingClientRect?.();
            if (r) setExportMenuAt({ left: r.left, top: r.bottom + 6 });
            setExportMenuOpen((v) => !v);
          },
          title: '导出（JSON / 图片 PNG）',
        },
        '⬇',
      ),
      createElement(
        'button',
        {
          className: 'dsh-wf-btn',
          title: '从 .json 文件导入工作流',
          onClick: () => {
            const inp = document.createElement('input');
            inp.type = 'file';
            inp.accept = '.json,application/json';
            inp.onchange = () => { const f = inp.files?.[0]; if (f) void importFile(f); };
            inp.click();
          },
        },
        '⬆',
      ),
      createElement('div', { className: 'dsh-wf-spacer' }),
      // 右侧按钮顺序：工作流参数 → 开始(运行) → 保存 → 版本（2026-10-02 用户指定）
      createElement(
        'button',
        { className: 'dsh-wf-btn', onClick: openInputs, title: '工作流参数（仅当前工作流可用；节点参数里用 {{inputs.名称}} 引用）' },
        '✍️',
      ),
      // ★ 运行按钮：运行中变**动态**状态（方案 D = 弧线旋转环 + 按钮呼吸外发光 + 扫光 + 「运行中」；
      //   2026-10-03 用户在候选原型里拍板 D，弃漏斗/弃字符 ◌）；跑完恢复 ▶
      //   且**排在取消按钮前面**（用户要求「运行中的按钮要放到取消按钮前面」）
      createElement(
        'button',
        {
          className: `dsh-wf-btn dsh-wf-btn-success${running ? ' is-running' : ''}${selfcheckState?.phase === 'checking' ? ' is-checking' : ''}`,
          onClick: () => void handleRun(),
          disabled: running || selfcheckState?.phase === 'checking',
          title: running
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
      // ★ 取消按钮：运行中才出现，排在运行按钮**之后**，且红色
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
      createElement(
        'button',
        {
          className: 'dsh-wf-btn',
          title: '保存工作流到磁盘（<DSH_HOME>/.dag-flow/workflow/）',
          onClick: async () => {
            try {
              const savedName = await handleSaveToDisk();
              setDirty(false);
              try { ctx.onChange?.(def); } catch { /* */ }
              console.log(`[dag-flow] saved workflow: ${savedName}`);
            } catch (e) {
              setImportMsg({ ok: false, text: `保存失败：${(e as Error).message}` });
              console.error('[dag-flow] save failed:', e);
            }
          },
        },
        '💾',
      ),
      createElement(
        'button',
        { className: 'dsh-wf-btn', onClick: () => void openVersions(), title: '历史版本（手动保存生成快照，可回载）' },
        '🕘',
      ),
      // ★ 定时任务（2026-10-03 用户拍板方案 v1，docs/SCHEDULE-PLAN.md §6）：加在「工作流参数/运行/保存/版本」
      //   这一组**之后**（不打断用户 2026-10-02 定下的顺序）；每个工作流可配多条 cron 定时，执行由宿主调度器负责
      createElement(
        'button',
        { className: 'dsh-wf-btn', onClick: openSchedules, title: '定时任务（cron 定时执行本工作流；dsh web 需常驻才会触发）' },
        '⏰',
      ),
      // ★ 运行日志 🧾（2026-10-04 用户需求：「工作流执行黑盒」；用户 2026-10-04 明确要求
      //   「运行日志按钮现在在底部，放到定时任务的后面」→ 必须留在**头部这一排**、紧跟 ⏰ 之后）
      createElement(
        'button',
        {
          className: `dsh-wf-btn dsh-wf-log-btn${logOpen ? ' primary' : ''}`,
          title: '运行日志：每个节点的入参/引用/出参/错误/耗时（运行中自动刷新）',
          onClick: () => setLogOpen((v) => !v),
        },
        '🧾',
      ),
      // 人工确认等待态（2026-10-03 方案 A）：accent 描边徽标，点击重开确认弹窗
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
      runOuts: ((runResult?.summary as { results?: Record<string, unknown> } | undefined)?.results ?? {}),
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
    createElement(SchedulesDialogView, { d: schedDlg, defName: def.name }),
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
    // 结果/操作提示浮窗（保存/导出/导入/运行结果/取消成功）
    //   ★ 2026-10-08 用户要求：**放到上面**（原在底部 18px ✗）——改为顶部锚定，与项目弹窗约定一致（14vh）；
    //   ★ 带 onClick 的（如「运行失败——点这里看详情」）点击执行该动作，否则点击关闭。
    importMsg && createElement(
      'div',
      {
        className: 'dsh-wf-toast',   // ★ 2026-10-09：加类名以便 CSS 做"缩放浮现"入场（见 styles.css 交互动画段）
        title: importMsg.onClick ? '点击查看详情' : '点击关闭',
        style: {
          position: 'fixed', top: '14vh', left: '50%', transform: 'translateX(-50%)', zIndex: 10001,
          background: 'var(--wf-panel, #101a2b)', border: `1px solid ${importMsg.ok ? 'var(--wf-success, #34d399)' : 'var(--wf-danger, #f87171)'}`,
          borderRadius: 8, padding: '6px 14px', fontSize: 12,
          color: importMsg.ok ? 'var(--wf-success, #34d399)' : 'var(--wf-danger, #f87171)',
          cursor: 'pointer',
        },
        onClick: () => { const act = importMsg.onClick; setImportMsg(null); act?.(); },
      },
      `${importMsg.ok ? '✓ ' : '✗ '}${importMsg.text}`,
    ),
    // 人工确认弹窗（2026-10-03 用户拍板：变体 A —— 底部左「✕ 取消本次运行」右「✓ 确认并继续」；
    // 右上 ✕ 只关弹窗、运行继续等待，可从头部 ⏸ 徽标重开）
    manualWait && manualDlgOpen && createElement(
      'div',
      {
        className: 'dag-flow-picker-overlay',
        onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) setManualDlgOpen(false); },
      },
      createElement(
        'div',
        { className: 'dag-flow-picker' },
        createElement('div', { className: 'dag-flow-picker-title' },
          manualBroken ? '⚠ 运行已中断' : '⏸ 等待人工确认',
          createElement('button', {
            className: 'dag-flow-picker-close',
            title: '关闭（运行继续等待，可从头部 ⏸ 徽标重新打开）',
            onClick: () => setManualDlgOpen(false),
          }, '✕'),
        ),
        createElement('div', { className: 'dag-flow-picker-body' },
          createElement('div', { className: 'dag-flow-picker-hint', style: manualBroken ? { fontSize: 11, opacity: 0.72 } : undefined },
            manualBroken
              ? '这次运行停在人工确认上，但已不在 host 内存中（通常是 dsh web 重启过）——运行无法继续，请重新运行工作流。'
              : `工作流「${def.name}」已暂停——确认后从该节点继续执行，取消则终止本次运行。`),
          createElement('div', { className: 'dsh-wf-manual-tag' },
            '✋ ',
            createElement('b', null, displayTag(def, manualWait.nodeId)),
            createElement('span', { className: 'kind' }, '(manual)'),
          ),
          createElement('pre', { className: 'dsh-wf-manual-prompt', style: manualBroken ? { color: 'var(--wf-danger, #f87171)' } : undefined },
            manualBroken ?? manualWait.prompt),
          !manualBroken && createElement('div', null,
            createElement('div', { className: 'dsh-wf-manual-lab' },
              '备注（可选，透传给下游 ', createElement('code', null, `{{${manualWait.nodeId}.out.value}}`), '）'),
            createElement('textarea', {
              className: 'dsh-wf-manual-note',
              value: manualNote,
              placeholder: '例如：已核对，图 2 需替换（留空则不传值）',
              onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setManualNote(e.target.value),
            }),
          ),
          createElement('div', { className: 'dsh-wf-manual-acts' },
            manualBroken
              ? createElement('span', { className: 'dsh-wf-manual-grow' })
              : createElement('button', {
                  className: 'dsh-wf-btn dsh-wf-btn-danger',
                  title: '终止整个运行（已完成节点不回滚）',
                  onClick: cancelManualRun,
                }, '✕ 取消本次运行'),
            createElement('span', { className: 'dsh-wf-manual-grow' }),
            !manualBroken && createElement('span', { className: 'dsh-wf-manual-tip' }, '取消会终止整个运行，已完成节点不回滚'),
            manualBroken
              ? createElement('button', { className: 'dsh-wf-btn', onClick: clearManualWait }, '知道了')
              : createElement('button', {
                  className: 'dsh-wf-btn dsh-wf-btn-primary',
                  disabled: manualBusy,
                  onClick: () => void confirmManual(),
                }, manualBusy ? '⏳ 继续中…' : '✓ 确认并继续'),
          ),
        ),
      ),
    ),
    // ▶ 立即运行一次确认弹窗 → dialogs/schedule-dialog.tsx（弹窗专项批 2+3）
    createElement(ScheduleRunConfirmView, { d: schedDlg, defName: def.name }),
    // ✓ 运行前自检**通过**也要人工确认一次（2026-10-04 用户要求：「自检完成没问题后，手动确认，再开始真正运行」）
    selfcheckState?.phase === 'ok' && createElement(
      'div',
      {
        className: 'dag-flow-picker-overlay',
        onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) setSelfcheckState(null); },
      },
      createElement(
        'div',
        { className: 'dag-flow-picker dsh-wf-selfcheck is-ok' },
        createElement('div', { className: 'dag-flow-picker-title', style: { fontSize: 16 } },
          '✓ 自检通过',
          createElement('button', { className: 'dag-flow-picker-close', title: '关闭（不运行）', onClick: () => setSelfcheckState(null) }, '✕'),
        ),
        createElement('div', { className: 'dag-flow-picker-body' },
          createElement('div', { className: 'dag-flow-picker-hint', style: { fontSize: 11.5, opacity: 0.8, lineHeight: 1.65 } },
            `已检查 ${selfcheckState.result.stats?.nodes ?? 0} 个节点 / ${selfcheckState.result.stats?.edges ?? 0} 条边：结构、连线引用、必填参数、分支键、环路、循环与子工作流依赖都没问题。`,
            selfcheckState.result.warnCount > 0 ? `另有 ${selfcheckState.result.warnCount} 条提醒（不影响运行，可先看看）：` : '点「开始运行」就真正执行，运行期间可以在头部取消。',
          ),
          selfcheckState.result.items.filter((i) => i.level === 'warn').length
            ? createElement('div', { className: 'dsh-wf-selfcheck-list' },
                selfcheckState.result.items.filter((i) => i.level === 'warn').map((it, i) =>
                  createElement('div', {
                    key: i,
                    className: `dsh-wf-selfcheck-item is-warn${it.nodeId ? ' is-clickable' : ''}`,
                    onClick: () => { if (it.nodeId) { setSelectedNodeId(it.nodeId); setSelfcheckState(null); } },
                  },
                    createElement('div', { className: 'dsh-wf-selfcheck-msg' }, `⚠ ${it.message ?? ''}`),
                    it.fix ? createElement('div', { className: 'dsh-wf-selfcheck-fix' }, `👉 解决办法：${it.fix}`) : null,
                  )),
              )
            : null,
          createElement('div', { className: 'dsh-wf-manual-acts' },
            createElement('button', { className: 'dsh-wf-btn', onClick: () => setSelfcheckState(null) }, '✕ 取消'),
            createElement('span', { className: 'dsh-wf-manual-grow' }),
            createElement('button', {
              className: 'dsh-wf-btn dsh-wf-btn-primary',
              onClick: () => { setSelfcheckState(null); void handleRun({ confirmed: true }); },
            }, '▶ 开始运行'),
          ),
        ),
      ),
    ),
    // ⚠ 运行前自检未通过（2026-10-04 轮 1 用户拍板；★2026-10-08 用户收严：**不提供"仍然运行"**，
    //   自检有 error 就必须去改——「去修改」关弹窗并选中第一个出问题的节点，没有旁路按钮）。
    selfcheckBlock && createElement(
      'div',
      {
        className: 'dag-flow-picker-overlay',
        onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) setSelfcheckBlock(null); },
      },
      createElement(
        'div',
        { className: 'dag-flow-picker dsh-wf-selfcheck' },
        createElement('div', { className: 'dag-flow-picker-title', style: { fontSize: 16 } },
          `⚠ 运行前自检未通过（${selfcheckBlock.errorCount} 项）`,
          createElement('button', { className: 'dag-flow-picker-close', title: '关闭（不运行）', onClick: () => setSelfcheckBlock(null) }, '✕'),
        ),
        createElement('div', { className: 'dag-flow-picker-body' },
          createElement('div', { className: 'dag-flow-picker-hint', style: { fontSize: 11.5, opacity: 0.8, lineHeight: 1.65 } },
            '这些问题会让工作流跑不起来、或跑出意料之外的结果。请先按下面的「解决办法」改掉——自检不通过时不能运行。'),
          createElement('div', { className: 'dsh-wf-selfcheck-list' },
            selfcheckBlock.items.filter((i) => i.level === 'error').map((it, i) =>
              createElement('div', {
                key: i,
                className: `dsh-wf-selfcheck-item${it.nodeId ? ' is-clickable' : ''}`,
                onClick: () => { if (it.nodeId) { setSelectedNodeId(it.nodeId); setSelfcheckBlock(null); } },
              },
                createElement('div', { className: 'dsh-wf-selfcheck-msg' }, `✕ ${it.message ?? ''}`),
                it.fix ? createElement('div', { className: 'dsh-wf-selfcheck-fix' }, `👉 解决办法：${it.fix}`) : null,
              )),
          ),
          createElement('div', { className: 'dsh-wf-manual-acts' },
            createElement('button', {
              className: 'dsh-wf-btn dsh-wf-btn-primary',
              onClick: () => {
                const first = selfcheckBlock.items.find((i) => i.level === 'error' && i.nodeId);
                setSelfcheckBlock(null);
                if (first?.nodeId) setSelectedNodeId(first.nodeId);
              },
            }, '✕ 去修改'),
          ),
        ),
      ),
    ),
    // 🧾 运行日志弹窗 → dialogs/run-log-dialog.tsx（弹窗专项批 2+3：hook 状态 + View 渲染成对拆出）
    createElement(RunLogDialogView, { d: logDlg, def, setSelectedNodeId, setImportMsg }),
    // 🧾 运行日志（2026-10-04 用户需求：工作流执行黑盒 → 能看到节点之间的参数传递）
    // 运行失败详情弹窗 → dialogs/run-fail-dialog.tsx（弹窗专项批 1：hook 状态 + View 渲染成对拆出）
    createElement(RunFailDialogView, { d: runDlg, def, setImportMsg }),
  );
}

function renderBody(p: {
  tab: ViewTab;
  def: WorkflowDef;
  rfNodes: RFNode[];
  rfEdges: RFEdge[];
  selectedNode: import('./types').ClientNode | null | undefined;
  ctx: MountContext;
  runResults?: Record<string, { status: string; durationMs?: number; count?: number; out?: unknown; error?: { code?: string; message?: string }; tolerated?: boolean }>;
  /** 运行是否仍在进行（false＝已结束/正在取消）：画布"正在走"的光点只在此期间跑 */
  runActive?: boolean;
  /** 上次运行的真实输出（results.<id>），用于把「用户自定义键/动态节点」的实际字段列出来 */
  runOuts?: Record<string, { status?: string; durationMs?: number; out?: unknown }>;
  onDefChange: (d: WorkflowDef) => void;
  onRFChange: (nodes: RFNode[], edges: RFEdge[]) => void;
  onSelectNode: (id: string | null) => void;
  /** 双击节点：loop/subflow 有目标则进入子工作流（2026-10-03 用户需求） */
  onNodeDoubleClick?: (id: string) => void;
  onAddNode: (type: string) => string;
  onDeleteNode: (id: string) => void;
  onNodeChange: (id: string, params: Record<string, unknown>) => void;
  onNodeError: (id: string, onError: 'stop' | 'continue' | { goto: string }) => void;
  /** ★ 2026-10-04 轮 2：面板唯一的「🛟 本节点失败后」下拉（合并了旧的失败策略 + 失败不影响流程） */
  onNodeFailPolicy: (id: string, policy: 'stop' | 'skip' | 'ignore') => void;
  rightMin?: boolean;
  onRightMin?: (v: boolean) => void;
  rightGeom?: RightGeom;
  onRightGeom?: (g: RightGeom) => void;
  rightRef?: { current: HTMLElement | null };
}) {
  // 有没有"节点级运行结果"：runResults 初值是 `{}`（truthy），必须数 key（见下面 activeEdges 处注释）
  const hasRun = !!p.runResults && Object.keys(p.runResults).length > 0;
  const center =
    p.tab === 'canvas'
      ? createElement(Canvas, {
          def: p.def,
          // 注入运行状态（runStatus）供节点徽标
          nodes: p.runResults ? p.rfNodes.map((n) => {
            const rs = p.runResults?.[n.id];
            return rs ? { ...n, data: { ...n.data, runStatus: rs } } : n;
          }) : p.rfNodes,
          edges: p.rfEdges,
          // 运行路径高亮（用户 2026-10-11 拍板方案 C）：**源节点已成功**的边就算进运行路径，
          //   绿线紧跟执行前沿（不再等两端都完成）。
          // ★ 判据必须看「有没有节点级运行结果」，不能只看 `p.runResults` 是否真值：
          //   runResults 的**初始值就是 `{}`（truthy）**——只判真值会得到一个**空 Set**，
          //   于是画布把"所有边都不在运行路径上"当成事实、进画布就把全部线淡化
          //   （2026-10-11 实现本功能时 CDP 首跑即抓到这个：没跑过也 on=true）。
          //   语义：没有运行结果 → `undefined`（保持原样、一条都不淡）；正在跑但还没有
          //   "源节点成功"的边 → 空 Set（该淡的就该淡）。
          activeEdges: hasRun
            ? new Set(p.rfEdges.filter((e) => p.runResults?.[e.source]?.status === 'success').map((e) => e.id))
            : undefined,
          // 其中"两端都成功"的那部分＝已走通（常亮绿 + 外发光）；差集＝正在走（绿 + 光点跑）
          doneEdges: hasRun
            ? new Set(
                p.rfEdges
                  .filter((e) => p.runResults?.[e.source]?.status === 'success' && p.runResults?.[e.target]?.status === 'success')
                  .map((e) => e.id),
              )
            : undefined,
          onChange: p.onRFChange,
          onSelectNode: p.onSelectNode,
          // ★ 双击 loop（循环体）/ subflow（目标）节点 → 进入子工作流（2026-10-03 用户需求）
          onNodeDoubleClick: p.onNodeDoubleClick,
          selectedNodeId: p.selectedNode?.id ?? null,
          // 运行状态走外置 store（FlowGram 节点卡订阅，不进 document 数据）
          runResults: p.runResults,
          // 运行是否仍在进行 → 决定"正在走"是光点跑（进行中）还是静态绿（已结束/已取消）
          runActive: p.runActive,
          // 缩略图右避让：右面板右偏移+宽（或最小化竖条）+ 面板边距 14 + 间隙 12
          rightInset: p.rightMin ? 66 : (p.rightGeom ? p.rightGeom.r + p.rightGeom.w + 12 : 366),
        })
      : createElement(JsonView, { def: p.def, onChange: p.onDefChange });

  // ★ 右侧：节点参数面板（仅 canvas 显示）。
  // ★ 必须在所有分支 return 之前声明——canvas 分支的 return 引用了它，
  //   声明在后面时是 const TDZ（真机报 Cannot access 'right' before initialization，
  //   2026-10-01 停靠模式首挂即触发的根因）。
  // ★ 2026-10-01 夜：支持最小化（收成右侧竖条）；选中节点时 FlowPanel 自动展开。
  const rightMin = p.rightMin ?? false;
  const right = rightMin
    ? createElement('aside', { className: 'dsh-wf-right min', key: 'right-min' },
        createElement('button', {
          className: 'dsh-wf-right-expand',
          title: '展开参数面板',
          onClick: () => p.onRightMin?.(false),
        }, '«'),
        createElement('div', { className: 'dsh-wf-right-min-label' }, p.selectedNode ? `参数 · ${p.selectedNode.id}` : '参数面板'),
      )
    : createElement('aside', {
        className: 'dsh-wf-right', key: 'right',
        ref: p.rightRef as any,
        style: {
          right: p.rightGeom?.r ?? 14, top: p.rightGeom?.y ?? 14, width: p.rightGeom?.w ?? 340,
          ...(p.rightGeom?.h != null ? { height: p.rightGeom.h, bottom: 'auto' } : {}),
        } as any,
      },
        // 八向拖拽把手（四边+四角）：e/s 改尺寸，w/n 移动位置（左/顶缘跟随光标）
        ...['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((dir) =>
          createElement('div', {
            key: dir,
            className: `dsh-wf-right-resize ${dir}`,
            title: '拖动调整面板大小',
            onMouseDown: (e: any) => {
              const el = p.rightRef?.current;
              const measured = el ? el.getBoundingClientRect().height : 600;
              const g0 = p.rightGeom ?? { r: 14, y: 14, w: 340, h: null };
              const startR = g0.r;
              const toGeom = (g: { x: number; y: number; w: number; h: number }): RightGeom => ({
                // 右缘位移（e 方向）→ r 反向收紧；w/n 方向右缘不动
                r: Math.min(Math.max(startR - ((g.x + g.w) - g0.w), 0), 80),
                y: g.y, w: g.w, h: g.h,
              });
              startResize8(
                e, dir,
                { x: 0, y: g0.y, w: g0.w, h: g0.h ?? measured },
                { minW: 260, maxW: 560, minH: 220, maxH: 1400 },
                (g) => p.onRightGeom?.(toGeom(g)),
                (g) => {
                  const out = toGeom(g);
                  p.onRightGeom?.(out);
                  saveJSON('dag-flow:right-geom', out);
                },
              );
            },
          })),
        createElement('button', {
          className: 'dsh-wf-right-min',
          title: '最小化参数面板',
          onClick: () => p.onRightMin?.(true),
        }, '»'),
        p.selectedNode
          ? createElement(NodeInspector, {
              // ★ key=节点 id：切换选中节点时重挂载——面板全部状态（试跑结果/试跑输入/模型下拉）
              //   严格跟随当前节点，不再串显上个节点的内容（2026-10-02 用户反馈）
              key: p.selectedNode.id,
              node: p.selectedNode,
              defNodes: p.def.nodes,
              edges: p.rfEdges,
              inputs: p.def.inputs,
              runOuts: p.runOuts ?? {},
              workflowName: p.def.name,
              onDelete: () => p.onDeleteNode(p.selectedNode!.id),
              onParamsChange: (params) => p.onNodeChange(p.selectedNode!.id, params),
              onError: p.selectedNode.onError ?? 'stop',
              onNodeError: (onError) => p.onNodeError(p.selectedNode!.id, onError),
              tolerate: p.selectedNode.tolerate === true,
              onFailPolicyChange: (policy) => p.onNodeFailPolicy(p.selectedNode!.id, policy),
            })
          : createElement(
              'div',
              { className: 'dsh-wf-panel-section', style: { padding: '16px 12px' } },
              '👈 点击节点查看/编辑参数',
            ),
      );

  if (p.tab === 'canvas') {
    // FlowGram 画布自带左侧节点面板（startDragCard 拖拽），不再渲染共享 palette
    return createElement('div', { className: 'dsh-wf-body' },
      createElement('div', { className: 'dsh-wf-center dsh-wf-center-full' }, center),
      right,
    );
  }

  if (p.tab === 'json') {
    // 这些视图自带三栏 / 不需要共享 palette
    return createElement('div', { className: 'dsh-wf-body' },
      createElement('div', { className: 'dsh-wf-center dsh-wf-center-full' }, center)
    );
  }

  return createElement('div', { className: 'dsh-wf-body' },
    createElement('div', { className: 'dsh-wf-center dsh-wf-center-full' }, center),
    right,
  );
}

// 节点参数检查器（简化版：动态渲染 key-value）
// subagent 节点额外提供模型下拉选择（DSH 配置 + 用户自定义模型）
