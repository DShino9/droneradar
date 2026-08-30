import { httpText, httpJson, absolute, now, FetchError } from "./net.js";
import { parseFeed, parseDate, stripHtml } from "./feed.js";

/* One fetcher per source type. Each returns the same entry shape the feed
   parser produces, so the collector never has to care where an item came
   from. */

export async function fetchRss(source) {
  const { text } = await httpText(source.url, { timeout: 25000 });
  return parseFeed(text);
}

// Impress's ドローンジャーナル has no feed, so the listing page is read
// directly. Split on the opening tag rather than matching through to </li>:
// each block nests a <ul class="list-label"> whose own </li> ends the match
// early and swallows the title.
const DJ_SPLIT = /<li class="item[^"]*">/;
const DJ_URL = /href="(https:\/\/drone-journal\.impress\.co\.jp\/docs\/[^"]+\.html)"/;
const DJ_IMG = /<img[^>]*ajax="([^"]+)"/;
const DJ_TITLE = /<p class="title"><a[^>]*>([\s\S]*?)<\/a>/;
const DJ_DATE = /<p class="date">\(([^)]+)\)<\/p>/;
const DJ_LABEL = /<span class="label[^"]*">([^<]+)<\/span>/g;

export async function fetchDroneJournal(source) {
  const { text, url: base } = await httpText(source.url, { timeout: 25000 });
  return parseDroneJournal(text, base);
}

export function parseDroneJournal(text, base) {
  const out = [];
  const blocks = text.split(DJ_SPLIT).slice(1);
  for (const block of blocks) {
    const mUrl = DJ_URL.exec(block);
    const mTitle = DJ_TITLE.exec(block);
    if (!mUrl || !mTitle) continue;
    const title = stripHtml(mTitle[1], 300);
    if (!title) continue;
    const mImg = DJ_IMG.exec(block);
    const mDate = DJ_DATE.exec(block);
    const labels = [...block.matchAll(DJ_LABEL)].map((m) => stripHtml(m[1], 20));
    out.push({
      title,
      url: mUrl[1],
      summary: "",
      published: mDate ? parseDate(mDate[1].replace(/\//g, "-")) : 0,
      image: mImg ? absolute(mImg[1], base) : null,
      author: "",
      tags: labels.filter((t) => t && t !== "ニュース"),
    });
  }
  if (!out.length) throw new FetchError("記事ブロックを検出できませんでした");
  return out;
}

export async function fetchArxiv(source) {
  const q = encodeURIComponent(`all:(${source.url})`);
  const url = `http://export.arxiv.org/api/query?search_query=${q}` +
    "&sortBy=submittedDate&sortOrder=descending&max_results=40";
  const { text } = await httpText(url, { timeout: 30000 });
  return parseFeed(text);
}

export async function fetchHn(source) {
  const q = source.url;
  const url = "https://hn.algolia.com/api/v1/search_by_date?query=" +
    encodeURIComponent(q) + "&tags=story&hitsPerPage=40&typoTolerance=false";
  const data = await httpJson(url, { timeout: 25000 });
  return parseHn(data, q);
}

export function parseHn(data, q) {
  const out = [];
  for (const h of data.hits || []) {
    const title = h.title || h.story_title || "";
    // Algolia still returns loose matches; keep only real hits on the term.
    const blob = (title + " " + (h.story_text || "")).toLowerCase();
    if (!blob.includes(q.toLowerCase())) continue;
    out.push({
      title: stripHtml(title, 300),
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      summary: stripHtml(h.story_text || "", 300),
      published: parseInt(h.created_at_i || 0, 10),
      image: null,
      author: h.author || "",
      points: h.points || 0,
      comments: h.num_comments || 0,
    });
  }
  return out;
}

export async function fetchGithub(source) {
  const url = "https://api.github.com/search/repositories?q=" +
    encodeURIComponent(source.url) + "&sort=updated&per_page=30";
  const data = await httpJson(url, { timeout: 25000 });
  return parseGithub(data);
}

export function parseGithub(data) {
  return (data.items || []).map((r) => ({
    title: `${r.full_name} — ${r.description || ""}`,
    url: r.html_url,
    summary: stripHtml(r.description || "", 300),
    published: parseDate(r.pushed_at || ""),
    // Deliberately no image: an owner avatar stretched to a 16:9 thumbnail
    // looks like a mistake, and the generated placeholder reads better.
    image: null,
    author: (r.owner || {}).login || "",
    stars: r.stargazers_count || 0,
  }));
}

// YouTube only ever reports "3 週間前", never a timestamp, so relative text is
// all there is to date a video by.
const REL_UNITS = [
  [["秒", "second"], 1],
  [["分", "minute"], 60],
  [["時間", "hour"], 3600],
  [["日", "day"], 86400],
  [["週間", "week"], 604800],
  [["か月", "ヶ月", "カ月", "month"], 2592000],
  [["年", "year"], 31536000],
];

export function parseRelativeTime(text) {
  if (!text) return 0;
  const m = /(\d+)/.exec(text);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  // Longest unit first: 時間 must beat 時, か月 must beat 月.
  const order = [...REL_UNITS].sort(
    (a, b) => Math.max(...b[0].map((x) => x.length)) - Math.max(...a[0].map((x) => x.length)));
  for (const [names, secs] of order) {
    if (names.some((name) => text.includes(name))) return now() - n * secs;
  }
  return 0;
}

function walkVideos(node, out) {
  if (Array.isArray(node)) {
    for (const c of node) walkVideos(c, out);
  } else if (node && typeof node === "object") {
    const v = node.videoRenderer;
    if (v && typeof v === "object" && v.videoId) out.push(v);
    for (const c of Object.values(node)) walkVideos(c, out);
  }
}

const YT_DATA = /var ytInitialData = (\{[\s\S]*?\});<\/script>/;

export async function fetchYoutubeSearch(source) {
  // The Data API needs a key, but the results page embeds everything wanted in
  // ytInitialData. sp=CAI%3D is the "sort by upload date" filter.
  const url = "https://www.youtube.com/results?search_query=" +
    encodeURIComponent(source.url) + "&sp=CAI%253D";
  const { text } = await httpText(url, { timeout: 30000 });
  return parseYoutubeSearch(text);
}

export function parseYoutubeSearch(text) {
  const m = YT_DATA.exec(text);
  if (!m) throw new FetchError("ytInitialData が見つかりません");
  let data;
  try { data = JSON.parse(m[1]); }
  catch (e) { throw new FetchError("ytInitialData の解析に失敗 (" + String(e.message).slice(0, 40) + ")"); }

  const renderers = [];
  walkVideos(data, renderers);
  const out = [];
  for (const v of renderers) {
    const runs = v.title && v.title.runs;
    if (!Array.isArray(runs)) continue;
    const title = runs.map((r) => r.text || "").join("");
    if (!title) continue;
    let owner = "";
    try { owner = v.ownerText.runs[0].text; } catch { /* absent on some cards */ }
    const thumbs = (v.thumbnail || {}).thumbnails || [];
    const published = parseRelativeTime((v.publishedTimeText || {}).simpleText || "");
    const views = (v.viewCountText || {}).simpleText || "";
    const length = (v.lengthText || {}).simpleText || "";
    out.push({
      title: stripHtml(title, 300),
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
      summary: [owner, length, views].filter(Boolean).join("　"),
      published,
      image: thumbs.length ? thumbs[thumbs.length - 1].url : null,
      author: owner,
    });
  }
  if (!out.length) throw new FetchError("動画を検出できませんでした");
  return out;
}

export const ARTICLE_FETCHERS = {
  rss: fetchRss,
  dronejournal: fetchDroneJournal,
  arxiv: fetchArxiv,
  hn: fetchHn,
  github: fetchGithub,
  youtube_search: fetchYoutubeSearch,
};
