/* HTTP for the collector.

   In a WebView, plain fetch cannot reach other origins — CORS forbids it. On
   iOS and Android, Capacitor patches fetch to go through the native HTTP stack
   instead, where CORS does not apply. So this file makes no special
   arrangements: it calls fetch and lets the host decide how that is answered.
   The one thing it must not do is assume a same-origin server exists. */

export const HEADERS = {
  // Some feeds serve a mobile stub or refuse outright without this.
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
};

export function now() {
  return Math.floor(Date.now() / 1000);
}

export class FetchError extends Error {}

async function request(url, { timeout = 20000, accept } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const headers = { ...HEADERS };
    if (accept) headers.Accept = accept;
    const r = await fetch(url, { headers, signal: ctl.signal, redirect: "follow" });
    if (!r.ok) throw new FetchError(`HTTP ${r.status}`);
    return r;
  } catch (e) {
    if (e.name === "AbortError") throw new FetchError("timeout");
    throw e instanceof FetchError ? e : new FetchError(String(e.message || e));
  } finally {
    clearTimeout(timer);
  }
}

export async function httpText(url, opts) {
  const r = await request(url, opts);
  return { text: await r.text(), url: r.url || url };
}

export async function httpJson(url, opts) {
  const r = await request(url, { accept: "application/json", ...opts });
  return r.json();
}

// Resolve a possibly-relative URL the way the browser would.
export function absolute(href, base) {
  try { return new URL(href, base).href; } catch { return href; }
}
