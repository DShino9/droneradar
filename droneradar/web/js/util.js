import { groupOf } from "./genre.js";
import { $, S, catColor } from "./state.js";
import { isLive } from "./mode.js";

function ago(ts) {
  if (!ts) return "";
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return "たった今";
  if (s < 3600) return `${Math.floor(s / 60)}分前`;
  if (s < 86400) return `${Math.floor(s / 3600)}時間前`;
  const d = Math.floor(s / 86400);
  if (d < 31) return `${d}日前`;
  return new Date(ts * 1000).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
}

function hue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

/* Article thumbnails.

   The Mac app fetches the image itself and serves it back same-origin, which
   sidesteps hotlink checks and mixed content in one move. A static host has no
   proxy, so the published page goes to the publisher directly, with the
   referrer stripped (cards.js) — that clears most hotlink checks, which look
   at Referer. Whatever is still refused lands on the onerror placeholder: the
   tile keeps its shape and shows the publisher's name instead of a broken
   image, which is the behaviour the page already had for imageless items.

   The counters exist so "how many are actually failing" is a number and not
   an impression. Read them from the console as `__img`, or from the readout
   under the source list. */
const imgStats = { tried: 0, failed: 0, hosts: {} };
if (typeof window !== "undefined") window.__img = imgStats;

function proxied(url) {
  imgStats.tried++;
  return isLive() ? "/img?u=" + encodeURIComponent(url) : url;
}

function imageFailed(url) {
  imgStats.failed++;
  try {
    const host = new URL(url, location.href).hostname;
    imgStats.hosts[host] = (imgStats.hosts[host] || 0) + 1;
  } catch (e) { /* a malformed URL is already counted in `failed` */ }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function toast(msg, ms = 3200) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), ms);
}

function setOffline(off) {
  if (S.offline === off) return;
  S.offline = off;
  const dot = $("#live-dot");
  if (dot) dot.classList.toggle("offline", off);
  const label = $("#updated");
  if (label && off) label.textContent = "接続なし";
}

// Headlines arrive padded with decoration: 【ドローン空撮4K】, trailing site
// names, 「(動画)」. Yahoo-style rows read far better once that is stripped and
// the rest is cut at a natural break rather than mid-word. Display only — the
// original title is kept for search and shown on hover.
const KEEP_MARKERS = /^(速報|独自|詳報|特集|解説|寄稿|社説|訃報|注意|警報|続報)$/;

const SITE_TAIL = /\s*[|｜]\s*[^|｜]{1,24}$/;

const DASH_TAIL = /\s+[-–—]\s+[^-–—]{1,24}$/;

const TRAILING_PAREN = /[（(](動画|写真|画像|速報|PR|AD|\d+枚|\d+分)[)）]\s*$/;

function shortTitle(raw, limit = 36) {
  // Some feeds hand over headlines that open with a dangling dash or colon.
  let t = (raw || "").replace(/\s+/g, " ").trim().replace(/^[-–—:：|｜]+\s*/, "");

  // Drop decorative leading brackets, keeping the ones that carry news value.
  for (let i = 0; i < 2; i++) {
    const m = t.match(/^[【\[［]([^】\]］]{1,12})[】\]］]\s*/);
    if (!m) break;
    if (KEEP_MARKERS.test(m[1].trim())) break;
    const rest = t.slice(m[0].length).trim();
    if (rest.length < 8) break;      // the bracket was the whole headline
    t = rest;
  }

  t = t.replace(TRAILING_PAREN, "").trim();
  if (t.length > limit) {
    const trimmed = t.replace(SITE_TAIL, "").replace(DASH_TAIL, "").trim();
    if (trimmed.length >= 12) t = trimmed;
  }
  if (t.length <= limit) return t;

  // Cut at the last natural break inside the budget; fall back to a hard cut.
  const head = t.slice(0, limit);
  const brk = Math.max(head.lastIndexOf("、"), head.lastIndexOf("。"),
                       head.lastIndexOf("　"), head.lastIndexOf(" "),
                       head.lastIndexOf("・"), head.lastIndexOf("／"));
  return (brk >= limit * 0.55 ? head.slice(0, brk) : head).trim() + "…";
}

// Same story, different mastheads. The backend clusters too, but only over a
// recent slice and with a stricter threshold, so wire copy reprinted by four
// outlets still reached the lead row four times. Fold them here by comparing
// the headline text itself and keep a count for the badge.
const STORY_NOISE = /[\s　「」『』【】、。,.\-—–:：･・|｜()（）[\]"'!?？]+/g;

function storyKeys(title) {
  const t = (title || "").toLowerCase().replace(STORY_NOISE, "");
  if (/[ぁ-んァ-ヶ一-龠]/.test(t)) {
    const set = new Set();
    for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
    return set;
  }
  return new Set((title || "").toLowerCase().split(/\s+/).filter((w) => w.length > 2));
}

function sameStory(a, b) {
  if (a.size < 4 || b.size < 4) return false;
  let shared = 0;
  for (const k of a) if (b.has(k)) shared++;
  return shared >= 3 && shared / Math.max(a.size, b.size) >= 0.42;
}

// Character overlap alone misses the same event told differently — "モスクワに
// 無人機600機" vs "モスクワ方面に大規模無人機攻撃". Distinctive tokens catch
// those, but only after discarding the ones that appear in half the feed
// (ドローン, ロシア, ウクライナ), which would otherwise merge unrelated stories.
// Words shared by nearly every drone headline; counting them as "specifics"
// would merge unrelated stories.
const STORY_STOPWORDS = new Set([
  "ドローン", "無人機", "無人航空機", "攻撃", "使用", "実施", "発表", "報道",
  "可能", "対応", "開始", "検討", "問題", "技術", "会社", "企業", "日本",
]);

function salientTokens(title) {
  const t = title || "";
  return new Set([
    ...(t.match(/[ァ-ヴー]{3,}/g) || []),
    ...(t.match(/\d{2,}/g) || []),
    ...(t.match(/[A-Z][A-Z0-9-]{1,}/g) || []),
    ...(t.match(/[一-龠]{2,4}/g) || []),
  ]);
}

function dedupeStories(list, limit = Infinity) {
  const prepared = list.map((it) => {
    const title = it.title_ja || it.title;
    return { it, keys: storyKeys(title), salient: salientTokens(title) };
  });

  const df = new Map();
  for (const p of prepared) {
    for (const tok of p.salient) df.set(tok, (df.get(tok) || 0) + 1);
  }
  const rareMax = Math.max(2, Math.floor(prepared.length * 0.06));
  const rareOf = (set) => new Set([...set].filter((t) => (df.get(t) || 0) <= rareMax));

  const out = [];
  for (const p of prepared) {
    const rare = rareOf(p.salient);
    const hit = out.find((prev) => {
      if (sameStory(p.keys, prev._keys)) return true;
      const gap = Math.abs(p.it.published - prev.published);
      if (gap <= 36 * 3600) {
        let shared = 0;
        for (const t of rare) if (prev._rare.has(t)) shared++;
        if (shared >= 2) return true;
      }
      // Same day, same country, and three shared specifics: this is the case
      // of one event told five ways ("モスクワに無人機600機" /
      // "モスクワ方面に大規模無人機攻撃"), where the place name is too common
      // in this feed to count as rare on its own.
      // Compare country *sets*, not the primary one: the same Moscow strike is
      // filed under ロシア by one outlet and ウクライナ by the next.
      const shareCountry = (p.it.countries || []).some(
        (c) => (prev.countries || []).includes(c));
      if (gap <= 24 * 3600 && shareCountry) {
        let shared = 0;
        for (const t of p.salient) {
          if (!STORY_STOPWORDS.has(t) && prev._salient.has(t)) shared++;
        }
        if (shared >= 3) return true;
      }
      return false;
    });
    if (hit) {
      hit.dupCount += 1;
      continue;
    }
    const entry = Object.create(p.it);
    entry._keys = p.keys;
    entry._rare = rare;
    entry._salient = p.salient;
    entry.dupCount = Math.max(1, p.it.cluster || 1);
    out.push(entry);
    if (out.length >= limit) break;
  }
  return out;
}

function catLabel(key) {
  const found = S.categories.find(([k]) => k === key);
  return found ? found[1] : key;
}

// Tint = the category that dominates the region, depth = how many items.
function regionFill(byCat, total, max) {
  if (!total) return null;
  let top = null, best = -1;
  for (const [key, n] of Object.entries(byCat)) {
    if (n > best) { best = n; top = key; }
  }
  const pct = 20 + Math.round(70 * Math.sqrt(total / max));
  return `color-mix(in srgb, ${catColor(top)} ${pct}%, var(--pref-0))`;
}

/* ----------------------------------------------------------------- filter */

function visibleItems(ignoreDay) {
  const f = S.filter;
  const now = Date.now() / 1000;
  const q = f.q.trim().toLowerCase();
  let out = S.items.filter((it) => {
    if (it.category === "video") return false;      // videos live in the rail
    if (f.bucket === "saved" && !it.bookmarked) return false;
    if (f.cat && it.category !== f.cat) return false;
    // A group with no category picked means everything filed under it.
    if (!f.cat && f.group && (groupOf(it.category) || {}).key !== f.group) return false;
    if (f.pref && !(it.prefectures || []).includes(f.pref)) return false;
    if (f.country && !(it.countries || []).includes(f.country)) return false;
    if (f.scope && it.scope !== f.scope) return false;
    if (f.lang !== "all" && it.lang !== f.lang) return false;
    if (f.imgOnly && !it.image) return false;
    if (!ignoreDay && f.day
        && (it.published < f.day || it.published >= f.day + 86400)) return false;
    if (f.days && now - it.published > f.days * 86400) return false;
    if (q) {
      const blob = (it.title + " " + (it.title_ja || "") + " " + it.summary + " "
                    + (it.summary_ja || "") + " " + it.source + " "
                    + (it.publisher || "")).toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  });
  const sorters = {
    new: (a, b) => b.published - a.published,
    important: (a, b) => b.importance - a.importance || b.published - a.published,
    cluster: (a, b) => (b.cluster || 1) - (a.cluster || 1) || b.published - a.published,
  };
  out.sort(sorters[f.sort] || sorters.new);
  return out;
}

/* ---------------------------------------------------------------- sidebar */

export { DASH_TAIL, KEEP_MARKERS, SITE_TAIL, STORY_NOISE, STORY_STOPWORDS, TRAILING_PAREN, ago, catLabel, dedupeStories, escapeHtml, hue, imageFailed, imgStats, proxied, regionFill, salientTokens, sameStory, setOffline, shortTitle, storyKeys, toast, visibleItems };
