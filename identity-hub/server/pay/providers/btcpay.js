// BTCPay Server adapter (Greenfield API) with fetch.
// It keeps to the provider interface that is described at the top of mock.js.
import { createHmac } from 'node:crypto';
import { safeEqual } from '../../core/keys.js';
import { METHOD_LABELS } from './mock.js';

const TIMEOUT_MS = 15_000;
// BTCPay invoice states. Only "Settled" means paid.
const STATES = { New: 'pending', Processing: 'processing', Settled: 'paid', Expired: 'expired', Invalid: 'expired' };

// The value of the BTCPay-Sig header for a webhook body.
export function btcpaySignature(webhookSecret, raw) {
  return 'sha256=' + createHmac('sha256', webhookSecret).update(raw).digest('hex');
}

export function createBtcpay({ url, apiKey, storeId, webhookSecret, methods = [] } = {}, { publicUrl }) {
  if (!url || !apiKey || !storeId || !webhookSecret) {
    throw new Error('BTCPAY_URL, BTCPAY_API_KEY, BTCPAY_STORE_ID and BTCPAY_WEBHOOK_SECRET must be set when PAY_PROVIDER is btcpay');
  }
  const base = `${url.replace(/\/+$/, '')}/api/v1/stores/${encodeURIComponent(storeId)}/invoices`;

  // One request to BTCPay. Returns { status, data }. Throws when there is no answer.
  async function call(method, path, body) {
    const init = { method, headers: { authorization: `token ${apiKey}`, accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) };
    if (body !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let res;
    let data = null;
    try {
      res = await fetch(base + path, init);
      const text = await res.text();
      if (text) { try { data = JSON.parse(text); } catch { data = null; } }
    } catch {
      throw new Error('the payment provider did not answer');
    }
    return { status: res.status, ok: res.ok, data };
  }

  return {
    name: 'btcpay',
    methods: methods.map((id) => ({ id, label: METHOD_LABELS[id] || id })),

    async createInvoice({ id, amountUsd, method, minutes }) {
      const { ok, status, data } = await call('POST', '', {
        amount: amountUsd,
        currency: 'USD',
        metadata: { orderId: id },
        checkout: { paymentMethods: [method], expirationMinutes: minutes, redirectURL: `${publicUrl}/funds` },
      });
      if (!ok || !data || typeof data.id !== 'string' || !data.id || data.id.length > 200) {
        throw new Error(`the payment provider did not make the invoice (status ${status})`);
      }
      // The link goes to the browser. Accept a web address only.
      let checkoutUrl = null;
      try {
        const link = new URL(data.checkoutLink);
        if (link.protocol === 'https:' || link.protocol === 'http:') checkoutUrl = link.href;
      } catch { checkoutUrl = null; }
      return { ref: data.id, checkoutUrl };
    },

    async getStatus(ref) {
      const { ok, status, data } = await call('GET', '/' + encodeURIComponent(ref));
      if (status === 404) return { state: 'expired', amount: '', currency: '' }; // the invoice is gone at BTCPay
      if (!ok || !data || data.id !== ref) throw new Error(`the payment provider did not show the invoice (status ${status})`);
      // An unknown state is not "paid". A missing amount or currency is an empty text, which
      // is equal to nothing: the server then does not sign.
      const text = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
      return { state: Object.hasOwn(STATES, data.status) ? STATES[data.status] : 'pending', amount: text(data.amount), currency: text(data.currency) };
    },

    // raw: the request body as bytes. header: the BTCPay-Sig value.
    verifyWebhook(raw, header) {
      return typeof header === 'string' && header.length > 0 && safeEqual(header, btcpaySignature(webhookSecret, raw));
    },
  };
}
