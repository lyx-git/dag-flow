// tmp-test/patch-fin-daily-cctv.mjs — 把「金融政策日报」的 fetch_cctv 改成**永不失败**的央视网抓取
//   用户 2026-10-03 真机报错：FETCH_FAILED：请求异常: HTTP 403（https://baike.baidu.com/item/2026年）
//   根因（实测）：原实现 web_fetch 抓 {{srch_cctv.out.results.0.url}}（跟着搜索结果第一条走），
//     那次第一条恰好是百度百科——该站对任何 UA 一律 403（无 UA / Chrome UA / +Accept-Language 实测都 403，2466 字「百度安全验证」）；
//     而 DAG 模式下一个节点失败就中断后续层 → ai_domestic/ai_matrix/save_doc/mail/log 全没跑。
//   修法：①改抓**央视网新闻联播按日页**（实测 200，正文=当日条目清单：标题+时长，官方口径）；
//         ②搜索结果 URL 降级为兜底候选（跳过 baike/知乎/微信等已知反爬站）；
//         ③节点类型 web_fetch → python，任何问题都 exit 0 + 打印 CCTV_OK / CCTV_FETCH_SKIPPED（与 mail 节点同一容错口径）。
//   幂等：可重复执行；保留用户其它编辑。
import { readFileSync, writeFileSync } from 'node:fs';

const DEF = 'D:/workspace/pluginspace/.dag-flow/workflow/金融政策日报.json';

const cctvCode = `# -*- coding: utf-8 -*-
# 抓「新闻联播」当日条目清单（央视网按日页，标题+时长，官方口径）。
# ★ 永不失败：任何问题都打印 CCTV_OK / CCTV_FETCH_SKIPPED 并 exit 0
#   —— DAG 模式下节点失败会中断后续层（节点级 onError 在 DAG 里不生效）。
# 为什么不再「抓搜索结果第一条」：2026-10-03 真机那次第一条是百度百科
#   （baike.baidu.com/item/2026年），该站对任何 UA 一律 403（实测无 UA / Chrome UA 都 403）
#   → 原 web_fetch 节点失败 → 后面 ai_domestic/ai_matrix/save_doc/mail 全没跑。
# 实测可抓：https://tv.cctv.com/lm/xwlb/day/YYYYMMDD.shtml → HTTP 200，正文=当日联播条目。
import json, re, sys, urllib.error, urllib.request

MAX = 6000
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')
SKIP_HOSTS = ('baike.baidu.com', 'zhihu.com', 'weixin.qq.com', 'mp.weixin.qq.com', 'jianshu.com', 'baidu.com/link')


def emit(status, body=''):
    # 统一出口：状态行 + 正文（正文可为空）+ 永远 exit 0
    sys.stdout.write(status + (('\\n' + body) if body else '') + '\\n')
    sys.exit(0)


def strip_html(html):
    html = re.sub(r'(?is)<script.*?</script>', ' ', html)
    html = re.sub(r'(?is)<style.*?</style>', ' ', html)
    html = re.sub(r'(?is)<noscript.*?</noscript>', ' ', html)
    html = re.sub(r'(?s)<!--.*?-->', ' ', html)
    html = re.sub(r'(?i)</(p|div|li|tr|h[1-6]|br)>', '\\n', html)
    html = re.sub(r'(?i)<br\\s*/?>', '\\n', html)
    html = re.sub(r'<[^>]+>', ' ', html)
    for a, b in (('&nbsp;', ' '), ('&amp;', '&'), ('&quot;', '"'), ('&#39;', "'"), ('&lt;', '<'), ('&gt;', '>')):
        html = html.replace(a, b)
    html = re.sub(r'[ \\t]+', ' ', html)
    html = re.sub(r'\\n\\s*\\n+', '\\n', html)
    return '\\n'.join(l.strip() for l in html.split('\\n') if l.strip())


def fetch_text(url):
    req = urllib.request.Request(url, headers={
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'identity',   # 不请求压缩：urllib 不会自动解 gzip
    })
    try:
        with urllib.request.urlopen(req, timeout=12) as r:
            raw, charset = r.read(), r.headers.get_content_charset()
    except urllib.error.HTTPError as e:
        return '', 'HTTP %s' % e.code
    except Exception as e:
        return '', '%s: %s' % (type(e).__name__, str(e)[:80])
    html = None
    for enc in (charset, 'utf-8', 'gbk'):
        if not enc:
            continue
        try:
            html = raw.decode(enc)
            break
        except Exception:
            continue
    if html is None:
        html = raw.decode('utf-8', 'replace')
    return strip_html(html), ''


day = """{{py_date.out}}""".strip()
digits = re.sub(r'\\D', '', day)

# 候选源：央视网按日页（今天 → 昨天，防当天尚未发布）优先；搜索结果降级兜底
cands = []
for d in ([digits] if digits else []) + ([str(int(digits) - 1)] if digits.isdigit() else []):
    cands.append('https://tv.cctv.com/lm/xwlb/day/%s.shtml' % d)
try:
    hits = json.loads(r'''{{srch_cctv.out.results}}''')
    if isinstance(hits, dict):
        hits = hits.get('results') or []
    for h in (hits or []):
        u = (h or {}).get('url') if isinstance(h, dict) else None
        if u and u not in cands:
            cands.append(u)
except Exception:
    pass

tried = []
for url in cands:
    host = url.split('/')[2].lower() if '//' in url else ''
    if any(s in url.lower() for s in SKIP_HOSTS):
        tried.append('%s（跳过：已知反爬站）' % host)
        continue
    if re.search(r'/lm/xwlb/?$', url):
        tried.append('%s（跳过：栏目页只有导航，无当日条目）' % url)
        continue
    text, err = fetch_text(url)
    if err:
        tried.append('%s → %s' % (url, err))
        continue
    if len(text) < 150:
        tried.append('%s → 正文仅 %d 字（无有效内容）' % (url, len(text)))
        continue
    emit('CCTV_OK %s · %d 字 · %s（央视网按日页：当日条目清单，非逐字稿）' % (day, len(text), url), text[:MAX])

emit('CCTV_FETCH_SKIPPED %s · 所有候选源均不可用（%s）；本次只用搜索结果摘要'
     % (day, '；'.join(tried[:4]) if tried else '无候选源'))`;

const def = JSON.parse(readFileSync(DEF, 'utf8'));
const log = [];

// ---------- 1. fetch_cctv: web_fetch → python（永不失败）----------
const node = def.nodes.find((n) => n.id === 'fetch_cctv');
if (!node) { console.error('✗ 找不到 fetch_cctv 节点'); process.exit(1); }
const wasType = node.type;
node.type = 'python';
node.label = '抓：新闻联播当日条目（央视网 · 失败不影响流程）';
node.params = { code: cctvCode, timeoutMs: 120000 };
log.push(`↻ fetch_cctv：${wasType} → python（央视网按日页 + 搜索兜底 + 永不失败）`);

// ---------- 2. ai_domestic 提示词：引用随节点类型变更（python out 是整份文本，没有 .text 字段）----------
const ai = def.nodes.find((n) => n.id === 'ai_domestic');
const before = ai.params.prompt;
ai.params.prompt = before
  .replace('【新闻联播文字稿（可能为空）】\n{{fetch_cctv.out.text}}', '【新闻联播当日条目（央视网脚本抓取，可能为空）】\n{{fetch_cctv.out}}')
  .replace('文字稿抓不到就写「未取到文字稿，仅用搜索材料」', '若上面显示 CCTV_FETCH_SKIPPED 或没有内容，就写「未取到联播条目，仅用搜索材料」');
if (ai.params.prompt === before) { console.error('✗ ai_domestic 提示词未被改动（引用形态已变？先核对再改）'); process.exit(1); }
log.push('↻ ai_domestic：引用 {{fetch_cctv.out.text}} → {{fetch_cctv.out}}（python 的 out 是整份 stdout）');

// ---------- 3. 自检（写盘前）：引用 / next↔edges 一致 / 必填 / 无环 ----------
const errs = [];
const ids = new Set(def.nodes.map((n) => n.id));
const refs = new Set();
const scan = (v) => {
  if (typeof v === 'string') { for (const m of v.matchAll(/\{\{\s*([A-Za-z0-9_\-\u4e00-\u9fa5]+)\./g)) refs.add(m[1]); }
  else if (v && typeof v === 'object') { for (const x of Object.values(v)) scan(x); }
};
for (const n of def.nodes) scan(n.params);
for (const r of refs) if (!['inputs', 'vars', 'results'].includes(r) && !ids.has(r)) errs.push(`模板引用不存在的节点：${r}`);
for (const e of def.edges) if (!ids.has(e.from) || !ids.has(e.to)) errs.push(`边指向不存在的节点：${e.from}→${e.to}`);
for (const n of def.nodes) {
  if (n.type === 'python' && !n.params?.code) errs.push(`${n.id} python 节点缺 code`);
  const fromEdges = def.edges.filter((e) => e.from === n.id).map((e) => e.to);
  const nextList = n.next === undefined ? [] : (Array.isArray(n.next) ? n.next : [n.next]);
  if (fromEdges.length !== nextList.length || !fromEdges.every((t) => nextList.includes(t))) {
    errs.push(`next 与 edges 不一致：${n.id} edges=[${fromEdges}] next=[${nextList}]`);
  }
}
{
  const adj = new Map(def.nodes.map((n) => [n.id, def.edges.filter((e) => e.from === n.id).map((e) => e.to)]));
  const st = new Map();
  const dfs = (id) => {
    if (st.get(id) === 1) { errs.push('存在环：经过 ' + id); return; }
    if (st.get(id) === 2) return;
    st.set(id, 1);
    for (const t of adj.get(id) ?? []) dfs(t);
    st.set(id, 2);
  };
  for (const n of def.nodes) dfs(n.id);
}
if (errs.length) {
  console.error('✗ 自检未通过，未写盘：');
  for (const e of errs) console.error('  - ' + e);
  process.exit(1);
}

writeFileSync(DEF, JSON.stringify(def, null, 2) + '\n', 'utf8');
for (const l of log) console.log(l);
console.log(`✓ 已写盘 ${DEF}（节点 ${def.nodes.length} / 边 ${def.edges.length}，图结构未动）`);
