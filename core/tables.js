/* The tuned data, loaded from the JSON that tools_export_tables.py writes.
   Python remains the source of truth; this side never edits these. */

let cache = null;

// Where the tables live differs per host: served over HTTP on desktop, bundled
// next to the code on mobile. One override point rather than a branch in every
// caller.
export const config = { base: "/tables" };

export async function tables() {
  if (cache) return cache;
  const load = async (name) => {
    const r = await fetch(`${config.base}/${name}`);
    if (!r.ok) throw new Error(`${name}: ${r.status}`);
    return r.json();
  };
  const [terms, sources, geo] = await Promise.all([
    load("terms.json"), load("sources.json"), load("geo.json"),
  ]);
  cache = { terms, sources, geo };
  return cache;
}

export function preload(data) {
  cache = data;
}
