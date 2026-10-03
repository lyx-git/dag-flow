// tmp-test/probe-fetch-ua.mjs — 决定性实验：同一个 URL，Node 默认 UA vs 浏览器 UA
//   背景：2026-10-03 用户跑「金融政策日报」时 fetch_cctv 失败：
//     FETCH_FAILED：请求异常: HTTP 403（https://baike.baidu.com/item/2026%E5%B9%B4）
//   嫌疑：插件的抓取器不带 User-Agent（grep 全仓无 User-Agent），Node fetch 默认 UA 形如 `node`/`undici`，
//         很多站点（百度百科/知乎/微信等）直接 403 挡掉非浏览器 UA。
//   本探针不猜，直接对照实测：同一 URL 无 UA / 带浏览器 UA / 带 UA+Accept-Language 各自的 HTTP 状态。
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const TARGETS = [
  ['百度百科（用户本次报错的站点）', 'https://baike.baidu.com/item/2026%E5%B9%B4'],
  ['央视网 新闻联播栏目页', 'https://tv.cctv.com/lm/xwlb/'],
];

async function probe(url, headers, label) {
  const t0 = Date.now();
  try {
    const ctl = AbortSignal.timeout(20000);
    const res = await fetch(url, { headers, signal: ctl, redirect: 'follow' });
    const text = await res.text();
    console.log(`    ${label.padEnd(22)} → HTTP ${res.status} ${res.statusText} · ${text.length} 字 · ${Date.now() - t0}ms` +
      ` · UA=${JSON.stringify(headers?.['user-agent'] ?? '(未设置)')}`);
    return res.status;
  } catch (e) {
    console.log(`    ${label.padEnd(22)} → 抛出异常 ${e.name}: ${String(e.message).slice(0, 120)} · ${Date.now() - t0}ms`);
    return -1;
  }
}

for (const [name, url] of TARGETS) {
  console.log(`\n[${name}] ${url}`);
  const a = await probe(url, undefined, '① 无 UA（现状）');
  const b = await probe(url, { 'user-agent': UA }, '② 浏览器 UA');
  const c = await probe(url, { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9' }, '③ UA + Accept-Language');
  console.log(`  结论：${a === b ? '仅改 UA 无效（状态码相同 ' + a + '）' : `UA 影响状态码 ${a} → ${b}`}` +
    (c !== b ? `；加 Accept-Language 再变 ${b} → ${c}` : ''));
}
