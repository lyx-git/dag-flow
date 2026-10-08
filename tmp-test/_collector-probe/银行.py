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

DIM = "银行"
SOURCES = ["https://www.stcn.com/","https://finance.eastmoney.com/a/ccjdd.html"]          # 该维度的权威列表页（实测可抓）
KEYWORDS = ["银行","存款","贷款","净息差","不良","息差","信贷","理财","拨备","大行"]        # 该维度的标题筛选词
ALT_QUERIES = ["银行股 业绩 息差 财报 分析","商业银行 信贷 投放 数据 最新"]          # 材料不足时换方向的检索式
RAW = [{"url":"https://www.icbc.com.cn/","title":"中国工商 银行 中国网站","snippet":"1 天前&ensp;&#0183;&ensp;工商银行金融服务全面介绍，投资理财信息丰富全面，在线交易方便快捷，满足客户专业化、多元化、人性化的金融服务需 …"},{"url":"https://www.boc.cn/","title":"中国 银行 网站_全球门户首页","snippet":"2026年9月30日&ensp;&#0183;&ensp;中国银行是中国国际化和多元化程度最高的银行，在中国内地及六十多个国家和地区为客户提供全面的金融服务。 主 …"},{"url":"https://www2.ccb.com/chn/home/ebank/new/intro/web/index.shtml","title":"中国建设 银行 -网上 银行","snippet":"初始化栏目：网上银行 中国建设银行，在全球范围内为台湾、香港、美国、澳大利亚等国家或地区提供全面金融服务，主要经营公司 …"},{"url":"https://cmbchina.com/","title":"一网通主页 -- 招商 银行 官方网站","snippet":"15 小时之前&ensp;&#0183;&ensp;办理卡片申请,智能存款,转账汇款,网上支付,投资理财,贷款消费,信用卡还款,生活缴费,外汇买卖,实时利率,汇率查询,公司 …"},{"url":"https://www.cib.com.cn/","title":"首页 -- 兴业 银行 官方网站","snippet":"2026年9月30日&ensp;&#0183;&ensp;总行信函投诉地址： 福建省福州市台江区江滨中大道398号兴业银行大厦 邮编：350014 金融消费者保护服务平台： …"},{"url":"https://bank.pingan.com/","title":"平安 银行 官方网站","snippet":"平安银行致力于为客户提供全方位的银行服务。 您可以了解投资理财、贷款、个人通知存款、银行缴费、公司业务等平安银行业务， …"},{"url":"https://www.ccb.com/cn/home/index.html","title":"中国建设 银行 -个人客户","snippet":"此外，我行部分分行支持数字人民币兑换纪念币，北京市、大连市、宁波市、厦门市全辖支持数字人民币兑换；浙江省杭州、温州、湖 …"},{"url":"https://baike.baidu.com/item/%E9%93%B6%E8%A1%8C/392719","title":"银行 （依法经营货币信贷业务的金融机构）_百度百科","snippet":"根据中华人民共和国的法律，银行分为中央银行（中国人民银行）、商业银行（含 农村信用合作社 和新型农村金融机构）、政策性银 …"}]                  # 上游 web_search 的 results（[{title,url,snippet}]）

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
