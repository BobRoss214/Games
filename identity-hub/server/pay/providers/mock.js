// Simulated payment provider for tests and development.
//
// ---- Provider interface (mock.js and btcpay.js both keep to it) ----
//
//   name                 'mock' | 'btcpay'
//   methods              [{ id, label }]  the payment methods that the user can choose
//   createInvoice({ id, amountUsd, method, minutes }) → { ref, checkoutUrl }
//       id: our invoice id. amountUsd: text like "10.00". minutes: time until the invoice expires.
//       ref: the invoice id of the provider. checkoutUrl: the payment page, or null.
//   getStatus(ref) → { state, amount, currency }
//       state: 'pending' | 'processing' | 'paid' | 'expired'.
//       'processing': a payment was seen and is not final yet. Only 'paid' lets the server sign.
//       amount, currency: what the provider has for this invoice, for example "10.00" and "USD".
//       The server signs only if they are equal to what it asked for. null: the provider does not say.
//
// The functions throw an Error when the provider cannot be reached.
import { randomBytes } from 'node:crypto';

export const METHOD_LABELS = { 'BTC-LN': 'Bitcoin Lightning', 'XMR-CHAIN': 'Monero', 'BTC-CHAIN': 'Bitcoin on-chain' };

export function createMockPay() {
  // The mock keeps only the paid references. An invoice that it does not know is "pending",
  // so that development invoices survive a restart of the server.
  const paid = new Set();
  const created = [];
  const amounts = new Map(); // ref -> amount of the order, for the invoices of this run
  return {
    name: 'mock',
    methods: Object.entries(METHOD_LABELS).map(([id, label]) => ({ id, label })),
    created, // what createInvoice got, for tests
    async createInvoice(order) {
      created.push(order);
      const ref = 'mock_' + randomBytes(12).toString('hex');
      amounts.set(ref, order.amountUsd);
      return { ref, checkoutUrl: null };
    },
    async getStatus(ref) {
      const known = amounts.has(ref);
      return { state: paid.has(ref) ? 'paid' : 'pending', amount: known ? amounts.get(ref) : null, currency: known ? 'USD' : null };
    },
    // Test and development helper: the simulated customer pays.
    markPaid(ref) { paid.add(ref); },
  };
}
