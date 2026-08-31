import { $, COUNTRY_JA, PREF_BY_CODE, S, hooks, setGroupResolver } from "./state.js";
import { toast, visibleItems } from "./util.js";
import { api, load, loadSocial, loadStocks, pollStatus } from "./api.js";
import { isLive, resolveMode } from "./mode.js";
import { renderSidebar } from "./sidebar.js";
import { GENRE_ROTATE_MS, LEAD_PAGE_MS, LED_ROTATE_MS, renderHighlights, setupLedDrag } from "./ledboard.js";
import { SPOTLIGHT_MS, renderMap, spotlight } from "./maps.js";
import { renderCalendar, setupCalendarPager } from "./calendar.js";
import { renderRadar } from "./radar.js";
import { renderCards } from "./cards.js";
import { audioCtx, loadPing } from "./sound.js";
import { renderPlayer, syncPlayingId, watchPlayerStall } from "./player.js";
import { renderTicker } from "./ticker.js";
import { renderStocks } from "./stocks.js";
import { renderRising } from "./rising.js";
import { renderSources } from "./sources.js";
import { setup as setupRemote } from "./remote.js";
import { groupOf } from "./genre.js";

// Category colour is resolved by group; state.js is the leaf module every
// other one imports, so it cannot reach genre.js itself.
setGroupResolver(groupOf);

hooks.renderAll = () => renderAll();

function renderAll() {
  const isSources = S.filter.view === "sources";
  $("#view-feed").classList.toggle("hidden", isSources);
  $("#view-sources").classList.toggle("hidden", !isSources);
  renderSidebar();
  renderRising();
  if (isSources) { renderSources(); return; }

  const items = visibleItems(false);
  // The bar chart is the control for the day filter, so it must keep showing
  // every day — otherwise selecting one collapses the chart to a single bar.
  // The board takes everything collected, not the current filter. Picking a
  // genre the board does not carry — 開発・OSS, 研究・論文 — left it with an
  // empty pool and it vanished off the top of the screen.
  renderHighlights(S.items);
  renderPlayer();
  renderMap(items, "jp");
  renderMap(items, "world");
  // The calendar wants everything that was collected, not the current filter:
  // narrowing to one prefecture should not empty next month.
  renderCalendar(S.items);
  renderRadar(items);
  renderCards(items);
}

/* ------------------------------------------------------------------ load */

// The sticky columns are positioned under the topbar, so they need its real
// height rather than a number baked into the stylesheet — bigger type made the
// bar 55px and everything below it hung 4px off the bottom of the screen.
function syncTopbarHeight() {
  const bar = document.querySelector(".topbar");
  if (!bar) return;
  const h = Math.round(bar.getBoundingClientRect().height);
  if (h > 0) document.documentElement.style.setProperty("--topbar", h + "px");
}

function wire() {
  // Arrow keys, Enter and Escape drive the whole dashboard without a pointer.
  // Identical on every platform, so the desktop build tests the TV build.
  setupRemote();
  // Audio needs a gesture before it will start; take the first one that comes.
  const armAudio = () => {
    if (audioCtx) audioCtx.resume();
    else {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    // Fetch and decode now rather than on the first arrival, which would
    // otherwise be silent while the file came off disk.
    loadPing();
  };
  addEventListener("pointerdown", armAudio, { once: true });
  addEventListener("keydown", armAudio, { once: true });

  syncTopbarHeight();
  window.addEventListener("resize", syncTopbarHeight);
  setupLedDrag();
  setupCalendarPager();
  $("#search").oninput = (e) => { S.filter.q = e.target.value; S.limit = 40; renderAll(); };

  $("#range-seg").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    [...e.currentTarget.children].forEach((c) => c.classList.toggle("on", c === b));
    S.filter.days = Number(b.dataset.range); S.limit = 40; renderAll();
  };
  $("#lang-seg").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    [...e.currentTarget.children].forEach((c) => c.classList.toggle("on", c === b));
    S.filter.lang = b.dataset.lang; S.limit = 40; renderAll();
  };
  $("#net-seg").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    [...e.currentTarget.children].forEach((c) => c.classList.toggle("on", c === b));
    renderTicker();
  };
  const graphics = $("#graphics"), gToggle = $("#graphics-toggle");
  /* The label names what the button controls and lights up when it is on.

     It used to say "グラフを隠す", which was wrong twice: the row holds two
     maps and the video player and not one graph, so nobody looking for the
     maps would think to press it — and it was phrased as an action while the
     button beside it was phrased as a state. */
  const applyGraphics = (shown) => {
    graphics.classList.toggle("hidden", !shown);
    // On a phone the visuals are put away by the stylesheet, not by this
    // class, so the switch has to say so on the body for that rule to lift.
    // Same switch, same meaning, in the one place a phone has room to obey it.
    document.body.classList.toggle("show-visuals", shown);
    gToggle.classList.toggle("on", shown);
    gToggle.setAttribute("aria-pressed", String(shown));
    localStorage.setItem("dr.graphics", shown ? "1" : "0");
  };
  applyGraphics(localStorage.getItem("dr.graphics") !== "0");

  gToggle.onclick = () => {
    const shown = graphics.classList.contains("hidden");
    applyGraphics(shown);
    if (shown) renderAll();
  };

  const gt = $("#group-toggle");
  S.grouped = localStorage.getItem("dr.grouped") !== "0";
  const paintGroup = () => {
    // The name of the mode it turns on, not of the mode you are in — the same
    // reading as the button next to it.
    gt.textContent = "分類ごと";
    gt.classList.toggle("on", S.grouped);
    gt.setAttribute("aria-pressed", String(S.grouped));
  };
  paintGroup();
  gt.onclick = () => {
    S.grouped = !S.grouped;
    localStorage.setItem("dr.grouped", S.grouped ? "1" : "0");
    S.groupLimits = {};
    paintGroup();
    renderAll();
  };

  $("#img-only").onclick = (e) => {
    S.filter.imgOnly = !S.filter.imgOnly;
    e.currentTarget.classList.toggle("on", S.filter.imgOnly);
    e.currentTarget.setAttribute("aria-pressed", String(S.filter.imgOnly));
    S.limit = 40; renderAll();
  };
  $("#sort").onchange = (e) => { S.filter.sort = e.target.value; renderAll(); };
  $("#more").onclick = () => { S.limit += 40; renderAll(); };
  $("#clear-filters").onclick = () => {
    Object.assign(S.filter, { bucket: "all", cat: null, group: null, pref: null, country: null,
                              scope: null, q: "", day: null });
    $("#search").value = ""; S.limit = 40; renderAll();
  };
  $("#refresh").onclick = async () => {
    $("#live-dot").classList.add("busy");
    $("#refresh").classList.add("busy");
    $("#updated").textContent = "収集中…";
    await api("/api/refresh", { what: "articles" });
    await api("/api/refresh", { what: "social" });
    await api("/api/refresh", { what: "stocks" });
    toast("収集を開始しました");
  };
}

/* How often to go back for data.

   Against the Mac these are conversation: a run finishes and the page should
   notice within seconds. Against the published copy they are the opposite —
   the collector runs once an hour in Actions, so a five-second poll is 720
   requests to learn nothing. The status file is still polled often enough
   that a run lands on an open page within a few minutes. */
const LIVE_POLL = { status: 5000, social: 20000, stocks: 60000 };
const STATIC_POLL = { status: 300000, social: 900000, stocks: 900000 };

async function boot() {
  // Decide which server we are talking to before anything asks it for data,
  // and before the first render — proxied() reads the answer synchronously.
  await resolveMode();
  wire();
  const [jp, world] = await Promise.all([
    fetch("./japan.json").then((r) => r.json()),
    fetch("./world.json").then((r) => r.json()).catch(() => null),
  ]);
  S.map = jp;
  S.world = world;
  for (const p of S.map.prefectures) PREF_BY_CODE[p.code] = p.name;
  for (const c of (world && world.countries) || []) COUNTRY_JA[c.iso] = c.ja || c.en;
  await load();
  await loadSocial();
  await loadStocks();
  setInterval(() => {
    // Advancing the window restarts the CSS animation, so hold off while the
    // pointer is on the board (which is also when it is paused for reading).
    if ($("#highlights").matches(":hover")) return;
    S.ledOffset += 1;
    if (S.filter.view === "feed") renderHighlights(S.items);
  }, LED_ROTATE_MS);
  setInterval(() => {
    // Flip to the next genre unless the reader pinned one or is reading a row.
    if (S.genrePinned || !S.grouped || S.filter.cat) return;
    if (S.filter.view !== "feed" || !S.genreKeys.length) return;
    if ($("#cards").matches(":hover")) return;
    S.genreIndex = (S.genreIndex + 1) % S.genreKeys.length;
    renderCards(visibleItems(false));
  }, GENRE_ROTATE_MS);
  // The headline pane is fixed to one category, so it cannot rotate the way
  // the genre slot does — it pages sideways through its own columns instead,
  // and starts over once it reaches the end.
  setInterval(() => {
    if (S.filter.view !== "feed" || !S.grouped || S.filter.cat) return;
    const strip = document.querySelector(".news-split > .cat-row:not(.genre-slot) .row-strip");
    if (!strip || strip.matches(":hover")) return;
    const max = strip.scrollWidth - strip.clientWidth;
    if (max <= 4) return;
    /* Page by where the columns actually are, not by the width of the window
       onto them.

       The columns are the full width of the strip and there is an 8px gap
       between them, so advancing by clientWidth lands eight pixels short of
       the next one — and the error accumulates, until the strip is parked
       across the join with half a headline showing on either side. */
    const cols = [...strip.querySelectorAll(".row-col")];
    const base = cols.length ? cols[0].offsetLeft : 0;
    const at = strip.scrollLeft;
    const next = cols.map((c) => c.offsetLeft - base).find((x) => x > at + 4);
    // `max` is a valid position, not one past the end: the last column starts
    // exactly there. Treating it as overshoot sent every turn back to the
    // first column, so the strip never moved at all.
    strip.scrollTo({ left: next == null || next > max + 2 ? 0 : next, behavior: "smooth" });
  }, LEAD_PAGE_MS);

  // Alternate the spotlight between the two maps.
  let spotTurn = 0;
  setInterval(() => {
    if (S.filter.view !== "feed" || $("#graphics").classList.contains("hidden")) return;
    spotlight((spotTurn++ % 2) ? "world" : "jp");
  }, SPOTLIGHT_MS);

  // The API fires no event when the playlist rolls over on its own, so poll.
  setInterval(() => { syncPlayingId(); watchPlayerStall(); }, 3000);
  setInterval(() => {
    if ($("#player-queue").matches(":hover")) return;
    S.videoPeek += 1;
    renderPlayer();
  }, 9000);

  const poll = isLive() ? LIVE_POLL : STATIC_POLL;
  setInterval(loadSocial, poll.social);
  setInterval(loadStocks, poll.stocks);
  setInterval(() => {
    if ($("#stocks").matches(":hover")) return;
    S.stockPage += 1;
    renderStocks();
  }, 6000);
  setInterval(pollStatus, poll.status);
}

boot();

export { boot, renderAll, syncTopbarHeight, wire };
