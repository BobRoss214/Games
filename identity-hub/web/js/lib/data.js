// Loads the account's items, decrypts them in the browser, and keeps them in the store.
// Also listens to the server event stream and reloads what changed.
import { api } from './api.js';
import { store, bus } from './store.js';
import { decLabel, encLabel, openSealed, isUnlocked, vaultGet, vaultPut } from './session.js';

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
    return {
      id: m.id, addressId: m.addressId, address: sealed ? sealed.address : '', label: label.label || '', note: label.note || '',
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
    return {
      id: a.id, mailboxId: a.mailboxId, address: sealed ? sealed.address : '', label: label.label || '', note: label.note || '',
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
    return {
      id: n.id, number: sealed ? sealed.number : '', label: label.label || '', note: label.note || '',
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
  const jobs = [loadMailboxes(), loadAliases(), loadNumbers(), loadPhones(), loadBalance(), loadPrefs()];
  const results = await Promise.allSettled(jobs);
  const s = store.get();
  const patch = {};
  if (s.mailboxes === null) patch.mailboxes = [];
  if (s.aliases === null) patch.aliases = [];
  if (s.numbers === null) patch.numbers = [];
  if (s.phones === null) patch.phones = [];
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
export async function createMailbox({ localPart, domain, label }) {
  const body = { enc: await encLabel({ label: label || '', note: '' }, 'mailbox') };
  if (localPart) body.localPart = localPart;
  if (domain) body.domain = domain;
  const res = await api.post('/api/mailboxes', body);
  await Promise.allSettled([loadMailboxes(), loadBalance()]);
  return res;
}
export async function renameMailbox(id, label) {
  const box = findMailbox(id);
  await api.patch(`/api/mailboxes/${id}`, { enc: await encLabel({ label, note: box ? box.note : '' }, 'mailbox') });
  await loadMailboxes();
}
export async function deleteMailbox(id) {
  await api.del(`/api/mailboxes/${id}`);
  await Promise.allSettled([loadMailboxes(), loadAliases()]);
}

export async function createAlias({ mailboxId, localPart, domain, label }) {
  const body = { mailboxId, enc: await encLabel({ label: label || '', note: '' }, 'alias') };
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
  if (label !== undefined) {
    const a = findAlias(id);
    body.enc = await encLabel({ label, note: a ? a.note : '' }, 'alias');
  }
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

export async function buyNumber({ number, label }) {
  const res = await api.post('/api/numbers', { number, enc: await encLabel({ label: label || '', note: '' }, 'number') });
  await Promise.allSettled([loadNumbers(), loadBalance()]);
  return res;
}
export async function updateNumber(id, { label, forwardPhoneId, forwardTexts, forwardCalls, retentionDays }) {
  const body = {};
  if (label !== undefined) {
    const n = findNumber(id);
    body.enc = await encLabel({ label, note: n ? n.note : '' }, 'number');
  }
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

