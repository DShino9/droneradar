import { $, S, el, hooks } from "./state.js";
import { ago, escapeHtml, hue, proxied } from "./util.js";

function renderTicker() {
  const box = $("#ticker");
  // Only auto-scroll back to the newest post if the reader was already there;
  // yanking the list while they are reading further down is hostile.
  const atTop = box.scrollTop < 24;
  const net = document.querySelector("#net-seg button.on").dataset.net;
  const posts = S.social
    .filter((p) => net === "all" || p.network === net)
    .slice(0, 60);

  box.innerHTML = "";
  for (const p of posts) {
    const isNew = !S.seenPosts.has(p.id);
    const row = el("div", "post" + (isNew && S.seenPosts.size ? " fresh" : ""));
    // Take the class off once it has played. A one-shot entry animation that
    // keeps its class stays registered with the compositor forever, and with
    // sixty posts in the list that was a third of everything animating.
    if (isNew && S.seenPosts.size) {
      setTimeout(() => row.classList.remove("fresh"), 600);
    }
    S.seenPosts.add(p.id);

    if (p.avatar) {
      const av = el("img", "av");
      av.src = proxied(p.avatar); av.alt = ""; av.loading = "lazy";
      av.onerror = () => { av.replaceWith(avPlaceholder(p)); };
      row.append(av);
    } else {
      row.append(avPlaceholder(p));
    }

    const body = el("div");
    const head = el("div", "pu");
    head.append(el("span", `net ${p.network}`, { x: "X", mastodon: "M", reddit: "R", hn: "HN" }[p.network] || "?"));
    head.append(el("span", "pn", p.author || p.handle || ""));
    head.append(el("span", null, ago(p.created)));
    body.append(head);

    const text = el("div", "pt");
    text.innerHTML = highlight(p.text, p.highlights);
    body.append(text);

    if (p.likes || p.reposts || p.replies) {
      const foot = el("div", "pf");
      if (p.reposts) foot.append(el("span", null, `↺ ${p.reposts}`));
      if (p.likes) foot.append(el("span", null, `♥ ${p.likes}`));
      if (p.replies) foot.append(el("span", null, `💬 ${p.replies}`));
      body.append(foot);
    }
    row.append(body);
    row.onclick = () => p.url && window.open(p.url, "_blank", "noopener");
    box.append(row);
  }
  if (!posts.length) box.append(el("div", "empty", "取得中…"));
  if (atTop) box.scrollTop = 0;

  const t = $("#trends");
  t.innerHTML = "";
  for (const [word, n] of computeTrends()) {
    const s = el("span", null, `${word} ${n}`);
    s.style.cursor = "pointer";
    s.title = `${n}件の投稿で言及`;
    s.onclick = () => { $("#search").value = word; S.filter.q = word; S.limit = 40; hooks.renderAll(); };
    t.append(s);
  }
}

// The words co-occurring with drone talk right now, counted off the posts we
// already hold. (Yahoo's own trend list is site-wide and unrelated to the query.)
const TREND_SKIP = new Set([
  "ドローン", "ドローンの", "ドローンが", "ドローンを", "drone", "drones", "uav", "uas",
  "無人航空機", "空飛ぶクルマ", "https", "http", "the", "and", "for", "you", "that",
  "with", "this", "was", "are", "から", "した", "する", "です", "ます", "こと", "ない",
  "リプ", "アップ", "ツイート", "フォロー", "クルマ", "newsgroup", "com", "www",
]);

function computeTrends() {
  const counts = new Map();
  for (const p of S.social) {
    const seen = new Set();
    // Drop links first, or every t.co shortener contributes "https" and "com".
    const text = (p.text || "").replace(/https?:\/\/\S+/g, " ");
    const tokens = [
      ...(text.match(/#[^\s#、。]{2,18}/g) || []),
      ...(text.match(/[ァ-ヴー]{3,12}/g) || []),
      ...(text.match(/[A-Za-z][A-Za-z0-9'-]{2,18}/g) || []),
    ];
    for (let tok of tokens) {
      tok = tok.replace(/[.,!?]+$/, "");
      const key = tok.toLowerCase();
      if (TREND_SKIP.has(key) || tok.length < 3) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      counts.set(tok, (counts.get(tok) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
}

function avPlaceholder(p) {
  const n = el("div", "av ph-av", (p.author || p.handle || "?").slice(0, 1));
  n.style.background = `hsl(${hue(p.handle || p.author || "x")} 45% 40%)`;
  return n;
}

function highlight(text, terms) {
  let html = escapeHtml(text);
  for (const t of terms || []) {
    if (!t) continue;
    html = html.split(escapeHtml(t)).join(`<mark>${escapeHtml(t)}</mark>`);
  }
  return html;
}

/* --------------------------------------------------------------- stocks */

export { TREND_SKIP, avPlaceholder, computeTrends, highlight, renderTicker };
