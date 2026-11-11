// A small in-memory map whose entries expire after a fixed time.
// It holds one-time values: sign-in challenges and used proof-of-work challenges.
// Nothing here is written to disk. A restart drops all entries.
export function createTtlMap({ ttlMs, max }) {
  // Entries stay in insertion order. All entries have the same lifetime,
  // so the oldest entry is always first and cleanup can stop early.
  const map = new Map(); // key -> { value, expires }

  function prune(now = Date.now()) {
    for (const [key, entry] of map) {
      if (entry.expires > now) break;
      map.delete(key);
    }
  }

  return {
    // Stores a value. When the map is full: `evict` true drops the oldest entry,
    // `evict` false refuses the new entry and returns false.
    set(key, value, { evict = true } = {}) {
      prune();
      map.delete(key); // a replaced key must move to the end
      if (map.size >= max) {
        if (!evict) return false;
        map.delete(map.keys().next().value);
      }
      map.set(key, { value, expires: Date.now() + ttlMs });
      return true;
    },
    has(key) {
      const entry = map.get(key);
      return Boolean(entry && entry.expires > Date.now());
    },
    // Returns the value and removes it. A value can be taken one time only.
    take(key) {
      const entry = map.get(key);
      if (!entry) return undefined;
      map.delete(key);
      return entry.expires > Date.now() ? entry.value : undefined;
    },
    delete: (key) => map.delete(key),
    prune,
    get size() { return map.size; },
  };
}
