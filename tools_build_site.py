#!/usr/bin/env python3
"""Freeze DroneRadar into a folder a static host can serve.

The front end is unchanged: `web/` is copied as-is, and the four read-only
endpoints it polls are written next to it as api/*.json. mode.js works out at
boot which of the two it is talking to (see js/mode.js), so one copy of the
code serves both the Mac app and the published page.

The service worker precaches the shell under a cache named for a hash of
`web/` — so a code change replaces it wholesale, and an hourly data run, which
changes no code, leaves it alone. Data is never precached; it is fetched
network-first and only falls back to the last copy when there is no network.
That split is the point: the shell should be instant and the data should be
true.
"""
import hashlib
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

WEB = os.path.join(HERE, "droneradar", "web")
OUT = os.path.join(HERE, "site")

# Big enough to be worth caching, small enough to be worth caching. items.json
# is a megabyte gzipped and changes every hour; it does not belong here.
SHELL_SUFFIXES = (".html", ".css", ".js", ".json", ".m4a", ".svg", ".png", ".webp")


def shell_files():
    out = []
    for root, dirs, names in os.walk(WEB):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for n in sorted(names):
            if n.startswith(".") or not n.endswith(SHELL_SUFFIXES):
                continue
            out.append(os.path.relpath(os.path.join(root, n), WEB).replace(os.sep, "/"))
    return sorted(out)


def shell_hash(files):
    h = hashlib.sha1()
    for rel in files:
        h.update(rel.encode("utf-8"))
        with open(os.path.join(WEB, rel), "rb") as f:
            h.update(f.read())
    return h.hexdigest()[:12]


SW = '''/* DroneRadar, offline.

   Two rules, because the page is two things at once.

   The shell — markup, styles, modules, the map outlines, the ping — is
   content-addressed: this cache is named for a hash of web/, so a deploy that
   changes any of it lands in a new cache and the old one is deleted on
   activate. Serving it cache-first is safe precisely because a changed file
   cannot land in the same cache.

   The data is the opposite. It is rewritten every hour and a dashboard
   showing yesterday without saying so is worse than one that spins, so
   api/*.json is network-first and only falls back to the stored copy when the
   network does not answer. GitHub Pages sends max-age=600 on everything, so
   the network attempt asks for a revalidation rather than accepting the
   browser's ten-minute-old copy.
*/
const CACHE = "droneradar-%(hash)s";
const SHELL = %(shell)s;

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // One at a time, tolerating failures: addAll rejects as a unit, so a
    // single 404 would leave the worker installed with nothing cached.
    await Promise.all(SHELL.map(async (url) => {
      try {
        const r = await fetch(url, { cache: "no-cache" });
        if (r.ok) await cache.put(url, r);
      } catch (err) { /* offline install; the fetch handler will fill it in */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith("droneradar-") && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // publisher images, YouTube

  if (url.pathname.includes("/api/")) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: "no-cache" });
        if (fresh.ok) (await caches.open(CACHE)).put(req, fresh.clone());
        return fresh;
      } catch (err) {
        const stored = await caches.match(req);
        if (stored) return stored;
        throw err;
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const stored = await caches.match(req);
    if (stored) return stored;
    const fresh = await fetch(req);
    if (fresh.ok) (await caches.open(CACHE)).put(req, fresh.clone());
    return fresh;
  })());
});
'''

REGISTER = '''<script>
/* Registered from the page rather than from a module so that an old browser
   that cannot parse the modules still gets the offline copy — and so that a
   failure here can never stop main.js from loading. */
if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
</script>
'''


def main():
    from droneradar import snapshot

    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    shutil.copytree(WEB, OUT, ignore=shutil.ignore_patterns(".*"))

    files = shell_files()
    digest = shell_hash(files)

    api_dir = os.path.join(OUT, "api")
    os.makedirs(api_dir, exist_ok=True)
    payloads = {
        "state.json": snapshot.state(),
        "status.json": snapshot.status(),
        "social.json": snapshot.social(),
        "stocks.json": snapshot.stocks(),
    }
    for name, payload in payloads.items():
        path = os.path.join(api_dir, name)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        print("%-14s %6d KB" % (name, os.path.getsize(path) // 1024))

    with open(os.path.join(OUT, "sw.js"), "w", encoding="utf-8") as f:
        f.write(SW % {"hash": digest,
                      "shell": json.dumps(["./"] + ["./" + p for p in files], indent=2)})

    index = os.path.join(OUT, "index.html")
    html = open(index, encoding="utf-8").read()
    html = html.replace("</body>", REGISTER + "</body>", 1)
    open(index, "w", encoding="utf-8").write(html)

    # Pages runs Jekyll unless told not to, which drops files it does not
    # recognise and costs a minute per deploy doing it.
    open(os.path.join(OUT, ".nojekyll"), "w").close()

    total = sum(os.path.getsize(os.path.join(r, n))
                for r, _, ns in os.walk(OUT) for n in ns)
    print("shell %s (%d files) · site %d KB" % (digest, len(files), total // 1024))


if __name__ == "__main__":
    main()
