// "Own phone": the webhook of the phones, online and offline, and texts that got no report.
//
// The PHONE posts each event to POST /api/hooks/ownphone/<token>. The token says which phone
// it is (the database has a keyed hash of it). The phone signs each request:
//   X-Timestamp = Unix seconds, X-Signature = hex(HMAC-SHA256(signing key, raw body + X-Timestamp))
// A request with a wrong signature, or with a time that is more than 5 minutes off, is refused.
// Body: { id, webhookId, deviceId, event, payload }.
//
// Nothing here writes a number or a message text to the log.
import { createHmac } from 'node:crypto';
import { fail } from '../core/http.js';
import { nowSec } from '../core/db.js';
import { safeEqual } from '../core/keys.js';
import { E164 } from './common.js';

const CLOCK_SECONDS = 5 * 60;
// The number of a SIM in the national form must have this many digits to name a pool number.
const NATIONAL_MIN_DIGITS = 7;
const DEVICE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const BODY_LIMIT = 256 * 1024;
// After the time to live of a text, the phone reports "failed". If that report never comes
// (the phone is gone), this much later the server says "failed" itself and gives the charge back.
const NO_REPORT_GRACE_SECONDS = 10 * 60;
const STATUS_OF = { 'sms:sent': 'sent', 'sms:delivered': 'delivered', 'sms:failed': 'failed' };

export const hookPath = (token) => `/api/hooks/ownphone/${token}`;
// The signature that a phone puts on a webhook. Tests and the fake phone use it too.
export const signWebhook = (signingKey, rawBody, timestamp) => createHmac('sha256', Buffer.from(String(signingKey), 'utf8')).update(Buffer.concat([Buffer.from(rawBody), Buffer.from(String(timestamp), 'utf8')])).digest('hex');

// hooks: the result of createHooks() (its receiveText is the normal path of an incoming text).
export function registerOwnPhone(app, ph, hooks, pool) {
  const { config, http, events, log } = app;
  const settings = config.phone.ownphone;

  // Tells the accounts that hold a number of this phone that something about it changed.
  function tellHolders(deviceId) {
    for (const row of pool.heldNumbers({ deviceId })) events.publish(row.account_id, 'number', { numberId: row.id });
  }

  // The number object of an account says if the phone of the number is online.
  ph.gatewayOf = (row) => pool.gatewayOf(row.number_hmac) || { online: false, lastSeen: null };

  // Returns 'ok', or why the request is refused: 'signature' (wrong or absent), or 'clock'
  // (signed well, but its time is more than 5 minutes off: the clock of the phone is wrong,
  // or somebody sends a recorded request again).
  function verify(c, device) {
    const stamp = c.headers['x-timestamp'];
    const given = c.headers['x-signature'];
    if (typeof stamp !== 'string' || !/^\d{1,12}$/.test(stamp) || typeof given !== 'string' || !/^[0-9a-fA-F]{64}$/.test(given)) return 'signature';
    // Compare first, in constant time. Then the time.
    if (!safeEqual(Buffer.from(given.toLowerCase(), 'utf8'), Buffer.from(signWebhook(device.signingKey, c.raw, stamp), 'utf8'))) return 'signature';
    return Math.abs(nowSec() - Number(stamp)) <= CLOCK_SECONDS ? 'ok' : 'clock';
  }

  // The pool number that got an incoming text, in plain form, or null.
  function receivingNumber(device, payload) {
    if (Number.isInteger(payload.simNumber)) {
      const sim = pool.sim(device.id, payload.simNumber);
      return sim ? sim.number : null;
    }
    // The phone could not say which SIM it was. It can still know the number of the SIM.
    const sims = pool.sims(device.id);
    if (typeof payload.recipient === 'string') {
      const clean = payload.recipient.replace(/[\s().-]/g, '');
      const sim = E164.test(clean) ? pool.simByNumber(clean) : null;
      if (sim && sim.deviceId === device.id) return sim.number;
      // A phone often has the number of its SIM in the national form ("(415) 555-0123", "07700 900123").
      // Take it when its digits are the end of exactly one number of this phone.
      const digits = payload.recipient.replace(/\D/g, '').replace(/^0+/, '');
      if (digits.length >= NATIONAL_MIN_DIGITS) {
        const fits = sims.filter((s) => s.number.slice(1).endsWith(digits));
        if (fits.length === 1) return fits[0].number;
      }
    }
    return sims.length === 1 ? sims[0].number : null;
  }

  http.post('/api/hooks/ownphone/:token', { body: 'raw', limit: BODY_LIMIT }, async (c) => {
    const device = pool.deviceByToken(c.params.token);
    if (!device) throw fail(404, 'not_found', 'This address does not exist.');
    const checked = verify(c, device);
    if (checked !== 'ok') {
      // The operator sees these counts in the tool ("list"): a wrong key, or a wrong clock on the phone.
      pool.refused(device.id, checked);
      throw fail(403, 'bad_signature', 'The signature is not valid.');
    }
    let body = null;
    try { body = JSON.parse(c.raw.toString('utf8')); } catch { body = null; }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'bad_json', 'Send a JSON object.');
    if (body.deviceId !== device.gatewayId) {
      // The token names our record of the phone, and the signature shows that the sender has its key.
      // If this login of the gateway has only this one phone in the pool, the phone got a new id at the
      // gateway (the app was set up again): take the new id, so that sending works too.
      // With several phones on one login, the key is the same for all of them: the id must match.
      const alone = typeof body.deviceId === 'string' && DEVICE_ID.test(body.deviceId) && pool.countOfLogin(device.login) === 1;
      if (!alone) {
        pool.refused(device.id, 'device');
        return { ok: true };
      }
      pool.setGatewayId(device.id, body.deviceId);
      log.warn('a phone of the pool reported a different device id than the stored one; the new id was stored');
    }

    // Every valid webhook says that the phone is alive.
    if (pool.seen(device.id)) tellHolders(device.id);

    const payload = body.payload !== null && typeof body.payload === 'object' && !Array.isArray(body.payload) ? body.payload : {};
    if (body.event === 'sms:received') {
      const to = receivingNumber(device, payload);
      // The operator must learn about a SIM slot that the pool does not know: its texts are lost.
      if (!to) log.warn('a text arrived at a phone of the pool, and its SIM is not known or not in the pool; it was dropped');
      // A text for a pool number that no account holds is dropped inside receiveText: it is not stored.
      if (to && typeof payload.message === 'string') {
        const sender = typeof payload.phoneNumber === 'string' && payload.phoneNumber ? payload.phoneNumber : payload.sender;
        // The message id of the phone is a short hash. With the time of the text it names one text.
        const id = typeof payload.messageId === 'string' && payload.messageId
          ? `${payload.messageId.slice(0, 64)}|${typeof payload.receivedAt === 'string' ? payload.receivedAt.slice(0, 40) : ''}` : '';
        await hooks.receiveText({ to, from: sender, body: payload.message, id });
      }
    } else if (Object.hasOwn(STATUS_OF, body.event)) {
      // messageId is the id that this server gave the text when it sent it.
      if (typeof payload.messageId === 'string' && payload.messageId.length <= 64) {
        ph.reportTextStatus({ ref: payload.messageId, status: STATUS_OF[body.event], errorText: typeof payload.reason === 'string' ? payload.reason : '' });
      }
    }
    // system:ping and every other event: nothing more to do.
    return { ok: true };
  });

  // Online and offline. A webhook makes a phone online at once (above). This job sees when a
  // phone was silent for too long, and tells the accounts that hold its numbers.
  app.every('ownphone-online', 60, async () => {
    const changed = pool.changedStates();
    for (const d of changed) tellHolders(d.id);
    const off = changed.filter((d) => !d.online).length;
    if (off) log.warn(`${off} phone(s) of the pool went offline`);
  });

  // A text that the gateway took and that got no report at all.
  app.every('ownphone-unsent', 60, async () => {
    ph.failStaleTexts(nowSec() - (Math.max(5, settings.textTtlSeconds) + NO_REPORT_GRACE_SECONDS));
  });

  // Development only: run the two jobs now. They run each minute by themselves; a test does not wait for that.
  if (config.dev) {
    http.post('/api/dev/ownphone-jobs', { auth: true }, async () => {
      await app.runJobs('ownphone-online');
      await app.runJobs('ownphone-unsent');
    });
  }
}
