// Tutorial progress. It is saved encrypted in the vault (key "tutorial"), like labels.
//
// Rules:
// - Nothing about the tutorial goes into localStorage, sessionStorage or the address.
// - The server gets one encrypted value. It cannot read the step. The value always has the
//   same size, so the size tells nothing about how far the person is.
// - A write happens only when the person does something (start, next, back, skip, finish).
//   To look at a step writes nothing.
//
// The value: { v: 1, step: <id>, done: [ids], skipped: [ids], state, pad }
//   state: 'offered' | 'active' | 'finished' | 'dismissed'. No value at all = the offer shows.
import { createStore } from '../../lib/store.js';
import { vaultGet, vaultChange, onForget } from '../../lib/session.js';

const KEY = 'tutorial';
const STATES = ['offered', 'active', 'finished', 'dismissed'];
const STEP_ID = /^[a-z][a-z0-9-]{0,39}$/;
const MAX_IDS = 40;
const PLAIN_SIZE = 640; // characters of the saved text, always

// value: undefined = not read yet, null = nothing saved, or the clean object.
export const progress = createStore({ value: undefined });

const idList = (v) => (Array.isArray(v) ? [...new Set(v.filter((id) => typeof id === 'string' && STEP_ID.test(id)))].slice(0, MAX_IDS) : []);

// Another version of the app may have written the value: check every field.
export function clean(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!STATES.includes(value.state)) return null;
  const done = idList(value.done);
  return {
    v: 1,
    step: typeof value.step === 'string' && STEP_ID.test(value.step) ? value.step : '',
    done,
    skipped: idList(value.skipped).filter((id) => !done.includes(id)),
    state: value.state,
  };
}

// Fills the saved text to a fixed length.
function padded(value) {
  const base = { v: 1, step: value.step, done: value.done, skipped: value.skipped, state: value.state, pad: '' };
  const missing = PLAIN_SIZE - JSON.stringify(base).length;
  base.pad = missing > 0 ? '.'.repeat(missing) : '';
  return base;
}

// A sign-out or a lock ends the life of what was read. A read that is still on its way must not put it back.
let epoch = 0;
let reading = null;
onForget(() => { epoch++; reading = null; progress.set({ value: undefined }); });

// Reads the saved progress one time. Later calls give the copy in memory.
export function loadProgress() {
  const now = progress.get('value');
  if (now !== undefined) return Promise.resolve(now);
  if (!reading) {
    const mine = epoch;
    reading = vaultGet(KEY).then((raw) => {
      if (mine !== epoch) return null;
      const value = clean(raw);
      if (progress.get('value') === undefined) progress.set({ value });
      return progress.get('value');
    }).finally(() => { if (mine === epoch) reading = null; });
  }
  return reading;
}

// Changes the progress: change(current or null) returns the new value.
// The screen shows the new value at once. The write runs behind it; the promise is for the write.
// keep: false = do not keep the done steps of the saved copy (for "Start again").
export function saveProgress(change, { keep = true } = {}) {
  const next = clean(change(progress.get('value') || null));
  if (!next) return Promise.resolve(null);
  progress.set({ value: next });
  const mine = epoch;
  return vaultChange(KEY, (stored) => {
    if (mine !== epoch) throw new Error('The app is locked.');
    // Another tab may have saved steps that this tab did not see.
    const other = keep ? clean(stored) : null;
    const done = other ? idList([...next.done, ...other.done]) : next.done;
    return padded({ ...next, done, skipped: next.skipped.filter((id) => !done.includes(id)) });
  });
}
