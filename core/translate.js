import { httpJson, FetchError } from "./net.js";
import { itemId } from "./normalise.js";

/* English → Japanese for titles and summaries.

   Google's keyless translate_a endpoint, with MyMemory as a backup. Every
   result is cached by content, so a given headline is only ever paid for once
   and a steady-state run translates just the handful of new items.

   One request per text on purpose: the endpoint ignores repeated `q`
   parameters and joining texts with newlines lets the line count drift, which
   silently misaligns translations with their articles. */

const GOOGLE = "https://translate.googleapis.com/translate_a/single";
const MYMEMORY = "https://api.mymemory.translated.net/get";

export const keyOf = (text) => itemId(text);

async function google(text) {
  const url = `${GOOGLE}?client=gtx&sl=auto&tl=ja&dt=t&q=${encodeURIComponent(text)}`;
  const data = await httpJson(url, { timeout: 15000 });
  const segments = data[0] || [];
  return segments.map((s) => (s && s[0]) || "").join("").trim();
}

async function mymemory(text) {
  const url = `${MYMEMORY}?q=${encodeURIComponent(text.slice(0, 480))}&langpair=en|ja`;
  const data = await httpJson(url, { timeout: 15000 });
  if (String(data.responseStatus) !== "200") {
    throw new FetchError("mymemory " + data.responseStatus);
  }
  return ((data.responseData || {}).translatedText || "").trim();
}

export async function translateOne(text) {
  for (const fn of [google, mymemory]) {
    try {
      const out = await fn(text);
      // A translation identical to the input means nothing happened; treating
      // it as a miss keeps a useless entry out of the cache forever.
      if (out && out !== text) return out;
    } catch { /* try the next one */ }
  }
  return "";
}

// Fills `cache` in place and returns {text: 訳}. `budget` caps how many new
// requests one run may make.
export async function translateTexts(texts, cache, { budget = 400, workers = 5 } = {}) {
  const out = {};
  const todo = [];
  for (let t of texts) {
    t = (t || "").trim();
    if (!t) continue;
    const k = keyOf(t);
    if (cache[k]) { out[t] = cache[k]; continue; }
    if (!todo.includes(t)) todo.push(t);
  }
  const queue = todo.slice(0, budget);
  let spent = 0, at = 0;
  async function worker() {
    while (at < queue.length) {
      const text = queue[at++];
      const got = await translateOne(text);
      if (got) { cache[keyOf(text)] = got; out[text] = got; spent++; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, queue.length) }, worker));
  return { done: out, spent };
}

// Keep the cache from growing without bound.
export function trimCache(cache, limit = 6000) {
  const keys = Object.keys(cache);
  if (keys.length <= limit) return cache;
  const out = {};
  for (const k of keys.slice(-limit)) out[k] = cache[k];
  return out;
}
