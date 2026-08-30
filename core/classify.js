/* Which row an article belongs in.

   The order is the whole point and is not alphabetical. 空飛ぶクルマ is
   unmistakable so it goes first. 防衛 comes next because a strike is a strike
   even when the report also says 迎撃 — putting 対ドローン ahead of it emptied
   half the war coverage into the security row. Then the emergency, then the
   job the drone was doing, and last the event listing, which is the weakest
   signal since almost anything can be announced as a demo. */

const ORDER = [
  ["aam", "aam"],
  ["defense", "military"],
  ["security", "security"],
  ["disaster", "disaster"],
  ["events", "event"],
  ["survey", "survey"],
  ["industry", "industry"],
];

// Only the vague buckets get reclassified; research and dev already say what
// they hold.
const RECLASSIFY_FROM = new Set(["jp_news", "world_news", "business", "hobby"]);

export function has(text, terms) {
  const low = text.toLowerCase();
  for (const t of terms) {
    if (text.includes(t) || low.includes(t.toLowerCase())) return true;
  }
  return false;
}

export function topicOf(text, category, terms) {
  if (!RECLASSIFY_FROM.has(category)) return category;
  for (const [row, key] of ORDER) {
    if (has(text, terms[key])) return row;
  }
  return category;
}

export function isRelevant(text, terms) {
  return terms.drone.some((t) => text.includes(t));
}

// A clip whose own title says it is about a drone. Judged on the title alone:
// checking the description let a gimbal review through on the strength of a
// channel blurb that mentioned drones elsewhere.
export function isDroneVideo(title, terms) {
  if (terms.video_not_drone.some((t) => title.includes(t))) {
    return terms.video_droney.some((t) => title.includes(t));
  }
  return true;
}
