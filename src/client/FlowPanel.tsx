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
  const [runResult, setRunResult] = useState<{ status: string; summary?: unknown; error?: string } | null>(null);
  // ★ 运行失败详情弹窗（2026-10-02 用户需求：报错不再在 logo 后行内截断显示，改弹窗看全量）
  const [runDlgOpen, setRunDlgOpen] = useState(false);
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

  // 版本管理（#14-② + 2026-10-01 夜：手动保存生成快照到 versions/，此处弹窗列表与回载）
  const [verOpen, setVerOpen] = useState(false);
  const [verList, setVerList] = useState<{ ts: string }[]>([]);
  const [verLoading, setVerLoading] = useState(false);
  // 版本弹窗高度（2026-10-01 夜用户需求：上边缘可上下拖动，展示更多版本）
  const [verH, setVerH] = useState(420);
  // 版本弹窗「上移偏移」（2026-10-04 用户要求：弹窗位置与 ⏰ 定时任务弹窗保持一致——默认落点 14vh，
  //   拖上边缘时顶边跟随光标上移，偏移量记在这里；clamp 在 [0, 14vh-16px]，绝不让顶边越出视口）
  const [verOff, setVerOff] = useState(0);
  // 版本数据实际落盘目录（服务端 versions 列表响应携带 dir；弹窗里标注存储位置）
  const [verDir, setVerDir] = useState('');
  const openVersions = useCallback(async () => {
    ensurePickerStyles(); // 版本弹窗复用 picker 的 .dag-flow-picker-* 样式——没开过 📂 时也要有样式
    setVerOpen(true);
    // 每次打开都回到默认落点（14vh，与 ⏰ 定时任务弹窗一致）——上移偏移只影响本次打开期间；
    // 高度 verH 仍然记忆（用户上轮拖高看更多版本的需求，见 2026-10-01 夜）
    setVerOff(0);
    setVerLoading(true);
    try {
      const res = await fetch(`/api/dag-flow/workflows/${encodeURIComponent(def.name)}/versions`, { credentials: 'include' });
      const data = await res.json();
      setVerList(data.versions ?? []);
      setVerDir(String(data.dir ?? ''));
    } catch { setVerList([]); setVerDir(''); }
    setVerLoading(false);
  }, [def.name]);

  const loadVersion = useCallback(async (ts: string) => {
    try {
      const res = await fetch(`/api/dag-flow/workflows/${encodeURIComponent(def.name)}/versions/${encodeURIComponent(ts)}`, { credentials: 'include' });
      const data = await res.json();
      if (data?.workflow) {
        // 回载 = 受控保存两步：先以 snapshot:true 落盘当前内容（与最新版本相同则服务端去重跳过），
        // 回载前的当前内容成为新版本、随时可再退回；再以 snapshot:false 写入回载内容（回载本身不算一次保存）
        await saveDefToDisk(def, true).catch(() => {});
        await saveDefToDisk(data.workflow as WorkflowDef, false).catch(() => {});
        handleDefChange(data.workflow);
        setVerOpen(false);
        setDirty(true);
      }
    } catch { /* 忽略 */ }
  }, [def, handleDefChange, saveDefToDisk]);
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

  // A3 工作流参数（def.inputs，原「工作流级输入/全局参数」）编辑弹窗——改动即自动保存（2026-10-02 用户需求）
  const [inputsOpen, setInputsOpen] = useState(false);
  const [inputsRows, setInputsRows] = useState<{ k: string; v: string }[]>([]);
  const openInputs = useCallback(() => {
    ensurePickerStyles(); // 弹窗用 dag-flow-picker 样式——先于选择器打开时也要保证已注入
    const rows = Object.entries(def.inputs ?? {}).map(([k, v]) => ({ k, v: typeof v === 'string' ? v : JSON.stringify(v) }));
    // 默认一条空行（视觉占位；名称为空的行不写入 def，不算数据）
    setInputsRows(rows.length ? rows : [{ k: '', v: '' }]);
    setInputsOpen(true);
  }, [def.inputs]);
  // 行任意变更（输入/删除）→ 过滤掉名称为空的行 → 立即写回 def（磁盘落盘走既有 2s 防抖自动保存，不生成版本）
  const pushInputs = useCallback((rows: { k: string; v: string }[]) => {
    setInputsRows(rows);
    const inputs: Record<string, unknown> = {};
    for (const { k, v } of rows) {
      const key = k.trim();
      if (!key) continue;
      try { inputs[key] = JSON.parse(v); } catch { inputs[key] = v; }
    }
    handleDefChange({ ...def, inputs });
  }, [def, handleDefChange]);

  // ===== 定时任务弹窗（⏰，2026-10-03 用户拍板方案 v1）=====
  //   与工作流参数弹窗同一套弹窗约定（右上 ✕ / hint 小字 / 行尾 ✕ / 底部虚线 ＋ / 改动即自动保存）；
  //   配置存宿主侧 .dag-flow/schedules.json，到点由宿主调度器执行（dsh web 需常驻）。
  const [schedOpen, setSchedOpen] = useState(false);
  const [schedItems, setSchedItems] = useState<any[]>([]);
  /** ★ 2026-10-04：schedItems 的**同步镜像**（列表唯一写入口是这里 + loadSchedules）。
   *  补丁保存必须基于最新列表，不能读闭包里的 state（见 patchScheduleLocal 的注释）。 */
  const schedItemsRef = useRef<any[]>([]);
  const [schedInfo, setSchedInfo] = useState<any>(null);
  /** 定时配置落盘文件全路径（服务端 /schedules 响应带 dir = …/schedules.json）——弹窗里标注并点击打开 */
  const [schedDir, setSchedDir] = useState('');
  const [schedNote, setSchedNote] = useState('');
  const [schedBad, setSchedBad] = useState<Record<string, string>>({});
  /** ★ 2026-10-04 用户拍板「cron 改成手动确认生效」：编辑中的**草稿**（id → 文本）。
   *  敲键只改草稿、不落盘；点该行的「保存」才写盘生效（非法表达式时保存按钮禁用）。
   *  与启用/停用的区别：启用/停用本身就是一次明确动作，点一下即生效（用户同轮确认）。 */
  const [schedDraft, setSchedDraft] = useState<Record<string, string>>({});
  /** 本工作流里「人工确认」节点数（0 时不显示自动通过说明，避免噪音） */
  const manualCount = (def.nodes ?? []).filter((n) => n.type === 'manual').length;
  const loadSchedules = useCallback(async () => {
    try {
      const res = await fetch(`/api/dag-flow/schedules?workflow=${encodeURIComponent(def.name)}`, { credentials: 'include' });
      const data = await res.json();
      const items = Array.isArray(data.items) ? data.items : [];
      schedItemsRef.current = items;      // ★ 与 ref 镜像同步（唯一写入口）
      setSchedItems(items);
      setSchedInfo(data.scheduler ?? null);
      setSchedDir(String(data.dir ?? ''));
      setSchedNote(data.warning ? String(data.warning) : '');
    } catch (e) {
      setSchedNote('读取定时配置失败：' + (e as Error).message);
    }
  }, [def.name]);
  const openSchedules = useCallback(() => {
    ensurePickerStyles();
    setSchedOpen(true);
    setSchedDraft({});          // 每次打开都是干净的：草稿不跨次保留
    void loadSchedules();
  }, [loadSchedules]);
  /** 保存一条（整条 body）——cron 非法时宿主会 400 且不落盘，这里把中文原因显示在该行下面 */
  const saveSchedule = useCallback(async (item: any) => {
    setSchedBad((m) => ({ ...m, [item.id ?? 'new']: '' }));
    try {
      const res = await fetch('/api/dag-flow/schedules/save', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(item),
      });
      const data = await res.json();
      if (!res.ok) { setSchedBad((m) => ({ ...m, [item.id ?? 'new']: String(data.error ?? '保存失败') })); return; }
      await loadSchedules();
    } catch (e) {
      setSchedBad((m) => ({ ...m, [item.id ?? 'new']: (e as Error).message }));
    }
  }, [loadSchedules]);
  /** 改动即保存（**立即落盘**）。
   *  ★ 2026-10-04 清理：原先这里还有个 1.2s 防抖分支（`opts.debounce` + `schedTimers`），
   *    在 cron 改成「草稿 + 行内保存」后**已无调用方**，故整体删除。删它的另一个理由：
   *    那个分支把记录快照在**注册防抖时**取走，1.2s 后才发出——正是"改完 cron 后点开关被弹回"
   *    那个竞态的载体；留着等于给未来埋一颗静默复现的雷。若将来真要防抖保存，
   *    记得必须**在触发时**重读 `schedItemsRef.current`，不要用注册时算好的值。 */
  const patchScheduleLocal = useCallback((id: string, patch: any) => {
    // ★ 2026-10-04 sched-inline 修 bug：旧实现从**闭包里的 schedItems** 取当前条目（`schedItems.find(...)`），
    //   而 cron 输入当时是 1.2s 防抖保存——于是"改完 cron、在防抖触发前点了启用/停用"时，那次保存带的是
    //   **旧的 enabled**，落盘后 loadSchedules 一刷新就把用户的开关**悄悄改回去**（真机表现为开关闪一下弹回）。
    //   现在用 ref 保存列表的**最新同步值**：state 与 ref 一起更新，读的时候拿 ref。
    const cur = schedItemsRef.current;
    const item = { ...(cur.find((x) => x.id === id) ?? {}), ...patch, id };
    const next = cur.map((x) => (x.id === id ? { ...x, ...patch } : x));
    schedItemsRef.current = next;
    setSchedItems(next);
    if (cronError(String(item.cron ?? ''))) return;   // 非法 cron 不保存（等改对）
    void saveSchedule({ id, workflow: item.workflow ?? def.name, cron: item.cron, enabled: item.enabled !== false, inputs: item.inputs });
  }, [saveSchedule, def.name]);
  // ★ 2026-10-04 用户拍板：cron 改成**手动确认生效**（不再边敲边自动保存）
  /** 某行当前显示的 cron（草稿优先于已落盘值） */
  const schedCronOf = (it: any): string => schedDraft[it.id] ?? String(it.cron ?? '');
  /** 该行是否有未保存的改动 */
  const schedDirty = (it: any): boolean => schedDraft[it.id] !== undefined && schedDraft[it.id] !== String(it.cron ?? '');
  /** 列表里是否还有任何未保存的改动（关闭前判断用） */
  const schedHasDirty = (): boolean => schedItems.some((it: any) => schedDirty(it));
  /** 保存某行的 cron 草稿：非法不发请求；成功后清掉该行草稿（输入框回落到已落盘值） */
  const saveSchedCron = (it: any): void => {
    const v = schedCronOf(it);
    if (cronError(v)) return;                     // 非法：按钮本来就禁用，这里再兜一层
    patchScheduleLocal(it.id, { cron: v });   // 立即落盘
    setSchedDraft((m) => { const n = { ...m }; delete n[it.id]; return n; });
  };
  /** 关闭弹窗：**直接放弃**未保存的 cron 草稿，只给一条浮层提示
   *  （2026-10-04 用户改口：不要二次确认弹窗——「未保存关闭直接放弃，给个提示就行，不用弹窗处理」）。 */
  const requestCloseSched = (): void => {
    if (schedHasDirty()) setImportMsg({ ok: true, text: '未保存的 cron 改动已丢弃' });
    setSchedDraft({});
    setSchedOpen(false);
  };
  const addSchedule = useCallback(() => {
    void saveSchedule({ workflow: def.name, cron: '0 9 * * *', enabled: true });
  }, [saveSchedule, def.name]);
  const removeSchedule = useCallback(async (id: string) => {
    try {
      await fetch('/api/dag-flow/schedules/delete', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      await loadSchedules();
    } catch { /* 忽略 */ }
  }, [loadSchedules]);
  const [schedRunningId, setSchedRunningId] = useState('');
  // ★ 2026-10-04 用户反馈：「立即运行一次」的二次确认原来是 window.confirm —— Windows 原生弹窗，
  //   与插件风格割裂（而且 confirm 文案里没法排版）。改成**应用内确认弹窗**：这里存待确认的那一条，
  //   下面用与其它弹窗同一套 dag-flow-picker 渲染。流程拆两步：askRunScheduleNow（弹确认）→ doRunScheduleNow（真发请求）。
  const [schedConfirm, setSchedConfirm] = useState<any | null>(null);
  // ★ 运行日志（2026-10-04）：🧾 弹窗的开关与数据（条目来自 GET /run/log，运行中自动刷新）
  const [logOpen, setLogOpen] = useState(false);
  const [logEntries, setLogEntries] = useState<any[]>([]);
  const [logMeta, setLogMeta] = useState<{ runId?: string; live?: boolean; runStatus?: string; error?: string; at?: number } | null>(null);
  /** 运行记录落盘目录（服务端 /run/log 响应带 dir = …/runs）——弹窗里标注并点击打开 */
  const [logDir, setLogDir] = useState('');
  const [logBusy, setLogBusy] = useState(false);
  const [logFilter, setLogFilter] = useState('');
  const [logScope, setLogScope] = useState<'all' | 'problem'>('all');
  const [logExpanded, setLogExpanded] = useState<Record<string, boolean>>({});
  const logLiveRef = useRef(false);
  // ★ 2026-10-09 性能优化（用户拍板做）：轮询去重。
  //   原实现每 1.2s **无条件** setLogEntries（新数组）+ setLogMeta（含 at:Date.now()）→ 即使这一轮
  //   一个节点都没跑完，也会触发一次全量重渲染 ✗。现在算一份**廉价签名**（条目 id/status/耗时 + live +
  //   runStatus，不序列化大 out）→ 没变就整个跳过 setState ✓；`silent` 用于自动轮询（不动 busy 转圈 ✓）。
  const logSigRef = useRef('');
  const fetchRunLog = useCallback(async (opts?: { silent?: boolean }): Promise<void> => {
    if (!opts?.silent) setLogBusy(true);
    try {
      const r = await fetch(`/api/dag-flow/run/log?name=${encodeURIComponent(def.name)}`);
      const j: any = await r.json().catch(() => null);
      if (!r.ok) {
        logLiveRef.current = false;
        logSigRef.current = '';
        setLogEntries([]);
        setLogMeta({ error: j?.error ?? `HTTP ${r.status}`, at: Date.now() });
        return;
      }
      const entries: any[] = Array.isArray(j?.entries) ? j.entries : [];
      setLogDir(String(j?.dir ?? ''));   // 落盘目录（每次拉取都写，值不变时 React 自动跳过重渲染）
      const live = !!j?.live;
      const sig = `${live}|${j?.runStatus ?? ''}|${entries.map((e) => `${e?.id}:${e?.status}:${e?.durationMs ?? ''}`).join(',')}`;
      logLiveRef.current = live;
      if (sig === logSigRef.current) return;   // ★ 内容没变 → 不 setState（省一次全量重渲染）
      logSigRef.current = sig;
      setLogEntries(entries);
      setLogMeta({ runId: j?.runId, live, runStatus: j?.runStatus, at: Date.now() });
    } catch (e) {
      logLiveRef.current = false;
      setLogMeta({ error: (e as Error).message, at: Date.now() });
    } finally {
      if (!opts?.silent) setLogBusy(false);
    }
  }, [def.name]);
  /** 日志弹窗打开着时：运行中每 1.2s 自动刷新（用户要"逐节点看到彼此的交互"） */
  useEffect(() => {
    if (!logOpen) return undefined;
    void fetchRunLog();
    const timer = window.setInterval(() => { if (logLiveRef.current) void fetchRunLog({ silent: true }); }, 1200);
    return () => window.clearInterval(timer);
  }, [logOpen, fetchRunLog]);
  /** 运行刚结束时补拉一次（拿到最终状态与耗时） */
  const prevRunningRef = useRef(false);
  useEffect(() => {
    if (prevRunningRef.current && !running && logOpen) void fetchRunLog();
    prevRunningRef.current = running;
  }, [running, logOpen, fetchRunLog]);
  /** 失败/跳过的条目**默认展开**（用户手动折叠过的不覆盖） */
  useEffect(() => {
    if (!logEntries.length) return;
    setLogExpanded((m) => {
      const next = { ...m };
      let changed = false;
      for (const e of logEntries) {
        if ((e?.status === 'failed' || e?.status === 'skipped') && next[e.id] === undefined) { next[e.id] = true; changed = true; }
      }
      return changed ? next : m;
    });
  }, [logEntries]);

  /** 搜索过滤后的日志（按节点/参数/出参全文匹配） */
  const logView = useMemo(() => {
    let list = logEntries;
    if (logScope === 'problem') list = list.filter((e) => e?.status === 'failed' || e?.status === 'skipped');   // 只看失败/跳过（大图排查）
    const q = logFilter.trim().toLowerCase();
    if (!q) return list;
    return list.filter((e) => logSearchText(e).includes(q));
  }, [logEntries, logFilter, logScope]);
  // ★ 2026-10-09 用户反馈「只看失败/跳过按钮，选择或取消，按钮状态没变化，最好有个按钮状态变化，
  //   好让用户一眼就能判断」→ 除了激活样式，还把**命中条数**直接写进按钮文案（未开启时也能看出有几个问题 ✓）
  const logProblemCount = useMemo(
    () => logEntries.filter((e) => e?.status === 'failed' || e?.status === 'skipped').length,
    [logEntries],
  );
  // ★ 运行前自检拦住（2026-10-04 轮 1）：存住 host 返回的问题清单（含解决办法），弹窗让用户人工确认
  const [selfcheckBlock, setSelfcheckBlock] = useState<{ items: { level?: string; code?: string; nodeId?: string; message?: string; fix?: string }[]; errorCount: number; warnCount?: number; stats?: { nodes?: number; edges?: number } } | null>(null);
  // 「点运行 → 先自检（按钮显示『自检中…』）→ 自检通过 → 人工确认 → 才真正开跑」的中间态
  const [selfcheckState, setSelfcheckState] = useState<null | { phase: 'checking' } | { phase: 'ok'; result: { items: any[]; errorCount: number; warnCount: number; stats: { nodes?: number; edges?: number } } }>(null);
  const askRunScheduleNow = useCallback((it: any) => { setSchedConfirm(it); }, []);
  const doRunScheduleNow = useCallback(async (it: any) => {
    setSchedRunningId(it.id);
    try {
      const res = await fetch('/api/dag-flow/schedules/run', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: it.id }),
      });
      const data = await res.json();
      if (!res.ok) setSchedBad((m) => ({ ...m, [it.id]: String(data.error ?? '运行失败') }));
      else if (data.skipped) setSchedBad((m) => ({ ...m, [it.id]: '上一次运行还没结束，本次跳过了' }));
      await loadSchedules();
    } catch (e) {
      setSchedBad((m) => ({ ...m, [it.id]: (e as Error).message }));
    } finally {
      setSchedRunningId('');
    }
  }, [loadSchedules]);

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
    // A3 工作流参数编辑弹窗（✍️，用户选定「填写」意象；2026-10-02 重做：✕ 移右上角、默认一条空行、
    //    行尾 ✕ 删除、底部 + 添加、改动即自动保存——原「＋添加输入/取消/保存」三键全删）
    inputsOpen && createElement(
      'div',
      {
        className: 'dag-flow-picker-overlay',
        onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) setInputsOpen(false); },
      },
      createElement(
        'div',
        { className: 'dag-flow-picker' },
        createElement('div', { className: 'dag-flow-picker-title', style: { fontSize: 16 } },
          '✍️ 工作流参数',
          createElement('button', {
            className: 'dag-flow-picker-close', title: '关闭',
            onClick: () => setInputsOpen(false),
          }, '✕'),
        ),
        createElement('div', { className: 'dag-flow-picker-body' },
          createElement('div', { className: 'dag-flow-picker-hint', style: { fontSize: 11, opacity: 0.72 } },
            '仅当前工作流可用，随工作流一起保存（新建工作流时参数为空）。节点参数里用 {{inputs.名称}} 引用；值可填字符串或合法 JSON（对象/数字自动解析），改动即自动保存。'),
          inputsRows.map((row, i) => createElement('div', { key: i, style: { display: 'flex', gap: 6, marginBottom: 6 } },
            createElement('input', {
              className: 'dsh-wf-input', placeholder: '名称', value: row.k, style: { flex: '0 0 40%' },
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => pushInputs(inputsRows.map((r, j) => (j === i ? { ...r, k: e.target.value } : r))),
            }),
            createElement('input', {
              className: 'dsh-wf-input', placeholder: '值（字符串或 JSON）', value: row.v, style: { flex: 1 },
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => pushInputs(inputsRows.map((r, j) => (j === i ? { ...r, v: e.target.value } : r))),
            }),
            createElement('button', {
              className: 'dsh-wf-btn', title: '删除该参数',
              onClick: () => pushInputs(inputsRows.filter((_, j) => j !== i)),
            }, '✕'),
          )),
          // 底部 + 号：追加一条空行（名称为空的行不写入 def，输入内容后才计入自动保存）
          createElement('button', {
            className: 'dsh-wf-inputs-add', title: '添加一条参数',
            onClick: () => setInputsRows((rs) => [...rs, { k: '', v: '' }]),
          }, '+'),
        ),
      ),
    ),
    // ⏰ 定时任务弹窗（2026-10-03 用户拍板方案 v1，docs/SCHEDULE-PLAN.md §6）
    schedOpen && createElement(
      'div',
      {
        className: 'dag-flow-picker-overlay',
        onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) requestCloseSched(); },
      },
      createElement(
        'div',
        { className: 'dag-flow-picker dsh-wf-sched' },
        createElement('div', { className: 'dag-flow-picker-title', style: { fontSize: 16 } },
          '⏰ 定时任务',
          createElement('span', { className: 'dsh-wf-sched-title-wf' }, def.name),
          createElement('button', {
            className: 'dag-flow-picker-close', title: '关闭',
            onClick: () => requestCloseSched(),
          }, '✕'),
        ),
        createElement('div', { className: 'dag-flow-picker-body' },
          // 黄色费用提示（无人值守真花钱，必须写明）
          createElement('div', { className: 'dsh-wf-sched-warn' },
            '⚠ 定时执行会真实运行工作流：AI / 图片 / 视频节点会产生费用；执行期间不等人确认（manual 节点自动通过）。'),
          // ★ 2026-10-04 用户反馈「定时任务自动触发的运行，手动确认节点自动跳过」→ 拍板 A：保持自动通过，但**显形**。
          //   只要本工作流含 manual 节点，就在弹窗里说清"不会停下来等确认"，并告诉用户哪种入口才会等。
          manualCount > 0
            ? createElement('div', { className: 'dsh-wf-sched-note' },
                `⏭ 本工作流含 ${manualCount} 个「人工确认」节点：定时触发（含下方「▶ 立即运行一次」）不会停下来等确认，`
                + 'manual 节点会自动通过（画布徽标与悬浮结果会标「⏭ 自动通过」）。要人工把关请在画布上点 ▶ 运行。')
            : null,
          // 调度器心跳：dsh web 不常驻就不会触发，必须让用户看见
          createElement('div', { className: `dsh-wf-sched-beat${schedInfo?.running ? ' is-on' : ''}` },
            schedInfo?.running
              ? `● 调度器运行中（心跳 ${fmtAgo(schedInfo?.lastTickAt)}，每 ${Math.round((schedInfo?.tickMs ?? 20000) / 1000)}s 检查一次；本机时区）`
              : '○ 调度器未运行——需要 dsh web 常驻，定时才会触发'),
          // ★ 2026-10-11 用户需求：定时任务弹窗也要标记数据存放位置，且点一下直接打开文件夹
          //   （schedules.json 就在 .dag-flow 根下 → sub 传空串开根目录；旧 host 无 dir 字段时回退通用路径）
          dataPathRow(
            schedDir || '<DSH_HOME>/.dag-flow/schedules.json',
            '',
            (m) => setImportMsg({ ok: false, text: m }),
          ),
          schedNote ? createElement('div', { className: 'dag-flow-picker-hint', style: { fontSize: 11, opacity: 0.72 } }, schedNote) : null,
          createElement('div', { className: 'dsh-wf-sched-list' },
            schedItems.length
              ? schedItems.map((it) => {
                const cur = schedCronOf(it);   // ★ 草稿优先：预览与校验都按"编辑中的值"算（所见即所存）
                const dirty = schedDirty(it);
                const bad = cronError(cur);
                const err = schedBad[it.id] || bad || '';
                return createElement('div', { key: it.id, className: `dsh-wf-sched-item${it.enabled === false ? ' is-off' : ''}` },
                  createElement('div', { className: 'dsh-wf-sched-row' },
                    createElement('span', { className: 'dsh-wf-sched-ico' }, '⏰'),
                    // ★ 2026-10-04 用户拍板：cron 改成**手动确认生效**——敲键只改草稿（描黄边），点「保存」才落盘
                    createElement('input', {
                      className: `dsh-wf-input dsh-wf-sched-cron${dirty ? ' is-dirty' : ''}${bad ? ' is-bad' : ''}`,
                      value: cur,
                      placeholder: '分 时 日 月 周，如 0 9 * * 1-5',
                      title: '标准 5 字段 cron：分 时 日 月 周；支持 * , - /（不支持 L W # 与秒级）\n改完点右侧「保存」才生效（回车也可保存）',
                      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setSchedDraft((m) => ({ ...m, [it.id]: e.target.value })),
                      onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
                        if (e.key === 'Enter' && dirty && !bad) saveSchedCron(it);
                      },
                    }),
                    // 「保存」：没改动或表达式非法时禁用（三态见原型）
                    createElement('button', {
                      className: `dsh-wf-btn dsh-wf-sched-save${dirty && !bad ? ' is-ready' : ''}`,
                      disabled: !dirty || !!bad,
                      title: !dirty ? '没有改动' : (bad ? '表达式不合法，先改对再保存' : '保存这次修改（立即生效）'),
                      onClick: () => saveSchedCron(it),
                    }, '保存'),
                    // ★ 2026-10-04 用户要求：「▶ 立即运行一次」不要单独占第二行，放在 cron 表达式右边
                    createElement('button', {
                      className: 'dsh-wf-btn dsh-wf-sched-run',
                      disabled: schedRunningId === it.id,
                      title: '立刻真实执行一次（等价于到点触发，会花钱）',
                      onClick: () => askRunScheduleNow(it),
                    }, schedRunningId === it.id ? '运行中…' : '▶ 立即运行一次'),
                    createElement('span', { className: `dsh-wf-sched-preview${bad ? ' is-bad' : ''}` },
                      bad ? '⚠ 表达式不合法' : describeCron(cur)),
                    // ★ 2026-10-04 用户拍板：启用/停用**不用勾选框**，改单按钮切换（图标 ●/○，点一下即生效）
                    createElement('button', {
                      className: `dsh-wf-sched-state${it.enabled === false ? ' is-off' : ''}`,
                      title: it.enabled === false ? '当前已停用，点击启用（立即生效）' : '当前已启用，点击停用（立即生效）',
                      onClick: () => patchScheduleLocal(it.id, { enabled: it.enabled === false }),
                    }, it.enabled === false ? '○ 已停用' : '● 启用中'),
                    createElement('button', {
                      className: 'dsh-wf-btn', title: '删除该定时（不影响其它定时）',
                      onClick: () => void removeSchedule(it.id),
                    }, '✕'),
                  ),
                  err ? createElement('div', { className: 'dsh-wf-sched-bad' }, '⚠ ' + err) : null,
                  dirty ? createElement('div', { className: 'dsh-wf-sched-dirty' }, '● cron 已修改，点「保存」才生效') : null,
                  createElement('div', { className: 'dsh-wf-sched-meta' },
                    `上次 ${fmtLastRun(it.lastRun)}`,
                    ' · ',
                    `下次 ${it.nextRunAt ? fmtWhen(it.nextRunAt) : '—'}`,
                    it.running ? ' · 运行中…' : (it.lastStartedAt && !it.lastRun ? ' · 正在运行…' : ''),
                    it.orphan ? ' · ⚠ 工作流不存在（配置保留，等它回来）' : '',
                  ),
                );
              })
              : createElement('div', { className: 'dag-flow-picker-hint', style: { fontSize: 11.5, opacity: 0.72 } },
                  '还没有定时任务。点下方「＋ 添加定时」加一条，默认「0 9 * * *」= 每天 09:00。'),
          ),
          // 底部虚线 ＋：加一条（宿主生成 id）
          createElement('button', {
            className: 'dsh-wf-inputs-add', title: '添加一条定时任务',
            onClick: addSchedule,
          }, '＋ 添加定时'),
          createElement('div', { className: 'dsh-wf-sched-foot' },
            '配置存在 <DSH_HOME>/.dag-flow/schedules.json；cron 为本机时区的「分 时 日 月 周」；cron 改完点行内「保存」才生效。',
            createElement('br'),
            '同一工作流上一次没跑完时，本次会跳过并记「⏭ 本次跳过」；dsh 重启后不补跑错过的档期。'),
        ),
      ),
    ),
    // 版本历史弹窗（🕘；2026-10-01 夜 补上此前缺失的渲染——此前点按钮只 setState 不出 UI）
    // UX（2026-10-01 夜用户反馈）：title 加大、hint 小字浅色、✕ 移右上角、上边缘可拖拽调高看更多
    verOpen && createElement(
      'div',
      {
        className: 'dag-flow-picker-overlay',
        // 2026-10-04 用户反馈「历史版本弹窗有点偏中下部了，最好和定时任务弹窗保持一致」：
        //   此前这里内联了 alignItems:'flex-end' + paddingBottom:'8vh'（底部锚定，弹窗落在中下部），
        //   现改为**不覆盖** —— 用 overlay 默认的顶部锚定（align-items:flex-start; padding-top:14vh），
        //   与 ⏰ 定时任务弹窗同一落点。「顶边跟随光标」的手感由下面 handle 的 verOff 偏移保留。
        onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) setVerOpen(false); },
      },
      createElement(
        'div',
        {
          className: 'dag-flow-picker dag-flow-picker-ver',
          // maxHeight 与顶部锚定配套：顶边在 14vh，可用高度 = 100vh-14vh，留 16px 下边距（原 90vh 会在顶部锚定下越出视口底部）
          style: { height: verH, maxHeight: 'calc(86vh - 16px)', marginTop: -verOff, display: 'flex', flexDirection: 'column' },
        },
        // 上边缘拖拽把手：向上拖 = 顶边跟随光标上移 + 加高；向下拖 = 收矮（钳位 280px ~ 视口剩余高度）
        createElement('div', {
          className: 'dag-flow-picker-resize-y',
          title: '上下拖动调整弹窗高度',
          onMouseDown: (e: React.MouseEvent) => {
            e.preventDefault();
            const startY = e.clientY;
            const startH = verH;
            const startOff = verOff;
            const vh = window.innerHeight;
            // 与 .dag-flow-picker-overlay 的 padding-top:14vh 对齐（默认锚点 = ⏰ 定时任务弹窗的落点）
            const baseTop = Math.round(vh * 0.14);
            const GAP = 16;
            const MIN_H = 280;
            const maxOff = Math.max(0, baseTop - GAP);
            const onMove = (ev: MouseEvent) => {
              const dy = startY - ev.clientY; // 向上拖为正
              // 顶边跟随光标上移（不越过视口上沿、也不低于默认锚点），高度同步长高
              const off = Math.min(Math.max(startOff + dy, 0), maxOff);
              const maxH = Math.max(MIN_H, vh - GAP - (baseTop - off));
              setVerOff(off);
              setVerH(Math.min(Math.max(startH + dy, MIN_H), maxH));
            };
            const onUp = () => {
              window.removeEventListener('mousemove', onMove, true);
              window.removeEventListener('mouseup', onUp, true);
            };
            window.addEventListener('mousemove', onMove, true);
            window.addEventListener('mouseup', onUp, true);
          },
        }),
        createElement('div', { className: 'dag-flow-picker-title', style: { fontSize: 16, flex: 'none' } },
          '🕘 历史版本',
          createElement('button', {
            className: 'dag-flow-picker-close', title: '关闭',
            onClick: () => setVerOpen(false),
          }, '✕'),
        ),
        createElement('div', { className: 'dag-flow-picker-body', style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
          createElement('div', { className: 'dag-flow-picker-hint', style: { fontSize: 11, opacity: 0.72, flex: 'none' } },
            '手动 💾 保存会生成一个版本快照（自动保存不计入）。点「回载」把该版本放回画布；回载前的当前内容如与最新版本不同，也会先存为一个版本，随时可再退回。'),
          // 数据存储位置标注（2026-10-01 夜用户要求；★ 2026-10-11 起**可点击打开**所在文件夹）
          dataPathRow(
            verDir ? verDisplayPath(verDir, def.name) : '<DSH_HOME>/.dag-flow/workflow/versions/<名称>/<时间戳>.json',
            `workflow/versions/${def.name}`,
            (m) => setImportMsg({ ok: false, text: m }),
          ),
          verLoading && createElement('div', { className: 'dag-flow-picker-hint', style: { fontSize: 11, opacity: 0.72 } }, '加载中…'),
          !verLoading && verList.length === 0
            ? createElement('div', { className: 'dag-flow-picker-hint', style: { fontSize: 11, opacity: 0.72 } }, '暂无历史版本——手动 💾 保存后即可在此回溯。')
            : createElement('div', { className: 'dag-flow-picker-ver-list', style: { flex: 1, minHeight: 0, overflowY: 'auto' } },
                ...verList.map((v) => {
                  const ms = Number(String(v.ts).split('-')[0]);
                  const when = Number.isFinite(ms) && ms > 0
                    ? new Date(ms).toLocaleString('zh-CN', { hour12: false })
                    : v.ts;
                  return createElement('div', {
                    key: v.ts,
                    style: {
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                      padding: '7px 4px', borderBottom: '1px solid var(--wf-border, #22304a)',
                    },
                  },
                    createElement('span', { style: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12, color: 'var(--wf-text, #e6edf7)' } }, `🕒 ${when}`),
                    createElement('button', { className: 'dsh-wf-btn', onClick: () => void loadVersion(v.ts) }, '⤺ 回载'),
                  );
                }),
              ),
        ),
      ),
    ),
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
    // ▶ 立即运行一次：**应用内**二次确认弹窗（2026-10-04 用户反馈：原来是 Windows 原生 confirm）
    //   与其它弹窗同一套约定：右上 ✕、hint 小字浅色、底部左「取消」右「主操作」；费用提醒用黄色条。
    schedConfirm && createElement(
      'div',
      {
        className: 'dag-flow-picker-overlay',
        onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) setSchedConfirm(null); },
      },
      createElement(
        'div',
        { className: 'dag-flow-picker dsh-wf-sched-confirm' },
        createElement('div', { className: 'dag-flow-picker-title', style: { fontSize: 16 } },
          '▶ 立即运行一次？',
          createElement('button', {
            className: 'dag-flow-picker-close', title: '关闭（不运行）',
            onClick: () => setSchedConfirm(null),
          }, '✕'),
        ),
        createElement('div', { className: 'dag-flow-picker-body' },
          createElement('div', { className: 'dsh-wf-sched-warn' },
            `⚠ 会真实执行工作流「${String(schedConfirm.workflow ?? def.name)}」：AI / 图片 / 视频节点会产生费用。`),
          createElement('div', { className: 'dag-flow-picker-hint', style: { fontSize: 11.5, opacity: 0.8, lineHeight: 1.65 } },
            '这次运行等价于「到点触发」一次：执行期间不等人确认（manual 节点自动通过）。',
            createElement('br'),
            '不会改变定时档期——下次仍按 ',
            cronError(String(schedConfirm.cron ?? ''))
              ? '（当前 cron 表达式不合法，改对之后才会自动触发）'
              : describeCron(String(schedConfirm.cron ?? '')),
            ' 触发。',
          ),
          createElement('div', { className: 'dsh-wf-manual-acts' },
            createElement('button', {
              className: 'dsh-wf-btn',
              onClick: () => setSchedConfirm(null),
            }, '✕ 取消'),
            createElement('span', { className: 'dsh-wf-manual-grow' }),
            createElement('button', {
              className: 'dsh-wf-btn dsh-wf-btn-primary',
              onClick: () => { const it = schedConfirm; setSchedConfirm(null); void doRunScheduleNow(it); },
            }, '▶ 确认运行'),
          ),
        ),
      ),
    ),

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
    // 🧾 运行日志弹窗（2026-10-04）：每节点一条，可展开看「原始参数 → 实际入参 → 出参」，可搜索/复制
    logOpen && createElement(
      'div',
      { className: 'dag-flow-picker-overlay', onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) setLogOpen(false); } },
      createElement(
        'div',
        { className: 'dag-flow-picker dsh-wf-logdlg' },
        createElement('div', { className: 'dag-flow-picker-title', style: { fontSize: 16 } },
          '🧾 运行日志',
          createElement('button', { className: 'dag-flow-picker-close', title: '关闭', onClick: () => setLogOpen(false) }, '✕'),
        ),
        createElement('div', { className: 'dag-flow-picker-body' },
          createElement('div', { className: 'dag-flow-picker-hint', style: { fontSize: 11, opacity: 0.72 } },
            logMeta?.error
              ? `日志读取失败：${logMeta.error}（先运行一次工作流，或点「🔄 刷新」重试）`
              : `工作流「${def.name}」${logMeta?.runId ? ` · ${logMeta.runId}` : ''} · 状态 ${logStatusLabel(logMeta?.runStatus)} · ${logEntries.length} 个节点${logMeta?.live ? ' · 运行中，自动刷新' : ''}`
                + (logScope === 'problem'
                  // ★ 2026-10-09：过滤生效时把"藏了多少条"也写出来，避免用户以为日志丢了 ✓
                  ? ` · 已过滤：只看失败/跳过（显示 ${logView.length} 条，隐藏 ${Math.max(0, logEntries.length - logView.length)} 条）`
                  : '')),
          // ★ 2026-10-11 用户需求：运行日志弹窗也要标记数据存放位置 + 点击打开文件夹
          //   运行记录落盘在 .dag-flow/runs/<runId>.json（画布节点的入参/出参就是从这些记录读的）
          dataPathRow(
            logDir ? joinDisplay(logDir, `${logMeta?.runId ?? '<runId>'}.json`) : '<DSH_HOME>/.dag-flow/runs/<runId>.json',
            'runs',
            (m) => setImportMsg({ ok: false, text: m }),
          ),
          createElement('div', { className: 'dsh-wf-log-toolbar' },
            createElement('button', { className: 'dsh-wf-btn', title: '重新拉取日志', onClick: () => void fetchRunLog() }, logBusy ? '⏳ 刷新中' : '🔄 刷新'),
            // ★ 只看失败/跳过（2026-10-04 便利性：大图排查时不必在几十条里翻）
            //   ★ 2026-10-09 用户反馈"选择或取消按钮状态没变化" → 三处强化可见性：
            //   ① 图标随状态切换（⚠ ↔ ✓）；② 文案带**命中条数**；③ 用 is-on 激活态 + aria-pressed
            createElement('button', {
              className: `dsh-wf-btn${logScope === 'problem' ? ' is-on' : ''}`,
              'aria-pressed': logScope === 'problem',
              title: logScope === 'problem'
                ? '已开启：只看失败与跳过的节点（再点一下恢复全部）'
                : '只看失败与跳过的节点（大图排查用）',
              onClick: () => setLogScope((v) => (v === 'problem' ? 'all' : 'problem')),
            }, `${logScope === 'problem' ? '✓' : '⚠'} 只看失败/跳过（${logProblemCount}）`),
            createElement('input', {
              className: 'dsh-wf-log-search',
              value: logFilter,
              placeholder: '搜索节点 / 参数 / 出参…',
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setLogFilter(e.target.value),
            }),
            createElement('button', {
              className: 'dsh-wf-btn',
              title: '复制全部日志文本（便于反馈问题）',
              disabled: logEntries.length === 0,
              onClick: async () => {
                try {
                  await navigator.clipboard.writeText(runLogText(logView));
                  setImportMsg({ ok: true, text: '全部日志已复制到剪贴板' });
                } catch { setImportMsg({ ok: false, text: '复制失败——请手动选中文本复制' }); }
              },
            }, '📋 复制全部'),
          ),
          createElement('div', { className: 'dsh-wf-log-list' },
            logView.length === 0
              ? createElement('div', { className: 'dag-flow-picker-hint', style: { fontSize: 11.5, opacity: 0.6, padding: '14px 2px' } },
                  logEntries.length === 0 ? '暂无日志——点「▶」跑一次工作流后回来看。' : '没有匹配的节点（清空搜索框试试）。')
              : logView.map((e: any) => {
                const open = !!logExpanded[e.id];
                const st = e?.status ?? 'running';
                const refs = fmtRefs(e?.refs);
                const section = (label: string, v: unknown) => createElement('div', { className: 'dsh-wf-log-sec', key: label },
                  createElement('div', { className: 'dsh-wf-log-sec-title' }, label),
                  createElement('pre', { className: 'dsh-wf-log-pre' }, fmtLogValue(v)),
                );
                return createElement('div', { className: 'dsh-wf-log-item', key: e.id },
                  createElement('div', {
                    className: 'dsh-wf-log-head',
                    // ★ 点一下展开参数/出参，**同时在画布上选中该节点**（2026-10-04 便利性：看完日志能立刻回画布定位）
                    onClick: () => {
                      setLogExpanded((m) => ({ ...m, [e.id]: !m[e.id] }));
                      if ((def.nodes ?? []).some((n) => n.id === e.id)) setSelectedNodeId(e.id);
                    },
                    title: '点击展开/折叠该节点的参数与出参，并在画布上选中它',
                  },
                    createElement('span', { className: 'dsh-wf-log-caret' }, open ? '▾' : '▸'),
                    createElement('span', { className: `dsh-wf-log-dot is-${st}` }),
                    createElement('span', { className: 'dsh-wf-log-id' }, e.id),
                    e?.type ? createElement('span', { className: 'dsh-wf-log-type' }, e.type) : null,
                    createElement('span', { className: `dsh-wf-log-status is-${st}` }, logStatusLabel(st)),
                    typeof e?.durationMs === 'number' ? createElement('span', { className: 'dsh-wf-log-ms' }, `${e.durationMs}ms`) : null,
                    e?.tolerated ? createElement('span', { className: 'dsh-wf-log-tol' }, '已容错') : null,
                  ),
                  refs ? createElement('div', { className: 'dsh-wf-log-refs' }, `↳ 引用上游：${refs}`) : null,
                  e?.error ? createElement('div', { className: 'dsh-wf-log-err' }, `✗ [${e.error.code ?? ''}] ${e.error.message ?? ''}`) : null,
                  open ? createElement('div', { className: 'dsh-wf-log-detail' },
                    e?.rawParams !== undefined ? section('原始参数（含 {{}} 模板引用）', e.rawParams) : null,
                    e?.params !== undefined ? section('实际入参（模板已展开 = 节点真正收到的）', e.params) : null,
                    e?.out !== undefined ? section('出参', e.out) : null,
                    // ★ AI 调用详情（2026-10-04）：与「🧪 试跑本节点」共用同一份采集——
                    //   模型/提供方/走宿主还是直连/token 用量/结束原因（max-tokens 会显式提醒截断）+ 实际提示词
                    e?.debug ? createElement('div', { className: 'dsh-wf-log-sec', key: 'ai-debug' },
                      createElement('div', { className: 'dsh-wf-log-sec-title' }, '🤖 AI 调用详情'),
                      createElement('div', { className: 'dsh-wf-log-aidebug' },
                        String([
                          `${e.debug.modelLabel ?? e.debug.model ?? '?'}${e.debug.provider ? `（${e.debug.provider}）` : ''}`,
                          e.debug.viaHost ? '走宿主' : '直连',
                          e.debug.usage ? `tokens 入 ${e.debug.usage.inputTokens ?? '?'} / 出 ${e.debug.usage.outputTokens ?? '?'}` : 'tokens：宿主未提供',
                          e.debug.finishReason ? `结束 ${e.debug.finishReason}${e.debug.finishReason === 'max-tokens' ? '（⚠ 撞 maxTokens 截断）' : ''}` : '',
                          e.debug.textChars != null ? `返回 ${e.debug.textChars} 字` : '',
                        ].filter(Boolean).join(' · ')),
                      ),
                      e.debug.prompt !== undefined
                        ? createElement('pre', { className: 'dsh-wf-log-pre' }, String(e.debug.prompt).slice(0, 1200))
                        : null,
                    ) : null,
                    st === 'skipped' ? createElement('div', { className: 'dsh-wf-log-sec-title' }, '（该节点未执行：所在分支未命中）') : null,
                    Array.isArray(e?.truncated) && e.truncated.length
                      ? createElement('div', { className: 'dsh-wf-log-sec-title' }, `（字段已截断：${e.truncated.join('、')}）`) : null,
                    createElement('button', {
                      className: 'dsh-wf-btn',
                      style: { marginTop: 6 },
                      title: '复制该节点日志',
                      onClick: async () => {
                        try {
                          await navigator.clipboard.writeText(logEntryText(e));
                          setImportMsg({ ok: true, text: `节点 ${e.id} 的日志已复制` });
                        } catch { setImportMsg({ ok: false, text: '复制失败——请手动选中文本复制' }); }
                      },
                    }, '📋 复制本节点'),
                  ) : null,
                );
              }),
          ),
        ),
      ),
    ),
    // 🧾 运行日志（2026-10-04 用户需求：工作流执行黑盒 → 能看到节点之间的参数传递）
    // 运行失败详情弹窗（2026-10-02 用户需求：报错用弹窗提示，不再在 logo 后行内显示；
    // 头部失败徽标点击可再开本弹窗。统一弹窗模式：✕ 右上、hint 小字浅色）
    runDlgOpen && runResult && runResult.status !== 'success' && createElement(
      'div',
      {
        className: 'dag-flow-picker-overlay',
        onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) setRunDlgOpen(false); },
      },
      createElement(
        'div',
        { className: 'dag-flow-picker', style: { width: 560, maxWidth: '92vw' } },
        createElement('div', { className: 'dag-flow-picker-title', style: { fontSize: 16 } },
          runResult.status === 'error' ? '✗ 运行出错' : '⚠ 运行失败',
          createElement('button', {
            className: 'dag-flow-picker-close', title: '关闭',
            onClick: () => setRunDlgOpen(false),
          }, '✕'),
        ),
        createElement('div', { className: 'dag-flow-picker-body' },
          createElement('div', { className: 'dag-flow-picker-hint', style: { fontSize: 11, opacity: 0.72 } },
            `工作流「${def.name}」未运行成功——失败详情如下，可复制后反馈或对照节点修正。`),
          createElement('pre', {
            style: {
              margin: '8px 0 0', padding: 10, borderRadius: 8, fontSize: 11.5, lineHeight: 1.55,
              fontFamily: 'ui-monospace, Consolas, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              maxHeight: '46vh', overflowY: 'auto',
              background: 'var(--wf-bg, #08101e)', border: '1px solid var(--wf-border, #22304a)',
              color: 'var(--wf-danger, #f87171)',
            },
          }, runFailureDetail(runResult, def)),
          createElement('div', { style: { display: 'flex', gap: 8, marginTop: 10 } },
            createElement('button', {
              className: 'dsh-wf-btn',
              title: '复制失败详情（便于反馈问题）',
              onClick: async () => {
                try {
                  await navigator.clipboard.writeText(runFailureDetail(runResult, def));
                  setImportMsg({ ok: true, text: '失败详情已复制到剪贴板' });
                } catch { setImportMsg({ ok: false, text: '复制失败——请手动选中文本复制' }); }
              },
            }, '📋 复制详情'),
            createElement('span', { className: 'dag-flow-picker-hint', style: { fontSize: 10.5, opacity: 0.6, alignSelf: 'center' } },
              '关闭后可点头部「✗ 运行失败」徽标再次查看'),
          ),
        ),
      ),
    ),
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
