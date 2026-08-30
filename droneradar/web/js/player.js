import { $, S, el } from "./state.js";
import { ago, proxied, shortTitle } from "./util.js";
import { playerSrc, videoId } from "./cards.js";

// The iframe is a fixed element in the page. Re-creating or re-parenting one
// makes the browser reload it, which is why autoplay never survived a render;
// here the src is written once and then only when the viewer picks a clip.
function renderPlayer() {
  const frame = $("#player");
  if (!frame) return;
  const vids = S.items
    .filter((i) => i.category === "video" && videoId(i.url))
    .sort((a, b) => b.published - a.published);
  if (!vids.length) return;

  // Interleave channels so one prolific uploader cannot fill the queue, then
  // start from a rotating offset — always taking the newest 25 in order meant
  // the same handful of clips played every session and after every reload.
  const byChannel = new Map();
  for (const v of vids) {
    const k = (v.author || v.source || "?").toLowerCase();
    if (!byChannel.has(k)) byChannel.set(k, []);
    byChannel.get(k).push(v);
  }
  const lists = [...byChannel.values()];
  const spread = [];
  for (let i = 0; lists.some((l) => l.length > i); i++) {
    for (const l of lists) if (l[i]) spread.push(l[i]);
  }
  const allIds = spread.map((v) => videoId(v.url))
    .filter((id) => id && !S.badVideos.has(id));
  const cursor = allIds.length ? (S.videoCursor % allIds.length) : 0;
  localStorage.setItem("dr.videoCursor", String(S.videoCursor + 5));
  const ids = allIds.slice(cursor).concat(allIds.slice(0, cursor)).slice(0, 25);

  if (!S.videoQueue) S.videoQueue = ids;
  if (!frame.src) frame.src = playerSrc(S.videoQueue, true);

  const currentId = S.playingId || S.videoQueue[0];
  const current = vids.find((v) => videoId(v.url) === currentId);
  $("#player-now").textContent = current
    ? shortTitle(current.title_ja || current.title, 44) : "";
  $("#player-count").textContent = `${vids.length}件`;

  attachPlayerApi();

  const queue = $("#player-queue");
  queue.innerHTML = "";
  // Just the one that plays next. Two was already a compromise against an
   // unbounded list; the row below is where the reading happens, and every
   // line here is a line it does not get.
  const room = 1;
  const rest = vids.filter((v) => {
    const id = videoId(v.url);
    return id !== currentId && !S.badVideos.has(id);
  });
  const start = rest.length ? (S.videoPeek % rest.length) : 0;
  const upcoming = Array.from({ length: Math.min(room, rest.length) },
                              (_, i) => rest[(start + i) % rest.length]);
  for (const v of upcoming) {
    const item = el("div", "qitem");
    if (v.image) {
      const img = el("img");
      img.loading = "lazy"; img.alt = ""; img.src = proxied(v.image);
      item.append(img);
    } else {
      item.append(el("div"));
    }
    const body = el("div");
    body.append(el("div", "qt", shortTitle(v.title_ja || v.title, 32)));
    const who = (v.author || v.source || "").replace(/https?:\/\/\S+/g, "").trim();
    body.append(el("div", "qm", `${who}　${ago(v.published)}`));
    item.append(body);
    item.title = v.title_ja || v.title;
    item.onclick = () => {
      const id = videoId(v.url);
      const idx = ids.indexOf(id);
      S.videoQueue = idx >= 0 ? ids.slice(idx).concat(ids.slice(0, idx)) : [id, ...ids];
      S.playingId = id;
      S.ytPlayer = null;                 // the iframe is replaced below
      frame.src = playerSrc(S.videoQueue, true);
      renderPlayer();
    };
    queue.append(item);
  }
}

// The embed advances by itself through the playlist, so the only way to label
// what is on screen is to ask the IFrame API which video it switched to.
function attachPlayerApi() {
  if (S.ytPlayer || !window.YT || !window.YT.Player) return;
  const frame = $("#player");
  if (!frame || !frame.src) return;
  try {
    S.playerSince = Date.now();
    S.ytPlayer = new window.YT.Player("player", {
      events: {
        onStateChange: syncPlayingId,
        onReady: syncPlayingId,
        // Some uploads forbid embedding (error 101/150) and simply stop the
        // chain with "この動画は再生できません"; skip past those.
        onError: handlePlayerError,
      },
    });
  } catch (e) {
    S.ytPlayer = null;
  }
}

// Videos that refuse to embed, remembered so they are never queued again.
function blockVideo(id) {
  if (!id) return;
  S.badVideos.add(id);
  try {
    localStorage.setItem("dr.badVideos", JSON.stringify([...S.badVideos].slice(-300)));
  } catch (e) { /* storage full or disabled; the in-memory set still helps */ }
}

function handlePlayerError(e) {
  const code = e && e.data;
  // Ask the player which clip it is actually on. S.playingId lags by up to one
  // poll, and blocking the wrong id leaves the bad one in the queue forever.
  let id = null;
  try { id = (S.ytPlayer.getVideoData() || {}).video_id || null; } catch (_) {}
  id = id || S.playingId || (S.videoQueue || [])[0];
  // 101 and 150 are "embedding disabled by the uploader"; 100 is removed or
  // private; 2 and 5 are malformed / unplayable here.
  if ([2, 5, 100, 101, 150].includes(code)) blockVideo(id);

  const rest = (S.videoQueue || []).filter((v) => v !== id && !S.badVideos.has(v));
  const frame = $("#player");
  if (!frame) return;
  S.videoQueue = rest;
  S.playingId = null;
  S.ytPlayer = null;
  S.playerSince = 0;
  if (rest.length) {
    frame.src = playerSrc(rest, true);
  } else {
    // Nothing left in this run; take the next slice.
    S.videoCursor += 5;
    frame.src = "";
  }
  renderPlayer();
}

// onError does not always fire. A clip that is private, region-locked or
// pulled mid-playlist can leave the frame showing "動画を再生できません" with the
// player simply sitting in the unstarted state, and the chain stops there.
// Watching for that state is the only way to catch it.
function watchPlayerStall() {
  const p = S.ytPlayer;
  if (!p) { watchPlayerStall.since = 0; return; }
  // A YT.Player only grows its methods once the embed reports ready, and an
  // unplayable video never reports at all — so the object exists, getPlayerState
  // does not, and the old guard returned here every time and never counted.
  // That silent case is exactly the one that leaves 動画を再生できません on screen.
  if (!p.getPlayerState) {
    if (S.playerSince && Date.now() - S.playerSince > 12000) {
      watchPlayerStall.since = 0;
      handlePlayerError({ data: 150 });
    }
    return;
  }
  let st;
  try { st = p.getPlayerState(); } catch (_) { return; }
  // A player can also report PLAYING while showing nothing at all — a blank
  // white frame where the video should be. The state is no help there, so the
  // clock is: if it says it is playing and the position has not moved in ten
  // seconds, it is not playing.
  if (st === 1) {
    watchPlayerStall.since = 0;
    let t = null;
    try { t = p.getCurrentTime(); } catch (_) { return; }
    if (t == null) return;
    if (watchPlayerStall.at != null && Math.abs(t - watchPlayerStall.at) < 0.25) {
      watchPlayerStall.stuck = (watchPlayerStall.stuck || 0) + 1;
      // Polled every 3s, so four strikes is about twelve seconds of a still
      // picture — long enough not to fire on a slow network.
      if (watchPlayerStall.stuck >= 4) {
        watchPlayerStall.stuck = 0;
        watchPlayerStall.at = null;
        handlePlayerError({ data: 150 });
      }
    } else {
      watchPlayerStall.stuck = 0;
    }
    watchPlayerStall.at = t;
    return;
  }
  watchPlayerStall.at = null;
  watchPlayerStall.stuck = 0;

  /* Ended is not fine.

     It was treated as fine, on the reasoning that the embed advances through
     its own playlist. It does — until the last clip, where YouTube stops and
     puts up its replay button and a grid of suggestions, and nothing is ever
     going to move it on. The frame then sat at 4:21 / 4:21 indefinitely.

     Paused stays fine: that one is the reader's own doing. */
  if (st === 0) {
    if (!watchPlayerStall.ended) { watchPlayerStall.ended = Date.now(); return; }
    // A couple of seconds, in case the embed is only between clips.
    if (Date.now() - watchPlayerStall.ended < 2500) return;
    watchPlayerStall.ended = 0;
    nextRun();
    return;
  }
  watchPlayerStall.ended = 0;

  // -1 unstarted, 5 cued. Paused and buffering are fine — paused especially,
  // since that may well be the reader's own doing.
  if (st !== -1 && st !== 5) { watchPlayerStall.since = 0; return; }
  const now = Date.now();
  if (!watchPlayerStall.since) { watchPlayerStall.since = now; return; }
  if (now - watchPlayerStall.since < 9000) return;
  watchPlayerStall.since = 0;
  handlePlayerError({ data: 150 });
}

/* Hand the embed a fresh run of clips.

   Used when the playlist has come back round to its first clip, and when it
   has simply stopped at the end of the last one. */
function nextRun() {
  S.videoCursor += (S.videoQueue || []).length;
  S.videoQueue = null;
  S.videoPlayed = 0;
  S.ytPlayer = null;
  const frame = $("#player");
  if (frame) frame.src = "";
  renderPlayer();
}

function syncPlayingId() {
  const p = S.ytPlayer;
  if (!p || !p.getVideoData) return;
  let id = null;
  try {
    id = (p.getVideoData() || {}).video_id;
  } catch (e) {
    return;
  }
  if (!id || id === S.playingId) return;
  S.playingId = id;
  S.videoPeek += 1;      // move the up-next list along with the player

  // When the embed reaches the end of its playlist it loops back to the first
  // clip. Advance the cursor and hand it a fresh run instead of replaying.
  const q = S.videoQueue || [];
  if (q.length && id === q[0] && S.videoPlayed > 0) { nextRun(); return; }
  S.videoPlayed += 1;
  renderPlayer();
}

/* --------------------------------------------------------------- ticker */

export { attachPlayerApi, blockVideo, handlePlayerError, renderPlayer, syncPlayingId, watchPlayerStall };
