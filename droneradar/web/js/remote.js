import { $ } from "./state.js";

/* Directional navigation for a TV remote.

   Fire TV has no pointer: a d-pad, a select button and a back button are the
   whole vocabulary. So the screen is navigated in two levels, which is the
   only arrangement that stays sane when a single row holds sixty headlines.

     level 1 — the tools. Left/right moves between the panels and the toolbar
               controls. Select enters the one you are on.
     level 2 — inside a panel. Up/down/left/right moves between its articles;
               select opens one; back leaves the panel and returns to level 1.

   Keyboard and remote are the same code deliberately: arrow keys, Enter and
   Escape behave identically on every platform, so the desktop build is the
   test bed for the TV build. */

// The tools, in the order the d-pad walks them. Each is a container whose
// focusable children become level 2.
const ZONES = [
  ["#nav-cats", ".nav-item"],
  ["#highlights", ".led-item"],
  [".map-panel", "#map-jp path"],
  [".world-panel", "#map-world path"],
  [".player-panel", ".video-queue .qitem, #player"],
  ["#cards", ".tile, .card"],
  [".cal-panel", ".cal-d.has, .cal-row"],
  [".radar-panel", "#radar .blip"],
  ["#ticker", ".post"],
  [".stock-panel", ".stock"],
];

const S = { level: 1, zone: 0, index: 0, on: false };

function zoneEl(i) {
  const z = ZONES[i];
  return z ? document.querySelector(z[0]) : null;
}

function items(i) {
  const el = zoneEl(i);
  if (!el) return [];
  return [...el.querySelectorAll(ZONES[i][1])].filter((n) => {
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

function clearMarks() {
  for (const n of document.querySelectorAll(".rc-zone, .rc-item")) {
    n.classList.remove("rc-zone", "rc-item");
  }
}

function paint() {
  clearMarks();
  if (!S.on) return;
  const z = zoneEl(S.zone);
  if (!z) return;
  if (S.level === 1) {
    z.classList.add("rc-zone");
    z.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return;
  }
  z.classList.add("rc-zone");
  const list = items(S.zone);
  const n = list[Math.min(S.index, list.length - 1)];
  if (n) {
    n.classList.add("rc-item");
    n.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }
}

// A zone with nothing in it must not swallow the focus.
function step(dir) {
  for (let i = 0; i < ZONES.length; i++) {
    S.zone = (S.zone + dir + ZONES.length) % ZONES.length;
    if (zoneEl(S.zone) && items(S.zone).length) return;
  }
}

// Inside a zone, up and down move by a visual row rather than by one item:
// the article grid is columns of five, so plain index arithmetic would walk
// sideways when the reader pressed down.
function rowStep(list, from, dir) {
  const cur = list[from].getBoundingClientRect();
  let best = -1, bestDist = Infinity;
  for (let i = 0; i < list.length; i++) {
    if (i === from) continue;
    const r = list[i].getBoundingClientRect();
    const dy = r.top - cur.top;
    if (dir > 0 ? dy <= 2 : dy >= -2) continue;
    const dist = Math.abs(dy) + Math.abs(r.left - cur.left) * 3;
    if (dist < bestDist) { bestDist = dist; best = i; }
  }
  return best;
}

function colStep(list, from, dir) {
  const cur = list[from].getBoundingClientRect();
  let best = -1, bestDist = Infinity;
  for (let i = 0; i < list.length; i++) {
    if (i === from) continue;
    const r = list[i].getBoundingClientRect();
    const dx = r.left - cur.left;
    if (dir > 0 ? dx <= 2 : dx >= -2) continue;
    const dist = Math.abs(dx) + Math.abs(r.top - cur.top) * 3;
    if (dist < bestDist) { bestDist = dist; best = i; }
  }
  return best;
}

function activate() {
  const list = items(S.zone);
  const n = list[S.index];
  if (!n) return;
  // Whatever the element already does on a click is what select should do.
  n.click();
}

export function handleKey(e) {
  const KEYS = {
    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
    Enter: "select", " ": "select",
    Escape: "back", Backspace: "back", GoBack: "back", BrowserBack: "back",
  };
  const act = KEYS[e.key];
  if (!act) return false;
  // Never steal the arrow keys from a text field.
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
    return false;
  }

  if (!S.on) {
    // The first press wakes the overlay rather than moving anything, so the
    // reader can see where focus landed before it starts jumping.
    if (act === "back") return false;
    S.on = true; S.level = 1; S.zone = 0; S.index = 0;
    if (!items(S.zone).length) step(1);
    paint();
    return true;
  }

  if (S.level === 1) {
    if (act === "left") step(-1);
    else if (act === "right") step(1);
    else if (act === "up") step(-1);
    else if (act === "down") step(1);
    else if (act === "select") { S.level = 2; S.index = 0; }
    else if (act === "back") { S.on = false; }
  } else {
    const list = items(S.zone);
    if (!list.length) { S.level = 1; }
    else if (act === "select") { activate(); }
    else if (act === "back") { S.level = 1; S.index = 0; }
    else {
      const move = (act === "up" || act === "down")
        ? rowStep(list, S.index, act === "down" ? 1 : -1)
        : colStep(list, S.index, act === "right" ? 1 : -1);
      if (move >= 0) S.index = move;
      else if (act === "left" || act === "right") {
        // Falling off the side of a panel steps to the next panel, which is
        // what a remote user expects when a row ends.
        S.level = 1;
        step(act === "right" ? 1 : -1);
      }
    }
  }
  paint();
  return true;
}

export function setup() {
  addEventListener("keydown", (e) => {
    if (handleKey(e)) { e.preventDefault(); e.stopPropagation(); }
  });
  // Touching the pointer puts the overlay away: it would otherwise sit there
  // highlighting something the reader is no longer looking at.
  addEventListener("pointerdown", () => {
    if (S.on) { S.on = false; clearMarks(); }
  });
  addEventListener("resize", paint);
}

export const state = S;
