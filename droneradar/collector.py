"""Collection orchestration: fetch, normalise, geo-tag, score, persist."""
import concurrent.futures as futures
import hashlib
import json
import os
import re
import threading
import time

from . import geo, net, scrapers, sources, translate
from .net import FetchError

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def _data_dir():
    """Where collected data lives.

    Running from the source folder it sits alongside the code, which keeps
    development self-contained. Installed into /Applications the bundle is not
    reliably writable, so the standard per-user location is used instead.
    """
    override = os.environ.get("DRONERADAR_DATA")
    if override:
        return override
    if os.name == "nt":
        # Windows has one answer for this and it is APPDATA; the fallback is
        # only for a stripped environment where it is somehow unset.
        base = os.environ.get("APPDATA") or os.path.expanduser("~")
        return os.path.join(base, "DroneRadar")
    if ".app/Contents/" in HERE:
        return os.path.expanduser("~/Library/Application Support/DroneRadar")
    return os.path.join(ROOT, "data")


DATA = _data_dir()
IMG_CACHE = os.path.join(DATA, "images")

_write_lock = threading.Lock()
# Guards read-modify-write on the two source lists. A collection run takes tens
# of seconds, so it never holds this across the fetch — it merges its per-source
# status back in at save time instead, leaving room for adds mid-run.
sources_lock = threading.RLock()

STATUS_FIELDS = ("error", "last_ok", "last_count")

# Separator fetch_github puts between `owner/repo` and the repo description.
REPO_SEP = " — "

# War coverage arrives through the ordinary news feeds, so the category has to
# be decided from the text rather than from which source it came out of.
MILITARY_TERMS = [
    "軍事", "軍が", "軍は", "軍の", "防衛省", "自衛隊", "撃墜", "侵攻", "戦争",
    "ミサイル", "迎撃", "空爆", "戦闘", "兵器", "攻撃", "無人機攻撃", "自爆",
    "徘徊型", "国防", "駐留", "停戦", "交戦", "砲撃",
    # Added after a strike on a Russian distribution centre was filed under
    # 産業活用 — the report only said 物流 and 襲う, never 攻撃.
    "襲撃", "襲う", "空襲", "被弾", "戦火", "前線", "軍需", "弾薬",
    "露軍", "ロシア軍", "ウクライナ軍", "無人機を発射", "報復",
    "military", "defense ", "defence", "warfare", "missile", "airstrike",
    "combat", "troops", "army", "navy", "air force", "pentagon", "nato",
    "munition", "kamikaze", "counter-uas", "shot down", "shoot down",
    "battlefield", "war ", "strike",
]

# Shows, races, expos and their TV coverage: these arrive through the general
# news feeds too, so the category is decided from the text.
EVENT_TERMS = [
    "ドローンショー", "ドローンレース", "ドローン大会", "レース大会", "選手権",
    "展示会", "見本市", "エキスポ", "EXPO", "フェス", "花火大会", "花火と",
    "イベント", "開催", "出展", "実演", "デモフライト", "体験会", "サミット",
    "カンファレンス", "商談会", "放映", "生中継", "特番", "特集番組", "テレビ放送",
    "drone show", "light show", "drone race", "drone racing", "championship",
    "expo", "festival", "air show", "airshow", "exhibition", "trade show",
]

# YouTube search matches on any mention, so "サーフィンしたくなるBGM … ドローン"
# comes back as a drone video. These are the shapes of clip that are never what
# this dashboard is for.
VIDEO_NOISE = [
    "BGM", "bgm", "作業用", "睡眠用", "勉強用", "カラオケ", "歌詞", "替え歌",
    "歌ってみた", "弾いてみた", "cover", "Cover", "COVER", "lyrics", "Lyrics",
    "ASMR", "asmr", "ゲーム実況", "切り抜き", "朗読", "耐久", "リラックス",
    "癒し", "睡眠", "ヒーリング", "playlist", "Playlist", "mix", "Mix",
    "メドレー", "ランキング", "TOP10", "ゆっくり茶番", "ドッキリ",
]

# Titles that promise the two things worth watching here.
VIDEO_GOOD = [
    "空撮", "4K", "8K", "FPV", "fpv", "ドローン映像", "ドローンショー", "ニュース",
    "報道", "密着", "現場", "上空", "飛行", "レース", "aerial", "Aerial",
    "footage", "cinematic", "flight", "news",
]

# The camera makers sell far more than drones, and a search for the brand name
# brings back gimbals, action cams, mics and power stations. Naming one of these
# in the title disqualifies a clip unless it names a drone too.
VIDEO_NOT_DRONE = [
    "Osmo", "OSMO", "osmo", "Pocket", "Action 4", "Action 5", "Action 6",
    "Mic 2", "Mic 3", "DJI Mic", "Ronin", "RS 3", "RS 4", "RS3", "RS4",
    "Power 1000", "Power 500", "DJI Power", "Mimo", "Nano",
    "GoPro", "Insta360", "Hero 12", "Hero 13", "HERO12", "HERO13",
    "ジンバル", "アクションカメラ", "スタビライザー", "ポータブル電源",
    "ロボット掃除機", "スマホ", "イヤホン", "カメラレビュー",
]

# What actually makes a clip a drone clip. DRONE_TERMS covers the plain words;
# these add the model names and the shots that only a drone can take.
VIDEO_DRONEY = [
    "空撮", "ドローンショー", "aerial", "Aerial", "AERIAL",
    "Mavic", "MAVIC", "マビック", "Phantom", "Inspire", "Matrice", "Agras",
    "Avata", "DJI Neo", "Mini 4", "Mini 5", "Air 3", "Air 4", "DJI Flip",
    "クアッド", "空飛ぶ",
]

# Five topics that were arriving through the general news feeds and being
# filed as plain 国内/海外ニュース. Each is decided from the text, the same way
# 防衛 and イベント already are.

# Manned aircraft: a different industry that happens to share the airspace.
AAM_TERMS = [
    "空飛ぶクルマ", "空飛ぶ車", "eVTOL", "エアタクシー", "空のモビリティ",
    "有人飛行", "都市航空", "AAM", "advanced air mobility", "air taxi",
    "urban air mobility", "evtol", "vertiport", "バーティポート",
]

# Drones as the threat rather than the tool.
SECURITY_TERMS = [
    "対ドローン", "ドローン対策", "迎撃", "妨害電波", "ジャミング", "無力化",
    "飛行禁止区域", "無許可飛行", "違反", "書類送検", "逮捕", "不審なドローン",
    "領空侵犯", "侵入", "落下事故", "墜落事故", "密輸", "盗撮", "テロ",
    "counter-uas", "counter-drone", "c-uas", "jamming", "no-fly",
    "unauthorised", "unauthorized", "intrusion", "smuggling", "arrested",
]

DISASTER_TERMS = [
    "災害", "被災", "救助", "捜索", "遭難", "消防", "救難", "防災", "避難",
    "地震", "豪雨", "水害", "土砂", "噴火", "山火事", "行方不明", "人命",
    "disaster", "rescue", "search and rescue", "emergency response",
    "wildfire", "flood", "earthquake", "first responder",
]

SURVEY_TERMS = [
    "測量", "点検", "インフラ", "橋梁", "送電線", "プラント", "配管", "煙突",
    "三次元", "3D点群", "点群", "オルソ", "写真測量", "地形図", "出来形",
    "施工管理", "非破壊検査", "屋根調査",
    "survey", "surveying", "inspection", "photogrammetry", "lidar",
    "point cloud", "mapping mission", "as-built",
]

# Logistics, agriculture and the training that feeds both — individually too
# thin for a row of their own, together a coherent "put to work" bucket.
INDUSTRY_TERMS = [
    "配送", "物流", "宅配", "ラストワンマイル", "荷物", "レベル4", "レベル3.5",
    "農薬", "散布", "農業", "スマート農業", "水稲", "果樹", "獣害", "鳥獣",
    "林業", "森林", "漁業", "畜産", "養殖",
    "国家資格", "技能証明", "操縦ライセンス", "免許", "講習", "スクール",
    "操縦士育成", "人材育成",
    "delivery", "logistics", "last-mile", "parcel", "agriculture",
    "agricultural", "crop spraying", "spraying", "farmland", "forestry",
    "pilot training", "certification course",
]

DRONE_TERMS = [
    "ドローン", "無人航空機", "UAV", "uav", "drone", "Drone", "UAS",
    "quadcopter", "quadrotor", "eVTOL", "空飛ぶクルマ", "マルチコプター",
    "無人機", "UTM", "FPV",
]

# The plain drone words count as drone-y too; kept separate above only because
# DRONE_TERMS is defined after the video lists.
VIDEO_DRONEY += DRONE_TERMS


def _path(name):
    return os.path.join(DATA, name)


def load_json(name, default):
    try:
        with open(_path(name), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save_json(name, obj):
    os.makedirs(DATA, exist_ok=True)
    tmp = _path(name + ".tmp")
    with _write_lock:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, _path(name))


def merge_builtins(stored, defaults):
    """Fold newly-shipped built-in sources into the user's saved list.

    Without this, anything added to the catalogue after first run would never
    appear, because the saved file always wins. User edits (enabled flags,
    custom sources) are preserved.
    """
    by_id = {s["id"]: s for s in stored}
    for d in defaults:
        cur = by_id.get(d["id"])
        if cur is None:
            stored.append(dict(d))
        else:
            # Refresh the fields we own; leave the user's toggle alone.
            for key in ("name", "type", "url", "query", "category",
                        "lang", "strict"):
                if key in d:
                    cur[key] = d[key]
            cur["builtin"] = True
    return stored


def save_source_status(name, fetched):
    """Write back only the status fields, keeping concurrent additions."""
    with sources_lock:
        stored = load_json(name, [])
        by_id = {s["id"]: s for s in stored}
        for s in fetched:
            cur = by_id.get(s["id"])
            if cur is None:
                stored.append(s)
            else:
                for key in STATUS_FIELDS:
                    if key in s:
                        cur[key] = s[key]
        save_json(name, stored)


def item_id(url):
    return hashlib.sha1(url.encode("utf-8")).hexdigest()[:16]


def detect_lang(text):
    return "ja" if re.search(r"[ぁ-んァ-ヶ一-龠]", text or "") else "en"


_URL_RE = re.compile(r"https?://\S+")


def slug_title(url):
    """Turn a link's own path into a headline.

    Reddit link posts frequently have nothing but the target URL for a title.
    A URL neither reads nor translates — but the slug the publisher put in it
    is very nearly the headline they wrote.
    """
    from urllib.parse import urlparse, unquote
    parts = [p for p in urlparse(url).path.split("/") if p]
    if not parts:
        return ""
    slug = unquote(parts[-1])
    slug = re.sub(r"\.(html?|php|aspx?|shtml)$", "", slug, flags=re.I)
    # A trailing article id or hash is not part of the headline.
    slug = re.sub(r"[-_]?\b(?:[0-9a-f]{8,}|\d{5,})\b$", "", slug)
    slug = re.sub(r"[-_]+", " ", slug).strip()
    if len(slug) < 12 or " " not in slug:
        return ""
    return slug[0].upper() + slug[1:]


def fix_url_title(title, extra=""):
    """Replace a title that is mostly a URL with something readable."""
    bare = _URL_RE.sub("", title).strip(" -—–|/")
    if len(bare) >= 12:
        return title
    link = _URL_RE.search("%s %s" % (title, extra))
    if not link:
        return title
    return slug_title(link.group(0)) or title


def is_relevant(text):
    return any(t in text for t in DRONE_TERMS)


def is_drone_video(title):
    """A clip whose own title says it is about a drone.

    Judged on the title alone: checking the description let a gimbal review
    through on the strength of a channel blurb that mentioned drones.
    """
    if any(t in title for t in VIDEO_NOT_DRONE):
        return any(t in title for t in VIDEO_DRONEY)
    return True


def _has(text, terms):
    low = text.lower()
    return any(t in text or t in low for t in terms)


def is_military(text):
    return _has(text, MILITARY_TERMS)


def is_event(text):
    return _has(text, EVENT_TERMS)


# Order matters and is not alphabetical. 空飛ぶクルマ is unmistakable, so it goes
# first. 防衛 comes next because a strike is a strike even when the report also
# says 迎撃 — putting 対ドローン ahead of it would have emptied half the war
# coverage into the security row. Below that: the emergency, then the job the
# drone was doing, then the event listing, which is the weakest signal since
# almost anything can be announced as a demo.
TOPIC_RULES = [
    ("aam", AAM_TERMS),
    ("defense", MILITARY_TERMS),
    ("security", SECURITY_TERMS),
    ("disaster", DISASTER_TERMS),
    ("events", EVENT_TERMS),
    ("survey", SURVEY_TERMS),
    ("industry", INDUSTRY_TERMS),
]

# Only the vague buckets get reclassified; research, dev and video already say
# what they hold.
RECLASSIFY_FROM = ("jp_news", "world_news", "business", "hobby")


def topic_of(text, category):
    if category not in RECLASSIFY_FROM:
        return category
    for key, terms in TOPIC_RULES:
        if _has(text, terms):
            return key
    return category


# --------------------------------------------------------------------------
# Normalisation
# --------------------------------------------------------------------------

def normalise(entry, source, config):
    url = (entry.get("url") or "").strip()
    title = (entry.get("title") or "").strip()
    if not url or not title:
        return None

    blob = "%s %s" % (title, entry.get("summary") or "")
    for bad in config.get("exclude", []):
        if bad and bad in blob:
            return None

    # Broad search feeds (Google News, Reddit, HN, GitHub) pull in plenty that
    # has nothing to do with drones — Reddit's site-wide search in particular
    # returns Monopoly GO threads. The curated publications need no such filter.
    # `strict` marks a general-interest feed — a defence magazine, a robotics
    # journal, a press-release wire — that carries drone stories among a great
    # deal else. Same test as the search feeds get.
    broad = (source.get("type") in ("hn", "github", "youtube_search")
             or source.get("strict")
             or "news.google.com" in source.get("url", "")
             or "reddit.com" in source.get("url", ""))
    if broad and not is_relevant(blob):
        return None

    # Videos get a second pass: drop music/karaoke/ASMR uploads outright, and
    # for search results insist the title actually promises footage or news.
    if source.get("category") == "video":
        if any(t in blob for t in VIDEO_NOISE):
            return None
        if source.get("type") == "youtube_search" \
                and not any(t in blob for t in VIDEO_GOOD):
            return None
        if not is_drone_video(title):
            return None
        if source.get("type") == "youtube_search" \
                and not any(t in title for t in VIDEO_DRONEY):
            return None

    # Google News appends " - 発行元" to every headline. Splitting it out gives
    # the card a real outlet name to show instead of "Googleニュース".
    publisher = ""
    if "news.google.com" in source.get("url", "") and " - " in title:
        head, _, tail = title.rpartition(" - ")
        if head and len(tail) <= 30:
            title, publisher = head.strip(), tail.strip()

    # Google News's <description> is just the headline plus the outlet name, so
    # it renders as the title printed twice on the card. Drop it.
    summary = entry.get("summary") or ""
    if "reddit.com" in source.get("url", ""):
        title = fix_url_title(title, summary)
        # "submitted by /u/… to r/… [link] [comments]" says nothing, and once
        # translated it is the same nothing in Japanese.
        summary = ""
    if summary and (summary.startswith(title[:24]) or title.startswith(summary[:24])):
        summary = ""

    # Re-derive the text used for geo/topic detection now that the outlet name
    # is off the end. Leaving it in made 沖縄タイムス tag a Moscow story as
    # Okinawa news, and every 東京新聞 byline looked like a Tokyo story.
    blob = "%s %s" % (title, summary)

    lang = source.get("lang") or detect_lang(blob)

    # Reclassify war coverage out of the general news buckets; the specialised
    # categories (research, dev, video…) already describe their items well.
    category = topic_of(blob, source["category"])

    prefs = geo.find_prefectures(blob) if lang == "ja" else []
    scope = geo.classify_scope(blob, lang)
    flagship = geo.flagship_score(blob)

    countries = geo.find_countries(blob)
    # A Japanese piece that names a prefecture or a ministry is about Japan even
    # when it never writes 「日本」.
    if lang == "ja" and not countries and (prefs or scope == "national"):
        countries = ["JP"]

    published = entry.get("published") or 0
    if not published or published > net.now() + 86400:
        published = net.now()

    importance = flagship
    if category == "regulation":
        importance += 15
    if scope == "national":
        importance += 10
    age_h = max(0.0, (net.now() - published) / 3600.0)
    if age_h < 6:
        importance += 12
    elif age_h < 24:
        importance += 6

    return {
        "id": item_id(url),
        "title": title,
        "url": url,
        "summary": summary,
        "image": entry.get("image") or "",
        "published": published,
        "fetched": net.now(),
        "source": source["name"],
        "publisher": publisher,
        "source_id": source["id"],
        "category": category,
        "lang": lang,
        "prefectures": prefs,
        "countries": countries[:3],
        "country": countries[0] if countries else "",
        "country_ja": geo.COUNTRY_JA.get(countries[0], "") if countries else "",
        "scope": scope,
        "flagship": flagship,
        "importance": min(100, importance),
        "author": entry.get("author") or "",
        "tags": entry.get("tags") or [],
        "stars": entry.get("stars", 0),
        "points": entry.get("points", 0),
    }


# --------------------------------------------------------------------------
# Image enrichment
# --------------------------------------------------------------------------

def enrich_images(items, config, log=None):
    """Fill in missing thumbnails from each article's og:image.

    Google News and several feeds ship no image at all, so we open the article
    itself — but only for the newest news items, and only once per URL ever.
    """
    cache = load_json("imagecache.json", {})
    budget = int(config.get("image_budget", 70))
    # Google News links are opaque redirect tokens that never resolve to the
    # publisher server-side, so spending the budget on them yields nothing.
    wanted = [
        it for it in items
        if not it.get("image")
        and "news.google.com" not in it["url"]
        and it["category"] in ("jp_news", "world_news", "regulation", "product",
                               "business", "security", "aam", "disaster",
                               "survey", "industry")
    ]
    wanted.sort(key=lambda it: -it["published"])

    todo = []
    for it in wanted:
        hit = cache.get(it["url"])
        if hit is not None:
            if hit:
                it["image"] = hit
            continue
        if len(todo) < budget:
            todo.append(it)
    if not todo:
        return 0

    def one(it):
        try:
            html, final = net.http_text(it["url"], timeout=12)
            return it, net.find_og_image(html, final)
        except (FetchError, Exception):
            return it, None

    found = 0
    with futures.ThreadPoolExecutor(max_workers=8) as pool:
        for it, img in pool.map(one, todo):
            cache[it["url"]] = img or ""
            if img:
                it["image"] = img
                found += 1
    # Keep the cache from growing without bound.
    if len(cache) > 6000:
        cache = dict(list(cache.items())[-4000:])
    save_json("imagecache.json", cache)
    if log:
        log("画像取得 %d/%d 件" % (found, len(todo)))
    return found


# --------------------------------------------------------------------------
# Translation
# --------------------------------------------------------------------------

def translate_items(items, config, log=None):
    """Attach a Japanese title (and summary) to every non-Japanese item."""
    budget = int(config.get("translate_budget", 400))
    cache = load_json("translations.json", {})

    pending = [it for it in items if it["lang"] != "ja" and not it.get("title_ja")]
    pending.sort(key=lambda it: -it["published"])

    # GitHub titles are `owner/repo — description`. Translating the whole thing
    # turns `malihashar/wildfire-drone` into 「マリハシャール/野火ドローン」, so
    # only the description half is sent and the repo name is kept verbatim.
    # Partition on the bare em dash, not " — ": a repo with no description ends
    # up titled `owner/repo —` with no trailing space, which the padded form
    # misses — and the whole name then gets translated.
    def translatable(it):
        if it["source_id"] == "github_uav":
            _, sep, desc = it["title"].partition("—")
            return desc.strip() if sep else ""
        return it["title"]

    titles = [t for t in (translatable(it) for it in pending) if t]
    # Summaries cost as much as titles, so only the newest slice gets one; the
    # card still reads fine with a Japanese headline over an English blurb.
    summaries = [it["summary"] for it in pending[:150] if it.get("summary")]

    done, spent = translate.translate_texts(titles, cache, budget=budget)
    if spent < budget and summaries:
        more, spent2 = translate.translate_texts(summaries, cache, budget=budget - spent)
        done.update(more)
        spent += spent2

    for it in pending:
        src = translatable(it)
        t = done.get(src) if src else None
        if t:
            if src != it["title"]:
                head = it["title"].partition("—")[0].rstrip()
                it["title_ja"] = head + REPO_SEP + t
            else:
                it["title_ja"] = t
        s = done.get(it.get("summary") or "")
        if s:
            it["summary_ja"] = s

    save_json("translations.json", translate.trim_cache(cache))
    if log:
        log("翻訳 %d件（新規 %d件）" % (sum(1 for i in items if i.get("title_ja")), spent))
    return spent


# --------------------------------------------------------------------------
# Clustering: how many distinct outlets covered the same story
# --------------------------------------------------------------------------

_NOISE_RE = re.compile(r"[\s　「」『』【】、。,\.\-—―–:：･・\|｜\(\)（）\[\]\"'!？\?]+")
_STOP = {"ドローン", "drone", "the", "for", "and", "with", "を", "が", "の", "に", "は"}


def _keyset(title):
    t = _NOISE_RE.sub(" ", title.lower())
    if re.search(r"[ぁ-んァ-ヶ一-龠]", t):
        # Character bigrams work far better than whitespace splitting for JP.
        compact = t.replace(" ", "")
        toks = {compact[i:i + 2] for i in range(len(compact) - 1)}
    else:
        toks = {w for w in t.split() if len(w) > 2}
    return {w for w in toks if w not in _STOP}


def cluster(items):
    """Mark items covered by several outlets; those lead the highlight strip."""
    recent = [it for it in items if net.now() - it["published"] < 3 * 86400]
    recent.sort(key=lambda it: -it["published"])
    recent = recent[:400]
    keys = [(it, _keyset(it["title"])) for it in recent]
    for it in items:
        it["cluster"] = 1
        it["related"] = []
    # Short titles ("Help me out!") reduce to two tokens, and a single shared
    # word would then clear any ratio threshold — so require a substantial
    # keyset, score against the larger one, and demand real overlap.
    MIN_KEYS, MIN_SHARED, RATIO = 4, 3, 0.4
    for i, (a, ka) in enumerate(keys):
        if len(ka) < MIN_KEYS:
            continue
        outlets = {a["source_id"]}
        related = []
        for j, (b, kb) in enumerate(keys):
            if i == j or len(kb) < MIN_KEYS:
                continue
            shared = len(ka & kb)
            overlap = shared / max(len(ka), len(kb))
            if shared >= MIN_SHARED and overlap >= RATIO:
                outlets.add(b["source_id"])
                related.append(b["id"])
        a["cluster"] = len(outlets)
        a["related"] = related[:6]
        if len(outlets) >= 2:
            a["importance"] = min(100, a["importance"] + 8 * (len(outlets) - 1))

    # Google News items carry no image and their links can't be resolved, but
    # the same story often arrives through a direct feed that does have one.
    by_id = {it["id"]: it for it in items}
    for it in recent:
        if it.get("image"):
            continue
        for rid in it.get("related", []):
            twin = by_id.get(rid)
            if twin and twin.get("image"):
                it["image"] = twin["image"]
                break


# --------------------------------------------------------------------------
# Runs
# --------------------------------------------------------------------------

def _fetch_one(source):
    fn = scrapers.ARTICLE_FETCHERS.get(source.get("type"))
    if fn is None:
        raise FetchError("未対応のソース種別: %s" % source.get("type"))
    return fn(source)


def collect_articles(log=None):
    log = log or (lambda m: None)
    with sources_lock:
        srcs = merge_builtins(load_json("sources.json", []), sources.default_sources())
    config = {**sources.default_config(), **load_json("config.json", {})}
    active = [s for s in srcs if s.get("enabled", True)]

    fresh, by_id = [], {}
    with futures.ThreadPoolExecutor(max_workers=8) as pool:
        jobs = {pool.submit(_fetch_one, s): s for s in active}
        for fut in futures.as_completed(jobs):
            s = jobs[fut]
            try:
                entries = fut.result()
            except Exception as e:
                s["error"] = str(e)[:140]
                s["last_count"] = 0
                log("× %s — %s" % (s["name"], s["error"]))
                continue
            kept = 0
            for e in entries:
                it = normalise(e, s, config)
                if it and it["id"] not in by_id:
                    by_id[it["id"]] = it
                    fresh.append(it)
                    kept += 1
            s["error"] = ""
            s["last_ok"] = net.now()
            s["last_count"] = kept
            log("○ %s — %d件" % (s["name"], kept))

    # Merge with what we already have, keeping user state (bookmarks, seen).
    existing = load_json("items.json", [])
    merged = {}
    for it in existing:
        merged[it["id"]] = it
    for it in fresh:
        old = merged.get(it["id"])
        if old:
            it["bookmarked"] = old.get("bookmarked", False)
            it["fetched"] = old.get("fetched", it["fetched"])
            if old.get("image") and not it.get("image"):
                it["image"] = old["image"]
            for key in ("title_ja", "summary_ja"):
                if old.get(key):
                    it[key] = old[key]
        merged[it["id"]] = it

    items = list(merged.values())
    # Titles that are nothing but a URL predate the fix above and would sit in
    # the feed until they aged out; rewrite them on the way past.
    for it in items:
        if "http" in it.get("title", ""):
            fixed = fix_url_title(it["title"], it.get("summary") or "")
            if fixed != it["title"]:
                it["title"] = fixed
                it.pop("title_ja", None)      # re-translate the new headline
        if "submitted by /u/" in (it.get("summary") or ""):
            it["summary"] = ""
            it.pop("summary_ja", None)
    # Stored items were filtered by whatever rules were in force when they were
    # collected, so tightening a rule leaves the old offenders sitting in the
    # feed forever. Re-apply the video test to everything on the way out.
    items = [it for it in items if it.get("category") != "video" or is_drone_video(it["title"])]
    cutoff = net.now() - int(config.get("retention_days", 45)) * 86400
    items = [it for it in items if it["published"] >= cutoff or it.get("bookmarked")]
    items.sort(key=lambda it: -it["published"])
    items = items[:5000]

    enrich_images(items, config, log)
    translate_items(items, config, log)
    cluster(items)

    save_json("items.json", items)
    save_source_status("sources.json", srcs)
    save_json("meta.json", {"articles_updated": net.now(), "count": len(items)})
    log("記事 %d件（新規 %d件）" % (len(items), len(fresh)))
    return items


def collect_social(log=None):
    log = log or (lambda m: None)
    with sources_lock:
        feeds = merge_builtins(load_json("social_sources.json", []), sources.default_social())
    active = [s for s in feeds if s.get("enabled", True)]

    posts = []
    with futures.ThreadPoolExecutor(max_workers=6) as pool:
        jobs = {}
        for s in active:
            fn = scrapers.SOCIAL_FETCHERS.get(s.get("type"))
            if fn:
                jobs[pool.submit(fn, s)] = s
        for fut in futures.as_completed(jobs):
            s = jobs[fut]
            try:
                got = fut.result()
            except Exception as e:
                s["error"] = str(e)[:120]
                continue
            s["error"] = ""
            s["last_ok"] = net.now()
            for p in got:
                p["source_name"] = s["name"]
                posts.append(p)

    seen, uniq = set(), []
    for p in sorted(posts, key=lambda p: -(p.get("created") or 0)):
        if p["id"] in seen:
            continue
        seen.add(p["id"])
        uniq.append(p)
    uniq = uniq[:220]

    save_json("social.json", uniq)
    save_source_status("social_sources.json", feeds)
    save_json("social_meta.json", {"updated": net.now(), "count": len(uniq)})
    log("SNS %d件" % len(uniq))
    return uniq


def collect_stocks(log=None):
    log = log or (lambda m: None)
    config = {**sources.default_config(), **load_json("config.json", {})}
    stocks = config.get("stocks") or sources.DEFAULT_STOCKS
    out = []
    with futures.ThreadPoolExecutor(max_workers=4) as pool:
        for q in pool.map(scrapers.fetch_quote, stocks):
            out.append(q)
    order = {s["symbol"]: i for i, s in enumerate(stocks)}
    out.sort(key=lambda q: order.get(q["symbol"], 99))

    previous = {q["symbol"]: q for q in load_json("stocks.json", {}).get("items", [])}
    for q in out:
        # A failed lookup should show the last good number, not a blank tile.
        if q["price"] is None and previous.get(q["symbol"], {}).get("price") is not None:
            old = previous[q["symbol"]]
            q.update({k: old[k] for k in ("price", "prev", "change", "change_pct",
                                          "currency", "spark")})
            q["stale"] = True
        else:
            q["stale"] = False

    ok = sum(1 for q in out if q["price"] is not None)
    save_json("stocks.json", {"updated": net.now(), "items": out})
    log("株価 %d/%d 件" % (ok, len(out)))
    return out


def cached_image_path(url):
    return os.path.join(IMG_CACHE, hashlib.sha1(url.encode("utf-8")).hexdigest()[:24])


def fetch_image_bytes(url):
    """Fetch (and cache on disk) a remote image, so hotlink blocks don't bite."""
    path = cached_image_path(url)
    meta_path = path + ".type"
    if os.path.exists(path):
        try:
            with open(meta_path, encoding="utf-8") as f:
                ctype = f.read().strip() or "image/jpeg"
        except OSError:
            ctype = "image/jpeg"
        with open(path, "rb") as f:
            return f.read(), ctype
    raw, _, ctype = net.http_get(url, timeout=15, accept="image/*", max_bytes=4_000_000)
    if not ctype.startswith("image"):
        raise FetchError("not an image")
    os.makedirs(IMG_CACHE, exist_ok=True)
    with open(path, "wb") as f:
        f.write(raw)
    with open(meta_path, "w", encoding="utf-8") as f:
        f.write(ctype.split(";")[0])
    return raw, ctype.split(";")[0]


def prune_image_cache(max_files=1500):
    try:
        names = [n for n in os.listdir(IMG_CACHE) if not n.endswith(".type")]
    except OSError:
        return
    if len(names) <= max_files:
        return
    paths = [(os.path.getmtime(os.path.join(IMG_CACHE, n)), n) for n in names]
    paths.sort()
    for _, n in paths[:len(paths) - max_files]:
        for p in (os.path.join(IMG_CACHE, n), os.path.join(IMG_CACHE, n + ".type")):
            try:
                os.remove(p)
            except OSError:
                pass


if __name__ == "__main__":
    def _log(m):
        print(m, flush=True)
    t0 = time.time()
    collect_articles(_log)
    collect_social(_log)
    collect_stocks(_log)
    print("完了 %.1f秒" % (time.time() - t0))
