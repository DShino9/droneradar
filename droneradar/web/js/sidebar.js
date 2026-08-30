import { $, S, el, hooks } from "./state.js";
import { GROUPS, catIcon } from "./genre.js";

function renderSidebar() {
  const now = Date.now() / 1000;
  const inRange = (it) => !S.filter.days || now - it.published <= S.filter.days * 86400;
  const pool = S.items.filter((it) => it.category !== "video" && inRange(it));

  const main = $("#nav-main");
  main.innerHTML = "";
  const buckets = [
    { key: "all", label: "すべて", n: pool.length },
    { key: "saved", label: "保存済み", n: S.items.filter((i) => i.bookmarked).length },
  ];
  for (const b of buckets) {
    const btn = el("button", "nav-item" + (S.filter.view === "feed" && S.filter.bucket === b.key && !S.filter.cat ? " on" : ""));
    btn.append(el("span", "lbl", b.label), el("span", "n", String(b.n)));
    btn.onclick = () => {
      Object.assign(S.filter, { view: "feed", bucket: b.key, cat: null, group: null, pref: null, scope: null });
      S.limit = 40; hooks.renderAll();
    };
    main.append(btn);
  }

  const cats = $("#nav-cats");
  cats.innerHTML = "";
  // Which genres the new articles landed in, so the nav can say where to look.
  const freshCats = new Set(
    S.items.filter((it) => S.freshItems.has(it.id)).map((it) => it.category));
  const label = new Map(S.categories);

  // Grouped rather than one flat list of seventeen. The group carries the hue
  // and the icon and filters to everything under it; the categories below it
  // stay exactly as they were, so nothing can be filtered for now that could
  // not be before.
  for (const g of GROUPS) {
    const members = g.cats.filter((c) => c !== "video" && label.has(c));
    if (!members.length) continue;
    const total = pool.filter((i) => members.includes(i.category)).length;

    const head = el("button", "nav-item nav-group-head"
      + (S.filter.group === g.key && !S.filter.cat ? " on" : "")
      + (members.some((c) => freshCats.has(c)) ? " fresh" : ""));
    head.style.setProperty("--gc", `var(--cat-${g.key})`);
    // The arrival pulse in the group's own colour, matching the tiles and the
    // map regions that the same stories lit.
    head.style.setProperty("--fresh", `var(--cat-${g.key})`);
    head.append(catIcon(members[0], 15), el("span", "lbl", g.label),
                el("span", "n", String(total)));
    head.title = `${g.label} ${total}件`;
    head.onclick = () => {
      Object.assign(S.filter, {
        view: "feed", bucket: "all", cat: null, pref: null,
        group: S.filter.group === g.key ? null : g.key,
      });
      S.limit = 40; hooks.renderAll();
    };
    cats.append(head);

    // The sub-list is there when its group is open, or when a category inside
    // it is the current filter — otherwise seventeen rows are back on screen
    // and the grouping has bought nothing.
    const open = S.filter.group === g.key || members.includes(S.filter.cat);
    if (!open) continue;
    const sub = el("div", "nav-sub");
    for (const key of members) {
      const n = pool.filter((i) => i.category === key).length;
      const btn = el("button", "nav-item nav-sub-item" + (S.filter.cat === key ? " on" : "")
                               + (freshCats.has(key) ? " fresh" : ""));
      btn.style.setProperty("--gc", `var(--cat-${g.key})`);
      btn.append(el("span", "lbl", label.get(key)), el("span", "n", String(n)));
      btn.title = `${label.get(key)} ${n}件`;
      btn.onclick = (e) => {
        e.stopPropagation();
        Object.assign(S.filter, {
          view: "feed", bucket: "all", group: g.key, pref: null,
          cat: S.filter.cat === key ? null : key,
        });
        S.limit = 40; hooks.renderAll();
      };
      sub.append(btn);
    }
    cats.append(sub);
  }

  const views = $("#nav-views");
  views.innerHTML = "";
  const nat = pool.filter((i) => i.scope === "national").length;
  const natBtn = el("button", "nav-item" + (S.filter.scope === "national" ? " on" : ""));
  natBtn.append(el("span", "lbl", "全国・国交省系"), el("span", "n", String(nat)));
  natBtn.onclick = () => {
    Object.assign(S.filter, { view: "feed", scope: S.filter.scope === "national" ? null : "national", cat: null, group: null });
    S.limit = 40; hooks.renderAll();
  };
  views.append(natBtn);

  const srcBtn = el("button", "nav-item" + (S.filter.view === "sources" ? " on" : ""));
  srcBtn.append(el("span", "lbl", "ソース管理"));
  /* A feed that quietly stopped returning anything looks exactly like a feed
     with no news that week, so the count of broken ones belongs where the
     source list is reached from. It had a panel of its own for a while; a grid
     of ninety cells turned out to be a lot of sidebar spent saying "fine",
     which is what it says almost always. A number, and a colour when it is not
     zero, says the same thing in one row. */
  const all = [...S.sources, ...(S.socialSources || [])];
  const broken = all.filter((x) => x.enabled
    && (x.error || !x.last_ok || now - x.last_ok > 6 * 3600)).length;
  if (broken) {
    const warn = el("span", "n bad", `${broken}件不調`);
    warn.title = all.filter((x) => x.enabled
        && (x.error || !x.last_ok || now - x.last_ok > 6 * 3600))
      .slice(0, 10).map((x) => `・${x.name}${x.error ? "：" + x.error.slice(0, 40) : "：更新が止まっています"}`)
      .join("\n");
    srcBtn.append(warn);
  } else {
    srcBtn.append(el("span", "n", String(all.filter((x) => x.enabled).length)));
  }
  srcBtn.onclick = () => { S.filter.view = "sources"; hooks.renderAll(); };
  views.append(srcBtn);
}

/* ------------------------------------------------------------- highlights */

export { renderSidebar };
