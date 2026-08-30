import { now } from "./net.js";

/* How many outlets covered the same story.

   The same drone strike arrives from eight publications within an hour, and
   without this the headline board shows it eight times. */

const NOISE_RE = /[\s　「」『』【】、。,.\-—―–:：･・|｜()（）[\]"'!？?]+/g;
const STOP = new Set(["ドローン", "drone", "the", "for", "and", "with",
                      "を", "が", "の", "に", "は"]);

export function keyset(title) {
  const t = title.toLowerCase().replace(NOISE_RE, " ");
  let toks;
  if (/[぀-ゟ゠-ヿ一-鿿]/.test(t)) {
    // Character bigrams work far better than whitespace splitting for Japanese.
    const compact = t.replace(/ /g, "");
    toks = new Set();
    for (let i = 0; i < compact.length - 1; i++) toks.add(compact.slice(i, i + 2));
  } else {
    toks = new Set(t.split(/\s+/).filter((w) => w.length > 2));
  }
  for (const s of STOP) toks.delete(s);
  return toks;
}

function shared(a, b) {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

export function cluster(items) {
  const t = now();
  const recent = items
    .filter((it) => t - it.published < 3 * 86400)
    .sort((a, b) => b.published - a.published)
    .slice(0, 400);
  const keys = recent.map((it) => [it, keyset(it.title)]);
  for (const it of items) { it.cluster = 1; it.related = []; }

  // Short titles ("Help me out!") reduce to two tokens, and a single shared
  // word would then clear any ratio threshold — so require a substantial
  // keyset, score against the larger one, and demand real overlap.
  const MIN_KEYS = 4, MIN_SHARED = 3, RATIO = 0.4;
  for (let i = 0; i < keys.length; i++) {
    const [a, ka] = keys[i];
    if (ka.size < MIN_KEYS) continue;
    const outlets = new Set([a.source_id]);
    const related = [];
    for (let j = 0; j < keys.length; j++) {
      if (i === j) continue;
      const [b, kb] = keys[j];
      if (kb.size < MIN_KEYS) continue;
      const s = shared(ka, kb);
      if (s >= MIN_SHARED && s / Math.max(ka.size, kb.size) >= RATIO) {
        outlets.add(b.source_id);
        related.push(b.id);
      }
    }
    a.cluster = outlets.size;
    a.related = related.slice(0, 6);
    if (outlets.size >= 2) {
      a.importance = Math.min(100, a.importance + 8 * (outlets.size - 1));
    }
  }

  // Google News items carry no image and their links cannot be resolved, but
  // the same story often arrives through a direct feed that does have one.
  const byId = new Map(items.map((it) => [it.id, it]));
  for (const it of recent) {
    if (it.image) continue;
    for (const rid of it.related || []) {
      const twin = byId.get(rid);
      if (twin && twin.image) { it.image = twin.image; break; }
    }
  }
}
