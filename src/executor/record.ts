// src/executor/record.ts — run record 落盘 + show（SQLite via storage.ts）

import { createStorage } from '../adapter/storage.js';
import type { RunSummary } from './run.js';

const storage = createStorage();

export async function writeRunRecord(summary: RunSummary): Promise<string> {
  const runId = summary.runId;
  await storage.writeRunRecord(runId, summary);
  return runId;
}

export async function showWorkflow(name: string): Promise<string> {
  const def = await storage.readWorkflow(name);
  if (!def) return `工作流不存在: ${name}`;
  return JSON.stringify(def, null, 2);
}

export async function listRuns(workflowName?: string): Promise<string[]> {
  return storage.listRunRecords(workflowName);
}

export async function showRun(runId: string): Promise<string> {
  const rec = await storage.readRunRecord(runId);
  if (!rec) return `运行记录不存在: ${runId}`;
  return JSON.stringify(rec, null, 2);
}
