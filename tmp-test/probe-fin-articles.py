# -*- coding: utf-8 -*-
"""探测第二环：列表页 → 文章链接 → 文章正文（含政府站关 SSL 校验）"""
import re, ssl, sys, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

LISTS = [
    ("央行-沟通交流", "http://www.pbc.gov.cn/goutongjiaoliu/113456/113469/index.html"),
    ("财政部-新闻", "https://www.mof.gov.cn/zhengwuxinxi/caizhengxinwen/"),
    ("证券时报", "https://www.stcn.com/"),
    ("东方财富-要闻", "https://finance.eastmoney.com/a/ccjdd.html"),
]


def get(url, timeout=10):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9"})
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
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


def links(base, html, limit=4):
    out, seen = [], set()
    for m in re.finditer(r'(?is)<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', html):
        href, label = m.group(1), text_of(m.group(2)).replace("\n", " ").strip()
        if len(label) < 12 or len(label) > 90:
            continue
        url = urllib.parse.urljoin(base, href)
        if url in seen or not url.startswith("http"):
            continue
        seen.add(url)
        out.append((label, url))
        if len(out) >= limit:
            break
    return out


def probe(item):
    name, url = item
    print("\n=========== %s  %s ===========" % (name, url))
    try:
        raw, ctype = get(url)
        html = decode(raw, ctype)
    except Exception as e:
        print("  [列表页失败] %s" % str(e)[:110])
        return
    txt = text_of(html)
    print("  列表页正文 %d 字；取前 4 条链接跟进去看正文：" % len(txt))
    for label, u in links(url, html):
        try:
            raw2, ct2 = get(u)
            body = text_of(decode(raw2, ct2))
            print("   → [%5d字] %s" % (len(body), label[:44]))
            print("       %s" % u[:96])
            print("       正文开头: %s" % body[:150].replace("\n", " "))
        except Exception as e:
            print("   → [失败] %s  %s" % (label[:40], str(e)[:70]))


with ThreadPoolExecutor(max_workers=4) as ex:
    list(ex.map(probe, LISTS))
sys.exit(0)
