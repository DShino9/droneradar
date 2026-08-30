import { $, S, el } from "./state.js";
import { shortTitle } from "./util.js";

// Words that mark a headline as being about something with a date attached,
// so a bare "9月3日" in a product story does not become a calendar entry.
const EVENT_HINT =
  /(開催|開幕|閉幕|出展|展示会|見本市|フェア|エキスポ|EXPO|セミナー|ウェビナー|カンファレンス|シンポジウム|大会|レース|ドローンショー|花火|イベント|申込|受付|募集|エントリー|説明会|講習|体験会|実証実験|公開|放送|放映|conference|expo|summit|festival|championship|airshow)/i;

const CAL_DOW = ["日", "月", "火", "水", "木", "金", "土"];
// Long enough to read a couple of entries before they are replaced.
const CAL_PAGE_MS = 7000;
// Half a minute or so to see the whole calendar, whatever fits on a page.
const CAL_MAX_PAGES = 5;

// A date range in Japanese runs "9月3日〜5日" or "9月3日〜10月2日"; the second
// month is optional and repeating the first is the common case.
const CAL_RANGE = "(?:\\s*[〜～~\\-–—ー]\\s*(?:(\\d{1,2})\\s*月\\s*)?(\\d{1,2})\\s*日)?";

function calDates(text, now) {
  const out = [];
  const addRange = (y, m, d, m2, d2) => {
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return;
    const start = new Date(y, m - 1, d);
    if (start.getMonth() !== m - 1) return;          // 2月30日 and friends
    let span = 0;
    if (d2 >= 1 && d2 <= 31) {
      const end = new Date(y, (m2 || m) - 1, d2);
      span = Math.round((end - start) / 86400000);
      // A backwards or absurdly long range is a false read, not a long show.
      if (span < 0 || span > 13) span = 0;
    }
    for (let i = 0; i <= span; i++) out.push(new Date(y, m - 1, d + i));
  };

  // Take the explicit-year form out of the string first; whatever is left can
  // then be scanned for bare 月日 without the year digits confusing it.
  const rest = text.replace(
    new RegExp("(\\d{4})\\s*年\\s*(\\d{1,2})\\s*月\\s*(\\d{1,2})\\s*日" + CAL_RANGE, "g"),
    (_all, y, m, d, m2, d2) => {
      addRange(+y, +m, +d, m2 ? +m2 : 0, d2 ? +d2 : 0);
      return " ";
    });

  rest.replace(new RegExp("(\\d{1,2})\\s*月\\s*(\\d{1,2})\\s*日" + CAL_RANGE, "g"),
    (_all, m, d, m2, d2) => {
      // No year given: pick the one that puts the date near today. A January
      // event is announced in December, so a little way into the past is
      // still this year — anything further back belongs to the next one.
      let y = now.getFullYear();
      if ((new Date(y, +m - 1, +d) - now) / 86400000 < -45) y += 1;
      addRange(y, +m, +d, m2 ? +m2 : 0, d2 ? +d2 : 0);
      return " ";
    });
  return out;
}

// 「第71回とりで利根川大花火」 can stand in for the whole headline — where a
// quoted product name such as 「DJI Dock 3」 plainly cannot.
const EVENT_NAMEY =
  /(大会|花火|祭|フェス|フェア|ショー|EXPO|エキスポ|展|見本市|杯|カップ|選手権|サミット|会議|カンファレンス|セミナー|ウェビナー|第\s*\d+\s*回)/;

// The calendar has one line per entry, and a news headline spends most of it
// on the date and the announcement verb — both of which the row already says
// by being where it is. Strip those and what is left is the event.
function calLabel(raw) {
  let t = String(raw || "").replace(/\s+/g, " ").trim();
  const quoted = t.match(/[「『“"]([^」』”"]{4,30})[」』”"]/);
  if (quoted && EVENT_NAMEY.test(quoted[1])) return shortTitle(quoted[1], 34);

  const DATE = /\d{4}\s*年(?:も)?\s*|\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s*[（(][日月火水木金土][)）])?(?:\s*[〜～~\-–—ー]\s*(?:\d{1,2}\s*月\s*)?\d{1,2}\s*日)?\s*(?:に|から|より)?/g;
  const LEAD = /^(?:速報|PR|ニュース|お知らせ)\s*[:：]?|^[【\[][^】\]]{0,20}[】\]]|^(?:も)?開催[!！]?|^[、。,.・|｜―—\-\s]+/;
  const TRIM = /[、。,.・♪〜～!！?？|｜:：\s]+$/;
  const TAIL = /(?:を|が)?\s*(?:開催(?:します|されます|いたします|決定)?|実施(?:します|されます)?)$/;

  // Taking the date out can leave an orphan verb at the front ("開催！ 、…")
  // and the announcement at the back, and removing one exposes the other —
  // so keep passing over it until nothing more comes off.
  t = t.replace(DATE, " ").replace(/\s+/g, " ");
  for (let i = 0; i < 5; i++) {
    const before = t;
    t = t.replace(LEAD, "").replace(TRIM, "").trim();
    t = t.replace(TAIL, "").trim();
    if (t === before) break;
  }
  return shortTitle(t || raw, 34);
}

/* The list holds more than the panel can show.

   It used to creep upward continuously, which is legible in a tall panel and
   not in a short one — text drifting a few pixels a second is harder to read
   than text that holds still. So it turns pages instead, the way the headline
   board and the quotes panel already do: fill the panel, hold, replace. It
   stops on hover and while a day is selected. */
/* Paging.

   The list used to creep upward continuously, which is legible in a tall panel
   and not in a short one — text drifting a few pixels a second is harder to
   read than text that holds still. It turns pages instead, the way the
   headline board and the quotes panel already do.

   It turns them by re-rendering rather than by scrolling. Scrolling lost every
   race with a refresh: the collection timer rebuilds this list, and a rebuild
   landing mid-turn put the old scroll offset straight back, so the dots
   advanced while the list sat still. With only one page of rows in the DOM at
   a time there is no scroll position for a refresh to disagree with. */

function calRowNode(r) {
  const row = el("div", "cal-row" + (r.kind === "news" ? " nw" : "")
                        + (S.freshItems.has(r.it.id) ? " fresh" : ""));
  row.append(el("span", "cd", `${r.date.getMonth() + 1}/${r.date.getDate()}${CAL_DOW[r.date.getDay()]}`));
  row.append(el("span", "ct", r.kind === "event"
    ? calLabel(r.it.title_ja || r.it.title)
    : shortTitle(r.it.title_ja || r.it.title, 40)));
  row.title = r.it.title_ja || r.it.title;
  row.onclick = () => window.open(r.it.url, "_blank", "noopener");
  return row;
}

// How many rows fit. Measured from a rendered row rather than assumed, since
// the row height moves with the type size and the breakpoint.
function calPerPage(list) {
  const row = list.querySelector(".cal-row");
  const step = row ? row.offsetHeight + 2 : 28;
  return Math.max(1, Math.floor(list.clientHeight / step));
}

// Draw the current page of S.calRows. Called by the pager and by every
// re-render, so the page survives a refresh without anything having to
// remember a pixel offset.
function paintCalPage(fade) {
  const list = $("#cal-list");
  if (!list || !S.calRows) return;
  const rows = S.calRows;
  if (!rows.length) {
    list.innerHTML = "";
    list.append(el("div", "cal-empty", S.calEmpty || ""));
    paintCalDots(1);
    return;
  }

  // The first paint has nothing to measure, so it lays the whole list out,
  // takes the row height from it, and trims to a page.
  if (!S.calPer) {
    list.innerHTML = "";
    for (const r of rows) list.append(calRowNode(r));
    S.calPer = calPerPage(list);
  }
  const per = S.calPer;
  // How far ahead the calendar looks has to follow how much of it is visible,
  // not a number fixed here: on a short screen one entry fits, and fifteen
  // entries then means fifteen turns to come back round — two minutes to see
  // a calendar. Cap the turns instead and let the horizon follow.
  const shown = Math.min(rows.length, per * CAL_MAX_PAGES);
  const pages = Math.max(1, Math.ceil(shown / per));
  S.calPage = Math.min(S.calPage || 0, pages - 1);

  list.innerHTML = "";
  for (const r of rows.slice(S.calPage * per, Math.min((S.calPage + 1) * per, shown))) {
    list.append(calRowNode(r));
  }
  if (fade) {
    list.classList.remove("turning");
    void list.offsetWidth;                          // restart the animation
    list.classList.add("turning");
  }
  paintCalDots(pages);
}

function setupCalendarPager() {
  const list = $("#cal-list");
  if (!list) return;
  // The rows-per-page is measured, so a resize invalidates it.
  addEventListener("resize", () => { S.calPer = 0; paintCalPage(false); });
  setInterval(() => {
    if (!list.isConnected || S.calDay || list.matches(":hover")) return;
    if (!S.calRows || !S.calPer) return;
    const pages = Math.min(CAL_MAX_PAGES,
                           Math.ceil(S.calRows.length / S.calPer));
    if (pages < 2) return;
    S.calPage = ((S.calPage || 0) + 1) % pages;
    paintCalPage(true);
  }, CAL_PAGE_MS);
}

// A row of dots in the panel head, so it is clear the list has more to show
// and roughly where in it you are.
function paintCalDots(pages) {
  const head = $("#cal-hint");
  if (!head) return;
  let dots = head.parentElement.querySelector(".cal-dots");
  if (!dots) {
    dots = el("div", "cal-dots");
    head.parentElement.append(dots);
  }
  if (pages < 2) { dots.innerHTML = ""; return; }
  dots.innerHTML = "";
  for (let i = 0; i < pages; i++) {
    const d = el("i");
    if (i === (S.calPage || 0)) d.className = "on";
    dots.append(d);
  }
}

function renderCalendar(items) {
  const host = $("#cal-months");
  if (!host) return;
  const list = $("#cal-list");
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 2, 0);   // end of next month
  const key = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

  const byDay = new Map();
  const put = (d, it, kind) => {
    if (d < from || d > to) return;
    const k = key(d);
    if (!byDay.has(k)) byDay.set(k, { date: d, hits: [] });
    const slot = byDay.get(k);
    if (slot.hits.some((h) => h.it.id === it.id)) return;
    slot.hits.push({ it, kind });
  };

  for (const it of items) {
    const title = it.title_ja || it.title || "";
    const text = `${title} ${it.summary_ja || it.summary || ""}`;
    if (it.category === "event" || EVENT_HINT.test(text)) {
      for (const d of calDates(text, now)) put(d, it, "event");
    }
    // A big story has no announced date — it is simply pinned to the day it
    // broke, which is what makes the month read as a news calendar.
    if (it.flagship > 0 && it.published) {
      const p = new Date(it.published * 1000);
      put(new Date(p.getFullYear(), p.getMonth(), p.getDate()), it, "news");
    }
  }

  host.innerHTML = "";
  for (let mi = 0; mi < 2; mi++) {
    const first = new Date(now.getFullYear(), now.getMonth() + mi, 1);
    const box = el("div", "cal-m");
    box.append(el("div", "cal-mt", `${first.getFullYear()}年${first.getMonth() + 1}月`));
    const grid = el("div", "cal-grid");
    CAL_DOW.forEach((w, i) => {
      grid.append(el("div", "cal-dow" + (i === 0 ? " sun" : i === 6 ? " sat" : ""), w));
    });
    for (let i = 0; i < first.getDay(); i++) grid.append(el("div", "cal-d pad", "."));
    const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= days; d++) {
      const dt = new Date(first.getFullYear(), first.getMonth(), d);
      const k = key(dt);
      const hits = (byDay.get(k) || {}).hits || [];
      const hasEvent = hits.some((h) => h.kind === "event");
      const hasFresh = hits.some((h) => S.freshItems.has(h.it.id));
      let cls = "cal-d" + (hasFresh ? " fresh" : "");
      if (+dt === +today) cls += " today";
      if (hits.length) cls += " has " + (hasEvent ? "ev" : "nw");
      if (hits.length > 2) cls += " big";
      if (S.calDay === k) cls += " sel";
      const cell = el("div", cls, String(d));
      if (hits.length) {
        cell.title = hits.slice(0, 5)
          .map((h) => `${h.kind === "event" ? "◆" : "・"}${shortTitle(h.it.title_ja || h.it.title, 30)}`)
          .join("\n");
        cell.onclick = () => {
          S.calDay = S.calDay === k ? null : k;
          renderCalendar(items);
        };
      }
      grid.append(cell);
    }
    box.append(grid);
    host.append(box);
  }

  // The grid says which days are busy; this says what is on them. With a day
  // picked it shows that day, otherwise the next things coming up.
  const slots = [...byDay.values()].sort((a, b) => a.date - b.date);
  const evDays = slots.filter((s) => s.hits.some((h) => h.kind === "event")).length;
  $("#cal-hint").textContent = evDays ? `イベント${evDays}日` : "予定なし";

  list.innerHTML = "";
  const picked = S.calDay ? slots.filter((s) => key(s.date) === S.calDay) : null;
  const rows = [];
  const source = picked || slots.filter((s) => s.date >= today);
  // Two outlets covering the same demo are two items with the same headline;
  // on a calendar that reads as the thing happening twice.
  const seenTitle = new Set();
  for (const slot of source) {
    // Events first: they are the reason to look at a calendar at all.
    const ordered = [...slot.hits].sort((a, b) => (a.kind === "event" ? 0 : 1) - (b.kind === "event" ? 0 : 1));
    for (const h of ordered) {
      const tk = `${slot.date.getDate()}|${(h.it.title_ja || h.it.title || "").slice(0, 18)}`;
      if (seenTitle.has(tk)) continue;
      seenTitle.add(tk);
      rows.push({ date: slot.date, ...h });
      // Enough to fill a handful of pages. It used to run to sixty on the
      // grounds that the list scrolled itself; a pager that needs a dozen
      // turns to come back round is not showing you the calendar, it is
      // hiding it a little more slowly.
      if (!picked && rows.length >= 15) break;
    }
    if (!picked && rows.length >= 15) break;
  }
  // The rows are held rather than drawn: the pager shows one page of them at
  // a time, so a refresh landing mid-turn cannot disagree with a scroll
  // position, because there is not one.
  S.calRows = rows;
  S.calEmpty = picked ? "この日の記事はありません。" : "今月・翌月の予定はまだ拾えていません。";
  if (picked) S.calPage = 0;
  paintCalPage(false);
}

/* --------------------------------------------------------------- radar */

export { CAL_DOW, CAL_PAGE_MS, CAL_RANGE, EVENT_HINT, EVENT_NAMEY, calDates, calLabel, paintCalDots, renderCalendar, setupCalendarPager };
