// Identities: named groups of aliases and numbers, for example "Facebook".
//
// The server knows nothing about them. The group definitions are one encrypted value
// in the vault (key "identities"). Which group an alias or a number is in is the field
// "identityId" inside the encrypted label of that item (see lib/data.js).
import { store } from './store.js';
import { vaultGet, vaultPut, isUnlocked } from './session.js';
import { isPersona } from './persona/index.js';
import { b64u, randomBytes } from '/shared/bytes.js';

const KEY = 'identities';
const ID = /^[A-Za-z0-9_-]{22}$/;
export const NAME_MAX = 60;
export const NOTE_MAX = 300;
const MAX_IDENTITIES = 200;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const today = () => new Date().toISOString().slice(0, 10);

// The stored value: { v: 1, identities: [{ id, name, note, persona?, createdDay, … }] }.
// Entries in a wrong form are left out of the screen list, but they are kept in the
// stored value, and so is every field that this version does not know.
function rawList(value) {
  return isObject(value) && Array.isArray(value.identities) ? value.identities.filter(isObject) : [];
}
function view(raw) {
  if (typeof raw.id !== 'string' || !ID.test(raw.id)) return null;
  return {
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, NAME_MAX) : 'No name',
    note: typeof raw.note === 'string' ? raw.note.slice(0, NOTE_MAX) : '',
    persona: isPersona(raw.persona) ? raw.persona : null,
    createdDay: typeof raw.createdDay === 'string' ? raw.createdDay : '',
  };
}
function publish(value) {
  const list = rawList(value).map(view).filter(Boolean);
  if (isUnlocked()) store.set({ identities: list });
  return list;
}

export async function loadIdentities() {
  return publish(await vaultGet(KEY, { fresh: true }));
}

// Read the stored value again, change it, write it. The read comes right before the
// write, so that a change from another tab is not lost. Changes of this tab run one after the other.
let chain = Promise.resolve();
function mutate(change) {
  const run = chain.then(async () => {
    const current = await vaultGet(KEY, { fresh: true });
    const base = isObject(current) ? current : {};
    const list = rawList(current);
    const next = { ...base, v: 1, identities: change(list) };
    await vaultPut(KEY, next);
    return publish(next);
  });
  chain = run.catch(() => {});
  return run;
}

export async function createIdentity({ name, note = '' }) {
  const id = b64u(randomBytes(16));
  await mutate((list) => {
    if (list.length >= MAX_IDENTITIES) throw new Error(`You can have ${MAX_IDENTITIES} identities. Delete one first.`);
    return [...list, { id, name: String(name).trim().slice(0, NAME_MAX), note: String(note || '').trim().slice(0, NOTE_MAX), createdDay: today() }];
  });
  return id;
}

// patch: { name?, note?, persona? } (persona: null removes the made-up details)
export function updateIdentity(id, patch) {
  return mutate((list) => {
    if (!list.some((raw) => raw.id === id)) throw new Error('This identity does not exist any more.');
    return list.map((raw) => {
      if (raw.id !== id) return raw;
      const next = { ...raw };
      if (patch.name !== undefined) next.name = String(patch.name).trim().slice(0, NAME_MAX);
      if (patch.note !== undefined) next.note = String(patch.note).trim().slice(0, NOTE_MAX);
      if (patch.persona !== undefined) {
        if (patch.persona === null) delete next.persona;
        else if (isPersona(patch.persona)) next.persona = patch.persona;
        else throw new Error('These details are not valid.');
      }
      return next;
    });
  });
}

// The aliases and numbers of a deleted identity stay. Their identityId then matches
// no group, and that means "not in an identity".
export function deleteIdentity(id) {
  return mutate((list) => list.filter((raw) => raw.id !== id));
}

export function findIdentity(id) {
  return (store.get('identities') || []).find((g) => g.id === id) || null;
}

// The id of the identity that an item is in, or '' if that identity does not exist.
export function identityOf(item, state = store.get()) {
  const id = item && item.identityId;
  return id && (state.identities || []).some((g) => g.id === id) ? id : '';
}

export function membersOf(id, state = store.get()) {
  return {
    aliases: (state.aliases || []).filter((a) => a.identityId === id),
    numbers: (state.numbers || []).filter((n) => n.identityId === id),
  };
}

// Which real phones the numbers of a group forward to: [{ phone, texts, calls }].
// Forwarding counts when a switch is on and the phone is linked.
export function forwardingOf(numbers, state = store.get()) {
  const byPhone = new Map();
  for (const n of numbers) {
    if (!n.forwardPhoneId || !(n.forwardTexts || n.forwardCalls)) continue;
    const phone = (state.phones || []).find((p) => p.id === n.forwardPhoneId && p.verified);
    if (!phone) continue;
    const entry = byPhone.get(phone.id) || { phone, texts: false, calls: false };
    entry.texts = entry.texts || n.forwardTexts;
    entry.calls = entry.calls || n.forwardCalls;
    byPhone.set(phone.id, entry);
  }
  return [...byPhone.values()];
}

// An item names a group that this tab does not know: another tab may have made it.
// Load the groups again, one time for each unknown id.
const asked = new Set();
export function noticeUnknownIdentities(state = store.get()) {
  if (state.identities === null) return;
  const known = new Set(state.identities.map((g) => g.id));
  let unknown = false;
  for (const item of [...(state.aliases || []), ...(state.numbers || [])]) {
    if (item.identityId && !known.has(item.identityId) && !asked.has(item.identityId)) { asked.add(item.identityId); unknown = true; }
  }
  if (unknown) loadIdentities().catch(() => {});
}
