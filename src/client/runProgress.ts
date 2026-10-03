// src/client/runProgress.ts — 「运行进度」→ 每个节点的画布状态（纯函数，离线可测）
//
// 需求（2026-10-03 用户原话）：「工作流运行的时候，画布中的每个节点都要有状态，待运行，运行中，执行完成，
//   执行失败，要按照工作流的运行路径依次显示，不要最后一次性显示状态，中间状态都没有」。
//
// 数据来源：GET /run/status?name=<工作流名>（宿主 ActiveRun 里累积的逐节点结果 + 正在执行的节点 id）。
//   · 有结果        → 用结果的 status（success / failed / skipped）
//   · 在 running 里  → 'running'（运行中）
//   · 其余          → 'pending'（待运行）
// 轮询只是"过程态"；最终态仍以 POST /run 返回的 summary 为准（applyRunSummary 会覆盖）。
import type { RunStatusItem } from './flowgram/runStatus';

export interface ProgressNodeResult {
  status?: string;
  durationMs?: number;
  out?: unknown;
  error?: { code?: string; message?: string };
  tolerated?: boolean;
  /** ★ 宿主显式给的 loop 迭代次数（out 被裁剪成字符串时，客户端仍能显示「循环 N 次」徽标） */
  count?: number;
}

export interface ProgressSnapshot {
  results?: Record<string, ProgressNodeResult> | null;
  running?: string[] | null;
}

/** 把进度快照映射成「节点 id → 画布状态」；只输出 nodeIds 里给出的节点（别的 id 忽略） */
export function progressToStatusMap(nodeIds: string[], snap: ProgressSnapshot): Record<string, RunStatusItem> {
  const out: Record<string, RunStatusItem> = {};
  const results = snap?.results ?? {};
  const running = new Set(snap?.running ?? []);
  for (const id of nodeIds) {
    const r = results[id];
    if (r && r.status) {
      // 迭代次数：优先用宿主显式字段（out 可能被截断成字符串），退回 out.count（最终 summary 的形状）
      const count = typeof r.count === 'number' ? r.count : (r.out as { count?: number } | undefined)?.count;
      out[id] = {
        status: r.status,
        ...(r.durationMs != null ? { durationMs: r.durationMs } : {}),
        ...(typeof count === 'number' ? { count } : {}),
        ...(r.out !== undefined ? { out: r.out } : {}),
        ...(r.error ? { error: r.error } : {}),
        ...(r.tolerated ? { tolerated: true } : {}),
      };
    } else if (running.has(id)) {
      out[id] = { status: 'running' };
    } else {
      out[id] = { status: 'pending' };
    }
  }
  return out;
}

/** 运行中/待运行是否算「过程态」（用于判断画布是否该显示未完成状态） */
export function isTransientStatus(status: string | undefined): boolean {
  return status === 'pending' || status === 'running';
}
