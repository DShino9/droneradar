/* Genre grouping, colour and icons.

   There are seventeen categories, and there were seventeen hues to go with
   them. Seventeen hues is more than colour can carry: on a map fill or a
   three-pixel radar blip, "測量" green and "産業活用" green are the same green,
   and the legend stops being worth reading.

   So colour moves up a level. The seventeen categories stay exactly as they
   are for filtering and for the source catalogue — nothing is lost there — but
   each belongs to one of seven groups, and it is the group that owns a hue.
   Seven hues are far enough apart to tell apart at a glance. Within a group,
   an icon does the separating that colour no longer can.

   The hues are the ones the categories already had; the group takes the tone
   of its most prominent member, so the dashboard still looks like itself. */

const GROUPS = [
  {
    key: "news", label: "ニュース", hue: "#4cc4ff",
    cats: ["jp_news", "world_news"],
    // A folded newspaper.
    icon: "M4 5h13v13a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2zM17 9h3v9a2 2 0 0 1-2 2M7 8h7M7 11h7M7 14h4",
  },
  {
    key: "safety", label: "防衛・安全", hue: "#ff6b7d",
    cats: ["defense", "security"],
    // A shield.
    icon: "M12 3l7 3v5c0 4.4-2.9 8.4-7 10-4.1-1.6-7-5.6-7-10V6z",
  },
  {
    key: "rule", label: "規制・制度", hue: "#ffb445",
    cats: ["regulation"],
    // A stamped document.
    icon: "M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6",
  },
  {
    key: "field", label: "現場・運用", hue: "#5fdc86",
    cats: ["industry", "survey", "disaster", "aam"],
    // A survey marker over ground.
    icon: "M12 3v7M12 10L6 21M12 10l6 11M7.5 16h9M9 6.5h6",
  },
  {
    key: "tech", label: "製品・技術", hue: "#ac92ff",
    cats: ["product", "research", "dev"],
    // A chip.
    icon: "M8 8h8v8H8zM4 10h4M4 14h4M16 10h4M16 14h4M10 4v4M14 4v4M10 16v4M14 16v4",
  },
  {
    key: "biz", label: "ビジネス", hue: "#ff9366",
    cats: ["business"],
    // A rising line.
    icon: "M4 18l5-6 4 3 7-8M15 7h5v5",
  },
  {
    key: "culture", label: "空撮・催事", hue: "#f77fc0",
    cats: ["hobby", "events", "community", "video"],
    // A camera.
    icon: "M4 8h4l1.5-2h5L16 8h4v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
  },
];

const GROUP_BY_CAT = new Map();
for (const g of GROUPS) for (const c of g.cats) GROUP_BY_CAT.set(c, g);

const groupOf = (cat) => GROUP_BY_CAT.get(cat) || null;

/* An <svg> for a category, drawn from its group. Stroked rather than filled so
   one path serves at every size and takes the surrounding colour by default;
   pass a colour where it has to stand on its own. */
function catIcon(cat, size = 14, color = null) {
  const g = groupOf(cat);
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("class", "cat-icon");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", g ? g.icon : "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", color || (g ? `var(--cat-${g.key})` : "currentColor"));
  path.setAttribute("stroke-width", "1.9");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}

/* Regional indicator letters: 🇯 + 🇵 renders as the Japanese flag, and every
   country in the table is keyed by its ISO-3166 alpha-2 code, so the flag comes
   out of the code itself with no table to keep in step.

   Windows ships no flag glyphs and shows the two letters instead, which is
   still a readable label rather than a blank. */
function flagOf(code) {
  if (!/^[A-Za-z]{2}$/.test(code || "")) return "";
  return String.fromCodePoint(...[...code.toUpperCase()]
    .map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export { GROUPS, catIcon, flagOf, groupOf };
