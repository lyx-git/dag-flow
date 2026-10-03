// tmp-test/probe-cctv-source.mjs — 为「新闻联播文字稿」找一个**抓得到**的稳定源
//   背景：fetch_cctv 原来抓 {{srch_cctv.out.results.0.url}}，2026-10-03 那次第一条是百度百科
//         （https://baike.baidu.com/item/2026年）→ 该站对所有 UA 一律 403 → 节点失败 → DAG 中断。
//   本探针实测候选源的可抓性与剥标签后的正文质量，作为改 fetch_cctv 的依据。
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

const CANDS = [
  ['央视网 新闻联播栏目页', 'https://tv.cctv.com/lm/xwlb/'],
  ['央视网 新闻联播往期', 'https://tv.cctv.com/lm/xwlb/index.shtml'],
  ['CCTV 新闻联播 文字稿站内（人民网）', 'http://cpc.people.com.cn/GB/67481/203826/index.html'],
  ['百度百科（本次报错源，预期 403）', 'https://baike.baidu.com/item/2026%E5%B9%B4'],
];

for (const [name, url] of CANDS) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' },
      redirect: 'follow', signal: AbortSignal.timeout(20000),
    });
    const html = await res.text();
    const text = htmlToText(html);
    console.log(`\n[${name}] HTTP ${res.status} · html ${html.length} 字 → 正文 ${text.length} 字 · ${Date.now() - t0}ms`);
    console.log('  正文头部：' + JSON.stringify(text.slice(0, 220)));
    // 找「文字稿」类链接，看有没有更精确的当日页面
    const links = [...html.matchAll(/href="([^"]+)"[^>]*>([^<]{4,40})</g)]
      .map((m) => [m[1], m[2].trim()])
      .filter(([, t]) => /文字|全文|实录|联播/.test(t))
      .slice(0, 5);
    if (links.length) for (const [h, t] of links) console.log(`  · 候选链接 ${t} → ${h.slice(0, 110)}`);
  } catch (e) {
    console.log(`\n[${name}] 抛出 ${e.name}: ${String(e.message).slice(0, 120)} · ${Date.now() - t0}ms`);
  }
}
