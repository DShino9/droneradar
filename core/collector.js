import { ARTICLE_FETCHERS } from "./scrapers.js";
import { normalise, fixUrlTitle } from "./normalise.js";
import { cluster } from "./cluster.js";
import { isDroneVideo } from "./classify.js";
import { translateTexts, trimCache } from "./translate.js";
import { now } from "./net.js";
import * as geo from "./geo.js";

/* One collection run: fetch every enabled source, normalise what comes back,
   merge it with what is already stored, and save.

   The desktop server does this on a timer in a background thread. A phone has
   no such luxury — iOS gives an app only the moments the system chooses — so
   the same function is called when the app comes to the foreground. */

const REPO_SEP = " — ";

/* Fold newly-shipped built-in sources into what was saved.

   Ported from collector.py's merge_builtins. Without it the saved list always
   wins, so a source added to the catalogue after first run never appears — and
   neither does a new field on a source that is already there, which is subtler
   and was how the search fallback came to be shipped and then ignored: the
   code was right and the data it ran on was a version behind.

   The list below is the set of fields the catalogue owns. `enabled` is not in
   it, because that one belongs to whoever switched it off. */
const OWNED = ["name", "type", "url", "query", "category", "lang", "strict", "fallback"];

function mergeBuiltins(stored, defaults) {
  if (!stored) return defaults.map((s) => ({ ...s, enabled: true }));
  const byId = new Map(stored.map((s) => [s.id, s]));
  for (const d of defaults) {
    const cur = byId.get(d.id);
    if (!cur) { stored.push({ ...d, enabled: true }); continue; }
    for (const key of OWNED) if (key in d) cur[key] = d[key];
    // A route withdrawn from the catalogue should not live on in saved data.
    if (!("fallback" in d)) delete cur.fallback;
    cur.builtin = true;
  }
  return stored;
}

/* Fetch a source, falling back to a search feed if the site refuses us.

   Ported from collector.py's _fetch_one. Five publishers answer a laptop and
   refuse a datacenter — Cloudflare returns 403 on the address alone, so no
   header changes it — and Google News indexes the same stories for anyone. The
   fallback is tried only on failure, so where the direct feed works, it is the
   direct feed that is used: it is richer and it arrives sooner. */
async function fetchSource(source) {
  const fetcher = ARTICLE_FETCHERS[source.type];
  if (!fetcher) throw new Error("未知の種別: " + source.type);
  try {
    return { entries: await fetcher(source), viaFallback: false };
  } catch (e) {
    if (!source.fallback) throw e;
    // A search feed is plain RSS, whatever the original type was.
    const entries = await ARTICLE_FETCHERS.rss({ ...source, type: "rss", url: source.fallback });
    return { entries, viaFallback: true };
  }
}

export async function collectArticles({ store, tables, config = {}, log = () => {}, concurrency = 6 }) {
  geo.init(tables.geo);
  const terms = tables.terms;

  const stored = await store.get("sources", null);
  const sources = mergeBuiltins(stored, tables.sources.sources);
  const live = sources.filter((s) => s.enabled !== false);

  const fresh = [];
  const byId = new Map();
  let at = 0;

  async function worker() {
    while (at < live.length) {
      const source = live[at++];
      let entries, viaFallback;
      try {
        ({ entries, viaFallback } = await fetchSource(source));
      } catch (e) {
        source.error = String(e.message || e).slice(0, 120);
        source.last_count = 0;
        log(`× ${source.name} — ${source.error}`);
        continue;
      }
      try {
        let kept = 0;
        for (const entry of entries) {
          const it = normalise(entry, source, config, terms);
          if (it && !byId.has(it.id)) { byId.set(it.id, it); fresh.push(it); kept++; }
        }
        source.last_ok = now();
        source.last_count = kept;
        source.error = "";
        source.via = viaFallback ? "search" : "";
        log(`${viaFallback ? "◇" : "○"} ${source.name} — ${kept}件` +
            (viaFallback ? "（検索経由）" : ""));
      } catch (e) {
        source.error = String(e.message || e).slice(0, 120);
        log(`× ${source.name} — ${source.error}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, live.length) }, worker));

  // Merge with what is already held, keeping user state.
  const existing = await store.get("items", []);
  const merged = new Map(existing.map((it) => [it.id, it]));
  for (const it of fresh) {
    const old = merged.get(it.id);
    if (old) {
      it.bookmarked = old.bookmarked || false;
      it.fetched = old.fetched || it.fetched;
      if (old.image && !it.image) it.image = old.image;
      for (const k of ["title_ja", "summary_ja"]) if (old[k]) it[k] = old[k];
    }
    merged.set(it.id, it);
  }

  let items = [...merged.values()];
  // Titles that are nothing but a URL predate the slug fix and would sit in
  // the feed until they aged out; rewrite them on the way past.
  for (const it of items) {
    if ((it.title || "").includes("http")) {
      const fixed = fixUrlTitle(it.title, it.summary || "");
      if (fixed !== it.title) { it.title = fixed; delete it.title_ja; }
    }
    if ((it.summary || "").includes("submitted by /u/")) {
      it.summary = ""; delete it.summary_ja;
    }
  }
  // Stored items were filtered by whatever rules were in force when they were
  // collected, so tightening a rule leaves the old offenders in the feed
  // forever. Re-apply the video test on the way out.
  items = items.filter((it) => it.category !== "video" || isDroneVideo(it.title, terms));

  const cutoff = now() - (config.retention_days || 45) * 86400;
  items = items.filter((it) => it.published >= cutoff || it.bookmarked);
  items.sort((a, b) => b.published - a.published);
  items = items.slice(0, config.max_items || 5000);

  await translateItems(items, store, config, log);
  cluster(items);

  await store.set("items", items);
  await store.set("sources", sources);
  await store.set("meta", { articles_updated: now(), count: items.length });
  log(`記事 ${items.length}件（新規 ${fresh.length}件）`);
  return items;
}

async function translateItems(items, store, config, log) {
  const cache = await store.get("translations", {});
  const pending = items
    .filter((it) => it.lang !== "ja" && !it.title_ja)
    .sort((a, b) => b.published - a.published);

  // GitHub titles are `owner/repo — description`. Translating the whole thing
  // turns `malihashar/wildfire-drone` into 「マリハシャール/野火ドローン」, so only
  // the description half is sent and the repo name is kept verbatim.
  const translatable = (it) => {
    if (it.source_id === "github_uav") {
      const at = it.title.indexOf("—");
      return at < 0 ? "" : it.title.slice(at + 1).trim();
    }
    return it.title;
  };

  const titles = pending.map(translatable).filter(Boolean);
  const summaries = pending.slice(0, 150).map((it) => it.summary).filter(Boolean);
  const budget = config.translate_budget || 400;

  const { done, spent } = await translateTexts(titles, cache, { budget });
  if (spent < budget && summaries.length) {
    const more = await translateTexts(summaries, cache, { budget: budget - spent });
    Object.assign(done, more.done);
  }

  for (const it of pending) {
    const src = translatable(it);
    const t = src ? done[src] : null;
    if (t) {
      it.title_ja = src === it.title
        ? t
        : it.title.slice(0, it.title.indexOf("—")).trimEnd() + REPO_SEP + t;
    }
    const s = done[it.summary || ""];
    if (s) it.summary_ja = s;
  }
  await store.set("translations", trimCache(cache));
  log(`翻訳 ${items.filter((i) => i.title_ja).length}件`);
}
