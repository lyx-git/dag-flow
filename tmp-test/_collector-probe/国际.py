# -*- coding: utf-8 -*-
"""单维度金融材料采集器（dag-flow python 节点代码模板，由构建脚本注入占位符）

管线：权威列表页 → 按维度关键词筛标题 → 抓文章正文 → 并入上游搜索结果
      → 材料不足则【换检索方向重搜】(bing) → 输出给下游 AI 的材料文本

约束：① 永不失败（异常只打印状态行 + exit 0，绝不中断 DAG）
     ② stdout 即材料正文（python 节点 out = stdout 字符串）
     ③ 只用标准库（内置 Python 3.12）
"""
import json, re, ssl, sys, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

DIM = "国际"
SOURCES = ["https://www.stcn.com/","https://finance.eastmoney.com/a/ccjdd.html"]          # 该维度的权威列表页（实测可抓）
KEYWORDS = ["美联储","美国","欧洲","欧央行","日本","美债","美股","油价","黄金","地缘","关税","通胀","非农","全球"]        # 该维度的标题筛选词
ALT_QUERIES = ["全球市场 隔夜 美股 美债 表现","美联储 降息 预期 最新 表态"]          # 材料不足时换方向的检索式
RAW = [{"url":"https://www.federalreserve.gov/","title":"Federal Reserve Board - Home","snippet":"1 天前&ensp;&#0183;&ensp;Learn about protecting yourself, friends, and family from fraud and scams. Find, review, and submit comments on Board …"},{"url":"https://baike.baidu.com/item/%E7%BE%8E%E5%9B%BD%E8%81%94%E9%82%A6%E5%82%A8%E5%A4%87%E7%B3%BB%E7%BB%9F/2297802","title":"美国联邦储备系统_百度百科","snippet":"美国联邦储备系统（Federal Reserve System [30]），简称美联储，成立于1913年，是私人所有的美国 中央银行。 它独立于国会，兼 …"},{"url":"https://baike.baidu.com/item/%E7%BE%8E%E5%9B%BD%E8%81%94%E9%82%A6%E5%82%A8%E5%A4%87%E5%A7%94%E5%91%98%E4%BC%9A/10479629","title":"美国联邦储备委员会_百度百科","snippet":"美国联邦储备委员会（Board of Governors of the Federal Reserve System），全称为联邦储备系统理事会，也称联邦储备系统管理委 …"},{"url":"https://www.cls.cn/subject/3140","title":"美联储 动态 - CLS.CN","snippet":"15 小时之前&ensp;&#0183;&ensp;【美联储理事沃勒：仍需进一步加息 但加息节奏存在“灵活性”】财联社10月8日电，美联储理事沃勒表示，仍需进一步加 …"},{"url":"https://www3.xinhuanet.com/20260917/7e24775b33874df8a1a70cfa99b93690/c.html","title":"美联储 三年多来首次加息-新华网","snippet":"2026年9月17日&ensp;&#0183;&ensp;美联储三年多来首次加息- 9月16日，在美国首都华盛顿，美国联邦储备委员会主席凯文&#183;沃什出席记者会。新华社记 …"},{"url":"https://news.cctv.com/2026/09/17/ARTIipBESE1GGybo6WK8ZszZ260917.shtml","title":"财经老王 | 美联储 加息影响多国，对我们有何影响？一文讲 ...","snippet":"2026年9月17日&ensp;&#0183;&ensp;央视网消息： 美联储三年多来首次加息，为什么？对我们又有哪些影响？来看总台央视记者王雷——财经老王带来的 …"},{"url":"https://news.qq.com/rain/a/20251030A052AH00","title":"拆解 美联储 ：从运作机制到全球影响，一文读懂“美元霸权 ...","snippet":"2025年10月30日&ensp;&#0183;&ensp;近期 新青年馆邀请了上海交通大学高级金融学院教授，美联储原高级经济学家胡捷，聊了一些大家关注的问题。 包 …"},{"url":"https://cn.investing.com/central-banks/federal-reserve","title":"美联储 - Investing.com","snippet":"美国联邦储备系统（The Federal Reserve System），简称美联储（Federal Reserve），是美国的中央银行体系。 美国联邦储备系统 …"}]                  # 上游 web_search 的 results（[{title,url,snippet}]）

MIN_CHARS = 2500
MAX_CHARS = 16000
PER_ARTICLE = 4200
MAX_ARTICLES = 5
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
        return r.read(600000), (r.headers.get("Content-Type") or "")


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
    html = re.sub(r"\n\s*\n+", "\n", html)
    return html.strip()


def trim_nav(txt, title):
    """去掉正文前面的导航块：优先从标题处开始；否则丢掉开头的短菜单行"""
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
        raw, ctype = http(url)
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


def relevant(label):
    return any(k in label for k in KEYWORDS)


def collect_from_sources():
    """列表页 → 筛选 → 文章正文"""
    picked, seen = [], set()
    for src in SOURCES:
        try:
            raw, ctype = http(src)
            html = decode(raw, ctype)
        except Exception:
            continue
        for label, url in headline_links(src, html):
            if len(picked) >= MAX_ARTICLES * 3:
                break
            if url in seen or not relevant(label):
                continue
            seen.add(url)
            picked.append((label, url))
    picked = picked[:MAX_ARTICLES]
    if not picked:
        return []
    with ThreadPoolExecutor(max_workers=5) as ex:
        bodies = list(ex.map(lambda lu: page(lu[1], lu[0]), picked))
    return [("【%s】%s" % (DIM, t), u, b) for (t, u), b in zip(picked, bodies) if b and len(b) > 300]


def main():
    got, retried = [], False
    for t, u, b in collect_from_sources():
        got.append((t, u, b))

    def total():
        return sum(len(b) for _, _, b in got)

    if total() < MIN_CHARS:                 # ★ 材料不足 → 换检索方向重搜
        retried = True
        for q in (ALT_QUERIES or []):
            if total() >= MIN_CHARS:
                break
            cand = [(t, u) for t, u in bing(q)][:MAX_ARTICLES]
            if not cand:
                continue
            with ThreadPoolExecutor(max_workers=4) as ex:
                bodies = list(ex.map(lambda tu: page(tu[1], tu[0]), cand))
            for (t, u), b in zip(cand, bodies):
                if b and len(b) > 300:
                    got.append(("【%s·重搜】%s" % (DIM, t), u, b))

    lines, used = [], 0
    for i, (t, u, b) in enumerate(got, 1):
        if used >= MAX_CHARS:
            break
        chunk = b[: max(0, MAX_CHARS - used)]
        used += len(chunk)
        lines.append("[材料 %d] %s\n来源: %s\n%s" % (i, t, u, chunk))

    status = "MATERIAL_OK" if total() >= MIN_CHARS else "MATERIAL_THIN"
    print("%s 维度=%s 材料=%d字 篇数=%d 换方向重搜=%s"
          % (status, DIM, total(), len(got), "是" if retried else "否"))

    snippets = [r for r in (RAW if isinstance(RAW, list) else []) if r.get("title")][:8]
    if snippets:
        print("\n【上游搜索命中（标题/摘要，供交叉印证）】")
        for r in snippets:
            print("- %s | %s | %s" % (r.get("title", ""), r.get("url", ""), str(r.get("snippet", ""))[:160]))
    print("\n【抓取到的网页正文】")
    print("\n\n".join(lines) if lines else "（未抓到正文——请只依据上面的搜索命中分析，并明确指出材料不足）")


try:
    main()
except Exception as e:                     # ★ 永不失败
    print("MATERIAL_FAILED 维度=%s 未预期异常: %s" % (DIM, e))
sys.exit(0)
