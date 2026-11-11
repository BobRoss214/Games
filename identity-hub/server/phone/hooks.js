// Provider webhooks: incoming texts, incoming calls, click-to-call bridge, call status.
// There is no cookie on these requests. The provider signature is mandatory.
// The mock provider runs these same handlers when it simulates a text or a call.
import { fail, reply } from '../core/http.js';
import { nowSec } from '../core/db.js';
import { randomId } from '../core/keys.js';
import { E164 } from './common.js';

const TEXT_MAX = 1600;
const PEER_MAX = 32;
const DIAL_TIMEOUT = 25;
const MAX_CALL_SECONDS = 24 * 3600;
const MAX_DIAL_SECONDS = 4 * 3600;
// Stops a forwarding loop (two numbers that forward to each other).
const FORWARDS_PER_MINUTE = 30;

const NOT_AVAILABLE = [{ say: 'The person you called is not available.' }, { hangup: true }];

export function createHooks(app, ph) {
  const { config, db, keys, store, events, log, http } = app;
  const { provider } = ph;

  function check(c) {
    let ok = false;
    try { ok = provider.verifyWebhook(c, config.publicUrl + c.req.url) === true; } catch { ok = false; }
    if (!ok) throw fail(403, 'bad_signature', 'The signature is not valid.');
  }
  const answer = (r) => reply(200, r.body, { 'content-type': r.contentType });
  // A sender is not always a phone number (short codes, names, hidden callers). Keep it short.
  const peerOf = (from) => (typeof from === 'string' && from.trim() ? from.trim().slice(0, PEER_MAX) : 'unknown');

  // The longest time that a call of this account can last: the minutes that the balance pays for.
  // The provider ends the call at this limit, so a call cannot run far past the balance.
  function timeLimit(accountId) {
    const minute = config.prices.callMinute;
    if (minute <= 0) return MAX_DIAL_SECONDS;
    return Math.min(MAX_DIAL_SECONDS, Math.max(1, Math.floor(store.balance(accountId) / minute)) * 60);
  }

  // The verified real phone that this number forwards to, in plain form. Null if there is none.
  function forwardTarget(num) {
    if (!num.forward_phone_id) return null;
    const phone = db.get('SELECT number_srv FROM phones WHERE id = ? AND account_id = ? AND verified = 1', num.forward_phone_id, num.account_id);
    return phone ? keys.srvDecrypt(phone.number_srv, 'phone').toString('utf8') : null;
  }

  async function forwardText(num, voipNumber, peer, body) {
    if (!num.forward_texts) return;
    const real = forwardTarget(num);
    // A text from the linked phone itself is not sent back to it.
    if (!real || real === peer) return;
    const price = config.prices.textOut;
    if (!store.canAfford(num.account_id, price)) return;
    if (http.limiter.hit(http.limiter.key('forward-text', num.id), FORWARDS_PER_MINUTE, 60)) return;
    try { store.charge(num.account_id, price, 'text'); } catch { return; }
    try {
      await provider.sendText({ from: voipNumber, to: real, body: `${peer}: ${body}`.slice(0, TEXT_MAX) });
    } catch {
      store.credit(num.account_id, price, 'refund');
      log.warn('a text could not be forwarded');
      return;
    }
    if (price > 0) events.publish(num.account_id, 'balance');
  }

  // An unknown or suspended number gets the same silent answer as a good one.
  async function receiveText({ to, from, body, id }) {
    const num = ph.numberByPlain(to);
    if (!num || num.status !== 'active') return;
    const peer = peerOf(from);
    const text = String(body ?? '').slice(0, TEXT_MAX);
    const sealed = await store.sealJsonFor(num.account_id, { peer, body: text }, 'text');
    // The message id of the provider stops a second delivery of the same webhook.
    const msgKey = id ? keys.indexHmac('msg', num.id + ':' + id) : null;
    const added = db.run('INSERT OR IGNORE INTO texts (id, account_id, number_id, direction, at, seen, sealed, msg_hmac) VALUES (?,?,?,?,?,?,?,?)',
      randomId(), num.account_id, num.id, 'in', nowSec(), 0, sealed, msgKey).changes;
    if (!added) return;
    events.publish(num.account_id, 'text', { numberId: num.id });
    await forwardText(num, to, peer, text);
  }

  // Returns the voice instructions for an incoming call.
  async function receiveCall({ to, from, callId }) {
    const num = ph.numberByPlain(to);
    if (!num || num.status !== 'active' || !callId) return NOT_AVAILABLE;
    const peer = peerOf(from);
    const sealed = await store.sealJsonFor(num.account_id, { peer }, 'call');
    const key = keys.indexHmac('call', callId);
    // This call is in the log already: the provider sent the webhook a second time.
    if (db.get('SELECT 1 AS x FROM calls WHERE call_hmac = ?', key)) return NOT_AVAILABLE;
    const real = num.forward_calls && num.voice ? forwardTarget(num) : null;
    if (real && real !== peer && store.canAfford(num.account_id, config.prices.callMinute)) {
      // The status webhook finds the call again with this row.
      db.run('INSERT OR IGNORE INTO live_calls (call_hmac, account_id, number_id, direction, at, sealed) VALUES (?,?,?,?,?,?)',
        key, num.account_id, num.id, 'in', nowSec(), sealed);
      // The real phone shows who calls. A hidden caller has no number that we can show.
      return [{ dial: { number: real, callerId: E164.test(peer) ? peer : null, timeout: DIAL_TIMEOUT, timeLimit: timeLimit(num.account_id), actionUrl: ph.urls.status } }];
    }
    db.run('INSERT INTO calls (id, account_id, number_id, direction, at, seconds, status, sealed, call_hmac) VALUES (?,?,?,?,?,?,?,?,?)',
      randomId(), num.account_id, num.id, 'in', nowSec(), 0, 'missed', sealed, key);
    events.publish(num.account_id, 'call', { numberId: num.id });
    return NOT_AVAILABLE;
  }

  // Click-to-call: the real phone answered. Connect it to the destination.
  function bridgeCall(token) {
    const b = ph.getBridge(token);
    if (!b) return [{ hangup: true }];
    const num = db.get('SELECT status FROM numbers WHERE id = ? AND account_id = ?', b.numberId, b.accountId);
    if (!num || num.status !== 'active' || !store.canAfford(b.accountId, config.prices.callMinute)) {
      return [{ say: 'This call cannot be connected.' }, { hangup: true }];
    }
    return [{ dial: { number: b.to, callerId: b.number, timeout: DIAL_TIMEOUT, timeLimit: timeLimit(b.accountId), actionUrl: ph.urls.status } }];
  }

  // The call ended: write the call log and charge the minutes. Only the first
  // report for a call finds its live_calls row, so a call is never charged twice.
  function finishCall({ callId, status, seconds }) {
    if (!callId || !['answered', 'missed', 'failed'].includes(status)) return;
    const key = keys.indexHmac('call', callId);
    let done = null;
    db.tx(() => {
      const live = db.get('SELECT * FROM live_calls WHERE call_hmac = ?', key);
      if (!live) return;
      db.run('DELETE FROM live_calls WHERE call_hmac = ?', key);
      if (db.get('SELECT 1 AS x FROM calls WHERE call_hmac = ?', key)) return;
      const secs = status === 'answered' && Number.isInteger(seconds) ? Math.min(Math.max(seconds, 0), MAX_CALL_SECONDS) : 0;
      // The call happened already. Take what the balance has, never more.
      const cost = Math.min(store.balance(live.account_id), Math.ceil(secs / 60) * config.prices.callMinute);
      if (cost > 0) store.charge(live.account_id, cost, 'call');
      db.run('INSERT INTO calls (id, account_id, number_id, direction, at, seconds, status, sealed, call_hmac) VALUES (?,?,?,?,?,?,?,?,?)',
        randomId(), live.account_id, live.number_id, live.direction, live.at, secs, status, live.sealed, key);
      done = { accountId: live.account_id, numberId: live.number_id, cost };
    });
    if (!done) return;
    events.publish(done.accountId, 'call', { numberId: done.numberId });
    if (done.cost > 0) events.publish(done.accountId, 'balance');
  }

  const hooks = {
    paths: { text: '/api/hooks/phone/text', voice: '/api/hooks/phone/voice', bridge: '/api/hooks/phone/bridge', status: '/api/hooks/phone/status' },
    async text(c) {
      check(c);
      await receiveText(provider.parseText(c));
      return answer(provider.textReply());
    },
    async voice(c) {
      check(c);
      return answer(provider.voiceReply(await receiveCall(provider.parseVoice(c))));
    },
    async bridge(c) {
      check(c);
      return answer(provider.voiceReply(bridgeCall(c.query.t)));
    },
    async status(c) {
      check(c);
      finishCall(provider.parseStatus(c));
      // After a <Dial> the provider asks what to do next: end the call.
      return answer(provider.voiceReply([{ hangup: true }]));
    },
  };

  const opts = { body: provider.webhookBody };
  http.post(hooks.paths.text, opts, hooks.text);
  http.post(hooks.paths.voice, opts, hooks.voice);
  http.post(hooks.paths.bridge, opts, hooks.bridge);
  http.post(hooks.paths.status, opts, hooks.status);
  return hooks;
}
