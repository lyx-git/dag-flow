// src/adapter/search.ts — web_search / web_fetch 引擎层
//
// 引擎适配器移植自 dsh-free-search 0.4.36（MIT License，© DDDMUC，github.com/DDDMUC/dsh-free-search），
// 按 MIT 许可携带版权声明；只移植 5 个免 key 引擎（bing / ddg-lite / ddg / searxng / anysearch）
// 及其配套的抓取、反爬检测、重试、清洗工具函数（方案 C「宿主优先 + 内置兜底」）。
//
// 宿主优先：宿主装了 dsh-free-search 插件时，provider=auto 先尝试走宿主注册的 web_search 工具
// （自动继承用户在宿主侧配置的付费引擎/密钥/安全搜索等偏好）；任何失败（未装/调用异常/结果
// 无法识别）都静默回落内置免 key 引擎链，保证任何 DSH 环境零配置可用。

import { hostService } from './safety.js';

export interface SearchSource {
  url: string;
  title?: string;
  snippet?: string;
  publishedAt?: string;
}

export interface SearchOutcome {
  results: SearchSource[];
  engine: string;
  viaHost: boolean;
}

export interface WebSearchEngineParams {
  query: string;
  count: number;
  provider?: string;
  lang?: string;
  timeRange?: string;
  searxngInstances?: string[];
}

// ---------- 常量（与 dsh-free-search 对齐） ----------
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const ACCEPT_LANG = 'zh-CN,zh;q=0.9,en;q=0.8';

// 语言 → Bing 本地化档案：{ market, acceptLang }
const LANG_PROFILES: Record<string, { market: string; acceptLang: string }> = {
  zh: { market: 'zh-CN', acceptLang: 'zh-CN,zh;q=0.9,en;q=0.8' },
  en: { market: 'en-US', acceptLang: 'en-US,en;q=0.9' },
  ru: { market: 'ru-RU', acceptLang: 'ru-RU,ru;q=0.9,en;q=0.8' },
  ja: { market: 'ja-JP', acceptLang: 'ja-JP,ja;q=0.9,en;q=0.8' },
  de: { market: 'de-DE', acceptLang: 'de-DE,de;q=0.9,en;q=0.8' },
  fr: { market: 'fr-FR', acceptLang: 'fr-FR,fr;q=0.9,en;q=0.8' },
  es: { market: 'es-ES', acceptLang: 'es-ES,es;q=0.9,en;q=0.8' },
  ko: { market: 'ko-KR', acceptLang: 'ko-KR,ko;q=0.9,en;q=0.8' },
};

// timeRange（day/week/month/year）→ 相对天数（供引擎近似档换算）
const DAYS_BY_RANGE: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 };
const SEARXNG_TIME: Record<string, string> = { day: 'day', week: 'week', month: 'month', year: 'year' };

// SearXNG 公共实例（全部失败才报错；可用 searxngInstances 参数覆盖）
const SEARXNG_INSTANCES = [
  'https://opnxng.com',
  'https://priv.au',
  'https://searx.be',
  'https://searx.tiekoetter.com',
  'https://search.inetol.net',
  'https://paulgo.io',
];

// ---------- 小工具（移植自 dsh-free-search） ----------
function decodeEntities(text: unknown): string {
  return String(text)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)));
}

function stripTags(html: unknown): string {
  return decodeEntities(String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function extractDdgUrl(rel: string | undefined): string | null {
  if (!rel) return null;
  const m = rel.match(/uddg=([^&]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }
  if (rel.startsWith('//')) return `https:${rel}`;
  return rel;
}

function uniqueSources(sources: SearchSource[], limit: number): SearchSource[] {
  const seen = new Set<string>();
  const out: SearchSource[] = [];
  for (const s of sources) {
    if (s.url && !seen.has(s.url)) {
      seen.add(s.url);
      out.push(s);
    }
    if (out.length >= limit) break;
  }
  return out;
}

// 统一的 snippet 清洗：剔除登录/付费墙等噪音短语，折叠空白，限制长度
const SNIPPET_NOISE =
  /\b(sign up|sign in|log in|login|subscribe( to| for)?|member[- ]?only|become a member|create (a )?free account|read more|continue reading|story continues|get started|install (the )?app|view on|medium membership|join \w+ for free|get updates from this writer|stories in your inbox|remember me for|unlock this|free to read|become a patron)\b/gi;

function cleanSnippet(text: unknown): string | undefined {
  if (!text) return undefined;
  return String(text)
    .replace(SNIPPET_NOISE, ' ')
    .replace(/^\s*(#{1,6}\s*|\[\s*x?\s*\]\s*|-\s*\[\s*x?\s*\]\s*|>\s*)/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300) || undefined;
}

async function fetchHtml(url: string, signal?: AbortSignal, acceptLang?: string): Promise<string> {
  // 单次请求超时 12s，避免挂起
  let response: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);
    try {
      response = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, 'accept-language': acceptLang ?? ACCEPT_LANG },
        signal: controller.signal,
        redirect: 'follow',
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(`连接失败: ${(error as Error)?.message ?? String(error)}`);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}（${url.split('?')[0]}）`);
  }
  const html = await response.text();
  // DuckDuckGo 反爬验证页检测（HTTP 202 或验证关键字）
  if (response.status === 202 || /anomaly|captcha|unusual traffic|robot check/i.test(html.slice(0, 4000))) {
    throw new Error('DuckDuckGo 触发反爬验证（通常是临时限流，稍后恢复）');
  }
  return html;
}

// 带重试的抓取：网络错误/空结果时重试，间隔 1.5s，最多 3 次
async function fetchHtmlWithRetry(url: string, signal?: AbortSignal, acceptLang?: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const html = await fetchHtml(url, signal, acceptLang);
      if (html.length > 500) return html;
      lastError = new Error(`空响应（${html.length} 字节）`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw lastError ?? new Error('抓取失败');
}

// Bing「查询无结果时返回无关缓存 SERP」识别（移植：query token 与结果文本重叠判定）
function queryOverlapTokens(query: string): string[] {
  const tokens = new Set<string>();
  for (const run of String(query).match(/[\u4e00-\u9fff]+/g) ?? []) {
    if (run.length <= 2) tokens.add(run);
    for (let i = 0; i + 1 < run.length; i++) tokens.add(run.slice(i, i + 2));
  }
  for (const word of String(query).toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length >= 2) tokens.add(word);
  }
  return [...tokens];
}

function looksRelevant(query: string, sources: SearchSource[]): boolean {
  const tokens = queryOverlapTokens(query);
  if (tokens.length === 0) return true; // 纯符号查询无法判定，不拦截
  return sources.some((s) => {
    const hay = `${s.title ?? ''} ${s.snippet ?? ''} ${s.url ?? ''}`.toLowerCase();
    return tokens.some((t) => hay.includes(t.toLowerCase()));
  });
}

// ---------- 引擎 1：Bing（HTML SERP，mkt 本地化） ----------
async function searchBing(query: string, count: number, options: WebSearchEngineParams, signal?: AbortSignal): Promise<SearchSource[]> {
  const profile = LANG_PROFILES[options.lang ?? ''] ?? LANG_PROFILES.zh;
  const params = new URLSearchParams({ q: query, mkt: profile.market });
  const html = await fetchHtmlWithRetry(`https://www.bing.com/search?${params}`, signal, profile.acceptLang);
  const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/g) ?? [];
  const sources: SearchSource[] = [];
  for (const block of blocks) {
    const hrefMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"/);
    const titleMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*>(.*?)<\/a>[\s\S]*?<\/h2>/);
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    if (!hrefMatch) continue;
    sources.push({
      url: hrefMatch[1],
      ...(titleMatch ? { title: stripTags(titleMatch[1]) } : {}),
      ...(snippetMatch ? { snippet: cleanSnippet(snippetMatch[1]) } : {}),
    });
  }
  // 无结果缓存页 → 判 0 条，交给回退链换下一个引擎
  if (sources.length > 0 && !looksRelevant(query, sources)) return [];
  return uniqueSources(sources, count);
}

// ---------- 引擎 2：DDG Lite（轻量 HTML） ----------
async function searchDdgLite(query: string, count: number, options: WebSearchEngineParams, signal?: AbortSignal): Promise<SearchSource[]> {
  const params = new URLSearchParams({ q: query });
  if (options.timeRange && DAYS_BY_RANGE[options.timeRange]) {
    const days = DAYS_BY_RANGE[options.timeRange];
    const df = days <= 2 ? 'd' : days <= 14 ? 'w' : days <= 90 ? 'm' : 'y';
    params.set('df', df);
  }
  const html = await fetchHtmlWithRetry(`https://lite.duckduckgo.com/lite/?${params}`, signal);
  const linkMatches = html.match(/<a[^>]*class=['"]result-link['"][^>]*>[\s\S]*?<\/a>/g) ?? [];
  const snippetMatches = html.match(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g) ?? [];
  const sources: SearchSource[] = [];
  for (let i = 0; i < linkMatches.length; i++) {
    const tag = linkMatches[i];
    const hrefMatch = tag.match(/href="([^"]*)"/);
    const titleMatch = tag.match(/class=['"]result-link['"][^>]*>(.*?)<\/a>/);
    if (!hrefMatch) continue;
    const url = extractDdgUrl(hrefMatch[1]);
    if (!url) continue;
    const snippet = snippetMatches[i]?.match(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/)?.[1];
    sources.push({
      url,
      ...(titleMatch ? { title: stripTags(titleMatch[1]) } : {}),
      ...(snippet ? { snippet: cleanSnippet(snippet) } : {}),
    });
  }
  return uniqueSources(sources, count);
}

// ---------- 引擎 3：DDG HTML（完整 SERP） ----------
async function searchDdgHtml(query: string, count: number, options: WebSearchEngineParams, signal?: AbortSignal): Promise<SearchSource[]> {
  const params = new URLSearchParams({ q: query });
  if (options.timeRange && DAYS_BY_RANGE[options.timeRange]) {
    const days = DAYS_BY_RANGE[options.timeRange];
    const df = days <= 2 ? 'd' : days <= 14 ? 'w' : days <= 90 ? 'm' : 'y';
    params.set('df', df);
  }
  const html = await fetchHtmlWithRetry(`https://html.duckduckgo.com/html/?${params}`, signal);
  const blocks = html.match(/<div class="result results_links[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g) ?? [];
  const sources: SearchSource[] = [];
  for (const block of blocks) {
    const urlMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"/);
    const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*>(.*?)<\/a>/);
    const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/);
    const dateMatch = block.match(/<span[^>]*>\s*([\dT:.+-]+)\s*<\/span>/);
    const url = extractDdgUrl(urlMatch?.[1]);
    if (!url) continue;
    sources.push({
      url,
      ...(titleMatch ? { title: stripTags(titleMatch[1]) } : {}),
      ...(snippetMatch ? { snippet: cleanSnippet(snippetMatch[1]) } : {}),
      ...(dateMatch ? { publishedAt: dateMatch[1] } : {}),
    });
  }
  return uniqueSources(sources, count);
}

// ---------- 引擎 4：SearXNG（元搜索，多实例自动轮换） ----------
async function searchSearxng(query: string, count: number, options: WebSearchEngineParams, signal?: AbortSignal): Promise<SearchSource[]> {
  const instances = options.searxngInstances?.length ? options.searxngInstances : SEARXNG_INSTANCES;
  const errors: string[] = [];
  for (const base of instances) {
    try {
      const params = new URLSearchParams({ q: query, format: 'json' });
      if (options.timeRange && SEARXNG_TIME[options.timeRange]) params.set('time_range', SEARXNG_TIME[options.timeRange]);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const onAbort = () => ctrl.abort();
      signal?.addEventListener('abort', onAbort);
      let response: Response;
      try {
        response = await fetch(`${base}/search?${params}`, {
          headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
      if (!response.ok) {
        errors.push(`${base}: HTTP ${response.status}`);
        continue;
      }
      const data = (await response.json().catch(() => null)) as { results?: { url?: string; title?: string; content?: string }[] } | null;
      if (!data || !Array.isArray(data.results)) {
        errors.push(`${base}: 返回了非 JSON 内容`);
        continue;
      }
      const sources = data.results
        .filter((r) => r.url)
        .map((r) => ({
          url: r.url as string,
          ...(r.title ? { title: String(r.title) } : {}),
          ...(r.content ? { snippet: cleanSnippet(r.content) } : {}),
        }));
      if (sources.length > 0) return uniqueSources(sources, count);
      errors.push(`${base}: 0 条结果`);
    } catch (error) {
      if (signal?.aborted) throw error;
      errors.push(`${base}: ${(error as Error).message}`);
    }
  }
  const detail = errors.length > 0 ? errors.join(', ') : 'no instances configured';
  throw new Error(`所有 SearXNG 实例均失败: ${detail.slice(0, 300)}`);
}

// ---------- 引擎 5：AnySearch（免费匿名 JSON API） ----------
async function searchAnysearch(query: string, count: number, _options: WebSearchEngineParams, signal?: AbortSignal): Promise<SearchSource[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  let response: Response;
  try {
    response = await fetch('https://api.anysearch.com/v1/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, max_results: count }),
      signal: controller.signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(`AnySearch 请求失败: ${(error as Error)?.message ?? String(error)}`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  if (!response.ok) throw new Error(`AnySearch API 错误（HTTP ${response.status}）`);
  const data = (await response.json()) as { code?: number; message?: string; data?: { results?: { url?: string; title?: string; snippet?: string }[] } };
  if (data.code !== 0) throw new Error(`AnySearch API 错误: ${data.message ?? data.code}`);
  const results = data.data?.results ?? [];
  return results
    .filter((r) => r.url)
    .map((r) => ({
      url: r.url as string,
      ...(r.title ? { title: String(r.title) } : {}),
      ...(r.snippet ? { snippet: cleanSnippet(r.snippet) } : {}),
    }));
}

const ENGINE_RUNNERS: Record<string, (q: string, n: number, o: WebSearchEngineParams, s?: AbortSignal) => Promise<SearchSource[]>> = {
  bing: searchBing,
  'ddg-lite': searchDdgLite,
  ddg: searchDdgHtml,
  searxng: searchSearxng,
  anysearch: searchAnysearch,
};

// 内置免 key 引擎链（bing 打头：对 zh-CN 最稳、反爬最松；DDG 系反爬概率高放后面）
const ENGINE_CHAIN = ['bing', 'ddg-lite', 'ddg', 'searxng', 'anysearch'];

// ---------- 宿主优先（方案 C）：走宿主 dsh-free-search 注册的 web_search 工具 ----------
interface HostTools {
  get?: (name: string) => unknown;
  execute?: (input: unknown) => Promise<unknown>;
}

function getHostTools(): HostTools | null {
  try {
    // 0.2.0：裸 ctx.tools 抛 without inject → 走 hostService（ctx.get 是官方绕过入口）
    const tools = hostService('tools') as HostTools | null | undefined;
    return tools && typeof tools.execute === 'function' ? tools : null;
  } catch {
    return null;
  }
}

// 宿主工具结果容错归一：兼容 { sources | results } 直接数组形态、
// MCP 的 { content:[{type:'text',text:...}] } 包裹形态、以及 JSON 字符串形态
function normalizeHostOutput(raw: unknown, limit: number): SearchSource[] | null {
  let cur: unknown = raw;
  if (typeof cur === 'string') {
    try {
      cur = JSON.parse(cur);
    } catch {
      return null;
    }
  }
  if (cur == null || typeof cur !== 'object') return null;
  const obj = cur as Record<string, unknown>;
  // MCP 形态：content[].text → 逐段尝试 JSON 解析找 sources/results
  if (Array.isArray(obj.content)) {
    for (const block of obj.content) {
      if ((block as { type?: string })?.type !== 'text') continue;
      try {
        const j = JSON.parse(String((block as { text?: string }).text ?? '')) as Record<string, unknown>;
        const arr = (j?.sources ?? j?.results) as unknown;
        if (Array.isArray(arr)) return toSources(arr, limit);
      } catch {
        /* 非 JSON 文本段，跳过 */
      }
    }
  }
  const arr = obj.sources ?? obj.results;
  if (Array.isArray(arr)) return toSources(arr, limit);
  return null;
}

function toSources(arr: unknown[], limit: number): SearchSource[] {
  return arr
    .filter((it) => it && typeof it === 'object' && typeof (it as { url?: unknown }).url === 'string')
    .slice(0, limit)
    .map((it) => {
      const o = it as { url: string; title?: unknown; snippet?: unknown; content?: unknown; publishedAt?: unknown };
      return {
        url: o.url,
        ...(o.title != null ? { title: String(o.title) } : {}),
        ...(o.snippet != null ? { snippet: cleanSnippet(o.snippet) } : o.content != null ? { snippet: cleanSnippet(o.content) } : {}),
        ...(o.publishedAt != null ? { publishedAt: String(o.publishedAt) } : {}),
      };
    });
}

async function tryHostSearch(p: WebSearchEngineParams, signal?: AbortSignal): Promise<SearchOutcome | null> {
  const tools = getHostTools();
  const execute = tools?.execute;
  if (typeof execute !== 'function') return null;
  try {
    // 工具存在性：get 可用时先探测，探测不到直接跳过宿主路径
    const get = tools?.get;
    if (typeof get === 'function' && !get('web_search')) return null;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 25_000);
    const onAbort = () => ac.abort();
    signal?.addEventListener('abort', onAbort);
    try {
      const callId = `dag-flow-ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const raw = await execute({
        callId,
        name: 'web_search',
        arguments: { query: p.query, count: p.count, ...(p.timeRange ? { timeRange: p.timeRange } : {}) },
        signal: ac.signal,
      });
      const results = normalizeHostOutput(raw, p.count);
      if (results && results.length > 0) return { results, engine: 'host:web_search', viaHost: true };
      return null; // 宿主结果为空/无法识别 → 回落内置链
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  } catch {
    return null; // 宿主路径任何异常（callId 格式/权限/超时）→ 静默回落内置链
  }
}

// ---------- 对外入口：web_search ----------
export async function runWebSearch(p: WebSearchEngineParams, signal?: AbortSignal): Promise<SearchOutcome> {
  const provider = p.provider && p.provider !== 'auto' ? p.provider : 'auto';
  const count = Math.max(1, Math.min(20, Math.floor(p.count) || 8));
  if (signal?.aborted) throw new Error('运行已被取消');
  // 宿主优先（auto / host）
  if (provider === 'auto' || provider === 'host') {
    const host = await tryHostSearch(p, signal);
    if (host) return host;
    if (provider === 'host') {
      throw new Error('宿主 web_search 工具不可用（未安装 dsh-free-search 插件或调用失败）——改用 provider=auto 或指定内置引擎');
    }
  }
  const chain = provider === 'auto' ? ENGINE_CHAIN : [provider];
  const errors: string[] = [];
  for (const eng of chain) {
    const runner = ENGINE_RUNNERS[eng];
    if (!runner) {
      errors.push(`${eng}: unknown engine`);
      continue;
    }
    try {
      if (signal?.aborted) throw new Error('运行已被取消');
      const sources = await runner(p.query, count, p, signal);
      if (sources.length > 0) {
        return { results: sources.slice(0, count), engine: eng, viaHost: false };
      }
      errors.push(`${eng}: 0 条结果`);
    } catch (error) {
      if (signal?.aborted) throw new Error('运行已被取消');
      errors.push(`${eng}: ${(error as Error).message}`);
    }
  }
  throw new Error(`所有搜索引擎均失败：${errors.join('；').slice(0, 400)}`);
}

// ---------- web_fetch：抓取 URL → 正文文本 / JSON ----------
export interface WebFetchParams {
  url: string;
  maxChars?: number;
  timeoutMs?: number;
  raw?: boolean;
}

export interface WebFetchOutcome {
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
