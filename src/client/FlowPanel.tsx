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
// ★ 运行进度 → 节点状态（2026-10-03 用户需求：待运行/运行中/完成/失败，按运行路径依次显示）
import { progressToStatusMap } from './runProgress';
import { toRF, fromRF, type RFNode, type RFEdge } from './util/flowDef';
import { applyAutoLayout } from './util/layout';
import { Canvas } from './Canvas';
import { disposeCanvasNode } from './flowgram/FlowGramCanvas';
import { JsonView } from './JsonView';
import { normalizeWorkflowName } from '../name-rule';
import { ensurePickerStyles } from './workflow-picker';
import { startResize8, readStoredJSON, saveJSON, clampNum, type RightGeom } from './util/edge-drag';

// ★ 必填标识（2026-10-02 用户需求：必填输入框名称前加红星；纯视觉标识，不改校验语义）
const reqMark = () => createElement('span', { className: 'dsh-wf-req-mark', title: '必填' }, '*');

interface FlowPanelProps {
  ctx: MountContext;
  onMount?: () => void;
  onClose?: () => void;
  onCache?: (def: WorkflowDef) => void;
}

/** 从 RunSummary 提取简短展示文本 */
function summarizeRun(summary: unknown): string {
  const s = summary as { status?: string; totalDurationMs?: number; toleratedCount?: number; error?: { code?: string; message?: string; nodeId?: string } } | null;
  if (!s) return '完成';
  const parts: string[] = [];
  if (typeof s.totalDurationMs === 'number') parts.push(`${Math.round(s.totalDurationMs)}ms`);
  // ★ 容错（2026-10-03）：有节点失败但被「失败不影响流程」放行时，头部明确标注（不静默吞掉失败）
  if (s.toleratedCount) parts.push(`${s.toleratedCount} 个节点失败已容错`);
  if (s.error?.message) parts.push(s.error.message);
  return parts.length ? parts.join(' · ') : (s.status ?? '完成');
}

/** 版本数据落盘位置展示串（跟随服务端目录分隔符；2026-10-01 夜弹窗标注用） */
function verDisplayPath(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  const base = dir.replace(/[\\/]+$/, '');
  return `${base}${sep}versions${sep}${name}${sep}<时间戳>.json`;
}

/** 运行失败详情全文（失败弹窗正文，2026-10-02）：优先执行器错误串；否则从 RunSummary
 *  提取汇总错误 + 逐节点失败明细（画布徽标只标了状态，弹窗里给出每个节点的失败原因）。
 *  ★ 节点标识统一「显示名_节点id」格式（2026-10-02 用户指定：【失败原因：显示名_id】
 *    【失败节点：显示名_id】，让用户一眼定位是哪个节点出问题）；未设 label 回退只显示 id。 */
/** 节点显示标识：显示名_id（label 缺失或与 id 相同则只用 id）——与失败详情的标识规则一致 */
function displayTag(def: { nodes?: { id: string; label?: string }[] } | null | undefined, id: string): string {
  const label = def?.nodes?.find((n) => n.id === id)?.label;
  return label && label !== id ? `${label}_${id}` : id;
}

function runFailureDetail(
  runResult: { status: string; summary?: unknown; error?: string } | null,
  def?: { nodes?: { id: string; label?: string }[] },
): string {
  if (!runResult) return '';
  if (runResult.error) return runResult.error;
  const s = runResult.summary as
    | { status?: string; error?: { code?: string; message?: string; nodeId?: string }; results?: Record<string, { status?: string; error?: { code?: string; message?: string } }> }
    | null | undefined;
  if (!s) return '运行失败（无详细信息）';
  // 节点标识：显示名_id（label 与 id 相同时只显示 id，避免重复）
  const nodeTag = (id: string): string => {
    const label = def?.nodes?.find((n) => n.id === id)?.label;
    return label && label !== id ? `${label}_${id}` : id;
  };
  const lines: string[] = [];
  const failed = Object.entries(s.results ?? {}).filter(([, r]) => r?.status === 'failed');
  // 单节点失败：按用户指定的标题格式——失败节点 / 失败原因 都带「显示名_id」
  if (failed.length === 1 && failed[0] !== undefined) {
    const [id, r] = failed[0];
    const tag = nodeTag(id);
    lines.push(`【失败节点：${tag}】`);
    lines.push(`【失败原因：${tag}】${r.error?.code ? r.error.code + '：' : ''}${r.error?.message ?? '未知错误'}`);
    return lines.join('\n');
  }
  // 多节点失败：逐行带节点标识
  if (failed.length > 1) {
    lines.push(`【失败节点（${failed.length}）】`);
    for (const [id, r] of failed) {
      lines.push(`· 【${nodeTag(id)}】${r.error?.code ? r.error.code + '：' : ''}${r.error?.message ?? '未知错误'}`);
    }
    return lines.join('\n');
  }
  // 无节点级失败（如工作流参数校验失败 / DAG 成环等运行级错误）：显示汇总原因
  if (s.error?.message) {
    const who = s.error.nodeId ? `：${nodeTag(s.error.nodeId)}` : '';
    lines.push(`【失败原因${who}】${s.error.code ? s.error.code + '：' : ''}${s.error.message}`);
  }
  if (lines.length === 0) lines.push(`工作流以「${s.status ?? 'failed'}」状态结束（无节点级错误）`);
  return lines.join('\n');
}

// ================= 零依赖代码编辑器（2026-10-02 用户要求「丰富工具的富文本框」） =================
// 结构：行号槽 + 高亮 pre + 透明 textarea 三层叠加（textarea 文字透明只留光标，高亮层在下着色
// ——同字体/行高/内边距保证对齐）。工具栏：复制/清空（行内确认）/行列状态。
const CODE_KEYWORDS: Record<string, string[]> = {
  python: ['import', 'from', 'as', 'def', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'not', 'and', 'or', 'is', 'None', 'True', 'False', 'try', 'except', 'finally', 'with', 'lambda', 'class', 'pass', 'break', 'continue', 'print', 'range', 'len'],
  bash: ['if', 'then', 'elif', 'else', 'fi', 'for', 'while', 'do', 'done', 'in', 'echo', 'export', 'read', 'exit', 'return', 'case', 'esac', 'function', 'local', 'date'],
};

/** 简易语法高亮：注释/字符串/关键字/数字 着色（先 HTML 转义再包 span） */
function highlightCode(code: string, lang: 'python' | 'bash'): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const kw = CODE_KEYWORDS[lang] ?? [];
  const kwRe = kw.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`(#[^\\n]*)|("(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*')|\\b(${kwRe})\\b|(\\b\\d+(?:\\.\\d+)?\\b)`, 'g');
  let out = '';
  let last = 0;
  for (const m of code.matchAll(re)) {
    out += esc(code.slice(last, m.index));
    const [full, comment, str, kwTok, num] = m;
    if (comment) out += `<span class="tok-c">${esc(full)}</span>`;
    else if (str) out += `<span class="tok-s">${esc(full)}</span>`;
    else if (kwTok) out += `<span class="tok-k">${esc(full)}</span>`;
    else if (num) out += `<span class="tok-n">${esc(full)}</span>`;
    last = m.index + full.length;
  }
  out += esc(code.slice(last));
  return out + '\n'; // 尾部补一个空行，保证滚动高度与 textarea 一致
}

const TABS: { id: ViewTab; label: string; emoji: string }[] = [
  { id: 'canvas', label: '画布', emoji: '🎨' },
  // 2026-10-01 深夜：移除「🖼 缩略图」「📝 表单」tab（用户反馈没啥用）——ThumbView/FormView.tsx 保留未引用
  { id: 'json', label: 'JSON', emoji: '{ }' },
  // 2026-10-01 深夜：移除「🖼 缩略图」「📝 表单」「📋 管理」「🤖 AI 生成」tab（用户反馈没用）
  // ——ThumbView/FormView/ManageView/AiGenView.tsx 保留未引用（esbuild 不打包）
];

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

  // JsonView / FormView 直接修改 def
  const handleDefChange = useCallback((next: WorkflowDef) => {
    setDef(next);
    setDirty(true);
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
  // 版本数据实际落盘目录（服务端 versions 列表响应携带 dir；弹窗里标注存储位置）
  const [verDir, setVerDir] = useState('');
  const openVersions = useCallback(async () => {
    ensurePickerStyles(); // 版本弹窗复用 picker 的 .dag-flow-picker-* 样式——没开过 📂 时也要有样式
    setVerOpen(true);
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
    if (!data?.ok) setRunDlgOpen(true); // 失败 → 弹窗展示详情（成功仍用头部 ✓ 小徽标）
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

  const handleRun = useCallback(async () => {
    if (dirty) handleSave();
    // AI 节点必须选模型：未选 → 不执行，给出引导
    const noModel = (def.nodes ?? []).filter((n) => n.type === 'subagent' && !String(n.params?.model ?? '').trim());
    if (noModel.length > 0) {
      setRunResult({ status: 'error', error: `以下 AI 节点未选择执行模型，未运行：${noModel.map((n) => n.id).join('、')}。点击节点 → 「选择模型」中选择后重试。` });
      setRunDlgOpen(true);
      return;
    }
    setRunning(true);
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
        body: JSON.stringify({ def }),
        signal: ac.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
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
      if ((e as Error).name === 'AbortError') setRunResult({ status: 'error', error: '已取消本次运行' });
      else { setRunResult({ status: 'error', error: (e as Error).message }); setRunDlgOpen(true); }
    } finally {
      stopPoll = true;
      if (pollTimer != null) window.clearTimeout(pollTimer);
      if (!keepRunning) {
        setRunning(false);
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
      setRunning(false);
      runAbortRef.current = null;
    }
  }, [manualWait, manualNote, clearManualWait, applyRunSummary]);

  /** 取消本次运行（弹窗内）：走既有 DELETE 通道——host 会 reject 挂起的 manual 节点再 abort */
  const cancelManualRun = useCallback(() => {
    void fetch(`/api/dag-flow/run?name=${encodeURIComponent(def.name)}`, { method: 'DELETE', credentials: 'include' }).catch(() => {});
    runAbortRef.current?.abort();
    clearManualWait();
    setRunning(false);
    setRunResult({ status: 'error', error: '已取消本次运行' });
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

  /** 取消运行：本地 abort + 通知服务端 abort（RUN_CANCELLED） */
  const cancelRun = useCallback(() => {
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

  // 手动保存到 <工作区>/.dag-flow/workflow/<name>.json（调 host API）；AI 节点必须已选模型；
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
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);

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

  // A4 失败策略（onError：stop/continue/goto）
  const handleNodeError = useCallback((id: string, onError: 'stop' | 'continue' | { goto: string }) => {
    setDef((prev) => ({ ...prev, nodes: prev.nodes.map((n) => (n.id === id ? { ...n, onError } : n)) }));
    setDirty(true);
  }, []);

  // ★ 容错开关（2026-10-03 用户拍板 A 方案：节点级「失败不影响流程」）
  //   勾选 → 写 node.tolerate=true；取消 → **删掉键**（不落 `tolerate:false`，与 handleNodeChange 的 null 语义一致）
  const handleNodeTolerate = useCallback((id: string, tolerate: boolean) => {
    setDef((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => {
        if (n.id !== id) return n;
        const next = { ...n };
        if (tolerate) next.tolerate = true; else delete next.tolerate;
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
      createElement(
        'button',
        { className: 'dsh-wf-btn', onClick: exportFile, title: '导出为 .json 文件' },
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
          className: `dsh-wf-btn dsh-wf-btn-success${running ? ' is-running' : ''}`,
          onClick: () => void handleRun(),
          disabled: running,
          title: running ? '工作流正在运行（点右侧「⏹ 取消」可中止）' : '运行工作流',
        },
        running
          ? createElement('span', { className: 'dsh-wf-run-label' },
              createElement('span', { className: 'dsh-wf-run-ring' }),
              '运行中')
          : '▶',
      ),
      // ★ 取消按钮：运行中才出现，排在运行按钮**之后**，且红色
      running && createElement(
        'button',
        { className: 'dsh-wf-btn is-danger', onClick: cancelRun, title: '取消本次运行（通知执行器中止）' },
        '⏹ 取消',
      ),
      createElement(
        'button',
        {
          className: 'dsh-wf-btn',
          title: '保存到工作区',
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
      // 运行结果回显（2026-10-02 用户需求：报错不在 logo 后行内展示——成功仍用 ✓ 小徽标，
      // 失败只显示「✗ 运行失败」可点徽标，点击打开详情弹窗，不再截断挤占头部）
      runResult && createElement(
        'span',
        {
          className: `dsh-wf-run-result ${runResult.status === 'success' ? 'is-ok' : runResult.status === 'error' ? 'is-err' : 'is-fail'}`,
          ...(runResult.status !== 'success' ? {
            title: '点击查看失败详情',
            style: { cursor: 'pointer', maxWidth: 120 },
            onClick: () => setRunDlgOpen(true),
          } : {}),
        },
        runResult.status === 'success'
          ? `✓ ${runResult.summary ? summarizeRun(runResult.summary) : '运行成功'}`
          : runResult.status === 'error' && runResult.error === '已取消本次运行'
            ? '✗ 已取消'
            : '✗ 运行失败',
      ),
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
      // 上次运行的真实输出（results.<id>.out）——面板用它反推「实际有哪些变量」，含用户自定义键
      runOuts: ((runResult?.summary as { results?: Record<string, unknown> } | undefined)?.results ?? {}),
      // A4 失败策略（onError：节点失败时的行为；仅 legacy next 模式生效）
      onNodeError: handleNodeError,
      // ★ A 方案容错开关（DAG 模式下的「失败不影响流程」，2026-10-03 用户拍板）
      onNodeTolerate: handleNodeTolerate,
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
    // 版本历史弹窗（🕘；2026-10-01 夜 补上此前缺失的渲染——此前点按钮只 setState 不出 UI）
    // UX（2026-10-01 夜用户反馈）：title 加大、hint 小字浅色、✕ 移右上角、上边缘可拖拽调高看更多
    verOpen && createElement(
      'div',
      {
        className: 'dag-flow-picker-overlay',
        // 底部锚定：拖上边缘时顶边跟随光标向上生长（顶部锚定会变成向下长，手感不对）
        style: { alignItems: 'flex-end', paddingTop: 0, paddingBottom: '8vh' },
        onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) setVerOpen(false); },
      },
      createElement(
        'div',
        {
          className: 'dag-flow-picker dag-flow-picker-ver',
          style: { height: verH, maxHeight: '90vh', display: 'flex', flexDirection: 'column' },
        },
        // 上边缘拖拽把手：向上拖加高、向下拖收矮（钳位 280px ~ 90vh）
        createElement('div', {
          className: 'dag-flow-picker-resize-y',
          title: '上下拖动调整弹窗高度',
          onMouseDown: (e: React.MouseEvent) => {
            e.preventDefault();
            const startY = e.clientY;
            const startH = verH;
            const maxH = Math.round(window.innerHeight * 0.9);
            const onMove = (ev: MouseEvent) => setVerH(Math.min(Math.max(startH + (startY - ev.clientY), 280), maxH));
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
          // 数据存储位置标注（2026-10-01 夜用户要求；旧 host 无 dir 字段时回退通用路径，保证这行永远在）
          createElement('div', { className: 'dag-flow-picker-hint dag-flow-picker-ver-path', style: { fontSize: 10, opacity: 0.6, flex: 'none', fontFamily: 'ui-monospace, Consolas, monospace' } },
            verDir ? `📁 数据存于 ${verDisplayPath(verDir, def.name)}` : '📁 数据存于 <工作区>/.dag-flow/workflow/versions/<名称>/<时间戳>.json'),
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
    // 保存/导出/导入的结果提示（此前 importMsg 只 set 不渲染——保存失败是静默的，现补上）
    importMsg && createElement(
      'div',
      {
        title: '点击关闭',
        style: {
          position: 'fixed', bottom: 18, left: '50%', transform: 'translateX(-50%)', zIndex: 10001,
          background: 'var(--wf-panel, #101a2b)', border: `1px solid ${importMsg.ok ? 'var(--wf-success, #34d399)' : 'var(--wf-danger, #f87171)'}`,
          borderRadius: 8, padding: '6px 14px', fontSize: 12,
          color: importMsg.ok ? 'var(--wf-success, #34d399)' : 'var(--wf-danger, #f87171)',
          cursor: 'pointer',
        },
        onClick: () => setImportMsg(null),
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
  /** ★ 容错开关（DAG 模式「失败不影响流程」，2026-10-03 A 方案） */
  onNodeTolerate: (id: string, tolerate: boolean) => void;
  rightMin?: boolean;
  onRightMin?: (v: boolean) => void;
  rightGeom?: RightGeom;
  onRightGeom?: (g: RightGeom) => void;
  rightRef?: { current: HTMLElement | null };
}) {
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
          // 运行路径高亮：两端节点都成功的边标绿光
          activeEdges: p.runResults
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
              onTolerateChange: (v) => p.onNodeTolerate(p.selectedNode!.id, v),
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
function NodeInspector({ node, defNodes = [], edges = [], inputs = {}, runOuts = {}, workflowName = '', onDelete, onParamsChange, onError = 'stop', onNodeError, tolerate = false, onTolerateChange }: {
  node: import('./types').ClientNode;
  defNodes?: import('./types').ClientNode[];
  edges?: RFEdge[];
  /** 工作流参数（def.inputs）——面板「全局变量」里要能复制 {{inputs.名称}} */
  inputs?: Record<string, unknown>;
  /** 上次运行的真实输出（results.<id>.out）——优先用它反推字段，含用户自定义键与深层路径 */
  runOuts?: Record<string, { status?: string; out?: unknown }>;
  workflowName?: string;
  onDelete: () => void;
  onParamsChange: (params: Record<string, unknown>) => void;
  onError?: 'stop' | 'continue' | { goto: string };
  onNodeError?: (onError: 'stop' | 'continue' | { goto: string }) => void;
  /** ★ 容错开关（2026-10-03 A 方案）：true = 本节点失败不中断后续层 */
  tolerate?: boolean;
  onTolerateChange?: (v: boolean) => void;
}) {
  const meta = findMeta(node.type);
  const [models, setModels] = useState<{ id: string; name: string; kind: string; label?: string; providerLabel?: string; model?: string; input?: string[]; hasImage?: boolean }[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>(
    typeof node.params?.model === 'string' ? node.params.model : '',
  );

  // #11 上游变量：反向 BFS 收集所有祖先节点
  const upstream = useMemo(() => {
    const parents = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!parents.has(e.target)) parents.set(e.target, new Set());
      parents.get(e.target)!.add(e.source);
    }
    const out: string[] = [];
    const seen = new Set<string>([node.id]);
    const queue = [node.id];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const p of parents.get(cur) ?? []) {
        if (!seen.has(p)) { seen.add(p); out.push(p); queue.push(p); }
      }
    }
    return out;
  }, [node.id, edges]);
  const [copied, setCopied] = useState('');
  const copyRef = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(text); setTimeout(() => setCopied(''), 1200); } catch { /* 忽略 */ }
  };
  // —— 变量引用用的派生数据（2026-10-03 用户需求：上游/下游变量都要展示 + 说明作用 + 含全局变量）——
  const selfSpec = outSpecOf(node.type);
  const inputKeys = Object.keys(inputs ?? {});
  /** 全局变量：所有「设置变量」节点写过的键（同名以第一个写入者为准）+ 各自谁写的 */
  const { globalVars, varOwner } = useMemo(() => {
    const owner: Record<string, string> = {};
    for (const n of defNodes) {
      if (n.type !== 'set_var') continue;
      for (const k of Object.keys((n.params?.vars as Record<string, unknown>) ?? {})) if (!owner[k]) owner[k] = n.id;
    }
    return { globalVars: Object.keys(owner), varOwner: owner };
  }, [defNodes]);
  /** 某节点的可引用字段：**优先用上次运行的真实输出反推**（用户自定义键/动态节点/深层路径都能出来），
   *  没跑过（或输出是标量）才退回静态字段表。返回的 desc 用静态表里的说明补含义，sample 是实测样例值。 */
  const fieldsFor = (nid: string, type: string, staticExtra: { path: string; desc: string }[] = []): { list: { path: string; desc: string; sample?: string }[]; live: boolean; skipped: number } => {
    const spec = outSpecOf(type);
    const out = runOuts?.[nid]?.out;
    const live = fieldsFromValue(out);
    if (out !== undefined && out !== null && live.fields.length) {
      const merged = [...live.fields.map((f) => ({
        path: f.path,
        desc: (spec.fields ?? []).find((x) => x.path === f.path)?.desc
          ?? staticExtra.find((x) => x.path === f.path)?.desc ?? '',
        sample: `${f.sample}（${f.kind}）`,
      }))];
      // 静态表里有、但这次输出里没出现的字段（例如某分支才有的键）也保留，标注来源
      for (const s of [...staticExtra, ...(spec.fields ?? [])]) {
        if (merged.some((m) => m.path === s.path)) continue;
        merged.push({ path: s.path, desc: `${s.desc}（本次输出里没有，按定义补）` });
      }
      return { list: merged, live: true, skipped: live.skipped.length };
    }
    return { list: [...staticExtra, ...(spec.fields ?? []).map((f) => ({ path: f.path, desc: f.desc }))], live: false, skipped: 0 };
  };
  /** 本节点的字段（同样优先用真实输出反推） */
  const selfFields = fieldsFor(node.id, node.type);
  /** 可复制的变量 chip：显示引用写法，title 说明「这个变量是干什么的」 */
  const refChip = (text: string, desc: string, key: string, isOut = false) => createElement('span', {
    key,
    className: `dsh-wf-var-chip${isOut ? ' is-out' : ''}`,
    title: `点击复制：${text}\n作用：${desc}`,
    onClick: () => void copyRef(text),
  }, text);
  /** 全局变量 chips ——「上游变量」「本节点输出」「全局变量」三处共用（用户要求后两处也要包含全局变量） */
  const globalChips = (kp: string) => [
    ...globalVars.map((k) => refChip(`{{vars.${k}}}`, `「${k}」——由设置变量节点 ${varOwner[k]} 写入，流程内随处可见`, `${kp}-v-${k}`, kp.startsWith('self'))),
    ...inputKeys.map((k) => refChip(`{{inputs.${k}}}`, `工作流参数「${k}」——运行本工作流时由外部/参数面板填入`, `${kp}-i-${k}`, kp.startsWith('self'))),
    refChip('{{vars.loopItem}}', '仅当本工作流被 loop 当循环体调用时可用：当轮的项或轮次序号', `${kp}-loopItem`, kp.startsWith('self')),
    refChip('{{vars.loopIndex}}', '仅当本工作流被 loop 当循环体调用时可用：当前轮序号（从 0 开始）', `${kp}-loopIndex`, kp.startsWith('self')),
  ];

  // #1 单节点试跑
  const [testRunning, setTestRunning] = useState(false);
  const [testInputs, setTestInputs] = useState('{}');
  const [testResult, setTestResult] = useState<{ ok?: boolean; error?: string; output?: unknown; status?: string; ms?: number } | null>(null);
  // ★ 内联代码编辑弹窗（2026-10-02 用户需求：简单脚本直接在面板弹大编辑框写多行，随工作流保存）
  const [codeEditorOpen, setCodeEditorOpen] = useState(false);
  // 代码编辑器辅助状态：滚动同步 refs + 光标行列
  const hlRef = useRef<HTMLPreElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const [clearArm, setClearArm] = useState(false);
  const [cursor, setCursor] = useState({ ln: 1, col: 1, len: 0 });
  const syncScroll = (ta: HTMLTextAreaElement): void => {
    if (hlRef.current) { hlRef.current.scrollTop = ta.scrollTop; hlRef.current.scrollLeft = ta.scrollLeft; }
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
  };
  const updateCursor = (ta: HTMLTextAreaElement): void => {
    const lines = ta.value.slice(0, ta.selectionStart).split('\n');
    setCursor({ ln: lines.length, col: (lines[lines.length - 1]?.length ?? 0) + 1, len: ta.value.length });
  };
  // ★ switch cases 编辑（分支设置）：本地 rows + 立即写回 params.cases（空键行不写入）
  const [caseRows, setCaseRows] = useState<{ k: string; v: string }[]>(() =>
    Object.entries((node.params?.cases as Record<string, unknown>) ?? {}).map(([k, v]) => ({ k, v: typeof v === 'string' ? v : JSON.stringify(v) })));
  const writeCaseRows = (rows: { k: string; v: string }[]): void => {
    setCaseRows(rows);
    const cases: Record<string, string> = {};
    for (const r of rows) { const k = r.k.trim(); if (k) cases[k] = r.v; }
    onParamsChange({ cases });
  };
  // ★ loop 循环设置（P2，2026-10-03 用户拍板）：把引擎的「over > count > while」优先级在 UI 上显式化。
  //   此前 loop 参数只能在 JSON 视图里改——用户反馈「loop 不会用」的根因之一。
  const loopParam = (node.params ?? {}) as Record<string, unknown>;
  // ★ 边界类型按「键是否存在」推导（不是按值非空）：用户刚切到「遍历数组」时值还空着，
  //   若按值推导会立刻打回「不设边界」——下拉自己跳回去、输入框根本不出现（本轮踩到）。
  //   引擎侧仍按值判定（空串等于没有边界），这点由卡片副标题与下方空值提示如实告知。
  const loopBound: string = Array.isArray(loopParam.over) || typeof loopParam.over === 'string'
    ? 'over'
    : typeof loopParam.count === 'number' ? 'count'
      : typeof loopParam.while === 'string' ? 'while'
        : 'none';
  // ★ 循环体 = 子工作流（2026-10-03 用户拍板方案 A）：选一个已保存工作流当循环体，
  //   每轮把 {{vars.loopItem}} / {{vars.loopIndex}} 映射进它的 inputs；子工作流 end 输出依次进 out.items。
  const loopBody = ((loopParam.body ?? {}) as { workflowName?: string; inputs?: Record<string, unknown> });
  const [wfNames, setWfNames] = useState<string[]>([]);
  const [wfLoaded, setWfLoaded] = useState(false);
  const [bodyRows, setBodyRows] = useState<{ k: string; v: string }[]>(() =>
    Object.entries(loopBody.inputs ?? {}).map(([k, v]) => ({ k, v: typeof v === 'string' ? v : JSON.stringify(v) })));
  useEffect(() => {
    if (node.type !== 'loop' || wfLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/dag-flow/workflows', { credentials: 'include' });
        const data = await res.json();
        const list = (data?.workflows ?? data ?? []) as { name?: string }[];
        if (!cancelled) setWfNames(list.map((w) => String(w?.name ?? '')).filter(Boolean));
      } catch { /* 列表拿不到 → 只留「不设」选项 */ } finally { if (!cancelled) setWfLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, [node.type, wfLoaded]);
  const writeLoopBody = (workflowName: string, rows: { k: string; v: string }[]): void => {
    setBodyRows(rows);
    if (!workflowName) { onParamsChange({ body: null }); return; }
    const inputs: Record<string, string> = {};
    for (const r of rows) { const k = r.k.trim(); if (k) inputs[k] = r.v; }
    onParamsChange({ body: { workflowName, inputs } });
  };
  const setLoopBound = (next: string): void => {
    const cleared = { count: null, while: null, over: null };
    if (next === 'count') onParamsChange({ ...cleared, count: 3 });
    else if (next === 'over') onParamsChange({ ...cleared, over: '' });
    else if (next === 'while') onParamsChange({ ...cleared, while: 'true' });
    else onParamsChange(cleared);
  };
  const loopConfigNodes = (): React.ReactNode => {
    const numInput = (key: string, label: string, min: number, max: number | null, dflt: string): React.ReactNode => createElement('input', {
      className: 'dsh-wf-input', key, type: 'number', min, ...(max ? { max } : {}), placeholder: label,
      value: typeof loopParam[key] === 'number' ? String(loopParam[key]) : '',
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = e.target.value.trim();
        if (v === '') { onParamsChange({ [key]: null }); return; }
        let n = parseInt(v, 10);
        if (!Number.isFinite(n)) return;
        n = Math.max(min, max ? Math.min(max, n) : n);
        onParamsChange({ [key]: n });
      },
    });
    const out: React.ReactNode[] = [
      createElement('label', { className: 'dsh-wf-panel-label', key: 'loop-label' }, '🔁 循环设置'),
      createElement('div', { className: 'dsh-wf-panel-hint', key: 'loop-hint' },
        'loop 只产出迭代序列（out.count / out.items），**不会重复执行下游节点**：它算出「跑几次 / 跑哪些项」，由下游节点自己逐项处理。三种边界同时只按一个生效，优先级 over > count > while。'),
      createElement('select', {
        className: 'dsh-wf-input', key: 'loop-bound', value: loopBound,
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setLoopBound(e.target.value),
      },
        createElement('option', { value: 'count', key: 'b-count' }, '固定次数 count'),
        createElement('option', { value: 'over', key: 'b-over' }, '遍历数组 over'),
        createElement('option', { value: 'while', key: 'b-while' }, '条件为真 while'),
        createElement('option', { value: 'none', key: 'b-none' }, '⚠ 不设边界（运行会失败）'),
      ),
    ];
    if (loopBound === 'count') out.push(numInput('count', '迭代次数，如 3', 0, null, '3'));
    if (loopBound === 'over') out.push(createElement('input', {
      className: 'dsh-wf-input', key: 'loop-over', placeholder: '{{上游节点id.out.数组字段}} 或直接写数组',
      value: typeof loopParam.over === 'string' ? loopParam.over : Array.isArray(loopParam.over) ? JSON.stringify(loopParam.over) : '',
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => onParamsChange({ over: e.target.value }),
    }));
    if (loopBound === 'while') out.push(createElement('input', {
      className: 'dsh-wf-input', key: 'loop-while', placeholder: '表达式（不是 {{}} 模板），如 true',
      value: typeof loopParam.while === 'string' ? loopParam.while : '',
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => onParamsChange({ while: e.target.value }),
    }));
    if (loopBound === 'none') out.push(createElement('div', { className: 'dsh-wf-panel-hint', key: 'loop-nobound' }, '⚠ 没有边界时运行会立即失败（LOOP_NO_BOUND），画布问题面板也会报错。'));
    // 选了边界类型但值还空着 → 引擎视作「没有边界」（会 LOOP_NO_BOUND 失败），面板明说
    const boundBlank = (loopBound === 'count' && typeof loopParam.count !== 'number')
      || (loopBound === 'over' && !(Array.isArray(loopParam.over) ? loopParam.over.length > 0 : String(loopParam.over ?? '').trim() !== ''))
      || (loopBound === 'while' && String(loopParam.while ?? '').trim() === '');
    if (boundBlank) out.push(createElement('div', { className: 'dsh-wf-panel-hint', key: 'loop-blank' },
      '⚠ 边界值还是空的——引擎会当作没有边界，运行报 LOOP_NO_BOUND（卡片副标题也会显示「⚠ 无循环边界」）。'));
    out.push(numInput('maxIterations', '最大迭代次数（默认 1000，上限 100000）', 1, 100000, '1000'));
    if (loopBound === 'while') out.push(createElement('label', { className: 'dsh-wf-panel-hint', key: 'loop-inf', style: { display: 'flex', gap: 6, alignItems: 'center' } },
      createElement('input', {
        type: 'checkbox', checked: loopParam.dangerouslyAllowInfinite === true,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => onParamsChange({ dangerouslyAllowInfinite: e.target.checked }),
      }),
      'while 到上限后继续（dangerouslyAllowInfinite，慎用）',
    ));
    // —— 循环体：子工作流（方案 A）——
    out.push(createElement('label', { className: 'dsh-wf-panel-label', key: 'loop-body-label' }, '🔁 循环体（可选）'));
    out.push(createElement('select', {
      className: 'dsh-wf-input', key: 'loop-body-sel', value: loopBody.workflowName ?? '',
      onChange: (e: React.ChangeEvent<HTMLSelectElement>) => writeLoopBody(e.target.value, bodyRows),
    },
      createElement('option', { value: '', key: 'lb-none' }, '（不设：只产出迭代序列 count/items）'),
      ...wfNames.map((n) => createElement('option', { value: n, key: 'lb-' + n }, n)),
      ...(loopBody.workflowName && !wfNames.includes(loopBody.workflowName)
        ? [createElement('option', { value: loopBody.workflowName, key: 'lb-cur' }, `${loopBody.workflowName}（当前值）`)] : []),
    ));
    if (loopBody.workflowName) {
      out.push(createElement('div', { className: 'dsh-wf-panel-hint', key: 'loop-body-hint' },
        '每轮调用该子工作流：值里可用 {{vars.loopItem}}（当轮的项或轮次序号）与 {{vars.loopIndex}}（序号），也可引用上游 {{节点id.out.x}}；子工作流 end 节点的输出会依次收进本节点的 out.items，下游写法不变。'));
      bodyRows.forEach((row, i) => out.push(createElement('div', { key: 'loop-body-row-' + i, style: { display: 'flex', gap: 6, marginBottom: 6 } },
        createElement('input', {
          className: 'dsh-wf-input', placeholder: '输入名（子工作流 inputs.x）', value: row.k, style: { flex: '0 0 42%' },
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => writeLoopBody(loopBody.workflowName as string, bodyRows.map((r, j) => (j === i ? { ...r, k: e.target.value } : r))),
        }),
        createElement('input', {
          className: 'dsh-wf-input', placeholder: '值，如 {{vars.loopItem}}', value: row.v, style: { flex: 1 },
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => writeLoopBody(loopBody.workflowName as string, bodyRows.map((r, j) => (j === i ? { ...r, v: e.target.value } : r))),
        }),
        createElement('button', {
          className: 'dsh-wf-btn', title: '删除该输入',
          onClick: () => writeLoopBody(loopBody.workflowName as string, bodyRows.filter((_, j) => j !== i)),
        }, '✕'),
      )));
      out.push(createElement('button', {
        className: 'dsh-wf-inputs-add', key: 'loop-body-add', title: '添加输入映射',
        onClick: () => setBodyRows((rs) => [...rs, { k: '', v: '' }]),
      }, '+'));
      out.push(createElement('select', {
        className: 'dsh-wf-input', key: 'loop-iter-err', value: String(loopParam.onIterationError ?? 'stop'),
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onParamsChange({ onIterationError: e.target.value }),
      },
        createElement('option', { value: 'stop', key: 'ie-stop' }, '某轮失败 → 整节点失败（已完成轮次保留在 items）'),
        createElement('option', { value: 'continue', key: 'ie-cont' }, '某轮失败 → 写占位并继续跑'),
      ));
    }
    // ★ 必须包一层 dsh-wf-panel-row：面板的每块设置都是一行（switch 分支设置同款），
    //   否则元素直接挂在面板根上——样式错位，且任何按 .dsh-wf-panel-row 定位的断言/测试都找不到它
    return createElement('div', { className: 'dsh-wf-panel-row' }, ...out);
  };
  const runSingleNode = async () => {
    // AI 节点必须选模型：未选 → 不执行，给出引导
    if (node.type === 'subagent' && !String(node.params?.model ?? '').trim()) {
      setTestResult({ error: '请先在上方「选择模型」中选择执行模型（模型来自 dsh 自动发现），再试跑。' });
      return;
    }
    setTestRunning(true);
    setTestResult(null);
    try {
      let inputs: Record<string, unknown> = {};
      try { inputs = JSON.parse(testInputs || '{}'); } catch { throw new Error('输入 JSON 不合法'); }
      const res = await fetch('/api/dag-flow/run-node', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ nodeType: node.type, params: node.params ?? {}, inputs }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const target = data.summary?.results?.target;
      setTestResult({ ok: data.ok, status: target?.status ?? data.summary?.status, ms: target?.durationMs, output: target?.out ?? target?.output });
    } catch (e) {
      setTestResult({ error: (e as Error).message });
    } finally {
      setTestRunning(false);
    }
  };

  useEffect(() => {
    if (node.type !== 'subagent' || modelsLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/dag-flow/models', { credentials: 'include' });
        if (!res.ok) throw new Error(`请求失败（HTTP ${res.status}）`);
        const data = await res.json();
        if (!cancelled) {
          setModels(data.models ?? []);
          setModelsLoaded(true);
        }
      } catch (e) {
        console.warn('[dag-flow] load models failed:', (e as Error).message);
        if (!cancelled) setModelsLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [node.type, modelsLoaded]);

  const handleModelSelect = (val: string) => {
    setSelectedModel(val);
    onParamsChange({ model: val });
  };

  // ★ 模型下拉的显示名（2026-10-03 用户要求「显示模型显示名称，不用 id」）：
  //   label = 宿主给的显示名（DeepSeek-V41-Flash）；宿主没给时回退 model id（settings 直读源）
  //   → 最后才回退旧的内部串 name（llm:provider:model），保证任何来源都不会显示成一串内部 id。
  //   存值/执行永远是 id（option 的 value），label 只影响 option 文案。
  const modelLabelOf = (m: { id: string; name?: string; label?: string; model?: string }) => m.label || m.model || m.name || m.id;
  const modelLabelCount = new Map<string, number>();
  for (const m of models) modelLabelCount.set(modelLabelOf(m), (modelLabelCount.get(modelLabelOf(m)) ?? 0) + 1);
  /** 重名时补提供方显示名（不是 id）用于消歧 */
  const modelDisambig = (m: { id: string; name?: string; label?: string; model?: string; providerLabel?: string }) =>
    (modelLabelCount.get(modelLabelOf(m)) ?? 0) > 1 ? (m.providerLabel || m.name || '') : '';

  // ★ 「重进下拉直接定位到已选模型」（2026-10-03 用户需求）：把已选中的那条挪到列表最前（紧跟占位项），
  //   原生 select 展开时就在最上面，不用翻 60 条；其余保持原顺序。**只调顺序，不复制、不改 value**。
  const orderedModels = (() => {
    if (!selectedModel) return models;
    const hit = models.find((m) => m.id === selectedModel);
    if (!hit) return models;
    return [hit, ...models.filter((m) => m.id !== selectedModel)];
  })();

  // ★ 外部换掉了 def 里的模型时把下拉同步过去（换工作流 / 撤销 / 别处编辑）：
  //   NodeInspector 按 node.id 加了 key，切节点会重挂载；但**同一个节点被换掉 def** 时组件不重挂载，
  //   初始 useState 不再生效 → 下拉会停在旧值。这里按 prop 变化同步（cur === fromDef 时不动，避免
  //   把用户刚选、正在往 def 回写的值打回去）。
  useEffect(() => {
    const fromDef = typeof node.params?.model === 'string' ? node.params.model : '';
    setSelectedModel((cur) => (cur === fromDef ? cur : fromDef));
  }, [node.id, node.params?.model]);

  return createElement(
    'div',
    null,
    createElement('div', { className: 'dsh-wf-palette-section' }, `${meta?.emoji ?? '⚙️'} ${meta?.label ?? node.type}`),
    createElement('div', { className: 'dsh-wf-panel-row' },
      createElement('label', { className: 'dsh-wf-panel-label' }, '节点 ID'),
      createElement('input', {
        className: 'dsh-wf-input',
        value: node.id,
        readOnly: true,
      }),
    ),
    createElement('div', { className: 'dsh-wf-panel-row' },
      createElement('label', { className: 'dsh-wf-panel-label' }, '节点类型'),
      createElement('input', { className: 'dsh-wf-input', value: node.type, readOnly: true }),
    ),
    // ===== 变量引用（2026-10-03 用户需求：上游能传过来的所有变量 + 本节点能给下游的所有变量，
    //       都点击复制，且要说明每个变量是干什么的；两处都要包含全局变量）=====
    createElement('div', { className: 'dsh-wf-panel-row' },
      createElement('label', { className: 'dsh-wf-panel-label' }, `🔗 上游变量（${upstream.length} 个上游节点 · 点击复制）`),
      upstream.length === 0
        ? createElement('div', { className: 'dsh-wf-panel-hint' }, '无上游节点——本节点是流程起点；下面的全局变量仍然可用。')
        : createElement('div', { className: 'dsh-wf-var-groups' },
            ...upstream.map((u) => {
              const un = defNodes.find((n) => n.id === u);
              const spec = outSpecOf(un?.type ?? '');
              const um = findMeta(un?.type ?? '');
              const f = fieldsFor(u, un?.type ?? '',
                un?.type === 'set_var' ? Object.keys((un.params?.vars as Record<string, unknown>) ?? {}).map((k) => ({ path: k, desc: '本节点写入的全局变量（键来自节点参数）' })) : []);
              const rs = runOuts?.[u]?.status;
              const srcNote = f.live ? '（字段取自上次运行的真实输出）'
                : (rs && rs !== 'success' ? `（上次运行是 ${rs}，字段按类型推断）` : '');
              return createElement('div', { key: 'up-' + u, className: 'dsh-wf-var-group' },
                createElement('div', { className: 'dsh-wf-var-node' },
                  `${um?.label ?? un?.type ?? '?'} · ${u}${spec.note ? ` —— ${spec.note}` : ''}${srcNote}`),
                createElement('div', { className: 'dsh-wf-var-list' },
                  refChip(`{{${u}.out}}`, `「${u}」的整份输出`, `up-${u}-all`, false),
                  ...f.list.map((x) => refChip(`{{${u}.out.${x.path}}}`, `${x.desc || '自定义字段'}${x.sample ? `；样例：${x.sample}` : ''}`, `up-${u}-${x.path}`, false)),
                  refChip(`{{results.${u}}}`, '该节点的执行状态/耗时（不是它的业务输出）', `up-${u}-res`, false),
                ),
                f.live
                  ? createElement('div', { className: 'dsh-wf-var-legend' },
                      '实测字段：' + f.list.map((x) => `${x.path}=${x.sample}${x.desc ? `（${x.desc}）` : ''}`).join(' · ')
                      + (f.skipped ? ` · 另有 ${f.skipped} 个键名含点/空格，无法用 {{}} 引用` : ''))
                  : (f.list.length
                      ? createElement('div', { className: 'dsh-wf-var-legend' },
                          '字段说明：' + f.list.map((x) => `${x.path}=${x.desc}`).join(' · '))
                      : null),
              );
            }),
            // 全局变量在上游变量里也要有（它们不来自上游节点，但在本节点参数里一样能引用）
            createElement('div', { className: 'dsh-wf-var-group' },
              createElement('div', { className: 'dsh-wf-var-node' }, '全局变量（不来自上游，任意位置都能引用）'),
              createElement('div', { className: 'dsh-wf-var-list' }, ...globalChips('up-gv')),
            ),
          ),
    ),
    // 全局变量（工作流任意位置都能用：vars 来自「设置变量」节点，inputs 来自工作流参数）
    createElement('div', { className: 'dsh-wf-panel-row' },
      createElement('label', { className: 'dsh-wf-panel-label' },
        `🌐 全局变量（vars ${globalVars.length} · inputs ${inputKeys.length} · 点击复制）`),
      createElement('div', { className: 'dsh-wf-var-list' },
        ...globalVars.map((k) => refChip(`{{vars.${k}}}`, `「${k}」——由设置变量节点 ${varOwner[k]} 写入，流程内随处可见`, `gv-${k}`, false)),
        ...inputKeys.map((k) => refChip(`{{inputs.${k}}}`, `工作流参数「${k}」——运行本工作流时由外部/面板填入`, `gi-${k}`, false)),
        refChip('{{vars.loopItem}}', '仅在被 loop 当循环体调用的子工作流里可用：当轮的项或轮次序号', 'gv-loopItem', false),
        refChip('{{vars.loopIndex}}', '仅在被 loop 当循环体调用的子工作流里可用：当前轮序号（从 0 开始）', 'gv-loopIndex', false),
      ),
      (!globalVars.length && !inputKeys.length)
        ? createElement('div', { className: 'dsh-wf-panel-hint' }, '还没有全局变量：加一个「设置变量」节点会写 vars，或在头部 ✍️ 工作流参数里加 inputs。')
        : null,
    ),
    // 本节点输出（下游引用）
    createElement('div', { className: 'dsh-wf-panel-row' },
      createElement('label', { className: 'dsh-wf-panel-label' }, '📤 本节点输出（下游可直接引用 · 点击复制）'),
      createElement('div', { className: 'dsh-wf-var-list' },
        refChip(`{{${node.id}.out}}`, `本节点的整份输出${selfSpec.note ? `（${selfSpec.note}）` : ''}`, 'self-all', true),
        ...selfFields.list.map((x) => refChip(`{{${node.id}.out.${x.path}}}`, `${x.desc || '自定义字段'}${x.sample ? `；样例：${x.sample}` : ''}`, `self-${x.path}`, true)),
        refChip(`{{results.${node.id}}}`, '本节点的执行状态/耗时（不是业务输出）', 'self-res', true),
        ...(node.type === 'set_var' ? Object.keys((node.params?.vars as Record<string, unknown>) ?? {}).map((k) => refChip(`{{vars.${k}}}`, `本节点写入的全局变量「${k}」`, `self-var-${k}`, true)) : []),
      ),
      // 标量/动态型输出：把「这份输出到底是什么」写成可见说明（用户要「说明每个变量作用」）
      selfSpec.note ? createElement('div', { className: 'dsh-wf-var-legend' }, `本节点输出是什么：${selfSpec.note}`) : null,
      // 本次运行过 → 字段按真实输出给（含用户自定义键），并写明「实测字段=样例值」
      selfFields.live
        ? createElement('div', { className: 'dsh-wf-var-legend' },
            '实测字段（取自上次运行，字段名与样例都是真的）：' + selfFields.list.map((x) => `${x.path}=${x.sample}${x.desc ? `（${x.desc}）` : ''}`).join(' · ')
            + (selfFields.skipped ? ` · 另有 ${selfFields.skipped} 个键名含点/空格，无法用 {{}} 引用` : ''))
        : (selfFields.list.length
            ? createElement('div', { className: 'dsh-wf-var-legend' },
                '字段说明：' + selfFields.list.map((x) => `${x.path}=${x.desc}`).join(' · '))
            : null),
      createElement('div', { className: 'dsh-wf-var-legend' },
        '下游节点这样用：写在参数里用 {{}} 模板（如 {{' + node.id + '.out.field}}）；写在 if/switch/loop 的表达式里则不带 {{}}（如 ' + node.id + '.out.field）。'),
      // 全局变量在本节点输出里也要有（它们不只属于本节点，下游一样能引用）——用户明确要求两处都包含
      createElement('div', { className: 'dsh-wf-var-legend' }, '全局变量（下游同样能直接引用）：'),
      createElement('div', { className: 'dsh-wf-var-list' }, ...globalChips('self-gv')),
    ),
    copied && createElement('div', { className: 'dsh-wf-panel-hint' }, `已复制：${copied}`),
    // #A4 失败策略（onError：节点失败时的行为）
    createElement('div', { className: 'dsh-wf-panel-row' },
      createElement('label', { className: 'dsh-wf-panel-label' }, '🛟 失败策略'),
      createElement('select', {
        className: 'dsh-wf-input',
        value: typeof onError === 'string' ? onError : 'goto',
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
          const v = e.target.value;
          if (v === 'goto') onNodeError?.({ goto: (typeof onError === 'object' && onError.goto) || (defNodes.find((n) => n.id !== node.id)?.id ?? '') });
          else onNodeError?.(v as 'stop' | 'continue');
        },
      },
        createElement('option', { value: 'stop' }, '⛔ 停止后续节点（默认）'),
        createElement('option', { value: 'continue' }, '⏭ 失败后继续执行下游'),
        createElement('option', { value: 'goto' }, '↪ 失败后跳转到指定节点'),
      ),
    ),
    // ★ A 方案容错开关（2026-10-03 用户拍板「确认使用 A：节点级失败不影响流程开关」）
    //   为什么必须有这个开关：DAG 模式（def 带 edges）下**节点级 onError 完全不生效**，
    //   一次抓取/发信失败就把整条流水线拖垮（用户今天已连撞两次：邮件节点、抓取节点）。
    createElement('div', { className: 'dsh-wf-panel-row' },
      createElement('label', { className: 'dsh-wf-panel-label' }, '🛟 失败不影响流程'),
      createElement('label', { className: 'dsh-wf-tolerate' },
        createElement('input', {
          type: 'checkbox',
          className: 'dsh-wf-tolerate-check',
          checked: tolerate === true,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => onTolerateChange?.(e.target.checked),
        }),
        createElement('span', { className: 'dsh-wf-tolerate-text' },
          tolerate ? '已开启 —— 本节点失败也继续跑后续节点' : '未开启 —— 失败即中断后续节点'),
      ),
      createElement('div', { className: 'dsh-wf-panel-hint' },
        '勾选后：失败只记在本节点（徽标变 ⚠ 已容错，鼠标悬浮节点可看错误详情），后续节点照常执行，运行汇总标注「N 个节点失败已容错」。DAG 工作流请用这个开关——上面的「失败策略」只在早期的 next 顺序模式生效。'),
    ),
    typeof onError === 'object' && onError.goto !== undefined && createElement('div', { className: 'dsh-wf-panel-row' },
      createElement('label', { className: 'dsh-wf-panel-label' }, reqMark(), '↪ 跳转目标'),
      createElement('select', {
        className: 'dsh-wf-input',
        value: onError.goto,
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onNodeError?.({ goto: e.target.value }),
      },
        defNodes.filter((n) => n.id !== node.id && n.type !== 'start').map((n) =>
          createElement('option', { key: n.id, value: n.id }, `${n.label ?? n.id}（${n.type}）`),
        ),
      ),
    ),
    // ★ loop 循环设置（P2，2026-10-03 用户拍板）
    node.type === 'loop' && loopConfigNodes(),
    // ★ switch 分支设置（2026-10-02 用户需求「根据不同条件分成多个分支」）：
    //   每个 case 键在画布上生成一个输出口（外加 * 兜底口）——从对应口拖线到目标节点，
    //   边的 when 自动=case 键，执行器按 value 匹配激活对应分支、其余跳过。
    node.type === 'switch' && createElement('div', { className: 'dsh-wf-panel-row' },
      createElement('label', { className: 'dsh-wf-panel-label' }, reqMark(), '🔀 分支设置（case 列表）'),
      createElement('div', { className: 'dsh-wf-panel-hint' },
        '每个 case 在画布上生成一个输出口（从对应口拖线连目标，边自动带条件）；value 与 case 值相等时激活该分支，其余跳过。value 支持 {{上游.out}} 引用或字面量。'),
      caseRows.length === 0 && createElement('div', { className: 'dsh-wf-panel-hint' }, '暂无 case——点下方按钮添加（至少 1 个才能画分支）。'),
      caseRows.map((row, i) => createElement('div', { key: i, style: { display: 'flex', gap: 6, marginBottom: 6 } },
        createElement('input', {
          className: 'dsh-wf-input', placeholder: 'case 值（如 A）', value: row.k, style: { flex: '0 0 45%' },
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => writeCaseRows(caseRows.map((r, j) => (j === i ? { ...r, k: e.target.value } : r))),
        }),
        createElement('input', {
          className: 'dsh-wf-input', placeholder: '说明（可选）', value: row.v, style: { flex: 1 },
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => writeCaseRows(caseRows.map((r, j) => (j === i ? { ...r, v: e.target.value } : r))),
        }),
        createElement('button', {
          className: 'dsh-wf-btn', title: '删除该 case',
          onClick: () => writeCaseRows(caseRows.filter((_, j) => j !== i)),
        }, '✕'),
      )),
      createElement('button', {
        className: 'dsh-wf-inputs-add', title: '添加 case',
        onClick: () => setCaseRows((rs) => [...rs, { k: '', v: '' }]),
      }, '+'),
    ),
    // ★ 代码两种录入途径（python/bash，2026-10-02 用户定档：两种互补）——
    //   a) 简单脚本：面板「📝 编辑代码」弹窗直接写多行（存 params.code，随工作流走）；
    //   b) 复杂/多脚本：文件引用 codePath —— 约定 <工作区>/.dag-flow/scripts/<工作流名>/xxx.py
    //     （相对路径锚定 .dag-flow/，也支持绝对路径）；填了 codePath 优先于内联 code。
    (node.type === 'python' || node.type === 'bash') && createElement('div', { className: 'dsh-wf-panel-row' },
      createElement('label', { className: 'dsh-wf-panel-label' }, reqMark(), '📄 代码文件（二选一）'),
      createElement('input', {
        className: 'dsh-wf-input',
        value: typeof node.params?.codePath === 'string' ? node.params.codePath : '',
        placeholder: `scripts/${workflowName || '工作流名'}/hello.py`,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
          const v = e.target.value;
          onParamsChange(v.trim() ? { codePath: v } : { codePath: null });
        },
      }),
      createElement('div', { className: 'dsh-wf-panel-hint' },
        `约定路径 scripts/${workflowName || '工作流名'}/xxx.py（📁 工作流文件夹按钮可达，按工作流分目录）；相对路径锚定 .dag-flow/，也支持绝对路径。填了代码文件时优先于内联代码。`),
      createElement('button', {
        className: 'dsh-wf-btn', style: { width: '100%' },
        onClick: () => setCodeEditorOpen(true),
        title: '弹出大编辑框直接写多行代码（随工作流保存）',
      }, '📝 编辑代码（简单脚本推荐）'),
    ),
    // #1 单节点试跑
    createElement('div', { className: 'dsh-wf-panel-row' },
      createElement('label', { className: 'dsh-wf-panel-label' }, '🧪 单节点试跑'),
      createElement('textarea', {
        className: 'dsh-wf-input',
        rows: 3,
        value: testInputs,
        onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setTestInputs(e.target.value),
        placeholder: '{"key": "value"} — 可用 {{inputs.key}} 在参数里引用',
        style: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11 },
      }),
    ),
    createElement('div', { className: 'dsh-wf-panel-row' },
      createElement('button', {
        className: 'dsh-wf-btn dsh-wf-btn-success',
        onClick: () => void runSingleNode(),
        disabled: testRunning || node.type === 'start' || node.type === 'end',
        title: '用 start→本节点→end 的最小流程真实执行一次',
      }, testRunning ? '⏳ 试跑中…' : '▶ 试跑本节点'),
      node.type === 'start' || node.type === 'end'
        ? createElement('span', { className: 'dsh-wf-panel-hint' }, ' start/end 节点无需试跑')
        : null,
    ),
    testResult && createElement('div', { className: 'dsh-wf-panel-row' },
      createElement('div', { className: `dsh-wf-test-result ${testResult.error ? 'is-err' : testResult.ok ? 'is-ok' : 'is-fail'}` },
        createElement('div', null,
          testResult.error
            ? `✗ ${testResult.error}`
            : `${testResult.ok ? '✓' : '✗'} 节点状态: ${testResult.status}${testResult.ms != null ? ` · ${Math.round(testResult.ms)}ms` : ''}`,
        ),
        testResult.output != null && createElement('pre', null, JSON.stringify(testResult.output, null, 2).slice(0, 600)),
      ),
    ),
    node.type === 'subagent' && createElement('div', { className: 'dsh-wf-panel-row' },
      createElement('label', { className: 'dsh-wf-panel-label' }, reqMark(), '选择模型'),
      createElement('select', {
        className: 'dsh-wf-input',
        value: selectedModel,
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => handleModelSelect(e.target.value),
        style: !selectedModel ? { borderColor: 'var(--wf-warn, #fbbf24)' } : undefined,
      },
        createElement('option', { value: '', disabled: true }, models.length === 0 ? '（dsh 未配置可用模型，请先在 dsh 添加）' : '⬇ 请选择执行模型'),
        // ★ 存值不在当前列表里（旧工作流留下的快照 id、或 dsh 已下架该模型）→ **显式列出来**。
        //   否则 controlled select 匹配不到任何 option，界面显示"请选择执行模型"，而工作流里仍是旧 id
        //   → 看起来没选模型、实际按旧 id 执行（2026-10-03 用户问「模型不是实时获取的吗」时发现的缺口）。
        ...(selectedModel && !models.some((m) => m.id === selectedModel)
          ? [createElement('option', { key: 'stale-model', value: selectedModel }, `✓ ⚠ ${selectedModel}（当前值，dsh 当前未提供）`)] : []),
        orderedModels.map((m) => createElement('option', { key: m.id, value: m.id },
          // ★ 显示「模型显示名」（用户 2026-10-03：不用内部 id，不容易分辨）；重名才补提供方名消歧
          // ★ 已选中项打「✓」前缀（用户 2026-10-03：「点开下拉选项的已经选中的下拉选项就有一个选中的状态
          //   标记它……如果没有已经选择的下拉选，点开下拉选项的时候，就没有选中状态」）——原生 <option>
          //   不能设背景色/图标，只能用文案前缀；未选任何模型时（selectedModel===''）任何一项都不带 ✓。
          `${m.id === selectedModel ? '✓ ' : ''}⚙️ ${modelLabelOf(m)}${modelDisambig(m) ? `（${modelDisambig(m)}）` : ''}${m.hasImage ? ' · 📷 图片' : ''}`,
        )),
      ),
    ),
    node.type === 'subagent' && selectedModel && !models.some((m) => m.id === selectedModel) && createElement('div', { className: 'dsh-wf-panel-hint' },
      models.length === 0
        ? `⚠ 当前保存的模型「${selectedModel}」不在 dsh 当前列表里（本次没取到模型列表）——运行时仍按这个 id 执行。`
        : `⚠ 当前保存的模型「${selectedModel}」不在 dsh 当前可用列表里——运行时仍按这个 id 执行（可能失败）。请从上面重新选一个实际可用的模型。`,
    ),
    node.type === 'subagent' && !selectedModel && createElement('div', { className: 'dsh-wf-panel-hint' },
      models.length === 0
        ? 'dsh 未发现可用模型——请先在 dsh 侧配置模型后刷新。未选择模型前，本节点无法试跑、无法保存。'
        : '⚠ 必须选择执行模型后，本节点才能试跑与保存。',
    ),
    node.type === 'subagent' && createElement('div', { className: 'dsh-wf-panel-hint' },
      '模型自动发现自 dsh 配置（settings.yaml），密钥由 dsh 统一管理，无需在此录入。必须选择执行模型（必选）；prompt 留空（或上游输出为空）时本节点不执行，流程在此中断。',
    ),
    // ★ 保底不丢 id（用户 2026-10-03：下拉显示模型显示名，不用 id；但对照 JSON/排查时要能看到真实 id）
    node.type === 'subagent' && selectedModel && createElement('div', { className: 'dsh-wf-panel-hint' },
      `执行 id：${selectedModel}（下拉里显示的是模型显示名，运行时按这个 id 调用）`,
    ),
    node.type === 'subagent' && selectedModel && (() => {
      const m = models.find((x) => x.id === selectedModel);
      if (!m) return null;
      const caps = (m.input ?? ['text']).join(', ');
      if (m.hasImage) {
        return createElement('div', { className: 'dsh-wf-panel-hint' }, `✓ 所选模型支持图片输入（能力: ${caps}）`);
      }
      return createElement('div', { className: 'dsh-wf-panel-hint' },
        `⚠️ 所选模型不支持图片输入（能力: ${caps}，仅文本）——prompt 中引用图片/视频/文件时，运行会直接提示模型能力不足（MODEL_MODALITY_MISMATCH）。需要处理图片请换带 📷 的模型，或在 dsh settings.yaml 为该模型标注 input: [text, image] 后刷新。`);
    })(),
    node.type === 'session_input' && createElement(SessionInputFields, { node, onParamsChange }),
    (node.type === 'image_generate' || node.type === 'video_generate' || node.type === 'file_save')
      && createElement(MediaFields, { node, onParamsChange }),
    (node.type === 'web_search' || node.type === 'web_fetch')
      && createElement(WebFields, { node, onParamsChange }),
    createElement('div', { className: 'dsh-wf-panel-row' },
      createElement('label', { className: 'dsh-wf-panel-label' }, '显示名 (label)'),
      createElement('input', {
        className: 'dsh-wf-input',
        defaultValue: node.label ?? node.id,
        onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
          onParamsChange({ _label: e.target.value });
        },
      }),
    ),
    createElement('div', { className: 'dsh-wf-panel-row' },
      createElement('label', { className: 'dsh-wf-panel-label' }, '参数 (params, JSON)'),
      createElement('div', { className: 'dsh-wf-panel-hint' },
        '可用上游数据引用：{{节点id.out}} / {{节点id.out.字段}} / {{vars.变量}} / {{inputs.输入}}',
      ),
      createElement('textarea', {
        className: 'dsh-wf-textarea',
        defaultValue: JSON.stringify(node.params ?? {}, null, 2),
        onBlur: (e: React.FocusEvent<HTMLTextAreaElement>) => {
          try {
            const parsed = JSON.parse(e.target.value || '{}');
            onParamsChange(parsed as Record<string, unknown>);
          } catch {
            // 解析失败保留原值
          }
        },
      }),
    ),
    createElement('div', { className: 'dsh-wf-panel-row' },
      createElement('button', { className: 'dsh-wf-btn dsh-wf-btn-danger dsh-wf-w-full', onClick: onDelete }, '🗑 删除节点'),
    ),
    // ★ 内联代码编辑弹窗（每键自动写回 params.code，随工作流保存；右上角 ✕ 关闭——弹窗交互统一模式）。
    //   带丰富工具的代码编辑器（零依赖）：行号槽 + 语法高亮层 + 透明 textarea 叠加，
    //   工具栏=复制全部 / 清空（行内确认）/ 光标行列与字符数状态栏；Tab=4 空格缩进。
    //   ★ createPortal 到 document.body：右侧面板的 backdrop-filter 会把 fixed 弹窗困在面板内，
    //     Portal 逃出包含块，弹窗在页面正中（2026-10-02 用户反馈「在面板里打开」）。
    codeEditorOpen && (node.type === 'python' || node.type === 'bash') && createPortal(createElement(
      'div',
      {
        className: 'dag-flow-picker-overlay',
        onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) setCodeEditorOpen(false); },
      },
      createElement('div', { className: 'dag-flow-picker', style: { width: '80vw', maxWidth: 1100 } },
        createElement('div', { className: 'dag-flow-picker-title', style: { fontSize: 16 } },
          `✍️ 编辑代码（${meta?.label ?? node.type}）`,
          createElement('button', {
            className: 'dag-flow-picker-close', title: '关闭',
            onClick: () => setCodeEditorOpen(false),
          }, '✕'),
        ),
        createElement('div', { className: 'dag-flow-picker-body' },
          createElement('div', { className: 'dsh-wf-code-toolbar' },
            createElement('button', {
              className: 'dsh-wf-btn', title: '复制全部代码到剪贴板',
              onClick: () => { void navigator.clipboard.writeText(typeof node.params?.code === 'string' ? node.params.code : ''); },
            }, '📋 复制'),
            createElement('button', {
              className: `dsh-wf-btn ${clearArm ? 'dsh-wf-btn-danger' : ''}`,
              title: clearArm ? '再点一次确认清空全部代码' : '清空全部代码（行内确认，防误触）',
              onClick: () => {
                if (!clearArm) { setClearArm(true); setTimeout(() => setClearArm(false), 2500); return; }
                setClearArm(false);
                onParamsChange({ code: '' });
              },
            }, clearArm ? '确认清空？' : '🧹 清空'),
            createElement('span', { className: 'dsh-wf-panel-hint' }, 'Tab = 4 空格缩进 · 改动即自动保存'),
            createElement('span', { className: 'dsh-wf-code-status' },
              `Ln ${cursor.ln}, Col ${cursor.col} · ${cursor.len} 字符`),
          ),
          createElement('div', { className: 'dsh-wf-code-ed' },
            createElement('div', { className: 'dsh-wf-code-gutter', ref: gutterRef },
              createElement('pre', null,
                Array.from({ length: (typeof node.params?.code === 'string' ? node.params.code : '').split('\n').length }, (_, i) => i + 1).join('\n'))),
            createElement('div', { className: 'dsh-wf-code-wrap' },
              createElement('pre', {
                className: 'dsh-wf-code-hl', ref: hlRef, 'aria-hidden': true,
                dangerouslySetInnerHTML: { __html: highlightCode(typeof node.params?.code === 'string' ? node.params.code : '', node.type === 'bash' ? 'bash' : 'python') },
              }),
              createElement('textarea', {
                className: 'dsh-wf-code-ta',
                value: typeof node.params?.code === 'string' ? node.params.code : '',
                spellCheck: false,
                wrap: 'off',
                placeholder: node.type === 'python'
                  ? "import datetime\nprint('你好，当前时间：' + datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'))"
                  : "echo 'hello'\ndate",
                onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => {
                  onParamsChange({ code: e.target.value });
                  updateCursor(e.target);
                },
                onScroll: (e: React.UIEvent<HTMLTextAreaElement>) => syncScroll(e.currentTarget),
                onClick: (e: React.MouseEvent<HTMLTextAreaElement>) => updateCursor(e.currentTarget),
                onKeyUp: (e: React.KeyboardEvent<HTMLTextAreaElement>) => updateCursor(e.currentTarget),
                onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                  // Tab = 4 空格缩进（Shift+Tab 简单反缩进当前行首）
                  if (e.key === 'Tab') {
                    e.preventDefault();
                    const ta = e.currentTarget;
                    const s = ta.selectionStart;
                    const epos = ta.selectionEnd;
                    const v = ta.value;
                    if (!e.shiftKey) {
                      const next = v.slice(0, s) + '    ' + v.slice(epos);
                      onParamsChange({ code: next });
                      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 4; });
                    } else {
                      const lineStart = v.lastIndexOf('\n', s - 1) + 1;
                      const cut = v.slice(lineStart, lineStart + 4) === '    ' ? 4 : 0;
                      if (cut) {
                        const next = v.slice(0, lineStart) + v.slice(lineStart + cut);
                        onParamsChange({ code: next });
                        requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = Math.max(lineStart, s - cut); });
                      }
                    }
                  }
                },
              }),
            ),
          ),
        ),
      ),
    ), document.body),
  );
}

// 会话输入节点的专用配置：选择工作区会话 + 取多少条
function SessionInputFields({ node, onParamsChange }: {
  node: import('./types').ClientNode;
  onParamsChange: (params: Record<string, unknown>) => void;
}) {
  const [sessions, setSessions] = useState<{ id: string; name: string; mtime?: string }[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string>(() => (node.params?.sessionId as string) ?? '');
  const [limit, setLimit] = useState<string>(() => String((node.params?.limit as number) ?? 10));

  useEffect(() => {
    if (sessionsLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/dag-flow/sessions', { credentials: 'include' });
        if (!res.ok) throw new Error(`请求失败（HTTP ${res.status}）`);
        const data = await res.json();
        if (!cancelled) {
          setSessions(data.sessions ?? []);
          setSessionsLoaded(true);
        }
      } catch (e) {
        console.warn('[dag-flow] load sessions failed:', (e as Error).message);
        if (!cancelled) setSessionsLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionsLoaded]);

  const handleId = (val: string) => {
    setSelectedId(val);
    onParamsChange({ sessionId: val, limit: Number(limit) || 10 });
  };
  const handleLimit = (val: string) => {
    setLimit(val);
    onParamsChange({ sessionId: selectedId, limit: Number(val) || 10 });
  };

  // 会话下拉显示「MM-DD HH:mm · 标题」（2026-10-02 用户需求：全是 session id 分不清）；
  // 标题由 host 提取（首条 user 消息摘要），id 仍是 value（执行时按 id 读会话）。
  const fmtSessionTime = (iso?: string): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  return createElement('div', null,
    createElement('div', { className: 'dsh-wf-panel-row' },
      createElement('label', { className: 'dsh-wf-panel-label' }, reqMark(), '选择会话'),
      createElement('select', {
        className: 'dsh-wf-input',
        value: selectedId,
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => handleId(e.target.value),
      },
        createElement('option', { value: '' }, sessionsLoaded ? '（选择一个会话，按最近活动排序）' : '（加载会话列表...）'),
        sessions.map((s) => {
          const when = fmtSessionTime(s.mtime);
          return createElement('option', { key: s.id, value: s.id }, when ? `${when} · ${s.name}` : s.name);
        }),
      ),
    ),
    createElement('div', { className: 'dsh-wf-panel-row' },
      createElement('label', { className: 'dsh-wf-panel-label' }, '取最近对话条数'),
      createElement('input', {
        className: 'dsh-wf-input',
        type: 'number',
        min: 1,
        max: 500,
        value: limit,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => handleLimit(e.target.value),
      }),
    ),
    createElement('div', { className: 'dsh-wf-panel-hint' },
      '运行时会读取所选会话最近的对话内容作为本节点输出，可连给后续 AI/其他节点使用。',
    ),
  );
}

// 多模态节点（image_generate / video_generate / file_save）的专属配置表单
function MediaFields({ node, onParamsChange }: {
  node: import('./types').ClientNode;
  onParamsChange: (params: Record<string, unknown>) => void;
}) {
  const p = node.params ?? {};
  const [imageTesting, setImageTesting] = useState(false);
  const [imageTestMsg, setImageTestMsg] = useState<string | null>(null);
  // label 以「!」开头 = 必填行：名称前渲染红星标识（纯视觉，2026-10-02 用户需求）
  const row = (label: string, el: any, hint?: string) =>
    createElement('div', { className: 'dsh-wf-panel-row', key: label },
      createElement('label', { className: 'dsh-wf-panel-label' },
        label.startsWith('!') ? reqMark() : null, label.replace(/^!/, '')), el,
      hint ? createElement('div', { className: 'dsh-wf-panel-hint' }, hint) : null,
    );
  const text = (key: string, placeholder: string, type = 'text') =>
    createElement('input', {
      className: 'dsh-wf-input', type, placeholder,
      defaultValue: typeof p[key] === 'string' ? (p[key] as string) : '',
      onBlur: (e: React.FocusEvent<HTMLInputElement>) => onParamsChange({ [key]: e.target.value }),
    });

  if (node.type === 'image_generate') {
    const runImageTest = async () => {
      setImageTesting(true);
      setImageTestMsg(null);
      try {
        const res = await fetch('/api/dag-flow/test-image-api', {
          method: 'POST', credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ baseURL: p.baseURL, apiKey: p.apiKey, apiKeyEnv: p.apiKeyEnv, model: p.model, size: p.size }),
        });
        const data = await res.json().catch(() => ({})) as { ok?: boolean; note?: string; hint?: string; detail?: string; error?: string };
        setImageTestMsg(
          data.error ? `✗ ${data.error}`
            : data.ok ? `✓ ${data.note ?? '连接成功且模型可用'}`
              : `✗ ${data.hint ?? '测试失败'}${data.detail ? ` — ${data.detail}` : ''}`.slice(0, 320),
        );
      } catch (e) {
        setImageTestMsg(`✗ ${(e as Error).message}`);
      } finally {
        setImageTesting(false);
      }
    };
    return createElement('div', null,
      row('!画面描述 (prompt)', createElement('textarea', {
        className: 'dsh-wf-input', rows: 3, placeholder: '描述想生成的画面…',
        defaultValue: typeof p.prompt === 'string' ? p.prompt : '',
        onBlur: (e: React.FocusEvent<HTMLTextAreaElement>) => onParamsChange({ prompt: e.target.value }),
      })),
      row('!API 地址 (baseURL)', text('baseURL', 'https://…/compatible-mode/v1'), 'OpenAI images/generations 兼容接口'),
      row('模型', text('model', 'wanx-v1'), '必须是该 API 服务支持的图片模型（用下方测试验证）'),
      row('尺寸', text('size', '1024*1024')),
      row('API Key（或留空用环境变量）', text('apiKey', 'sk-…；留空则用 apiKeyEnv')),
      row('Key 环境变量名', text('apiKeyEnv', 'DASHSCOPE_API_KEY')),
      row('🔍 提前测试（验证 API 与模型）', createElement('button', {
        className: 'dsh-wf-btn',
        onClick: () => void runImageTest(),
        disabled: imageTesting,
        title: '真实发一次最小生成请求，验证 baseURL/Key/模型组合是否可用',
      }, imageTesting ? '⏳ 测试中…' : '🔍 测试连接')),
      imageTestMsg && createElement('div', { className: 'dsh-wf-panel-hint' }, imageTestMsg),
      createElement('div', { className: 'dsh-wf-panel-hint' }, '运行后图片直接保存到工作区 .dag-flow/ 目录，输出含相对路径。测试会真实生成 1 张最小图（产生少量费用）。'),
    );
  }
  if (node.type === 'video_generate') {
    return createElement('div', null,
      row('!任务提交地址', text('submitUrl', 'https://…/video/generation（POST）')),
      row('!任务查询地址', text('pollUrl', 'https://…/video/task?taskId={taskId}'), '支持 {taskId} 占位符'),
      row('Key 环境变量名 / apiKey', text('apiKeyEnv', 'DASHSCOPE_API_KEY')),
      row('轮询间隔 (ms)', text('pollIntervalMs', '5000')),
      row('最长等待 (ms)', text('maxWaitMs', '600000'), '超时后节点失败并给出最后任务状态'),
      createElement('div', { className: 'dsh-wf-panel-hint' }, '异步任务模式：提交 → 按 interval 轮询 statusPath → videoUrlPath 有值即完成，视频直接下载到工作区 .dag-flow/ 目录。'),
    );
  }
  // file_save
  return createElement('div', null,
    row('内容来源', createElement('select', {
      className: 'dsh-wf-input',
      value: typeof p.source === 'string' ? p.source : 'text',
      onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onParamsChange({ source: e.target.value }),
    },
      createElement('option', { value: 'text' }, '文本内容（text）'),
      createElement('option', { value: 'base64' }, 'Base64（base64）'),
      createElement('option', { value: 'url' }, 'URL 下载（url）'),
    )),
    p.source === 'url'
      ? row('!文件 URL', text('url', 'https://…（可引用 {{u.out.url}}）'))
      : row('文件内容', createElement('textarea', {
          className: 'dsh-wf-input', rows: 4,
          // ★ source → p.source（2026-10-02 用户反馈：点击 file_save 节点整个画布白屏——
          //   此前误写成裸 source，ReferenceError 把整棵 React 树打卸载）
          placeholder: p.source === 'base64' ? 'Base64 内容…' : '文本内容…（可引用 {{u.out.xxx}}）',
          defaultValue: typeof p.content === 'string' ? p.content : '',
          onBlur: (e: React.FocusEvent<HTMLTextAreaElement>) => onParamsChange({ content: e.target.value }),
        })),
    row('!保存文件名', text('filename', 'output.txt'), '可含子目录（如 reports/周报.md）；直接保存到工作区 .dag-flow/ 目录下'),
  );
}

// 搜索/抓取节点（web_search / web_fetch）的专属配置表单
function WebFields({ node, onParamsChange }: {
  node: import('./types').ClientNode;
  onParamsChange: (params: Record<string, unknown>) => void;
}) {
  const p = node.params ?? {};
  // label 以「!」开头 = 必填行：名称前渲染红星标识（纯视觉，2026-10-02 用户需求）
  const row = (label: string, el: any, hint?: string) =>
    createElement('div', { className: 'dsh-wf-panel-row', key: label },
      createElement('label', { className: 'dsh-wf-panel-label' },
        label.startsWith('!') ? reqMark() : null, label.replace(/^!/, '')), el,
      hint ? createElement('div', { className: 'dsh-wf-panel-hint' }, hint) : null,
    );
  const text = (key: string, placeholder: string, type = 'text') =>
    createElement('input', {
      className: 'dsh-wf-input', type, placeholder,
      defaultValue: typeof p[key] === 'string' ? (p[key] as string) : '',
      onBlur: (e: React.FocusEvent<HTMLInputElement>) => onParamsChange({ [key]: e.target.value }),
    });

  if (node.type === 'web_search') {
    return createElement('div', null,
      row('!搜索词 (query)', createElement('textarea', {
        className: 'dsh-wf-input', rows: 3, placeholder: '要搜索的内容…（可引用 {{u.out.xxx}}）',
        defaultValue: typeof p.query === 'string' ? p.query : '',
        onBlur: (e: React.FocusEvent<HTMLTextAreaElement>) => onParamsChange({ query: e.target.value }),
      })),
      row('搜索引擎', createElement('select', {
        className: 'dsh-wf-input',
        value: typeof p.provider === 'string' ? p.provider : 'auto',
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onParamsChange({ provider: e.target.value }),
      },
        createElement('option', { value: 'auto' }, 'auto（宿主优先 + 内置兜底，推荐）'),
        createElement('option', { value: 'bing' }, 'Bing（免 key）'),
        createElement('option', { value: 'ddg-lite' }, 'DuckDuckGo Lite（免 key）'),
        createElement('option', { value: 'ddg' }, 'DuckDuckGo HTML（免 key）'),
        createElement('option', { value: 'searxng' }, 'SearXNG（公共实例，免 key）'),
        createElement('option', { value: 'anysearch' }, 'AnySearch（免费匿名额度）'),
        createElement('option', { value: 'host' }, '仅宿主（要求已装 dsh-free-search）'),
      )),
      row('结果条数', text('count', '8', 'number'), '1-20 条'),
      row('时间范围', createElement('select', {
        className: 'dsh-wf-input',
        value: typeof p.timeRange === 'string' ? p.timeRange : '',
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onParamsChange({ timeRange: e.target.value || undefined }),
      },
        createElement('option', { value: '' }, '不限'),
        createElement('option', { value: 'day' }, '一天内'),
        createElement('option', { value: 'week' }, '一周内'),
        createElement('option', { value: 'month' }, '一月内'),
        createElement('option', { value: 'year' }, '一年内'),
      )),
      createElement('div', { className: 'dsh-wf-panel-hint' },
        '内置 5 个免 key 引擎，任何 DSH 零配置可用；auto 模式下若宿主装有 dsh-free-search 会优先走宿主（自动继承你配置的付费引擎与密钥），失败自动回落内置引擎链（Bing→DDG Lite→DDG→SearXNG→AnySearch）。query 留空时节点不执行、流程在此中断。',
      ),
    );
  }
  // web_fetch
  return createElement('div', null,
    row('!抓取地址 (url)', text('url', 'https://…（可引用 {{u.out.url}}）')),
    row('正文上限 (字符)', text('maxChars', '8000', 'number'), 'HTML 自动剥标签取正文；200-200000'),
    row('原样返回', createElement('select', {
      className: 'dsh-wf-input',
      value: p.raw ? '1' : '0',
      onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onParamsChange({ raw: e.target.value === '1' }),
    },
      createElement('option', { value: '0' }, '否（剥 HTML / 解析 JSON，推荐）'),
      createElement('option', { value: '1' }, '是（返回原始响应体）'),
    )),
    createElement('div', { className: 'dsh-wf-panel-hint' },
      '抓取网页：HTML 自动剥离标签取正文文本，JSON 自动解析为对象；常与「网页搜索→网页抓取→AI」串联。url 留空时节点不执行、流程在此中断。',
    ),
  );
}
