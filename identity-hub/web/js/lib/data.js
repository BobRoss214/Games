// Loads the account's items, decrypts them in the browser, and keeps them in the store.
// Also listens to the server event stream and reloads what changed.
import { api, ApiError } from './api.js';
import { store, bus } from './store.js';
import { decLabel, encLabel, openSealed, isUnlocked, vaultGet, vaultPut } from './session.js';
import { isPersona } from './persona/index.js';
import { loadIdentities } from './identities.js';

// The encrypted label blob ("enc") of an item holds more than the label:
//   { label, note, persona?, identityId?, …fields of later versions }
// persona = random identifiers (a made name and address). identityId = the identity (group) that the item is in.
// Everything read from it is checked before use. A value in a wrong form counts as absent.
// A feature file may keep its own fields in the blob: it reads them from item.extra and writes
// them with setItemExtra(). The four fields above belong to this file.
const IDENTITY_ID = /^[A-Za-z0-9_-]{22}$/;
const OWN_FIELDS = ['label', 'note', 'persona', 'identityId'];
function readEnc(obj) {
  const o = obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  const extra = {};
  for (const [k, v] of Object.entries(o)) if (!OWN_FIELDS.includes(k)) extra[k] = v;
  return {
    label: typeof o.label === 'string' ? o.label : '',
    note: typeof o.note === 'string' ? o.note : '',
    persona: isPersona(o.persona) ? o.persona : null,
    identityId: typeof o.identityId === 'string' && IDENTITY_ID.test(o.identityId) ? o.identityId : '',
    extra,
  };
}

// Lists are reloaded often (every live event). The store changes only when the
// content is different, so that screens do not repaint for nothing.
function setList(key, value) {
  const old = store.get(key);
  if (old !== null && JSON.stringify(old) === JSON.stringify(value)) return;
  store.set({ [key]: value });
}

// ---- loaders ----
export async function loadMailboxes() {
  const { mailboxes } = await api.get('/api/mailboxes');
  const out = await Promise.all((mailboxes || []).map(async (m) => {
    const [sealed, label] = await Promise.all([openSealed(m.sealedAddress, 'address'), decLabel(m.enc, 'mailbox')]);
    const e = readEnc(label);
    return {
      id: m.id, addressId: m.addressId, address: sealed ? sealed.address : '', label: e.label, note: e.note, extra: e.extra,
      status: m.status, paidUntil: m.paidUntil, createdDay: m.createdDay, unread: m.unread || 0, total: m.total || 0,
    };
  }));
  if (!isUnlocked()) return [];
  setList('mailboxes', out);
  return out;
}

export async function loadAliases() {
  const { aliases } = await api.get('/api/aliases');
  const out = await Promise.all((aliases || []).map(async (a) => {
    const [sealed, label] = await Promise.all([openSealed(a.sealedAddress, 'address'), decLabel(a.enc, 'alias')]);
    const e = readEnc(label);
    return {
      id: a.id, mailboxId: a.mailboxId, address: sealed ? sealed.address : '', label: e.label, note: e.note, persona: e.persona, identityId: e.identityId, extra: e.extra,
      enabled: !!a.enabled, createdDay: a.createdDay, received: a.received || 0,
    };
  }));
  if (!isUnlocked()) return [];
  setList('aliases', out);
  return out;
}

export async function loadNumbers() {
  if (!phoneOn()) { store.set({ numbers: [] }); return []; }
  const { numbers } = await api.get('/api/numbers');
  const out = await Promise.all((numbers || []).map(async (n) => {
    const [sealed, label] = await Promise.all([openSealed(n.sealedNumber, 'number'), decLabel(n.enc, 'number')]);
    const e = readEnc(label);
    return {
      id: n.id, number: sealed ? sealed.number : '', label: e.label, note: e.note, persona: e.persona, identityId: e.identityId, extra: e.extra,
      country: n.country, sms: !!n.sms, voice: !!n.voice, status: n.status, paidUntil: n.paidUntil, createdDay: n.createdDay,
      forwardPhoneId: n.forwardPhoneId || null, forwardTexts: !!n.forwardTexts, forwardCalls: !!n.forwardCalls, unread: n.unread || 0,
      retentionDays: Number.isInteger(n.retentionDays) ? n.retentionDays : null, // old texts are deleted after this many days; null = never
    };
  }));
  if (!isUnlocked()) return [];
  setList('numbers', out);
  return out;
}

export async function loadPhones() {
  if (!phoneOn()) { store.set({ phones: [] }); return []; }
  const { phones } = await api.get('/api/phones');
  const out = await Promise.all((phones || []).map(async (p) => {
    const [sealed, label] = await Promise.all([openSealed(p.sealedNumber, 'phone'), decLabel(p.enc, 'phone')]);
    return { id: p.id, number: sealed ? sealed.number : '', label: label.label || '', verified: !!p.verified, createdDay: p.createdDay };
  }));
  if (!isUnlocked()) return [];
  setList('phones', out);
  return out;
}

export async function loadBalance() {
  const { account } = await api.get('/api/account');
  store.set({ account, balance: account.balance || 0 });
  return account.balance || 0;
}

export async function loadPrefs() {
  try {
    const prefs = await vaultGet('prefs');
    store.set({ prefs: prefs && typeof prefs === 'object' ? prefs : {} });
  } catch { /* preferences are optional */ }
}

export async function setPref(key, value) {
  const prefs = { ...store.get('prefs'), [key]: value };
  store.set({ prefs });
  try { await vaultPut('prefs', prefs); } catch { /* optional */ }
}

function phoneOn() {
  const c = store.get('config');
  return !!(c && c.features && c.features.phone);
}

// Loads everything for the dashboard. Each part fails on its own, so one broken
// module does not empty the whole screen.
export async function loadAll() {
  const jobs = [loadMailboxes(), loadAliases(), loadNumbers(), loadPhones(), loadBalance(), loadPrefs(), loadIdentities()];
  const results = await Promise.allSettled(jobs);
  const s = store.get();
  const patch = {};
  if (s.mailboxes === null) patch.mailboxes = [];
  if (s.aliases === null) patch.aliases = [];
  if (s.numbers === null) patch.numbers = [];
  if (s.phones === null) patch.phones = [];
  if (s.identities === null) patch.identities = [];
  if (isUnlocked()) store.set(patch);
  return results.filter((r) => r.status === 'rejected').map((r) => r.reason);
}

// Paid items renew after this many days (30 unless the server says a different value).
export const renewDays = () => { const c = store.get('config'); return (c && c.renewDays) || 30; };
// Days between "paused" and "released" for a number, or 0 if the server does not say.
export const graceDays = () => { const c = store.get('config'); return (c && Number.isInteger(c.graceDays) && c.graceDays > 0) ? c.graceDays : 0; };

// ---- label helpers ----
export const mailboxName = (m) => (m ? (m.label || m.address || 'Inbox') : 'Inbox');
export const phoneName = (p) => (p ? (p.label || p.number || 'Phone') : 'Phone');

export function findMailbox(id) { return (store.get('mailboxes') || []).find((m) => m.id === id) || null; }
export function findAlias(id) { return (store.get('aliases') || []).find((a) => a.id === id) || null; }
export function findNumber(id) { return (store.get('numbers') || []).find((n) => n.id === id) || null; }
export function findPhone(id) { return (store.get('phones') || []).find((p) => p.id === id) || null; }

// Every address this account can send from or receive at.
export function allAddresses({ onlyUsable = false } = {}) {
  const s = store.get();
  const out = [];
  for (const m of s.mailboxes || []) {
    if (onlyUsable && m.status !== 'active') continue;
    out.push({ kind: 'inbox', addressId: m.addressId, address: m.address, label: m.label, mailboxId: m.id });
  }
  for (const a of s.aliases || []) {
    const box = (s.mailboxes || []).find((m) => m.id === a.mailboxId);
    if (onlyUsable && (!a.enabled || !box || box.status !== 'active')) continue;
    out.push({ kind: 'alias', addressId: a.id, address: a.address, label: a.label, mailboxId: a.mailboxId, enabled: a.enabled });
  }
  return out;
}

// ---- changes ----
const KINDS = {
  inbox: { path: 'mailboxes', aad: 'mailbox', reload: () => loadMailboxes() },
  alias: { path: 'aliases', aad: 'alias', reload: () => loadAliases() },
  number: { path: 'numbers', aad: 'number', reload: () => loadNumbers() },
};
const ENC_MAX_CHARS = Math.floor((2048 * 4) / 3); // the server takes 2048 bytes; this is the base64url length

// Makes the new "enc" value of one item: read the newest copy from the server, change
// only what the caller changes, and keep every other field (also fields that this
// version of the app does not know). Another tab may have changed it in the meantime.
async function freshEnc(kind, id, change) {
  const k = KINDS[kind];
  const res = await api.get(`/api/${k.path}`);
  const row = ((res && res[k.path]) || []).find((r) => r.id === id);
  if (!row) throw new ApiError(404, 'not_found', 'This item does not exist any more.');
  const current = await decLabel(row.enc, k.aad);
  const next = { label: '', note: '', ...(current && typeof current === 'object' && !Array.isArray(current) ? current : {}) };
  change(next);
  const enc = await encLabel(next, k.aad);
  if (enc.length > ENC_MAX_CHARS) throw new Error('This is too much text to save here. Make the label shorter.');
  return enc;
}
async function patchEnc(kind, id, change) {
  const k = KINDS[kind];
  await api.patch(`/api/${k.path}/${id}`, { enc: await freshEnc(kind, id, change) });
  await k.reload();
}

// The first "enc" of a new item.
function newEnc(aad, { label, identityId }) {
  const obj = { label: label || '', note: '' };
  if (identityId) obj.identityId = identityId;
  return encLabel(obj, aad);
}

// Random identifiers of an alias or a number. persona = null removes them.
export function setItemPersona(kind, id, persona) {
  if (persona !== null && !isPersona(persona)) throw new Error('These identifiers are not valid.');
  return patchEnc(kind, id, (e) => { if (persona) e.persona = persona; else delete e.persona; });
}
// Puts an alias or a number in an identity. identityId = '' takes it out.
export function setItemIdentity(kind, id, identityId) {
  return patchEnc(kind, id, (e) => { if (identityId) e.identityId = identityId; else delete e.identityId; });
}
// Fields of a feature file in the encrypted blob of an inbox, an alias or a number.
// kind: 'inbox' | 'alias' | 'number'. patch: { field: value } ; null removes a field.
// The newest copy is read first and every other field is kept. Read the fields from item.extra.
export function setItemExtra(kind, id, patch) {
  if (!KINDS[kind]) throw new Error('This kind of item has no encrypted fields.');
  for (const k of Object.keys(patch)) if (OWN_FIELDS.includes(k)) throw new Error(`The field "${k}" is not a feature field.`);
  return patchEnc(kind, id, (e) => { for (const [k, v] of Object.entries(patch)) { if (v === null || v === undefined) delete e[k]; else e[k] = v; } });
}

export async function createMailbox({ localPart, domain, label }) {
  const body = { enc: await newEnc('mailbox', { label }) };
  if (localPart) body.localPart = localPart;
  if (domain) body.domain = domain;
  const res = await api.post('/api/mailboxes', body);
  await Promise.allSettled([loadMailboxes(), loadBalance()]);
  return res;
}
export function renameMailbox(id, label) {
  return patchEnc('inbox', id, (e) => { e.label = label; });
}
export async function deleteMailbox(id) {
  await api.del(`/api/mailboxes/${id}`);
  await Promise.allSettled([loadMailboxes(), loadAliases()]);
}

export async function createAlias({ mailboxId, localPart, domain, label, identityId }) {
  const body = { mailboxId, enc: await newEnc('alias', { label, identityId }) };
  if (localPart) body.localPart = localPart;
  if (domain) body.domain = domain;
  const res = await api.post('/api/aliases', body);
  await loadAliases();
  return res;
}
export async function updateAlias(id, { enabled, mailboxId, label }) {
  const body = {};
  if (enabled !== undefined) body.enabled = enabled;
  if (mailboxId !== undefined) body.mailboxId = mailboxId;
  if (label !== undefined) body.enc = await freshEnc('alias', id, (e) => { e.label = label; });
  // Show the change at once. Put the old value back if the server says no.
  const before = store.get('aliases');
  if (before && (enabled !== undefined || mailboxId !== undefined)) {
    store.set({ aliases: before.map((a) => (a.id === id ? { ...a, ...(enabled !== undefined ? { enabled } : {}), ...(mailboxId !== undefined ? { mailboxId } : {}) } : a)) });
  }
  try {
    await api.patch(`/api/aliases/${id}`, body);
  } catch (err) {
    if (before) store.set({ aliases: before });
    throw err;
  }
  await loadAliases();
}
export async function deleteAlias(id) {
  await api.del(`/api/aliases/${id}`);
  await loadAliases();
}

export async function buyNumber({ number, label, identityId }) {
  const res = await api.post('/api/numbers', { number, enc: await newEnc('number', { label, identityId }) });
  await Promise.allSettled([loadNumbers(), loadBalance()]);
  return res;
}
export async function updateNumber(id, { label, forwardPhoneId, forwardTexts, forwardCalls, retentionDays }) {
  const body = {};
  if (label !== undefined) body.enc = await freshEnc('number', id, (e) => { e.label = label; });
  if (forwardPhoneId !== undefined) body.forwardPhoneId = forwardPhoneId;
  if (forwardTexts !== undefined) body.forwardTexts = forwardTexts;
  if (forwardCalls !== undefined) body.forwardCalls = forwardCalls;
  if (retentionDays !== undefined) body.retentionDays = retentionDays;
  await api.patch(`/api/numbers/${id}`, body);
  await loadNumbers();
}
export async function releaseNumber(id) {
  await api.del(`/api/numbers/${id}`);
  await loadNumbers();
}

// method: 'text' (a text with the code) or 'call' (a call that speaks the code).
export async function linkPhone({ number, label, via, method = 'text' }) {
  const res = await api.post('/api/phones', { number, method, enc: await encLabel({ label: label || '' }, 'phone'), via: { numberId: via.id, number: via.number } });
  await Promise.allSettled([loadPhones(), loadBalance()]);
  return res.phone;
}
// The same request for a phone that is not linked yet sends a new code. The label stays.
export async function sendPhoneCode(phone, via, method = 'text') {
  await api.post('/api/phones', { number: phone.number, method, via: { numberId: via.id, number: via.number } });
  await loadBalance().catch(() => {});
}
export async function verifyPhone(id, code) {
  await api.post(`/api/phones/${id}/verify`, { code });
  await loadPhones();
}
export async function removePhone(id) {
  await api.del(`/api/phones/${id}`);
  await Promise.allSettled([loadPhones(), loadNumbers()]);
}

// ---- live updates ----
let source = null;
let reloadTimers = new Map();

// Many events can arrive together (ten mails at once). Reload each kind one time.
function soon(kind, fn) {
  if (reloadTimers.has(kind)) return;
  reloadTimers.set(kind, setTimeout(() => {
    reloadTimers.delete(kind);
    if (!isUnlocked()) return;
    Promise.resolve().then(fn).catch(() => { /* the next event or reload fixes it */ });
  }, 150));
}

function onChange(ev) {
  let data;
  try { data = JSON.parse(ev.data); } catch { return; }
  if (!data || typeof data.type !== 'string') return;
  const type = data.type;
  if (type === 'mail') soon('mail', async () => { await Promise.allSettled([loadMailboxes(), loadAliases()]); bus.emit('mail', data); });
  else if (type === 'text') soon('text', async () => { await Promise.allSettled([loadNumbers(), loadBalance()]); bus.emit('text', data); });
  else if (type === 'call') soon('call', async () => { await Promise.allSettled([loadNumbers(), loadBalance()]); bus.emit('call', data); });
  else if (type === 'balance') soon('balance', async () => { await loadBalance(); bus.emit('balance', data); });
  else if (type === 'mailbox' || type === 'mailboxes') soon('mailbox', async () => { await Promise.allSettled([loadMailboxes(), loadAliases()]); bus.emit('mailbox', data); });
  else if (type === 'number' || type === 'numbers') soon('number', async () => { await loadNumbers(); bus.emit('number', data); });
  else if (type === 'aliases' || type === 'alias') soon('aliases', async () => { await loadAliases(); bus.emit('aliases', data); });
  else if (type === 'phones' || type === 'phone') soon('phones', async () => { await Promise.allSettled([loadPhones(), loadNumbers()]); bus.emit('phones', data); });
}

export function startEvents() {
  stopEvents();
  if (typeof EventSource !== 'function') return;
  source = new EventSource('/api/events');
  source.addEventListener('change', onChange);
  // EventSource reconnects by itself. After a reconnect the lists may be old, so reload them.
  let wasOpen = false;
  source.addEventListener('open', () => {
    if (wasOpen && isUnlocked()) { loadAll().catch(() => {}); bus.emit('mail', {}); bus.emit('text', {}); bus.emit('call', {}); }
    wasOpen = true;
  });
}

export function stopEvents() {
  if (source) { source.close(); source = null; }
  for (const t of reloadTimers.values()) clearTimeout(t);
  reloadTimers = new Map();
}

