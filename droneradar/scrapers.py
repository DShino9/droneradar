"""Per-source fetchers. Every one of these hits a free, keyless endpoint."""
import json
import re
import urllib.parse

from . import net
from .net import FetchError

# --------------------------------------------------------------------------
# Article sources
# --------------------------------------------------------------------------


def fetch_rss(source):
    text, _ = net.http_text(source["url"], timeout=25)
    return net.parse_feed(text)


# Split on the opening tag rather than matching through to `</li>`: each item
# nests a `<ul class="list-label">` whose own `</li>` would end the match early,
# truncating the block before the title.
_DJ_SPLIT_RE = re.compile(r'<li class="item[^"]*">')
_DJ_URL_RE = re.compile(r'href="(https://drone-journal\.impress\.co\.jp/docs/[^"]+\.html)"')
_DJ_IMG_RE = re.compile(r'<img[^>]*ajax="([^"]+)"')
_DJ_TITLE_RE = re.compile(r'<p class="title"><a[^>]*>(.*?)</a>', re.S)
_DJ_DATE_RE = re.compile(r'<p class="date">\(([^)]+)\)</p>')
_DJ_LABEL_RE = re.compile(r'<span class="label[^"]*">([^<]+)</span>')


def fetch_dronejournal(source):
    """Impress's ドローンジャーナル has no feed, so read the listing page.

    The markup is server-rendered `<li class="item …">` blocks; only the
    thumbnails are lazy-loaded, and those carry their real path in `ajax=`.
    """
    text, base = net.http_text(source["url"], timeout=25)
    out = []
    for block in _DJ_SPLIT_RE.split(text)[1:]:
        m_url = _DJ_URL_RE.search(block)
        m_title = _DJ_TITLE_RE.search(block)
        if not m_url or not m_title:
            continue
        title = net.strip_html(m_title.group(1), 300)
        if not title:
            continue
        img = None
        m_img = _DJ_IMG_RE.search(block)
        if m_img:
            img = urllib.parse.urljoin(base, m_img.group(1))
        published = 0
        m_date = _DJ_DATE_RE.search(block)
        if m_date:
            published = net.parse_date(m_date.group(1).replace("/", "-"))
        labels = [net.strip_html(x, 20) for x in _DJ_LABEL_RE.findall(block)]
        out.append({
            "title": title,
            "url": m_url.group(1),
            "summary": "",
            "published": published,
            "image": img,
            "author": "",
            "tags": [t for t in labels if t and t != "ニュース"],
        })
    if not out:
        raise FetchError("記事ブロックを検出できませんでした")
    return out


def fetch_arxiv(source):
    q = source["url"]
    url = ("http://export.arxiv.org/api/query?search_query=%s"
           "&sortBy=submittedDate&sortOrder=descending&max_results=40"
           % urllib.parse.quote("all:(%s)" % q))
    text, _ = net.http_text(url, timeout=30)
    return net.parse_feed(text)


def fetch_hn(source):
    q = source["url"]
    url = ("https://hn.algolia.com/api/v1/search_by_date?query=%s&tags=story"
           "&hitsPerPage=40&typoTolerance=false"
           % urllib.parse.quote(q))
    data = net.http_json(url, timeout=25)
    out = []
    for h in data.get("hits", []):
        title = h.get("title") or h.get("story_title") or ""
        # Algolia still returns loose matches; keep only real hits on the term.
        blob = (title + " " + (h.get("story_text") or "")).lower()
        if q.lower() not in blob:
            continue
        out.append({
            "title": net.strip_html(title, 300),
            "url": h.get("url") or "https://news.ycombinator.com/item?id=%s" % h.get("objectID"),
            "summary": net.strip_html(h.get("story_text") or "", 300),
            "published": int(h.get("created_at_i") or 0),
            "image": None,
            "author": h.get("author") or "",
            "points": h.get("points") or 0,
            "comments": h.get("num_comments") or 0,
        })
    return out


def fetch_github(source):
    url = ("https://api.github.com/search/repositories?q=%s&sort=updated&per_page=30"
           % urllib.parse.quote(source["url"]))
    data = net.http_json(url, timeout=25)
    out = []
    for r in data.get("items", []):
        out.append({
            "title": "%s — %s" % (r["full_name"], r.get("description") or ""),
            "url": r["html_url"],
            "summary": net.strip_html(r.get("description") or "", 300),
            "published": net.parse_date(r.get("pushed_at") or ""),
            # Deliberately no image: an owner avatar stretched to a 16:9 card
            # thumbnail looks like a mistake. The generated placeholder reads
            # better.
            "image": None,
            "author": r.get("owner", {}).get("login", ""),
            "stars": r.get("stargazers_count", 0),
        })
    return out


_YT_DATA_RE = re.compile(r"var ytInitialData = (\{.*?\});</script>", re.S)

# YouTube only reports "3 週間前", never a timestamp, so relative text is all
# we have to date a video by.
_REL_UNITS = [
    (("秒", "second"), 1),
    (("分", "minute"), 60),
    (("時間", "hour"), 3600),
    (("日", "day"), 86400),
    (("週間", "week"), 604800),
    (("か月", "ヶ月", "カ月", "month"), 2592000),
    (("年", "year"), 31536000),
]


def parse_relative_time(text):
    """'1 時間前' / '3 weeks ago' -> epoch seconds. 0 when unparseable."""
    if not text:
        return 0
    m = re.search(r"(\d+)", text)
    if not m:
        return 0
    n = int(m.group(1))
    # Longest unit first: 時間 must beat 時, か月 must beat 月.
    for names, secs in sorted(_REL_UNITS, key=lambda p: -max(len(x) for x in p[0])):
        if any(name in text for name in names):
            return net.now() - n * secs
    return 0


def _walk_videos(node, out):
    if isinstance(node, dict):
        v = node.get("videoRenderer")
        if isinstance(v, dict) and v.get("videoId"):
            out.append(v)
        for child in node.values():
            _walk_videos(child, out)
    elif isinstance(node, list):
        for child in node:
            _walk_videos(child, out)


def fetch_youtube_search(source):
    """Videos from a YouTube search, newest first.

    The Data API needs a key, but the results page embeds everything we want in
    ytInitialData. `sp=CAI%3D` is the "sort by upload date" filter.
    """
    q = source["url"]
    url = ("https://www.youtube.com/results?search_query=%s&sp=CAI%%253D"
           % urllib.parse.quote(q))
    text, _ = net.http_text(url, timeout=30)
    m = _YT_DATA_RE.search(text)
    if not m:
        raise FetchError("ytInitialData が見つかりません")
    try:
        data = json.loads(m.group(1))
    except ValueError as e:
        raise FetchError("ytInitialData の解析に失敗 (%s)" % str(e)[:40])

    renderers = []
    _walk_videos(data, renderers)
    out = []
    for v in renderers:
        try:
            title = "".join(r.get("text", "") for r in v["title"]["runs"])
        except (KeyError, TypeError):
            continue
        if not title:
            continue
        owner = ""
        try:
            owner = v["ownerText"]["runs"][0]["text"]
        except (KeyError, IndexError, TypeError):
            pass
        thumbs = (v.get("thumbnail") or {}).get("thumbnails") or []
        published = parse_relative_time(
            (v.get("publishedTimeText") or {}).get("simpleText", ""))
        views = (v.get("viewCountText") or {}).get("simpleText", "")
        length = (v.get("lengthText") or {}).get("simpleText", "")
        out.append({
            "title": net.strip_html(title, 300),
            "url": "https://www.youtube.com/watch?v=%s" % v["videoId"],
            "summary": "　".join(x for x in (owner, length, views) if x),
            "published": published,
            "image": thumbs[-1]["url"] if thumbs else None,
            "author": owner,
        })
    if not out:
        raise FetchError("動画を検出できませんでした")
    return out


ARTICLE_FETCHERS = {
    "rss": fetch_rss,
    "dronejournal": fetch_dronejournal,
    "arxiv": fetch_arxiv,
    "hn": fetch_hn,
    "github": fetch_github,
    "youtube_search": fetch_youtube_search,
}


# --------------------------------------------------------------------------
# Live social sources
# --------------------------------------------------------------------------

_NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)


def fetch_yahoo_realtime(source):
    """Yahoo! リアルタイム検索 — the only free route to live X/Twitter posts.

    X killed free API reads and every public Nitter mirror we probed returns
    403, but Yahoo's realtime search renders the timeline into a __NEXT_DATA__
    blob that we can read straight off the page.
    """
    q = source.get("query") or source.get("url") or "ドローン"
    url = "https://search.yahoo.co.jp/realtime/search?p=%s" % urllib.parse.quote(q)
    text, _ = net.http_text(url, timeout=25)
    m = _NEXT_DATA_RE.search(text)
    if not m:
        raise FetchError("__NEXT_DATA__ が見つかりません")
    try:
        data = json.loads(m.group(1))
        entries = data["props"]["pageProps"]["pageData"]["timeline"]["entry"]
    except (KeyError, TypeError, ValueError) as e:
        raise FetchError("タイムライン構造が変化しました (%s)" % str(e)[:40])

    out = []
    for e in entries:
        # Yahoo wraps matched keywords in literal \tSTART\t … \tEND\t markers.
        raw = e.get("displayTextBody") or e.get("displayText") or ""
        text_body = raw.replace("\tSTART\t", "").replace("\tEND\t", "")
        highlights = re.findall(r"\tSTART\t(.*?)\tEND\t", raw)
        url_ = (e.get("url") or "").split("?")[0]
        if not url_:
            continue
        out.append({
            "id": "x:%s" % e.get("id"),
            "network": "x",
            "text": net.strip_html(text_body, 400),
            "highlights": highlights[:4],
            "url": url_,
            "author": e.get("name") or "",
            "handle": "@" + (e.get("screenName") or ""),
            "author_url": (e.get("userUrl") or "").split("?")[0],
            "avatar": e.get("profileImage") or "",
            "created": int(e.get("createdAt") or 0),
            "likes": int(e.get("likesCount") or 0),
            "reposts": int(e.get("rtCount") or 0),
            "replies": int(e.get("replyCount") or 0),
            "verified": bool((e.get("badge") or {}).get("show")),
        })
    return out


def fetch_mastodon(source):
    """Public hashtag timeline; no token needed."""
    host = source["url"].rstrip("/")
    tag = urllib.parse.quote(source.get("query") or "drone")
    url = "%s/api/v1/timelines/tag/%s?limit=25" % (host, tag)
    data = net.http_json(url, timeout=20)
    out = []
    for s in data:
        acct = s.get("account") or {}
        text = net.strip_html(s.get("content") or "", 400)
        if not text:
            continue
        media = (s.get("media_attachments") or [])
        img = media[0].get("preview_url") if media else None
        out.append({
            "id": "mstdn:%s" % s.get("id"),
            "network": "mastodon",
            "text": text,
            "highlights": [],
            "url": s.get("url") or s.get("uri") or "",
            "author": acct.get("display_name") or acct.get("username") or "",
            "handle": "@" + (acct.get("acct") or ""),
            "author_url": acct.get("url") or "",
            "avatar": acct.get("avatar_static") or acct.get("avatar") or "",
            "created": net.parse_date(s.get("created_at") or ""),
            "likes": int(s.get("favourites_count") or 0),
            "reposts": int(s.get("reblogs_count") or 0),
            "replies": int(s.get("replies_count") or 0),
            "image": img,
        })
    return out


def fetch_reddit_social(source):
    text, _ = net.http_text(source["url"], timeout=20)
    entries = net.parse_feed(text)
    out = []
    for e in entries:
        out.append({
            "id": "reddit:%s" % e["url"],
            "network": "reddit",
            "text": e["title"],
            "highlights": [],
            "url": e["url"],
            "author": e.get("author") or "",
            "handle": e.get("author") or "",
            "author_url": "",
            "avatar": "",
            "created": e.get("published") or 0,
            "likes": 0, "reposts": 0, "replies": 0,
            "image": e.get("image"),
        })
    return out


def fetch_hn_social(source):
    items = fetch_hn({"url": source.get("url") or "drone"})
    out = []
    for e in items:
        out.append({
            "id": "hn:%s" % e["url"],
            "network": "hn",
            "text": e["title"],
            "highlights": [],
            "url": e["url"],
            "author": e.get("author") or "",
            "handle": e.get("author") or "",
            "author_url": "",
            "avatar": "",
            "created": e.get("published") or 0,
            "likes": e.get("points", 0),
            "reposts": 0,
            "replies": e.get("comments", 0),
        })
    return out


SOCIAL_FETCHERS = {
    "yahoo_realtime": fetch_yahoo_realtime,
    "mastodon": fetch_mastodon,
    "reddit": fetch_reddit_social,
    "hn_live": fetch_hn_social,
}


# --------------------------------------------------------------------------
# Quotes
# --------------------------------------------------------------------------

_G_NAME_RE = re.compile(r'<div class="gO24Ff">([^<]+)</div>')
_G_PRICE_RE = re.compile(r'jsname="Pdsbrc"[^>]*>\s*<span>([^<]+)</span>')
_G_PCT_RE = re.compile(r'jsname="vY9t3b"[^>]*>\s*<span[^>]*>([^<]+)</span>')
_G_ABS_RE = re.compile(r'jsname="xnruHf"[^>]*>\s*<span>([^<]+)</span>')
_NUM_RE = re.compile(r"-?[\d,]+\.?\d*")


def _num(s):
    if not s:
        return None
    m = _NUM_RE.search(s.replace("−", "-").replace("+", ""))
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", ""))
    except ValueError:
        return None


def _quote_yahoo(stock):
    url = ("https://query1.finance.yahoo.com/v8/finance/chart/%s"
           "?interval=15m&range=5d" % urllib.parse.quote(stock["symbol"]))
    data = net.http_json(url, timeout=20)
    chart = data.get("chart") or {}
    if chart.get("error"):
        raise FetchError(str(chart["error"].get("code")))
    result = (chart.get("result") or [None])[0]
    if not result:
        raise FetchError("no result")
    meta = result.get("meta") or {}
    price = meta.get("regularMarketPrice")
    prev = meta.get("chartPreviousClose") or meta.get("previousClose")
    if price is None:
        raise FetchError("no price")
    spark = []
    try:
        closes = result["indicators"]["quote"][0]["close"]
        spark = [c for c in closes if c is not None][-60:]
    except (KeyError, IndexError, TypeError):
        pass
    change = (price - prev) if prev else 0.0
    return {
        "price": round(price, 2),
        "prev": round(prev, 2) if prev else None,
        "change": round(change, 2),
        "change_pct": round(change / prev * 100, 2) if prev else 0.0,
        "currency": meta.get("currency") or "USD",
        "spark": [round(x, 3) for x in spark],
        "via": "yahoo",
    }


def _quote_google(stock):
    """Fallback when Yahoo rate-limits us. Heavier (~1MB) but keyless."""
    if not stock.get("g"):
        raise FetchError("no google symbol")
    url = "https://www.google.com/finance/quote/%s?hl=en" % stock["g"]
    text, _ = net.http_text(url, timeout=25)

    # The page opens with a market-summary rail whose tiles use the same jsname
    # attributes as the quote itself — searching from position 0 returns the
    # same index price for every symbol. The company-name div marks the start
    # of the real quote block, so anchor the search there.
    anchor = text.find('class="gO24Ff"')
    if anchor < 0:
        raise FetchError("銘柄ブロックが見つかりません")
    body = text[anchor:anchor + 4000]

    m = _G_PRICE_RE.search(body)
    price = _num(m.group(1)) if m else None
    if price is None:
        raise FetchError("価格を抽出できません")
    m = _G_PCT_RE.search(body)
    pct = _num(m.group(1)) if m else 0.0
    if m and "-" in m.group(1):
        pct = -abs(pct or 0)
    m = _G_ABS_RE.search(body)
    change = _num(m.group(1)) if m else 0.0
    if m and "-" in m.group(1):
        change = -abs(change or 0)
    currency = "JPY" if stock["g"].endswith(":TYO") else "USD"
    return {
        "price": round(price, 2),
        "prev": round(price - (change or 0), 2),
        "change": round(change or 0, 2),
        "change_pct": round(pct or 0, 2),
        "currency": currency,
        "spark": [],
        "via": "google",
    }


def fetch_quote(stock):
    """Yahoo first, Google Finance as the backup."""
    errors = []
    for fn in (_quote_yahoo, _quote_google):
        try:
            q = fn(stock)
            q["symbol"] = stock["symbol"]
            q["name"] = stock["name"]
            q["region"] = stock.get("region", "US")
            q["error"] = ""
            return q
        except Exception as e:
            errors.append(str(e)[:60])
    return {
        "symbol": stock["symbol"], "name": stock["name"],
        "region": stock.get("region", "US"),
        "price": None, "prev": None, "change": 0, "change_pct": 0,
        "currency": "USD", "spark": [], "via": "",
        "error": " / ".join(errors)[:120],
    }
