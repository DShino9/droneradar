import { $, S, SOCIAL_COLOR, catColor, el } from "./state.js";
import { catLabel, hue } from "./util.js";

const RADAR_PERIOD = 6;   // seconds per sweep; must match the CSS animation

// Where the beam would be right now if it had been turning since the page
// loaded. Re-rendering the dial builds a fresh <g class="sweep">, and a new
// element starts its animation from 0° — the beam snapped back to twelve
// o'clock on every refresh. Feeding this back as a negative animation-delay
// makes the replacement pick up exactly where the old one left off.
// Ask the outgoing beam how far round it had got; document.timeline is the
// fallback for the very first render, when there is nothing to ask.
function radarPhase() {
  const g = document.querySelector("#radar .sweep");
  const anim = g && g.getAnimations ? g.getAnimations()[0] : null;
  if (anim && anim.effect) {
    const p = anim.effect.getComputedTiming().progress;
    if (p != null) return p * RADAR_PERIOD;
  }
  return ((document.timeline.currentTime || 0) / 1000) % RADAR_PERIOD;
}

/* The rim has room for a word, not for a category name in full.

   Cutting to a character count gave "開発・O" and "ビジネス・", which read as
   a rendering fault. Every one of these names is a head and a qualifier joined
   by "・" — 防衛・軍事, 測量・点検, 空撮・FPV — and the head alone is the part
   that identifies it, so take that and cut only if it is still too long. */
function sectorName(label) {
  const head = String(label).split(/[・／\/]/)[0].trim() || label;
  return head.length > 6 ? head.slice(0, 5) + "…" : head;
}

/* A headline, cut down to something a contact label can hold.

   Cutting to a character count gave "educati…" and "wanglin…" — the first few
   letters of a repository owner, which name nothing. The problem was never the
   length, it was cutting at an arbitrary point in the middle of the first word
   that happened to be there.

   So: throw away the parts of a headline that are not the subject — the
   bracketed source tag, the owner half of an "owner/repo" pair — and then cut
   at a clause boundary rather than mid-word. What is left is short because the
   subject is short, not because it was truncated. */
function radarLabel(raw, max) {
  let t = String(raw || "").replace(/\s+/g, " ").trim();
  // "owner/repo — description": the repository is the thing, not the account.
  const repo = t.match(/^[\w.-]+\/([\w.-]+)(?:\s*[—–-]\s*(.*))?$/);
  if (repo) t = repo[1].replace(/[-_]+/g, " ");
  t = t.replace(/^[【\[][^】\]]{0,14}[】\]]\s*/, "")            // 【速報】
       .replace(/^(?:PR|AD|速報|独占|特集)\s*[:：|｜]\s*/i, "")
       .trim();
  /* Cut at a clause boundary, but only one that has earned the space.

     Taking the first boundary past a third of the budget turned "Amazon、
     ドローン配送を強化、注文数100万件を目指す" into "Amazon" — a true clause,
     and not the news. The boundary worth taking is the last one that still
     fits, provided it uses most of the room; otherwise the budget is better
     spent on the sentence, cut where it lands. */
  const chars0 = [...t];
  const brk = /[、。，．,.:：|｜/／—–]/g;
  let cut = -1, m;
  while ((m = brk.exec(t))) {
    const at = [...t.slice(0, m.index)].length;
    if (at > max) break;
    if (at >= max * 0.6) cut = at;
  }
  if (cut > 0) t = chars0.slice(0, cut).join("");
  const chars = [...t];
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : t;
}

/* What a post is about, as far as twelve characters can carry it.

   Labelling posts with the account name told you who was talking and nothing
   about what — a dial of eight @handles says only that eight people posted.
   Labelling them with the raw first characters was no better, because a post
   opens with whatever it opens with: a reply chain of mentions, a link, a
   greeting. Strip the parts that are addressing rather than saying, and what
   is left is the sentence. */
function postGist(text) {
  let t = String(text || "")
    .replace(/https?:\/\/\S+/g, " ")          // links
    .replace(/^(?:[@＠][\w.]+[\s、,]*)+/, " ")  // the reply chain at the front
    .replace(/^(?:RT[\s:：]*)+/i, " ")
    .replace(/[#＃][^\s#＃]+/g, " ")            // hashtags say the topic twice
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")   // emoji
    .replace(/\s+/g, " ")
    .trim();
  // A post that was nothing but mentions and a link has no gist to show.
  return t.length >= 4 ? t : "";
}

/* The dial's tooltip.

   The browser's own — an SVG <title> — waits about a second, renders one
   unstyled line, and goes away the moment the pointer shifts a pixel. On a
   dial of forty-eight three-pixel contacts that amounts to no tooltip at all.
   This one appears at once, holds the full headline, and says what kind of
   thing it is and when it arrived. */
function showTip(b, kind, when, x, y) {
  const tip = $("#radar-tip"), svg = $("#radar"), wrap = svg.parentElement;
  if (!tip) return;
  tip.innerHTML = "";
  const head = el("div", "rt-head");
  head.append(el("span", "rt-kind", kind), el("span", "rt-who", b.who || ""),
              el("span", "rt-when", when));
  tip.append(head);
  // A post can run to several hundred characters and would cover the dial it
  // is describing. The link at the end of one is never the part worth reading.
  const body = (b.label || "").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  tip.append(el("div", "rt-title", body.slice(0, 110)));
  if (b.url) tip.append(el("div", "rt-go", "クリックで開く"));
  tip.classList.remove("hidden");

  // The blip's place on the dial is in viewBox units; put the tooltip beside
  // it in the wrapper's pixels, then keep it inside the panel.
  const box = svg.getBoundingClientRect(), host = wrap.getBoundingClientRect();
  const vb = (svg.getAttribute("viewBox") || "0 0 268 200").split(/\s+/).map(Number);
  const sx = box.width / (vb[2] || 268), sy = box.height / (vb[3] || 200);
  const px = box.left - host.left + x * sx, py = box.top - host.top + y * sy;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  // Above the contact if there is room, below it if not; never off the side.
  let left = px - w / 2;
  left = Math.max(4, Math.min(host.width - w - 4, left));
  const top = py - h - 10 >= 0 ? py - h - 10 : py + 12;
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}

function hideTip() {
  const tip = $("#radar-tip");
  if (tip) tip.classList.add("hidden");
}

function renderRadar(items) {
  const svg = $("#radar");
  const ns = "http://www.w3.org/2000/svg";
  /* The box is wider than it is tall, and the dial is not.

     The panel is wider than the dial can use — a square viewBox letterboxed
     inside it left about 36px unused down each side. Widening the box spends
     that margin on somewhere to put the genre names, which used to sit inside
     the rim on top of the blips and the sweep. The dial itself is barely
     smaller for it: the box grows sideways, so the height, which is what
     limits the dial, is unchanged. */
  const BOX_W = 268, BOX_H = 200;
  const cx = BOX_W / 2, cy = BOX_H / 2, R = 88;
  const LABEL_R = R + 11;
  svg.setAttribute("viewBox", `0 0 ${BOX_W} ${BOX_H}`);
  // The sweep spins about this point, and CSS cannot read the geometry above.
  svg.style.setProperty("--radar-cx", `${cx}px`);
  svg.style.setProperty("--radar-cy", `${cy}px`);
  const now = Date.now() / 1000;
  const phase = radarPhase();

  // The window adapts to the data. A fixed 6 hours left every blip bunched
  // inside the innermost ring, because the ticker refreshes each minute and
  // nothing on the dial was ever more than ~30 minutes old.
  const WINDOW_CHOICES = [
    [30 * 60, [5, 15, 30]],
    [60 * 60, [10, 30, 60]],
    [3 * 3600, [30, 90, 180]],
    [6 * 3600, [60, 180, 360]],
    [12 * 3600, [120, 360, 720]],
    [24 * 3600, [240, 720, 1440]],
  ];
  const nowSec = Date.now() / 1000;
  /* A just-collected item goes on the dial whatever its timestamp says, but
     not without limit. A full re-collection marks every article new at once,
     and without a ceiling here all of them were plotted — several hundred
     stories, most of them hours or days old, every one of them past the end of
     the scale and so drawn hard against the rim. The dial became a ring.

     Twelve hours is the most a genuine late pickup needs; past that the item
     is not news arriving, it is history being re-read. */
  const FRESH_GRACE = 12 * 3600;
  const isFresh = (it, age) => S.freshItems.has(it.id) && age < FRESH_GRACE;

  // Only the items that will actually be plotted decide the scale. Measuring
  // every article put the 90th percentile days out and pinned the dial to 24h,
  // which bunched everything back at the centre — and leaving the new arrivals
  // out of the measurement was the other half of the ring: the scale was set
  // by items younger than the ones being drawn past the end of it.
  const PLOT_MAX = 90;
  const ages = [
    ...items.map((it) => nowSec - it.published)
      .filter((a) => a >= 0),
    ...items.filter((it) => S.freshItems.has(it.id))
      .map((it) => nowSec - it.published)
      .filter((a) => a >= 0 && a < FRESH_GRACE),
    ...S.social.map((p) => nowSec - (p.created || 0)),
  ].filter((a) => a >= 0).sort((a, b) => a - b).slice(0, PLOT_MAX);
  const p90 = ages.length ? ages[Math.floor((ages.length - 1) * 0.9)] : 3600;
  const chosen = WINDOW_CHOICES.find(([w]) => w >= p90) || WINDOW_CHOICES[WINDOW_CHOICES.length - 1];
  const WINDOW = chosen[0];
  const RING_MINUTES = chosen[1];
  const recent = [];
  for (const it of items) {
    const age = now - it.published;
    // Just-collected articles go on the dial whatever their timestamp says.
    // The radius is age since publication, so a story filed eight hours ago
    // and picked up a minute ago fell outside the window entirely — the board
    // and the sidebar lit up for an arrival the radar never showed.
    if (age >= 0 && (age < WINDOW || isFresh(it, age))) {
      recent.push({
        key: it.id, age, kind: it.flagship > 0 ? "imp" : "art", cat: it.category,
        label: it.title_ja || it.title, url: it.url,
        who: it.publisher || it.source,
        weight: it.importance || 0, cluster: it.cluster || 1,
        fresh: S.freshItems.has(it.id),
      });
    }
  }
  for (const p of S.social) {
    const age = now - (p.created || 0);
    if (age >= 0 && age < WINDOW) {
      recent.push({
        key: p.id, age, kind: "soc", cat: "social", label: p.text, url: p.url,
        who: p.handle || p.author || p.network,
        // Reposts count for more than likes: passing something on is a
        // stronger signal that it mattered than tapping a heart.
        buzz: (p.likes || 0) + (p.reposts || 0) * 3 + (p.replies || 0),
      });
    }
  }
  recent.sort((a, b) => a.age - b.age);
  // The 90 cap is about legibility, not about which items matter — a new
  // arrival must never be the one dropped, so it is kept and the oldest
  // ordinary contact goes instead.
  // 48, not 90. Every blip carries its own CSS animation, and ninety of them
  // was over half of everything animating on the page at once — for contacts
  // packed tightly enough that the outer ones were unreadable anyway.
  const CAP = 48;
  /* Posts and articles are ranked apart, then merged.

     Sorted together by age, posts win every slot: they arrive by the minute
     and a story is hours old by the time it is filed. The dial filled with
     forty-eight tweets and not one piece of news — on a board whose subject is
     drone news. So each kind gets its own share of the cap, and whatever one
     does not use goes to the other. */
  const ART_SHARE = 0.55;
  const pick = (pool, room) => {
    const f = pool.filter((b) => b.fresh);
    // A new arrival is never the one dropped; the oldest ordinary contact goes.
    return f.length
      ? f.slice(0, room).concat(pool.filter((b) => !b.fresh)
          .slice(0, Math.max(0, room - f.length)))
      : pool.slice(0, room);
  };
  const arts = recent.filter((b) => b.kind !== "soc");
  const socs = recent.filter((b) => b.kind === "soc");
  const artRoom = Math.min(arts.length, Math.round(CAP * ART_SHARE));
  const blips = pick(arts, artRoom + Math.max(0, Math.round(CAP * (1 - ART_SHARE)) - socs.length))
    .concat(pick(socs, CAP - artRoom))
    .sort((a, b) => a.age - b.age);

  // The two axes: bearing = what kind of thing it is, range = how old it is.
  // Sectors are sized by share so a busy category gets room to breathe.
  const sectors = [...S.categories.filter(([k]) => k !== "video"),
                   ["social", "SNS"]];
  const share = {};
  for (const b of blips) {
    const k = b.kind === "soc" ? "social" : b.cat;
    share[k] = (share[k] || 0) + 1;
  }
  const span = {}, start = {};
  const MIN_SPAN = 14;
  const live = sectors.filter(([k]) => share[k]);

  // Sectors are proportional to how many items each holds, so a category with
  // one blip always gets a sliver. (Reserving a fixed share for "news" meant
  // that when 防衛・軍事 was the only news category live, its single item took
  // the whole reserved two thirds.) The high-volume feeds — SNS posts, GitHub
  // pushes — are then capped so they cannot swamp the dial, and what they give
  // up is handed back to the rest in proportion.
  const CAPS = { social: 90, dev: 80, community: 55, research: 45 };
  // Every category needs a ceiling, not just the noisy ones: with only the
  // high-volume feeds capped, whatever was left over went entirely to the one
  // uncapped sector — 防衛・軍事 held two blips and drew 135°. The default
  // ceiling is twice a category's fair share, so it can never run away.
  const totalItems = Math.max(1, live.reduce((n, [k]) => n + share[k], 0));
  const capFor = (k) => CAPS[k]
    || Math.max(MIN_SPAN * 1.6, 360 * (share[k] / totalItems) * 2);

  // Capping in a single pass just moved the problem: the degrees SNS gave up
  // were handed to コミュニティ, which then out-measured SNS despite holding a
  // fifth as many blips. Re-check after every redistribution until nothing is
  // over its cap, so a sector is never wider than one with more items.
  let pool = live.map(([k]) => k);
  let room = 360;
  for (let pass = 0; pass < 8 && pool.length; pass++) {
    const totalShare = Math.max(1, pool.reduce((n, k) => n + share[k], 0));
    const flex = Math.max(0, room - MIN_SPAN * pool.length);
    const want = {};
    const over = [];
    for (const k of pool) {
      want[k] = MIN_SPAN + flex * (share[k] / totalShare);
      if (want[k] > capFor(k)) over.push(k);
    }
    if (!over.length) {
      for (const k of pool) span[k] = want[k];
      pool = [];
      break;
    }
    for (const k of over) {
      span[k] = capFor(k);
      room -= span[k];
    }
    pool = pool.filter((k) => !over.includes(k));
  }
  // Everything hit a cap and degrees are left over: scale them all up evenly.
  if (pool.length === 0) {
    const drawn = live.reduce((n, [k]) => n + (span[k] || 0), 0);
    if (drawn > 0 && Math.abs(360 - drawn) > 1) {
      const scale = 360 / drawn;
      for (const [k] of live) span[k] *= scale;
    }
  }

  let cursor = 0;
  for (const [k] of live) {
    start[k] = cursor;
    cursor += span[k];
  }

  svg.innerHTML = "";
  const add = (tag, attrs, cls) => {
    const n = document.createElementNS(ns, tag);
    if (cls) n.setAttribute("class", cls);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    svg.append(n);
    return n;
  };

  // One function for both the rings and the blips, so the labelled circles sit
  // exactly where an item of that age would be plotted. They did not before:
  // the rings used 0.33/0.66 of the window as if those were 1h and 3h, when
  // 1h of a 6h window is 0.167 — every labelled ring was in the wrong place.
  /* Anything past the end of the scale used to be clamped to exactly the rim,
     so a batch of them stacked into a solid ring on the outer circle. They are
     placed just inside instead, spread over the last few units deterministically
     by id — still plainly the oldest things on the dial, but reading as
     contacts rather than as a drawn line. */
  const radiusForAge = (ageSec, key) => {
    const t = ageSec / WINDOW;
    if (t <= 1) return 16 + Math.sqrt(t) * (R - 20);
    return R - 4 - (key == null ? 2 : (hue(String(key)) % 7));
  };

  add("circle", { cx, cy, r: R.toFixed(1) }, "grid");
  for (const mins of RING_MINUTES) {
    if (mins * 60 >= WINDOW) continue;
    add("circle", { cx, cy, r: radiusForAge(mins * 60).toFixed(1) }, "grid faint");
  }
  const polar = (deg, r) => {
    const rad = (deg - 90) * Math.PI / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };

  for (const [key, label] of live) {
    const a0 = start[key], a1 = a0 + span[key];
    const [sx, sy] = polar(a0, R);
    add("line", { x1: cx, y1: cy, x2: sx.toFixed(1), y2: sy.toFixed(1) }, "spoke");

    // A coloured arc along the rim names each bearing without a legend.
    const [ax, ay] = polar(a0 + 1, R + 3);
    const [bx, by] = polar(a1 - 1, R + 3);
    const big = span[key] > 180 ? 1 : 0;
    const arc = add("path", {
      d: `M${ax.toFixed(1)} ${ay.toFixed(1)} A${R + 3} ${R + 3} 0 ${big} 1 ${bx.toFixed(1)} ${by.toFixed(1)}`,
    }, "sector-arc");
    arc.setAttribute("stroke", key === "social" ? SOCIAL_COLOR : catColor(key));
    const at = document.createElementNS(ns, "title");
    at.textContent = `${label} ${share[key]}件`;
    arc.append(at);

    // Outside the rim, not inside it. In here the name lay over whatever
    // blips its own sector held, and over the sweep four times a minute.
    if (span[key] >= 13) {
      const mid = a0 + span[key] / 2;
      let [lx, ly] = polar(mid, LABEL_R);
      // Which way the text runs from its anchor, so it grows away from the
      // dial rather than back across it.
      const dx = lx - cx;
      const anchor = dx > 6 ? "start" : dx < -6 ? "end" : "middle";
      // A sector pointing straight up or straight down puts its name past the
      // edge of the box. Pull those back in; the label is still clear of the
      // arc, which is what it needed to be.
      ly = Math.min(BOX_H - 5, Math.max(7, ly));
      lx = Math.min(BOX_W - 3, Math.max(3, lx));
      const t = add("text", {
        x: lx.toFixed(1), y: (ly + 2.4).toFixed(1), "text-anchor": anchor,
      }, "sector-lbl");
      t.setAttribute("fill", key === "social" ? SOCIAL_COLOR : catColor(key));
      t.textContent = sectorName(label);
    }
  }

  // Sweep wedge: a 52° pie slice trailing the leading edge.
  const spread = 52 * Math.PI / 180;
  const ex = cx + R * Math.cos(-Math.PI / 2), ey = cy + R * Math.sin(-Math.PI / 2);
  const tx = cx + R * Math.cos(-Math.PI / 2 - spread);
  const ty = cy + R * Math.sin(-Math.PI / 2 - spread);
  const sweep = document.createElementNS(ns, "g");
  sweep.setAttribute("class", "sweep");
  const wedge = document.createElementNS(ns, "path");
  wedge.setAttribute("class", "beam");
  wedge.setAttribute("d", `M${cx} ${cy} L${tx.toFixed(1)} ${ty.toFixed(1)} A${R} ${R} 0 0 1 ${ex.toFixed(1)} ${ey.toFixed(1)} Z`);
  sweep.append(wedge);
  const edge = document.createElementNS(ns, "line");
  edge.setAttribute("class", "beam-edge");
  edge.setAttribute("x1", cx); edge.setAttribute("y1", cy);
  edge.setAttribute("x2", ex.toFixed(1)); edge.setAttribute("y2", ey.toFixed(1));
  sweep.append(edge);
  // Resume the rotation mid-stroke instead of restarting it at the top.
  sweep.style.animationDelay = `${-phase.toFixed(3)}s`;
  svg.append(sweep);

  // Ring labels, placed on the same radii the blips use.
  for (const mins of RING_MINUTES) {
    const rr = radiusForAge(mins * 60);
    add("text", { x: cx + 1.5, y: (cy - rr + 4).toFixed(1) }, "ring-lbl")
      .textContent = mins >= 60 ? `${Math.round(mins / 60)}時間` : `${mins}分`;
  }

  const placed = [];
  for (const b of blips) {
    // Bearing = category sector (jittered inside it, deterministically so a
    // blip keeps its spot between renders); range = age.
    const key = b.kind === "soc" ? "social" : b.cat;
    const sector = span[key] != null ? key : null;
    const deg = sector
      ? start[sector] + 3 + ((hue(b.key) / 360) * Math.max(1, span[sector] - 6))
      : hue(b.key);
    const rad = (deg - 90) * Math.PI / 180;
    // sqrt, not linear: most items are recent, and a linear radius packed them
    // all into the middle. Square-rooting spreads them by equal area instead.
    const dist = radiusForAge(b.age, b.key);
    const x = cx + dist * Math.cos(rad), y = cy + dist * Math.sin(rad);
    // A blip must flash when the beam reaches its bearing, i.e. at
    // t = P * deg/360. A negative delay -x starts the animation already x
    // seconds in, so the phase at t=0 must be P - P*deg/360 — the previous
    // -P*deg/360 ran the flash the wrong way round the dial. The sweep now
    // resumes at `phase` rather than at 0°, so every flash shifts with it or
    // the blips would light where the beam no longer is.
    const delay = `${(RADAR_PERIOD * (deg / 360) - RADAR_PERIOD - phase).toFixed(3)}s`;

    if (b.kind === "imp" && b.age < 3600) {
      const ping = add("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 3 }, "ping");
      ping.style.animationDelay = delay;
    }
    // A new contact gets an expanding ring as well as a brighter dot. On a dial
    // holding forty-eight blips a dot that is merely a little larger and a
    // little redder is not something you notice unless you are looking for it;
    // a ring growing out of it is the one thing on the dial that moves
    // outward, so the eye finds it without being told where to look.
    if (S.freshItems.has(b.key)) {
      const ring = add("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 3 }, "fresh-ring");
      ring.style.animationDelay = delay;
      // The genre's colour, same as the tile and the map region this story lit.
      ring.style.stroke = b.kind === "soc" ? SOCIAL_COLOR : catColor(b.cat);
    }
    const dot = add("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 2.6 },
                    "blip " + b.kind + (S.freshItems.has(b.key) ? " fresh" : ""));
    dot.style.fill = b.kind === "soc" ? SOCIAL_COLOR : catColor(b.cat);
    dot.style.animationDelay = delay;
    if (S.freshItems.has(b.key)) dot.style.setProperty("--fresh", dot.style.fill);

    const mins = Math.round(b.age / 60);
    const when = mins < 60 ? `${mins}分前` : `${Math.round(mins / 60)}時間前`;
    const kind = b.kind === "soc" ? "SNS" : catLabel(b.cat);

    /* A separate, invisible, much larger circle takes the pointer.

       The blip is 2.6 units across — three pixels on screen — and it pulses,
       so hitting it was a matter of luck and the tooltip that was attached to
       it went unseen. The target is five times the area and does not move. */
    const hit = add("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 6.5 }, "blip-hit");
    hit.addEventListener("pointerenter", () => showTip(b, kind, when, x, y));
    hit.addEventListener("pointerleave", hideTip);
    if (b.url) {
      hit.classList.add("go");
      hit.addEventListener("click", () => window.open(b.url, "_blank", "noopener"));
    }
    placed.push({ ...b, x, y, deg, delay });
  }

  // Name as many contacts as the dial can hold. Three was the safe number when
  // each label ran to 15 characters — that is 105 units of a 200-unit box, so
  // any two of them overlapped. Eight characters always fits inside the frame
  // whichever side of the centre the blip is on, which leaves the vertical
  // stacking as the only thing to police.
  /* Fewer labels, larger, and only where there is room for them.

     Nine labels at seven pixels filled the dial with text too small to read and
     too short to mean anything. The ones worth naming are the newest, and the
     newest sit near the centre — which is also where a label has the width of
     half the box to run into. Out at the rim there is no room for more than a
     couple of characters, so those are left to the tooltip. */
  const LABEL_GAP = 13, LABEL_MAX = 5, LABEL_ZONE = R * 0.68;
  /* Above the noise floor. The median post scores zero and the ninetieth
     percentile is three, so five is comfortably into the part of the
     distribution where something was actually read. */
  const SOC_MIN_BUZZ = 5;
  /* A Japanese character is as wide as the type is tall; a Latin one is a bit
     over half that. Budgeting 5.6 for both let twice as much text through as
     would fit, which is how a label meant to be eight characters came out at
     twenty and ran off the dial. */
  const CJK_W = 10.4, LAT_W = 5.9;
  // Past about a dozen characters the label stops being a tag on a contact and
  // starts being a headline lying across the dial, whatever the room allows.
  const LABEL_CAP = 12;
  const shown = [];
  /* Articles get the labels first.

     Most of what is on the dial at any moment is chatter — forty posts to half
     a dozen stories — so taking the newest five regardless of kind meant five
     account names and no news. Posts still get whatever slots are left, which
     on a quiet news hour is all of them. */
  /* Which contacts are worth naming, in order.

     Newest-first put a repository called "aeronautics" ahead of a strike on an
     airfield, because it was pushed four minutes more recently. Being new is
     what the dial already shows — the blip is nearer the centre. What the label
     should add is which of them matters, so the ranking is by the weight the
     collector worked out, and recency only breaks ties.

     Posts come after every article, and only when they have something to say. */
  /* Not every article has a headline.

     The collector scores everything from GitHub at exactly 12, which is above
     what most news gets, so a repository pushed this afternoon outranked a
     strike on an airfield. The score is not wrong — it is measuring how much
     the item matters, and a release does matter — it just is not measuring
     whether the title is a sentence. "Yarindos/drone_in_sky" is a name, and a
     name on a dial says as little as an @handle does.

     So an identifier-shaped title is demoted for labelling. It stays a contact
     and it keeps its tooltip; it simply does not get to be one of the five
     things the dial spells out. */
  const IDENT = /^[\w.-]+\/[\w.-]+/;
  const worth = (b) => b.weight + (b.cluster > 1 ? b.cluster * 4 : 0)
                     + (b.kind === "imp" ? 40 : 0)
                     - (b.cat === "video" ? 10 : 0);
  /* A repository name is not a headline, so it does not get to be one.

     Demoting them was not enough: on an hour when most of what arrived was
     from GitHub they were still the only articles there, and the dial spelled
     out "trackdraw", "the big dro…", "Dragonfly G…" — English fragments that
     name a project and say nothing about drones. They stay as contacts and
     keep their tooltips; they are simply never the label.

     The same test covers the other untranslatable case: these titles are the
     one kind the translator leaves alone, which is why the dial kept coming
     out in English however much Japanese had been collected. */
  const named = (b) => !IDENT.test(b.label || "");
  const order = [
    ...placed.filter((b) => b.kind !== "soc" && named(b))
      .sort((a, b) => worth(b) - worth(a) || a.age - b.age),
    /* Only the posts anyone actually reacted to.

       Of two hundred and twenty posts an hour, a hundred and eighty-six have
       no likes, no reposts and no replies at all. Labelling by recency put
       those on the dial as readily as anything else, so the names on it were
       mostly one person talking to nobody. Sorted by reach and held to a
       floor, what gets named is what got through. */
    ...placed
      .filter((b) => b.kind === "soc" && (b.buzz || 0) >= SOC_MIN_BUZZ && postGist(b.label))
      .sort((a, b) => (b.buzz || 0) - (a.buzz || 0)),
  ];
  for (const b of order) {           // each half already sorted newest-first
    if (shown.length >= LABEL_MAX) break;
    if (b.y < 11 || b.y > BOX_H - 9) continue;
    if (Math.hypot(b.x - cx, b.y - cy) > LABEL_ZONE) continue;
    const right = b.x <= cx;
    if (shown.some((l) => l.right === right && Math.abs(l.y - b.y) < LABEL_GAP)) continue;
    shown.push({ ...b, right });
  }
  for (const b of shown) {
    const lx = b.right ? b.x + 5 : b.x - 5;
    const lead = add("line", {
      x1: b.x.toFixed(1), y1: b.y.toFixed(1),
      x2: lx.toFixed(1), y2: b.y.toFixed(1),
    }, "lbl-lead");
    lead.setAttribute("opacity", ".7");
    const text = add("text", {
      x: lx.toFixed(1), y: (b.y + 2.2).toFixed(1),
      "text-anchor": b.right ? "start" : "end",
    }, "lbl");
    // How many characters actually fit between here and the edge of the box,
    // measured against this headline's own mix of scripts.
    const room = b.right ? BOX_W - lx - 4 : lx - 4;
    const full = (b.kind === "soc" ? postGist(b.label) : b.label)
      .replace(/\s+/g, " ").trim();
    const cjkShare = ([...full.slice(0, 24)]
      .filter((c) => /[^\x00-\xff]/.test(c)).length) / Math.min(24, full.length || 1);
    const perChar = CJK_W * cjkShare + LAT_W * (1 - cjkShare);
    const fit = Math.max(4, Math.min(LABEL_CAP, Math.floor(room / perChar)));
    text.textContent = radarLabel(full, fit);
    const tip = document.createElementNS(ns, "title");
    tip.textContent = `${b.who}　${full.slice(0, 70)}`;
    text.append(tip);
    if (b.url) {
      text.classList.add("hit");
      text.onclick = () => window.open(b.url, "_blank", "noopener");
    }
  }

  add("circle", { cx, cy, r: 2.4 }, "core");

  const soc = blips.filter((b) => b.kind === "soc").length;
  $("#radar-hint").textContent = `6時間 ${blips.length}件（SNS ${soc}）`;
}

/* ------------------------------------------------------------- the charts */

/* ---------------------------------------------------------------- cards */

export { RADAR_PERIOD, radarPhase, renderRadar };
