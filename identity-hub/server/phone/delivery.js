// Outgoing texts: the charge, and the delivery status that a provider reports later.
//
// This file knows no provider. A provider gives a message id ("ref") when it accepts a
// text. Later it can report "sent", "delivered" or "failed" for that id, in any order and
// more than one time. The rules:
// - A status never moves backwards, and "delivered" and "failed" are final.
// - A text that failed gives its charge back, exactly one time.
// The table text_sends has one row for each text that waits for its final status. The
// final status removes the row. That is why a second "failed" cannot pay a second time.
import { nowSec } from '../core/db.js';

const RANK = { queued: 0, sent: 1, delivered: 2, failed: 2 };
const EARLY_SECONDS = 120;
const EARLY_MAX = 2000;
// The reason of a provider goes to the log. Keep only harmless characters, and no long
// row of digits: a reason must never put a phone number into the log.
const safeReason = (t) => (typeof t === 'string' ? t.replace(/[^A-Za-z0-9 .:_-]/g, '').replace(/\d{6,}/g, '#').slice(0, 60).trim() : '');

export function createDelivery(app, ph) {
  const { config, db, keys, store, events, log } = app;
  const refKey = (ref) => keys.indexHmac('sent', ref);
  // A report can arrive before our own request to the provider has returned. Then there
  // is no row yet. The report waits here for a short time. key (base64) -> { status, errorText, expires }
  const early = new Map();

  function keepEarly(key, status, errorText) {
    const now = nowSec();
    const k = key.toString('base64');
    const old = early.get(k);
    if (old && old.expires > now && RANK[old.status] >= RANK[status]) return;
    if (early.size >= EARLY_MAX) sweep();
    if (early.size >= EARLY_MAX) early.delete(early.keys().next().value);
    early.set(k, { status, errorText, expires: now + EARLY_SECONDS });
  }

  function sweep() {
    const now = nowSec();
    for (const [k, v] of early) if (v.expires <= now) early.delete(k);
  }

  // Applies one report. Returns 'none' (no such send), 'old' (not newer than what we have), or 'done'.
  function apply(key, status, errorText) {
    let result = 'none';
    let change = null;
    db.tx(() => {
      const row = db.get('SELECT * FROM text_sends WHERE ref_hmac = ?', key);
      if (!row) return;
      if (RANK[status] <= RANK[row.status]) { result = 'old'; return; }
      result = 'done';
      const final = status === 'delivered' || status === 'failed';
      if (final) db.run('DELETE FROM text_sends WHERE ref_hmac = ?', key);
      else db.run('UPDATE text_sends SET status = ? WHERE ref_hmac = ?', status, key);
      let numberId = null;
      if (row.text_id) {
        // The user can have deleted the text. The refund below is still correct.
        const text = db.get('SELECT number_id FROM texts WHERE id = ? AND account_id = ?', row.text_id, row.account_id);
        if (text) {
          db.run('UPDATE texts SET status = ? WHERE id = ? AND account_id = ?', status, row.text_id, row.account_id);
          numberId = text.number_id;
        }
      }
      const refund = status === 'failed' ? row.charged : 0;
      if (refund > 0) store.credit(row.account_id, refund, 'refund');
      change = { accountId: row.account_id, numberId, refund };
    });
    if (change) {
      if (change.numberId) events.publish(change.accountId, 'text', { numberId: change.numberId });
      if (change.refund > 0) events.publish(change.accountId, 'balance');
      if (status === 'failed') {
        const reason = safeReason(errorText);
        log.warn('the provider did not deliver a text' + (reason ? ` (${reason})` : ''));
      }
    }
    return result;
  }

  return {
    sweep,

    // Charges one text and gives it to the provider. If the provider refuses it at once,
    // the charge comes back and the error goes to the caller.
    async sendPaidText({ accountId, from, to, body }) {
      const price = config.prices.textOut;
      store.charge(accountId, price, 'text');
      try {
        const sent = await ph.provider.sendText({ from, to, body, statusUrl: ph.urls.textStatus });
        return { ref: sent.ref, status: sent.status === 'queued' ? 'queued' : 'sent', price };
      } catch (err) {
        store.credit(accountId, price, 'refund');
        throw err;
      }
    },

    // Remembers a text that the provider accepted. textId: its row in "texts", or null for a
    // text with no row (a forwarded text, a code text). charged: the credits to give back if it fails.
    trackSend({ ref, status, accountId, textId = null, charged }) {
      if (typeof ref !== 'string' || !ref) return;
      const key = refKey(ref);
      db.run('INSERT OR IGNORE INTO text_sends (ref_hmac, account_id, text_id, charged, status, at) VALUES (?,?,?,?,?,?)',
        key, accountId, textId, charged, status === 'queued' ? 'queued' : 'sent', nowSec());
      const k = key.toString('base64');
      const waiting = early.get(k);
      if (waiting) {
        early.delete(k);
        if (waiting.expires > nowSec()) apply(key, waiting.status, waiting.errorText);
      }
    },

    // Texts that the provider took before `olderThan` (Unix seconds) and that still wait as "queued":
    // no report came at all. They fail now, and the charge comes back. Returns how many.
    failStale(olderThan) {
      let count = 0;
      for (const row of db.all("SELECT ref_hmac FROM text_sends WHERE status = 'queued' AND at < ?", olderThan)) {
        if (apply(row.ref_hmac, 'failed', 'no report') === 'done') count++;
      }
      return count;
    },

    // A provider reports the status of a text that it accepted before.
    // status: 'queued' | 'sent' | 'delivered' | 'failed'. errorText: a short reason, for the log only.
    // Returns true if the report changed something.
    reportTextStatus({ ref, status, errorText } = {}) {
      if (typeof ref !== 'string' || !ref || !Object.hasOwn(RANK, status)) return false;
      const key = refKey(ref);
      const result = apply(key, status, errorText);
      if (result === 'none') keepEarly(key, status, errorText);
      return result === 'done';
    },
  };
}
