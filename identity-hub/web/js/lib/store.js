// A tiny store: one plain state object, shallow updates, subscribers by key.
export function createStore(initial) {
  let state = { ...initial };
  const subs = new Set();
  return {
    get(key) { return key === undefined ? state : state[key]; },
    set(patch) {
      const changed = [];
      for (const k of Object.keys(patch)) if (state[k] !== patch[k]) changed.push(k);
      if (changed.length === 0) return;
      state = { ...state, ...patch };
      for (const sub of [...subs]) {
        if (!sub.keys || sub.keys.some((k) => changed.includes(k))) {
          try { sub.fn(state, changed); } catch (err) { queueMicrotask(() => { throw err; }); }
        }
      }
    },
    // keys: array of state keys, or null for all. Returns an unsubscribe function.
    subscribe(keys, fn) {
      const sub = { keys, fn };
      subs.add(sub);
      return () => subs.delete(sub);
    },
  };
}

// The one application store.
export const store = createStore({
  phase: 'loading',     // loading | out | locked | in
  config: null,
  account: null,        // { id, publicKey, encPrivateKey, recoveryWrap, balance, createdDay }
  balance: 0,           // credits
  mailboxes: null,      // null = not loaded yet
  aliases: null,
  numbers: null,
  phones: null,
  identities: null,     // named groups of aliases and numbers (encrypted in the vault)
  leaks: {},            // "possibly leaked" hints by alias id, in memory only (see lib/leakwatch.js)
  passkeyCount: null,   // how many passkeys the account has (null = not loaded yet)
  purchases: [],        // pending private payments (see lib/pay.js)
  prefs: {},            // small encrypted preferences from the vault
  theme: 'system',
  online: true,
});

// The name of the product. The person who runs the server can change it (APP_NAME).
export const appName = () => { const c = store.get('config'); return (c && typeof c.appName === 'string' && c.appName.trim()) || 'Postern'; };

// A simple event bus for "this kind of data changed" notices (from the server event stream).
const listeners = new Map();
export const bus = {
  on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type)?.delete(fn);
  },
  emit(type, data) {
    for (const fn of [...(listeners.get(type) || [])]) {
      try { fn(data); } catch (err) { queueMicrotask(() => { throw err; }); }
    }
  },
};
