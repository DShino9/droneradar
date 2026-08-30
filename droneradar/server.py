"""Local dashboard server: static files, JSON API, background collection."""
import hashlib
import json
import mimetypes
import os
import sys
import threading
import time
import traceback
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import collector, net, snapshot, sources

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, "web")
PORT = int(os.environ.get("DRONERADAR_PORT", "8783"))
# Loopback unless asked otherwise. Setting DRONERADAR_HOST=0.0.0.0 puts the
# dashboard on the local network so a tablet or a TV can display it — and puts
# the endpoints that add sources and change settings there too, so it is opt-in
# rather than the default.
HOST = os.environ.get("DRONERADAR_HOST", "127.0.0.1")

STATUS = {
    "articles": {"running": False, "updated": 0, "log": []},
    "social": {"running": False, "updated": 0},
    "stocks": {"running": False, "updated": 0},
    "started": net.now(),
}
_log_lock = threading.Lock()
# Shared with the collector so adds and collection runs can't clobber each other.
_sources_lock = collector.sources_lock


def log_line(msg):
    with _log_lock:
        lines = STATUS["articles"]["log"]
        lines.append({"t": net.now(), "m": msg})
        del lines[:-60]
    print(msg, flush=True)


def config():
    return snapshot.config()


# --------------------------------------------------------------------------
# Background loops
# --------------------------------------------------------------------------

def run_articles():
    if STATUS["articles"]["running"]:
        return
    STATUS["articles"]["running"] = True
    try:
        collector.collect_articles(log_line)
        collector.prune_image_cache()
        STATUS["articles"]["updated"] = net.now()
    except Exception as e:
        log_line("収集エラー: %s" % str(e)[:160])
    finally:
        STATUS["articles"]["running"] = False


def run_social():
    if STATUS["social"]["running"]:
        return
    STATUS["social"]["running"] = True
    try:
        collector.collect_social()
        STATUS["social"]["updated"] = net.now()
    except Exception as e:
        print("social error:", e, flush=True)
    finally:
        STATUS["social"]["running"] = False


def run_stocks():
    if STATUS["stocks"]["running"]:
        return
    STATUS["stocks"]["running"] = True
    try:
        collector.collect_stocks()
        STATUS["stocks"]["updated"] = net.now()
    except Exception as e:
        print("stocks error:", e, flush=True)
    finally:
        STATUS["stocks"]["running"] = False


def loop(fn, seconds_getter, initial_delay=0):
    def worker():
        if initial_delay:
            time.sleep(initial_delay)
        while True:
            fn()
            time.sleep(max(20, seconds_getter()))
    t = threading.Thread(target=worker, daemon=True)
    t.start()
    return t


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "DroneRadar"

    def log_message(self, fmt, *args):
        pass  # the collection log is the interesting one

    # -- helpers ----------------------------------------------------------
    def _send(self, code, body, ctype="application/json; charset=utf-8", cache=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        if cache:
            self.send_header("Cache-Control", cache)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, ensure_ascii=False, separators=(",", ":")))

    def _body(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(n) or b"{}")
        except (ValueError, TypeError):
            return {}

    # -- routing ----------------------------------------------------------
    # An exception inside a handler otherwise closes the socket with no reply
    # at all, which surfaces to the UI as a silent failure.
    def handle_one_request(self):
        try:
            BaseHTTPRequestHandler.handle_one_request(self)
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        except Exception:
            traceback.print_exc()
            try:
                self._json({"error": "サーバー内部エラー（詳細はログ）"}, 500)
            except Exception:
                self.close_connection = True

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path == "/":
            return self._file(os.path.join(WEB, "index.html"))
        if path == "/api/state":
            return self._json(self._state())
        if path == "/api/status":
            return self._json({
                "articles": {k: v for k, v in STATUS["articles"].items()},
                "social": STATUS["social"],
                "stocks": STATUS["stocks"],
            })
        if path == "/api/social":
            return self._json({**snapshot.social(),
                               "running": STATUS["social"]["running"]})
        if path == "/api/stocks":
            return self._json({**snapshot.stocks(),
                               "running": STATUS["stocks"]["running"]})
        if path == "/img":
            return self._image(query.get("u", [""])[0])

        # Resolve first, then check — the other way round, "/../../etc/passwd"
        # normalises to "../../etc/passwd", and joining that onto WEB gives a
        # string that still starts with WEB while pointing outside it.
        # os.path.join also handles the Windows separator, which a manual
        # comparison would not.
        candidate = os.path.realpath(os.path.join(WEB, path.lstrip("/")))
        root = os.path.realpath(WEB)
        inside = candidate == root or candidate.startswith(root + os.sep)
        if inside and os.path.isfile(candidate):
            return self._file(candidate)
        return self._send(404, "not found", "text/plain; charset=utf-8")

    def _is_local(self):
        """Did this request come from this machine?"""
        return self.client_address[0] in ("127.0.0.1", "::1")

    def do_POST(self):
        # Viewing is open to the home network; changing things is not. There is
        # no authentication in this server — it was written for 127.0.0.1 — so
        # the writes stay on the machine that owns the data. A tablet on the
        # sofa can read the dashboard; it cannot rewrite the source list.
        if not self._is_local():
            return self._send(403, "この操作はこのMac上からのみ実行できます",
                              "text/plain; charset=utf-8")
        return self._do_POST_inner()

    def _do_POST_inner(self):
        path = urllib.parse.urlparse(self.path).path
        body = self._body()

        if path == "/api/refresh":
            what = body.get("what", "articles")
            target = {"articles": run_articles, "social": run_social,
                      "stocks": run_stocks}.get(what)
            if not target:
                return self._json({"error": "unknown target"}, 400)
            threading.Thread(target=target, daemon=True).start()
            return self._json({"ok": True})

        if path == "/api/sources/add":
            return self._json(self._add_source(body))
        if path == "/api/sources/update":
            return self._json(self._update_source(body))
        if path == "/api/keyword/add":
            return self._json(self._add_keyword(body))
        if path == "/api/bookmark":
            return self._json(self._bookmark(body))
        if path == "/api/config":
            cfg = {**config(), **{k: v for k, v in body.items() if k in
                                  ("interval_minutes", "social_seconds",
                                   "stocks_minutes", "exclude", "stocks")}}
            collector.save_json("config.json", cfg)
            return self._json({"ok": True, "config": cfg})
        return self._send(404, "not found", "text/plain; charset=utf-8")

    # -- endpoint implementations -----------------------------------------
    def _state(self):
        # Shape lives in snapshot.py so the static export cannot drift from it;
        # only the two live-only fields are filled in here.
        return {**snapshot.state(),
                "running": STATUS["articles"]["running"],
                "log": STATUS["articles"]["log"][-12:]}

    def _image(self, url):
        if not url.startswith("http"):
            return self._send(400, b"bad url", "text/plain")
        try:
            raw, ctype = collector.fetch_image_bytes(url)
        except Exception:
            return self._send(404, b"", "text/plain")
        return self._send(200, raw, ctype, cache="public, max-age=604800")

    def _add_source(self, body):
        """Add by URL: find a feed, fall back to a Google News site: query."""
        raw = (body.get("url") or "").strip()
        category = body.get("category") or "jp_news"
        lang = body.get("lang") or "ja"
        if not raw:
            return {"error": "URLを入力してください"}
        if not raw.startswith("http"):
            raw = "https://" + raw

        host = urllib.parse.urlparse(raw).netloc

        # A YouTube channel URL becomes that channel's video feed.
        if "youtube.com" in host or "youtu.be" in host:
            try:
                html, _ = net.http_text(raw, timeout=20)
                cid = net.resolve_youtube_channel(html)
                if cid:
                    feed = ("https://www.youtube.com/feeds/videos.xml?channel_id=%s" % cid)
                    name = net.site_title(html).split("-")[0].strip() or host
                    return self._store_source(feed, name, "video", lang, "rss")
            except net.FetchError:
                pass

        # Direct feed URL? A bare domain may not resolve (jaxa.jp has no A
        # record while www.jaxa.jp does), so try the www form too — and if the
        # site is unreachable altogether, fall through to the site: search
        # rather than giving up.
        text, final = "", raw
        for attempt in (raw, "https://www.%s" % host if not host.startswith("www.") else None):
            if not attempt:
                continue
            try:
                text, final = net.http_text(attempt, timeout=20)
                host = urllib.parse.urlparse(final).netloc or host
                break
            except net.FetchError:
                continue

        if text:
            head = text[:400].lower()
            if "<rss" in head or "<feed" in head or "<rdf" in head:
                entries = net.parse_feed(text)
                if entries:
                    return self._store_source(final, self._feed_title(text) or host,
                                              category, lang, "rss",
                                              note="%d件のRSSを登録しました" % len(entries))

        # Autodiscovery, then the usual feed paths.
        candidates = net.discover_feeds(text, final) if text else []
        for p in net.COMMON_FEED_PATHS:
            candidates.append(urllib.parse.urljoin("https://%s" % host, p))
        seen = set()
        for c in candidates:
            if c in seen:
                continue
            seen.add(c)
            try:
                ftext, _ = net.http_text(c, timeout=12)
                entries = net.parse_feed(ftext)
            except Exception:
                continue
            if entries:
                name = self._feed_title(ftext) or net.site_title(text) or host
                return self._store_source(c, name, category, lang, "rss",
                                          note="RSSを自動検出しました（%d件）" % len(entries))

        # No feed anywhere: collect the site through Google News instead.
        query = "site:%s ドローン OR 無人航空機 OR drone" % host
        url = sources.gnews_url(query, lang)
        try:
            ftext, _ = net.http_text(url, timeout=20)
            entries = net.parse_feed(ftext)
        except Exception as e:
            return {"error": "site:検索も失敗しました: %s" % str(e)[:60]}
        if not entries:
            return {"error": "%s のドローン関連記事が見つかりませんでした" % host}
        name = ((net.site_title(text) if text else "") or host)[:40]
        return self._store_source(
            url, name, category, lang, "rss",
            note="RSSが無いため Google ニュースの site: 検索で登録しました（%d件）" % len(entries))

    @staticmethod
    def _feed_title(xml_text):
        import re
        m = re.search(r"(?is)<channel[^>]*>.*?<title[^>]*>(.*?)</title>", xml_text)
        if not m:
            m = re.search(r"(?is)<feed[^>]*>.*?<title[^>]*>(.*?)</title>", xml_text)
        return net.strip_html(m.group(1), 40) if m else ""

    def _store_source(self, url, name, category, lang, stype, note=""):
        # hash() is salted per process, so derive the id from a stable digest —
        # otherwise a source changes identity every time the app restarts.
        sid = "user_" + hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]
        with _sources_lock:
            # Re-read inside the lock: the list captured before the network
            # round-trip above may already be stale.
            srcs = collector.load_json("sources.json", sources.default_sources())
            for s in srcs:
                if s["url"] == url:
                    return {"error": "既に登録されています: %s" % s["name"]}
            srcs.append({
                "id": sid, "name": name or url, "type": stype, "url": url,
                "category": category, "lang": lang, "enabled": True,
                "builtin": False, "last_ok": 0, "last_count": 0, "error": "",
            })
            collector.save_json("sources.json", srcs)
        threading.Thread(target=run_articles, daemon=True).start()
        return {"ok": True, "name": name, "note": note or "登録しました"}

    def _update_source(self, body):
        sid = body.get("id")
        with _sources_lock:
            srcs = collector.load_json("sources.json", sources.default_sources())
            social = collector.load_json("social_sources.json", sources.default_social())
            for bucket, name in ((srcs, "sources.json"), (social, "social_sources.json")):
                for i, s in enumerate(bucket):
                    if s["id"] != sid:
                        continue
                    if body.get("delete"):
                        if s.get("builtin"):
                            s["enabled"] = False
                        else:
                            bucket.pop(i)
                    else:
                        if "enabled" in body:
                            s["enabled"] = bool(body["enabled"])
                        if body.get("category"):
                            s["category"] = body["category"]
                    collector.save_json(name, bucket)
                    return {"ok": True}
        return {"error": "見つかりません"}

    def _add_keyword(self, body):
        word = (body.get("word") or "").strip()
        lang = body.get("lang") or ("ja" if any(ord(c) > 0x3000 for c in word) else "en")
        category = body.get("category") or ("jp_news" if lang == "ja" else "world_news")
        if not word:
            return {"error": "キーワードを入力してください"}
        url = sources.gnews_url(word, lang)
        return self._store_source(url, "検索: %s" % word, category, lang, "rss",
                                  note="キーワード検索を追加しました")

    def _bookmark(self, body):
        items = collector.load_json("items.json", [])
        target, on = body.get("id"), bool(body.get("on"))
        for it in items:
            if it["id"] == target:
                it["bookmarked"] = on
                collector.save_json("items.json", items)
                return {"ok": True}
        return {"error": "見つかりません"}

    def _file(self, path):
        try:
            with open(path, "rb") as f:
                raw = f.read()
        except OSError:
            return self._send(404, "not found", "text/plain; charset=utf-8")
        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        if ctype.startswith("text") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        self._send(200, raw, ctype, cache="no-cache")


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def lan_address():
    """This machine's address on the local network.

    Opening a UDP socket to an outside address picks the interface the routing
    table would actually use, without sending anything; asking for the
    hostname's address returns 127.0.0.1 on a Mac as often as not.
    """
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 1))       # reserved, never routed
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def main():
    os.makedirs(collector.DATA, exist_ok=True)
    cfg = config()

    # Serve immediately; collection continues in the background.
    try:
        httpd = Server((HOST, PORT), Handler)
    except OSError as e:
        print("ポート %d を使用できません: %s" % (PORT, e), file=sys.stderr)
        return 1

    loop(run_articles, lambda: config().get("interval_minutes", 15) * 60)
    loop(run_social, lambda: config().get("social_seconds", 60), initial_delay=2)
    loop(run_stocks, lambda: config().get("stocks_minutes", 5) * 60, initial_delay=4)

    url = "http://127.0.0.1:%d/" % PORT
    print("DroneRadar → %s" % url, flush=True)
    if HOST not in ("127.0.0.1", "localhost"):
        print("同じネットワークから → http://%s:%d/" % (lan_address(), PORT), flush=True)
    if os.environ.get("DRONERADAR_NO_BROWSER") != "1":
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n終了します")
    return 0


if __name__ == "__main__":
    sys.exit(main())
