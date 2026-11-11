// "Own phone" provider: Android phones with the open-source app "SMS Gateway for Android"
// (SMSGate). Each SIM is one number of a fixed pool (see ../pool.js).
//
// The phones connect out to the private server of that app. This file talks to the
// "3rd-party" HTTP API of that server, with the login and password that the app shows for
// each phone (HTTP Basic). It does not speak the protocol of the phone itself.
//   POST   {apiUrl}/messages   { id, deviceId, phoneNumbers: [to], textMessage: { text }, simNumber, ttl, withDeliveryReport }  -> 202
//   GET    {apiUrl}/devices    -> [{ id, name, lastSeen, simCards: [{ simNumber, phoneNumber, ... }] }]
//   POST   {apiUrl}/webhooks   { id, url, event, deviceId }  -> 201 ; DELETE {apiUrl}/webhooks/{id} -> 204
//   PATCH  {apiUrl}/settings   { webhooks: { signing_key }, ping: { interval_seconds } }  -> 200
// The results of a text (sent, delivered, failed) and incoming texts come as webhooks that
// the PHONE posts to this server (see ../ownphone.js). The provider interface is in mock.js.
//
// Texts only. The app cannot make or take calls for somebody else, so voice is false.
// An error message for the user never has a number, a login, or an answer of the gateway in it.
import { randomId } from '../../core/keys.js';
import { ProviderError } from './errors.js';

const TIMEOUT_MS = 15_000;
const NOT_REACHABLE = 'The phone gateway is not reachable.';
const NOT_ACCEPTED = 'The phone did not accept this text.';
export const WEBHOOK_EVENTS = ['sms:received', 'sms:sent', 'sms:delivered', 'sms:failed', 'system:ping'];

// A small client for the 3rd-party API. creds = { login, password }.
// Every function throws ProviderError: status 0 = no answer, else the HTTP status of the gateway.
export function createGatewayClient({ apiUrl, fetchFn = fetch, timeoutMs = TIMEOUT_MS }) {
  const base = String(apiUrl || '').replace(/\/+$/, '');
  async function call(creds, method, path, body) {
    const headers = { accept: 'application/json', authorization: 'Basic ' + Buffer.from(`${creds.login}:${creds.password}`, 'utf8').toString('base64') };
    const init = { method, headers, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) };
    if (body !== undefined) { headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    let res;
    try {
      res = await fetchFn(base + path, init);
    } catch {
      throw new ProviderError(NOT_REACHABLE);
    }
    let data = null;
    try {
      const text = await res.text();
      data = text ? JSON.parse(text) : null;
    } catch { data = null; }
    if (!res.ok) {
      // 5xx: the gateway itself has a problem. 503 on /messages means "queue limits": the gateway answers, the text is refused.
      throw new ProviderError(res.status >= 500 && res.status !== 503 ? NOT_REACHABLE : 'The phone gateway refused the request.', { status: res.status, notFound: res.status === 404 });
    }
    return data;
  }
  return {
    apiUrl: base,
    devices: async (creds) => { const list = await call(creds, 'GET', '/devices'); return Array.isArray(list) ? list : []; },
    sendMessage: (creds, message) => call(creds, 'POST', '/messages', message),
    webhooks: async (creds) => { const list = await call(creds, 'GET', '/webhooks'); return Array.isArray(list) ? list : []; },
    addWebhook: (creds, hook) => call(creds, 'POST', '/webhooks', hook),
    deleteWebhook: (creds, id) => call(creds, 'DELETE', `/webhooks/${encodeURIComponent(id)}`),
    patchSettings: (creds, settings) => call(creds, 'PATCH', '/settings', settings),
  };
}

// settings: config.phone.ownphone. pool: createPool() of ../pool.js.
export function createOwnPhoneProvider(settings, { pool, fetchFn = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const client = createGatewayClient({ apiUrl: settings.apiUrl, fetchFn, timeoutMs });

  return {
    name: 'ownphone',
    // The webhooks of this provider have their own route and their own signature (../ownphone.js).
    ownWebhooks: true,
    capabilities: { voice: false, voicemail: false, asyncText: true, searchByArea: false, pool: true },
    client,

    // The free numbers of the pool. country is optional. A pool has no area search.
    async search({ country, limit = 20 } = {}) {
      return pool.freeSims({ country, limit }).map((s) => ({ number: s.number, locality: '', region: '', country: s.country, sms: true, voice: false }));
    },

    // Only a free pool number. Nothing happens at the gateway: the row in "numbers" is the assignment.
    async buy(number) {
      const sim = pool.simByNumber(number);
      if (!sim || sim.inUse) throw new ProviderError('This number is not available.', { unavailable: true });
      return { ref: sim.id };
    },

    // The number is free again when its row in "numbers" is gone.
    async release() {},

    // Gives the text to the gateway. The phone sends it when it is online; the result comes by webhook.
    async sendText({ from, to, body }) {
      const sim = pool.simByNumber(from);
      const device = sim ? pool.device(sim.deviceId) : null;
      if (!device) throw new ProviderError('This number is not connected to a phone any more.', { notFound: true });
      const id = randomId();
      const ttl = Math.max(5, settings.textTtlSeconds);
      try {
        await client.sendMessage(device, { id, deviceId: device.gatewayId, phoneNumbers: [to], textMessage: { text: body }, simNumber: sim.simNumber, ttl, withDeliveryReport: true });
      } catch (err) {
        if (err instanceof ProviderError && err.status !== 0 && (err.status < 500 || err.status === 503)) throw new ProviderError(NOT_ACCEPTED, { status: err.status });
        throw new ProviderError(NOT_REACHABLE, { status: err instanceof ProviderError ? err.status : 0 });
      }
      return { ref: id, status: 'queued' };
    },
  };
}
