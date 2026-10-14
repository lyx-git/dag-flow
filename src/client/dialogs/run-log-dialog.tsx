// src/client/dialogs/run-log-dialog.tsx — 🧾 运行日志弹窗（hook + 渲染对）
// 状态（log* 8 个 + 2 ref）、fetchRunLog、3 个轮询 effect 与 logView/logProblemCount 在 useRunLogDialog
//（**在 FlowPanel 里调用** ⇒ 状态仍活在面板实例上；「运行刚结束补拉一次」effect 的 running 经入参传入，行为不变）；
// RunLogDialogView 只负责渲染。2026-10-14 弹窗专项批 2+3 自 FlowPanel.tsx 纯搬运拆出。

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkflowDef } from '../types';
import { dataPathRow, fmtLogValue, fmtRefs, joinDisplay, logEntryText, logSearchText, logStatusLabel, runLogText } from '../panel-utils';

type ImportMsg = { ok: boolean; text: string; onClick?: () => void } | null;

/** 运行日志（2026-10-04）：🧾 弹窗的开关与数据（条目来自 GET /run/log，运行中自动刷新） */
export function useRunLogDialog({ def, running }: { def: WorkflowDef; running: boolean }) {
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
  return { logOpen, setLogOpen, logEntries, logMeta, logDir, logBusy, logFilter, setLogFilter, logScope, setLogScope, logExpanded, setLogExpanded, fetchRunLog, logView, logProblemCount };
}

export function RunLogDialogView({ d, def, setSelectedNodeId, setImportMsg }: {
  d: ReturnType<typeof useRunLogDialog>;
  def: WorkflowDef;
  setSelectedNodeId: (id: string) => void;
  setImportMsg: (m: ImportMsg) => void;
}) {
  if (!d.logOpen) return null;
  return createElement(
    'div',
    { className: 'dag-flow-picker-overlay', onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) d.setLogOpen(false); } },
    createElement(
      'div',
      { className: 'dag-flow-picker dsh-wf-logdlg' },
      createElement('div', { className: 'dag-flow-picker-title', style: { fontSize: 16 } },
        '🧾 运行日志',
        createElement('button', { className: 'dag-flow-picker-close', title: '关闭', onClick: () => d.setLogOpen(false) }, '✕'),
      ),
      createElement('div', { className: 'dag-flow-picker-body' },
        createElement('div', { className: 'dag-flow-picker-hint', style: { fontSize: 11, opacity: 0.72 } },
          d.logMeta?.error
            ? `日志读取失败：${d.logMeta.error}（先运行一次工作流，或点「🔄 刷新」重试）`
            : `工作流「${def.name}」${d.logMeta?.runId ? ` · ${d.logMeta.runId}` : ''} · 状态 ${logStatusLabel(d.logMeta?.runStatus)} · ${d.logEntries.length} 个节点${d.logMeta?.live ? ' · 运行中，自动刷新' : ''}`
              + (d.logScope === 'problem'
                // ★ 2026-10-09：过滤生效时把"藏了多少条"也写出来，避免用户以为日志丢了 ✓
                ? ` · 已过滤：只看失败/跳过（显示 ${d.logView.length} 条，隐藏 ${Math.max(0, d.logEntries.length - d.logView.length)} 条）`
                : '')),
        // ★ 2026-10-11 用户需求：运行日志弹窗也要标记数据存放位置 + 点击打开文件夹
        //   运行记录落盘在 .dag-flow/runs/<runId>.json（画布节点的入参/出参就是从这些记录读的）
        dataPathRow(
          d.logDir ? joinDisplay(d.logDir, `${d.logMeta?.runId ?? '<runId>'}.json`) : '<DSH_HOME>/.dag-flow/runs/<runId>.json',
          'runs',
          (m: string) => setImportMsg({ ok: false, text: m }),
        ),
        createElement('div', { className: 'dsh-wf-log-toolbar' },
          createElement('button', { className: 'dsh-wf-btn', title: '重新拉取日志', onClick: () => void d.fetchRunLog() }, d.logBusy ? '⏳ 刷新中' : '🔄 刷新'),
          // ★ 只看失败/跳过（2026-10-04 便利性：大图排查时不必在几十条里翻）
          //   ★ 2026-10-09 用户反馈"选择或取消按钮状态没变化" → 三处强化可见性：
          //   ① 图标随状态切换（⚠ ↔ ✓）；② 文案带**命中条数**；③ 用 is-on 激活态 + aria-pressed
          createElement('button', {
            className: `dsh-wf-btn${d.logScope === 'problem' ? ' is-on' : ''}`,
            'aria-pressed': d.logScope === 'problem',
            title: d.logScope === 'problem'
              ? '已开启：只看失败与跳过的节点（再点一下恢复全部）'
              : '只看失败与跳过的节点（大图排查用）',
            onClick: () => d.setLogScope((v) => (v === 'problem' ? 'all' : 'problem')),
          }, `${d.logScope === 'problem' ? '✓' : '⚠'} 只看失败/跳过（${d.logProblemCount}）`),
          createElement('input', {
            className: 'dsh-wf-log-search',
            value: d.logFilter,
            placeholder: '搜索节点 / 参数 / 出参…',
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => d.setLogFilter(e.target.value),
          }),
          createElement('button', {
            className: 'dsh-wf-btn',
            title: '复制全部日志文本（便于反馈问题）',
            disabled: d.logEntries.length === 0,
            onClick: async () => {
              try {
                await navigator.clipboard.writeText(runLogText(d.logView));
                setImportMsg({ ok: true, text: '全部日志已复制到剪贴板' });
              } catch { setImportMsg({ ok: false, text: '复制失败——请手动选中文本复制' }); }
            },
          }, '📋 复制全部'),
        ),
        createElement('div', { className: 'dsh-wf-log-list' },
          d.logView.length === 0
            ? createElement('div', { className: 'dag-flow-picker-hint', style: { fontSize: 11.5, opacity: 0.6, padding: '14px 2px' } },
                d.logEntries.length === 0 ? '暂无日志——点「▶」跑一次工作流后回来看。' : '没有匹配的节点（清空搜索框试试）。')
            : d.logView.map((e: any) => {
              const open = !!d.logExpanded[e.id];
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
                    d.setLogExpanded((m) => ({ ...m, [e.id]: !m[e.id] }));
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
  );
}
