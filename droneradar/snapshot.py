"""The four read-only payloads, built from data/ alone.

The Mac server and the static export must not drift. Before this module the
shapes lived inside server.py's request handlers, so anything the exporter
wrote was a second, hand-copied version of them — and the first field added to
one and forgotten in the other would show up as a blank pane on the published
page only, hours later, with nothing pointing at the cause.

Everything here is a pure function of the files in data/. Live-only fields
(`running`, `log`) are added by the caller that actually knows them; on the
static export they are the constants below, because a page served from a CDN
is never in the middle of a collection run.
"""
from . import collector, sources


def config():
    return {**sources.default_config(), **collector.load_json("config.json", {})}


def state():
    return {
        "items": collector.load_json("items.json", []),
        "sources": collector.load_json("sources.json", sources.default_sources()),
        "social_sources": collector.load_json("social_sources.json",
                                              sources.default_social()),
        "categories": sources.CATEGORIES,
        "meta": collector.load_json("meta.json", {}),
        "config": config(),
        "running": False,
        "log": [],
    }


def social():
    return {
        "items": collector.load_json("social.json", []),
        "meta": collector.load_json("social_meta.json", {}),
        "running": False,
    }


def stocks():
    data = collector.load_json("stocks.json", {"items": [], "updated": 0})
    data["running"] = False
    return data


def status():
    """What the live server reports about its background loops.

    Statically there are no loops, so this says "idle, last written at". The
    page polls this to notice new data — `pollStatus` reloads the state when
    `articles.updated` changes — so these timestamps are the whole mechanism
    by which a published page picks up a collection run. They come from the
    three separate meta files, which is where each loop records its own time.
    """
    meta = collector.load_json("meta.json", {})
    smeta = collector.load_json("social_meta.json", {})
    stk = collector.load_json("stocks.json", {})
    return {
        "articles": {"running": False, "updated": meta.get("articles_updated", 0), "log": []},
        "social": {"running": False, "updated": smeta.get("updated", 0)},
        "stocks": {"running": False, "updated": stk.get("updated", 0)},
    }
