// src/registry/nodes/web.ts — 网页节点：web_search / web_fetch
// 搜索/抓取引擎在 ../../adapter/search（宿主优先 + 免 key 引擎兜底）；网络错误统一 humanizeFetchError。
// 拆分自 builtin.ts（2026-10-14 重构轮 1，纯搬运）。

import type { Context, NodeDefinition, NodeResult } from '../../types.js';
import { makeResult, safeNodeRun } from '../external.js';
import { runWebSearch } from '../../adapter/search.js';
import { runWebFetch } from '../../adapter/web-fetch.js';
import type { WebSearchEngineParams } from '../../adapter/search.js';
import { humanizeFetchError } from '../../adapter/fetch-errors.js';
import { startedEnded, finish } from './shared.js';

// ---------- web_search（#搜索节点：宿主优先 + 内置免 key 引擎兜底） ----------
interface WebSearchParams {
  query: string;
  provider?: 'auto' | 'host' | 'bing' | 'ddg' | 'ddg-lite' | 'searxng' | 'anysearch';
  count?: number;
  lang?: string;
  timeRange?: 'day' | 'week' | 'month' | 'year';
  searxngInstances?: string[];
}
async function runWebSearchNode(p: WebSearchParams, ctx: Context): Promise<NodeResult> {
  const { startedAt, t0 } = startedEnded();
  // 留空不执行：query 为空（未填或上游引用解析为空）→ 节点失败并中断流程，不发网络请求
  if (!String(p.query ?? '').trim()) {
    return { ...makeResult('failed', { error: { code: 'SEARCH_EMPTY_QUERY', message: 'query 为空——搜索节点未执行，流程已在此中断。填入搜索词或检查上游输出' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }
  if (ctx.signal?.aborted) {
    return { ...makeResult('failed', { error: { code: 'RUN_CANCELLED', message: '运行已由用户取消' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }
  try {
    const outcome = await runWebSearch(
      // ★ 类型层 cast（strict 下新暴露）：count 在节点参数里可空，adapter 内部 `Math.floor(p.count) || 8` 自带默认——
      //   运行时一直如此，不能在这里注入默认值改变语义。
      { query: p.query, provider: p.provider, count: p.count, lang: p.lang, timeRange: p.timeRange, searxngInstances: p.searxngInstances } as WebSearchEngineParams,
      ctx.signal,
    );
    return finish(t0, startedAt, {
      out: { query: p.query, engine: outcome.engine, viaHost: outcome.viaHost, count: outcome.results.length, results: outcome.results } as never,
    });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    if (msg === '运行已被取消' || ctx.signal?.aborted) {
      return { ...makeResult('failed', { error: { code: 'RUN_CANCELLED', message: '搜索期间运行被取消' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    }
    return { ...makeResult('failed', { error: { code: 'SEARCH_FAILED', message: msg } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }
}
export const webSearchDef: NodeDefinition<WebSearchParams> = {
  type: 'web_search',
  schema: {
    type: 'object', required: ['query'], additionalProperties: false,
    properties: {
      query: { type: 'string', minLength: 1 },
      provider: { enum: ['auto', 'host', 'bing', 'ddg', 'ddg-lite', 'searxng', 'anysearch'] },
      count: { type: 'integer', minimum: 1, maximum: 20 },
      lang: { type: 'string' },
      timeRange: { enum: ['day', 'week', 'month', 'year'] },
      searxngInstances: { type: 'array', items: { type: 'string' } },
    },
  },
  run: async (ctx, p) => safeNodeRun(() => runWebSearchNode(p as never, ctx)),
  describe: () => ({ label: '网页搜索', category: 'io' }),
};

// ---------- web_fetch（#抓取节点：URL → 正文文本 / JSON） ----------
interface WebFetchNodeParams { url: string; maxChars?: number; timeoutMs?: number; raw?: boolean }
async function runWebFetchNode(p: WebFetchNodeParams, ctx: Context): Promise<NodeResult> {
  const { startedAt, t0 } = startedEnded();
  if (!String(p.url ?? '').trim()) {
    return { ...makeResult('failed', { error: { code: 'FETCH_NO_URL', message: 'url 为空——抓取节点未执行，流程已在此中断。填入网址或引用上游 {{u.out.url}}' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }
  if (ctx.signal?.aborted) {
    return { ...makeResult('failed', { error: { code: 'RUN_CANCELLED', message: '运行已由用户取消' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }
  try {
    const r = await runWebFetch({ url: p.url, maxChars: p.maxChars, timeoutMs: p.timeoutMs, raw: p.raw }, ctx.signal);
    return finish(t0, startedAt, {
      out: { url: r.url, status: r.status, contentType: r.contentType, mode: r.mode, chars: r.chars, ...(r.mode === 'json' ? { json: r.json as never } : { text: r.text }) } as never,
    });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    if (msg === '运行已被取消' || ctx.signal?.aborted) {
      return { ...makeResult('failed', { error: { code: 'RUN_CANCELLED', message: '抓取期间运行被取消' } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    }
    if ((e as Error).name === 'FetchTimeout') {
      return { ...makeResult('failed', { error: { code: 'FETCH_TIMEOUT', message: msg } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
    }
    return { ...makeResult('failed', { error: { code: 'FETCH_FAILED', message: humanizeFetchError(e) } }), durationMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString() };
  }
}
export const webFetchDef: NodeDefinition<WebFetchNodeParams> = {
  type: 'web_fetch',
  schema: {
    type: 'object', required: ['url'], additionalProperties: false,
    properties: {
      url: { type: 'string', minLength: 1 },
      maxChars: { type: 'integer', minimum: 200, maximum: 200_000 },
      timeoutMs: { type: 'integer', minimum: 1000, maximum: 300_000 },
      raw: { type: 'boolean' },
    },
  },
  run: async (ctx, p) => safeNodeRun(() => runWebFetchNode(p as never, ctx)),
  describe: () => ({ label: '网页抓取', category: 'io' }),
};
