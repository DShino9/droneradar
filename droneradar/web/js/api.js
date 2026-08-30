import { $, S, hooks } from "./state.js";
import { ago, setOffline, toast, visibleItems } from "./util.js";
import { isLive, resolveMode, staticFile, withDeadline } from "./mode.js";
import { renderRadar } from "./radar.js";
import { renderTicker } from "./ticker.js";
import { renderStocks } from "./stocks.js";

/* Bookmarks, when there is no server to keep them.

   On the Mac the star is a fact about the collection: the collector reads it
   back and refuses to prune a starred item. The published page has nowhere to
   write, so the star lives in that browser's localStorage and is laid over
   the items as they load. It follows that a star set on the phone does not
   protect the item from the retention cutoff, and does not appear on the Mac.
   Two devices, two sets of stars — worth knowing before wondering why. */
const BM_KEY = "droneradar.bookmarks";

function localBookmarks() {
  try {
    return new Set(JSON.parse(localStorage.getItem(BM_KEY) || "[]"));
  } catch (e) {
    return new Set();
  }
}

function saveLocalBookmark(id, on) {
  const marks = localBookmarks();
  if (on) marks.add(id); else marks.delete(id);
  try {
    localStorage.setItem(BM_KEY, JSON.stringify([...marks]));
  } catch (e) {
    toast("この端末に星を保存できませんでした");
  }
}

// Returns null instead of throwing: the polling timers would otherwise raise an
// unhandled rejection every few seconds once the app is quit with the tab left
// open, and one failed poll should not take the page down.
async function api(path, body) {
  await resolveMode();
  if (body) return write(path, body);

  // Live: /api/state. Published: the same payload frozen at api/state.json.
  // no-cache because GitHub Pages sends max-age=600, and a dashboard that
  // shows ten-minute-old data without saying so is worse than a slow one.
  const url = isLive() ? path : staticFile(path);
  if (!url) {
    setOffline(true);
    return null;
  }
  try {
    const r = await withDeadline(fetch(url, { cache: "no-cache" }), 20000);
    if (!r.ok) throw new Error(r.status);
    const data = await r.json();
    setOffline(false);
    return data;
  } catch (e) {
    setOffline(true);
    return null;
  }
}

async function write(path, body) {
  if (isLive()) {
    try {
      const r = await withDeadline(fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }), 20000);
      const data = await r.json();
      setOffline(false);
      return data;
    } catch (e) {
      setOffline(true);
      return null;
    }
  }
  if (path === "/api/bookmark") {
    saveLocalBookmark(body.id, body.on);
    return { ok: true };
  }
  // Say so rather than failing quietly: a button that does nothing and
  // explains nothing is the failure mode that costs the most to diagnose.
  toast("この画面は読むだけです。変更は Mac の DroneRadar から");
  return null;
}

async function load() {
  const st = await api("/api/state");
  if (!st) return;
  const previous = S.seenItems;
  const incoming = st.items || [];
  if (!isLive()) {
    const marks = localBookmarks();
    for (const it of incoming) it.bookmarked = marks.has(it.id);
  }

  /* What counts as new.

     Not everything that arrives is an arrival. GitHub pushes repositories all
     day and the social feeds refill every twenty seconds, so treating those as
     news meant the bell rang for a run that had brought nothing a reader would
     call news — and the highlight it put up landed on items the article panes
     do not even show, which is how the sound came without anything lighting.

     Videos are the same case: the player works through them continuously and
     a new one appearing is not an event. */
  const NOT_NEWS = new Set(["dev", "video", "community"]);
  if (previous.size) {
    S.freshItems = new Set(
      incoming
        .filter((it) => !previous.has(it.id) && !NOT_NEWS.has(it.category))
        .map((it) => it.id));
  }
  S.seenItems = new Set(incoming.map((it) => it.id));
  S.items = incoming;
  if (S.freshItems.size) S.videoCursor += 3;
  S.sources = st.sources || [];
  S.socialSources = st.social_sources || [];
  S.categories = st.categories || [];
  S.config = st.config || {};
  S.meta = st.meta || {};
  $("#updated").textContent = st.running ? "収集中…" : ago(st.meta?.articles_updated) || "—";
  $("#live-dot").classList.toggle("busy", !!st.running);
  $("#refresh").classList.toggle("busy", !!st.running);
  hooks.renderAll();
  hooks.announceNew();
}

async function loadSocial() {
  const d = await api("/api/social");
  if (!d) return;
  S.social = d.items || [];
  renderTicker();
  if (S.filter.view === "feed") renderRadar(visibleItems(false));
  $("#ticker-meta").textContent =
    `${S.social.length}件 · ${ago(d.meta?.updated)}更新`;
}

async function loadStocks() {
  const d = await api("/api/stocks");
  if (!d) return;
  S.stocks = d.items || [];
  S.stockMeta = d.updated || 0;
  renderStocks();
}

async function pollStatus() {
  const st = await api("/api/status");
  if (!st) return;
  const busy = st.articles.running;
  $("#live-dot").classList.toggle("busy", busy);
  $("#refresh").classList.toggle("busy", busy);
  if (busy) $("#updated").textContent = "収集中…";
  else if (st.articles.updated && st.articles.updated !== pollStatus._last) {
    pollStatus._last = st.articles.updated;
    await load();
  } else {
    $("#updated").textContent = ago(S.meta?.articles_updated) || "—";
  }
}

/* ------------------------------------------------------------------ wire */

export { api, load, loadSocial, loadStocks, pollStatus };
