// A fake of the private server of "SMS Gateway for Android" (SMSGate), for tests.
// It has the parts of the "3rd-party" API that Postern uses, with HTTP Basic logins:
//   GET /devices, POST /messages, GET /messages/{id}, GET|POST /webhooks, DELETE /webhooks/{id},
//   GET|PATCH /settings, GET /health
// The shapes and the limits follow docs/api/swagger.json of the app (v1.78.0).
//
// It also has a fake PHONE: gateway.phone(login, deviceId) posts webhooks the way the app does,
// to the address that was registered for the event, signed with the signing key from the
// settings: X-Timestamp = Unix seconds, X-Signature = hex(HMAC-SHA256(key, body + X-Timestamp)).
import http from 'node:http';
import { createHmac, randomBytes } from 'node:crypto';

const BASE = '/api/3rdparty/v1';
const EVENTS = ['sms:received', 'sms:data-received', 'sms:sent', 'sms:delivered', 'sms:failed', 'sms:cancelled', 'system:ping', 'mms:received', 'mms:downloaded', 'app:started', 'sms:batch:received', 'sms:batch:data-received', 'mms:batch:received', 'mms:batch:downloaded'];
const nano = (n = 21) => randomBytes(n).toString('base64url').slice(0, n);

export async function startFakeGateway() {
  // login -> { password, devices: [{ id, name, lastSeen, simCards }], webhooks: Map(id -> hook), settings, messages: Map(id -> message) }
  const users = new Map();
  const requests = []; // { method, path, login, body, status }
  let failNext = null; // { status, times }
  let sockets = new Set();

  function send(res, status, body) {
    const text = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, text ? { 'content-type': 'application/json' } : {});
    res.end(text);
    return status;
  }
  const error = (res, status, message) => send(res, status, { code: status, message });
  function merge(target, patch) {
    for (const [k, v] of Object.entries(patch)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) { target[k] = merge(target[k] && typeof target[k] === 'object' ? target[k] : {}, v); } else target[k] = v;
    }
    return target;
  }

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url, 'http://x');
    const path = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : null;
    let body;
    try { body = raw ? JSON.parse(raw) : undefined; } catch { body = null; }
    const entry = { method: req.method, path: path ?? url.pathname, login: '', body, status: 0 };
    requests.push(entry);
    const done = (status, data) => { entry.status = send(res, status, data); };
    const fail = (status, message) => { entry.status = error(res, status, message); };

    if (path === null) return fail(404, 'not found');
    if (req.method === 'GET' && path === '/health') return done(200, { status: 'pass', version: '1.0.0', releaseId: 1, checks: {} });
    if (failNext && failNext.times > 0) { failNext.times--; return fail(failNext.status, 'simulated failure'); }
    // A test can refuse chosen requests: gateway.failIf = ({ method, path, body }) => HTTP status, or 0 to let it pass.
    const refused = gateway.failIf ? gateway.failIf(entry) : 0;
    if (refused) return fail(refused, 'simulated failure');

    const auth = /^Basic (.+)$/.exec(req.headers.authorization || '');
    const [login, ...pw] = auth ? Buffer.from(auth[1], 'base64').toString('utf8').split(':') : [''];
    const user = users.get(login);
    if (!user || user.password !== pw.join(':')) return fail(401, 'Unauthorized');
    entry.login = login;
    if (body === null) return fail(400, 'invalid JSON');

    if (req.method === 'GET' && path === '/devices') return done(200, user.devices.map((d) => ({ ...d })));

    if (req.method === 'POST' && path === '/messages') {
      const m = body || {};
      if (!Array.isArray(m.phoneNumbers) || m.phoneNumbers.length < 1 || m.phoneNumbers.length > 100 || m.phoneNumbers.some((p) => typeof p !== 'string' || !p)) return fail(400, 'phoneNumbers is not valid');
      if (!m.textMessage || typeof m.textMessage.text !== 'string' || m.textMessage.text.length < 1 || m.textMessage.text.length > 65535) return fail(400, 'textMessage.text is not valid');
      if (m.id !== undefined && (typeof m.id !== 'string' || m.id.length > 36)) return fail(400, 'id is not valid');
      if (m.deviceId !== undefined && (typeof m.deviceId !== 'string' || m.deviceId.length > 21)) return fail(400, 'deviceId is not valid');
      if (m.simNumber !== undefined && (!Number.isInteger(m.simNumber) || m.simNumber < 1 || m.simNumber > 3)) return fail(400, 'simNumber is not valid');
      if (m.ttl !== undefined && (!Number.isInteger(m.ttl) || m.ttl < 5)) return fail(400, 'ttl is not valid');
      if (m.ttl !== undefined && m.validUntil !== undefined) return fail(400, 'ttl conflicts with validUntil');
      if (m.withDeliveryReport !== undefined && typeof m.withDeliveryReport !== 'boolean') return fail(400, 'withDeliveryReport is not valid');
      // The real server checks each number with a phone number library. The fake refuses what a test marked as bad.
      if (m.phoneNumbers.some((p) => user.badNumbers.has(p))) return fail(400, 'invalid phone number');
      const device = m.deviceId ? user.devices.find((d) => d.id === m.deviceId) : user.devices[0];
      if (!device) return fail(400, 'device not found');
      const id = m.id || nano();
      if (user.messages.has(id)) return fail(409, 'message with the same ID already exists');
      const stored = { id, deviceId: device.id, state: 'Pending', isHashed: false, isEncrypted: false, recipients: m.phoneNumbers.map((p) => ({ phoneNumber: p, state: 'Pending' })), states: {}, request: m };
      user.messages.set(id, stored);
      return done(202, { id, deviceId: device.id, state: 'Pending', isHashed: false, isEncrypted: false, recipients: stored.recipients, states: {} });
    }
    const one = /^\/messages\/([^/]+)$/.exec(path);
    if (req.method === 'GET' && one) {
      const m = user.messages.get(decodeURIComponent(one[1]));
      if (!m) return fail(404, 'not found');
      return done(200, { id: m.id, deviceId: m.deviceId, state: m.state, isHashed: false, isEncrypted: false, recipients: m.recipients, states: m.states });
    }

    if (req.method === 'GET' && path === '/webhooks') return done(200, [...user.webhooks.values()]);
    if (req.method === 'POST' && path === '/webhooks') {
      const w = body || {};
      if (typeof w.url !== 'string' || !/^https?:\/\//.test(w.url)) return fail(400, 'url is not valid');
      if (!EVENTS.includes(w.event)) return fail(400, 'event is not valid');
      if (w.id !== undefined && (typeof w.id !== 'string' || w.id.length > 36)) return fail(400, 'id is not valid');
      if (w.deviceId !== undefined && (typeof w.deviceId !== 'string' || w.deviceId.length > 21)) return fail(400, 'deviceId is not valid');
      const hook = { id: w.id || nano(), url: w.url, event: w.event, ...(w.deviceId ? { deviceId: w.deviceId } : {}) };
      user.webhooks.set(hook.id, hook); // the same id replaces the old webhook
      return done(201, hook);
    }
    const hookId = /^\/webhooks\/([^/]+)$/.exec(path);
    if (req.method === 'DELETE' && hookId) { user.webhooks.delete(decodeURIComponent(hookId[1])); return done(204); }

    if (req.method === 'GET' && path === '/settings') return done(200, user.settings);
    if (req.method === 'PATCH' && path === '/settings') {
      const s = body || {};
      if (s.ping && s.ping.interval_seconds !== undefined && (!Number.isInteger(s.ping.interval_seconds) || s.ping.interval_seconds < 1)) return fail(400, 'ping.interval_seconds is not valid');
      if (s.webhooks && s.webhooks.signing_key !== undefined && typeof s.webhooks.signing_key !== 'string') return fail(400, 'webhooks.signing_key is not valid');
      merge(user.settings, s);
      return done(200, user.settings);
    }
    return fail(404, 'not found');
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const gateway = {
    url: origin + BASE,
    failIf: null,
    requests,
    users,
    // Makes a login with phones. devices: [{ name, sims: [1, 2] }] ; returns { login, password, devices: [{ id, ... }] }.
    addUser({ login = 'U' + nano(5).toUpperCase(), password = 'pw-' + nano(14), devices = [{ name: 'Android phone', sims: [1] }] } = {}) {
      const list = devices.map((d) => ({
        id: d.id || nano(21), name: d.name || 'Android phone', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', lastSeen: '2026-11-11T00:00:00Z',
        // A phone often does not know the number of its SIM: phoneNumber is empty unless the test gives one.
        simCards: (d.sims || [1]).map((n) => (typeof n === 'object' ? n : { simNumber: n, slotIndex: n - 1, phoneNumber: '', carrierName: 'Test Mobile', iccid: null })),
      }));
      users.set(login, { password, devices: list, webhooks: new Map(), settings: {}, messages: new Map(), badNumbers: new Set() });
      return { login, password, devices: list };
    },
    // The next `times` requests with a login get this HTTP status.
    failNext(status, times = 1) { failNext = { status, times }; },
    messagesOf(login) { return [...users.get(login).messages.values()]; },
    lastMessage(login) { return gateway.messagesOf(login).at(-1) || null; },

    // The fake phone of one device. appUrl: where the app under test listens (the registered
    // address has the public name of the server, which no test server has).
    phone(login, deviceId, appUrl) {
      const user = users.get(login);
      const phone = {
        // Posts one event the way the app does. Options replace parts, for tests of wrong requests:
        //   signature, timestamp (Unix seconds), key (signing key), url (full address), deviceId, rawBody
        async post(event, payload, opt = {}) {
          const hook = [...user.webhooks.values()].find((w) => w.event === event && (!w.deviceId || w.deviceId === deviceId));
          if (!hook && !opt.url) return { status: 0, skipped: true }; // no webhook for this event: the phone sends nothing
          const registered = new URL(opt.url || hook.url);
          const target = appUrl + registered.pathname;
          const raw = opt.rawBody ?? JSON.stringify({ id: opt.id || nano(21), webhookId: hook ? hook.id : 'none', deviceId: opt.deviceId || deviceId, event, payload });
          const key = opt.key ?? (user.settings.webhooks && user.settings.webhooks.signing_key);
          const headers = { 'content-type': 'application/json' };
          if (key) {
            const stamp = String(opt.timestamp ?? Math.floor(Date.now() / 1000));
            headers['x-timestamp'] = stamp;
            headers['x-signature'] = opt.signature ?? createHmac('sha256', Buffer.from(key, 'utf8')).update(raw + stamp).digest('hex');
          }
          const res = await fetch(target, { method: 'POST', headers, body: raw });
          return { status: res.status, raw };
        },
        ping: (opt) => phone.post('system:ping', { health: { status: 'pass', version: '1.78.0', releaseId: 178, checks: {} } }, opt),
        // An incoming text. sim: the SIM slot, or null when the phone cannot say. recipient: the number of the SIM, or null.
        receive: ({ from, text, sim = null, recipient = null, messageId = nano(8), receivedAt = new Date().toISOString() }, opt) => phone.post('sms:received', { messageId, message: text, phoneNumber: from, sender: from, recipient, simNumber: sim, receivedAt }, opt),
        // Reports about a text that the gateway took: 'sent' | 'delivered' | 'failed'.
        report(state, messageId, { reason = 'RESULT_ERROR_GENERIC_FAILURE' } = {}, opt) {
          const m = user.messages.get(messageId);
          const base = { messageId, phoneNumber: m ? m.request.phoneNumbers[0] : '', sender: null, recipient: m ? m.request.phoneNumbers[0] : '', simNumber: m ? m.request.simNumber ?? null : null };
          if (m) { m.state = state[0].toUpperCase() + state.slice(1); m.recipients.forEach((r) => { r.state = m.state; }); }
          if (state === 'sent') return phone.post('sms:sent', { ...base, partsCount: 1, sentAt: new Date().toISOString() }, opt);
          if (state === 'delivered') return phone.post('sms:delivered', { ...base, deliveredAt: new Date().toISOString() }, opt);
          return phone.post('sms:failed', { ...base, failedAt: new Date().toISOString(), reason }, opt);
        },
      };
      return phone;
    },

    async stop() {
      for (const s of sockets) s.destroy();
      sockets = new Set();
      await new Promise((resolve) => server.close(resolve));
    },
  };
  return gateway;
}
