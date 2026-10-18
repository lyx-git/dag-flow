// src/client/run-result.ts — 「上次运行结果」状态（画布节点徽标 / 变量面板的「实际有哪些变量」读它）
//
// 历史：这份状态原先是「运行失败详情弹窗」hook（dialogs/run-fail-dialog.tsx）的一部分。
// ★ 2026-10-19 用户拍板：「画布里面不想要有运行失败的弹窗了……哪个节点失败的，就把失败信息记录到
//   对应的节点上……失败具体内容全部放到具体节点上」——弹窗 UI 与其状态都已整体删除，
//   这里只保留 summary 这一份数据（`runOuts` 反推变量、节点悬浮卡等仍在用）。
import { useState } from 'react';

export type RunSummaryLite = {
  status?: string;
  results?: Record<string, {
    status?: string;
    durationMs?: number;
    out?: unknown;
    error?: { code?: string; message?: string };
    tolerated?: boolean;
  }>;
};

export type RunResultState = { status: string; summary?: RunSummaryLite; error?: string } | null;

export function useRunResult() {
  const [runResult, setRunResult] = useState<RunResultState>(null);
  return { runResult, setRunResult };
}

/** 供运行控制 hook 用的最小写入口（只需要 setter） */
export interface RunResultHandle {
  setRunResult: (v: RunResultState) => void;
}
