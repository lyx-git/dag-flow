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

DIM = "股市"
SOURCES = ["https://www.stcn.com/","https://finance.eastmoney.com/a/ccjdd.html"]          # 该维度的权威列表页（实测可抓）
KEYWORDS = ["A股","股市","上证","深证","创业板","指数","板块","涨","跌","行情","涨停","个股","沪指","收盘"]        # 该维度的标题筛选词
ALT_QUERIES = ["股市 复盘 涨跌 原因 分析","沪深两市 收盘 板块 表现"]          # 材料不足时换方向的检索式
RAW = [{"url":"https://www.52pojie.cn/thread-2118463-1-1.html","title":"A 股 智能监控 (适合打工人盯盘） - 吾爱破解 - 52pojie.cn","snippet":"2026年7月22日&ensp;&#0183;&ensp;吾爱破解 - 52pojie.cn &#187; 网站 › 【 软件安全 】 › 『精品软件区』 › A股智能监控 (适合打工人盯盘） 返回列表 查看: …"},{"url":"https://www.52pojie.cn/thread-2098643-1-1.html","title":"请老师写通达信综合选 股 {循环启动} - 吾爱破解 - 52pojie.cn","snippet":"2026年3月22日&ensp;&#0183;&ensp;吾爱破解 - 52pojie.cn &#187; 网站 › 【 软件安全 】 › 『悬赏问答区』 › 请老师写通达信综合选股 {循环启动} / 3 页 返回列 …"},{"url":"https://www.52pojie.cn/thread-1223458-1-1.html","title":"一套通达信交易系统的条件选 股 公式，带使用说明 - 吾爱破解 ...","snippet":"2020年7月21日&ensp;&#0183;&ensp;最近股市很火，分享一套交易系统。 压缩包内含十多个条件选股公式，适用于Windows通达信和一个PDF（原书）， …"},{"url":"https://www.52pojie.cn/thread-1961619-1-1.html","title":"通达信选 股 体系 - 吾爱破解 - 52pojie.cn","snippet":"2024年9月5日&ensp;&#0183;&ensp;吾爱破解 - 52pojie.cn &#187; 网站 › 【 软件安全 】 › 『悬赏问答区』 › old_thread › 通达信选股体系 1 2 / 2 页 下一页 返回 …"},{"url":"https://www.52pojie.cn/thread-2109404-1-1.html","title":"表格看盘V20.04 - 吾爱破解 - 52pojie.cn","snippet":"2026年5月25日&ensp;&#0183;&ensp;是一个集盯盘、复盘，仓位管理于一身的看盘表格。可以自动获取股票的实时数据、历史数据，个股、板块、指数 …"},{"url":"https://www.52pojie.cn/thread-2055646-1-1.html","title":"A 股 主要指数实时监控工具2.1.0【支持添加指数、股票】 - 吾 ...","snippet":"2025年8月28日&ensp;&#0183;&ensp;实现功能： 1、多数据源获取指定A股指数，确保能获取到实时指数数据； 2、实时监控刷新； 通过网盘分享的文 …"},{"url":"https://www.52pojie.cn/thread-1742283-1-1.html","title":"原贴在这里（通达信） - 吾爱破解 - 52pojie.cn","snippet":"2023年2月5日&ensp;&#0183;&ensp;原贴在这里（通达信） 吾爱破解 - 52pojie.cn &#187; 网站 › 【 软件安全 】 › 『悬赏问答区』 › old_thread › 原贴在这里（通 …"},{"url":"https://www.52pojie.cn/thread-2045938-1-1.html","title":"求通达信金钻指标主图副图选 股 ，无加密的！谢谢 - 吾爱破解 ...","snippet":"2025年7月15日&ensp;&#0183;&ensp;求通达信金钻指标主图副图选股，无加密的！谢谢 [经验求助] 求通达信金钻指标主图副图选股，无加密的！谢谢 [复 …"}]                  # 上游 web_search 的 results（[{title,url,snippet}]）

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
