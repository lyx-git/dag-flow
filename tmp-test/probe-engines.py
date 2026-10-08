# -*- coding: utf-8 -*-
"""探测：python 侧能不能直接抓多个搜索引擎（为「搜索引擎用多个不同的」选可用引擎）"""
import json, re, ssl, sys, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE
Q = "央行 货币政策 降准"


def get(url, timeout=12):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9"})
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        return r.read(700000)


def dec(raw):
    for e in ("utf-8", "gb18030", "gbk"):
        try:
            return raw.decode(e)
        except Exception:
            continue
    return raw.decode("utf-8", errors="ignore")


def e_bing():
    h = dec(get("https://www.bing.com/search?" + urllib.parse.urlencode({"q": Q, "mkt": "zh-CN"})))
    out = []
    for b in re.findall(r'(?s)<li class="b_algo".*?</li>', h):
        m = re.search(r'<a[^>]*href="(https?://[^"]+)"', b)
        t = re.search(r"(?s)<h2[^>]*>.*?<a[^>]*>(.*?)</a>", b)
        if m:
            out.append((re.sub(r"<[^>]+>", "", t.group(1)).strip() if t else "", m.group(1)))
    return out


def e_ddglite():
    h = dec(get("https://lite.duckduckgo.com/lite/?" + urllib.parse.urlencode({"q": Q})))
    out = []
    for m in re.finditer(r'(?is)<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', h):
        out.append((re.sub(r"<[^>]+>", "", m.group(2)).strip(), m.group(1)))
    if not out:   # 备用结构：rel=nofollow
        for m in re.finditer(r'(?is)<a[^>]+rel="nofollow"[^>]*href="(http[^"]+)"[^>]*>(.*?)</a>', h):
            out.append((re.sub(r"<[^>]+>", "", m.group(2)).strip(), m.group(1)))
    return out


def e_ddghtml():
    h = dec(get("https://html.duckduckgo.com/html/?" + urllib.parse.urlencode({"q": Q})))
    out = []
    for m in re.finditer(r'(?is)<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', h):
        out.append((re.sub(r"<[^>]+>", "", m.group(2)).strip(), m.group(1)))
    return out


def e_searxng(base):
    def one(base):
        h = dec(get(base + "/search?" + urllib.parse.urlencode({"q": Q, "format": "json"})))
        try:
            d = json.loads(h)
            return [(r.get("title", ""), r.get("url", "")) for r in d.get("results", [])]
        except Exception:
            return []
    return one(base)


ENGINES = [
    ("bing", e_bing),
    ("ddg-lite", e_ddglite),
    ("ddg-html", e_ddghtml),
    ("searxng:opnxng", lambda: e_searxng("https://opnxng.com")),
    ("searxng:priv.au", lambda: e_searxng("https://priv.au")),
    ("searxng:searx.be", lambda: e_searxng("https://searx.be")),
]

def safe(fn):
    try:
        return fn()
    except Exception as e:
        return [("__ERR__", str(e)[:70])]


with ThreadPoolExecutor(max_workers=6) as ex:
    outs = list(ex.map(lambda e: safe(e[1]), ENGINES))

for (name, _fn), res in zip(ENGINES, outs):
    if res and res[0][0] == "__ERR__":
        print("[FAIL] %-18s %s" % (name, res[0][1]))
    else:
        print("[%4d条] %-18s  例: %s" % (len(res), name, (res[0][0][:44] + " ← " + res[0][1][:56]) if res else "(无结果)"))
sys.exit(0)
