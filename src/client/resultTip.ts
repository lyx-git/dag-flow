// src/client/resultTip.ts — 节点「最终执行结果」悬浮卡的内容模型（纯函数，可离线单测）
//
// 需求（2026-10-03 用户原话）：「每个节点执行完最好有个最终执行结果可以在节点上看，无论失败还是成功，
//   方便定位，可以是悬浮查看」。
//
// 为什么抽成纯函数：内容是「运行结果 → 文案」的映射（状态文案 / 容错标注 / 截断），单测它比在 CDP 里
// 读 DOM 稳定得多（DOM 断言只用于证明"真的弹出来了"）。
import type { RunStatusItem } from './flowgram/runStatus';

export interface TipLine {
  text: string;
  kind: 'err' | 'warn' | 'muted' | 'code' | 'normal';
}

export interface TipModel {
  title: string;
  badge: string;
  badgeKind: 'ok' | 'err' | 'warn' | 'muted';
  lines: TipLine[];
}

const OUT_PREVIEW_MAX = 800;
const ERR_PREVIEW_MAX = 400;

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** 输出预览：字符串原样（python/bash 的 out 就是纯文本），其它值 JSON 美化；超长截断并注明总长 */
export function previewOut(out: unknown): string {
  if (out === undefined || out === null) return '';
  let s: string;
  if (typeof out === 'string') s = out;
  else {
    try { s = JSON.stringify(out, null, 2) ?? String(out); }
    catch { s = String(out); }
  }
  if (s.length > OUT_PREVIEW_MAX) return `${s.slice(0, OUT_PREVIEW_MAX)}\n…（共 ${s.length} 字，完整内容见运行历史）`;
  return s;
}

/** 悬浮卡全文（📋 复制按钮复制的内容；用户手动选中复制的也是这一份文本）。
 *  ★ 2026-10-03 用户反馈：「无法将鼠标移动到报错的浮窗上去，无法复制错误信息」——所以浮窗
 *  必须可悬停（延迟隐藏）并给出一键复制。 */
export function tipFullText(m: TipModel): string {
  return [m.title, m.badge, ...m.lines.map((l) => l.text)].join('\n');
}

/** 悬浮卡内容；``item`` 为空（本次运行没有该节点结果）→ 返回 null（不弹）。 */
export function tipModel(item: RunStatusItem | undefined, opts: { label: string; id: string }): TipModel | null {
  if (!item) return null;
  const status = item.status;
  const tolerated = item.tolerated === true;
  const ms = item.durationMs != null ? ` · ${Math.round(item.durationMs)}ms` : '';
  const badge = status === 'success' ? `✓ 成功${ms}`
    : status === 'skipped' ? '○ 跳过（未执行）'
      : tolerated ? `⚠ 失败（已容错）${ms}` : `✕ 失败${ms}`;
  const badgeKind: TipModel['badgeKind'] = status === 'success' ? 'ok'
    : status === 'skipped' ? 'muted'
      : tolerated ? 'warn' : 'err';

  const lines: TipLine[] = [];
  if (item.error) {
    lines.push({ kind: 'err', text: `${item.error.code ?? 'ERROR'}：${clip(item.error.message ?? '', ERR_PREVIEW_MAX)}` });
  }
  if (tolerated) {
    lines.push({ kind: 'warn', text: '已容错：本节点失败被放行，后续节点照常执行（这次没有中断工作流）' });
  }
  // ★ 2026-10-04 用户反馈「定时任务自动触发的运行，手动确认节点自动跳过」→ 拍板显形（不是失败、也不是有人确认过）
  const autoPassed = !!(item.out && typeof item.out === 'object' && (item.out as { autoPassed?: boolean }).autoPassed === true);
  if (autoPassed) {
    lines.push({
      kind: 'warn',
      text: '⏭ 自动通过：这次是非交互运行（定时触发 / 「立即运行一次」/ CLI / 子工作流内部），没人能确认，'
        + 'manual 节点被直接放行——不是失败，也不代表有人确认过。要人工把关就在画布上点 ▶ 运行。',
    });
  }
  if (status === 'skipped') {
    lines.push({ kind: 'muted', text: '未执行：所在分支未激活，或上游失败后被跳过' });
  }
  if (typeof item.count === 'number') {
    lines.push({ kind: 'normal', text: `循环迭代：${item.count} 次` });
  }
  const preview = previewOut(item.out);
  if (preview) lines.push({ kind: 'code', text: preview });
  else if (status === 'success') lines.push({ kind: 'muted', text: '（本次无输出）' });

  return { title: `${opts.label} · ${opts.id}`, badge, badgeKind, lines };
}
