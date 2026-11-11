// Private payments (docs/API.md section 7, "Add funds").
//
// The browser makes secret credit tokens and hides ("blinds") them. The payment
// server signs the hidden values when the invoice is paid. The browser removes the
// hiding and gives the signed tokens to the account server. The payment server
// never sees the tokens, so it cannot tell which account an invoice paid for.
//
// The secret values are saved in the encrypted vault before the invoice is made.
// If the tab closes, the purchase continues on the next visit.
import { api, payApi } from './api.js';
import { store, bus } from './store.js';
import { vaultGet, vaultPut, vaultDelete, isUnlocked } from './session.js';
import { newToken, blind, unblind, b64u, unb64u } from '/shared/blind.js';
import { randomBytes } from '/shared/bytes.js';

const VAULT_KEY = 'pending-purchases';
const VAULT_SOFT_LIMIT = 250_000; // bytes; the server limit is 256 KB

let infoCache = null;
export async function payInfo({ fresh = false } = {}) {
  if (!infoCache || fresh) infoCache = await payApi.get('/api/pay/info');
  return infoCache;
}

// ---- the vault list ----
// Entry: { localId, keyId, key: { id, n, e }, units, method, tokens: [{ token, r }], invoiceId?, createdAt }
// View state (not saved): status = starting | waiting | paid | redeeming | done | expired | failed | orphan
async function readList() {
  const v = await vaultGet(VAULT_KEY, { fresh: true });
  return Array.isArray(v) ? v.filter((e) => e && typeof e === 'object' && Array.isArray(e.tokens)) : [];
}

async function writeList(list) {
  if (list.length === 0) { await vaultDelete(VAULT_KEY); return; }
  await vaultPut(VAULT_KEY, list);
}

// Read, change, write. The read happens right before the write so that a change
// from another tab is not lost.
let chain = Promise.resolve();
function mutate(fn) {
  const run = chain.then(async () => {
    const list = await readList();
    const next = fn(list) || list;
    await writeList(next);
    return next;
  });
  chain = run.catch(() => {});
  return run;
}

const view = new Map(); // localId -> { status, error, invoice }
function publish(list) {
  const purchases = list.map((e) => {
    const v = view.get(e.localId) || {};
    return {
      localId: e.localId, units: e.units, method: e.method, createdAt: e.createdAt, hasInvoice: !!e.invoiceId,
      status: v.status || (e.invoiceId ? 'waiting' : 'orphan'), error: v.error || '', checkoutUrl: v.checkoutUrl || '', expiresAt: v.expiresAt || 0,
    };
  });
  // Finished purchases stay on screen for this visit.
  for (const [id, v] of view) {
    if (v.status === 'done' && !purchases.some((p) => p.localId === id)) {
      purchases.push({ localId: id, units: v.units, method: v.method, createdAt: v.createdAt, hasInvoice: true, status: 'done', error: '', checkoutUrl: '', expiresAt: 0, credited: v.credited });
    }
  }
  purchases.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  store.set({ purchases });
}

let saved = [];
async function refresh() {
  saved = await readList();
  publish(saved);
  return saved;
}

// ---- start a purchase ----
export async function startPurchase({ units, method }) {
  const info = await payInfo({ fresh: true });
  if (!info || !info.enabled) throw new Error('Payments are turned off on this server.');
  if (!Number.isInteger(units) || units < info.minUnits || units > info.maxUnits) throw new Error(`Choose an amount from $${info.minUnits} to $${info.maxUnits}.`);

  const tokens = [];
  const blinded = [];
  for (let i = 0; i < units; i++) {
    const token = newToken();
    const b = await blind(info.key, token);
    tokens.push({ token: b64u(token), r: b64u(b.r) });
    blinded.push(b64u(b.blinded));
    if (i % 16 === 15) await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
  }
  const entry = { localId: b64u(randomBytes(9)), keyId: info.key.id, key: info.key, units, method, tokens, invoiceId: null, createdAt: Math.floor(Date.now() / 1000) };

  // 1. Save the secrets first.
  const current = await readList();
  const size = JSON.stringify([...current, entry]).length + 64;
  if (size > VAULT_SOFT_LIMIT) throw new Error('You have too many waiting payments. Finish or remove one first.');
  view.set(entry.localId, { status: 'starting' });
  await mutate((list) => [...list, entry]);
  await refresh();

  // 2. Make the invoice with no cookie.
  let invoice;
  try {
    ({ invoice } = await payApi.post('/api/pay/invoices', { units, method, keyId: info.key.id, blinded }));
  } catch (err) {
    view.delete(entry.localId);
    await mutate((list) => list.filter((e) => e.localId !== entry.localId));
    await refresh();
    throw err;
  }

  // 3. Remember which invoice belongs to the secrets.
  view.set(entry.localId, { status: 'waiting', checkoutUrl: invoice.checkoutUrl || '', expiresAt: invoice.expiresAt || 0 });
  await mutate((list) => list.map((e) => (e.localId === entry.localId ? { ...e, invoiceId: invoice.id } : e)));
  await refresh();
  startPolling();
  return { localId: entry.localId, checkoutUrl: invoice.checkoutUrl || '' };
}

// ---- check one purchase ----
const busy = new Set();
async function check(entry) {
  if (!entry.invoiceId || busy.has(entry.localId)) return;
  const v = view.get(entry.localId) || {};
  if (v.status === 'done') return;
  busy.add(entry.localId);
  try {
    let invoice;
    try {
      ({ invoice } = await payApi.get(`/api/pay/invoices/${entry.invoiceId}`));
    } catch (err) {
      if (err.status === 404) view.set(entry.localId, { ...v, status: 'expired', error: 'The payment server does not know this invoice any more.' });
      return;
    }
    if (invoice.status === 'expired') { view.set(entry.localId, { ...v, status: 'expired' }); return; }
    if (invoice.status !== 'paid' || !Array.isArray(invoice.signed)) {
      view.set(entry.localId, { ...v, status: 'waiting', error: '', checkoutUrl: invoice.checkoutUrl || '', expiresAt: invoice.expiresAt || 0 });
      return;
    }

    // Paid. Remove the hiding and hand the tokens to the account.
    view.set(entry.localId, { ...v, status: 'paid', error: '' });
    publish(saved);
    const key = entry.key && entry.key.id === (invoice.keyId || entry.keyId) ? entry.key : (await payInfo({ fresh: true })).key;
    const tokens = [];
    for (let i = 0; i < entry.tokens.length && i < invoice.signed.length; i++) {
      const t = entry.tokens[i];
      const sig = await unblind(key, unb64u(t.token), unb64u(invoice.signed[i]), unb64u(t.r));
      tokens.push({ token: t.token, sig: b64u(sig) });
      if (i % 8 === 7) await new Promise((r) => setTimeout(r, 0));
    }
    let credited = 0;
    for (let i = 0; i < tokens.length; i += 200) {
      try {
        const res = await api.post('/api/billing/redeem', { keyId: invoice.keyId || entry.keyId, tokens: tokens.slice(i, i + 200) });
        credited += res.credited || 0;
        if (typeof res.balance === 'number') store.set({ balance: res.balance });
      } catch (err) {
        if (err.code !== 'token_spent') throw err; // spent = credited on an earlier try
      }
    }
    view.set(entry.localId, { status: 'done', units: entry.units, method: entry.method, createdAt: entry.createdAt, credited });
    await mutate((list) => list.filter((e) => e.localId !== entry.localId));
    await refresh();
    bus.emit('balance', {});
  } catch (err) {
    view.set(entry.localId, { ...(view.get(entry.localId) || {}), status: 'failed', error: err && err.message ? err.message : 'The credit was not added. We try again soon.' });
  } finally {
    busy.delete(entry.localId);
  }
}

export async function checkAll() {
  if (!isUnlocked()) return;
  for (const entry of saved) await check(entry);
  publish(saved);
}

// ---- polling ----
let timer = 0;
let ticks = 0;
function startPolling() {
  ticks = 0;
  if (timer) return;
  const tick = async () => {
    timer = 0;
    if (!isUnlocked()) return;
    try { await checkAll(); } catch { /* try again on the next tick */ }
    const open = saved.some((e) => {
      const st = (view.get(e.localId) || {}).status;
      return e.invoiceId && st !== 'expired' && st !== 'done';
    });
    if (!open) return;
    ticks++;
    const wait = document.hidden ? 20_000 : ticks < 40 ? 3000 : 12_000;
    timer = setTimeout(tick, wait);
  };
  timer = setTimeout(tick, 400);
}

export function stopPolling() {
  if (timer) clearTimeout(timer);
  timer = 0;
  view.clear();
  saved = [];
  infoCache = null;
}

// Called after sign-in or unlock: continue purchases from an earlier visit.
export async function resumePurchases() {
  if (!isUnlocked()) return;
  const c = store.get('config');
  if (!c || !c.features || !c.features.pay) return;
  try {
    const list = await refresh();
    if (list.some((e) => e.invoiceId)) startPolling();
  } catch { /* the Funds screen shows the error when the person opens it */ }
}

export function pollNow() { ticks = 0; if (timer) { clearTimeout(timer); timer = 0; } startPolling(); }

// Test mode only: tells the simulated provider that the invoice is paid.
export async function simulatePayment(localId) {
  const entry = saved.find((e) => e.localId === localId);
  if (!entry || !entry.invoiceId) throw new Error('This payment has no invoice.');
  await payApi.post('/api/dev/pay-invoice', { id: entry.invoiceId });
  pollNow();
}

// Removes a purchase that was not paid. The secrets are deleted.
export async function removePurchase(localId) {
  view.delete(localId);
  await mutate((list) => list.filter((e) => e.localId !== localId));
  await refresh();
}

export function forgetDone(localId) {
  view.delete(localId);
  publish(saved);
}
