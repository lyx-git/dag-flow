# -*- coding: utf-8 -*-
"""探测：一批金融权威站点的列表/要闻页，哪些能抓到可用的正文（标题级内容）"""
import re, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

URLS = [
    ("央行-沟通交流", "http://www.pbc.gov.cn/goutongjiaoliu/113456/113469/index.html"),
    ("财政部-新闻", "https://www.mof.gov.cn/zhengwuxinxi/caizhengxinwen/"),
    ("证监会-要闻", "http://www.csrc.gov.cn/csrc/c100028/common_list.shtml"),
    ("东方财富-财经要闻", "https://finance.eastmoney.com/a/ccjdd.html"),
    ("证券时报", "https://www.stcn.com/"),
    ("中国货币网", "https://www.chinamoney.com.cn/chinese/"),
    ("国家外汇局", "https://www.safe.gov.cn/safe/whxw/index.html"),
    ("上交所-新闻", "http://www.sse.com.cn/aboutus/mediacenter/hotandd/"),
    ("新浪财经", "https://finance.sina.com.cn/"),
    ("央视网-联播按日页", "https://tv.cctv.com/lm/xwlb/day/20261007.shtml"),
]


def get(url, timeout=10):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(500000), (r.headers.get("Content-Type") or "")


def decode(raw, ctype):
    for e in (["utf-8"] if "utf-8" in ctype.lower() else []) + ["utf-8", "gb18030", "gbk"]:
        try:
            return raw.decode(e)
        except Exception:
            continue
    return raw.decode("utf-8", errors="ignore")


def text_of(html):
    html = re.sub(r"(?is)<(script|style|noscript|svg|head|nav|footer)[^>]*>.*?</\1>", " ", html)
    html = re.sub(r"(?is)<!--.*?-->", " ", html)
    html = re.sub(r"(?is)<br\s*/?>|</p>|</div>|</li>|</h[1-6]>|</tr>|</a>", "\n", html)
    html = re.sub(r"(?s)<[^>]+>", " ", html)
    html = html.replace("&nbsp;", " ").replace("&amp;", "&")
    html = re.sub(r"[ \t\r\f\v\u3000]+", " ", html)
    html = re.sub(r"\n\s*\n+", "\n", html)
    return html.strip()


def probe(item):
    name, url = item
    try:
        raw, ctype = get(url)
        txt = text_of(decode(raw, ctype))
        lines = [l.strip() for l in txt.split("\n") if len(l.strip()) > 8]
        return (name, url, len(txt), len(lines), " ｜ ".join(lines[:6])[:220], None)
    except Exception as e:
        return (name, url, 0, 0, "", str(e)[:90])


with ThreadPoolExecutor(max_workers=6) as ex:
    for name, url, chars, lines, head, err in ex.map(probe, URLS):
        if err:
            print("[FAIL] %-16s %s  → %s" % (name, url, err))
        else:
            print("[%5d字 %3d行] %-16s %s" % (chars, lines, name, url))
            print("         %s" % head)
sys.exit(0)
