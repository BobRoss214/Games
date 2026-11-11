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
  recording: 'The telephone provider did not give or delete the recording.',
  sendText: 'The telephone provider refused this text.',
  startCall: 'The telephone provider refused this call.',
};
// Twilio error codes that mean "you cannot have this number".
const NOT_FOR_SALE = new Set([21421, 21422, 21452]);
// The MessageStatus values of Twilio in the four words of the provider interface.
const TEXT_STATUS = {
  accepted: 'queued', scheduled: 'queued', queued: 'queued',
  sending: 'sent', sent: 'sent',
  delivered: 'delivered', read: 'delivered',
  undelivered: 'failed', failed: 'failed', canceled: 'failed',
};
const textStatus = (v) => (typeof v === 'string' && Object.hasOwn(TEXT_STATUS, v) ? TEXT_STATUS[v] : null);

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
      if (d.timeLimit) attrs += ` timeLimit="${xml(d.timeLimit)}"`;
      if (d.actionUrl) attrs += ` action="${xml(d.actionUrl)}" method="POST"`;
      inner += `<Dial${attrs}><Number>${xml(d.number)}</Number></Dial>`;
    } else if (a.record) {
      // A tone, then the caller speaks. No transcription is requested: no machine at Twilio reads the message.
      const r = a.record;
      let attrs = ` maxLength="${xml(r.maxSeconds)}" playBeep="true" trim="trim-silence"`;
      // Without an action Twilio asks the address of the current document again when the recording ends.
      if (r.actionUrl) attrs += ` action="${xml(r.actionUrl)}" method="POST"`;
      attrs += ` recordingStatusCallback="${xml(r.doneUrl)}" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed"`;
      inner += `<Record${attrs}/>`;
    } else if (a.hangup) inner += '<Hangup/>';
  }
  return '<?xml version="1.0" encoding="UTF-8"?>' + (inner ? `<Response>${inner}</Response>` : '<Response/>');
}

// Optional settings:
//   messagingServiceSid  the Messaging Service of an approved US 10DLC campaign. Each new number
//                        is added to it, and texts are sent through it. Without it, US carriers
//                        block texts from US local numbers (Twilio error 30034).
//   bundleSid, addressSid  regulatory bundle and address. Some countries need them for a purchase.
// warn(message): tells the operator about a problem that does not stop the request.
export function createTwilioProvider({ accountSid, authToken, baseUrl, messagingServiceSid = '', bundleSid = '', addressSid = '' } = {}, { warn = () => {} } = {}) {
  if (!accountSid || !authToken) throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set when PHONE_PROVIDER is twilio');
  const root = (baseUrl || 'https://api.twilio.com').replace(/\/+$/, '');
  const base = root + '/2010-04-01/Accounts/' + encodeURIComponent(accountSid);
  // Twilio has the Messaging Services API on a different host. A test server has both on one address.
  const messagingRoot = root === 'https://api.twilio.com' ? 'https://messaging.twilio.com' : root;
  const auth = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const str = (v) => (typeof v === 'string' ? v : '');
  // A recording id goes into the address of a request. Accept the form of Twilio only.
  const RECORDING = /^RE[0-9a-f]{32}$/;

  function toError(op, status, data) {
    const code = data && Number.isInteger(data.code) ? data.code : 0;
    const info = { status, code, notFound: status === 404 || code === 20404, unavailable: op === 'buy' && NOT_FOR_SALE.has(code) };
    if (status === 401 || code === 20003) return new ProviderError('The telephone provider did not accept the login of this server.', info);
    if (status === 429 || status >= 500) return new ProviderError(DOWN, info);
    return new ProviderError(REFUSED[op], info);
  }

  // One REST request. `form` makes a form-encoded POST body. Returns the parsed JSON (null for 204).
  // path: below the account address, or a full address.
  async function call(op, method, path, { query, form } = {}) {
    const url = new URL(path.startsWith('http') ? path : base + path);
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
    // Twilio accepts a text first and reports the result later (see parseTextStatus).
    capabilities: { voice: true, voicemail: true, asyncText: true, searchByArea: true },

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
      const form = {
        PhoneNumber: number, SmsUrl: textUrl, SmsMethod: 'POST', VoiceUrl: voiceUrl, VoiceMethod: 'POST',
        StatusCallback: statusUrl, StatusCallbackMethod: 'POST',
      };
      if (bundleSid) form.BundleSid = bundleSid;
      if (addressSid) form.AddressSid = addressSid;
      const data = await call('buy', 'POST', '/IncomingPhoneNumbers.json', { form });
      if (!data || typeof data.sid !== 'string' || !data.sid) throw new ProviderError(REFUSED.buy);
      if (messagingServiceSid) {
        // The number is ours now. If this step fails, it still receives texts and calls,
        // so the purchase stands. The operator must add the number to the service by hand.
        try {
          await call('buy', 'POST', `${messagingRoot}/v1/Services/${encodeURIComponent(messagingServiceSid)}/PhoneNumbers`, { form: { PhoneNumberSid: data.sid } });
        } catch {
          warn('a new number could not be added to the Twilio Messaging Service; it cannot send texts until it is added');
        }
      }
      return { ref: data.sid };
    },

    async release(ref) {
      await call('release', 'DELETE', `/IncomingPhoneNumbers/${encodeURIComponent(ref)}.json`);
    },

    async sendText({ from, to, body, statusUrl }) {
      const form = { From: from, To: to, Body: body };
      // With both values Twilio sends from this number as a member of the service (the registered campaign).
      if (messagingServiceSid) form.MessagingServiceSid = messagingServiceSid;
      // Twilio reports each change of the message there: sent, delivered, failed.
      if (statusUrl) form.StatusCallback = statusUrl;
      const data = await call('sendText', 'POST', '/Messages.json', { form });
      // Twilio can accept the request and report the refusal in the answer.
      if (!data || typeof data.sid !== 'string' || data.error_code || data.status === 'failed' || data.status === 'undelivered') {
        throw new ProviderError(REFUSED.sendText, { code: data && Number.isInteger(data.error_code) ? data.error_code : 0 });
      }
      // A new message is "queued" at Twilio. The carrier result comes later.
      return { ref: data.sid, status: textStatus(data.status) === 'sent' ? 'sent' : 'queued' };
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
      return { to: str(b.To), from: str(b.From), body: str(b.Body), id: str(b.MessageSid) };
    },
    // The StatusCallback of a message: MessageSid, MessageStatus, and ErrorCode if it failed.
    parseTextStatus(c) {
      const b = c.body || {};
      const code = /^\d{1,6}$/.test(str(b.ErrorCode)) ? b.ErrorCode : '';
      return { ref: str(b.MessageSid), status: textStatus(b.MessageStatus), errorText: code ? `Twilio error ${code}` : '' };
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

    // The recordingStatusCallback of a <Record>: CallSid, RecordingSid, RecordingUrl, RecordingDuration, RecordingStatus.
    parseRecording(c) {
      const b = c.body || {};
      const secs = Number.parseInt(b.RecordingDuration, 10);
      return {
        callId: str(b.CallSid), recordingRef: str(b.RecordingSid), seconds: Number.isInteger(secs) && secs > 0 ? secs : 0,
        url: str(b.RecordingUrl), ready: b.RecordingStatus === undefined || b.RecordingStatus === 'completed',
      };
    },
    // Downloads the audio as MP3. The address is built from our own API address and the recording
    // id. The url of the webhook is not used: the server never sends a request (and never its
    // password) to a host that came in with a request.
    async fetchRecording({ ref }, { maxBytes = 5 * 1024 * 1024 } = {}) {
      if (!RECORDING.test(str(ref))) throw new ProviderError(REFUSED.recording, { notFound: true });
      let res;
      try {
        res = await fetch(`${base}/Recordings/${ref}.mp3`, { headers: { authorization: auth }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch {
        throw new ProviderError(DOWN);
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        throw toError('recording', res.status, null);
      }
      const tooLarge = () => new ProviderError(REFUSED.recording, { tooLarge: true });
      if (Number(res.headers.get('content-length')) > maxBytes) {
        await res.body?.cancel().catch(() => {});
        throw tooLarge();
      }
      // The length header can be absent or wrong. Count the bytes while they arrive.
      const chunks = [];
      let size = 0;
      try {
        for await (const chunk of res.body) {
          size += chunk.length;
          if (size > maxBytes) throw tooLarge();
          chunks.push(chunk);
        }
      } catch (err) {
        if (err instanceof ProviderError) throw err;
        throw new ProviderError(DOWN);
      }
      const type = str(res.headers.get('content-type')).split(';')[0].trim().toLowerCase();
      return { bytes: Buffer.concat(chunks), contentType: /^audio\/[a-z0-9.+-]{1,40}$/.test(type) ? type : 'audio/mpeg' };
    },
    async deleteRecording(ref) {
      if (!RECORDING.test(str(ref))) throw new ProviderError(REFUSED.recording, { notFound: true });
      await call('recording', 'DELETE', `/Recordings/${ref}.json`);
    },
    textReply() {
      return { contentType: 'text/xml; charset=utf-8', body: twiml([]) };
    },
  };
}
