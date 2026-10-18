// src/registry/nodes/io.ts — 数据出入口节点：session_input / http / file_save
// 会话读取走 ../../adapter/sessions；产物落盘走 ../../adapter/assets（.dag-flow/ 产出目录，同名自动改名）。
// 拆分自 builtin.ts（2026-10-14 重构轮 1，纯搬运）。

import type { NodeDefinition, NodeResult, JsonValue } from '../../types.js';
import { makeResult, safeNodeRun } from '../external.js';
import { readSessionContent } from '../../adapter/sessions.js';
import { saveAsset, downloadAsset } from '../../adapter/assets.js';
import { humanizeFetchError } from '../../adapter/fetch-errors.js';
import { startedEnded, finish } from './shared.js';

// ---------- session_input（会话输入） ----------
interface SessionInputParams { sessionId: string; limit?: number; workspace?: string }
async function runSessionInput(p: SessionInputParams): Promise<NodeResult> {
  const { startedAt, t0 } = startedEnded();
  if (!p.sessionId) {
    return { ...makeResult('failed', { error: { code: 'SESSION_INPUT_NO_ID', message: 'sessionId 为空——请选择要读取的会话' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }
  const limit = Math.max(1, Math.min(500, p.limit ?? 10));
  try {
    const content = await readSessionContent(p.sessionId, limit, p.workspace);
    if (content === null) {
      return { ...makeResult('failed', { error: { code: 'SESSION_INPUT_NOT_FOUND', message: `会话不存在: ${p.sessionId}` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    }
    return finish(t0, startedAt, { out: content });
  } catch (e) {
    return { ...makeResult('failed', { error: { code: 'SESSION_INPUT_READ', message: `读取会话失败: ${(e as Error).message}` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }
}

export const sessionInputDef: NodeDefinition<SessionInputParams> = {
  type: 'session_input',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      sessionId: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      workspace: { type: 'string' },
    },
  },
  run: async (_ctx, p) => safeNodeRun(() => runSessionInput(p)),
  describe: () => ({ label: '会话输入', category: 'ai' }),
};

// ---------- http ----------
interface HttpParams { method?: string; url: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }
async function runHttp(p: HttpParams): Promise<NodeResult> {
  const { startedAt, t0 } = startedEnded();
  const timeoutMs = p.timeoutMs ?? 30_000;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(p.url, {
      method: p.method ?? 'GET',
      headers: p.headers,
      body: p.body,
      signal: ac.signal,
    });
    const text = await r.text();
    let body: JsonValue = text;
    try { body = JSON.parse(text) as JsonValue; } catch { /* keep text */ }
    return finish(t0, startedAt, { out: { status: r.status, body } });
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      return { ...makeResult('failed', { error: { code: 'HTTP_TIMEOUT', message: `请求超时（${timeoutMs}ms）` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    }
    return { ...makeResult('failed', { error: { code: 'HTTP_ERROR', message: humanizeFetchError(e) } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  } finally {
    clearTimeout(t);
  }
}
export const httpDef: NodeDefinition<HttpParams> = {
  type: 'http',
  schema: {
    type: 'object', required: ['url'], additionalProperties: false,
    properties: {
      method: { enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] },
      url: { type: 'string', minLength: 1 },
      headers: { type: 'object', additionalProperties: { type: 'string' } },
      body: { type: 'string' },
      timeoutMs: { type: 'integer', minimum: 1, maximum: 600_000 },
    },
  },
  run: async (_ctx, p) => safeNodeRun(() => runHttp(p)),
  describe: () => ({ label: 'HTTP', category: 'io' }),
};

// ---------- file_save（#多模态：内容/URL 落盘为 .dag-flow/ 下的产出文件） ----------
interface FileSaveParams { source?: 'text' | 'base64' | 'url'; content?: string; url?: string; filename: string }
export const fileSaveDef: NodeDefinition<FileSaveParams> = {
  type: 'file_save',
  schema: {
    type: 'object', required: ['filename'], additionalProperties: false,
    properties: {
      source: { enum: ['text', 'base64', 'url'] },
      content: { type: 'string' },
      url: { type: 'string' },
      filename: { type: 'string', minLength: 1 },
    },
  },
  run: async (ctx, p) => {
    const { startedAt, t0 } = startedEnded();
    const source = p.source ?? (p.url ? 'url' : 'text');
    try {
      if (source === 'url') {
        if (!p.url?.trim()) return { ...makeResult('failed', { error: { code: 'FILE_NO_URL', message: 'url 为空——填要下载的文件地址（可引用上游 {{u.out.url}}）' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
        const saved = await downloadAsset(p.url, p.filename, undefined, ctx.runDir);
        return finish(t0, startedAt, { out: { path: saved.relativePath, ...saved, source: 'url' } });
      }
      if (source === 'base64' && !p.content) return { ...makeResult('failed', { error: { code: 'FILE_NO_CONTENT', message: 'base64 内容为空' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
      if (source === 'text' && !p.content?.trim()) return { ...makeResult('failed', { error: { code: 'FILE_NO_CONTENT', message: 'content 为空——填文件内容（可引用上游 {{u.out.xxx}}）' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
      const saved = await saveAsset(p.filename, p.content ?? '', source === 'base64' ? 'base64' : 'utf8', ctx.runDir);
      return finish(t0, startedAt, { out: { path: saved.relativePath, ...saved, source, ...(source === 'text' ? { preview: String(p.content).slice(0, 200) } : {}) } });
    } catch (e) {
      return { ...makeResult('failed', { error: { code: 'FILE_SAVE_ERROR', message: `${(e as Error).message}（检查 filename 是否含非法字符）` } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    }
  },
  describe: () => ({ label: '文件保存', category: 'media' }),
};
