/* Persistence, behind one interface.

   Desktop reads and writes JSON files through the Python server; a phone has
   no server and no filesystem to speak of. Rather than branch on the platform
   in the collector, each host supplies one of these. */

export function memoryStore(initial = {}) {
  const data = { ...initial };
  return {
    async get(name, fallback) {
      return name in data ? data[name] : fallback;
    },
    async set(name, value) { data[name] = value; },
    _data: data,
  };
}

// IndexedDB via localStorage-style keys is enough here: the collection is a
// handful of documents, not a queryable dataset.
export function webStore(prefix = "dr.") {
  return {
    async get(name, fallback) {
      try {
        const raw = localStorage.getItem(prefix + name);
        return raw === null ? fallback : JSON.parse(raw);
      } catch { return fallback; }
    },
    async set(name, value) {
      try { localStorage.setItem(prefix + name, JSON.stringify(value)); }
      catch { /* quota: the next run trims and tries again */ }
    },
  };
}
