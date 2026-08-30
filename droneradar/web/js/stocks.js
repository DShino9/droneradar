import { $, S, el } from "./state.js";

function sparkPath(values, w, h) {
  if (values.length < 2) return "";
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  return values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / span) * h;
    return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
}

const STOCK_PAGE = 4;      // fallback before the panel has been measured

let STOCK_ROW_H = 40;

// How many quotes the panel can show at once. Four was right when this lived
// in the rail under two other panels; in the sidebar it has the whole column
// below the nav, and a fixed four left most of that empty.
function stockPageSize() {
  const box = $("#stocks");
  const row = box.querySelector(".stock");
  if (row) {
    const h = row.getBoundingClientRect().height;
    if (h > 12) STOCK_ROW_H = h;
  }
  const room = box.clientHeight;
  if (!room) return STOCK_PAGE;
  return Math.max(3, Math.floor(room / STOCK_ROW_H));
}

function renderStocks() {
  const box = $("#stocks");
  // Measure before clearing: the row height comes off the rows already there.
  const size = stockPageSize();
  box.innerHTML = "";
  const pages = Math.max(1, Math.ceil(S.stocks.length / size));
  S.stockPage = S.stockPage % pages;
  const page = S.stocks.slice(S.stockPage * size, S.stockPage * size + size);
  for (const q of page) {
    const row = el("div", "stock" + (q.stale ? " stale" : ""));
    const nm = el("div", "sname");
    nm.append(el("div", "ssym", q.symbol.replace(".T", "")));
    nm.append(el("div", "sfull", q.name));
    row.append(nm);

    if (q.price == null) {
      row.append(el("div", "spx flat", "—"));
      row.append(el("div", "sch flat", "取得失敗"));
      row.title = q.error || "";
    } else {
      const cur = q.currency === "JPY" ? "¥" : "$";
      row.append(el("div", "spx", cur + q.price.toLocaleString("ja-JP")));
      const dir = q.change_pct > 0.001 ? "up" : q.change_pct < -0.001 ? "down" : "flat";
      const sign = q.change_pct > 0 ? "+" : "";
      row.append(el("div", `sch ${dir}`, `${sign}${q.change_pct.toFixed(2)}%`));
      if (q.spark && q.spark.length > 2) {
        const holder = el("div", "spark");
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("class", "sp");
        svg.setAttribute("viewBox", "0 0 100 20");
        svg.setAttribute("preserveAspectRatio", "none");
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", sparkPath(q.spark, 100, 20));
        path.setAttribute("stroke", dir === "down" ? "var(--down)" : "var(--up)");
        svg.append(path);
        holder.append(svg);
        holder.style.height = "20px";
        row.append(holder);
      }
      row.title = `${q.name} — 前日終値 ${q.prev ?? "?"}（${q.via || "?"}）`;
    }
    row.onclick = () => window.open(
      `https://finance.yahoo.com/quote/${encodeURIComponent(q.symbol)}`, "_blank", "noopener");
    box.append(row);
  }
  const ok = S.stocks.filter((q) => q.price != null).length;
  const meta = $("#stock-meta");
  meta.textContent = S.stocks.length ? `${ok}/${S.stocks.length}銘柄` : "—";

  // Page through on a timer when they do not all fit; the dots show position.
  // With the panel tall enough for the lot there is nothing to page and the
  // dots would be a row of one.
  const dots = el("div", "stock-dots");
  for (let i = 0; pages > 1 && i < pages; i++) {
    const d = el("i");
    if (i === S.stockPage) d.className = "on";
    dots.append(d);
  }
  const head = meta.parentElement;
  const old = head.querySelector(".stock-dots");
  if (old) old.remove();
  head.append(dots);
}

/* -------------------------------------------------------- sources screen */

export { STOCK_PAGE, STOCK_ROW_H, renderStocks, sparkPath, stockPageSize };
