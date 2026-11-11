// Simulated payment provider for tests and development.
//
// ---- Provider interface (mock.js and btcpay.js both keep to it) ----
//
//   name                 'mock' | 'btcpay'
//   methods              [{ id, label }]  the payment methods that the user can choose
//   createInvoice({ id, amountUsd, method, minutes }) → { ref, checkoutUrl }
//       id: our invoice id. amountUsd: text like "10.00". minutes: time until the invoice expires.
//       ref: the invoice id of the provider. checkoutUrl: the payment page, or null.
//   getStatus(ref) → 'pending' | 'processing' | 'paid' | 'expired'
//       'processing': a payment was seen and is not final yet. Only 'paid' lets the server sign.
//
// The functions throw an Error when the provider cannot be reached.
import { randomBytes } from 'node:crypto';

export const METHOD_LABELS = { 'BTC-LN': 'Bitcoin Lightning', 'XMR-CHAIN': 'Monero', 'BTC-CHAIN': 'Bitcoin on-chain' };

export function createMockPay() {
  // The mock keeps only the paid references. An invoice that it does not know is "pending",
  // so that development invoices survive a restart of the server.
  const paid = new Set();
  const created = [];
  return {
    name: 'mock',
    methods: Object.entries(METHOD_LABELS).map(([id, label]) => ({ id, label })),
    created, // what createInvoice got, for tests
    async createInvoice(order) {
      created.push(order);
      return { ref: 'mock_' + randomBytes(12).toString('hex'), checkoutUrl: null };
    },
    async getStatus(ref) {
      return paid.has(ref) ? 'paid' : 'pending';
    },
    // Test and development helper: the simulated customer pays.
    markPaid(ref) { paid.add(ref); },
  };
}
