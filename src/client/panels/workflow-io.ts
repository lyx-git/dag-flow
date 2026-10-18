// src/client/panels/workflow-io.ts — 工作流 IO（保存 / 自动保存 / 改名与撞名探测 / 导入导出）
//
// 职责：从 FlowPanel.tsx 搬出的「这份 def 怎么落盘、怎么改名、怎么进出文件」（2026-10-19 拆分第 3 批）。
//   · saveDefToDisk：唯一写盘入口（saveDefToDisk 的 renameFrom 语义见函数内注释）
//   · handleSaveToDisk：手动保存（带校验：要有名字、不能撞名、AI 节点必须选模型；生成版本快照）
//   · 自动保存：def 变更 2s 防抖；空名/撞名一律不写盘（用户 2026-10-19 的两条要求）
//   · handleRename：改名 + def 内引用同步（scripts/ 前缀、subflow 名字）+ 撞名防抖探测
//   · 导出：JSON / PNG / SVG；导入：JSON 文件
//
// ★ 零行为变化：函数体与依赖数组原样搬过来；引用到的 FlowPanel 局部名全部由参数**同名解构**。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ViewTab, WorkflowDef } from '../types';
import { resetUndoPending } from '../undo-stack';
import { findMeta } from '../types';
import { normalizeWorkflowName } from '../../name-rule';
import { buildGraphSvg, svgToPngBlob, type GraphImageNode, type GraphImageEdge } from '../util/graphImage';
import type { RFNode, RFEdge } from '../util/flowDef';

export interface ImportMsg { ok: boolean; text: string; onClick?: () => void }

export interface UseWorkflowIoParams {
  def: WorkflowDef;
  setDef: Dispatch<SetStateAction<WorkflowDef>>;
  dirty: boolean;
  setDirty: Dispatch<SetStateAction<boolean>>;
  autoSave: 'idle' | 'pending' | 'saving' | 'error';
  setAutoSave: Dispatch<SetStateAction<'idle' | 'pending' | 'saving' | 'error'>>;
  nameTaken: boolean;
  setNameTaken: Dispatch<SetStateAction<boolean>>;
  importMsg: ImportMsg | null;
  setImportMsg: Dispatch<SetStateAction<ImportMsg | null>>;
  ctx: { onChange?: (d: WorkflowDef) => void };
  rfNodes: RFNode[];
  rfEdges: RFEdge[];
  setTab: Dispatch<SetStateAction<ViewTab>>;
  handleDefChange: (d: WorkflowDef) => void;
}

export function useWorkflowIo(p: UseWorkflowIoParams) {
  const {
    def, setDef, dirty, setDirty, autoSave, setAutoSave,
    nameTaken, setNameTaken, importMsg, setImportMsg, ctx, rfNodes, rfEdges, setTab, handleDefChange,
  } = p;
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

  // 手动保存到 <DSH_HOME>/.dag-flow/workflow/<name>.json（调 host API；2026-10-11 起与工作区无关）；AI 节点必须已选模型；
  // ★ 手动保存生成版本快照（服务端把本次保存的内容存档到 versions/，可回载回退）
  // （自动保存跳过此校验——自动保存永不阻塞，模型缺失由运行时校验兜底）
  const handleSaveToDisk = useCallback(async (): Promise<string> => {
    // ★ 2026-10-19：没名字就没法落盘（后端 safeName 会拒），先给一句人话而不是把 400 抛给用户
    if (!String(def.name ?? '').trim()) {
      throw new Error('工作流还没有名字——先在顶部名称框里起个名字再保存');
    }
    // ★ 2026-10-19 用户拍板 A：改名撞名绝不覆盖（服务端也拦，这里给更快的反馈）
    if (nameTaken) {
      throw new Error(`名称「${def.name}」已被其它工作流占用——换一个名字才能保存`);
    }
    const noModel = (def.nodes ?? []).filter((n) => n.type === 'subagent' && !String(n.params?.model ?? '').trim());
    if (noModel.length > 0) {
      throw new Error(`以下 AI 节点未选择执行模型：${noModel.map((n) => n.id).join('、')}。请在节点配置的「选择模型」中选择后重试。`);
    }
    const saved = await saveDefToDisk(def, true);
    return saved;
  }, [def, saveDefToDisk]);

  // ★ 自动保存（防抖）：def 变更后 2s 无新变更即写盘；拖拽等高频变更期间不断重置不刷盘。
  //   手动保存/自动保存写同一文件，先到先得、内容幂等。
  const autoSaveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!dirty) return;
    // ★ 2026-10-19（用户：「自动保存改为如果有工作流名称才自动创建，没有工作流名称，就不创建」）：
    //   名字为空 ⇒ 只改内存、绝不写盘。删除工作流后回落的"未命名空画布"因此不会凭空建出文件。
    if (!String(def.name ?? '').trim()) return;
    // ★ 改名撞名（用户拍板 A：绝不覆盖）：名字已被占用时连自动保存都不发，等服务端拦下那份改动留在内存里。
    if (nameTaken) return;
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
  }, [def, dirty, nameTaken, saveDefToDisk]);

  // 2026-10-01 深夜：管理视图随「📋 管理」tab 移除——列表/打开/复制/删除/重命名统一收进打开/新建选择器
  // ★ 2026-10-09：导出菜单（⬇ 按钮 → 导出 JSON / 导出图片 PNG）；menuAt = 按钮位置，用于 fixed 锚定
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportMenuAt, setExportMenuAt] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  // ★ 2026-10-19 用户拍板「画布里面不想要有运行失败的弹窗了…只有最后的执行失败和执行成功的提示」：
  //   失败提示也**不再常驻**——成功 2.6s、失败 5s（留够读完那一句话的时间）后自动消失，随时可点关闭。
  //   失败的具体原因不在浮窗里，而是落在画布对应节点上（徽标标红 + 悬停悬浮卡）。
  useEffect(() => {
    if (!importMsg) return;
    const t = window.setTimeout(() => setImportMsg(null), importMsg.ok ? 2600 : 5000);
    return () => window.clearTimeout(t);
  }, [importMsg]);

  // ★ 重命名联动（2026-10-02 用户需求「名称改了，响应使用的地方也要改，保持一致」）：
  //   renameFromRef 记录本次会话内**最初**的旧名（每键 onChange 都会进来，不覆盖已记录值），
  //   保存时随 body 带给 host——storage 层删旧 json + versions/scripts 子目录搬移。
  const renameFromRef = useRef<string | null>(null);
  /** 改名撞名探测的防抖计时器（见 handleRename 末尾） */
  const takenTimer = useRef<number | null>(null);
  // 名称修改
  const handleRename = useCallback((name: string) => {
    setDef((prev) => {
      // ★ 2026-10-19 用户：「自动保存改为如果有工作流名称才自动创建，没有工作流名称，就不创建」
      //   ⇒ 名字框**允许为空**（空 = 未命名画布，不自动保存）；不再回退成 my-workflow。
      //   旧回退（`name || 'my-workflow'`）会把"空画布"变成名叫 my-workflow 的工作流，
      //   再被自动保存写盘 —— 正是用户报的「删了又自动创建了一个 my-flow 工作流」。
      const newName = name;
      const oldName = prev.name;
      if (oldName !== newName && !renameFromRef.current) renameFromRef.current = oldName;
      // def 内引用同步只在"新名字非空"时做（空名没有 scripts/ 前缀可言，替换会把路径改坏）
      if (!newName) return { ...prev, name: newName };
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
    // ★ 2026-10-19 用户拍板 A：改完名字先探一次「这名字是不是已经有人在用」。
    //   · 只在**真改名**时探（renameFromRef 有值且新名不等于它），否则编辑一个已存在的工作流会立刻误报；
    //   · 防抖 400ms：边打字边探会打一串请求；
    //   · 结果只用于**前端提示 + 禁用保存**，真正的拦截在 storage.writeWorkflow（不可绕过）。
    // ★ 2026-10-19 用户追问「原来的名字是 12345，我改了一下还是 12345，会不会误报」——
    //   这条判据就是答案：比较对象是 `renameFromRef`（本次改动**最初的旧名**，不是磁盘内容）。
    //   所以「改走、再改回原名」时 want === from ⇒ 直接返回、**一次请求都不发**，不会自己和自己比。
    const want = String(name ?? '').trim();
    const from = renameFromRef.current;
    if (takenTimer.current) { window.clearTimeout(takenTimer.current); takenTimer.current = null; }
    if (!want || !from || want === from) { setNameTaken(false); return; }
    takenTimer.current = window.setTimeout(() => {
      takenTimer.current = null;
      fetch(`/api/dag-flow/workflows/${encodeURIComponent(want)}`, { credentials: 'include' })
        .then((r) => setNameTaken(r.ok))
        .catch(() => setNameTaken(false));       // 探测失败按"没占用"处理，交给服务端兜底
    }, 400);
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
      // ★ 导入＝同实例换了一整份工作流 ⇒ 撤销栈必须清零，否则会"撤销"到导入前那份工作流的编辑上
      //   （换工作流/进子工作流走的是 dock 重挂载，那条路由挂载时的 resetUndo 负责）
      resetUndoPending();
      handleDefChange(parsed);
      setTab('canvas');
      setImportMsg({ ok: true, text: `已导入「${parsed.name}」（${parsed.nodes.length} 节点），记得💾保存落盘` });
    } catch (e) {
      setImportMsg({ ok: false, text: `导入失败：${(e as Error).message}。请确认是工作流 JSON 文件（可先在 JSON 视图检查格式）。` });
    }
  }, [handleDefChange]);

  // ★ 2026-10-15 头部按钮重排：导入入口现在有**两处**（头部按钮 + 窄屏「⋯ 更多」菜单）⇒ 抽成一处，
  //   避免同一段 file-input 逻辑抄两份（改一处忘另一处是这类"两入口"最典型的回归）。
  const pickImportFile = useCallback(() => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = () => { const f = inp.files?.[0]; if (f) void importFile(f); };
    inp.click();
  }, [importFile]);

  return {
    saveDefToDisk, handleSaveToDisk,
    exportMenuOpen, setExportMenuOpen, exportMenuAt, setExportMenuAt,
    handleRename,
    exportFile, exportImage, exportSvg, importFile, pickImportFile,
  };
}

