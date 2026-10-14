// src/client/dialogs/schedule-dialog.tsx — ⏰ 定时任务弹窗 + ▶ 立即运行确认弹窗（hook + 渲染对）
// 状态（sched* 10 个 + ref）与全部 handlers 在 useSchedulesDialog（**在 FlowPanel 里调用** ⇒ 状态仍活在面板实例上，
// 后台运行监视 effect 经 FlowPanel 解构出的 schedOpen/loadSchedules 照常读写，零数据流变化）；
// SchedulesDialogView / ScheduleRunConfirmView 只负责渲染。2026-10-14 弹窗专项批 2+3 自 FlowPanel.tsx 纯搬运拆出。

import { createElement, useCallback, useRef, useState } from 'react';
import type { WorkflowDef } from '../types';
import { ensurePickerStyles } from '../workflow-picker';
import { cronError, describeCron } from '../../adapter/cron';
import { dataPathRow, fmtAgo, fmtLastRun, fmtWhen } from '../panel-utils';

type ImportMsg = { ok: boolean; text: string; onClick?: () => void } | null;

/** 定时任务弹窗（⏰，2026-10-03 用户拍板方案 v1）：与工作流参数弹窗同一套弹窗约定；
 *  配置存宿主侧 .dag-flow/schedules.json，到点由宿主调度器执行（dsh web 需常驻）。 */
export function useSchedulesDialog({ def, setImportMsg }: {
  def: WorkflowDef;
  setImportMsg: (m: ImportMsg) => void;
}) {
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
  //   由 ScheduleRunConfirmView 渲染。流程拆两步：askRunScheduleNow（弹确认）→ doRunScheduleNow（真发请求）。
  const [schedConfirm, setSchedConfirm] = useState<any | null>(null);
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
  return {
    schedOpen, schedItems, schedInfo, schedDir, schedNote, schedBad, schedDraft, setSchedDraft,
    manualCount, loadSchedules, openSchedules, patchScheduleLocal,
    schedCronOf, schedDirty, saveSchedCron, requestCloseSched, addSchedule, removeSchedule,
    schedRunningId, askRunScheduleNow, doRunScheduleNow, schedConfirm, setSchedConfirm,
  };
}

export function SchedulesDialogView({ d, defName, setImportMsg }: {
  d: ReturnType<typeof useSchedulesDialog>;
  defName: string;
  setImportMsg: (m: ImportMsg) => void;
}) {
  if (!d.schedOpen) return null;
  return createElement(
    'div',
    {
      className: 'dag-flow-picker-overlay',
      onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) d.requestCloseSched(); },
    },
    createElement(
      'div',
      { className: 'dag-flow-picker dsh-wf-sched' },
      createElement('div', { className: 'dag-flow-picker-title', style: { fontSize: 16 } },
        '⏰ 定时任务',
        createElement('span', { className: 'dsh-wf-sched-title-wf' }, defName),
        createElement('button', {
          className: 'dag-flow-picker-close', title: '关闭',
          onClick: () => d.requestCloseSched(),
        }, '✕'),
      ),
      createElement('div', { className: 'dag-flow-picker-body' },
        // 黄色费用提示（无人值守真花钱，必须写明）
        createElement('div', { className: 'dsh-wf-sched-warn' },
          '⚠ 定时执行会真实运行工作流：AI / 图片 / 视频节点会产生费用；执行期间不等人确认（manual 节点自动通过）。'),
        // ★ 2026-10-04 用户反馈「定时任务自动触发的运行，手动确认节点自动跳过」→ 拍板 A：保持自动通过，但**显形**。
        //   只要本工作流含 manual 节点，就在弹窗里说清"不会停下来等确认"，并告诉用户哪种入口才会等。
        d.manualCount > 0
          ? createElement('div', { className: 'dsh-wf-sched-note' },
              `⏭ 本工作流含 ${d.manualCount} 个「人工确认」节点：定时触发（含下方「▶ 立即运行一次」）不会停下来等确认，`
              + 'manual 节点会自动通过（画布徽标与悬浮结果会标「⏭ 自动通过」）。要人工把关请在画布上点 ▶ 运行。')
          : null,
        // 调度器心跳：dsh web 不常驻就不会触发，必须让用户看见
        createElement('div', { className: `dsh-wf-sched-beat${d.schedInfo?.running ? ' is-on' : ''}` },
          d.schedInfo?.running
            ? `● 调度器运行中（心跳 ${fmtAgo(d.schedInfo?.lastTickAt)}，每 ${Math.round((d.schedInfo?.tickMs ?? 20000) / 1000)}s 检查一次；本机时区）`
            : '○ 调度器未运行——需要 dsh web 常驻，定时才会触发'),
        // ★ 2026-10-11 用户需求：定时任务弹窗也要标记数据存放位置，且点一下直接打开文件夹
        //   （schedules.json 就在 .dag-flow 根下 → sub 传空串开根目录；旧 host 无 dir 字段时回退通用路径）
        dataPathRow(
          d.schedDir || '<DSH_HOME>/.dag-flow/schedules.json',
          '',
          (m: string) => setImportMsg({ ok: false, text: m }),
        ),
        d.schedNote ? createElement('div', { className: 'dag-flow-picker-hint', style: { fontSize: 11, opacity: 0.72 } }, d.schedNote) : null,
        createElement('div', { className: 'dsh-wf-sched-list' },
          d.schedItems.length
            ? d.schedItems.map((it) => {
              const cur = d.schedCronOf(it);   // ★ 草稿优先：预览与校验都按"编辑中的值"算（所见即所存）
              const dirty = d.schedDirty(it);
              const bad = cronError(cur);
              const err = d.schedBad[it.id] || bad || '';
              return createElement('div', { key: it.id, className: `dsh-wf-sched-item${it.enabled === false ? ' is-off' : ''}` },
                createElement('div', { className: 'dsh-wf-sched-row' },
                  createElement('span', { className: 'dsh-wf-sched-ico' }, '⏰'),
                  // ★ 2026-10-04 用户拍板：cron 改成**手动确认生效**——敲键只改草稿（描黄边），点「保存」才落盘
                  createElement('input', {
                    className: `dsh-wf-input dsh-wf-sched-cron${dirty ? ' is-dirty' : ''}${bad ? ' is-bad' : ''}`,
                    value: cur,
                    placeholder: '分 时 日 月 周，如 0 9 * * 1-5',
                    title: '标准 5 字段 cron：分 时 日 月 周；支持 * , - /（不支持 L W # 与秒级）\n改完点右侧「保存」才生效（回车也可保存）',
                    onChange: (e: React.ChangeEvent<HTMLInputElement>) => d.setSchedDraft((m) => ({ ...m, [it.id]: e.target.value })),
                    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
                      if (e.key === 'Enter' && dirty && !bad) d.saveSchedCron(it);
                    },
                  }),
                  // 「保存」：没改动或表达式非法时禁用（三态见原型）
                  createElement('button', {
                    className: `dsh-wf-btn dsh-wf-sched-save${dirty && !bad ? ' is-ready' : ''}`,
                    disabled: !dirty || !!bad,
                    title: !dirty ? '没有改动' : (bad ? '表达式不合法，先改对再保存' : '保存这次修改（立即生效）'),
                    onClick: () => d.saveSchedCron(it),
                  }, '保存'),
                  // ★ 2026-10-04 用户要求：「▶ 立即运行一次」不要单独占第二行，放在 cron 表达式右边
                  createElement('button', {
                    className: 'dsh-wf-btn dsh-wf-sched-run',
                    disabled: d.schedRunningId === it.id,
                    title: '立刻真实执行一次（等价于到点触发，会花钱）',
                    onClick: () => d.askRunScheduleNow(it),
                  }, d.schedRunningId === it.id ? '运行中…' : '▶ 立即运行一次'),
                  createElement('span', { className: `dsh-wf-sched-preview${bad ? ' is-bad' : ''}` },
                    bad ? '⚠ 表达式不合法' : describeCron(cur)),
                  // ★ 2026-10-04 用户拍板：启用/停用**不用勾选框**，改单按钮切换（图标 ●/○，点一下即生效）
                  createElement('button', {
                    className: `dsh-wf-sched-state${it.enabled === false ? ' is-off' : ''}`,
                    title: it.enabled === false ? '当前已停用，点击启用（立即生效）' : '当前已启用，点击停用（立即生效）',
                    onClick: () => d.patchScheduleLocal(it.id, { enabled: it.enabled === false }),
                  }, it.enabled === false ? '○ 已停用' : '● 启用中'),
                  createElement('button', {
                    className: 'dsh-wf-btn', title: '删除该定时（不影响其它定时）',
                    onClick: () => void d.removeSchedule(it.id),
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
          onClick: d.addSchedule,
        }, '＋ 添加定时'),
        createElement('div', { className: 'dsh-wf-sched-foot' },
          '配置存在 <DSH_HOME>/.dag-flow/schedules.json；cron 为本机时区的「分 时 日 月 周」；cron 改完点行内「保存」才生效。',
          createElement('br'),
          '同一工作流上一次没跑完时，本次会跳过并记「⏭ 本次跳过」；dsh 重启后不补跑错过的档期。'),
      ),
    ),
  );
}

/** ▶ 立即运行一次：**应用内**二次确认弹窗（2026-10-04 用户反馈：原来是 Windows 原生 confirm）
 *  与其它弹窗同一套约定：右上 ✕、hint 小字浅色、底部左「取消」右「主操作」；费用提醒用黄色条。 */
export function ScheduleRunConfirmView({ d, defName }: {
  d: ReturnType<typeof useSchedulesDialog>;
  defName: string;
}) {
  const schedConfirm = d.schedConfirm;
  if (!schedConfirm) return null;
  return createElement(
    'div',
    {
      className: 'dag-flow-picker-overlay',
      onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) d.setSchedConfirm(null); },
    },
    createElement(
      'div',
      { className: 'dag-flow-picker dsh-wf-sched-confirm' },
      createElement('div', { className: 'dag-flow-picker-title', style: { fontSize: 16 } },
        '▶ 立即运行一次？',
        createElement('button', {
          className: 'dag-flow-picker-close', title: '关闭（不运行）',
          onClick: () => d.setSchedConfirm(null),
        }, '✕'),
      ),
      createElement('div', { className: 'dag-flow-picker-body' },
        createElement('div', { className: 'dsh-wf-sched-warn' },
          `⚠ 会真实执行工作流「${String(schedConfirm.workflow ?? defName)}」：AI / 图片 / 视频节点会产生费用。`),
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
            onClick: () => d.setSchedConfirm(null),
          }, '✕ 取消'),
          createElement('span', { className: 'dsh-wf-manual-grow' }),
          createElement('button', {
            className: 'dsh-wf-btn dsh-wf-btn-primary',
            onClick: () => { const it = schedConfirm; d.setSchedConfirm(null); void d.doRunScheduleNow(it); },
          }, '▶ 确认运行'),
        ),
      ),
    ),
  );
}
