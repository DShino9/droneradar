/* Feed parsing: RSS 2.0, RSS 1.0 (RDF) and Atom into one shape.

   DOMParser rather than a hand-rolled scanner — it is in every WebView, so it
   costs nothing to ship and it handles namespaces, CDATA and entities properly.
   What it will not do is forgive malformed XML, and feeds in the wild are full
   of raw ampersands and stray control characters, so a repair pass runs when
   the first parse reports an error. */

const TAG_RE = /<[^>]+>/g;
const WS_RE = /\s+/g;
const IMG_RE = /<img[^>]+src=["']([^"']+)["']/i;

export function stripHtml(s, limit = 400) {
  if (!s) return "";
  s = s.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(TAG_RE, " ");
  s = unescapeEntities(s);
  s = s.replace(WS_RE, " ").trim();
  // Count characters, not UTF-16 units. slice() would cut an emoji in half and
  // give a shorter string than the Python side for the same input.
  return [...s].slice(0, limit).join("");
}

// Named entities beyond the XML five are rare in feeds but &nbsp; is not, and
// Reddit's descriptions are full of numeric forms like &#32;.
const NAMED = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  hellip: "…", mdash: "—", ndash: "–", rsquo: "’",
  lsquo: "‘", ldquo: "“", rdquo: "”", middot: "·",
};

export function unescapeEntities(s) {
  // The semicolon is optional on named entities, as it is in HTML5 and in
  // Python's html.unescape. Feeds end up with a bare "&amp" whenever a long
  // URL is cut mid-entity, and leaving it there put the letters on screen.
  return s.replace(/&(#x?[0-9a-fA-F]+;|[a-zA-Z][a-zA-Z0-9]*;?)/g, (m, raw) => {
    const body = raw.endsWith(";") ? raw.slice(0, -1) : raw;
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    const v = NAMED[body.toLowerCase()];
    return v === undefined ? m : v;
  });
}

export function parseDate(s) {
  if (!s) return 0;
  s = s.trim();
  // RFC 822 (RSS) and ISO 8601 (Atom) both parse here; Date is lenient enough
  // for the shapes feeds actually use, and rejects the rest as NaN.
  const t = Date.parse(s);
  if (Number.isFinite(t)) return Math.floor(t / 1000);
  // A date with no time and no zone: treat as local midnight, as Python does.
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(s);
  if (m) {
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return Number.isFinite(d.getTime()) ? Math.floor(d.getTime() / 1000) : 0;
  }
  return 0;
}

function localName(el) {
  return (el.localName || el.nodeName || "").replace(/^.*:/, "");
}

function firstChild(el, name) {
  for (const c of el.children) if (localName(c) === name) return c;
  return null;
}

function textOf(el, name) {
  const n = firstChild(el, name);
  return n && n.textContent ? n.textContent.trim() : "";
}

// Dig an image URL out of whichever place the feed hid it.
function findImage(el, description, content) {
  for (const c of el.children) {
    const name = localName(c);
    const url = c.getAttribute("url");
    if ((name === "content" || name === "thumbnail") && url) {
      const t = c.getAttribute("type") || "";
      if ((name === "thumbnail" || t.startsWith("image") || !t)
          && !t.startsWith("video") && !t.startsWith("audio")) return url;
    }
    if (name === "group") {
      for (const g of c.children) {
        if (localName(g) === "thumbnail" && g.getAttribute("url")) {
          return g.getAttribute("url");
        }
      }
    }
    if (name === "enclosure" && url && (c.getAttribute("type") || "").startsWith("image")) {
      return url;
    }
    if (name === "image") {
      const href = c.getAttribute("href");
      if (href) return href;
      const t = (c.textContent || "").trim();
      if (t.startsWith("http")) return t;
    }
  }
  for (const blob of [content, description]) {
    if (blob) {
      const m = IMG_RE.exec(blob);
      if (m) return m[1];
    }
  }
  return null;
}

function parseXml(text) {
  const p = new DOMParser();
  let doc = p.parseFromString(text, "application/xml");
  if (!doc.querySelector("parsererror")) return doc;
  // Repair pass: bare ampersands and control characters are what actually
  // breaks these documents.
  const fixed = text
    .replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
  doc = p.parseFromString(fixed, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("XML parse: " + doc.querySelector("parsererror").textContent.slice(0, 80));
  }
  return doc;
}

export function parseFeed(xmlText) {
  const doc = parseXml(xmlText.replace(/^[﻿ \t\r\n]+/, ""));
  const entries = [];
  const nodes = [...doc.querySelectorAll("*")].filter((n) => {
    const t = localName(n);
    return t === "item" || t === "entry";
  });

  for (const el of nodes) {
    const title = textOf(el, "title");

    let link = "";
    const linkEl = firstChild(el, "link");
    if (linkEl) link = (linkEl.getAttribute("href") || linkEl.textContent || "").trim();
    if (!link) {
      for (const c of el.children) {
        if (localName(c) === "link" && c.getAttribute("href")) {
          const rel = c.getAttribute("rel");
          if (rel === null || rel === "alternate") { link = c.getAttribute("href"); break; }
        }
      }
    }
    if (!link) link = textOf(el, "guid") || textOf(el, "id");
    if (!link.startsWith("http")) continue;

    let description = "";
    for (const key of ["description", "summary", "subtitle"]) {
      const n = firstChild(el, key);
      if (n) { description = n.textContent || ""; if (description) break; }
    }
    let content = "";
    for (const key of ["encoded", "content"]) {
      const n = firstChild(el, key);
      if (n) { content = n.textContent || ""; if (content) break; }
    }
    // YouTube puts the real blurb inside media:group/media:description.
    if (!description && !content) {
      for (const c of el.children) {
        if (localName(c) === "group") {
          for (const g of c.children) {
            if (localName(g) === "description") description = g.textContent || "";
          }
        }
      }
    }

    let published = 0;
    for (const key of ["pubDate", "published", "updated", "date", "created"]) {
      const n = firstChild(el, key);
      if (n && n.textContent) {
        published = parseDate(n.textContent);
        if (published) break;
      }
    }

    let author = "";
    for (const key of ["creator", "author"]) {
      const n = firstChild(el, key);
      if (n) { author = stripHtml(n.textContent || "", 60); if (author) break; }
    }

    entries.push({
      title: stripHtml(title, 300),
      url: link,
      summary: stripHtml(content || description, 400),
      published,
      image: findImage(el, description, content),
      author,
    });
  }
  return entries;
}
