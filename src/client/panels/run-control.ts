// src/client/panels/run-control.ts — 运行控制（运行 / 取消 / 结果落定 / 顶部提示）
//
// 职责：这一整块从 FlowPanel.tsx 搬出来（2026-10-19 按用户「单文件硬顶 1000 行」拆分，第 1 批）：
//   · 运行相关状态：runResults / running / cancelling / cancelTick / runAbortRef / manualRunRef
//   · 结果落定：applyRunSummary（把 /run 与 /run/resume 的 summary 统一落到界面）
//   · 运行入口：handleRun（自检 → 人工确认 → 真跑 → 600ms 逐节点点亮）
//   · 取消：cancelRun（本地 abort + 通知服务端 + 进入"取消中"）
//   · 顶部提示：importMsg（成功/失败都用**一句轻提示**，自动消失；失败的具体内容落到画布节点上）
//
// ★ 零行为变化是硬要求：搬的只是位置。所有副作用顺序、依赖数组、注释里记录的原因都原样保留。
// ★ 2026-10-19 用户拍板「画布里面不想要有运行失败的弹窗了…哪个节点失败的，就把失败信息记录到
//   对应的节点上」：删掉「运行失败详情弹窗」（dialogs/run-fail-dialog.tsx 整file 已移除）——
//   运行结束只留一句成功/失败摘要，**失败原因不在这里**（点开弹窗那一层已不存在），
//   而是由画布节点自己承载：节点徽标标红 + 悬停看悬浮卡（loop/subflow 的悬浮卡还会带出子工作流内部失败节点）。
import { useCallback, useRef, useState } from 'react';
import type { WorkflowDef } from '../types';
import { progressToStatusMap } from '../runProgress';
import { useManualDialog } from '../dialogs/manual-dialog';

export type RunNodeState = {
  status: string;
  durationMs?: number;
  count?: number;
  out?: unknown;
  error?: { code?: string; message?: string };
  tolerated?: boolean;
};

export type ImportMsg = { ok: boolean; text: string; onClick?: () => void } | null;

/** 人工确认弹窗里本 hook 用到的部分 */
export interface ManualHandle {
  manualWait: unknown;
  setManualWait: (v: any) => void;
  setManualDlgOpen: (v: boolean) => void;
  setManualNote: (v: string) => void;
  clearManualWait: () => void;
  MANUAL_STORE_KEY: string;
}

/** 自检拦截/通过弹窗里本 hook 用到的部分 */
export interface SelfcheckHandle {
  setSelfcheckState: (v: any) => void;
  setSelfcheckBlock: (v: any) => void;
}

export interface UseRunControlParams {
  def: WorkflowDef;
  dirty: boolean;
  handleSave: () => void;
  /** 宿主可能提供 onRun（优先走它；没有就直连 /run） */
  ctx: { onRun?: (() => void) | undefined };
  /** 上次运行 summary 的写入口（画布节点徽标 / 变量面板要读它；弹窗那层已删） */
  runOut: { setRunResult: (v: any) => void };
  selfcheckDlg: SelfcheckHandle;
}

export function useRunControl(p: UseRunControlParams) {
  const { def, dirty, handleSave, ctx, runOut, selfcheckDlg } = p;
  const { setSelfcheckState, setSelfcheckBlock } = selfcheckDlg;

  const [runResults, setRunResults] = useState<Record<string, RunNodeState>>({});
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
  // 手动点运行进行中（handleRun 自己轮询并落定终态）→ 后台监视让位，避免两套轮询互相覆盖
  const manualRunRef = useRef(false);
  // 顶部提示（一句摘要，成功/失败都自动消失；失败原因在画布节点上）
  const [importMsg, setImportMsg] = useState<ImportMsg>(null);

  /** 把 /run 与 /run/resume 的响应统一落到界面（两条路径的 summary 语义相同，避免重复代码） */
  const applyRunSummary = useCallback((data: any): void => {
    // 上次运行的 summary 仍要落下来：`runOuts` 靠它反推「实际有哪些变量」（面板变量选择器）。
    runOut.setRunResult({ status: data?.ok ? 'success' : 'failed', summary: data?.summary });
    // ★ 2026-10-19 用户拍板：运行结束只留一句提示，**不再弹失败详情**。
    //   失败节点数从 summary 里数出来，具体哪个节点/什么原因由节点自己承载（画布徽标 + 悬浮卡）。
    const summaryResults = data?.summary?.results as Record<string, { status?: string }> | undefined;
    const failedIds = summaryResults
      ? Object.entries(summaryResults).filter(([, r]) => r?.status === 'failed').map(([id]) => id)
      : [];
    if (data?.ok) setImportMsg({ ok: true, text: '运行成功' });
    else {
      const who = failedIds.length > 0 ? `：${failedIds.slice(0, 3).join('、')}${failedIds.length > 3 ? ` 等 ${failedIds.length} 个节点` : ''}` : '';
      setImportMsg({ ok: false, text: `运行失败${who}——失败原因悬停对应节点查看` });
    }
    const results = summaryResults as Record<string, { status?: string; durationMs?: number; out?: { count?: number }; error?: { code?: string; message?: string }; tolerated?: boolean }> | undefined;
    if (results) {
      const map: Record<string, RunNodeState> = {};
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
  }, [runOut, setImportMsg]);

  // ★ 人工确认（2026-10-03 用户拍板方案 A）：manual 节点挂起 → 头部 ⏸ 徽标 + 确认弹窗。
  //   它需要上面刚算出的 applyRunSummary 与运行态 setter，也要给 handleRun/cancelRun 提供 setter
  //   ⇒ 两头都依赖，只能在本 hook 内部调用（原来在 FlowPanel 里由解构出的原名读写，数据流不变）。
  const manualDlg = useManualDialog({
    def, applyRunSummary, setRunning, setCancelling, setCancelTick, cancellingRef, manualRunRef, runAbortRef,
  });
  const { setManualWait, setManualDlgOpen, setManualNote, clearManualWait, MANUAL_STORE_KEY } = manualDlg;

  const handleRun = useCallback(async (runOpts?: { confirmed?: boolean }) => {
    if (dirty) handleSave();
    // ★ 2026-10-19：未命名的画布不能运行（/run 以 name 定位工作流，空名必然被后端拒）——
    //   给一句人话，而不是把 400 抛到用户脸上。
    if (!String(def.name ?? '').trim()) {
      setImportMsg({ ok: false, text: '工作流还没有名字——先在上方名称框里起个名字（有名字才会自动保存并创建）' });
      return;
    }
    // AI 节点必须选模型：未选 → 不执行，给出引导
    const noModel = (def.nodes ?? []).filter((n) => n.type === 'subagent' && !String(n.params?.model ?? '').trim());
    if (noModel.length > 0) {
      setImportMsg({ ok: false, text: `以下 AI 节点未选择执行模型，未运行：${noModel.map((n) => n.id).join('、')}。点击节点 → 「选择模型」中选择后重试。` });
      return;
    }

    // ===== 第一段（2026-10-04 用户拍板）：点运行 → **先自检**，通过后人工确认才执行 =====
    if (!runOpts?.confirmed) {
      // ★ 2026-10-19 两轮定稿（用户：「自检太快，提示还没消失就弹窗，容易误解」→「如果自检需要时间比较长，
      //   删掉会不会有问题」）：改成**慢才显示**——
      //   · 自检在 400ms 内回来（真机 11 节点中位 18ms、最慢 68ms）⇒ 完全不显示中间态，直接进确认弹窗，
      //     用户看不到"闪一下"；
      //   · 超过 400ms（大工作流 / 慢机器 / 网络抖动）⇒ 才亮「自检中…」+ 转圈，避免"点了没反应像卡死"。
      const slowTimer = window.setTimeout(() => setSelfcheckState({ phase: 'checking' }), 400);
      try {
        // 耗时也写进弹窗（「本次自检用时 xx ms」），让人知道它真检过。
        const scT0 = performance.now();
        const sr = await fetch('/api/dag-flow/selfcheck', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ def }),
        });
        const sd = await sr.json().catch(() => ({}));
        if (!sr.ok) {
          setSelfcheckState(null);
          setImportMsg({ ok: false, text: `自检请求失败 HTTP ${sr.status}：${String(sd?.error ?? '').slice(0, 160)}` });
          return;
        }
        const result = {
          items: Array.isArray(sd.items) ? sd.items : [],
          errorCount: Number(sd.errorCount ?? 0),
          warnCount: Number(sd.warnCount ?? 0),
          stats: sd.stats ?? { nodes: (def.nodes ?? []).length, edges: (def.edges ?? []).length },
          ms: Math.round(performance.now() - scT0),
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
        setImportMsg({ ok: false, text: `自检失败：${(e as Error).message}` });
        return;
      } finally {
        window.clearTimeout(slowTimer);   // 回来了就别再切「自检中…」（return 路径也保证清掉）
      }
    }

    // ===== 第二段：自检通过且人工确认过了 → 真正开跑（带 skipSelfcheck:true，不再被 /run 里的自检拦一次）
    //   ★ 只有「✓ 自检通过」弹窗的「开始运行」能走到这里；自检有 error 时弹窗没有运行入口（2026-10-08）。=====
    setSelfcheckState(null);
    setRunning(true);
    manualRunRef.current = true;   // 告诉后台监视让位（手动路径自己轮询并把终态落定）
    runOut.setRunResult(null);
    setImportMsg(null);
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
        setImportMsg({ ok: false, text: `运行请求失败：${String(data?.error ?? `HTTP ${res.status}`).slice(0, 200)}` });
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
      if ((e as Error).name !== 'AbortError') {
        setImportMsg({ ok: false, text: `运行失败：${(e as Error).message}` });
      }
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
  }, [ctx, dirty, handleSave, def, applyRunSummary, MANUAL_STORE_KEY, runOut, setImportMsg, setSelfcheckState, setSelfcheckBlock, setManualWait, setManualNote, setManualDlgOpen]);

  /** 取消运行：本地 abort + 通知服务端 abort（RUN_CANCELLED）
   *  ★ 2026-10-08：进入"取消中"状态——不再立刻把 running 交还给后台监视器（它会把界面点回运行中 ✗），
   *  由监视器轮询到 host 确认结束后**浮窗提示「取消成功」**（右侧结果条不显示「已取消」✗）。 */
  const cancelRun = useCallback(() => {
    cancellingRef.current = true;
    setCancelling(true);
    setCancelTick((n) => n + 1);   // 立刻踢一次监视器轮询
    runAbortRef.current?.abort();
    void fetch(`/api/dag-flow/run?name=${encodeURIComponent(def.name)}`, { method: 'DELETE', credentials: 'include' }).catch(() => {});
    if (manualDlg.manualWait) { clearManualWait(); setManualNote(''); }
  }, [def.name, manualDlg.manualWait, clearManualWait, setManualNote]);

  return {
    runResults, setRunResults,
    running, setRunning,
    cancelling, setCancelling, cancellingRef,
    cancelTick, setCancelTick,
    runAbortRef, manualRunRef,
    importMsg, setImportMsg,
    manualDlg,
    applyRunSummary, handleRun, cancelRun,
  };
}

