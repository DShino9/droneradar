/* Which DroneRadar is this — the Mac app, or the published page?

   The same web/ is served both ways. DroneRadar.app answers /api/* live; on
   GitHub Pages the identical files sit next to api/*.json, frozen by the
   hourly Actions run. Rather than maintain two front ends, the page asks once
   at boot which one it is talking to and routes every read accordingly.

   Asking rather than reading the hostname: the Mac app is reached under
   several names (loopback, the Bonjour name, the LAN address) and the
   published copy could move, so a rule written over hostnames is one that
   breaks silently the first time either does. A 404 is unambiguous.

   AbortController does not cut a fetch in this environment, so every deadline
   here is a race against a timer.

   When the probe cannot decide, it assumes static. That way the failure is a
   page that reads but does not write; assuming live on a static host would
   leave the buttons looking alive and do nothing when pressed. */

const STATIC_FILE = {
  "/api/state": "./api/state.json",
  "/api/status": "./api/status.json",
  "/api/social": "./api/social.json",
  "/api/stocks": "./api/stocks.json",
};

let live = false;
let settled = null;

function withDeadline(promise, ms) {
  let timer;
  const clock = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([promise, clock]).finally(() => clearTimeout(timer));
}

async function resolveMode() {
  if (settled) return settled;
  settled = (async () => {
    try {
      const r = await withDeadline(fetch("/api/status", { cache: "no-cache" }), 4000);
      live = r.ok;
    } catch (e) {
      live = false;
    }
    // Everything that only makes sense against a live server is hidden by
    // this one class, in style.css, rather than by each module remembering.
    document.body.classList.toggle("readonly", !live);
    return live;
  })();
  return settled;
}

const isLive = () => live;
const staticFile = (path) => STATIC_FILE[path] || null;

export { isLive, resolveMode, staticFile, withDeadline };
