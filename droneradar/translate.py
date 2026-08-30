"""English → Japanese translation for article titles and summaries.

Uses Google's keyless `translate_a` endpoint, with MyMemory as a backup. Every
result is cached by content hash, so a given headline is only ever paid for
once — steady-state runs translate just the handful of new items.

One request per text on purpose: the endpoint ignores repeated `q` parameters
(only the first is translated) and joining texts with newlines lets the line
count drift, which silently misaligns translations with their articles.
"""
import concurrent.futures as futures
import hashlib
import json
import urllib.parse

from . import net

GOOGLE = "https://translate.googleapis.com/translate_a/single"
MYMEMORY = "https://api.mymemory.translated.net/get"


def key_of(text):
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]


def _google(text):
    url = "%s?client=gtx&sl=auto&tl=ja&dt=t&q=%s" % (GOOGLE, urllib.parse.quote(text))
    data = net.http_json(url, timeout=15)
    segments = data[0] or []
    out = "".join(s[0] for s in segments if s and s[0])
    return out.strip()


def _mymemory(text):
    url = "%s?q=%s&langpair=en|ja" % (MYMEMORY, urllib.parse.quote(text[:480]))
    data = net.http_json(url, timeout=15)
    if str(data.get("responseStatus")) != "200":
        raise net.FetchError("mymemory %s" % data.get("responseStatus"))
    return (data.get("responseData") or {}).get("translatedText", "").strip()


def translate_one(text):
    for fn in (_google, _mymemory):
        try:
            out = fn(text)
        except Exception:
            continue
        # A translation identical to the input means nothing happened; treating
        # it as a miss keeps us from caching a useless entry forever.
        if out and out != text:
            return out
    return ""


def translate_texts(texts, cache, budget=400, workers=5):
    """Return {text: 訳}. Fills `cache` in place; skips anything already there."""
    todo, out = [], {}
    for t in texts:
        t = (t or "").strip()
        if not t:
            continue
        hit = cache.get(key_of(t))
        if hit is not None:
            if hit:
                out[t] = hit
        elif t not in todo:
            todo.append(t)
    todo = todo[:budget]
    if not todo:
        return out, 0

    with futures.ThreadPoolExecutor(max_workers=workers) as pool:
        for text, result in zip(todo, pool.map(translate_one, todo)):
            cache[key_of(text)] = result
            if result:
                out[text] = result
    return out, len(todo)


def load_cache(load_json):
    return load_json("translations.json", {})


def trim_cache(cache, limit=20000):
    if len(cache) > limit:
        return dict(list(cache.items())[-int(limit * 0.7):])
    return cache
