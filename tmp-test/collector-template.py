# -*- coding: utf-8 -*-
"""单维度金融材料采集器 v3（dag-flow python 节点代码模板，占位符由构建脚本注入）

管线：①【自动发现可用权威源】按维度标签过滤候选池 → 并发探测（能否抓到标题链接）
      → ②从可用源抓标题链接、按维度关键词筛 → 跟进文章正文
      → ③材料不足则【换检索方向重搜】(bing，主查询 + 备用查询)
      → ④按来源分块输出，供下游 AI 做多源交叉印证

约束：① 永不失败（异常只打印状态行 + exit 0，绝不中断 DAG）
     ② stdout 即材料正文（python 节点 out = stdout 字符串）
     ③ 只用标准库（内置 Python 3.12）；政府站自签证书必须关 SSL 校验
"""
import json, os, re, ssl, sys, tempfile, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

DIM = "@@DIM@@"
ROUND = "@@ROUND@@"             # '1' 权威源优先 / '2' 多引擎检索优先（并跳过第1轮已抓过的 URL）
CANDIDATES = @@CANDIDATES@@     # 候选权威源池 [{name,url,tags:[...]}]（全维度共用）
KEYWORDS = @@KEYWORDS@@         # 该维度的标题筛选词
ALT_QUERIES = @@ALT@@           # 检索式（第 1 条=主查询）
# ★ 跨轮去重走临时文件（不能把上一轮材料塞进代码：python 节点用 -c 传代码，命令行长度有限，
#   实测嵌入 2 万字材料会 spawn ENAMETOOLONG）
SEEN_FILE = os.path.join(tempfile.gettempdir(), "dagflow-seen-%s.txt" % DIM)
RAW_TEXT = @@RAW@@              # 预留：上游搜索结果的 JSON 文本（本设计不使用，保持空串）

MIN_CHARS = 2500
MAX_CHARS = 18000
PER_ARTICLE = 4500
MAX_SOURCES = 4                 # 每个维度最多用几个源
MAX_ARTICLES = 6                # 最多抓几篇正文
TIMEOUT = 10
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
SKIP = ("baike.baidu.com", "zhihu.com", "weixin.qq.com", "xiaohongshu.com",
        "jianshu.com", "baidu.com/link", "douyin.com", "bilibili.com", "csdn.net")

CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE      # 政府站用自签证书链，必须关校验


def http(url, timeout=TIMEOUT):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9", "Accept": "text/html,*/*"})
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        return r.read(700000), (r.headers.get("Content-Type") or "")


def decode(raw, ctype):
    for e in (["utf-8"] if "utf-8" in ctype.lower() else []) + ["utf-8", "gb18030", "gbk"]:
        try:
            return raw.decode(e)
        except Exception:
            continue
    return raw.decode("utf-8", errors="ignore")


def text_of(html):
    html = re.sub(r"(?is)<(script|style|noscript|svg|head)[^>]*>.*?</\1>", " ", html)
    html = re.sub(r"(?is)<!--.*?-->", " ", html)
    html = re.sub(r"(?is)<br\s*/?>|</p>|</div>|</li>|</h[1-6]>|</tr>|</a>", "\n", html)
    html = re.sub(r"(?s)<[^>]+>", " ", html)
    for a, b in (("&nbsp;", " "), ("&amp;", "&"), ("&quot;", '"'), ("&lt;", "<"), ("&gt;", ">"), ("&#39;", "'")):
        html = html.replace(a, b)
    html = re.sub(r"[ \t\r\f\v\u3000]+", " ", html)
    return re.sub(r"\n\s*\n+", "\n", html).strip()


def trim_nav(txt, title):
    """去掉正文前的导航块：优先从标题处开始；否则丢掉开头的短菜单行"""
    if title:
        i = txt.find(title[:18])
        if 0 < i < 3000:
            return txt[i:]
    lines = txt.split("\n")
    k = 0
    while k < min(20, len(lines)) and len(lines[k]) < 16:
        k += 1
    return "\n".join(lines[k:]) if k else txt


def page(url, title=""):
    try:
        raw, ctype = http(url)
        low = ctype.lower()
        if "pdf" in low or "image" in low or "octet-stream" in low:
            return ""
        return trim_nav(text_of(decode(raw, ctype)), title)[:PER_ARTICLE]
    except Exception:
        return ""


def headline_links(base, html):
    out, seen = [], set()
    for m in re.finditer(r'(?is)<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', html):
        label = re.sub(r"\s+", " ", text_of(m.group(2))).strip()
        if not (12 <= len(label) <= 90):
            continue
        url = urllib.parse.urljoin(base, m.group(1))
        if not url.startswith("http") or url in seen or any(s in url for s in SKIP):
            continue
        seen.add(url)
        out.append((label, url))
    return out


def bing(q):
    try:
        url = "https://www.bing.com/search?" + urllib.parse.urlencode({"q": q, "mkt": "zh-CN"})
        raw, ctype = http(url, timeout=6)
        html = decode(raw, ctype)
        hits = []
        for block in re.findall(r'(?s)<li class="b_algo".*?</li>', html):
            m = re.search(r'<a[^>]*href="(https?://[^"]+)"', block)
            if not m or any(s in m.group(1) for s in SKIP):
                continue
            tm = re.search(r"(?s)<h2[^>]*>.*?<a[^>]*>(.*?)</a>", block)
            hits.append((text_of(tm.group(1)) if tm else "", m.group(1)))
        return hits
    except Exception:
        return []


def ddg(q):
    """DuckDuckGo HTML 版（返回的是跳转链接，必须解 uddg= 还原真实 URL）"""
    try:
        url = "https://html.duckduckgo.com/html/?" + urllib.parse.urlencode({"q": q})
        raw, ctype = http(url, timeout=8)
        html = decode(raw, ctype)
        hits = []
        for m in re.finditer(r'(?is)class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', html):
            href = m.group(1)
            um = re.search(r"uddg=([^&]+)", href)
            if um:
                href = urllib.parse.unquote(um.group(1))
            if href.startswith("//"):
                href = "https:" + href
            if not href.startswith("http") or any(s in href for s in SKIP):
                continue
            hits.append((text_of(m.group(2)), href))
        return hits
    except Exception:
        return []


def searxng(q):
    """SearXNG 公共实例（经常 429，尽力而为，失败即返回空）"""
    for base in ("https://opnxng.com", "https://priv.au", "https://searx.be"):
        try:
            url = base + "/search?" + urllib.parse.urlencode({"q": q, "format": "json"})
            raw, ctype = http(url)
            d = json.loads(decode(raw, ctype))
            hits = [(r.get("title", ""), r.get("url", "")) for r in d.get("results", []) if r.get("url")]
            if hits:
                return hits
        except Exception:
            continue
    return []


ENGINES = (("bing", bing), ("ddg", ddg), ("searxng", searxng))
_ENGINE_DEAD = set()      # ★ 本次运行内失败过的引擎不再重试（否则每个查询都白等满超时，实测会把单轮拖到 170s）
MAX_SEARCH_QUERIES = 2    # 每轮最多用几条检索式（够用即停，别把时间耗在检索上）


def multi_search(q, prefer=None):
    """★ 多引擎搜索：合并 bing/ddg/searxng 的结果并去重（不同引擎带来不同信息）。
    prefer 指定优先引擎，让不同检索式走不同引擎；已知失效的引擎直接跳过。"""
    order = [e for e in ENGINES if e[0] not in _ENGINE_DEAD]
    if prefer:
        order.sort(key=lambda e: 0 if e[0] == prefer else 1)
    out, seen = [], set()
    for name, fn in order:
        t0 = time.time()
        hits = fn(q)
        if not hits and time.time() - t0 > 2.5:     # 等了好一会儿还没结果 → 判该引擎不可用，后面不再试
            _ENGINE_DEAD.add(name)
        for t, u in hits:
            if u in seen:
                continue
            seen.add(u)
            out.append((t, u))
        if len(out) >= 8:
            break
    return out


def discover_sources():
    """★ 先搜索有哪些权威源：按维度标签取候选 → 并发探测 → 保留真能抓到标题链接的"""
    cand = [c for c in CANDIDATES if DIM in (c.get("tags") or [])] or list(CANDIDATES)
    if not cand:
        return []

    def probe(c):
        try:
            raw, ctype = http(c["url"])
            html = decode(raw, ctype)
            links = headline_links(c["url"], html)
            hit = [x for x in links if any(k in x[0] for k in KEYWORDS)]
            return (c, html, len(links), len(hit))
        except Exception:
            return (c, "", 0, 0)

    with ThreadPoolExecutor(max_workers=6) as ex:
        probed = list(ex.map(probe, cand))
    # 打分：命中维度的标题数优先，其次总链接数；只用「能抓到 ≥5 条标题」的源
    usable = [p for p in probed if p[2] >= 5]
    usable.sort(key=lambda p: (-p[3], -p[2]))
    return usable[:MAX_SOURCES]


def parse_raw():
    try:
        v = json.loads(RAW_TEXT)
        return v if isinstance(v, list) else []
    except Exception:
        return []


def seen_urls():
    """第 2 轮：读第 1 轮写下的已用 URL（跨轮去重，避免两轮抓到同一批文章）"""
    if ROUND != "2":
        return set()
    try:
        with open(SEEN_FILE, encoding="utf-8") as f:
            return set(f.read().split())
    except Exception:
        return set()


def save_seen(urls):
    """第 1 轮：记下本轮用过的 URL，供第 2 轮跳过"""
    try:
        with open(SEEN_FILE, "w", encoding="utf-8") as f:
            f.write("\n".join(urls))
    except Exception:
        pass


def main():
    seen = seen_urls()
    got = []
    retried = False
    engines_used = []
    found = []
    src_names = ""

    def total():
        return sum(len(b) for _, _, b in got)

    def source_round():
        """权威列表页取数（第 1 轮主路径 / 第 2 轮兜底）"""
        nonlocal found, src_names
        found = discover_sources()
        src_names = "、".join(c["name"] for c, _h, _a, _b in found) or "无"
        picked = []
        for c, html, _a, _b in found:
            for label, url in headline_links(c["url"], html):
                if len(picked) >= MAX_ARTICLES * 3:
                    break
                if url in seen or not any(k in label for k in KEYWORDS):
                    continue
                seen.add(url)
                picked.append((label, url, c["name"]))
        picked = picked[:MAX_ARTICLES]
        if not picked:
            return
        with ThreadPoolExecutor(max_workers=5) as ex:
            bodies = list(ex.map(lambda t: page(t[1], t[0]), picked))
        for (label, url, sname), b in zip(picked, bodies):
            if b and len(b) > 300:
                got.append(("[%s] %s" % (sname, label), url, b))

    def search_round():
        """多引擎检索取数（第 2 轮主路径 / 第 1 轮兜底）：不同检索式轮换不同引擎"""
        for qi, q in enumerate((ALT_QUERIES or [])[:MAX_SEARCH_QUERIES]):
            if total() >= MIN_CHARS:
                break
            if not [e for e in ENGINES if e[0] not in _ENGINE_DEAD]:   # 引擎全挂了就别再试
                break
            prefer = ENGINES[qi % len(ENGINES)][0]
            cand = [(t, u) for t, u in multi_search(q, prefer) if u not in seen][:MAX_ARTICLES]
            if not cand:
                continue
            engines_used.append(prefer)
            for _t, u in cand:
                seen.add(u)
            with ThreadPoolExecutor(max_workers=4) as ex:
                bodies = list(ex.map(lambda tu: page(tu[1], tu[0]), cand))
            for (t, u), b in zip(cand, bodies):
                if b and len(b) > 300:
                    got.append(("[检索·%s·%s] %s" % (DIM, prefer, t), u, b))

    if ROUND == "2":                    # 第 2 轮：检索优先（补第 1 轮没覆盖到的角度）
        search_round()
        if total() < MIN_CHARS:
            retried = True
            source_round()
    else:                               # 第 1 轮：权威源优先
        source_round()
        if total() < MIN_CHARS:
            retried = True
            search_round()

    total_chars = total()
    lines, used = [], 0
    for i, (t, u, b) in enumerate(got, 1):
        if used >= MAX_CHARS:
            break
        chunk = b[: max(0, MAX_CHARS - used)]
        used += len(chunk)
        lines.append("[材料 %d] %s\n来源: %s\n%s" % (i, t, u, chunk))

    print("轮次=%s 维度=%s 策略=%s 可用源=%d（%s）跳过上轮已用=%d"
          % (ROUND, DIM, "检索优先" if ROUND == "2" else "权威源优先", len(found), src_names, len(seen)))
    if ROUND == "1":
        save_seen([u for _, u, _b in got])       # ★ 供第 2 轮去重（走临时文件，不进代码参数）
    print("%s 维度=%s 材料=%d字 篇数=%d 兜底启用=%s%s"
          % ("MATERIAL_OK" if total_chars >= MIN_CHARS else "MATERIAL_THIN", DIM, total_chars, len(got),
             "是" if retried else "否",
             ("（引擎：" + "、".join(engines_used) + "）") if engines_used else ""))
    print("（以下为多源抓取的网页正文，请对照不同来源交叉印证；确无覆盖的项请写进数据缺口）")
    print("\n\n".join(lines) if lines else "（未抓到正文——请明确指出该维度材料不足，不要编造）")


try:
    main()
except Exception as e:                     # ★ 永不失败
    print("MATERIAL_FAILED 维度=%s 未预期异常: %s" % (DIM, e))
sys.exit(0)
