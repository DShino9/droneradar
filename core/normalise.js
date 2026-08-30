import { has, isRelevant, isDroneVideo, topicOf } from "./classify.js";
import * as geo from "./geo.js";
import { now } from "./net.js";

/* One raw feed entry into one stored article.

   Everything that decides what an article *is* happens here: whether to keep
   it at all, which row it belongs in, where it is about, and how much it
   deserves top billing. */

// A stable id from the URL. crypto.subtle is async and would infect every
// caller, so this is a plain synchronous FNV-1a over the string — the id only
// has to be stable and collision-free within one machine's collection, not
// cryptographic.
export function itemId(url) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0"));
}

export function detectLang(text) {
  return /[぀-ゟ゠-ヿ一-鿿]/.test(text || "") ? "ja" : "en";
}

const URL_RE = /https?:\/\/\S+/;

// Reddit link posts often have nothing but the target URL for a title. A URL
// neither reads nor translates — but the slug the publisher put in it is very
// nearly the headline they wrote.
export function slugTitle(url) {
  let path;
  try { path = new URL(url).pathname; } catch { return ""; }
  const parts = path.split("/").filter(Boolean);
  if (!parts.length) return "";
  let slug = decodeURIComponent(parts[parts.length - 1]);
  slug = slug.replace(/\.(html?|php|aspx?|shtml)$/i, "")
             .replace(/[-_]?\b(?:[0-9a-f]{8,}|\d{5,})\b$/, "")
             .replace(/[-_]+/g, " ")
             .trim();
  if (slug.length < 12 || !slug.includes(" ")) return "";
  return slug[0].toUpperCase() + slug.slice(1);
}

export function fixUrlTitle(title, extra = "") {
  const bare = title.replace(URL_RE, "").replace(/^[\s\-—–|/]+|[\s\-—–|/]+$/g, "");
  if (bare.length >= 12) return title;
  const m = URL_RE.exec(`${title} ${extra}`);
  if (!m) return title;
  return slugTitle(m[0]) || title;
}

export function normalise(entry, source, config, terms) {
  const url = (entry.url || "").trim();
  let title = (entry.title || "").trim();
  if (!url || !title) return null;

  let blob = `${title} ${entry.summary || ""}`;
  for (const bad of config.exclude || []) {
    if (bad && blob.includes(bad)) return null;
  }

  // Broad search feeds pull in plenty that has nothing to do with drones;
  // `strict` marks a general-interest publication that does the same. The
  // curated drone publications need no such filter.
  const broad = ["hn", "github", "youtube_search"].includes(source.type)
    || source.strict
    || (source.url || "").includes("news.google.com")
    || (source.url || "").includes("reddit.com");
  if (broad && !isRelevant(blob, terms)) return null;

  if (source.category === "video") {
    if (has(blob, terms.video_noise)) return null;
    if (source.type === "youtube_search" && !has(blob, terms.video_good)) return null;
    if (!isDroneVideo(title, terms)) return null;
    if (source.type === "youtube_search"
        && !terms.video_droney.some((t) => title.includes(t))) return null;
  }

  // Google News appends " - 発行元" to every headline. Splitting it out gives
  // the card a real outlet name to show instead of "Googleニュース".
  let publisher = "";
  if ((source.url || "").includes("news.google.com") && title.includes(" - ")) {
    const at = title.lastIndexOf(" - ");
    const head = title.slice(0, at), tail = title.slice(at + 3);
    if (head && tail.length <= 30) { title = head.trim(); publisher = tail.trim(); }
  }

  let summary = entry.summary || "";
  if ((source.url || "").includes("reddit.com")) {
    title = fixUrlTitle(title, summary);
    // "submitted by /u/… to r/… [link] [comments]" says nothing, and once
    // translated it is the same nothing in Japanese.
    summary = "";
  }
  // Google News's description is the headline plus the outlet name, so it
  // renders as the title printed twice on the card.
  if (summary && (summary.startsWith(title.slice(0, 24))
                  || title.startsWith(summary.slice(0, 24)))) {
    summary = "";
  }

  // Re-derive the text used for geo and topic detection now that the outlet
  // name is off the end. Leaving it in made 沖縄タイムス tag a Moscow story as
  // Okinawa news, and every 東京新聞 byline looked like a Tokyo story.
  blob = `${title} ${summary}`;

  const lang = source.lang || detectLang(blob);
  const category = topicOf(blob, source.category, terms);

  const prefs = lang === "ja" ? geo.findPrefectures(blob) : [];
  const scope = geo.classifyScope(blob, lang);
  const flagship = geo.flagshipScore(blob);

  let countries = geo.findCountries(blob);
  // A Japanese piece that names a prefecture or a ministry is about Japan even
  // when it never writes 「日本」.
  if (lang === "ja" && !countries.length && (prefs.length || scope === "national")) {
    countries = ["JP"];
  }

  const t = now();
  let published = entry.published || 0;
  if (!published || published > t + 86400) published = t;

  let importance = flagship;
  if (category === "regulation") importance += 15;
  if (scope === "national") importance += 10;
  const ageH = Math.max(0, (t - published) / 3600);
  if (ageH < 6) importance += 12;
  else if (ageH < 24) importance += 6;

  return {
    id: itemId(url),
    title, url, summary,
    image: entry.image || "",
    published, fetched: t,
    source: source.name,
    publisher,
    source_id: source.id,
    category, lang,
    prefectures: prefs,
    countries: countries.slice(0, 3),
    country: countries[0] || "",
    country_ja: countries.length ? geo.countryName(countries[0]) : "",
    scope, flagship,
    importance: Math.min(100, importance),
    author: entry.author || "",
    tags: entry.tags || [],
    stars: entry.stars || 0,
    points: entry.points || 0,
  };
}
