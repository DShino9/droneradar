import { catIcon, flagOf, groupOf } from "./genre.js";
import { BOX, drawGlobe, drawMarks, faceCountry, G, mk, mountGlobe,
         project, releaseGlobe, setMarks, spinGlobe, toVector } from "./globe.js";
import { $, S, catColor, el, hooks } from "./state.js";
import { ago, catLabel, dedupeStories, proxied, regionFill, shortTitle } from "./util.js";

// Dwell per story. The timer alternates maps, so each map holds a story for
// twice this — long enough to actually read the caption.
/* How old a story may be and still be worth pinging a region for. Two days,
   because the collector runs all day and a region with nothing in two days has
   nothing to say today. */
const SPOT_FRESH = 2 * 86400;
const SPOT_STALE = 14 * 86400;

const SPOTLIGHT_MS = 7000;

// Both maps are the same choropleth over a different set of shapes, so one
// renderer draws both; the spec supplies the geometry, the tally field, and
// which filter a click sets.
// Big enough to tell a shield from a newspaper. It is on screen for a couple
// of seconds over one region, so it can afford to be larger than a permanent
// marker could.
const PING_ICON_PX = 26;

const MAP_SPECS = {
  jp: {
    svg: "#map-jp", hint: "#map-hint-jp",
    data: () => S.map, list: (d) => d.prefectures, id: (p) => p.code,
    label: (p) => p.name, field: "prefectures", filter: "pref",
    unit: "地域", bubbles: 8, bubBase: 9, bubGain: 15,
  },
  world: {
    svg: "#map-world", hint: "#map-hint-world",
    data: () => S.world, list: (d) => d.countries, id: (c) => c.iso,
    // The flag before the name: on the world map the name is the only thing
    // telling one bubble from another, and a flag is quicker to read.
    label: (c) => `${flagOf(c.iso)} ${c.ja || c.en}`.trim(),
    field: "countries", filter: "country",
    unit: "国", bubbles: 6, bubBase: 6, bubGain: 11,
  },
};

function renderMap(items, scope) {
  const spec = MAP_SPECS[scope];
  const svg = $(spec.svg);
  const data = spec.data();
  if (!data) return;

  // Tally per region and, within each, per category — the latter decides the
  // hue so the map reads as "what kind of news comes from here".
  // Count each story once, against the place it is mainly about. Tallying every
  // country it mentions inflated the world map — an article on Japanese rules
  // that name-checks the US and China counted three times.
  const counts = {};
  const cats = {};
  for (const it of items) {
    const c = (it[spec.field] || [])[0];
    if (c == null) continue;
    counts[c] = (counts[c] || 0) + 1;
    (cats[c] = cats[c] || {})[it.category] = (cats[c]?.[it.category] || 0) + 1;
  }
  const max = Math.max(1, ...Object.values(counts));
  const selected = S.filter[spec.filter];

  const ns = "http://www.w3.org/2000/svg";
  if (S.zoomTimers[scope]) {
    cancelAnimationFrame(S.zoomTimers[scope].raf);
    clearTimeout(S.zoomTimers[scope].hold);
    S.zoomTimers[scope] = null;
  }

  /* The world is a globe; Japan is a map.

     The flat world is 900x366 in a panel that is nearly square, so whichever
     way it is fitted something is wasted. A sphere is square. Half of it is
     behind at any moment, and that is paid back where it counts: the
     spotlight turns the globe to bring its country to the front before the
     ping lands. */
  if (scope === "world") {
    renderGlobeWorld(svg, data, counts, cats, max, selected, spec);
    return;
  }

  svg.setAttribute("viewBox", `0 0 ${data.width} ${data.height}`);
  svg.innerHTML = "";

  if (data.inset) {
    const ins = data.inset;
    const box = document.createElementNS(ns, "rect");
    box.setAttribute("class", "inset-box");
    box.setAttribute("x", ins.x); box.setAttribute("y", ins.y);
    box.setAttribute("width", ins.w); box.setAttribute("height", ins.h);
    box.setAttribute("rx", 6);
    svg.append(box);
    const lab = document.createElementNS(ns, "text");
    lab.setAttribute("class", "inset-label");
    lab.setAttribute("x", ins.x + 6); lab.setAttribute("y", ins.y + 16);
    lab.textContent = ins.label;
    svg.append(lab);
  }

  // Which regions this collection brought something to.
  const fresh = new Map();
  for (const it of S.items) {
    if (!S.freshItems.has(it.id)) continue;
    const ids = it[spec.field] || [];
    // Keyed by region, valued by the genre that arrived there, so the pulse
    // matches the colour the same story is wearing in the sidebar and grid.
    if (ids.length && !fresh.has(String(ids[0]))) {
      fresh.set(String(ids[0]), catColor(it.category));
    }
  }

  const shapes = spec.list(data);
  for (const p of shapes) {
    const key = spec.id(p);
    const n = counts[key] || 0;
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", p.d);
    /* The map had no way of saying "something arrived here".

       Everything else did — the refresh button, the sidebar's genre rows, the
       article tiles, the radar's contacts — so a collection that landed in a
       region lit four things and left the map alone, which read as the map
       having missed it. */
    const isFresh = fresh.has(key);
    path.setAttribute("class", "pref" + (selected === key ? " sel" : "")
                              + (isFresh ? " fresh" : ""));
    if (isFresh) path.style.setProperty("--fresh", fresh.get(key));
    const fill = regionFill(cats[key] || {}, n, max);
    if (fill) path.style.fill = fill;
    const title = document.createElementNS(ns, "title");
    const breakdown = Object.entries(cats[key] || {})
      .sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, v]) => `${catLabel(k)} ${v}`).join("　");
    title.textContent = `${spec.label(p)} ${n}件` + (breakdown ? `\n${breakdown}` : "");
    path.append(title);
    path.onclick = () => {
      S.filter[spec.filter] = selected === key ? null : key;
      S.filter.view = "feed"; S.limit = 40; hooks.renderAll();
    };
    svg.append(path);
  }

  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, spec.bubbles);
  const byId = new Map(shapes.map((p) => [String(spec.id(p)), p]));
  for (const [key, n] of ranked) {
    const p = byId.get(String(key));
    if (!p) continue;
    const r = spec.bubBase + spec.bubGain * Math.sqrt(n / max);
    const c = document.createElementNS(ns, "circle");
    c.setAttribute("class", "bub");
    c.setAttribute("cx", p.cx); c.setAttribute("cy", p.cy); c.setAttribute("r", r.toFixed(1));
    svg.append(c);
    const t = document.createElementNS(ns, "text");
    t.setAttribute("class", "bub-n");
    t.setAttribute("x", p.cx); t.setAttribute("y", p.cy + (scope === "world" ? 3 : 4));
    t.textContent = n;
    svg.append(t);

  }

  S.mapData = S.mapData || {};
  // The base viewBox width travels with the data: the ping needs it to size
  // its icon, and by then the box itself may be part-way through the zoom.
  S.mapData[scope] = { counts, cats, byId, spec, width: data.width, height: data.height };

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const selectedShape = selected != null ? byId.get(String(selected)) : null;
  $(spec.hint).textContent = selectedShape
    ? `${spec.label(selectedShape)} で絞り込み中`
    : `${spec.unit}が特定できた ${total}件`;
}

// Step through individual stories — not per-region totals — lighting the place
// each one is about and captioning it under the map. One article at a time is
// what makes the map feel live; a regional tally just repeats the choropleth.
function spotlight(scope) {
  const info = (S.mapData || {})[scope];
  const svg = $(scope === "jp" ? "#map-jp" : "#map-world");
  const caption = $(scope === "jp" ? "#map-caption-jp" : "#map-caption-world");
  if (!info || !svg || !caption) return;

  const field = info.spec.field;

  /* Take a turn round the regions, not a walk down a list.

     The old order was "newest first, skip anything shown in the last four
     turns". Over a pool where Russia and Ukraine are 54% of everything filed
     in a day, four turns is not a gap — Russia came back every fifth spot with
     a different headline about the same war, which is exactly what "the same
     news over and over" looks like from the outside. Lengthening the history
     would not have helped either: past a point it runs out of regions and
     resets, and the resets land back on the same few.

     So the rotation is over regions. Every region with something to say gets
     one turn before any of them gets a second, and a region's own stories are
     spent newest-first across its turns. Ukraine is still on the map as often
     as it is in the news; it is no longer on it four times an hour. */
  /* And only what is current.

     Articles are kept for forty-five days, and the spotlight was drawing from
     all of them — so a region whose last drone story was a week ago went on
     showing that story every time its turn came round, and yesterday's news
     turned up again today. The dial is meant to say what is happening, not
     what this place has ever been in the news for. A region with nothing
     recent simply does not get a turn.

     The window widens if that leaves too little to rotate through; a quiet day
     should show older news rather than the same three regions. */
  const nowSec = Date.now() / 1000;
  const build = (maxAge) => {
    const m = new Map();
    for (const it of S.items) {
      const ids = it[field] || [];
      if (!ids.length || !info.byId.has(String(ids[0]))) continue;
      if (nowSec - it.published > maxAge) continue;
      // A repository is not a dispatch from anywhere. It carries a country
      // because its author does, and spotlighting it says nothing about a place.
      if (/^[\w.-]+\/[\w.-]+/.test(it.title || "")) continue;
      /* Japan is not a country on the world map.

         It was the second largest — 435 stories to Russia's 438 — with a whole
         map of Japan standing next to it, so its turn on the world map was
         showing what the map beside it already showed. The stories that name
         no prefecture used to be the argument for keeping it: the defence
         budget, a nationwide distribution deal, the rules. Those have a home
         now (see below), so Japan does not need a place here at all. */
      if (scope === "world" && ids[0] === "JP") continue;
      const k = String(ids[0]);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(it);
    }

    /* Japanese news that belongs to no prefecture belongs to all of them.

       The defence budget is not Tokyo news because the ministry is in Tokyo;
       a nationwide rollout is not Osaka news because the company is there.
       These have no point on the map — so they get the whole of it. Their turn
       lights every prefecture at once and pings from the middle, which says
       "this one is national" without a word of explanation. */
    if (scope === "jp") {
      const nation = [];
      for (const it of S.items) {
        if ((it.prefectures || []).length) continue;
        if (!(it.countries || []).length || it.countries[0] !== "JP") continue;
        if (nowSec - it.published > maxAge) continue;
        if (/^[\w.-]+\/[\w.-]+/.test(it.title || "")) continue;
        nation.push(it);
      }
      if (nation.length) m.set(NATION, nation);
    }
    return m;
  };
  let byRegion = build(SPOT_FRESH);
  if (byRegion.size < 4) byRegion = build(SPOT_FRESH * 3.5);
  if (byRegion.size < 2) byRegion = build(SPOT_STALE);
  if (!byRegion.size) return;

  // Within a region: newest first, and eight outlets on one strike folded to
  // one entry so a busy region does not spend its turns repeating itself.
  for (const [k, list] of byRegion) {
    list.sort((x, y) => y.published - x.published);
    byRegion.set(k, dedupeStories(list.slice(0, 40), 12));
  }

  // Regions in order of how recently they had news, so the rotation opens on
  // what is live rather than on whichever region sorts first.
  let regions = [...byRegion.keys()]
    .sort((x, y) => byRegion.get(y)[0].published - byRegion.get(x)[0].published);

  /* "全国" is not one region among twenty-one.

     The round robin gives every region one turn, which is right when they are
     all places of the same kind. But the national bucket is not a place — it
     is everything that is not one, and it holds 29% of the Japanese news to
     the prefectures' 71%. One turn in twenty-two is 4%, so a category holding
     nearly a third of the stories came round about once every four minutes,
     and the whole-country ping looked like something that had been switched
     off.

     So it takes a turn at intervals matched to its share: with 29% of the
     stories it lands every third region, not every twenty-second. The cap
     keeps it from becoming the thing the map mostly does. */
  if (byRegion.has(NATION) && regions.length > 2) {
    const total = [...byRegion.values()].reduce((a, l) => a + l.length, 0);
    const share = byRegion.get(NATION).length / Math.max(1, total);
    const every = Math.max(3, Math.round(1 / Math.max(0.06, share)));
    const others = regions.filter((r) => r !== NATION);
    const woven = [];
    others.forEach((r, k) => {
      woven.push(r);
      if ((k + 1) % every === 0) woven.push(NATION);
    });
    if (!woven.includes(NATION)) woven.push(NATION);
    regions = woven;
  }

  const seenStories = (S.spotStories[scope] = S.spotStories[scope] || []);
  let i = S.spotIndex[scope] || 0;
  let story = null;
  for (let step = 0; step < regions.length; step++) {
    i = (i + 1) % regions.length;
    const list = byRegion.get(regions[i]) || [];
    // This region's newest story that has not had its turn yet.
    const next = list.find((c) => !seenStories.includes(c.id));
    if (next) { story = next; break; }
  }
  if (!story) {
    // Every region has shown everything it has; start the round again.
    seenStories.length = 0;
    i = (i + 1) % regions.length;
    story = (byRegion.get(regions[i]) || [])[0];
  }
  if (!story) return;
  S.spotIndex[scope] = i;
  seenStories.push(story.id);
  // Deep enough to get all the way round a rotation of regions without a
  // story coming back, and no deeper — the news moves on.
  if (seenStories.length > 120) seenStories.shift();

  const nationwide = regions[i] === NATION;
  const shape = nationwide ? null : info.byId.get(String(story[field][0]));
  if (!nationwide && !shape) return;

  /* On the globe, turn to face the country first.

     This is what buys back the half of the world that is behind the sphere:
     the place being pinged is never one of the hidden ones, because the globe
     hurries round to put it in front before the ping lands. The ping itself
     waits for the turn. */
  if (scope === "world") {
    faceCountry(String(story[field][0]));
    // Wait for the turn to arrive rather than guessing how long it takes. It
    // fired on a fixed 620ms timer and tested whether the country was facing
    // us; when the turn was still short of that the test failed and there was
    // simply no ping.
    whenFacing(svg, String(story[field][0]),
               () => globePing(svg, String(story[field][0]), story));
    paintCaption(caption, story, `${flagOf(shape.iso)} ${shape.ja || shape.en}`.trim());
    return;
  }

  svg.querySelectorAll("path.pref.lit, path.pref.lit-all")
     .forEach((n) => n.classList.remove("lit", "lit-all"));
  svg.querySelectorAll(".ping-ring, .ping-core").forEach((n) => n.remove());
  const label = nationwide ? "全国" : info.spec.label(shape);
  let path = null;
  if (nationwide) {
    // Every prefecture at once, and a little apart in time so it reads as a
    // wave across the country rather than a single flat flash.
    const all = [...svg.querySelectorAll("path.pref")];
    void svg.getBoundingClientRect();
    all.forEach((n, k) => {
      n.classList.add("lit-all");
      n.style.animationDelay = `${((k % 12) * 0.045).toFixed(3)}s`;
      // Cleared as soon as the flash is over, not when the story leaves: the
      // map has to go back to showing which prefectures are busy, which is
      // what it is for the other six seconds.
      setTimeout(() => { n.classList.remove("lit-all"); n.style.animationDelay = ""; }, 1700);
    });
    /* The camera pulls back rather than in.

       A prefecture story pushes in on its region; this one does the opposite
       and steps away from the whole country, which is the same gesture read
       the other way round — the subject is bigger than any part of the map,
       so the map gets smaller. */
    zoomOutWhole(svg, scope);
  } else {
    path = [...svg.querySelectorAll("path.pref")].find((n) => {
      const t = n.querySelector("title");
      return t && t.textContent.startsWith(label);
    });
    if (path) {
      // Re-adding the class on the same element would not restart the
      // keyframes; forcing a reflow between removal and re-add does.
      void path.getBoundingClientRect();
      path.classList.add("lit");
    }
  }

  // Expanding rings over the spot. A stroke glow alone is invisible on a small
  // prefecture, which is why the highlight kept going unnoticed — the ping is
  // what actually marks the place.
  const ns = "http://www.w3.org/2000/svg";
  /* A national ping goes out from Shiga.

     There is no honest point for "everywhere", and the geometric middle of the
     map's box is worse than arbitrary — it lands in the sea off Noto, so a
     story about the defence budget sent circles out of the Sea of Japan. But
     no rings at all was worse still: the whole-country flash on its own did
     not read as a ping. Shiga is the middle of Honshu, it is land, and the
     rings sweep the country from it. */
  const NATION_CENTRE = { cx: 331.1, cy: 571.6 };          // 滋賀県
  const px = nationwide ? NATION_CENTRE.cx : shape.cx;
  const py = nationwide ? NATION_CENTRE.cy : shape.cy;
  /* Far enough to reach Hokkaido.

     Measured, not guessed: the farthest point of any prefecture from Shiga is
     the northern tip of Hokkaido at 650 units — 0.855 of the map's width. The
     ring was 0.72, which stopped in the sea off Aomori and left the north out
     of a ping that is supposed to mean the whole country. A little over, so
     the wave passes the coast rather than dying on it. */
  const reach = nationwide ? info.width * 0.92 : (scope === "world" ? 78 : 130);
  for (const delay of ["", "d2", "d3"]) {
    const ring = document.createElementNS(ns, "circle");
    ring.setAttribute("class", ("ping-ring " + delay).trim());
    ring.setAttribute("cx", px);
    ring.setAttribute("cy", py);
    ring.setAttribute("r", reach);
    svg.append(ring);
    setTimeout(() => ring.remove(), SPOTLIGHT_MS);
  }
  if (!nationwide) {
    const core = document.createElementNS(ns, "circle");
    core.setAttribute("class", "ping-core");
    core.setAttribute("cx", px);
    core.setAttribute("cy", py);
    core.setAttribute("r", scope === "world" ? 5 : 8);
    svg.append(core);
    setTimeout(() => core.remove(), SPOTLIGHT_MS);
  }

  /* The genre of the story being pinged, riding on the ping.

     It used to sit on every bubble permanently, which was wrong twice over: a
     region with eight stories across four genres got one icon, so the icon
     claimed a region was about something it was mostly not; and eight of them
     standing on the map at all times is clutter in exchange for a claim that
     weak. Here there is exactly one story, the icon is exactly its genre, and
     it leaves with the ping. */
  /* No genre icon on the map when the story is national.

     It was placed at the middle of the map's box, which on the Japan map is
     the Noto peninsula — so a story about the defence budget put a shield over
     Ishikawa. A marker on a point says "here", and the whole reason this story
     is on the whole map is that there is no here. The caption's own icon still
     says which genre it is. */
  const g = nationwide ? null : groupOf(story.category);
  if (g) {
    // Sized in screen pixels and converted: the two maps have very different
    // viewBoxes and the rail's width moves with the window, so a size in SVG
    // units comes out at whatever the scale of the moment makes it — five
    // pixels, on the Japan map.
    const onScreen = svg.getBoundingClientRect().width;
    const perPx = onScreen > 0 && info.width ? onScreen / info.width : 1;
    const size = PING_ICON_PX / perPx;
    const mark = document.createElementNS(ns, "svg");
    mark.setAttribute("class", "ping-icon");
    mark.setAttribute("viewBox", "0 0 24 24");
    mark.setAttribute("width", size.toFixed(1));
    mark.setAttribute("height", size.toFixed(1));
    // px/py, not shape — a national story has no shape, and reading cx off
    // null threw here, which left the caption showing the previous region while
    // the whole map flashed behind it.
    mark.setAttribute("x", (px - size / 2).toFixed(1));
    mark.setAttribute("y", (py - size * 1.35).toFixed(1));
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", g.icon);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", `var(--cat-${g.key})`);
    path.setAttribute("stroke-width", "2.2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    mark.append(path);
    svg.append(mark);
    setTimeout(() => mark.remove(), SPOTLIGHT_MS);
  }

  // After the ping lands, ease the viewBox in on the region, hold, then ease
  // back out in time for the next story.
  if (path) zoomToRegion(svg, scope, path, shape);


  paintCaption(caption, story, label);
}

// Both captions take the same top — the lower of the two maps — so the panels
// stay symmetrical instead of one box being visibly deeper than the other.
/* Where the caption sits: under the drawn map, unless there is no under.

   It was placed at the map's own drawn height, on the assumption that the
   panel is always taller than the map wants to be. Once the graphics band was
   capped that stopped being true — the map filled the wrap, the caption was
   positioned past the bottom of it, and since it is stretched between `top`
   and `bottom: 8px` its height came out negative and the story vanished.

   So the top is clamped: the caption always keeps a band at the foot of the
   panel, and it is the map that gives way. */
// Padding, a source line, and two lines of headline. Below this the clamp
// falls to one line, which for a Japanese headline is barely a clause.
const CAPTION_MIN = 96;
/* And an upper bound. The world map is wide and short, so on a narrow column
   it draws well above the foot of the panel — and the caption, sized to
   whatever is left, grew to half the panel and buried the map it belongs to.
   Three lines is as much as a caption needs to be. */
const CAPTION_MAX = 124;

// The stand-in region for "everywhere in Japan". Not a prefecture code, so it
// can never collide with one.
const NATION = "__nation";

function alignCaptions() {
  /* The map stops where the caption starts.

     The caption is an overlay pinned to the foot of the panel, which was fine
     for the world map: it is wide and short, so it draws against the top of
     its box and the caption lands on the empty sea underneath. Japan is the
     other shape — tall — so it filled its box and the caption covered the
     bottom third of it. Kyushu and Shikoku were never once on screen.

     So the map is given a ceiling: the panel's height less the caption's band.
     Japan comes out smaller and entirely visible, which is the trade — a map
     with the south missing is not a map of Japan. The ceiling comes from the
     panel, not from the map's own drawn height, so it cannot chase itself
     smaller on every pass. */
  for (const id of ["#map-jp", "#map-world"]) {
    const svg = $(id);
    const wrap = svg && svg.parentElement;
    const room = wrap ? wrap.clientHeight : 0;
    if (!svg || !room) continue;
    // The wrap has padding above the map, and the caption's `top` is measured
    // from the wrap's edge rather than from the map's — so the padding has to
    // come out of the map's allowance or the two overlap by exactly that much.
    const above = svg.getBoundingClientRect().top - wrap.getBoundingClientRect().top;
    svg.style.maxHeight =
      `${Math.max(80, room - CAPTION_MIN - 10 - Math.max(0, above))}px`;
  }

  /* Each caption sits under its own map, and fills what is left.

     `want` used to be the taller of the two maps, so both captions lined up.
     That was fine when both maps filled their boxes; now that the maps are
     capped it left the world map — wide and short — with a band of empty
     panel between it and its caption, because it was waiting for Japan.

     So each takes its own map's height, and then runs to the foot of the
     panel. The two captions no longer start at the same line; they both end at
     the same one, which is the edge you actually see. */
  const drawn = {
    "#map-caption-jp": mapDrawnHeight($("#map-jp"), "jp"),
    "#map-caption-world": mapDrawnHeight($("#map-world"), "world"),
  };
  for (const id of ["#map-caption-jp", "#map-caption-world"]) {
    const c = $(id);
    if (!c) continue;
    const room = (c.parentElement || {}).clientHeight || 0;
    const want = Math.round((drawn[id] || 0) + 10);
    if (!want || want < 50) continue;
    // Never so low that the caption has no room, never so high that it covers
    // the map it belongs to.
    let top = room ? Math.min(want, Math.max(40, room - CAPTION_MIN - 8)) : want;
    c.style.top = `${top}px`;
    fitCaption(c, room ? room - top - 8 : 0);
  }
}

/* How many lines of headline the caption can hold.

   It was fixed at three. The box is about 84px, of which the padding takes 22
   and the source line another 22 — leaving room for not quite two lines of
   16px type. The third had nowhere to go, so it overflowed and the box cut
   through the middle of a line of text, which reads as a rendering fault
   rather than as an abbreviation.

   Counting the lines that fit means the clamp puts an ellipsis where the text
   runs out, and the box never cuts anything in half. */
function fitCaption(cap, height) {
  const title = cap.querySelector(".mc-title");
  if (!title || !height) return;
  const cs = getComputedStyle(title);
  const line = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) * 1.45) || 22;
  const capCS = getComputedStyle(cap);
  const padY = (parseFloat(capCS.paddingTop) || 0) + (parseFloat(capCS.paddingBottom) || 0);
  const meta = cap.querySelector(".mc-line");
  // Its own height plus the gap under it, and read from the layout rather than
  // assumed — the flag pushes this row taller than a line of its text.
  const metaCS = meta ? getComputedStyle(meta) : null;
  const metaH = meta
    ? meta.getBoundingClientRect().height + (parseFloat(metaCS.marginBottom) || 0)
    : 0;
  const room = height - padY - metaH;
  const lines = Math.max(1, Math.floor((room + 1) / line));
  title.style.webkitLineClamp = String(lines);
  // The blurb only earns its place once the headline has said its piece.
  const sub = cap.querySelector(".mc-sub");
  if (sub) sub.style.display = room - lines * line >= line * 1.5 ? "" : "none";
}

/* Step back from the whole map, hold, and come home.

   The mirror of zoomToRegion: that one closes in on a region, this one widens
   past the map's own edges so the country visibly recedes. Same timing, so the
   two read as the same gesture in opposite directions.

   It also cancels whatever the previous region had in flight — the national
   turn does not call zoomToRegion, so nothing else was going to, and the map
   could still have been closing in on Osaka while every prefecture flashed. */
const ZOOM_OUT = 1.22;

function zoomOutWhole(svg, scope) {
  const base = scope === "jp" ? S.map : S.world;
  if (S.zoomTimers[scope]) {
    cancelAnimationFrame(S.zoomTimers[scope].raf);
    clearTimeout(S.zoomTimers[scope].hold);
  }
  S.zoomTimers[scope] = { raf: 0, hold: 0 };
  if (!base) return;

  const full = [0, 0, base.width, base.height];
  const w = base.width * ZOOM_OUT, h = base.height * ZOOM_OUT;
  // Negative origins are fine — they simply show sea around the islands.
  const target = [-(w - base.width) / 2, -(h - base.height) / 2, w, h];

  const ease = (t) => (t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const run = (from, to, ms, done) => {
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      const e = ease(k);
      svg.setAttribute("viewBox",
        from.map((v, i) => (v + (to[i] - v) * e).toFixed(1)).join(" "));
      if (k < 1) S.zoomTimers[scope].raf = requestAnimationFrame(step);
      else if (done) done();
    };
    step();
  };

  // Whatever it is showing now, start from there — a turn can land while the
  // previous region's move is still running.
  const cur = (svg.getAttribute("viewBox") || "").split(/\s+/).map(Number);
  const from = (cur.length === 4 && cur[2]) ? cur : full;
  // Let the flash read first, same as the ping does before a zoom in.
  S.zoomTimers[scope].hold = setTimeout(() => {
    run(from, target, 900, () => {
      S.zoomTimers[scope].hold = setTimeout(() => run(target, full, 800), 3200);
    });
  }, 900);
}

// Animate the viewBox from the full map to a box around the region and back.
// SVG viewBox is not a CSS property, so this is a manual eased tween.
function zoomToRegion(svg, scope, path, shape) {
  const base = scope === "jp" ? S.map : S.world;
  if (!base || !path.getBBox) return;
  if (S.zoomTimers[scope]) {
    cancelAnimationFrame(S.zoomTimers[scope].raf);
    clearTimeout(S.zoomTimers[scope].hold);
  }

  let box;
  try {
    box = path.getBBox();
  } catch (e) {
    return;
  }
  if (!box || !box.width) return;

  const full = [0, 0, base.width, base.height];
  const aspect = base.width / base.height;

  /* How wide a frame has to be to hold the region, with margin.

     This used to take the larger of the region's two dimensions, pad it, and
     then multiply by the map's aspect ratio — which counts the width twice for
     anything wider than it is tall. On a world map at 2.46:1 that is most
     countries. Russia came out with a frame 1751 units wide on a 900-unit map,
     so the "zoom" pulled back to half size; the United States got 1.17x, which
     is not a zoom at all.

     The frame is the smallest box of the map's aspect that covers the region:
     width from the region's width, or from its height converted through the
     aspect, whichever is larger. */
  const MARGIN = 1.6, MIN_ZOOM = 1.55, MAX_ZOOM = 3.5;
  let w = Math.max(box.width * MARGIN, box.height * MARGIN * aspect);
  // Never wider than the map — that is a zoom-out — and never so tight that a
  // small country fills the frame with its own coastline.
  w = Math.min(w, base.width / MIN_ZOOM);
  w = Math.max(w, base.width / MAX_ZOOM);
  let h = w / aspect;

  /* Centre on the shape's own anchor, not the middle of its bounding box.

     A country's bounding box takes in everything it owns: Alaska and Hawaii
     for the United States, Guiana and Réunion for France, the far side of the
     dateline for Russia. The box's centre can land in an ocean none of them is
     near. The anchor is the point the map already uses to place that country's
     bubble, which is where someone looking for it would look. */
  const cxr = (shape && Number.isFinite(shape.cx)) ? shape.cx : box.x + box.width / 2;
  const cyr = (shape && Number.isFinite(shape.cy)) ? shape.cy : box.y + box.height / 2;
  const target = [
    Math.max(0, Math.min(base.width - w, cxr - w / 2)),
    Math.max(0, Math.min(base.height - h, cyr - h / 2)),
    w, h,
  ];

  const ease = (t) => (t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const run = (from, to, ms, done) => {
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      const e = ease(k);
      const vb = from.map((v, i) => v + (to[i] - v) * e);
      svg.setAttribute("viewBox", vb.map((v) => v.toFixed(1)).join(" "));
      if (k < 1) S.zoomTimers[scope].raf = requestAnimationFrame(step);
      else if (done) done();
    };
    step();
  };

  S.zoomTimers[scope] = { raf: 0, hold: 0 };
  // Let the ping read first, then move.
  S.zoomTimers[scope].hold = setTimeout(() => {
    run(full, target, 1000, () => {
      S.zoomTimers[scope].hold = setTimeout(() => run(target, full, 800), 3400);
    });
  }, 1000);
}

/* Draw the world as a globe: mount once, then tint and label per render.

   The outlines are rewritten by the spin loop rather than here — this only
   sets what changes when the articles change: the fill of each country, its
   tooltip, and which bubbles ride on the surface. */
function renderGlobeWorld(svg, data, counts, cats, max, selected, spec) {
  if (!G.paths.size || !svg.querySelector(".globe-sea")) {
    mountGlobe(svg, data, (iso) => {
      S.filter.country = S.filter.country === iso ? null : iso;
      S.filter.view = "feed"; S.limit = 40; hooks.renderAll();
    });
    spinGlobe(svg);
  }

  // Which regions this collection brought something to, as on the flat map.
  const fresh = new Map();
  for (const it of S.items) {
    if (!S.freshItems.has(it.id)) continue;
    const ids = it.countries || [];
    if (ids.length && !fresh.has(String(ids[0]))) {
      fresh.set(String(ids[0]), catColor(it.category));
    }
  }

  const byIso = new Map();
  for (const c of data.countries || []) byIso.set(c.iso, c);

  for (const [iso, path] of G.paths) {
    const n = counts[iso] || 0;
    const c = byIso.get(iso);
    const isFresh = fresh.has(iso);
    path.setAttribute("class", "pref" + (selected === iso ? " sel" : "")
                               + (isFresh ? " fresh" : ""));
    if (isFresh) path.style.setProperty("--fresh", fresh.get(iso));
    const fill = regionFill(cats[iso] || {}, n, max);
    path.style.fill = fill || "";
    const t = path.querySelector("title");
    if (t) {
      const breakdown = Object.entries(cats[iso] || {})
        .sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([k, v]) => `${catLabel(k)} ${v}`).join("　");
      const label = c ? `${flagOf(iso)} ${c.ja || c.en}`.trim() : iso;
      t.textContent = `${label} ${n}件` + (breakdown ? `\n${breakdown}` : "");
    }
  }

  // The busiest few, carried on the surface.
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, spec.bubbles);
  setMarks(ranked.map(([iso, n]) => {
    const c = byIso.get(iso);
    if (!c) return null;
    return {
      v: toVector(c.cx, c.cy), n,
      r: +(spec.bubBase + spec.bubGain * Math.sqrt(n / max)).toFixed(1),
    };
  }).filter(Boolean));

  drawGlobe(svg);
  drawMarks(svg);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const sel = selected != null ? byIso.get(String(selected)) : null;
  $(spec.hint).textContent = sel
    ? `${flagOf(sel.iso)} ${sel.ja || sel.en} で絞り込み中`
    : `国が特定できた ${total}件`;

  S.mapData = S.mapData || {};
  S.mapData.world = {
    counts, cats, spec, width: BOX, height: BOX,
    byId: new Map([...byIso].map(([k, v]) => [k, v])),
  };
}

/* Run `then` once the country has come round, or give up.

   The globe eases rather than snapping, and how long that takes depends on how
   far it had to come — a country on the far side takes twice as long as one
   already near the edge. Polling for the arrival is exact where a fixed delay
   was a guess. */
function whenFacing(svg, iso, then) {
  const started = performance.now();
  const tick = () => {
    if (!svg.isConnected) return;
    const c = (G.built || []).find((x) => x.iso === iso);
    if (!c) return;
    /* Wait for the turn to finish, not merely for the country to come into
       view.

       Testing "is it facing us yet" fired as soon as the country crossed the
       limb, with most of the turn still to run — and the ping, which is placed
       once and does not travel, was then left sitting over open ocean sixty
       degrees away. The globe stops when it arrives; that is the moment to
       mark the spot. */
    const arrived = G.target == null;
    if (arrived || performance.now() - started > 2600) { then(); return; }
    setTimeout(tick, 60);
  };
  setTimeout(tick, 100);
}

/* The ping on a sphere.

   The rings expand from wherever the country has landed on the near side, and
   the globe leans in — the same gesture as the flat map's zoom, done by
   scaling the sphere about that point rather than by moving a viewBox. */
function globePing(svg, iso, story) {
  const c = (G.built || []).find((x) => x.iso === iso);
  if (!c || !svg.isConnected) return;

  /* Finish the turn before marking the spot.

     The rings and the icon are placed once, in screen coordinates, and do not
     travel with the sphere — so any rotation still to come would slide the
     globe out from under them. Waiting for the turn is not enough on its own:
     a slow frame or a throttled tab can leave a few degrees outstanding when
     the wait times out. Landing the remainder here makes the point exact and
     the globe still, whatever happened on the way. */
  if (G.target != null) { G.lon = G.target; G.target = null; drawGlobe(svg); drawMarks(svg); }

  const sinL = Math.sin(G.lon), cosL = Math.cos(G.lon);
  const pt = [0, 0, 0];
  project(c.anchor, sinL, cosL, pt);
  if (pt[2] <= -0.05) return;                      // genuinely round the back

  svg.querySelectorAll(".ping-ring, .ping-core, .ping-icon").forEach((n) => n.remove());
  // Its own layer: the bubble layer is cleared and refilled on every frame of
  // the spin, so a ping placed there lasted about sixteen milliseconds.
  const host = svg.querySelector(".globe-ping") || svg;
  for (const delay of ["", "d2", "d3"]) {
    const ring = mk("circle", { cx: pt[0].toFixed(1), cy: pt[1].toFixed(1), r: 62 },
                    ("ping-ring " + delay).trim());
    host.append(ring);
    setTimeout(() => ring.remove(), SPOTLIGHT_MS);
  }
  const core = mk("circle", { cx: pt[0].toFixed(1), cy: pt[1].toFixed(1), r: 5 }, "ping-core");
  host.append(core);
  setTimeout(() => core.remove(), SPOTLIGHT_MS);

  const g = groupOf(story.category);
  if (g) {
    const size = 26;
    const mark = mk("svg", {
      viewBox: "0 0 24 24", width: size, height: size,
      x: (pt[0] - size / 2).toFixed(1), y: (pt[1] - size * 1.35).toFixed(1),
    }, "ping-icon");
    const path = mk("path", {
      d: g.icon, fill: "none", stroke: `var(--cat-${g.key})`,
      "stroke-width": "2.2", "stroke-linecap": "round", "stroke-linejoin": "round",
    });
    mark.append(path);
    host.append(mark);
    setTimeout(() => mark.remove(), SPOTLIGHT_MS);
  }

  // Lean in on the country, then let go. Scaling about the point keeps it
  // where it is on screen while everything around it grows.
  // As a share of the box, not in pixels: pt is in viewBox units (0..400) and
  // the element is drawn at whatever size the panel gives it, so passing those
  // numbers as pixels put the zoom's centre somewhere else entirely.
  svg.style.transformOrigin =
    `${(pt[0] / BOX * 100).toFixed(1)}% ${(pt[1] / BOX * 100).toFixed(1)}%`;
  svg.style.transition = "transform 1s cubic-bezier(.4,0,.2,1)";
  svg.style.transform = "scale(1.55)";
  setTimeout(() => { svg.style.transform = ""; }, SPOTLIGHT_MS - 1400);
  /* Still while the story is up.

     It used to start drifting again a second before the story left, which
     meant the country you were reading about slid away under the text. The
     globe holds until the story does, and the next spotlight releases it as it
     turns to the next country. */
  /* Still until the ping has gone.

     The rings, the core and the genre icon are all placed once, at the point
     where the country happens to be on screen. They do not travel with the
     sphere — so for as long as any of them is up, the sphere must not move, or
     they end up marking open ocean.

     Released on the same tick they are removed on, not a moment later: the
     removals were queued first so they run first, and a gap of even a few
     hundred milliseconds is a few degrees of globe sliding under a ping that
     is still on screen. */
  setTimeout(releaseGlobe, SPOTLIGHT_MS);
}

/* The story under a map, written the same way whichever map it is under. */
function paintCaption(caption, story, label) {
  caption.innerHTML = "";
  // With a picture, use it full-bleed behind the text: the box then always
  // looks composed, whatever length the headline happens to be.
  caption.classList.toggle("no-thumb", !story.image);
  caption.style.backgroundImage = story.image
    ? `linear-gradient(180deg, rgba(4,14,26,.55), rgba(4,14,26,.92)), url("${proxied(story.image)}")`
    : "";
  const body = el("div", "mc-body");

  const meta = el("div", "mc-line");
  meta.append(catIcon(story.category, 13), el("span", "mc-where", label),
              el("span", "mc-src", story.publisher || story.source),
              el("span", "mc-when", ago(story.published)));
  body.append(meta);

  const headline = shortTitle(story.title_ja || story.title, 90);
  body.append(el("div", "mc-title", headline.startsWith(label)
    ? headline.slice(label.length).replace(/^[\s　:：-]+/, "") : headline));

  // One story, shown big. Listing the region's other headlines filled the box
  // but turned it back into a per-country digest, which is not what this is for.
  const blurb = (story.summary_ja || story.summary || "").trim();
  caption.classList.toggle("no-blurb", !blurb);
  if (blurb) body.append(el("div", "mc-sub", blurb.slice(0, 400)));

  caption.append(body);
  caption.title = story.title_ja || story.title;
  caption.onclick = () => window.open(story.url, "_blank", "noopener");
  caption.classList.remove("swap");
  void caption.offsetWidth;
  caption.classList.add("swap");
  alignCaptions();
}

// Height the map actually occupies inside its (taller) SVG box, given the
// viewBox aspect and xMidYMin alignment.
function mapDrawnHeight(svg, scope) {
  const data = scope === "jp" ? S.map : S.world;
  if (!data) return 0;
  const w = svg.getBoundingClientRect().width;
  if (!w) return 0;
  /* Take the aspect from what is on screen, not from the source data.

     The world's source is 900x366 and the globe drawn from it is square, so
     computing the caption's position from the file put it where the flat map's
     bottom edge used to be — about the equator — and the box climbed halfway
     up the sphere. */
  const vb = (svg.getAttribute("viewBox") || "").split(/\s+/).map(Number);
  const ratio = (vb.length === 4 && vb[2]) ? vb[3] / vb[2] : data.height / data.width;
  return Math.min(svg.getBoundingClientRect().height, w * ratio);
}

/* --------------------------------------------------------------- player */

export { MAP_SPECS, SPOTLIGHT_MS, SPOT_FRESH, SPOT_STALE, alignCaptions, mapDrawnHeight, renderMap, spotlight, zoomToRegion };
