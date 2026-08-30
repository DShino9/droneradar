"""HTTP fetching and feed parsing, standard library only."""
import email.utils
import gzip
import html as html_mod
import io
import json
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")

_SSL_CTX = ssl.create_default_context()


class FetchError(Exception):
    pass


def http_get(url, timeout=20, accept=None, max_bytes=8_000_000):
    """GET a URL and return (bytes, final_url, content_type)."""
    headers = {
        "User-Agent": UA,
        "Accept-Language": "ja,en;q=0.8",
        "Accept-Encoding": "gzip",
        "Accept": accept or "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_SSL_CTX) as r:
            raw = r.read(max_bytes)
            if r.headers.get("Content-Encoding") == "gzip":
                try:
                    raw = gzip.GzipFile(fileobj=io.BytesIO(raw)).read()
                except OSError:
                    pass
            return raw, r.geturl(), r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        raise FetchError("HTTP %s" % e.code)
    except Exception as e:  # socket timeouts, DNS, TLS, malformed redirects
        raise FetchError(str(e)[:120])


def http_text(url, timeout=20, accept=None):
    raw, final, ctype = http_get(url, timeout=timeout, accept=accept)
    enc = "utf-8"
    m = re.search(r"charset=([\w-]+)", ctype or "", re.I)
    if m:
        enc = m.group(1)
    else:
        head = raw[:2048].decode("ascii", "replace")
        m = re.search(r'charset=["\']?([\w-]+)', head, re.I)
        if m:
            enc = m.group(1)
    try:
        return raw.decode(enc, "replace"), final
    except LookupError:
        return raw.decode("utf-8", "replace"), final


def http_json(url, timeout=20):
    text, _ = http_text(url, timeout=timeout, accept="application/json")
    return json.loads(text)


# --------------------------------------------------------------------------
# Feed parsing
# --------------------------------------------------------------------------

_NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "media": "http://search.yahoo.com/mrss/",
    "content": "http://purl.org/rss/1.0/modules/content/",
    "dc": "http://purl.org/dc/elements/1.1/",
    "rss1": "http://purl.org/rss/1.0/",
    "itunes": "http://www.itunes.com/dtds/podcast-1.0.dtd",
    "yt": "http://www.youtube.com/xml/schemas/2015",
}

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")
_IMG_RE = re.compile(r'<img[^>]+src=["\']([^"\']+)["\']', re.I)


def strip_html(s, limit=400):
    if not s:
        return ""
    s = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", s)
    s = _TAG_RE.sub(" ", s)
    # html.unescape covers the numeric forms too — Reddit's feed is full of
    # `&#32;`, which a hand-rolled replacement table leaves on screen verbatim.
    s = html_mod.unescape(s)
    s = _WS_RE.sub(" ", s).strip()
    return s[:limit]


def parse_date(s):
    """Return epoch seconds for the many date shapes feeds use."""
    if not s:
        return 0
    s = s.strip()
    try:
        dt = email.utils.parsedate_to_datetime(s)
        if dt is not None:
            return int(dt.timestamp())
    except (TypeError, ValueError, IndexError, OverflowError):
        pass
    # ISO 8601, with or without a timezone.
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})", s)
    if m:
        import calendar
        import datetime
        parts = [int(x) for x in m.groups()]
        tz = re.search(r"([+-])(\d{2}):?(\d{2})$|Z$", s)
        base = calendar.timegm(tuple(parts) + (0, 0, 0))
        if tz and tz.group(1):
            off = int(tz.group(2)) * 3600 + int(tz.group(3)) * 60
            base -= off if tz.group(1) == "+" else -off
        elif not tz:
            # No timezone given: feeds like this are almost always local time.
            base = int(datetime.datetime(*parts).timestamp())
        return base
    m = re.match(r"(\d{4})[/-](\d{1,2})[/-](\d{1,2})", s)
    if m:
        import datetime
        try:
            y, mo, d = (int(x) for x in m.groups())
            return int(datetime.datetime(y, mo, d).timestamp())
        except ValueError:
            return 0
    return 0


def _localname(tag):
    return tag.rsplit("}", 1)[-1]


def _find_image(el, description, content):
    """Dig an image URL out of whichever place the feed hid it."""
    for child in el:
        name = _localname(child.tag)
        if name in ("content", "thumbnail") and child.get("url"):
            t = (child.get("type") or "")
            if name == "thumbnail" or t.startswith("image") or not t:
                if not t.startswith(("video", "audio")):
                    return child.get("url")
        if name == "group":
            for g in child:
                if _localname(g.tag) == "thumbnail" and g.get("url"):
                    return g.get("url")
        if name == "enclosure" and child.get("url"):
            if (child.get("type") or "").startswith("image"):
                return child.get("url")
        if name == "image":
            if child.get("href"):
                return child.get("href")
            if child.text and child.text.strip().startswith("http"):
                return child.text.strip()
    for blob in (content, description):
        if blob:
            m = _IMG_RE.search(blob)
            if m:
                return m.group(1)
    return None


def parse_feed(xml_text):
    """Parse RSS 2.0 / RSS 1.0 (RDF) / Atom into a list of dicts."""
    xml_text = xml_text.lstrip("﻿ \t\r\n")
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        # Feeds in the wild carry raw ampersands and stray control chars.
        cleaned = re.sub(r"&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)", "&amp;", xml_text)
        cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", cleaned)
        try:
            root = ET.fromstring(cleaned)
        except ET.ParseError as e:
            raise FetchError("XML parse: %s" % str(e)[:80])

    entries = []
    nodes = [n for n in root.iter() if _localname(n.tag) in ("item", "entry")]
    for el in nodes:
        get = {}
        for child in el:
            get.setdefault(_localname(child.tag), child)

        def text_of(name):
            node = get.get(name)
            return (node.text or "").strip() if node is not None and node.text else ""

        title = text_of("title")

        link = ""
        node = get.get("link")
        if node is not None:
            link = (node.get("href") or (node.text or "")).strip()
        if not link:
            for child in el:
                if _localname(child.tag) == "link" and child.get("href"):
                    if child.get("rel") in (None, "alternate"):
                        link = child.get("href")
                        break
        if not link:
            link = text_of("guid") or text_of("id")
        if not link.startswith("http"):
            continue

        description = ""
        for key in ("description", "summary", "subtitle"):
            node = get.get(key)
            if node is not None:
                description = "".join(node.itertext())
                if description:
                    break
        content = ""
        for key in ("encoded", "content"):
            node = get.get(key)
            if node is not None:
                content = "".join(node.itertext())
                if content:
                    break
        # YouTube puts the real blurb inside media:group/media:description.
        if not description and not content:
            for child in el:
                if _localname(child.tag) == "group":
                    for g in child:
                        if _localname(g.tag) == "description":
                            description = "".join(g.itertext())

        published = 0
        for key in ("pubDate", "published", "updated", "date", "created"):
            node = get.get(key)
            if node is not None and node.text:
                published = parse_date(node.text)
                if published:
                    break

        author = ""
        for key in ("creator", "author"):
            node = get.get(key)
            if node is not None:
                author = strip_html("".join(node.itertext()), 60)
                if author:
                    break

        entries.append({
            "title": strip_html(title, 300),
            "url": link,
            "summary": strip_html(content or description, 400),
            "published": published,
            "image": _find_image(el, description, content),
            "author": author,
        })
    return entries


# --------------------------------------------------------------------------
# HTML helpers
# --------------------------------------------------------------------------

_META_IMG_RE = re.compile(
    r'<meta[^>]+(?:property|name)=["\'](?:og:image(?::url)?|twitter:image(?::src)?)["\'][^>]*>',
    re.I)
_CONTENT_RE = re.compile(r'content=["\']([^"\']+)["\']', re.I)


def find_og_image(html, base_url):
    """Pull an og:image / twitter:image out of an article page."""
    for m in _META_IMG_RE.finditer(html[:200_000]):
        c = _CONTENT_RE.search(m.group(0))
        if c:
            u = c.group(1).strip()
            if u.startswith("//"):
                u = "https:" + u
            elif u.startswith("/"):
                u = urllib.parse.urljoin(base_url, u)
            if u.startswith("http"):
                return u
    return None


_FEED_LINK_RE = re.compile(
    r'<link[^>]+type=["\']application/(?:rss|atom)\+xml["\'][^>]*>', re.I)
_HREF_RE = re.compile(r'href=["\']([^"\']+)["\']', re.I)

COMMON_FEED_PATHS = [
    "/feed/", "/feed", "/rss", "/rss.xml", "/index.xml", "/atom.xml",
    "/feed.xml", "/?feed=rss2", "/rss/index.rdf", "/blog/feed/",
]


def discover_feeds(html, base_url):
    """Return candidate feed URLs advertised in a page's <head>."""
    out = []
    for m in _FEED_LINK_RE.finditer(html[:200_000]):
        h = _HREF_RE.search(m.group(0))
        if h:
            out.append(urllib.parse.urljoin(base_url, h.group(1)))
    seen, uniq = set(), []
    for u in out:
        if u not in seen:
            seen.add(u)
            uniq.append(u)
    return uniq


def resolve_youtube_channel(html):
    """Extract a channel id from a YouTube channel page."""
    m = re.search(r'"(?:externalId|channelId)":"(UC[\w-]{22})"', html)
    if m:
        return m.group(1)
    m = re.search(r'channel_id=(UC[\w-]{22})', html)
    return m.group(1) if m else None


def site_title(html):
    m = re.search(r"(?is)<title[^>]*>(.*?)</title>", html)
    if m:
        t = strip_html(m.group(1), 60)
        # Trim the common "記事タイトル | サイト名" tail down to the site name.
        return t
    return ""


def now():
    return int(time.time())
