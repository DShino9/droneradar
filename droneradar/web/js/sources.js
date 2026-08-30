import { $, S, el } from "./state.js";
import { ago, catLabel, imgStats, toast } from "./util.js";
import { api, load } from "./api.js";
import { isLive } from "./mode.js";

function renderSources() {
  const view = $("#view-sources");
  view.innerHTML = "";
  const wrap = el("div", "src-wrap");

  const add = el("div", "src-add");
  const input = el("input");
  input.placeholder = "サイトのURL（例: example.com）またはキーワード";
  const catSel = el("select");
  for (const [k, label] of S.categories) {
    const o = el("option", null, label); o.value = k; catSel.append(o);
  }
  const btn = el("button", null, "追加");
  const run = async () => {
    const value = input.value.trim();
    if (!value) return;
    btn.disabled = true; btn.textContent = "確認中…";
    const isUrl = /^https?:\/\//.test(value) || /^[\w-]+(\.[\w-]+)+/.test(value);
    const res = isUrl
      ? await api("/api/sources/add", { url: value, category: catSel.value })
      : await api("/api/keyword/add", { word: value, category: catSel.value });
    btn.disabled = false; btn.textContent = "追加";
    if (!res) { toast("サーバーに接続できません"); return; }
    if (res.error) { toast("追加できません: " + res.error); return; }
    input.value = "";
    toast(`${res.name}: ${res.note}`);
    await load();
  };
  btn.onclick = run;
  input.onkeydown = (e) => { if (e.key === "Enter") run(); };
  add.append(input, catSel, btn);
  wrap.append(add);

  wrap.append(el("div", "note",
    "URLを入れるとRSSを自動検出します。RSSが無いサイトは Google ニュースの site: 検索に自動で切り替えて収集します。"
    + "YouTubeのチャンネルURLを入れるとそのチャンネルの動画フィードを登録します。"
    + "URLでない文字列はキーワード検索として登録します。"));

  const section = (title, list, isSocial) => {
    wrap.append(Object.assign(el("h3", "sec", title), {}));
    for (const s of list) {
      const row = el("div", "src-row");
      const tg = el("button", "toggle" + (s.enabled ? " on" : ""));
      tg.title = s.enabled ? "無効にする" : "有効にする";
      tg.onclick = async () => {
        s.enabled = !s.enabled;
        tg.className = "toggle" + (s.enabled ? " on" : "");
        await api("/api/sources/update", { id: s.id, enabled: s.enabled });
      };
      row.append(tg);

      const nm = el("div", "sname2");
      nm.append(el("div", null, s.name));
      nm.append(el("div", s.error ? "serr" : "surl",
        s.error ? "エラー: " + s.error : (s.query ? `#${s.query} · ${s.url}` : s.url)));
      row.append(nm);

      const catLabel = isSocial ? "SNS"
        : (S.categories.find(([k]) => k === s.category) || [null, s.category])[1];
      const kind = s.url && s.url.includes("news.google.com") ? "site:検索"
        : s.type === "dronejournal" ? "HTML" : s.type.toUpperCase();
      row.append(el("div", "scat", `${catLabel} · ${kind}`));

      row.append(el("div", "sstat", s.last_ok
        ? `${s.last_count ?? "-"}件 · ${ago(s.last_ok)}` : "未取得"));

      const del = el("button", "del", "×");
      del.title = s.builtin ? "無効にする" : "削除";
      del.onclick = async () => {
        await api("/api/sources/update", { id: s.id, delete: true });
        toast("削除しました"); await load();
      };
      row.append(del);
      wrap.append(row);
    }
  };

  section(`記事ソース（${S.sources.length}）`, S.sources, false);
  section(`リアルタイムSNS（${S.socialSources.length}）`, S.socialSources, true);

  wrap.append(el("div", "note",
    "X（旧Twitter）は無料の公開APIが廃止されているため、Yahoo!リアルタイム検索を経由して投稿を取得しています。"));

  /* Published copy only: how many thumbnails the publishers refused.

     There is no image proxy here, so some share of them will not load and
     falls back to the name tile. Whether that share is 2% or 40% decides
     whether this design stays, and guessing from a scroll is not deciding —
     so the page counts, and shows the count where settings live. */
  if (!isLive()) {
    const worst = Object.entries(imgStats.hosts)
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([h, n]) => `${h} ${n}`).join(" / ");
    const pct = imgStats.tried
      ? Math.round((imgStats.failed / imgStats.tried) * 100) : 0;
    wrap.append(el("div", "note",
      `画像: ${imgStats.tried}件中 ${imgStats.failed}件が出ませんでした（${pct}%）`
      + "。出なかったものは発行元の名前タイルに置き換えています。"
      + (worst ? ` 内訳: ${worst}` : "")));
  }

  view.append(wrap);
}

/* ---------------------------------------------------------------- render */

export { renderSources };
