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

DIM = "汇率"
SOURCES = ["http://www.pbc.gov.cn/goutongjiaoliu/113456/113469/index.html","https://www.stcn.com/"]          # 该维度的权威列表页（实测可抓）
KEYWORDS = ["汇率","人民币","美元","中间价","离岸","外汇","贬值","升值","货币网","结售汇"]        # 该维度的标题筛选词
ALT_QUERIES = ["人民币 汇率 中间价 走势 分析","外汇局 跨境资金 流动 数据"]          # 材料不足时换方向的检索式
RAW = [{"url":"https://baike.baidu.com/item/%E4%BA%BA%E6%B0%91%E5%B8%81/330794","title":"人民币 （中华人民共和国法定货币）_百度百科","snippet":"人民币（英语：Renminbi [52]，缩写：RMB，货币代码：CNY，货币符号：￥ [53]），全称中国人民银行币，是指 中国人民银行 依法 …"},{"url":"https://baike.baidu.com/item/%EF%BF%A5/1298007","title":"￥_百度百科","snippet":"&#165;（全称人民币符号，又称元符号；英文yen sign/yuan sign，源出拉丁字母）是用于表示人民币 “元” 与日元 “円” 的货币书写符号，形 …"},{"url":"https://themoneyconverters.com/zh-CN","title":"汇率换算工具 | 人民币 汇率","snippet":"4 小时之前&ensp;&#0183;&ensp;在中华民国时代，不同种类的货币流通于中国。 它们的大多数都被称为“元”。 1948年中国人民银行开始发行统一的货币人 …"},{"url":"https://tool.gaodun.com/rmb.html","title":"人民币 大写转换工具-在线 人民币 大写转换器_ 人民币 大小写 ...","snippet":"2025年5月6日&ensp;&#0183;&ensp;人民币在ISO 4217简称为CNY（China Yuan），常用简写为RMB（Ren Min Bi）；人民币货币的符号是“ …"},{"url":"https://finance.sina.com.cn/money/forex/hq/USDCNY.shtml","title":"美元兑 人民币 (USDCNY)_外汇_新浪财经_新浪网","snippet":"新浪财经外汇兑换计算器为您提供今日USD对CNY汇率,USD兑换CNY (USDCNY)走势图,快速换算一USD兑换多少CNY. 意见反馈： …"},{"url":"https://forex.eastmoney.com/a/aCNY.html","title":"人民币 _ 东方财富网 - eastmoney.com","snippet":"2026年8月27日&ensp;&#0183;&ensp;升破6.8关口！ 人民币对美元即期汇率升至39个月新高2026年05月11日 10:27 人民币兑美元中间价报6.8467 上调35 …"},{"url":"https://freeunitconvert.com/cn/currency/CNY/","title":"人民币 汇率换算 - 今日 人民币 (CNY)汇率查询 ...","snippet":"15 小时之前&ensp;&#0183;&ensp;人民币（Renminbi 或 Chinese yuan 货币缩写为：RMB、CNY）是中华人民共和国的法定货币，人民币的单位为元，人 …"},{"url":"https://www.boc.cn/sourcedb/whpj/","title":"中国银行网站_金融市场_外汇牌价","snippet":"1 天前&ensp;&#0183;&ensp;上一页 1 2 3 4 5 下一页 中国银行外汇牌价网页声明： 1.本汇率表单位为100外币换算人民币，仅供参考，客户办理结/购汇业 …"}]                  # 上游 web_search 的 results（[{title,url,snippet}]）

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
