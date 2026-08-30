/* Shared state and the two DOM helpers everything uses.
   No imports: this is the bottom of the dependency graph. */

const S = {
  items: [], sources: [], socialSources: [], categories: [], config: {},
  meta: {}, map: null, world: null,
  social: [], trends: [], stocks: [], stockMeta: 0,
  seenPosts: new Set(), seenItems: new Set(), freshItems: new Set(),
  grouped: true, groupLimits: {}, ledOffset: 0, offline: false,
  genreIndex: 0, genrePinned: null, genreKeys: [], genrePool: null, stockPage: 0,
  mapData: null, spotIndex: {}, spotStories: {}, zoomTimers: {},
  calDay: null,
  videoQueue: null, videoStarted: false, playingId: null,
  ytPlayer: null, playerSince: 0, videoPeek: 0, videoPlayed: 0,
  badVideos: new Set(JSON.parse(localStorage.getItem("dr.badVideos") || "[]")),
  // Carried across reloads so the queue does not restart on the same clip.
  videoCursor: Number(localStorage.getItem("dr.videoCursor") || 0),
  // `group` is the genre group; `cat` is one category inside it. Setting the
  // group alone shows everything under it.
  filter: { view: "feed", bucket: "all", cat: null, group: null, pref: null, scope: null,
            q: "", days: 7, lang: "all", sort: "new", imgOnly: false, day: null,
            country: null },
  // The calendar holds its rows and shows one page of them at a time.
  calRows: null, calPer: 0, calPage: 0, calEmpty: "",
  limit: 40,
};

const $ = (sel) => document.querySelector(sel);

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/* ------------------------------------------------------------------ utils */

const PREF_BY_CODE = {};

const COUNTRY_JA = {};

// Colour is carried by the genre group, not by the category: seventeen hues
// are indistinguishable on a map fill or a radar blip, seven are not. The
// hues live in the stylesheet so light and dark can each pick their own.
// Everything that encodes category resolves through here, and genre.js owns
// which group a category belongs to.
//
// Imported lazily to keep the dependency direction intact — state is the leaf
// everything else imports, so it cannot import genre at the top.
let _groupOf = () => null;
const setGroupResolver = (fn) => { _groupOf = fn; };
const catColor = (key) => {
  const g = _groupOf(key);
  return g ? `var(--cat-${g.key})` : "var(--cat-other)";
};

const SOCIAL_COLOR = "var(--cat-social)";

// Filled in by the modules that own these functions. A leaf module that needs
// a full re-render calls hooks.renderAll() — importing main directly would
// close the graph into a cycle, since main imports every feature module.
const hooks = {
  renderAll: () => {},
  renderCards: () => {},
  announceNew: () => {},
};

export { hooks, $, COUNTRY_JA, PREF_BY_CODE, S, SOCIAL_COLOR, catColor, el, setGroupResolver };
