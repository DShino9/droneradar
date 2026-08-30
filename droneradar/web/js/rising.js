import { $, S, el, hooks } from "./state.js";

/* What is suddenly being talked about.

   Every other panel answers "what is there" — counts per genre, per region, a
   list of the newest. None of them answers "what is different today", which on
   a board called a radar is the question worth answering. A subject that runs
   at two articles a day and posts eleven this morning is the thing to look at,
   and at eleven out of three thousand it is invisible in every ranking the
   dashboard already has.

   So: count each term over the last day, count it over the six days before
   that, and rank by how far today exceeds the usual. */

const DAY = 86400;
const WINDOW = 6;            // days of history to take the baseline from
const MIN_NOW = 3;           // below this a spike is one outlet repeating itself
/* An upper bound on the ranking, not on the panel. How many actually appear
   is decided by the room; this only stops the list running to fifty on a very
   busy day, past the point where anything further down is still a spike. */
const SHOW = 14;

/* Words that are in every other headline and would top the list forever. The
   subject words go too — on a drone dashboard "ドローン" spiking is not news. */
const SKIP = new Set([
  "ドローン", "無人航空機", "無人機", "空飛ぶクルマ", "ドローンの", "ドローンが",
  "drone", "drones", "uav", "uas", "the", "and", "for", "with", "from", "that",
  "this", "new", "how", "why", "you", "are", "was", "its", "has", "can", "will",
  "not", "but", "all", "out", "who", "get", "may", "now", "one", "two", "his",
  "her", "our", "they", "what", "when", "more", "than", "into", "over", "after",
  "says", "said", "first", "about", "video", "news", "ニュース", "記事", "発表",
  "実施", "開始", "予定", "可能", "場合", "必要", "利用", "使用", "提供", "対応",
  "実現", "検討", "推進", "強化", "導入", "紹介", "解説", "特集", "映像", "動画",
  // Verbs that headlines are built out of. Every one of these can spike hard
  // on a busy day and none of them says what happened.
  "開設", "開催", "公開", "展開", "参加", "募集", "登場", "実験", "実証", "拡大",
  "協力", "連携", "参画", "出展", "就任", "設立", "終了", "中止", "延期", "変更",
  "対象", "内容", "今回", "今後", "現在", "以降", "関連", "一部", "全国", "世界",
  "体験", "研究", "反発", "国境", "地域", "国内", "海外", "国際", "市場", "業界",
  "企業", "会社", "分野", "技術", "製品", "機体", "運用", "作業", "現場", "時間",
  /* Words that turn up across several stories and still say nothing. The
     story-count test above cannot catch these — they really are spread across
     the news, which is exactly why they are useless as a signal. A stopword
     list is the right tool for that, and it is a list one maintains. */
  "世代", "出店", "提供開始", "販売開始", "運航開始", "今年", "来年", "本年",
  "都市近", "全世界", "同日", "当日", "前年", "過去", "将来", "今回初",
  "service", "services", "experience", "solution", "solutions", "system",
  "systems", "company", "market", "global", "technology", "platform",
]);

/* Three kinds of thing worth counting, and nothing else.

   Latin runs catch the names — DJI, Skydio, Anduril, BVLOS, Zipline. Katakana
   runs catch them transliterated. Kanji compounds catch the subjects that have
   no Latin form at all: 国家資格, 実証実験, 農薬散布, 書類送検. Hiragana is
   left out entirely; it is grammar here, not subject matter. */
const TOKEN = /[A-Za-z][A-Za-z0-9.+-]{2,15}|[ァ-ヶー]{3,12}|[一-龠][一-龠ヶヵノ]{1,7}/g;

/* Titles that are identifiers, not sentences.

   GitHub items are "owner/repo — description", and one account had fifty-four
   repositories filed under it — so "api-evangelist" climbed the risers as the
   biggest story of the day. It is not a story; it is somebody's username, and
   selecting it filtered the dashboard down to fifty-four repository entries
   that the article panes do not show, leaving the screen looking broken.

   The description after the dash is real prose and worth counting; the
   identifier in front of it is not. */
const IDENT_HEAD = /^[\w.-]+\/[\w.-]+\s*(?:[—–-]\s*)?/;

function terms(it) {
  const raw = it.title_ja || it.title || "";
  const title = IDENT_HEAD.test(raw) ? raw.replace(IDENT_HEAD, "") : raw;
  const text = `${title} ${it.summary_ja || it.summary || ""}`;
  const out = new Set();               // once per article, not once per mention
  for (const m of text.match(TOKEN) || []) {
    const w = /[A-Za-z]/.test(m) ? m.replace(/[.+-]+$/, "") : m;
    if (w.length < 2) continue;
    if (SKIP.has(w) || SKIP.has(w.toLowerCase())) continue;
    out.add(w);
  }
  return out;
}

/* Which story an article belongs to.

   The collector groups duplicate coverage and hangs the other ids off each
   member as `related`, so the whole group shares one representative — the
   smallest id in it, chosen the same way from whichever member is asked. */
function storyKey(it) {
  const ids = [it.id, ...(it.related || [])];
  let k = ids[0];
  for (const id of ids) if (id < k) k = id;
  return k;
}

function computeRising() {
  const now = Date.now() / 1000;
  const nowCount = new Map(), baseCount = new Map();
  const sample = new Map();            // a headline to show for each term
  const seenIn = new Map();            // which articles each term came from
  const from = new Map();              // and which distinct stories they were

  /* Repositories and clips do not have a news cycle.

     GitHub pushes all day and the video searches refill continuously, so both
     produce a steady stream that any "what is rising" measure reads as a rise.
     The same reasoning that keeps them out of the new-item bell keeps them out
     of here. */
  const NOT_NEWS = new Set(["dev", "video"]);

  for (const it of S.items) {
    if (NOT_NEWS.has(it.category)) continue;
    const age = now - it.published;
    if (age < 0 || age > (WINDOW + 1) * DAY) continue;
    const recent = age <= DAY;
    const bucket = recent ? nowCount : baseCount;
    for (const w of terms(it)) {
      bucket.set(w, (bucket.get(w) || 0) + 1);
      if (recent) {
        if (!sample.has(w)) sample.set(w, it);
        if (!seenIn.has(w)) seenIn.set(w, new Set());
        seenIn.get(w).add(it.id);
        if (!from.has(w)) from.set(w, new Set());
        from.get(w).add(storyKey(it));
      }
    }
  }

  const out = [];
  for (const [w, n] of nowCount) {
    if (n < MIN_NOW) continue;
    // Per-day average over the baseline window. The +0.6 keeps a term that has
    // simply never appeared before from dividing by nothing and taking the
    // whole list — it still ranks high, which is right, but not infinitely so.
    /* Two separate stories at least.

       The count is per article, and one event reaches this dashboard as a
       dozen articles — the same strike filed by a dozen outlets. So a phrase
       lifted out of a single well-covered story arrived looking like twelve
       occurrences: "青木" out of 青木ヶ原樹海, "都市近" out of 都市近くの.

       Counting outlets does not separate them, because Google News gathers one
       event from many outlets by design. Counting *stories* does. A word that
       only ever appears inside one story is a fragment of that story's
       wording; a word that turns up across several is a subject. */
    if ((from.get(w) || new Set()).size < 2) continue;
    const base = (baseCount.get(w) || 0) / WINDOW;
    const ratio = n / (base + 0.6);
    /* Two-character compounds are where the generic words live — 開設, 都市,
       記事 — and they turn up in enough headlines that a mild rise puts them
       on the list ahead of a name that actually broke today. They have to
       climb further to earn a row. */
    if (ratio < ([...w].length <= 2 ? 3 : 1.6)) continue;
    out.push({ w, n, base: +base.toFixed(1), ratio, it: sample.get(w),
               ids: seenIn.get(w) || new Set() });
  }
  /* One story can put four terms on the list.

     "アマゾン、軽量荷物の配送を都市部へ拡大予定" spikes アマゾン, 軽量荷物,
     都市, 拡大予定 together, and the panel then shows the same piece of news
     four times over — three of those in fragments that mean nothing on their
     own. Two terms drawn from nearly the same set of articles are one subject,
     so only the strongest of them is kept.

     Containment is the same problem in miniature — 資格 inside 国家資格 — and
     falls out of the same test. */
  out.sort((a, b) => b.ratio - a.ratio || b.n - a.n);
  const OVERLAP = 0.6;
  const kept = [];
  for (const r of out) {
    const dup = kept.some((k) => {
      if (k.w.includes(r.w) || r.w.includes(k.w)) return true;
      let shared = 0;
      for (const id of r.ids) if (k.ids.has(id)) shared++;
      return shared / Math.min(r.ids.size, k.ids.size || 1) >= OVERLAP;
    });
    if (dup) continue;
    kept.push(r);
    if (kept.length >= SHOW) break;
  }
  return kept;
}

function renderRising() {
  const box = $("#rising");
  if (!box) return;
  const rows = computeRising();
  box.innerHTML = "";
  if (!rows.length) {
    box.append(el("div", "rise-empty", "急な動きはありません"));
    $("#rising-meta").textContent = "24時間";
    return;
  }
  /* Only as many as the panel can actually show.

     The box hides its overflow, so rendering seven rows into room for five
     did not spill — it silently dropped the last two, which on a list ranked
     by how much something is rising means dropping nothing you would notice
     was missing. Better to ask the room how many it wants. */
  const rowH = box.querySelector(".rise");
  const step = rowH ? rowH.offsetHeight : 24;
  const fits = box.clientHeight ? Math.max(2, Math.floor(box.clientHeight / (step || 24))) : SHOW;
  const top = rows[0].ratio;
  for (const r of rows.slice(0, fits)) {
    const row = el("button", "rise");
    row.append(el("span", "rw", r.w));
    row.append(el("span", "rn", `${r.n}`));
    // The bar is relative to the biggest riser, not to an absolute scale:
    // what matters is which of these is moving hardest.
    const bar = el("span", "rbar");
    bar.style.width = `${Math.max(8, (r.ratio / top) * 100)}%`;
    row.append(bar);
    row.title = `${r.w}　直近24時間 ${r.n}件（通常 1日あたり ${r.base}件）`
      + (r.it ? `\n${(r.it.title_ja || r.it.title || "").slice(0, 60)}` : "");
    row.onclick = () => {
      $("#search").value = r.w;
      Object.assign(S.filter, { q: r.w, view: "feed" });
      S.limit = 40; hooks.renderAll();
    };
    box.append(row);
  }
  $("#rising-meta").textContent = `24時間 ${Math.min(rows.length, fits)}語`;
}

export { MIN_NOW, SHOW, WINDOW, computeRising, renderRising };
