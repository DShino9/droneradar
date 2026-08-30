import { $, COUNTRY_JA, PREF_BY_CODE, S, catColor, el, hooks } from "./state.js";
import { ago, catLabel, dedupeStories, hue, imageFailed, proxied, shortTitle, visibleItems } from "./util.js";
import { api } from "./api.js";
import { renderSidebar } from "./sidebar.js";
import { sonarPing } from "./sound.js";
import { GROUPS, catIcon, flagOf, groupOf } from "./genre.js";

// Registered here rather than in main: the module that owns a function is
// the one that should publish it.
hooks.renderCards = (items) => renderCards(items);
hooks.announceNew = () => announceNew();

function thumbNode(it) {
  const wrap = el("div", "thumb");
  if (it.image) {
    const img = el("img");
    img.loading = "lazy";
    img.alt = "";
    // Most hotlink checks look at Referer; sending none clears them.
    img.referrerPolicy = "no-referrer";
    img.src = proxied(it.image);
    img.onerror = () => {
      imageFailed(it.image);
      wrap.innerHTML = "";
      wrap.classList.add("ph-only");
      wrap.append(placeholder(it));
      if (it.flagship > 0) wrap.append(el("span", "flagtag", "重要"));
    };
    wrap.append(img);
  } else {
    wrap.classList.add("ph-only");
    wrap.append(placeholder(it));
  }
  if (it.flagship > 0) wrap.append(el("span", "flagtag", "重要"));
  else if (it.scope === "national") wrap.append(el("span", "flagtag", "全国"));
  return wrap;
}

function placeholder(it) {
  // Aggregator feeds (GitHub, arXiv, Reddit) would otherwise paint whole rows
  // of identical tiles, so label them with something specific to the item and
  // vary the shade per item while keeping the publisher's base hue.
  let name = it.publisher || it.source || "?";
  if (it.source_id === "github_uav") name = it.title.split(" — ")[0];
  else if (it.category === "research") name = "arXiv " + (it.title.split(/[:：]/)[0] || "");
  const p = el("div", "ph", name.slice(0, 20));
  const h = hue(it.publisher || it.source || "?");
  const shift = hue(it.id) % 26;
  p.style.background =
    `linear-gradient(135deg, hsl(${h} 52% ${28 + (shift % 9)}%), hsl(${(h + 40 + shift) % 360} 55% 20%))`;
  return p;
}

/* The flag and the name in one tag, but as separate elements: run together as
   one string the flag inherits the name's size, and at 12.5px a flag is a
   smudge of colour rather than a flag. It carries the identification here, so
   it gets to be the larger of the two. */
function countryTag(it) {
  const tag = el("span", "ctag");
  const flag = flagOf(it.country);
  if (flag) tag.append(el("span", "cflag", flag));
  tag.append(el("span", "cname", it.country_ja || it.country));
  return tag;
}

function cardNode(it) {
  const card = el("article", "card" + (it.flagship > 0 ? " flag" : "")
                  + (S.freshItems.has(it.id) ? " fresh" : ""));
  // The new-item pulse takes the genre's own colour, so a glance says not
  // just "something arrived" but what kind of thing arrived.
  if (S.freshItems.has(it.id)) card.style.setProperty("--fresh", catColor(it.category));
  card.append(thumbNode(it));
  const body = el("div", "cbody");
  const titleLine = el("div", "ct");
  if (it.country && it.country !== "JP") {
    // The flag reads faster than the name, and at this size the name alone is
    // four characters that look like every other four characters.
    titleLine.append(countryTag(it));
  }
  const fullTitle = it.title_ja || it.title;
  titleLine.append(document.createTextNode(shortTitle(fullTitle, 44)));
  card.title = fullTitle;
  body.append(titleLine);
  // Keep the original headline visible under the translation — machine output
  // garbles product names often enough that the source line matters.
  if (it.title_ja) body.append(el("div", "ct-orig", it.title));
  const summary = it.summary_ja || it.summary;
  if (summary) body.append(el("div", "cs", summary.slice(0, 96)));

  const meta = el("div", "cm");
  // Which genre this is. The tint on the card said it before, but the tint is
  // one of seven now and shared with three other categories.
  meta.append(catIcon(it.category, 13));
  meta.append(el("span", null, it.publisher || it.source));
  meta.append(el("span", null, ago(it.published)));
  for (const code of (it.prefectures || []).slice(0, 2)) {
    meta.append(el("span", "tag pref", PREF_BY_CODE[code] || ""));
  }
  if (it.scope === "national" && !(it.prefectures || []).length) {
    meta.append(el("span", "tag nat", "全国"));
  }
  if ((it.cluster || 1) > 1) meta.append(el("span", "tag", `${it.cluster}媒体`));

  const star = el("button", "star" + (it.bookmarked ? " on" : ""), it.bookmarked ? "★" : "☆");
  star.title = "保存";
  star.onclick = async (e) => {
    e.stopPropagation();
    it.bookmarked = !it.bookmarked;
    star.className = "star" + (it.bookmarked ? " on" : "");
    star.textContent = it.bookmarked ? "★" : "☆";
    await api("/api/bookmark", { id: it.id, on: it.bookmarked });
    renderSidebar();
  };
  meta.append(star);

  body.append(meta);
  card.append(body);
  card.onclick = () => window.open(it.url, "_blank", "noopener");
  return card;
}

// Per-category caps when grouping, so 開発・OSS can't bury the news the way it
// does in a flat "newest first" list.
const GROUP_STEP = 8;

// Dense headline row: small thumb, two-line title, one meta line.
function tileNode(it) {
  const tile = el("article", "tile" + (it.flagship > 0 ? " flag" : "")
                  + (S.freshItems.has(it.id) ? " fresh" : ""));
  if (S.freshItems.has(it.id)) tile.style.setProperty("--fresh", catColor(it.category));

  const thumb = el("div", "tthumb");
  const placeholderTile = () => {
    const name = it.publisher || it.source || "?";
    const ph = el("div", "tph", name.slice(0, 12));
    const h = hue(name);
    ph.style.background = `linear-gradient(135deg, hsl(${h} 50% 32%), hsl(${(h + 40) % 360} 52% 21%))`;
    return ph;
  };
  if (it.image) {
    const img = el("img");
    img.loading = "lazy"; img.alt = ""; img.referrerPolicy = "no-referrer";
    img.src = proxied(it.image);
    img.onerror = () => {
      imageFailed(it.image);
      thumb.innerHTML = ""; thumb.append(placeholderTile());
    };
    thumb.append(img);
  } else {
    thumb.append(placeholderTile());
  }
  tile.append(thumb);

  const body = el("div");
  /* The headline gets the headline line to itself.

     The country used to sit in front of it, so the first line of a two-line
     headline read "🇺🇦 ウクライナ BlueBird Tech、…" and the news started on
     line two. Where the story is from belongs with who filed it and when. */
  const title = el("div", "tt");
  const full = it.title_ja || it.title;
  title.append(document.createTextNode(shortTitle(full, 62)));
  tile.title = full;
  body.append(title);

  const meta = el("div", "tm");
  meta.append(catIcon(it.category, 12));
  if (it.country && it.country !== "JP") meta.append(countryTag(it));
  meta.append(el("span", null, it.publisher || it.source));
  meta.append(el("span", null, ago(it.published)));
  if (it.flagship > 0) meta.append(el("span", "tag nat", "重要"));
  const dup = Math.max(it.dupCount || 1, it.cluster || 1);
  if (dup > 1) meta.append(el("span", "tag dup", `${dup}媒体`));
  for (const code of (it.prefectures || []).slice(0, 1)) {
    meta.append(el("span", "tag pref", PREF_BY_CODE[code] || ""));
  }

  const star = el("button", "tstar" + (it.bookmarked ? " on" : ""), it.bookmarked ? "★" : "☆");
  star.title = "保存";
  star.onclick = async (e) => {
    e.stopPropagation();
    it.bookmarked = !it.bookmarked;
    star.className = "tstar" + (it.bookmarked ? " on" : "");
    star.textContent = it.bookmarked ? "★" : "☆";
    await api("/api/bookmark", { id: it.id, on: it.bookmarked });
    renderSidebar();
  };
  meta.append(star);
  body.append(meta);
  tile.append(body);
  tile.onclick = () => window.open(it.url, "_blank", "noopener");
  return tile;
}

const TILES_PER_COL = 3;

// Measured from a live tile rather than hard-coded: a stale constant made the
// row deeper than the space actually left, which pushed the page over.
let TILE_H = 78;

/* How tall an entry in the news panes actually is.

   It used to measure any `.tile` on the page, and the panes' own tiles used to
   stretch to fill their column — so the measurement grew with the stretching
   and the count fell to match. Measuring the pane's own tile, now that it sits
   at its natural height, closes the loop. */
function measureTile() {
  const t = document.querySelector(".news-split .tile") || document.querySelector(".tile");
  if (t) {
    const h = t.getBoundingClientRect().height;
    if (h > 30) TILE_H = h;
  }
  return TILE_H;
}

function stripArrows(strip) {
  const arrows = el("div", "arrows");
  for (const [dir, glyph] of [[-1, "‹"], [1, "›"]]) {
    const b = el("button", null, glyph);
    b.setAttribute("aria-label", dir < 0 ? "前へ" : "次へ");
    b.onclick = () => { strip.scrollLeft += dir * strip.clientWidth * 0.85; };
    arrows.append(b);
  }
  return arrows;
}

function genreRow(label, key, group, allItems, opts = {}) {
  const row = el("section", "cat-row" + (opts.rotating ? " genre-slot" : ""));
  const head = el("div", "cat-head");
  // The icon carries the genre where the swatch used to: within a group the
  // colour is now shared, so the shape is what separates one row from the next.
  const headCat = opts.group ? (GROUPS.find((g) => g.key === key) || {}).cats?.[0] : key;
  head.append(catIcon(headCat || key, 16), el("h3", null, label),
              el("span", "cn", `${group.length}件`));

  if (opts.rotating) {
    // Chips double as a progress indicator and as a way to stop the rotation
    // on whichever genre the reader wants to stay on.
    const chips = el("div", "genre-chips");
    for (const k of S.genreKeys) {
      const g = GROUPS.find((x) => x.key === k);
      const dot = el("button", "gchip" + (k === key ? " on" : ""));
      dot.style.setProperty("--chip", `var(--cat-${k})`);
      dot.append(catIcon(g ? g.cats[0] : k, 17, "currentColor"));
      dot.title = g ? g.label : k;
      dot.onclick = () => {
        S.genrePinned = S.genrePinned === k ? null : k;
        S.genreIndex = S.genreKeys.indexOf(k);
        hooks.renderCards(allItems);
      };
      chips.append(dot);
    }
    head.append(chips);
    const pin = el("button", "more-cat", S.genrePinned ? "自動送りに戻す" : "自動送り中");
    pin.onclick = () => {
      S.genrePinned = S.genrePinned ? null : key;
      hooks.renderCards(allItems);
    };
    head.append(pin);
  } else {
    const only = el("button", "more-cat", "この分類だけ");
    only.onclick = () => {
      if (opts.group) Object.assign(S.filter, { group: key, cat: null });
      else Object.assign(S.filter, { cat: key, group: (groupOf(key) || {}).key || null });
      S.limit = 40; hooks.renderAll();
    };
    head.append(only);
  }

  const strip = el("div", "row-strip");
  head.append(stripArrows(strip));
  row.append(head);

  // Three compact tiles per column: the same strip width then carries roughly
  // nine headlines instead of three picture cards.
  const perCol = opts.tiles || TILES_PER_COL;
  const cap = S.groupLimits[key] || perCol * 8;
  const visible = opts.fixed ? group.slice(0, cap)
                             : dedupeStories(group.slice(0, cap * 3), cap);

  /* Fill the pane's width before filling its height.

     Columns were filled to the brim and then a new one started, so a short
     list — a genre with four stories, or any genre once a search narrows
     things — stacked into the first column and left the rest of the pane
     blank. When there is not enough to need every column, the items are spread
     across the ones the pane shows instead. */
  const fitCols = opts.cols || Infinity;
  const rows = Math.ceil(visible.length / perCol) < fitCols && visible.length
    ? Math.ceil(visible.length / Math.min(fitCols, visible.length))
    : perCol;
  for (let i = 0; i < visible.length; i += rows) {
    const col = el("div", "row-col");
    for (const it of visible.slice(i, i + rows)) col.append(tileNode(it));
    strip.append(col);
  }
  if (group.length > cap) {
    const more = el("button", "row-more", `さらに${Math.min(24, group.length - cap)}件`);
    more.onclick = () => {
      S.groupLimits[key] = cap + 24;
      hooks.renderCards(allItems);
    };
    strip.append(more);
  }
  row.append(strip);
  return row;
}

const YT_ID = /[?&]v=([\w-]{6,})/;

function videoId(url) {
  const m = YT_ID.exec(url || "");
  return m ? m[1] : null;
}

// Autoplay is only allowed muted, and chaining through `playlist=` lets YouTube
// advance by itself — no IFrame API, no polling for the end of a clip.
function playerSrc(ids, autoplay) {
  const [first, ...rest] = ids;
  const params = new URLSearchParams({
    autoplay: autoplay ? "1" : "0",
    mute: "1",
    rel: "0",
    modestbranding: "1",
    // Needed to ask the player which clip it actually moved on to.
    enablejsapi: "1",
    origin: location.origin,
  });
  if (rest.length) params.set("playlist", rest.join(","));
  return `https://www.youtube-nocookie.com/embed/${first}?${params}`;
}

function renderCards(items) {
  const box = $("#cards");
  box.innerHTML = "";
  const grouped = S.grouped && !S.filter.cat;

  if (grouped) {
    box.classList.add("as-rows");
    const byCat = new Map();
    for (const it of items) {
      if (!byCat.has(it.category)) byCat.set(it.category, []);
      byCat.get(it.category).push(it);
    }

    // One screen: a permanent headline row, a single genre slot that flips
    // through the rest on a timer, and the video strip. Stacking every genre
    // vertically pushed all but the first below the fold.
    const NEWSY = ["jp_news", "world_news", "defense", "regulation",
                   "security", "aam", "disaster"];
    // Just-arrived articles go to the front while the highlight is up. Sorted
    // purely by importance they almost never made the visible page, so the
    // board announced new items the reader could not find anywhere.
    const hot = document.body.classList.contains("has-fresh");
    const leadPool = [...items]
      .filter((it) => NEWSY.includes(it.category))
      .sort((a, b) =>
        (hot ? (S.freshItems.has(b.id) ? 1 : 0) - (S.freshItems.has(a.id) ? 1 : 0) : 0)
        || b.importance - a.importance || b.published - a.published)
      .slice(0, 120);
    const lead = dedupeStories(leadPool, 18);
    // Fill the viewport exactly: too few tiles leaves dead space under the
    // fold, too many push the row off it. Measure what is left and divide.
    const top = box.getBoundingClientRect().top;
    const room = window.innerHeight - (top > 0 ? top : 420) - 6;
    // The 9 was a guess at how many would fit; on a tall screen it stopped
    // short and left a strip of empty page under the last row.
    /* A column is now the whole pane, and a row in it is a Yahoo-sized entry
       — a 56px square and two lines of 16px — so about 85px each rather than
       the 45px the two-column tiles took. Fewer fit, which is the trade the
       width buys. */
    const perCol = Math.max(3, Math.min(9, Math.floor((room - 16) / measureTile())));

    // Side by side rather than stacked: two rows of headlines cost twice the
    // height, and the second one fell off the screen.
    const split = el("div", "news-split");
    if (lead.length) {
      split.append(genreRow("主要ニュース", "jp_news", lead, items,
                            { fixed: true, tiles: perCol, cols: 1 }));
    }

    const vids = S.items.filter((i) => i.category === "video")
      .sort((a, b) => b.published - a.published);
    if (vids.length) byCat.set("video", vids);

    /* The carousel turns over the seven groups, not the seventeen categories.

       Fifteen chips in a pane head come out at twenty pixels each, which is
       too small to aim at and too many to hold in your head — and it is a
       second taxonomy besides, since the sidebar had already settled on the
       seven. One chip per group, big enough to hit. */
    const byGroup = new Map();
    for (const [cat, list] of byCat) {
      const g = groupOf(cat);
      if (!g) continue;
      if (!byGroup.has(g.key)) byGroup.set(g.key, []);
      byGroup.get(g.key).push(...list);
    }
    for (const [k, list] of byGroup) {
      list.sort((a, b) => b.published - a.published);
      byGroup.set(k, list);
    }
    S.genreKeys = GROUPS.map((g) => g.key).filter((k) => (byGroup.get(k) || []).length);
    S.genrePool = byGroup;
    if (S.genreKeys.length) {
      const key = S.genrePinned && byGroup.get(S.genrePinned)
        ? S.genrePinned
        : S.genreKeys[S.genreIndex % S.genreKeys.length];
      const g = GROUPS.find((x) => x.key === key);
      split.append(genreRow(g ? g.label : key, key, byGroup.get(key) || [], items,
                            { rotating: true, tiles: perCol, cols: 1, group: true }));
    }
    if (split.children.length) box.append(split);

    $("#more").classList.add("hidden");
    $("#empty").classList.toggle("hidden", items.length > 0);
  } else {
    box.classList.remove("as-rows");
    const slice = items.slice(0, S.limit);
    for (const it of slice) box.append(cardNode(it));
    $("#empty").classList.toggle("hidden", items.length > 0);
    $("#more").classList.toggle("hidden", items.length <= S.limit);
  }

  const f = S.filter;
  const bits = [];
  if (f.bucket === "saved") bits.push("保存済み");
  if (f.cat) bits.push((S.categories.find(([k]) => k === f.cat) || [])[1]);
  // The group on its own is a filter too, and without this the heading said
  // "すべて" over a filtered list.
  else if (f.group) bits.push((GROUPS.find((g) => g.key === f.group) || {}).label);
  if (f.pref) bits.push(PREF_BY_CODE[f.pref]);
  if (f.country) bits.push(`${flagOf(f.country)} ${COUNTRY_JA[f.country] || f.country}`.trim());
  if (f.scope === "national") bits.push("全国・国交省系");
  if (f.day) {
    const d = new Date(f.day * 1000);
    bits.push(`${d.getMonth() + 1}月${d.getDate()}日`);
  }
  const label = bits.length ? bits.join(" / ") : "すべて";
  $("#feed-title").textContent = label;
  $("#feed-count").textContent = `${items.length}件`;
  /* The heading that used to say what was filtered is gone — it cost a row of
     the reading area to repeat what the sidebar already highlights. The button
     that clears the filter says it instead, which is where you would go to
     undo it anyway. */
  const clear = $("#clear-filters");
  const on = bits.length || f.q;
  clear.classList.toggle("hidden", !on);
  if (on) {
    clear.textContent = `${f.q ? `「${f.q}」` : label} ${items.length}件 ✕`;
    clear.title = "絞り込みを解除";
  }
}

// New articles used to announce themselves with a bar above the feed, which
// pushed the whole layout down a row every time collection finished. The
// refresh button says how long ago the last update was, so it is the natural
// place to say "there is something new" — a slow glow rather than a flash.
function announceNew() {
  const btn = $("#refresh");
  const n = S.freshItems.size;
  if (!btn) return;
  clearTimeout(announceNew.timer);
  btn.classList.remove("fresh");
  document.body.classList.remove("has-fresh");
  if (!n) { btn.title = "いま収集する"; return; }
  btn.title = `新着 ${n}件 · いま収集する`;
  // Restart the animation from the top even if it was already glowing.
  void btn.offsetWidth;
  btn.classList.add("fresh");
  // The articles themselves pulse in time with the button, otherwise the
  // button announces new items without saying which ones they are.
  document.body.classList.add("has-fresh");
  sonarPing();
  // Rebuild the grid now that has-fresh is set: that is what pulls the new
  // articles to the front of the headline pane, and the pane may be parked on
  // a later page from the auto-advance.
  if (S.filter.view === "feed") hooks.renderCards(visibleItems(false));
  const strip = document.querySelector(".news-split > .cat-row:not(.genre-slot) .row-strip");
  if (strip) strip.scrollTo({ left: 0, behavior: "smooth" });
  announceNew.timer = setTimeout(() => {
    btn.classList.remove("fresh");
    document.body.classList.remove("has-fresh");
    // Put the pane back on importance order now the moment has passed.
    if (S.filter.view === "feed") hooks.renderCards(visibleItems(false));
  }, 24000);
}

/* ------------------------------------------------------------- spotlight */

export { GROUP_STEP, TILES_PER_COL, TILE_H, YT_ID, announceNew, cardNode, genreRow, measureTile, placeholder, playerSrc, renderCards, stripArrows, thumbNode, tileNode, videoId };
