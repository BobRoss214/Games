// Simulated telephone provider. Everything stays in memory. Tests and development use it.
//
// ---- Provider interface (mock.js and twilio.js both keep to it) ----
//
//   name                          'mock' | 'twilio'
//   webhookBody                   'json' | 'form': how the provider encodes its webhook requests
//   capabilities                  { voice, asyncText, searchByArea }, all boolean
//       voice: the provider can make and receive calls. If false, the "voice only" functions
//              below are not necessary, and the module refuses calls with 409 no_voice.
//       asyncText: the result of a text can arrive after sendText() has returned.
//       searchByArea: search() can filter by area code.
//
//   search({ country, areaCode, limit }) → [{ number, locality, region, country, sms, voice }]
//   buy(number, { textUrl, voiceUrl, statusUrl }) → { ref }
//   release(ref) → void           throws ProviderError with notFound = true if the number is gone
//   sendText({ from, to, body, statusUrl }) → { ref, status }
//       status: 'queued' (the provider will try later) or 'sent'. `ref` is the message id.
//       The provider reports later changes for `ref`: by a POST to statusUrl (see parseTextStatus),
//       or in its own way through app.services.phone.reportTextStatus({ ref, status, errorText }).
//
//   verifyWebhook(c, fullUrl) → boolean     c is the request context of core/http.js
//   parseText(c)   → { to, from, body, id }     id: message id of the provider, '' if it has none
//   parseTextStatus(c) → { ref, status: 'queued' | 'sent' | 'delivered' | 'failed' | null, errorText }
//       errorText: a short reason or code for the log. No phone number, no message text.
//   textReply() → { contentType, body }     the answer to a text webhook
//
//   Voice only:
//   startCall({ from, to, answerUrl, statusUrl }) → { ref }
//       Calls `to`. When `to` answers, the provider POSTs to answerUrl and follows the
//       voice instructions in the answer. `ref` is the call id that parseVoice/parseStatus return.
//   parseVoice(c)  → { to, from, callId }
//   parseStatus(c) → { callId, status: 'answered' | 'missed' | 'failed' | null, seconds }
//   voiceReply(actions) → { contentType, body }
//       actions: [{ say: 'text' }, { dial: { number, callerId, timeout, timeLimit, actionUrl } }, { hangup: true }]
//       timeout: seconds to ring. timeLimit: the provider ends the connected call after this many seconds.
//       actionUrl: the provider POSTs the result of the dial there (see parseStatus).
//
// All async functions throw ProviderError (see errors.js) with a plain message.
//
// ---- Mock webhooks ----
// The body is JSON. The header `x-mock-signature` must be sign(rawBody).
// The simulate functions below build such a request and run the same handlers
// as the HTTP routes, signature check included.
import { randomBytes } from 'node:crypto';
import { safeEqual } from '../../core/keys.js';
import { ProviderError } from './errors.js';

const OUTBOX_MAX = 500;
const CALLING_CODES = { US: '1', CA: '1', GB: '44', DE: '49', FR: '33', NL: '31', SE: '46', ES: '34', IT: '39', AU: '61', IE: '353', CH: '41', AT: '43' };
const AREAS = {
  212: ['New York', 'NY'], 312: ['Chicago', 'IL'], 415: ['San Francisco', 'CA'], 512: ['Austin', 'TX'],
  206: ['Seattle', 'WA'], 305: ['Miami', 'FL'], 416: ['Toronto', 'ON'], 604: ['Vancouver', 'BC'], 514: ['Montreal', 'QC'],
};

// The fake number with index i for a country and area code. Null when there are no more.
function fakeNumber(country, areaCode, i) {
  if (country === 'US' || country === 'CA') {
    const area = areaCode || (country === 'CA' ? '416' : '415');
    if (!/^[2-9]\d{2}$/.test(area) || i > 9899) return null;
    const [locality, region] = AREAS[area] || ['Area ' + area, ''];
    // 555-0100 and up: the range that is kept free for fiction.
    return { number: `+1${area}555${String(100 + i).padStart(4, '0')}`, locality, region };
  }
  if (country === 'GB') {
    if (i > 999) return null;
    return { number: `+447700900${String(i).padStart(3, '0')}`, locality: 'Mobile', region: '' };
  }
  const code = CALLING_CODES[country];
  if (!code || i > 9999) return null;
  return { number: `+${code}70055${String(i).padStart(4, '0')}`, locality: '', region: '' };
}

// sign(rawBody) → string. isTaken(number) → true if an account on this server has the number.
// autoAnswerMs: if set, a click-to-call is answered automatically after this time (development).
export function createMockProvider({ sign, isTaken = () => false, autoAnswerMs = null } = {}) {
  let hooks = null; // { text, textStatus, voice, bridge, sayCode, status, paths }: the handlers of the webhook routes
  let queueNext = false; // test hook: the next text is only "queued"
  const owned = new Map(); // ref -> number
  const ringing = new Map(); // call ref -> { from, to, answerUrl, statusUrl }
  const outbox = { texts: [], calls: [] };
  const released = [];
  const planned = { search: [], buy: [], release: [], sendText: [], startCall: [] };
  const timers = new Set();
  const now = () => Math.floor(Date.now() / 1000);
  const newRef = (prefix) => prefix + randomBytes(12).toString('hex');
  const str = (v) => (typeof v === 'string' ? v : '');

  function keep(list, item) {
    list.push(item);
    if (list.length > OUTBOX_MAX) list.shift();
  }
  function failIfPlanned(op) {
    const err = planned[op].shift();
    if (err) throw err;
  }
  // A webhook request with a valid signature, in the form that the HTTP layer makes.
  function request(url, payload) {
    const raw = Buffer.from(JSON.stringify(payload));
    const u = new URL(url, 'http://mock.invalid');
    return { raw, body: payload, headers: { 'x-mock-signature': sign(raw) }, query: Object.fromEntries(u.searchParams), req: { url: u.pathname + u.search } };
  }
  // Runs the handler of the webhook route that has this address, as a POST from the provider would.
  function post(url, payload) {
    const path = new URL(url, 'http://mock.invalid').pathname;
    const name = Object.keys(hooks.paths).find((k) => hooks.paths[k] === path);
    if (!name) throw new Error('the mock provider has no webhook at this address');
    return hooks[name](request(url, payload));
  }
  const actionsOf = (out) => JSON.parse(String(out.body)).actions || [];
  const dialOf = (actions) => (actions.find((a) => a.dial) || {}).dial || null;
  // A real provider cuts the call at the time limit of the dial.
  const cut = (seconds, dial) => (dial.timeLimit ? Math.min(seconds, dial.timeLimit) : seconds);

  const provider = {
    name: 'mock',
    webhookBody: 'json',
    // A test can set voice to false to act like a provider with no calls.
    capabilities: { voice: true, asyncText: false, searchByArea: true },
    outbox,
    released,
    owned,
    ringing,

    // The phone module gives its webhook handlers to the mock.
    attach(handlers) { hooks = handlers; },
    // Test helper: the next call of `op` throws this error.
    failNext(op, error = new ProviderError('The simulated telephone provider failed.')) { planned[op].push(error); },
    stop() {
      for (const t of timers) clearTimeout(t);
      timers.clear();
    },

    async search({ country, areaCode, limit = 20 }) {
      failIfPlanned('search');
      const taken = new Set(owned.values());
      const out = [];
      for (let i = 0; out.length < limit; i++) {
        const n = fakeNumber(country, areaCode, i);
        if (!n) break;
        if (taken.has(n.number) || isTaken(n.number)) continue;
        out.push({ ...n, country, sms: true, voice: true });
      }
      return out;
    },

    async buy(number) {
      failIfPlanned('buy');
      if ([...owned.values()].includes(number) || isTaken(number)) {
        throw new ProviderError('This number is not available. Choose a different one.', { unavailable: true });
      }
      const ref = newRef('MN');
      owned.set(ref, number);
      return { ref };
    },

    async release(ref) {
      failIfPlanned('release');
      if (!owned.delete(ref)) throw new ProviderError('The telephone provider does not have this number.', { notFound: true, status: 404 });
      released.push(ref);
    },

    async sendText({ from, to, body }) {
      failIfPlanned('sendText');
      const ref = newRef('MT');
      const status = queueNext ? 'queued' : 'sent';
      queueNext = false;
      keep(outbox.texts, { from, to, body, at: now(), ref, status });
      // A text to a number of this server arrives there, so that two accounts can text each other.
      if (hooks && isTaken(to)) {
        try { await post(hooks.paths.text, { to, from, body }); } catch { /* the sender must not see a failure of the receiver */ }
      }
      return { ref, status };
    },
    // Test hook: the next text is accepted as "queued". Its result comes later with reportText().
    queueNextText() { queueNext = true; },
    // Test hook: the provider reports what happened to a text. ref: from the outbox entry.
    // status: 'sent' | 'delivered' | 'failed'. It runs the same handler as the text-status webhook.
    async reportText(ref, status, errorText = '') {
      const entry = outbox.texts.find((t) => t.ref === ref);
      if (entry) entry.status = status;
      await post(hooks.paths.textStatus, { ref, status, errorText });
    },

    async startCall({ from, to, answerUrl, statusUrl }) {
      failIfPlanned('startCall');
      const ref = newRef('MC');
      const entry = { from, to, at: now(), ref };
      ringing.set(ref, { from, to, answerUrl, statusUrl, entry });
      keep(outbox.calls, entry);
      if (autoAnswerMs !== null) {
        const t = setTimeout(() => {
          timers.delete(t);
          provider.answerCall(ref).catch(() => {});
        }, autoAnswerMs);
        t.unref();
        timers.add(t);
      }
      return { ref };
    },

    verifyWebhook(c) {
      const given = c.headers['x-mock-signature'];
      return typeof given === 'string' && given.length > 0 && safeEqual(given, sign(c.raw));
    },
    parseText(c) {
      const b = c.body || {};
      return { to: str(b.to), from: str(b.from), body: str(b.body), id: str(b.id) };
    },
    parseTextStatus(c) {
      const b = c.body || {};
      const status = ['queued', 'sent', 'delivered', 'failed'].includes(b.status) ? b.status : null;
      return { ref: str(b.ref), status, errorText: str(b.errorText) };
    },
    parseVoice(c) {
      const b = c.body || {};
      return { to: str(b.to), from: str(b.from), callId: str(b.callId) };
    },
    parseStatus(c) {
      const b = c.body || {};
      const status = ['answered', 'missed', 'failed'].includes(b.status) ? b.status : null;
      return { callId: str(b.callId), status, seconds: Number.isInteger(b.seconds) && b.seconds > 0 ? b.seconds : 0 };
    },
    voiceReply(actions) {
      return { contentType: 'application/json', body: JSON.stringify({ actions }) };
    },
    textReply() {
      return { contentType: 'application/json', body: '{}' };
    },

    // ---- simulation: the outside world calls and texts our numbers ----

    // A text from `from` arrives at the VoIP number `to`.
    async simulateText({ to, from, body }) {
      await post(hooks.paths.text, { to, from, body });
    },

    // A full incoming call. If the server forwards it, the real phone answers
    // (answered = true) and the call lasts `seconds`. Returns what happened.
    async simulateCall({ to, from, seconds = 30, answered = true }) {
      const callId = newRef('MC');
      const actions = actionsOf(await post(hooks.paths.voice, { to, from, callId }));
      const dial = dialOf(actions);
      if (!dial) return { callId, forwarded: false, actions };
      keep(outbox.calls, { from: dial.callerId || from, to: dial.number, at: now(), ref: callId });
      const status = answered ? { callId, status: 'answered', seconds: cut(seconds, dial) } : { callId, status: 'missed', seconds: 0 };
      await post(dial.actionUrl, status);
      return { callId, forwarded: true, actions };
    },

    // The phone that startCall() called reacts. The provider asks the answer address what to do.
    // answered: the phone answers. peerAnswered: the destination of a click-to-call answers.
    // Returns { bridged, actions, say }. say: the text that the phone heard, '' if none.
    async answerCall(ref, { answered = true, peerAnswered = true, seconds = 30 } = {}) {
      const call = ringing.get(ref);
      if (!call) return { bridged: false, actions: [], say: '' };
      ringing.delete(ref);
      if (!answered) {
        await post(call.statusUrl, { callId: ref, status: 'missed', seconds: 0 });
        return { bridged: false, actions: [], say: '' };
      }
      const actions = actionsOf(await post(call.answerUrl, { callId: ref, from: call.from, to: call.to }));
      const say = actions.filter((a) => typeof a.say === 'string').map((a) => a.say).join(' ');
      // The spoken text goes into the outbox entry of the call. A test or a developer reads a code there.
      if (say) call.entry.say = say;
      const dial = dialOf(actions);
      if (!dial) {
        await post(call.statusUrl, say ? { callId: ref, status: 'answered', seconds: 10 } : { callId: ref, status: 'failed', seconds: 0 });
        return { bridged: false, actions, say };
      }
      keep(outbox.calls, { from: dial.callerId, to: dial.number, at: now(), ref });
      const status = peerAnswered ? { callId: ref, status: 'answered', seconds: cut(seconds, dial) } : { callId: ref, status: 'missed', seconds: 0 };
      await post(dial.actionUrl, status);
      return { bridged: true, actions, say };
    },
  };
  return provider;
}
