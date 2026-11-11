// Twilio adapter against a local fake Twilio server, and the webhook routes with
// real Twilio-style signed form posts. No internet is used.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac, randomBytes } from 'node:crypto';
import { startTestApp, client, newAccount, unb64u } from './helpers.js';
import { openJson } from '../shared/crypto.js';
import { createTwilioProvider, twilioSignature, twiml } from '../server/phone/providers/twilio.js';
import { ProviderError } from '../server/phone/providers/errors.js';

const SID = 'ACtest0123456789abcdef0123456789ab';
const TOKEN = 'test-auth-token-5f2c';
const PUBLIC = 'http://localhost:8080';
const API = `/2010-04-01/Accounts/${SID}`;
const HOOK = {
  text: '/api/hooks/phone/text', textStatus: '/api/hooks/phone/text-status', voice: '/api/hooks/phone/voice',
  status: '/api/hooks/phone/status', bridge: '/api/hooks/phone/bridge', sayCode: '/api/hooks/phone/say-code',
};
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>';
const NOT_AVAILABLE_XML = `${XML_HEAD}<Response><Say>The person you called is not available.</Say><Hangup/></Response>`;
const HANGUP_XML = `${XML_HEAD}<Response><Hangup/></Response>`;

// A small Twilio. It records every request and answers like the REST API.
function startFakeTwilio() {
  const requests = [];
  const planned = new Map(); // "METHOD /Path.json" -> [{ status, body }]
  const bought = new Map(); // sid -> number
  const sid = (prefix) => prefix + randomBytes(16).toString('hex');
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://fake');
      const raw = Buffer.concat(chunks).toString('utf8');
      const path = url.pathname.startsWith(API) ? url.pathname.slice(API.length) : url.pathname;
      const rec = { method: req.method, fullPath: url.pathname, path, query: Object.fromEntries(url.searchParams), headers: req.headers, form: Object.fromEntries(new URLSearchParams(raw)), raw };
      requests.push(rec);
      const send = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(body === undefined ? undefined : JSON.stringify(body));
      };
      const plan = (planned.get(`${req.method} ${path}`) || []).shift();
      if (plan) return send(plan.status, plan.body);
      let m;
      // The Messaging Services API (another host at the real Twilio).
      if (req.method === 'POST' && (m = /^\/v1\/Services\/(MG[0-9a-f]{32})\/PhoneNumbers$/.exec(url.pathname))) {
        return send(201, { sid: rec.form.PhoneNumberSid, service_sid: m[1] });
      }
      if (!url.pathname.startsWith(API)) return send(404, { code: 20404, message: 'not found', status: 404 });

      if (req.method === 'GET' && (m = /^\/AvailablePhoneNumbers\/([A-Z]{2})\/Local\.json$/.exec(path))) {
        if (m[1] === 'ZZ') return send(404, { code: 20404, message: 'The requested resource was not found', status: 404 });
        const area = rec.query.AreaCode || '415';
        const taken = new Set(bought.values());
        const list = [];
        for (let i = 0; list.length < Number(rec.query.PageSize || 30); i++) {
          const number = m[1] === 'GB' ? `+44770090${String(1000 + i)}` : `+1${area}555${String(1000 + i)}`;
          if (taken.has(number)) continue;
          list.push({ friendly_name: number, phone_number: number, locality: 'Testville', region: 'TS', iso_country: m[1], capabilities: { voice: true, SMS: true, MMS: false } });
        }
        return send(200, { available_phone_numbers: list, uri: path });
      }
      if (req.method === 'POST' && path === '/IncomingPhoneNumbers.json') {
        const s = sid('PN');
        bought.set(s, rec.form.PhoneNumber);
        return send(201, { sid: s, phone_number: rec.form.PhoneNumber, capabilities: { voice: true, sms: true } });
      }
      if (req.method === 'DELETE' && (m = /^\/IncomingPhoneNumbers\/(PN[0-9a-f]{32})\.json$/.exec(path))) {
        if (!bought.delete(m[1])) return send(404, { code: 20404, message: 'not found', status: 404 });
        res.writeHead(204);
        return res.end();
      }
      if (req.method === 'POST' && path === '/Messages.json') return send(201, { sid: sid('SM'), status: 'queued', error_code: null });
      if (req.method === 'POST' && path === '/Calls.json') return send(201, { sid: sid('CA'), status: 'queued' });
      return send(404, { code: 20404, message: 'not found', status: 404 });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${server.address().port}`,
      requests,
      bought,
      last: () => requests.at(-1),
      failNext(method, path, status, body) {
        const key = `${method} ${path}`;
        planned.set(key, [...(planned.get(key) || []), { status, body }]);
      },
      close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }),
    }));
  });
}

let fake;
let app;
before(async () => {
  fake = await startFakeTwilio();
  app = await startTestApp({ phone: { provider: 'twilio', twilio: { accountSid: SID, authToken: TOKEN, baseUrl: fake.url } } });
});
after(async () => {
  await app.stop();
  await fake.close();
});

// The signature as Twilio makes it. Written here a second time, not taken from the adapter.
function sign(url, params) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  return createHmac('sha1', TOKEN).update(data).digest('base64');
}
// A webhook request as Twilio sends it: form-encoded, signed for the public URL.
async function twilioPost(path, params, signature) {
  const headers = { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' };
  const sig = signature === undefined ? sign(PUBLIC + path, params) : signature;
  if (sig !== null) headers['x-twilio-signature'] = sig;
  const res = await client(app).call('POST', path, new URLSearchParams(params).toString(), headers);
  return { status: res.status, type: res.headers.get('content-type'), text: Buffer.isBuffer(res.data) ? res.data.toString('utf8') : res.data };
}

let counter = 0;
const realPhone = () => `+1650555${3000 + counter++}`;
const outsider = () => `+1305555${3000 + counter++}`;
const ledger = (acct) => app.store.ledger(acct.id).map((l) => `${l.kind}:${l.delta}`);
const calls = async (acct, num) => (await acct.api.get(`/api/numbers/${num.id}/calls`)).data.calls;

async function buyNumber(acct) {
  const s = await acct.api.get('/api/numbers/search?country=US&areaCode=415');
  assert.equal(s.status, 200);
  const res = await acct.api.post('/api/numbers', { number: s.data.numbers[0].number });
  assert.equal(res.status, 201);
  return { ...res.data.number, plain: res.data.plain };
}
async function linkPhone(acct, num) {
  const number = realPhone();
  const res = await acct.api.post('/api/phones', { number, via: { numberId: num.id, number: num.plain } });
  assert.equal(res.status, 201);
  const sent = fake.last();
  assert.equal(sent.path, '/Messages.json');
  assert.deepEqual({ From: sent.form.From, To: sent.form.To, StatusCallback: sent.form.StatusCallback }, { From: num.plain, To: number, StatusCallback: PUBLIC + HOOK.textStatus });
  const code = /^Your Postern code is (\d{6})\. Do not share it\.$/.exec(sent.form.Body)[1];
  const v = await acct.api.post(`/api/phones/${res.data.phone.id}/verify`, { code });
  assert.equal(v.status, 200);
  return { ...v.data.phone, plain: number };
}

test('signature: the known vector from the Twilio documentation', () => {
  // Hand-computed check value (also in the Twilio security documentation):
  // HMAC-SHA1 with key "12345" over
  // "https://mycompany.com/myapp.php?foo=1&bar=2CallSidCA1234567890ABCDECaller+14158675309Digits1234From+14158675309To+18005551212"
  const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
  const params = { CallSid: 'CA1234567890ABCDE', Caller: '+14158675309', Digits: '1234', From: '+14158675309', To: '+18005551212' };
  assert.equal(twilioSignature('12345', url, params), 'RSOYDt4T1cUTdK1PDd93/VVr8B8=');
  // The order of the fields in the request does not matter. They are sorted by name.
  const shuffled = { To: params.To, Digits: params.Digits, From: params.From, CallSid: params.CallSid, Caller: params.Caller };
  assert.equal(twilioSignature('12345', url, shuffled), 'RSOYDt4T1cUTdK1PDd93/VVr8B8=');
  assert.notEqual(twilioSignature('12345', url, { ...params, Digits: '1235' }), 'RSOYDt4T1cUTdK1PDd93/VVr8B8=');
  assert.notEqual(twilioSignature('12345', url + '&x=1', params), 'RSOYDt4T1cUTdK1PDd93/VVr8B8=');
  assert.notEqual(twilioSignature('12346', url, params), 'RSOYDt4T1cUTdK1PDd93/VVr8B8=');
  // No fields: the signature covers the URL only.
  assert.equal(twilioSignature('12345', url, {}), createHmac('sha1', '12345').update(url).digest('base64'));
});

test('TwiML: structure and escaping of every value', () => {
  assert.equal(twiml([]), `${XML_HEAD}<Response/>`);
  assert.equal(twiml([{ say: 'Hello' }, { hangup: true }]), `${XML_HEAD}<Response><Say>Hello</Say><Hangup/></Response>`);
  assert.equal(
    twiml([{ dial: { number: '+16505550100', callerId: '+13055550100', timeout: 25, actionUrl: 'https://x.test/api/hooks/phone/status' } }]),
    `${XML_HEAD}<Response><Dial callerId="+13055550100" timeout="25" action="https://x.test/api/hooks/phone/status" method="POST"><Number>+16505550100</Number></Dial></Response>`,
  );
  // With a time limit: Twilio ends the connected call after that many seconds.
  assert.equal(
    twiml([{ dial: { number: '+16505550100', callerId: '+13055550100', timeout: 25, timeLimit: 600, actionUrl: 'https://x.test/s' } }]),
    `${XML_HEAD}<Response><Dial callerId="+13055550100" timeout="25" timeLimit="600" action="https://x.test/s" method="POST"><Number>+16505550100</Number></Dial></Response>`,
  );
  // No caller ID (hidden caller): the attribute is left out.
  assert.equal(twiml([{ dial: { number: '+16505550100', callerId: null, timeout: 25 } }]), `${XML_HEAD}<Response><Dial timeout="25"><Number>+16505550100</Number></Dial></Response>`);
  const nasty = twiml([
    { say: 'a < b & "c" > \'d\'\u0000' },
    { dial: { number: '</Number><Sms>x</Sms>', callerId: '"><Redirect>', timeout: 25, actionUrl: 'https://x.test/s?a=1&b="2"' } },
  ]);
  assert.equal(
    nasty,
    `${XML_HEAD}<Response><Say>a &lt; b &amp; &quot;c&quot; &gt; &apos;d&apos;</Say>`
    + '<Dial callerId="&quot;&gt;&lt;Redirect&gt;" timeout="25" action="https://x.test/s?a=1&amp;b=&quot;2&quot;" method="POST">'
    + '<Number>&lt;/Number&gt;&lt;Sms&gt;x&lt;/Sms&gt;</Number></Dial></Response>',
  );
});

test('adapter: exact REST requests (path, fields, auth header)', async () => {
  const twilio = createTwilioProvider({ accountSid: SID, authToken: TOKEN, baseUrl: fake.url + '/' });
  const auth = 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64');

  const found = await twilio.search({ country: 'US', areaCode: '212', limit: 20 });
  let req = fake.last();
  assert.equal(req.method, 'GET');
  assert.equal(req.fullPath, `/2010-04-01/Accounts/${SID}/AvailablePhoneNumbers/US/Local.json`);
  assert.deepEqual(req.query, { SmsEnabled: 'true', VoiceEnabled: 'true', PageSize: '20', AreaCode: '212' });
  assert.equal(req.headers.authorization, auth);
  assert.equal(found.length, 20);
  assert.deepEqual(found[0], { number: '+12125551000', locality: 'Testville', region: 'TS', country: 'US', sms: true, voice: true });

  // Area codes exist for the United States and Canada only.
  await twilio.search({ country: 'GB', areaCode: '20', limit: 5 });
  req = fake.last();
  assert.equal(req.fullPath, `/2010-04-01/Accounts/${SID}/AvailablePhoneNumbers/GB/Local.json`);
  assert.deepEqual(req.query, { SmsEnabled: 'true', VoiceEnabled: 'true', PageSize: '5' });
  // A country that Twilio does not know has no numbers.
  assert.deepEqual(await twilio.search({ country: 'ZZ', limit: 20 }), []);

  const urls = { textUrl: PUBLIC + HOOK.text, voiceUrl: PUBLIC + HOOK.voice, statusUrl: PUBLIC + HOOK.status };
  const { ref } = await twilio.buy('+12125551000', urls);
  req = fake.last();
  assert.equal(req.method, 'POST');
  assert.equal(req.fullPath, `/2010-04-01/Accounts/${SID}/IncomingPhoneNumbers.json`);
  assert.equal(req.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(req.headers.authorization, auth);
  assert.deepEqual(req.form, {
    PhoneNumber: '+12125551000', SmsUrl: urls.textUrl, SmsMethod: 'POST', VoiceUrl: urls.voiceUrl, VoiceMethod: 'POST',
    StatusCallback: urls.statusUrl, StatusCallbackMethod: 'POST',
  });
  assert.match(ref, /^PN[0-9a-f]{32}$/);

  const text = await twilio.sendText({ from: '+12125551000', to: '+13055550100', body: 'Hello & goodbye + 100%' });
  req = fake.last();
  assert.equal(req.method, 'POST');
  assert.equal(req.fullPath, `/2010-04-01/Accounts/${SID}/Messages.json`);
  assert.deepEqual(req.form, { From: '+12125551000', To: '+13055550100', Body: 'Hello & goodbye + 100%' });
  assert.equal(req.headers.authorization, auth);
  assert.match(text.ref, /^SM/);

  const answerUrl = PUBLIC + HOOK.bridge + '?t=abc';
  const call = await twilio.startCall({ from: '+12125551000', to: '+16505550100', answerUrl, statusUrl: urls.statusUrl });
  req = fake.last();
  assert.equal(req.fullPath, `/2010-04-01/Accounts/${SID}/Calls.json`);
  assert.deepEqual(req.form, { To: '+16505550100', From: '+12125551000', Url: answerUrl, Method: 'POST', StatusCallback: urls.statusUrl, StatusCallbackMethod: 'POST' });
  assert.match(call.ref, /^CA/);

  await twilio.release(ref);
  req = fake.last();
  assert.equal(req.method, 'DELETE');
  assert.equal(req.fullPath, `/2010-04-01/Accounts/${SID}/IncomingPhoneNumbers/${ref}.json`);
  assert.equal(req.headers.authorization, auth);
  assert.equal(req.raw, '');
});

test('adapter: optional Messaging Service, regulatory bundle, and address', async () => {
  const MG = 'MG' + 'a'.repeat(32);
  const warnings = [];
  const twilio = createTwilioProvider(
    { accountSid: SID, authToken: TOKEN, baseUrl: fake.url, messagingServiceSid: MG, bundleSid: 'BU' + 'b'.repeat(32), addressSid: 'AD' + 'c'.repeat(32) },
    { warn: (m) => warnings.push(m) },
  );
  const auth = 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64');
  const urls = { textUrl: PUBLIC + HOOK.text, voiceUrl: PUBLIC + HOOK.voice, statusUrl: PUBLIC + HOOK.status };

  const count = fake.requests.length;
  const { ref } = await twilio.buy('+12125551001', urls);
  assert.equal(fake.requests.length, count + 2);
  // 1. The purchase carries the bundle and the address.
  const buy = fake.requests.at(-2);
  assert.equal(buy.fullPath, `${API}/IncomingPhoneNumbers.json`);
  assert.deepEqual(buy.form, {
    PhoneNumber: '+12125551001', SmsUrl: urls.textUrl, SmsMethod: 'POST', VoiceUrl: urls.voiceUrl, VoiceMethod: 'POST',
    StatusCallback: urls.statusUrl, StatusCallbackMethod: 'POST', BundleSid: 'BU' + 'b'.repeat(32), AddressSid: 'AD' + 'c'.repeat(32),
  });
  // 2. The new number goes into the sender pool of the Messaging Service.
  const pool = fake.last();
  assert.equal(pool.method, 'POST');
  assert.equal(pool.fullPath, `/v1/Services/${MG}/PhoneNumbers`);
  assert.deepEqual(pool.form, { PhoneNumberSid: ref });
  assert.equal(pool.headers.authorization, auth);
  assert.deepEqual(warnings, []);

  // Texts name the service and the number.
  await twilio.sendText({ from: '+12125551001', to: '+13055550100', body: 'Hi' });
  assert.deepEqual(fake.last().form, { From: '+12125551001', To: '+13055550100', Body: 'Hi', MessagingServiceSid: MG });

  // The pool refuses the number: the purchase stands, and the operator gets a warning with no number in it.
  fake.failNext('POST', `/v1/Services/${MG}/PhoneNumbers`, 400, { code: 21712, message: 'Campaign is full for +12125551002', status: 400 });
  const second = await twilio.buy('+12125551002', urls);
  assert.match(second.ref, /^PN[0-9a-f]{32}$/);
  assert.equal(warnings.length, 1);
  assert.doesNotMatch(warnings[0], /\+1212|PN[0-9a-f]/);
  await twilio.release(ref);
  await twilio.release(second.ref);
});

test('adapter: Twilio errors become plain messages', async () => {
  const twilio = createTwilioProvider({ accountSid: SID, authToken: TOKEN, baseUrl: fake.url });
  const urls = { textUrl: 'u', voiceUrl: 'u', statusUrl: 'u' };
  const text = { from: '+12125551000', to: '+13055550100', body: 'x' };
  const secret = 'Attempt to send to unsubscribed recipient +13055550100';

  fake.failNext('POST', '/Messages.json', 400, { code: 21610, message: secret, status: 400 });
  await assert.rejects(twilio.sendText(text), (err) => {
    assert.ok(err instanceof ProviderError);
    assert.equal(err.message, 'The telephone provider refused this text.');
    assert.equal(err.code, 21610);
    assert.equal(err.status, 400);
    // The message of Twilio, which names a phone number, is not passed on.
    assert.ok(!JSON.stringify({ ...err, m: err.message, s: err.stack }).includes('+1305'));
    return true;
  });
  // Twilio accepts the request but reports the refusal in the answer (error 30034).
  fake.failNext('POST', '/Messages.json', 201, { sid: 'SM1', status: 'failed', error_code: 30034 });
  await assert.rejects(twilio.sendText(text), { message: 'The telephone provider refused this text.', code: 30034 });

  fake.failNext('POST', '/IncomingPhoneNumbers.json', 400, { code: 21422, message: 'PhoneNumber is not available', status: 400 });
  await assert.rejects(twilio.buy('+12125551000', urls), { unavailable: true, message: 'The telephone provider did not sell this number.' });
  fake.failNext('POST', '/IncomingPhoneNumbers.json', 400, { code: 21631, message: 'Address required', status: 400 });
  await assert.rejects(twilio.buy('+12125551000', urls), { unavailable: false, notFound: false });

  await assert.rejects(twilio.release('PN' + '0'.repeat(32)), { notFound: true });
  fake.failNext('POST', '/Calls.json', 401, { code: 20003, message: 'Authenticate', status: 401 });
  await assert.rejects(twilio.startCall({ from: 'a', to: 'b', answerUrl: 'u', statusUrl: 'u' }), { status: 401, message: 'The telephone provider did not accept the login of this server.' });
  fake.failNext('GET', '/AvailablePhoneNumbers/US/Local.json', 503, undefined);
  await assert.rejects(twilio.search({ country: 'US' }), { message: 'The telephone provider is not available. Try again later.' });

  // Nobody listens at this address: a plain error, not a crash.
  const dead = createTwilioProvider({ accountSid: SID, authToken: TOKEN, baseUrl: 'http://127.0.0.1:1' });
  await assert.rejects(dead.sendText(text), { name: 'ProviderError', status: 0 });

  assert.throws(() => createTwilioProvider({ accountSid: '', authToken: '' }), /TWILIO_ACCOUNT_SID/);
  assert.throws(() => createTwilioProvider({ accountSid: SID, authToken: '' }), /TWILIO_AUTH_TOKEN/);
});

test('adapter: status reports of Twilio', () => {
  const twilio = createTwilioProvider({ accountSid: SID, authToken: TOKEN, baseUrl: fake.url });
  const parse = (body) => twilio.parseStatus({ body });
  // The end of a <Dial>: the connected time counts, not the state of the parent call.
  assert.deepEqual(parse({ CallSid: 'CA1', CallStatus: 'in-progress', DialCallStatus: 'completed', DialCallDuration: '75' }), { callId: 'CA1', status: 'answered', seconds: 75 });
  assert.deepEqual(parse({ CallSid: 'CA1', CallStatus: 'in-progress', DialCallStatus: 'no-answer' }), { callId: 'CA1', status: 'missed', seconds: 0 });
  assert.deepEqual(parse({ CallSid: 'CA1', DialCallStatus: 'busy' }), { callId: 'CA1', status: 'missed', seconds: 0 });
  assert.deepEqual(parse({ CallSid: 'CA1', DialCallStatus: 'failed' }), { callId: 'CA1', status: 'failed', seconds: 0 });
  // The end of a whole call.
  assert.deepEqual(parse({ CallSid: 'CA1', CallStatus: 'completed', CallDuration: '12' }), { callId: 'CA1', status: 'answered', seconds: 12 });
  assert.deepEqual(parse({ CallSid: 'CA1', CallStatus: 'canceled' }), { callId: 'CA1', status: 'missed', seconds: 0 });
  // A call that has not ended is not a result.
  assert.equal(parse({ CallSid: 'CA1', CallStatus: 'ringing' }).status, null);
  assert.equal(parse({ CallSid: 'CA1', CallStatus: 'completed', CallDuration: '-5' }).seconds, 0);
  assert.deepEqual(parse({}), { callId: '', status: null, seconds: 0 });
});

test('end to end: search, buy, signed incoming text, send, refusal with refund, delete', async () => {
  const a = await newAccount(app, { credits: 1000 });
  const s = await a.api.get('/api/numbers/search?country=US&areaCode=415');
  assert.equal(s.status, 200);
  assert.equal(s.data.numbers.length, 20);
  assert.deepEqual(s.data.numbers[0], { number: '+14155551000', locality: 'Testville', region: 'TS', country: 'US', sms: true, voice: true });
  assert.equal(fake.last().fullPath, `${API}/AvailablePhoneNumbers/US/Local.json`);

  const made = await a.api.post('/api/numbers', { number: '+14155551000' });
  assert.equal(made.status, 201);
  const num = { ...made.data.number, plain: made.data.plain };
  // The webhook addresses come from the public URL of the configuration.
  assert.deepEqual(fake.last().form, {
    PhoneNumber: '+14155551000', SmsUrl: PUBLIC + HOOK.text, SmsMethod: 'POST', VoiceUrl: PUBLIC + HOOK.voice, VoiceMethod: 'POST',
    StatusCallback: PUBLIC + HOOK.status, StatusCallbackMethod: 'POST',
  });
  const pn = [...fake.bought.keys()].at(-1);
  // The reference is stored with server encryption.
  const row = app.db.get('SELECT provider_ref FROM numbers WHERE id = ?', num.id);
  assert.ok(!Buffer.from(row.provider_ref).includes(pn));
  assert.equal(app.keys.srvDecrypt(row.provider_ref, 'ref').toString(), pn);
  assert.deepEqual(await openJson(a.keys, unb64u(num.sealedNumber), 'number'), { number: '+14155551000' });

  // Incoming text, as Twilio posts it.
  const from = outsider();
  const params = {
    ToCountry: 'US', SmsMessageSid: 'SM0123', NumMedia: '0', SmsSid: 'SM0123', SmsStatus: 'received', Body: 'Hello there & welcome <3 + more',
    To: num.plain, From: from, MessageSid: 'SM0123', AccountSid: SID, ApiVersion: '2010-04-01', NumSegments: '1',
  };
  const ok = await twilioPost(HOOK.text, params);
  assert.equal(ok.status, 200);
  assert.match(ok.type, /^text\/xml/);
  assert.equal(ok.text, `${XML_HEAD}<Response/>`);
  let list = (await a.api.get(`/api/numbers/${num.id}/texts`)).data.texts;
  assert.equal(list.length, 1);
  assert.equal(list[0].direction, 'in');
  assert.deepEqual(await openJson(a.keys, unb64u(list[0].sealed), 'text'), { peer: from, body: 'Hello there & welcome <3 + more' });

  // Twilio delivers the same message a second time: it is stored one time.
  assert.equal((await twilioPost(HOOK.text, params)).status, 200);
  assert.equal((await a.api.get(`/api/numbers/${num.id}/texts`)).data.texts.length, 1);

  // Bad signatures: wrong value, signed for a different URL, signed with a different token,
  // a changed field, an added field, no header. The Host header does not matter.
  const good = sign(PUBLIC + HOOK.text, params);
  const refused = [
    twilioPost(HOOK.text, params, 'AAAAAAAAAAAAAAAAAAAAAAAAAAA='),
    twilioPost(HOOK.text, params, sign(PUBLIC + HOOK.voice, params)),
    twilioPost(HOOK.text, params, sign(app.url + HOOK.text, params)),
    twilioPost(HOOK.text, params, createHmac('sha1', 'other-token').update(PUBLIC + HOOK.text).digest('base64')),
    twilioPost(HOOK.text, { ...params, Body: 'Changed' }, good),
    twilioPost(HOOK.text, { ...params, Extra: '1' }, good),
    twilioPost(HOOK.text + '?x=1', params, good),
    twilioPost(HOOK.text, params, null),
    twilioPost(HOOK.voice, { ...params, CallSid: 'CAbad' }, good),
    twilioPost(HOOK.status, { ...params, CallSid: 'CAbad', CallStatus: 'completed' }, good),
    twilioPost(HOOK.bridge, params, good),
  ];
  for (const res of await Promise.all(refused)) assert.equal(res.status, 403);
  assert.equal((await a.api.get(`/api/numbers/${num.id}/texts`)).data.texts.length, 1);

  // A text for a number that is not ours: the same answer, and nothing is stored.
  const stray = { ...params, To: '+14155559999' };
  const unknown = await twilioPost(HOOK.text, stray);
  assert.equal(unknown.status, 200);
  assert.equal(unknown.text, ok.text);
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM texts').n, 1);

  // Send a text.
  const sent = await a.api.post(`/api/numbers/${num.id}/texts`, { number: num.plain, to: from, body: 'Thanks!' });
  assert.equal(sent.status, 201);
  assert.equal(fake.last().fullPath, `${API}/Messages.json`);
  // Twilio is told where to report the result of the message.
  assert.deepEqual(fake.last().form, { From: num.plain, To: from, Body: 'Thanks!', StatusCallback: PUBLIC + HOOK.textStatus });
  assert.equal(sent.data.text.status, 'queued');
  assert.equal(app.store.balance(a.id), 1000 - 400 - 3);

  // Twilio refuses (21610): 502 with a plain message, and the charge comes back.
  fake.failNext('POST', '/Messages.json', 400, { code: 21610, message: `Attempt to send to unsubscribed recipient ${from}`, status: 400 });
  const no = await a.api.post(`/api/numbers/${num.id}/texts`, { number: num.plain, to: from, body: 'Still there?' });
  assert.equal(no.status, 502);
  assert.deepEqual(no.data.error, { code: 'provider_error', message: 'The telephone provider refused this text.' });
  assert.equal(app.store.balance(a.id), 597);
  assert.deepEqual(ledger(a).slice(0, 3), ['refund:3', 'text:-3', 'text:-3']);
  // The same for a refusal inside an accepted answer (30034).
  fake.failNext('POST', '/Messages.json', 201, { sid: 'SMx', status: 'failed', error_code: 30034 });
  const no2 = await a.api.post(`/api/numbers/${num.id}/texts`, { number: num.plain, to: from, body: 'Hello?' });
  assert.equal(no2.status, 502);
  assert.equal(no2.data.error.message, 'The telephone provider refused this text.');
  assert.equal(app.store.balance(a.id), 597);
  assert.equal((await a.api.get(`/api/numbers/${num.id}/texts`)).data.texts.length, 2);

  // Twilio does not sell the number (21422): 409, refund.
  const b = await newAccount(app, { credits: 500 });
  const offer = (await b.api.get('/api/numbers/search?country=US&areaCode=415')).data.numbers[0].number;
  fake.failNext('POST', '/IncomingPhoneNumbers.json', 400, { code: 21422, message: `${offer} is not available`, status: 400 });
  const gone = await b.api.post('/api/numbers', { number: offer });
  assert.equal(gone.status, 409);
  assert.equal(gone.data.error.code, 'taken');
  assert.ok(!JSON.stringify(gone.data).includes(offer));
  assert.deepEqual(ledger(b), ['refund:400', 'number:-400', 'topup:500']);

  // Delete: Twilio fails first (row stays), then it works.
  fake.failNext('DELETE', `/IncomingPhoneNumbers/${pn}.json`, 500, { message: 'oops' });
  assert.equal((await a.api.del(`/api/numbers/${num.id}`)).status, 502);
  assert.equal((await a.api.get('/api/numbers')).data.numbers.length, 1);
  assert.equal((await a.api.del(`/api/numbers/${num.id}`)).status, 204);
  assert.equal(fake.last().method, 'DELETE');
  assert.equal(fake.last().fullPath, `${API}/IncomingPhoneNumbers/${pn}.json`);
  assert.ok(!fake.bought.has(pn));
  assert.deepEqual((await a.api.get('/api/numbers')).data.numbers, []);

  // A number that Twilio has forgotten (404) counts as released.
  const c = await newAccount(app, { credits: 500 });
  const cn = await buyNumber(c);
  fake.bought.clear();
  assert.equal((await c.api.del(`/api/numbers/${cn.id}`)).status, 204);
});

test('end to end: forwarded incoming call with TwiML, dial result, and one charge only', async () => {
  const a = await newAccount(app, { credits: 400 + 3 + 9 });
  const num = await buyNumber(a);
  const phone = await linkPhone(a, num);
  const caller = outsider();
  const base = { AccountSid: SID, ApiVersion: '2010-04-01', Direction: 'inbound', From: caller, To: num.plain, Caller: caller, Called: num.plain };

  // Forwarding is off: a message for the caller and a missed call.
  const v0 = await twilioPost(HOOK.voice, { ...base, CallSid: 'CAaaa0', CallStatus: 'ringing' });
  assert.equal(v0.status, 200);
  assert.match(v0.type, /^text\/xml/);
  assert.equal(v0.text, NOT_AVAILABLE_XML);
  let log = await calls(a, num);
  assert.equal(log.length, 1);
  assert.equal(log[0].status, 'missed');
  // Twilio then reports the end of that short call. It is in the log already.
  const s0 = await twilioPost(HOOK.status, { ...base, CallSid: 'CAaaa0', CallStatus: 'completed', CallDuration: '4' });
  assert.equal(s0.status, 200);
  assert.equal((await calls(a, num)).length, 1);
  assert.equal(app.store.balance(a.id), 9);

  await a.api.patch(`/api/numbers/${num.id}`, { forwardPhoneId: phone.id, forwardCalls: true });
  const v1 = await twilioPost(HOOK.voice, { ...base, CallSid: 'CAaaa1', CallStatus: 'ringing' });
  assert.equal(v1.status, 200);
  // The real phone rings for 25 seconds and sees the number of the original caller.
  // The balance (9) pays for 3 minutes, so Twilio ends the call after 180 seconds.
  assert.equal(
    v1.text,
    `${XML_HEAD}<Response><Dial callerId="${caller}" timeout="25" timeLimit="180" action="${PUBLIC}${HOOK.status}" method="POST"><Number>${phone.plain}</Number></Dial></Response>`,
  );
  assert.equal((await calls(a, num)).length, 1);

  // The <Dial> ended after 75 seconds of talk.
  const dial = { ...base, CallSid: 'CAaaa1', CallStatus: 'in-progress', DialCallStatus: 'completed', DialCallDuration: '75', DialCallSid: 'CAbbb1' };
  const s1 = await twilioPost(HOOK.status, dial);
  assert.equal(s1.status, 200);
  assert.match(s1.type, /^text\/xml/);
  assert.equal(s1.text, HANGUP_XML);
  log = await calls(a, num);
  assert.equal(log.length, 2);
  assert.deepEqual({ direction: log[0].direction, seconds: log[0].seconds, status: log[0].status }, { direction: 'in', seconds: 75, status: 'answered' });
  assert.deepEqual(await openJson(a.keys, unb64u(log[0].sealed), 'call'), { peer: caller });
  assert.equal(app.store.balance(a.id), 3);
  assert.equal(ledger(a)[0], 'call:-6');

  // Twilio reports the end of the whole call too (longer: it has the ring time). No second charge.
  await twilioPost(HOOK.status, { ...base, CallSid: 'CAaaa1', CallStatus: 'completed', CallDuration: '83' });
  await twilioPost(HOOK.status, dial);
  assert.equal((await calls(a, num)).length, 2);
  assert.equal(app.store.balance(a.id), 3);

  // Nobody answers the forwarded call.
  await twilioPost(HOOK.voice, { ...base, CallSid: 'CAaaa2', CallStatus: 'ringing' });
  await twilioPost(HOOK.status, { ...base, CallSid: 'CAaaa2', CallStatus: 'in-progress', DialCallStatus: 'no-answer' });
  log = await calls(a, num);
  assert.equal(log[0].status, 'missed');
  assert.equal(app.store.balance(a.id), 3);

  // A long call: the charge stops at the balance. Then the balance is too low to forward.
  await twilioPost(HOOK.voice, { ...base, CallSid: 'CAaaa3', CallStatus: 'ringing' });
  await twilioPost(HOOK.status, { ...base, CallSid: 'CAaaa3', CallStatus: 'in-progress', DialCallStatus: 'completed', DialCallDuration: '600' });
  assert.equal(app.store.balance(a.id), 0);
  const v4 = await twilioPost(HOOK.voice, { ...base, CallSid: 'CAaaa4', CallStatus: 'ringing' });
  assert.equal(v4.text, NOT_AVAILABLE_XML);

  // A call to a number that is not ours gets the same neutral answer.
  const stray = await twilioPost(HOOK.voice, { ...base, To: '+14155559999', Called: '+14155559999', CallSid: 'CAaaa5', CallStatus: 'ringing' });
  assert.equal(stray.status, 200);
  assert.equal(stray.text, NOT_AVAILABLE_XML);
  assert.equal((await calls(a, num)).length, 5);
});

test('end to end: click-to-call through Calls.json, the signed bridge URL, and the status report', async () => {
  const a = await newAccount(app, { credits: 500 });
  const num = await buyNumber(a);
  const phone = await linkPhone(a, num);
  await a.api.patch(`/api/numbers/${num.id}`, { forwardPhoneId: phone.id });
  const to = outsider();

  const res = await a.api.post(`/api/numbers/${num.id}/calls`, { number: num.plain, to });
  assert.equal(res.status, 201);
  assert.deepEqual(res.data, { ok: true });
  const req = fake.last();
  assert.equal(req.fullPath, `${API}/Calls.json`);
  // Twilio calls the real phone first. The destination is not in this request.
  assert.deepEqual({ ...req.form, Url: '' }, { To: phone.plain, From: num.plain, Url: '', Method: 'POST', StatusCallback: PUBLIC + HOOK.status, StatusCallbackMethod: 'POST' });
  assert.ok(!req.raw.includes(encodeURIComponent(to)));
  const bridgeUrl = new URL(req.form.Url);
  assert.equal(bridgeUrl.origin + bridgeUrl.pathname, PUBLIC + HOOK.bridge);
  const bridgePath = bridgeUrl.pathname + bridgeUrl.search;

  // The real phone answered. Twilio signs the full URL with its query string.
  const parent = { AccountSid: SID, CallSid: 'CA' + 'c'.repeat(32), From: num.plain, To: phone.plain, CallStatus: 'in-progress', Direction: 'outbound-api' };
  assert.equal((await twilioPost(bridgePath, parent, sign(PUBLIC + HOOK.bridge, parent))).status, 403);
  const noToken = await twilioPost(HOOK.bridge, parent);
  assert.equal(noToken.status, 200);
  assert.equal(noToken.text, HANGUP_XML);
  const bridge = await twilioPost(bridgePath, parent);
  assert.equal(bridge.status, 200);
  assert.match(bridge.type, /^text\/xml/);
  // The destination sees the VoIP number, never the real phone.
  assert.equal(
    bridge.text,
    `${XML_HEAD}<Response><Dial callerId="${num.plain}" timeout="25" timeLimit="1920" action="${PUBLIC}${HOOK.status}" method="POST"><Number>${to}</Number></Dial></Response>`,
  );
  assert.ok(!bridge.text.includes(phone.plain));
});

test('end to end: click-to-call is logged and charged with the call id that Twilio gave', async () => {
  const a = await newAccount(app, { credits: 500 });
  const num = await buyNumber(a);
  const phone = await linkPhone(a, num);
  await a.api.patch(`/api/numbers/${num.id}`, { forwardPhoneId: phone.id });
  const to = outsider();
  const parentOf = (sid, extra) => ({ AccountSid: SID, CallSid: sid, From: num.plain, To: phone.plain, Direction: 'outbound-api', ...extra });

  // Fix the call id that the fake returns, so that the test can report on that call.
  const sid1 = 'CA' + '1'.repeat(32);
  fake.failNext('POST', '/Calls.json', 201, { sid: sid1, status: 'queued' });
  assert.equal((await a.api.post(`/api/numbers/${num.id}/calls`, { number: num.plain, to })).status, 201);
  const bridgeUrl = new URL(fake.last().form.Url);
  await twilioPost(bridgeUrl.pathname + bridgeUrl.search, parentOf(sid1, { CallStatus: 'in-progress' }));
  assert.equal((await calls(a, num)).length, 0);
  // The <Dial> to the destination ended after 130 seconds: 3 minutes.
  const done = await twilioPost(HOOK.status, parentOf(sid1, { CallStatus: 'in-progress', DialCallStatus: 'completed', DialCallDuration: '130' }));
  assert.equal(done.text, HANGUP_XML);
  let log = await calls(a, num);
  assert.equal(log.length, 1);
  assert.deepEqual({ direction: log[0].direction, seconds: log[0].seconds, status: log[0].status }, { direction: 'out', seconds: 130, status: 'answered' });
  assert.deepEqual(await openJson(a.keys, unb64u(log[0].sealed), 'call'), { peer: to });
  assert.equal(app.store.balance(a.id), 500 - 400 - 3 - 9);
  // The end of the parent call arrives after that. Nothing more happens.
  await twilioPost(HOOK.status, parentOf(sid1, { CallStatus: 'completed', CallDuration: '141' }));
  assert.equal((await calls(a, num)).length, 1);
  assert.equal(app.store.balance(a.id), 88);

  // The real phone never answers: Twilio reports "no-answer" for the parent call.
  const sid2 = 'CA' + '2'.repeat(32);
  fake.failNext('POST', '/Calls.json', 201, { sid: sid2, status: 'queued' });
  assert.equal((await a.api.post(`/api/numbers/${num.id}/calls`, { number: num.plain, to })).status, 201);
  await twilioPost(HOOK.status, parentOf(sid2, { CallStatus: 'no-answer' }));
  log = await calls(a, num);
  assert.equal(log.length, 2);
  assert.deepEqual({ direction: log[0].direction, seconds: log[0].seconds, status: log[0].status }, { direction: 'out', seconds: 0, status: 'missed' });
  assert.equal(app.store.balance(a.id), 88);

  // Twilio refuses to start the call.
  fake.failNext('POST', '/Calls.json', 400, { code: 21215, message: `Geo permission for ${to}`, status: 400 });
  const no = await a.api.post(`/api/numbers/${num.id}/calls`, { number: num.plain, to });
  assert.equal(no.status, 502);
  assert.deepEqual(no.data.error, { code: 'provider_error', message: 'The telephone provider refused this call.' });
});

test('end to end: a text is forwarded to the real phone through Twilio', async () => {
  const a = await newAccount(app, { credits: 500 });
  const num = await buyNumber(a);
  const phone = await linkPhone(a, num);
  await a.api.patch(`/api/numbers/${num.id}`, { forwardPhoneId: phone.id, forwardTexts: true });
  const from = outsider();
  const count = fake.requests.length;
  const res = await twilioPost(HOOK.text, { From: from, To: num.plain, Body: 'Your parcel is here', MessageSid: 'SM77', AccountSid: SID });
  assert.equal(res.status, 200);
  assert.equal(fake.requests.length, count + 1);
  assert.equal(fake.last().fullPath, `${API}/Messages.json`);
  assert.deepEqual(fake.last().form, { From: num.plain, To: phone.plain, Body: `${from}: Your parcel is here`, StatusCallback: PUBLIC + HOOK.textStatus });
  assert.equal(app.store.balance(a.id), 500 - 400 - 3 - 3);
});

test('adapter: status callback for texts, and what the adapter can do', async () => {
  const twilio = createTwilioProvider({ accountSid: SID, authToken: TOKEN, baseUrl: fake.url });
  assert.deepEqual(twilio.capabilities, { voice: true, asyncText: true, searchByArea: true });
  assert.deepEqual(app.services.phone.capabilities, { voice: true, asyncText: true, searchByArea: true });

  // The address for status reports goes to Twilio with the message. A new message is "queued".
  const sent = await twilio.sendText({ from: '+12125551000', to: '+13055550100', body: 'Hi', statusUrl: PUBLIC + HOOK.textStatus });
  assert.deepEqual(fake.last().form, { From: '+12125551000', To: '+13055550100', Body: 'Hi', StatusCallback: PUBLIC + HOOK.textStatus });
  assert.match(sent.ref, /^SM[0-9a-f]{32}$/);
  assert.equal(sent.status, 'queued');
  fake.failNext('POST', '/Messages.json', 201, { sid: 'SM2', status: 'sent', error_code: null });
  assert.equal((await twilio.sendText({ from: '+12125551000', to: '+13055550100', body: 'Hi' })).status, 'sent');
  fake.failNext('POST', '/Messages.json', 201, { sid: 'SM3', status: 'accepted', error_code: null });
  assert.equal((await twilio.sendText({ from: '+12125551000', to: '+13055550100', body: 'Hi' })).status, 'queued');

  const parse = (body) => twilio.parseTextStatus({ body });
  const statusOf = (MessageStatus) => parse({ MessageSid: 'SM1', MessageStatus }).status;
  assert.deepEqual(['accepted', 'scheduled', 'queued'].map(statusOf), ['queued', 'queued', 'queued']);
  assert.deepEqual(['sending', 'sent'].map(statusOf), ['sent', 'sent']);
  assert.deepEqual(['delivered', 'read'].map(statusOf), ['delivered', 'delivered']);
  assert.deepEqual(['undelivered', 'failed', 'canceled'].map(statusOf), ['failed', 'failed', 'failed']);
  // Words that are no result, and names of built-in object fields.
  assert.deepEqual(['receiving', 'received', 'constructor', '__proto__', '', undefined].map(statusOf), [null, null, null, null, null, null]);
  assert.deepEqual(parse({ MessageSid: 'SM1', MessageStatus: 'undelivered', ErrorCode: '30034' }), { ref: 'SM1', status: 'failed', errorText: 'Twilio error 30034' });
  // An error code that is not a short number is dropped: it could be anything.
  assert.deepEqual(parse({ MessageSid: 'SM1', MessageStatus: 'failed', ErrorCode: 'call +13055550100' }), { ref: 'SM1', status: 'failed', errorText: '' });
  assert.deepEqual(parse({}), { ref: '', status: null, errorText: '' });
});

test('end to end: Twilio reports the result of a text with a signed status callback', async () => {
  const a = await newAccount(app, { credits: 500 });
  const num = await buyNumber(a);
  const to = outsider();
  const statusOf = async (id) => (await a.api.get(`/api/numbers/${num.id}/texts`)).data.texts.find((t) => t.id === id).status;
  const send = async (sid, body) => {
    // Fix the message id that the fake returns, so that the test can report on that message.
    fake.failNext('POST', '/Messages.json', 201, { sid, status: 'queued', error_code: null });
    const res = await a.api.post(`/api/numbers/${num.id}/texts`, { number: num.plain, to, body });
    assert.equal(res.status, 201);
    assert.equal(res.data.text.status, 'queued');
    return res.data.text;
  };
  // The status callback as Twilio posts it.
  const report = (sid, status, extra = {}) => twilioPost(HOOK.textStatus, {
    AccountSid: SID, ApiVersion: '2010-04-01', From: num.plain, To: to, MessageSid: sid, SmsSid: sid, MessageStatus: status, SmsStatus: status, ...extra,
  });
  const warnings = [];
  const realWarn = app.log.warn;
  app.log.warn = (message) => warnings.push(message);
  try {
    const sid1 = 'SM' + '1'.repeat(32);
    const t1 = await send(sid1, 'One');
    assert.equal(app.store.balance(a.id), 97);

    // A bad or missing signature: 403, and nothing changes.
    const fields = { MessageSid: sid1, MessageStatus: 'failed', ErrorCode: '30034' };
    for (const sig of ['AAAAAAAAAAAAAAAAAAAAAAAAAAA=', sign(PUBLIC + HOOK.text, fields), sign(app.url + HOOK.textStatus, fields), null]) {
      assert.equal((await twilioPost(HOOK.textStatus, fields, sig)).status, 403);
    }
    assert.equal(await statusOf(t1.id), 'queued');
    assert.equal(app.store.balance(a.id), 97);

    const first = await report(sid1, 'sent');
    assert.equal(first.status, 200);
    assert.match(first.type, /^text\/xml/);
    assert.equal(first.text, `${XML_HEAD}<Response/>`);
    assert.equal(await statusOf(t1.id), 'sent');
    // Twilio can deliver reports in the wrong order. The status does not go back.
    await report(sid1, 'sending');
    await report(sid1, 'queued');
    assert.equal(await statusOf(t1.id), 'sent');
    await report(sid1, 'delivered');
    assert.equal(await statusOf(t1.id), 'delivered');
    // "delivered" is final: a later "failed" changes nothing and pays nothing back.
    await report(sid1, 'failed', { ErrorCode: '30008' });
    await report(sid1, 'sent');
    assert.equal(await statusOf(t1.id), 'delivered');
    assert.equal(app.store.balance(a.id), 97);
    assert.deepEqual(warnings, []);

    // The carrier blocks a text after Twilio accepted it (error 30034): failed, and the charge comes back.
    const sid2 = 'SM' + '2'.repeat(32);
    const t2 = await send(sid2, 'Two');
    assert.equal(app.store.balance(a.id), 94);
    await report(sid2, 'undelivered', { ErrorCode: '30034', ErrorMessage: `Message to ${to} blocked` });
    assert.equal(await statusOf(t2.id), 'failed');
    assert.equal(app.store.balance(a.id), 97);
    assert.equal(ledger(a)[0], 'refund:3');
    // Exactly one time.
    await report(sid2, 'undelivered', { ErrorCode: '30034' });
    await report(sid2, 'failed', { ErrorCode: '30034' });
    assert.equal(app.store.balance(a.id), 97);
    assert.equal(ledger(a).filter((l) => l === 'refund:3').length, 1);
    // The operator sees the error code in the log, and no phone number.
    assert.deepEqual(warnings, ['the provider did not deliver a text (Twilio error 30034)']);

    // A report for a message that is not ours, and a status that is no result.
    assert.equal((await report('SM' + '9'.repeat(32), 'failed')).status, 200);
    const sid3 = 'SM' + '3'.repeat(32);
    const t3 = await send(sid3, 'Three');
    assert.equal((await report(sid3, 'receiving')).status, 200);
    assert.equal(await statusOf(t3.id), 'queued');
    assert.equal(app.store.balance(a.id), 94);
  } finally {
    app.log.warn = realWarn;
  }
});

test('end to end: phone link by a call; Twilio gets TwiML that speaks the code', async () => {
  const a = await newAccount(app, { credits: 500 });
  const num = await buyNumber(a);
  const number = realPhone();
  const messages = fake.requests.filter((r) => r.path === '/Messages.json').length;

  const res = await a.api.post('/api/phones', { number, method: 'call', via: { numberId: num.id, number: num.plain } });
  assert.equal(res.status, 201);
  assert.equal(res.data.phone.verified, false);
  // Twilio calls the real phone from the VoIP number. No text is sent.
  const req = fake.last();
  assert.equal(req.fullPath, `${API}/Calls.json`);
  assert.deepEqual({ ...req.form, Url: '' }, { To: number, From: num.plain, Url: '', Method: 'POST', StatusCallback: PUBLIC + HOOK.status, StatusCallbackMethod: 'POST' });
  assert.equal(fake.requests.filter((r) => r.path === '/Messages.json').length, messages);
  const answerUrl = new URL(req.form.Url);
  assert.equal(answerUrl.origin + answerUrl.pathname, PUBLIC + HOOK.sayCode);
  assert.match(answerUrl.searchParams.get('token'), /^[A-Za-z0-9_-]{43}$/);
  // One fixed charge.
  assert.equal(app.store.balance(a.id), 500 - 400 - 3);
  assert.equal(ledger(a)[0], 'call:-3');

  // The phone answers. Twilio asks the say-code address, signed for the full URL with its query string.
  const path = answerUrl.pathname + answerUrl.search;
  const parent = { AccountSid: SID, CallSid: 'CA' + 'd'.repeat(32), From: num.plain, To: number, CallStatus: 'in-progress', Direction: 'outbound-api' };
  assert.equal((await twilioPost(path, parent, sign(PUBLIC + HOOK.sayCode, parent))).status, 403);
  assert.equal((await twilioPost(path, parent, null)).status, 403);
  const unknown = await twilioPost(HOOK.sayCode + '?token=' + 'A'.repeat(43), parent);
  assert.equal(unknown.text, HANGUP_XML);
  const spoken = await twilioPost(path, parent);
  assert.equal(spoken.status, 200);
  assert.match(spoken.type, /^text\/xml/);
  const m = /^<\?xml version="1\.0" encoding="UTF-8"\?><Response><Say>Your Postern code is (\d(?:, \d){5})\.<\/Say><Say>Your Postern code is (\d(?:, \d){5})\.<\/Say><Hangup\/><\/Response>$/.exec(spoken.text);
  assert.ok(m, spoken.text);
  assert.equal(m[1], m[2]);
  const code = m[1].replace(/\D/g, '');
  // The code was not in the request that started the call. Twilio gets it only when the phone answers.
  assert.ok(!req.raw.includes(code));

  // The end of this call makes no line in the call log and no more charge.
  await twilioPost(HOOK.status, { ...parent, CallStatus: 'completed', CallDuration: '14' });
  assert.equal((await calls(a, num)).length, 0);
  assert.equal(app.store.balance(a.id), 97);

  const wrong = code === '000000' ? '000001' : '000000';
  assert.equal((await a.api.post(`/api/phones/${res.data.phone.id}/verify`, { code: wrong })).status, 400);
  const good = await a.api.post(`/api/phones/${res.data.phone.id}/verify`, { code });
  assert.equal(good.status, 200);
  assert.equal(good.data.phone.verified, true);

  // Twilio refuses to start the call: the charge comes back.
  fake.failNext('POST', '/Calls.json', 400, { code: 21215, message: 'Geo permission', status: 400 });
  const no = await a.api.post('/api/phones', { number: realPhone(), method: 'call', via: { numberId: num.id, number: num.plain } });
  assert.equal(no.status, 502);
  assert.equal(no.data.error.message, 'The telephone provider refused this call.');
  assert.equal(app.store.balance(a.id), 97);
  assert.equal((await a.api.get('/api/phones')).data.phones.length, 1);
});
