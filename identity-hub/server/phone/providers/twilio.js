// Twilio adapter: REST calls with fetch, form-encoded webhooks, TwiML answers.
// It keeps to the provider interface that is described at the top of mock.js.
import { createHmac } from 'node:crypto';
import { safeEqual } from '../../core/keys.js';
import { ProviderError } from './errors.js';

const TIMEOUT_MS = 15_000;
const DOWN = 'The telephone provider is not available. Try again later.';
// Plain messages for requests that Twilio refused. Twilio's own message is not passed on:
// it can have phone numbers in it.
const REFUSED = {
  search: 'The telephone provider could not search for numbers.',
  buy: 'The telephone provider did not sell this number.',
  release: 'The telephone provider did not release this number.',
  sendText: 'The telephone provider refused this text.',
  startCall: 'The telephone provider refused this call.',
};
// Twilio error codes that mean "you cannot have this number".
const NOT_FOR_SALE = new Set([21421, 21422, 21452]);

// The value of the X-Twilio-Signature header:
// Base64(HMAC-SHA1(authToken, url + name + value for each POST field, sorted by name)).
export function twilioSignature(authToken, url, params = {}) {
  let data = url;
  for (const name of Object.keys(params).sort()) data += name + params[name];
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

const XML = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
// Escapes a value for XML text and attributes. Control characters are not legal in XML 1.0.
const xml = (v) => String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"']/g, (ch) => XML[ch]);

// Builds TwiML from the action list of the provider interface.
export function twiml(actions = []) {
  let inner = '';
  for (const a of actions) {
    if (a.say) inner += `<Say>${xml(a.say)}</Say>`;
    else if (a.dial) {
      const d = a.dial;
      let attrs = '';
      if (d.callerId) attrs += ` callerId="${xml(d.callerId)}"`;
      attrs += ` timeout="${xml(d.timeout || 25)}"`;
      if (d.actionUrl) attrs += ` action="${xml(d.actionUrl)}" method="POST"`;
      inner += `<Dial${attrs}><Number>${xml(d.number)}</Number></Dial>`;
    } else if (a.hangup) inner += '<Hangup/>';
  }
  return '<?xml version="1.0" encoding="UTF-8"?>' + (inner ? `<Response>${inner}</Response>` : '<Response/>');
}

export function createTwilioProvider({ accountSid, authToken, baseUrl } = {}) {
  if (!accountSid || !authToken) throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set when PHONE_PROVIDER is twilio');
  const base = (baseUrl || 'https://api.twilio.com').replace(/\/+$/, '') + '/2010-04-01/Accounts/' + encodeURIComponent(accountSid);
  const auth = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const str = (v) => (typeof v === 'string' ? v : '');

  function toError(op, status, data) {
    const code = data && Number.isInteger(data.code) ? data.code : 0;
    const info = { status, code, notFound: status === 404 || code === 20404, unavailable: op === 'buy' && NOT_FOR_SALE.has(code) };
    if (status === 401 || code === 20003) return new ProviderError('The telephone provider did not accept the login of this server.', info);
    if (status === 429 || status >= 500) return new ProviderError(DOWN, info);
    return new ProviderError(REFUSED[op], info);
  }

  // One REST request. `form` makes a form-encoded POST body. Returns the parsed JSON (null for 204).
  async function call(op, method, path, { query, form } = {}) {
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== '') url.searchParams.set(k, v);
    const init = { method, headers: { authorization: auth, accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) };
    if (form) {
      init.headers['content-type'] = 'application/x-www-form-urlencoded';
      init.body = new URLSearchParams(form).toString();
    }
    let res;
    let data = null;
    try {
      res = await fetch(url, init);
      const text = await res.text();
      if (text) { try { data = JSON.parse(text); } catch { data = null; } }
    } catch {
      throw new ProviderError(DOWN);
    }
    if (!res.ok) throw toError(op, res.status, data);
    return data;
  }

  return {
    name: 'twilio',
    webhookBody: 'form',

    async search({ country, areaCode, limit = 20 }) {
      const query = { SmsEnabled: 'true', VoiceEnabled: 'true', PageSize: String(limit) };
      // Twilio knows area codes for the United States and Canada only.
      if (areaCode && (country === 'US' || country === 'CA')) query.AreaCode = areaCode;
      let data;
      try {
        data = await call('search', 'GET', `/AvailablePhoneNumbers/${encodeURIComponent(country)}/Local.json`, { query });
      } catch (err) {
        if (err.notFound) return []; // Twilio has no local numbers in this country
        throw err;
      }
      const list = data && Array.isArray(data.available_phone_numbers) ? data.available_phone_numbers : [];
      return list.slice(0, limit).map((n) => {
        const caps = n.capabilities || {};
        return {
          number: str(n.phone_number), locality: str(n.locality), region: str(n.region), country: str(n.iso_country) || country,
          sms: Boolean(caps.SMS ?? caps.sms), voice: Boolean(caps.voice ?? caps.Voice),
        };
      });
    },

    async buy(number, { textUrl, voiceUrl, statusUrl }) {
      const data = await call('buy', 'POST', '/IncomingPhoneNumbers.json', {
        form: {
          PhoneNumber: number, SmsUrl: textUrl, SmsMethod: 'POST', VoiceUrl: voiceUrl, VoiceMethod: 'POST',
          StatusCallback: statusUrl, StatusCallbackMethod: 'POST',
        },
      });
      if (!data || typeof data.sid !== 'string' || !data.sid) throw new ProviderError(REFUSED.buy);
      return { ref: data.sid };
    },

    async release(ref) {
      await call('release', 'DELETE', `/IncomingPhoneNumbers/${encodeURIComponent(ref)}.json`);
    },

    async sendText({ from, to, body }) {
      const data = await call('sendText', 'POST', '/Messages.json', { form: { From: from, To: to, Body: body } });
      // Twilio can accept the request and report the refusal in the answer.
      if (!data || typeof data.sid !== 'string' || data.error_code || data.status === 'failed' || data.status === 'undelivered') {
        throw new ProviderError(REFUSED.sendText, { code: data && Number.isInteger(data.error_code) ? data.error_code : 0 });
      }
      return { ref: data.sid };
    },

    async startCall({ from, to, answerUrl, statusUrl }) {
      const data = await call('startCall', 'POST', '/Calls.json', {
        form: { To: to, From: from, Url: answerUrl, Method: 'POST', StatusCallback: statusUrl, StatusCallbackMethod: 'POST' },
      });
      if (!data || typeof data.sid !== 'string' || !data.sid) throw new ProviderError(REFUSED.startCall);
      return { ref: data.sid };
    },

    // fullUrl is the public URL of the webhook with its query string, as Twilio called it.
    verifyWebhook(c, fullUrl) {
      const given = c.headers['x-twilio-signature'];
      if (typeof given !== 'string' || !given) return false;
      return safeEqual(given, twilioSignature(authToken, fullUrl, c.body || {}));
    },
    parseText(c) {
      const b = c.body || {};
      return { to: str(b.To), from: str(b.From), body: str(b.Body) };
    },
    parseVoice(c) {
      const b = c.body || {};
      return { to: str(b.To), from: str(b.From), callId: str(b.CallSid) };
    },
    // Two kinds of request arrive here: the end of a <Dial> (DialCallStatus, DialCallDuration)
    // and the end of a whole call (CallStatus, CallDuration). The dial values are the connected time.
    parseStatus(c) {
      const b = c.body || {};
      const dial = typeof b.DialCallStatus === 'string';
      const raw = dial ? b.DialCallStatus : b.CallStatus;
      const secs = Number.parseInt(dial ? b.DialCallDuration : b.CallDuration, 10);
      let status = null; // a call that has not ended yet ("ringing", "in-progress") stays null
      if (raw === 'completed' || raw === 'answered') status = 'answered';
      else if (raw === 'busy' || raw === 'no-answer' || raw === 'canceled') status = 'missed';
      else if (raw === 'failed') status = 'failed';
      return { callId: str(b.CallSid), status, seconds: Number.isInteger(secs) && secs > 0 ? secs : 0 };
    },
    voiceReply(actions) {
      return { contentType: 'text/xml; charset=utf-8', body: twiml(actions) };
    },
    textReply() {
      return { contentType: 'text/xml; charset=utf-8', body: twiml([]) };
    },
  };
}
