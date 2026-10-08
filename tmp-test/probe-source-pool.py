# -*- coding: utf-8 -*-
"""探测：候选权威源池（20 个）——哪些能抓到「列表页 → 标题链接」，为「自动发现可用源」建池"""
import re, ssl, sys, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE

# (名称, URL, 适用维度标签)
POOL = [
    ("央行-沟通交流", "http://www.pbc.gov.cn/goutongjiaoliu/113456/113469/index.html", ["政策", "汇率"]),
    ("央行-货币政策司", "http://www.pbc.gov.cn/zhengcehuobisi/125207/125213/index.html", ["政策", "资金"]),
    ("财政部-财政新闻", "https://www.mof.gov.cn/zhengwuxinxi/caizhengxinwen/", ["政策"]),
    ("证监会-要闻", "http://www.csrc.gov.cn/csrc/c100028/common_list.shtml", ["政策", "股市"]),
    ("金融监管总局", "https://www.nfra.gov.cn/cn/view/pages/ItemList.html?itemPId=923&itemId=931", ["政策", "银行"]),
    ("国家外汇局-新闻", "https://www.safe.gov.cn/safe/whxw/index.html", ["汇率"]),
    ("国家统计局-数据解读", "https://www.stats.gov.cn/sj/sjjd/", ["资金", "国际"]),
    ("证券时报", "https://www.stcn.com/", ["政策", "资金", "股市", "基金", "汇率", "银行", "国际"]),
    ("东方财富-财经要闻", "https://finance.eastmoney.com/a/ccjdd.html", ["资金", "股市", "基金", "银行"]),
    ("东方财富-股票频道", "https://stock.eastmoney.com/", ["股市"]),
    ("东方财富-基金频道", "https://fund.eastmoney.com/", ["基金"]),
    ("中国证券报", "https://www.cs.com.cn/", ["政策", "股市", "基金"]),
    ("上海证券报", "https://www.cnstock.com/", ["政策", "股市", "银行"]),
    ("新浪财经", "https://finance.sina.com.cn/", ["资金", "股市", "国际"]),
    ("第一财经", "https://www.yicai.com/", ["政策", "资金", "国际"]),
    ("华尔街见闻", "https://wallstreetcn.com/", ["国际", "资金"]),
    ("中国货币网", "https://www.chinamoney.com.cn/chinese/", ["汇率", "资金"]),
    ("央视网-联播按日页", "https://tv.cctv.com/lm/xwlb/day/20261007.shtml", ["官方"]),
    ("新华网-财经", "http://www.news.cn/fortune/", ["政策", "国际"]),
    ("人民网-财经", "http://finance.people.com.cn/", ["政策", "银行"]),
]


def get(url, timeout=10):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9"})
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
    html = re.sub(r"(?is)<br\s*/?>|</p>|</div>|</li>|</h[1-6]>|</tr>|</a>", "\n", html)
    html = re.sub(r"(?s)<[^>]+>", " ", html)
    html = html.replace("&nbsp;", " ").replace("&amp;", "&")
    html = re.sub(r"[ \t\r\f\v\u3000]+", " ", html)
    return re.sub(r"\n\s*\n+", "\n", html).strip()


def headlines(base, html):
    n = 0
    for m in re.finditer(r'(?is)<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', html):
        label = re.sub(r"\s+", " ", text_of(m.group(2))).strip()
        if 12 <= len(label) <= 90:
            n += 1
    return n


def probe(item):
    name, url, tags = item
    try:
        raw, ctype = get(url)
        html = decode(raw, ctype)
        txt = text_of(html)
        h = headlines(url, html)
        return (name, url, tags, len(txt), h, None)
    except Exception as e:
        return (name, url, tags, 0, 0, str(e)[:80])


ok = []
with ThreadPoolExecutor(max_workers=6) as ex:
    for name, url, tags, chars, h, err in ex.map(probe, POOL):
        if err:
            print("[FAIL] %-20s %s → %s" % (name, url, err))
        elif h >= 5 and chars > 400:
            print("[ OK ] %-20s %5d字 标题链接%3d  ← %s" % (name, chars, h, url))
            ok.append((name, url, tags))
        else:
            print("[ WEAK] %-20s %5d字 标题链接%3d（JS 渲染或导航为主）← %s" % (name, chars, h, url))

print("\n=== 可用源 %d 个（写入候选池）===" % len(ok))
for name, url, tags in ok:
    print('  "%s"  %s  %s' % (name, url, ",".join(tags)))
sys.exit(0)
