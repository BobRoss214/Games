// Routes for the signed-in account: numbers, texts, calls, linked real phones.
// Every query has account_id = ?. Unknown and foreign IDs give 404.
import { randomInt } from 'node:crypto';
import { fail, reply, need, b64u } from '../core/http.js';
import { nowSec, today } from '../core/db.js';
import { randomId, randomToken, sha256, safeEqual } from '../core/keys.js';
import { PERIOD_SECONDS } from '../core/renew.js';
import { ProviderError } from './providers/errors.js';
import { E164 } from './common.js';

const TEXT_MAX = 1600;
const CODE_SECONDS = 10 * 60;
const CODE_TRIES = 5;
const RETENTION_MAX_DAYS = 3650;
const NOT_AVAILABLE = 'This number is not available. Choose a different one.';

export function registerRoutes(app, ph) {
  const { config, db, http, keys, store, events } = app;
  const { provider } = ph;

  const e164 = (v, name) => need.string(v, name, { max: 16, pattern: E164 });
  const idOf = (v, name = 'id') => need.string(v, name, { max: 64 });
  const encOf = (v) => need.optional(v, need.bytes, 'enc', { max: 2048 });

  function intParam(v, name, min = 0) {
    if (typeof v !== 'string' || !/^\d{1,15}$/.test(v)) throw fail(400, 'bad_request', `The value "${name}" is not valid.`);
    return need.int(Number(v), name, { min });
  }

  const NUMBER_COLS = `n.*, (SELECT COUNT(*) FROM texts t WHERE t.number_id = n.id AND t.direction = 'in' AND t.seen = 0) AS unread`;
  const numberView = (r) => ({
    id: r.id, sealedNumber: b64u(r.sealed_number), enc: b64u(r.enc), country: r.country, sms: r.sms === 1, voice: ph.hasVoice(r),
    status: r.status, paidUntil: r.paid_until, createdDay: r.created_day,
    forwardPhoneId: r.forward_phone_id, forwardTexts: r.forward_texts === 1, forwardCalls: r.forward_calls === 1,
    retentionDays: r.retention_days ?? null, voicemail: r.voicemail === 1, unread: r.unread || 0,
    // Own phone only: is the phone of this number online? Other providers: null.
    gateway: ph.gatewayOf(r),
  });
  const loadNumber = (accountId, id) => numberView(db.get(`SELECT ${NUMBER_COLS} FROM numbers n WHERE n.id = ? AND n.account_id = ?`, id, accountId));
  const phoneView = (r) => ({ id: r.id, sealedNumber: b64u(r.sealed_number), enc: b64u(r.enc), verified: r.verified === 1, createdDay: r.created_day });
  // status: the delivery status of a text that we sent. An incoming text has none.
  const textView = (r) => ({ id: r.id, direction: r.direction, at: r.at, seen: r.seen === 1, sealed: b64u(r.sealed), status: r.direction === 'out' ? r.status || 'sent' : null });
  // v: the voicemail row of the call, if it has one. The audio itself comes from GET /api/calls/:id/voicemail.
  const callView = (r, v) => ({
    id: r.id, direction: r.direction, at: r.at, seconds: r.seconds, status: r.status, sealed: b64u(r.sealed),
    voicemail: v ? { seconds: v.seconds, size: v.size, sealedKey: b64u(v.sealed_key), encMeta: b64u(v.enc_meta) } : null,
  });

  function ownPhone(accountId, id) {
    const row = db.get('SELECT * FROM phones WHERE id = ? AND account_id = ?', idOf(id), accountId);
    if (!row) throw fail(404, 'not_found', 'This phone does not exist.');
    return row;
  }

  // One page of texts or calls, newest first. `before` is the `at` value of the last row
  // of the page before. Rows of the same second are never split over two pages, so that
  // `before` cannot skip a row. A page can be a little longer than `limit` for that reason.
  function page(table, cols, accountId, numberId, query, { def, max }) {
    const before = query.before ? intParam(query.before, 'before') : Number.MAX_SAFE_INTEGER;
    const limit = query.limit ? Math.min(max, intParam(query.limit, 'limit', 1)) : def;
    const where = `FROM ${table} WHERE account_id = ? AND number_id = ?`;
    let rows = db.all(`SELECT ${cols} ${where} AND at < ? ORDER BY at DESC, rowid DESC LIMIT ?`, accountId, numberId, before, limit + 1);
    let more = false;
    if (rows.length > limit) {
      const lastAt = rows[limit - 1].at;
      rows = db.all(`SELECT ${cols} ${where} AND at < ? AND at >= ? ORDER BY at DESC, rowid DESC LIMIT 1000`, accountId, numberId, before, lastAt);
      more = Boolean(db.get(`SELECT 1 AS x ${where} AND at < ? LIMIT 1`, accountId, numberId, lastAt));
    }
    return { rows, more };
  }

  // ---- numbers ----

  http.get('/api/numbers/search', { auth: true, rate: { max: 30, per: 60 } }, async (c) => {
    ph.requireOn();
    // A fixed pool (own phone) is small: with no country the search gives every free number of it.
    const pool = ph.capabilities.pool === true;
    const country = pool && !c.query.country ? undefined
      : need.string(c.query.country || config.phone.countries[0], 'country', { min: 2, max: 2, pattern: /^[A-Za-z]{2}$/ }).toUpperCase();
    if (!pool && !config.phone.countries.includes(country)) throw fail(400, 'bad_request', 'Numbers in this country are not available.');
    let areaCode = need.optional(c.query.areaCode || undefined, need.string, 'areaCode', { max: 6, pattern: /^\d{1,6}$/ });
    if (!ph.capabilities.searchByArea) areaCode = undefined;
    let found;
    try { found = await provider.search({ country, areaCode, limit: 20 }); } catch (err) { throw ph.providerFail(err); }
    const numbers = [];
    for (const n of found) {
      if (numbers.length >= 20) break;
      if (typeof n.number !== 'string' || !E164.test(n.number) || ph.numberByPlain(n.number)) continue;
      const item = {
        number: n.number, locality: String(n.locality || ''), region: String(n.region || ''), country: String(n.country || country || ''),
        sms: Boolean(n.sms), voice: Boolean(n.voice) && ph.capabilities.voice,
      };
      numbers.push(item);
      // Only a number from a search of this account can be bought.
      ph.addOffer(c.account.id, item);
    }
    return { numbers };
  });

  http.get('/api/numbers', { auth: true }, (c) => ({
    numbers: db.all(`SELECT ${NUMBER_COLS} FROM numbers n WHERE n.account_id = ? ORDER BY n.rowid`, c.account.id).map(numberView),
  }));

  http.post('/api/numbers', { auth: true }, async (c) => {
    ph.requireOn();
    const accountId = c.account.id;
    const number = e164(c.body.number, 'number');
    const enc = encOf(c.body.enc);
    return ph.lock(accountId, async () => {
      const count = db.get('SELECT COUNT(*) AS n FROM numbers WHERE account_id = ?', accountId).n;
      if (count >= config.limits.numbers) throw fail(409, 'limit_reached', 'You have the maximum count of numbers. Delete a number first.');
      const offer = ph.getOffer(accountId, number);
      if (!offer || ph.numberByPlain(number)) throw fail(409, 'taken', NOT_AVAILABLE);

      // Seal before the purchase: after it, nothing may fail for a reason that we can see now.
      const sealedNumber = await store.sealJsonFor(accountId, { number }, 'number');
      const price = config.prices.numberMonth;
      store.charge(accountId, price, 'number');
      let ref;
      try {
        ({ ref } = await provider.buy(number, { textUrl: ph.urls.text, voiceUrl: ph.urls.voice, statusUrl: ph.urls.status }));
      } catch (err) {
        store.credit(accountId, price, 'refund');
        if (err instanceof ProviderError && err.unavailable) throw fail(409, 'taken', NOT_AVAILABLE);
        throw ph.providerFail(err);
      }
      const id = randomId();
      const encRef = keys.srvEncrypt(ref, 'ref');
      try {
        db.run(
          `INSERT INTO numbers (id, account_id, number_hmac, sealed_number, provider_ref, country, sms, voice, enc, status, paid_until, created_day)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          id, accountId, keys.indexHmac('num', number), sealedNumber, encRef, offer.country, offer.sms ? 1 : 0, offer.voice ? 1 : 0,
          enc ?? null, 'active', nowSec() + PERIOD_SECONDS, today(),
        );
      } catch (err) {
        // We have the number at the provider and no row for it. Give it back and return the charge.
        try { await ph.releaseAtProvider({ provider_ref: encRef }); } catch { ph.releaseLater(encRef); }
        store.credit(accountId, price, 'refund');
        if (String(err.message).includes('UNIQUE')) throw fail(409, 'taken', NOT_AVAILABLE);
        throw err;
      }
      ph.dropOffer(accountId, number);
      events.publish(accountId, 'number', { numberId: id });
      if (price > 0) events.publish(accountId, 'balance');
      return reply(201, { number: loadNumber(accountId, id), plain: number });
    });
  });

  http.patch('/api/numbers/:id', { auth: true }, (c) => {
    const accountId = c.account.id;
    const num = ph.ownNumber(accountId, c.params.id);
    const b = c.body;
    const sets = [];
    const args = [];
    const enc = encOf(b.enc);
    if (enc) { sets.push('enc = ?'); args.push(enc); }
    const texts = need.optional(b.forwardTexts, need.bool, 'forwardTexts');
    const calls = need.optional(b.forwardCalls, need.bool, 'forwardCalls');
    if (calls === true) ph.requireVoice(num);
    // Voicemail needs calls: a number and a provider with voice, and a provider that can record.
    const voicemail = need.optional(b.voicemail, need.bool, 'voicemail');
    if (voicemail === true) {
      ph.requireVoice(num);
      if (!ph.capabilities.voicemail) throw fail(409, 'no_voicemail', 'Voicemail is not available for this number.');
    }
    if (voicemail !== undefined) { sets.push('voicemail = ?'); args.push(voicemail ? 1 : 0); }
    // Auto-delete of texts: null = off, or a count of days. The hourly job does the deleting.
    if (b.retentionDays === null) sets.push('retention_days = NULL');
    else if (b.retentionDays !== undefined) {
      sets.push('retention_days = ?');
      args.push(need.int(b.retentionDays, 'retentionDays', { min: 1, max: RETENTION_MAX_DAYS }));
    }
    if (b.forwardPhoneId === null) {
      // No phone, no forwarding. A phone that is linked later must not start to ring by surprise.
      sets.push('forward_phone_id = NULL', 'forward_texts = 0', 'forward_calls = 0');
    } else {
      if (b.forwardPhoneId !== undefined) {
        const phone = ownPhone(accountId, b.forwardPhoneId);
        if (!phone.verified) throw fail(409, 'conflict', 'Verify this phone first.');
        sets.push('forward_phone_id = ?');
        args.push(phone.id);
      }
      if (texts !== undefined) { sets.push('forward_texts = ?'); args.push(texts ? 1 : 0); }
      if (calls !== undefined) { sets.push('forward_calls = ?'); args.push(calls ? 1 : 0); }
    }
    if (sets.length) {
      db.run(`UPDATE numbers SET ${sets.join(', ')} WHERE id = ? AND account_id = ?`, ...args, num.id, accountId);
      events.publish(accountId, 'number', { numberId: num.id });
    }
    return { number: loadNumber(accountId, num.id) };
  });

  http.del('/api/numbers/:id', { auth: true }, async (c) => {
    ph.requireOn();
    const accountId = c.account.id;
    const num = ph.ownNumber(accountId, c.params.id);
    // The provider first. If it fails, the row stays, and the user can try again.
    try { await ph.releaseAtProvider(num); } catch (err) { throw ph.providerFail(err); }
    ph.deleteNumber(accountId, num.id);
    for (const [token, b] of ph.bridges) if (b.numberId === num.id) ph.bridges.delete(token);
    events.publish(accountId, 'number', { numberId: num.id });
  });

  // ---- texts ----

  http.get('/api/numbers/:id/texts', { auth: true }, (c) => {
    const num = ph.ownNumber(c.account.id, c.params.id);
    const { rows, more } = page('texts', 'id, direction, at, seen, sealed, status', c.account.id, num.id, c.query, { def: 100, max: 200 });
    return { texts: rows.map(textView), more };
  });

  http.post('/api/numbers/:id/texts', { auth: true, rate: { max: 30, per: 60 } }, async (c) => {
    ph.requireOn();
    const accountId = c.account.id;
    const num = ph.ownNumber(accountId, c.params.id);
    const number = e164(c.body.number, 'number');
    const to = e164(c.body.to, 'to');
    const body = need.string(c.body.body, 'body', { max: TEXT_MAX });
    ph.matchPlain(num, number);
    ph.requireActive(num);
    if (!num.sms) throw fail(409, 'conflict', 'This number cannot send texts.');
    ph.checkDestination(to);

    const sealed = await store.sealJsonFor(accountId, { peer: to, body }, 'text');
    let sent;
    // If the provider refuses the text at once, the charge comes back inside sendPaidText.
    try { sent = await ph.sendPaidText({ accountId, from: number, to, body }); } catch (err) { throw ph.providerFail(err); }
    const row = { id: randomId(), direction: 'out', at: nowSec(), seen: 1, sealed, status: sent.status };
    db.run('INSERT INTO texts (id, account_id, number_id, direction, at, seen, sealed, status) VALUES (?,?,?,?,?,?,?,?)',
      row.id, accountId, num.id, row.direction, row.at, row.seen, row.sealed, row.status);
    // A later status report of the provider finds the row through this. A late failure returns the charge.
    ph.trackSend({ ref: sent.ref, status: sent.status, accountId, textId: row.id, charged: sent.price });
    events.publish(accountId, 'text', { numberId: num.id });
    if (sent.price > 0) events.publish(accountId, 'balance');
    // The row can have a newer status already, if the report was faster than this request.
    return reply(201, { text: textView(db.get('SELECT id, direction, at, seen, sealed, status FROM texts WHERE id = ? AND account_id = ?', row.id, accountId) || row) });
  });

  http.post('/api/numbers/:id/texts/seen', { auth: true }, (c) => {
    const num = ph.ownNumber(c.account.id, c.params.id);
    const changed = db.run('UPDATE texts SET seen = 1 WHERE account_id = ? AND number_id = ? AND seen = 0', c.account.id, num.id).changes;
    // No event when nothing changed. An app that marks texts as seen after each event would loop.
    if (changed) events.publish(c.account.id, 'text', { numberId: num.id });
  });

  http.del('/api/texts/:id', { auth: true }, (c) => {
    const row = db.get('SELECT number_id FROM texts WHERE id = ? AND account_id = ?', idOf(c.params.id), c.account.id);
    if (!row) throw fail(404, 'not_found', 'This text does not exist.');
    ph.deleteTexts(c.account.id, row.number_id, { textId: c.params.id });
    events.publish(c.account.id, 'text', { numberId: row.number_id });
  });

  // ---- calls ----

  http.get('/api/numbers/:id/calls', { auth: true }, (c) => {
    const num = ph.ownNumber(c.account.id, c.params.id);
    const accountId = c.account.id;
    const { rows, more } = page('calls', 'id, direction, at, seconds, status, sealed', accountId, num.id, c.query, { def: 100, max: 200 });
    // The voicemails of the calls on this page (the page is one range of time).
    const voicemails = new Map();
    if (rows.length) {
      const found = db.all(
        `SELECT call_id, seconds, size, sealed_key, enc_meta FROM voicemails WHERE account_id = ?
         AND call_id IN (SELECT id FROM calls WHERE account_id = ? AND number_id = ? AND at >= ? AND at <= ?)`,
        accountId, accountId, num.id, rows.at(-1).at, rows[0].at,
      );
      for (const v of found) voicemails.set(v.call_id, v);
    }
    return { calls: rows.map((r) => callView(r, voicemails.get(r.id))), more };
  });

  // The encrypted audio of a voicemail: part 1 of the message envelope. The browser opens it
  // with the content key (sealedKey of the call's voicemail) and openAttachment(key, bytes, 1).
  http.get('/api/calls/:id/voicemail', { auth: true }, (c) => {
    const row = db.get('SELECT audio FROM voicemails WHERE call_id = ? AND account_id = ?', idOf(c.params.id), c.account.id);
    if (!row) throw fail(404, 'not_found', 'This call has no voicemail.');
    return reply(200, Buffer.from(row.audio), { 'content-type': 'application/octet-stream' });
  });

  // Click-to-call: the provider calls the linked real phone. When it answers, the
  // bridge webhook connects it to `to`, and `to` sees the VoIP number as the caller.
  http.post('/api/numbers/:id/calls', { auth: true, rate: { max: 10, per: 60 } }, async (c) => {
    ph.requireOn();
    const accountId = c.account.id;
    const num = ph.ownNumber(accountId, c.params.id);
    const number = e164(c.body.number, 'number');
    const to = e164(c.body.to, 'to');
    ph.matchPlain(num, number);
    ph.requireActive(num);
    ph.requireVoice(num);
    ph.checkDestination(to);
    const phone = num.forward_phone_id
      ? db.get('SELECT number_srv FROM phones WHERE id = ? AND account_id = ? AND verified = 1', num.forward_phone_id, accountId)
      : null;
    if (!phone) throw fail(409, 'no_phone', 'Link a verified phone to this number first.');
    const minute = config.prices.callMinute;
    if (!store.canAfford(accountId, minute)) throw fail(402, 'insufficient_funds', 'Your balance is too low. Add funds first.', { needed: minute });

    const real = keys.srvDecrypt(phone.number_srv, 'phone').toString('utf8');
    const sealed = await store.sealJsonFor(accountId, { peer: to }, 'call');
    const token = randomToken();
    ph.addBridge(token, { accountId, numberId: num.id, number, to });
    let ref;
    try {
      ({ ref } = await provider.startCall({ from: number, to: real, answerUrl: ph.urls.bridge(token), statusUrl: ph.urls.status }));
    } catch (err) {
      ph.bridges.delete(token);
      throw ph.providerFail(err);
    }
    // The status webhook writes the call log and charges the minutes with this row.
    db.run('INSERT OR IGNORE INTO live_calls (call_hmac, account_id, number_id, direction, at, sealed) VALUES (?,?,?,?,?,?)',
      keys.indexHmac('call', ref), accountId, num.id, 'out', nowSec(), sealed);
    return reply(201, { ok: true });
  });

  http.del('/api/calls/:id', { auth: true }, (c) => {
    const row = db.get('SELECT number_id FROM calls WHERE id = ? AND account_id = ?', idOf(c.params.id), c.account.id);
    if (!row) throw fail(404, 'not_found', 'This call does not exist.');
    db.run('DELETE FROM calls WHERE id = ? AND account_id = ?', c.params.id, c.account.id);
    events.publish(c.account.id, 'call', { numberId: row.number_id });
  });

  // ---- linked real phones ----

  http.get('/api/phones', { auth: true }, (c) => ({
    phones: db.all('SELECT * FROM phones WHERE account_id = ? ORDER BY rowid', c.account.id).map(phoneView),
  }));

  // Links a real phone. A code goes to it from one of the account's VoIP numbers: by text,
  // or by a call that speaks the code (US numbers cannot send texts without carrier registration).
  // The same request for a phone that is not verified yet sends a new code.
  http.post('/api/phones', { auth: true, rate: { max: 5, per: 3600 } }, async (c) => {
    ph.requireOn();
    const accountId = c.account.id;
    const number = e164(c.body.number, 'number');
    const enc = encOf(c.body.enc);
    const method = c.body.method === undefined || c.body.method === null ? 'text' : c.body.method;
    if (method !== 'text' && method !== 'call') throw fail(400, 'bad_request', 'The value "method" is not valid.');
    const active = db.get("SELECT COUNT(*) AS n FROM numbers WHERE account_id = ? AND status = 'active'", accountId).n;
    if (!active) throw fail(409, 'no_number', 'Get a phone number first. The code comes from it.');
    const via = c.body.via;
    if (!via || typeof via !== 'object' || Array.isArray(via)) throw fail(400, 'bad_request', 'The value "via" is not valid.');
    const viaRow = ph.ownNumber(accountId, idOf(via.numberId, 'via.numberId'));
    const viaNumber = e164(via.number, 'via.number');
    ph.matchPlain(viaRow, viaNumber);
    if (viaRow.status !== 'active') throw fail(409, 'no_number', 'This number is suspended. Choose an active number.');
    if (method === 'call') ph.requireVoice(viaRow);
    else if (!viaRow.sms) throw fail(409, 'conflict', 'This number cannot send texts.');
    // A VoIP number of the account as its own "real phone" can make a forwarding loop.
    if (db.get('SELECT 1 AS x FROM numbers WHERE account_id = ? AND number_hmac = ?', accountId, keys.indexHmac('num', number))) {
      throw fail(400, 'bad_request', 'Enter your real phone number, not one of your numbers here.');
    }
    // Texts and calls are forwarded to this phone later. It must be a destination that the server allows.
    ph.checkDestination(number);

    return ph.lock(accountId, async () => {
      const hmac = keys.indexHmac('phone', number);
      const old = db.get('SELECT * FROM phones WHERE account_id = ? AND number_hmac = ?', accountId, hmac);
      if (old && old.verified) throw fail(409, 'conflict', 'This phone is linked already.');
      if (!old && db.get('SELECT COUNT(*) AS n FROM phones WHERE account_id = ?', accountId).n >= config.limits.phones) {
        throw fail(409, 'limit_reached', 'You have the maximum count of phones. Delete a phone first.');
      }
      const id = old ? old.id : randomId();
      const sealedNumber = old ? old.sealed_number : await store.sealJsonFor(accountId, { number }, 'phone');
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');

      let price;
      if (method === 'call') {
        // One fixed charge for the call. The say-code webhook speaks the code when the phone answers.
        price = config.prices.callMinute;
        store.charge(accountId, price, 'call');
        const token = randomToken();
        ph.addSayCode(token, { accountId, code });
        try {
          await provider.startCall({ from: viaNumber, to: number, answerUrl: ph.urls.sayCode(token), statusUrl: ph.urls.status });
        } catch (err) {
          ph.sayCodes.delete(token);
          store.credit(accountId, price, 'refund');
          throw ph.providerFail(err);
        }
      } else {
        let sent;
        try {
          sent = await ph.sendPaidText({ accountId, from: viaNumber, to: number, body: `Your ${config.appName} code is ${code}. Do not share it.` });
        } catch (err) {
          throw ph.providerFail(err);
        }
        price = sent.price;
        // The code text has no row. If the provider reports later that it failed, the charge comes back.
        ph.trackSend({ ref: sent.ref, status: sent.status, accountId, charged: sent.price });
      }
      // Only a hash of the code is stored. The phone ID in the hash ties the code to this phone.
      const codeHash = sha256(`${id}:${code}`);
      const expires = nowSec() + CODE_SECONDS;
      if (old) {
        db.run('UPDATE phones SET code_hash = ?, code_expires = ?, code_tries = 0, enc = COALESCE(?, enc) WHERE id = ? AND account_id = ?', codeHash, expires, enc ?? null, id, accountId);
      } else {
        db.run(
          'INSERT INTO phones (id, account_id, number_hmac, number_srv, sealed_number, enc, verified, code_hash, code_expires, code_tries, created_day) VALUES (?,?,?,?,?,?,0,?,?,0,?)',
          id, accountId, hmac, keys.srvEncrypt(number, 'phone'), sealedNumber, enc ?? null, codeHash, expires, today(),
        );
      }
      events.publish(accountId, 'phones');
      if (price > 0) events.publish(accountId, 'balance');
      return reply(201, { phone: phoneView(ownPhone(accountId, id)) });
    });
  });

  http.post('/api/phones/:id/verify', { auth: true, rate: { max: 20, per: 600 } }, (c) => {
    const accountId = c.account.id;
    const row = ownPhone(accountId, c.params.id);
    if (row.verified) return { phone: phoneView(row) };
    const code = typeof c.body.code === 'string' ? c.body.code.replace(/\s+/g, '') : '';
    if (!/^\d{6}$/.test(code)) throw fail(400, 'bad_code', 'Enter the 6 digits of the code.');
    if (!row.code_hash || row.code_expires <= nowSec()) throw fail(400, 'bad_code', 'This code is too old. Send a new code.');
    // Count the try before the comparison. Parallel requests cannot get extra tries.
    const counted = db.run('UPDATE phones SET code_tries = code_tries + 1 WHERE id = ? AND account_id = ? AND code_tries < ?', row.id, accountId, CODE_TRIES).changes;
    if (!counted) throw fail(400, 'bad_code', 'Too many wrong codes. Send a new code.');
    if (!safeEqual(sha256(`${row.id}:${code}`), row.code_hash)) throw fail(400, 'bad_code', 'This code is not correct.');
    db.run('UPDATE phones SET verified = 1, code_hash = NULL, code_expires = NULL, code_tries = 0 WHERE id = ? AND account_id = ?', row.id, accountId);
    events.publish(accountId, 'phones');
    return { phone: phoneView(ownPhone(accountId, row.id)) };
  });

  http.del('/api/phones/:id', { auth: true }, (c) => {
    const accountId = c.account.id;
    const row = ownPhone(accountId, c.params.id);
    const cleared = db.tx(() => {
      const n = db.run('UPDATE numbers SET forward_phone_id = NULL, forward_texts = 0, forward_calls = 0 WHERE account_id = ? AND forward_phone_id = ?', accountId, row.id).changes;
      db.run('DELETE FROM phones WHERE id = ? AND account_id = ?', row.id, accountId);
      return n;
    });
    events.publish(accountId, 'phones');
    if (cleared) events.publish(accountId, 'number');
  });
}
