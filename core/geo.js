/* Where an article is about.

   Built from the same gazetteer the Python side uses. The traps are the same
   too and are worth naming: インドネシア must be tried before インド or every
   Indonesian story becomes an Indian one; bare タイ and チリ are left out
   because they appear inside ordinary words; and 京都 must not fire on the
   tail of 東京都. Longest-first matching plus one lookbehind handles the last. */

let built = null;

function build(geo) {
  const prefName = {};
  for (const [code, name] of geo.prefectures) prefName[code] = name;

  // Longest first, so 東京都 wins over 京都 and 鹿児島 over 児島.
  const pats = [];
  for (const [code, name] of geo.prefectures) pats.push([code, name]);
  for (const [code, names] of Object.entries(geo.bare_safe)) {
    for (const n of names) if (n !== prefName[code]) pats.push([+code, n]);
  }
  for (const [code, names] of Object.entries(geo.places)) {
    for (const n of names) pats.push([+code, n]);
  }
  pats.sort((a, b) => b[1].length - a[1].length);

  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefRe = new RegExp(pats.map(([, p]) => `(${esc(p)})`).join("|"), "g");

  const cpats = [];
  const countryJa = {};
  for (const [iso, ja, names] of geo.countries) {
    countryJa[iso] = ja;
    for (const n of names) cpats.push([iso, n]);
  }
  cpats.sort((a, b) => b[1].length - a[1].length);
  // Case-insensitive, as the Python side is: half the country names are English
  // and headlines are not consistent about capitalisation.
  // ASCII aliases need word boundaries — "UK" must not fire inside "UKRAINE",
  // nor "UA" inside a GitHub username like ukrainec45. Japanese has no word
  // breaks, so those match as plain substrings. Case-insensitive throughout,
  // since half the aliases are English and headlines are inconsistent.
  const ascii = (s) => /^[\x00-\x7F]+$/.test(s);
  const countryRe = new RegExp(
    cpats.map(([, p]) => ascii(p)
      ? `((?<![A-Za-z])${esc(p)}(?![A-Za-z]))`
      : `(${esc(p)})`).join("|"), "gi");

  built = {
    pats, prefRe, cpats, countryRe,
    national: geo.national, flagship: geo.flagship,
    overseasRe: new RegExp(geo.overseas),
    prefName, countryJa,
  };
  return built;
}

export function init(geo) { return build(geo); }

function groupIndex(m) {
  // Which alternative matched: the first defined capture group.
  for (let i = 1; i < m.length; i++) if (m[i] !== undefined) return i - 1;
  return -1;
}

export function countryName(iso) {
  return (built && built.countryJa[iso]) || iso;
}

export function findPrefectures(text) {
  if (!text || !built) return [];
  const found = [];
  built.prefRe.lastIndex = 0;
  let m;
  while ((m = built.prefRe.exec(text)) !== null) {
    const idx = groupIndex(m);
    if (idx < 0) continue;
    const code = built.pats[idx][0];
    // 京都 directly after 東 is the tail of 東京都, already matched by the
    // longer pattern.
    if (code === 26 && m.index > 0 && text[m.index - 1] === "東") continue;
    if (!found.includes(code)) found.push(code);
  }
  return found;
}

export function findCountries(text) {
  if (!text || !built) return [];
  const hits = new Map();
  built.countryRe.lastIndex = 0;
  let m;
  while ((m = built.countryRe.exec(text)) !== null) {
    const idx = groupIndex(m);
    if (idx < 0) continue;
    const iso = built.cpats[idx][0];
    hits.set(iso, (hits.get(iso) || 0) + 1);
  }
  return [...hits.entries()].sort((a, b) => b[1] - a[1]).map(([iso]) => iso);
}

export function classifyScope(text, lang) {
  if (lang !== "ja") return "overseas";
  if (built.national.some((t) => text.includes(t))) return "national";
  if (findPrefectures(text).length) return "regional";
  if (built.overseasRe.test(text)) return "overseas";
  return "unknown";
}

export function flagshipScore(text) {
  if (!text || !built) return 0;
  const hits = built.flagship.filter((t) => text.includes(t));
  return hits.length ? Math.min(100, 30 + 18 * hits.length) : 0;
}
