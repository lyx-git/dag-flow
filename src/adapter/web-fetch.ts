// src/adapter/web-fetch.ts — web_fetch 抓取引擎（URL → 正文文本 / JSON / raw）
// 与搜索引擎（./search.ts）共用 UA / 语言头 / 实体解码（从那边导入，依赖单向：本文件 → search.ts）。
// 2026-10-14 重构轮 3 自 search.ts 纯搬运拆出。

import { USER_AGENT, ACCEPT_LANG, decodeEntities } from './search.js';

interface WebFetchParams {
  url: string;
  maxChars?: number;
  timeoutMs?: number;
  raw?: boolean;
}

interface WebFetchOutcome {
  url: string;
  status: number;
  contentType: string;
  mode: 'text' | 'json' | 'raw';
  text?: string;
  json?: unknown;
  chars: number;
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|li|tr|h[1-6]|br)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

export async function runWebFetch(p: WebFetchParams, signal?: AbortSignal): Promise<WebFetchOutcome> {
  const timeoutMs = Math.max(1000, Math.min(300_000, p.timeoutMs ?? 30_000));
  const maxChars = Math.max(200, Math.min(200_000, Math.floor(p.maxChars ?? 8000)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const response = await fetch(p.url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'accept-language': ACCEPT_LANG },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}（${p.url.split('?')[0]}）`);
    }
    const contentType = String(response.headers.get('content-type') ?? '');
    const body = await response.text();
    if (p.raw) {
      return { url: p.url, status: response.status, contentType, mode: 'raw', text: body.slice(0, maxChars), chars: Math.min(body.length, maxChars) };
    }
    if (/\bjson\b/i.test(contentType)) {
      let json: unknown;
      try {
        json = JSON.parse(body);
      } catch {
        // content-type 标了 json 但解析失败 → 按文本处理
        const text = body.slice(0, maxChars);
        return { url: p.url, status: response.status, contentType, mode: 'text', text, chars: text.length };
      }
      return { url: p.url, status: response.status, contentType, mode: 'json', json: json as never, chars: body.length };
    }
    const text = htmlToText(body).slice(0, maxChars);
    return { url: p.url, status: response.status, contentType, mode: 'text', text, chars: text.length };
  } catch (error) {
    if ((error as Error).name === 'AbortError' || signal?.aborted) {
      if (signal?.aborted) throw new Error('运行已被取消');
      const timeoutErr = new Error(`网页抓取超时（${timeoutMs}ms）——增大 timeoutMs 或稍后重试`);
      timeoutErr.name = 'FetchTimeout';
      throw timeoutErr;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
