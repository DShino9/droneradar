import { $, S, el } from "./state.js";
import { ago, shortTitle } from "./util.js";

const LED_MIN = 5;          // never show fewer than this

// 12, not 18. The track holds two copies of the window so the loop is
// seamless, which made it a 30,000px-wide composited layer — and no one can
// read eighteen headlines before it rotates anyway.
const LED_WINDOW = 12;

/* Candidates the window rotates through.

   Sixty, twelve at a time, meant five turns of the board before a headline
   came back — fifteen minutes. With a shorter freshness window there are not
   sixty stories worth showing anyway, and a shallower pool means what is on
   the board is the top of the news rather than the top sixty of it. */
const LED_POOL = 36;

const LED_SPEED = 150;      // pixels per second

const LED_ROTATE_MS = 180000;

/* Long enough to actually read the pane before it changes.

   Eight seconds for twelve headlines is two thirds of a second each — the pane
   turned over while you were still on the second row. It pauses on hover, but
   pausing is something you have to know to do; the default should be readable
   on its own. */
const GENRE_ROTATE_MS = 24000;

// Slower than the genre flip: the headline pane keeps the same category, so
// a page turn here is the reader losing their place rather than a new topic.
const LEAD_PAGE_MS = 20000;

function renderHighlights(items) {
  const board = $("#highlights");
  const track = $("#led-track");
  const now = Date.now() / 1000;

  /* Importance, worn down by age.

     The score used to be importance alone, so a story that scored well held
     its place at the top of the pool for the whole window — and since the
     board rotates twelve at a time through sixty candidates, it came round
     again every quarter of an hour, all day. "I saw that one yesterday and it
     is still going past" is what a ranking with no clock in it looks like.

     Halving every six hours: a big story stays up for most of a day, an
     ordinary one has dropped below the fresh arrivals by the evening. */
  const HALF_LIFE = 6 * 3600;
  const score = (it) => {
    const base = it.importance + it.flagship + (it.cluster || 1) * 8;
    return base * Math.pow(0.5, Math.max(0, now - it.published) / HALF_LIFE);
  };
  // A headline board is for news. Repos, papers and forum chatter are real
  // items but they are not bulletins, and a deep candidate pool pulls them in.
  const NEWSY = new Set(["jp_news", "world_news", "defense", "regulation",
                         "product", "business", "hobby", "security", "aam",
                         "disaster", "survey", "industry"]);
  const newsy = items.filter((it) => NEWSY.has(it.category));
  /* Twelve hours first, then a day, then three.

     It was a day, widening to three. A day is a long time on a board that
     turns over every three minutes — and with the decay above, the tail of it
     could not win a slot anyway. Starting narrow keeps the candidate pool made
     of things that actually happened today. */
  let fresh = newsy.filter((it) => now - it.published < 12 * 3600);
  if (fresh.length < LED_WINDOW * 2) {
    fresh = newsy.filter((it) => now - it.published < 86400);
  }
  if (fresh.length < LED_WINDOW) {
    fresh = newsy.filter((it) => now - it.published < 3 * 86400);
  }
  const ranked = [...fresh].sort((a, b) => score(b) - score(a));

  // Collapse duplicate coverage into one entry per story, then keep a deep
  // candidate list — the board rotates through it so the same few headlines
  // do not cycle past forever.
  const covered = new Set();
  const candidates = [];
  for (const it of ranked) {
    if (covered.has(it.id)) continue;
    if (candidates.length >= LED_POOL) break;
    candidates.push(it);
    covered.add(it.id);
    for (const r of it.related || []) covered.add(r);
  }

  let pool = candidates;
  if (candidates.length > LED_WINDOW) {
    const start = (S.ledOffset * LED_WINDOW) % candidates.length;
    pool = [];
    for (let i = 0; i < LED_WINDOW; i++) {
      pool.push(candidates[(start + i) % candidates.length]);
    }
  }
  pool = pool.slice(0, Math.max(LED_MIN, Math.min(LED_WINDOW, pool.length)));

  board.classList.toggle("empty", pool.length === 0);
  track.innerHTML = "";
  track.style.animation = "";
  if (!pool.length) return;

  const build = (it, i) => {
    const item = el("span", "led-item" + (it.flagship > 0 ? " hot" : ""));
    item.append(el("span", "led-rank", it.flagship > 0 ? "重要" : `${i + 1}`));
    if (it.country && it.country !== "JP") {
      item.append(el("span", "led-meta", `[${it.country_ja || it.country}]`));
    }
    item.append(document.createTextNode(shortTitle(it.title_ja || it.title, 34)));
    const bits = [it.publisher || it.source, ago(it.published)];
    if ((it.cluster || 1) > 1) bits.push(`${it.cluster}媒体`);
    item.append(el("span", "led-meta", bits.join(" · ")));
    item.onclick = () => window.open(it.url, "_blank", "noopener");
    return item;
  };

  // Two identical passes: the keyframe shifts by exactly -50%, so the second
  // copy is already in place when the first scrolls off and the seam is
  // invisible. Duration follows the content width to keep the speed constant.
  for (let pass = 0; pass < 2; pass++) {
    pool.forEach((it, i) => {
      track.append(build(it, i));
      track.append(el("span", "led-sep", "◆"));
    });
  }
  // Measure synchronously rather than in requestAnimationFrame: rAF is
  // throttled while the window is backgrounded, which left the board with the
  // stylesheet's 0s duration and no motion at all.
  const half = track.scrollWidth / 2;
  if (half) {
    track.style.animationDuration = `${Math.max(18, half / LED_SPEED)}s`;
    track.style.animationName = "led-scroll";
  }
}

/* --------------------------------------------------------------- the map */

// The board only ever moves left, which is no help when the headline you
// wanted has just gone past the edge. Dragging scrubs the strip by hand and
// hands it back to the CSS animation wherever you let go.
function setupLedDrag() {
  const win = document.querySelector(".led-window");
  const track = $("#led-track");
  if (!win || !track) return;
  let dragging = false, startX = 0, startPos = 0, moved = 0, half = 0;

  // The keyframe shifts by a percentage of the track, so the pixel position
  // has to be read back off the live transform rather than tracked by hand.
  const currentPos = () => new DOMMatrix(getComputedStyle(track).transform).m41;
  // The track is two identical copies, so any offset folded into one copy's
  // width shows exactly the same thing — which is what lets the drag run
  // forever in either direction without hitting an end.
  const wrap = (x) => (half ? -((((-x) % half) + half) % half) : x);

  win.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    half = track.scrollWidth / 2;
    if (!half) return;
    dragging = true; moved = 0;
    startX = e.clientX;
    startPos = currentPos();
    // Taking the animation off entirely, not pausing it: a running animation
    // outranks inline styles in the cascade, so while it was merely paused the
    // transform written below was computed and then thrown away.
    track.style.animationName = "none";
    track.style.transform = `translateX(${startPos.toFixed(1)}px)`;
    win.setPointerCapture(e.pointerId);
    win.classList.add("dragging");
  });

  win.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    moved = Math.max(moved, Math.abs(dx));
    track.style.transform = `translateX(${wrap(startPos + dx).toFixed(1)}px)`;
  });

  const release = (e) => {
    if (!dragging) return;
    dragging = false;
    win.classList.remove("dragging");
    if (win.hasPointerCapture?.(e.pointerId)) win.releasePointerCapture(e.pointerId);
    const pos = wrap(currentPos());
    const dur = parseFloat(track.style.animationDuration) || 0;
    track.style.transform = "";
    if (!dur) { track.style.animationName = "led-scroll"; return; }
    // The animation is already off, so it starts from scratch when the name
    // goes back on — which is what makes the delay absolute rather than a
    // nudge applied to something already in flight.
    void track.offsetWidth;
    track.style.animationDelay = `${(pos / half * dur).toFixed(3)}s`;
    track.style.animationName = "led-scroll";
  };
  win.addEventListener("pointerup", release);
  win.addEventListener("pointercancel", release);
  // A drag that happens to finish on a headline must not also open it.
  win.addEventListener("click", (e) => {
    if (moved > 4) { e.stopPropagation(); e.preventDefault(); }
    moved = 0;
  }, true);
}

/* ------------------------------------------------------------- calendar */

export { GENRE_ROTATE_MS, LEAD_PAGE_MS, LED_MIN, LED_POOL, LED_ROTATE_MS, LED_SPEED, LED_WINDOW, renderHighlights, setupLedDrag };
