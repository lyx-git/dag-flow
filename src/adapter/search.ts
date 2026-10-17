// src/adapter/search.ts — web_search / web_fetch 引擎层
//
// 引擎适配器移植自 dsh-free-search 0.4.36（MIT License，© DDDMUC，github.com/DDDMUC/dsh-free-search），
// 按 MIT 许可**携带版权声明**（这是许可证义务，与"是否依赖那个插件"无关：代码是复制进来自己维护的）。
// 只包含 5 个免 key 引擎（bing / ddg-lite / ddg / searxng / anysearch）及其配套的抓取、反爬检测、
// 重试、清洗工具函数。
//
// ★ 2026-10-19 用户要求「网络搜索依赖 dsh-free-search 插件的内容都删掉，不能依赖不稳定的第三方插件」：
//   已**移除「宿主优先」通路**（原 provider=auto 时会先调宿主注册的 web_search 工具、失败再回落内置链）。
//   现在 web_search **只走内置引擎**，零外部插件依赖；`SearchOutcome` 也随之去掉 `viaHost` 标记。
//   老数据里 `provider: 'host'` 仍在节点 schema 里保留（宽容位，避免老工作流结构校验失败），
//   但运行时会明确报错引导改成 auto / 内置引擎。

interface SearchSource {
  url: string;
  title?: string;
  snippet?: string;
  publishedAt?: string;
}

interface SearchOutcome {
  results: SearchSource[];
  engine: string;
}

export interface WebSearchEngineParams {
  query: string;
  count: number;
  provider?: string;
  lang?: string;
  timeRange?: string;
  searxngInstances?: string[];
}

// ---------- 常量（与 dsh-free-search 对齐；web-fetch.ts 共用，2026-10-14 轮 3 起 export） ----------
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
export const ACCEPT_LANG = 'zh-CN,zh;q=0.9,en;q=0.8';

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

// ---------- 超时策略（2026-10-19 用户选「A：压短单引擎超时」） ----------
// 背景：真机实测 ddg / ddg-lite 要 22–34s 才在 fetch 层失败、searxng 公共实例轮完 48s，
//   而它们排在引擎链尾只做兜底 —— 让用户干等几十秒才换下一个引擎不值得。
//   实测 bing 645ms、anysearch 2715ms，8s 余量充足，正常请求不受影响。
// searxng 不设引擎级总 deadline（它内部按实例轮换，语义是"轮完所有实例"），
//   改为压缩**每个实例**的超时：8s → 4s，最坏 6 实例 = 24s（原 48s）。
const ENGINE_DEADLINE_MS: Record<string, number> = {
  bing: 8000,
  anysearch: 8000,
  ddg: 8000,
  'ddg-lite': 8000,
};
const SEARXNG_INSTANCE_TIMEOUT_MS = 4000;

// ---------- 小工具（移植自 dsh-free-search；web-fetch.ts 共用，2026-10-14 轮 3 起 export） ----------
export function decodeEntities(text: unknown): string {
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
  // 单次请求超时 12s，避免挂起（引擎级 deadline 更短，通常由外层先触发）
  let response: Response;
  try {
    // ★ 2026-10-19：外层 signal 已 abort 时 addEventListener 不会补发事件，
    //   内部 fetch 会白跑满 12s —— 开头显式检查一次，避免超时后重试还继续发请求。
    if (signal?.aborted) throw new Error('已取消');
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
    // 已被外层中断（引擎超时/用户取消）就别再补下一次请求
    if (signal?.aborted) break;
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
    // 外层已中断（用户取消）时不再试后面的实例
    if (signal?.aborted) throw new Error('已取消');
    try {
      const params = new URLSearchParams({ q: query, format: 'json' });
      if (options.timeRange && SEARXNG_TIME[options.timeRange]) params.set('time_range', SEARXNG_TIME[options.timeRange]);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), SEARXNG_INSTANCE_TIMEOUT_MS);
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

// 内置免 key 引擎链的**尝试顺序**（2026-10-19 用户「哪些比较好用的都移到前面来」⇒ 按真机实测重排）：
//   实测（真宿主 run-node、中英文各一次、共 10 次调用，本机网络环境）：
//     bing      2/2 成功  平均 645ms
//     anysearch 2/2 成功  平均 2715ms
//     ddg       0/2 失败  平均 22731ms（fetch failed）
//     ddg-lite  0/2 失败  平均 34632ms（fetch failed）
//     searxng   0/2 失败  平均 48040ms（公共实例全超时）
//   ⇒ 好用的（bing / anysearch）提到前面，能通的先出结果；DDG 系与 SearXNG 留在链尾兜底
//     （换网络环境/换公共实例时它们可能可用，所以**不删**，只是不再排在前面白等几十秒）。
//   ★ 同一天加超时后复测（同一探针，逐个 provider 指定、真实网络，见 tmp-test/probe-engine-timeout.mjs）：
//     bing      720ms    5 条
//     anysearch 1744ms   5 条
//     ddg       8007ms   超时放弃（原 22.7s）
//     ddg-lite  8011ms   超时放弃（原 34.6s）
//     searxng   22.99s   全部实例失败（原 48.0s；现每实例 4s × 6）
//   ⇒ auto 全挂时最坏耗时 105s → 39s 左右，正常路径（bing/anysearch）完全不受影响。
const ENGINE_CHAIN = ['bing', 'anysearch', 'ddg', 'ddg-lite', 'searxng'];

// ★ 2026-10-19 用户要求「网络搜索依赖 dsh-free-search 插件的内容都删掉」：
//   这里原有的「宿主优先（方案 C）」整段（HostTools / getHostTools / normalizeHostOutput / toSources /
//   tryHostSearch）**已整体删除** —— web_search 不再探测、也不再调用宿主注册的 web_search 工具。
//   引擎只走下方 ENGINE_CHAIN 那 5 个内置免 key 引擎，对外零插件依赖。

// ---------- 对外入口：web_search ----------
export async function runWebSearch(p: WebSearchEngineParams, signal?: AbortSignal): Promise<SearchOutcome> {
  const provider = p.provider && p.provider !== 'auto' ? p.provider : 'auto';
  const count = Math.max(1, Math.min(20, Math.floor(p.count) || 8));
  if (signal?.aborted) throw new Error('运行已被取消');
  // ★ 2026-10-19：`provider: 'host'`（仅宿主）已随「宿主优先」通路一起移除。
  //   老工作流里可能还存着这个值 ⇒ 明确报错并给改法（不静默按 auto 跑，免得用户以为还在走宿主）。
  if (provider === 'host') {
    throw new Error('web_search 的「仅宿主」模式已移除（不再依赖 dsh-free-search 等外部插件）——请把「搜索引擎」改成 auto（内置引擎链），或直接选一个内置引擎（bing / ddg / ddg-lite / searxng / anysearch）');
  }
  const chain = provider === 'auto' ? ENGINE_CHAIN : [provider];
  const errors: string[] = [];
  for (const eng of chain) {
    const runner = ENGINE_RUNNERS[eng];
    if (!runner) {
      errors.push(`${eng}: unknown engine`);
      continue;
    }
    // 单引擎总超时：到点就放弃这个引擎、换下一个（含它内部的重试）。
    // 不用外层 signal 直连，否则"引擎超时"会被内部误判成"用户取消"。
    // ★ 用 Promise.race 兜住而不是只 abort：abort 只是"请求它停"，若底层 fetch 卡在
    //   不响应 signal 的状态（连接半死、DNS 挂死），await 会永不返回 ⇒ 整个搜索挂住。
    //   实测发现（A12 用例）：只 abort 时 300s 都不返回；race 才能保证到点一定有结果。
    const deadline = ENGINE_DEADLINE_MS[eng];
    let timedOut = false;
    const local = new AbortController();
    const onOuterAbort = () => local.abort();
    signal?.addEventListener('abort', onOuterAbort);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutRace = deadline
      ? new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            local.abort();
            reject(new Error(`超时 ${deadline}ms 未返回`));
          }, deadline);
        })
      : null;
    try {
      if (signal?.aborted) throw new Error('运行已被取消');
      const work = runner(p.query, count, p, local.signal);
      // race 输了之后 work 仍会在后台结束 —— 挂个空 catch，别变成 unhandled rejection
      work.catch(() => {});
      const sources = timeoutRace ? await Promise.race([work, timeoutRace]) : await work;
      if (sources.length > 0) {
        return { results: sources.slice(0, count), engine: eng };
      }
      errors.push(`${eng}: 0 条结果`);
    } catch (error) {
      if (signal?.aborted) throw new Error('运行已被取消');
      errors.push(timedOut ? `${eng}: 超时 ${deadline}ms 未返回` : `${eng}: ${(error as Error).message}`);
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onOuterAbort);
    }
  }
  throw new Error(`所有搜索引擎均失败：${errors.join('；').slice(0, 400)}`);
}

// ---------- web_fetch：已于 2026-10-14 重构轮 3 拆至 ./web-fetch.ts（runWebFetch 及其类型都在那边） ----------
