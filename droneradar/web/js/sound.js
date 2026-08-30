// A refresh that silently swaps 800 cards is indistinguishable from nothing
// happening, so surface the count and offer to jump to the top.
// The new-articles ping. This is a real recording of an active sonar rather
// than anything synthesised: 1040Hz, one strike lifted out of a 32-second
// field recording by Joseph SARDIN, released CC0. Every attempt at building
// one from oscillators landed somewhere else — a string, a bamboo block, a
// tubular bell — because the character of a sonar return is in the water, and
// the water is not something a partial stack reproduces.
let audioCtx = null;

let pingBuffer = null;

let pingLoading = false;

function loadPing() {
  if (pingBuffer || pingLoading || !audioCtx) return;
  pingLoading = true;
  fetch("./sonar-ping.m4a")
    .then((r) => r.arrayBuffer())
    .then((b) => audioCtx.decodeAudioData(b))
    .then((buf) => { pingBuffer = buf; })
    .catch(() => { pingLoading = false; });
}

function sonarPing() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    // Browsers hold the context suspended until the page has been interacted
    // with. Nothing to do but skip the ping until then.
    if (audioCtx.state !== "running") { audioCtx.resume(); return; }
    if (!pingBuffer) { loadPing(); return; }

    const t0 = audioCtx.currentTime;
    // A refresh the reader asked for and the status poll that notices the same
    // collection can both land inside a second, and the two pings overlapped
    // into what sounded like one ragged double strike.
    if (sonarPing.last && t0 - sonarPing.last < 5) return;
    sonarPing.last = t0;

    const src = audioCtx.createBufferSource();
    src.buffer = pingBuffer;
    const gain = audioCtx.createGain();
    gain.gain.value = 0.7;
    src.connect(gain);
    gain.connect(audioCtx.destination);
    src.start(t0);
    src.onended = () => { try { gain.disconnect(); } catch (_) {} };
  } catch (_) { /* audio is a nicety; never let it break a render */ }
}

export { audioCtx, loadPing, pingBuffer, pingLoading, sonarPing };
