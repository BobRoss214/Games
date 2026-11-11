// Funds: balance, add funds with a private payment, prices, history.
import { h, replace, region } from '../lib/dom.js';
import { store, bus } from '../lib/store.js';
import { api } from '../lib/api.js';
import { money, dayText } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { button, emptyState, skeletonRows, pageHeader, section, field, segmented, runBusy, reportError, spinner, tag, loadError } from '../ui/components.js';
import { confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { payInfo, startPurchase, simulatePayment, removePurchase, forgetDone, pollNow, resumePurchases } from '../lib/pay.js';

const METHOD_NOTE = {
  'BTC-LN': 'Fast and cheap. Good for small amounts.',
  'XMR-CHAIN': 'The most private coin. Takes about 20 minutes.',
  'BTC-CHAIN': 'Slow, with a network fee. Use it for larger amounts.',
};
const LEDGER = { topup: 'Funds added', mailbox: 'Inbox, 30 days', number: 'Number, 30 days', text: 'Text sent', call: 'Call', refund: 'Refund' };

export function fundsScreen({ scope }) {
  const config = store.get('config');
  const payOn = !!config.features.pay;
  const mock = !!config.features.mockPay && config.dev;
  let info = null;
  let methodLabels = {};

  // ---- add funds form ----
  const formSlot = h('div', { class: 'sheet sheet-pad addfunds' });
  function paintForm(error = '') {
    if (!payOn) { replace(formSlot, h('p', { class: 'muted' }, 'Payments are turned off on this server. Ask the person who runs it to add credit.')); return; }
    if (error) { replace(formSlot, loadError(error, loadInfo)); return; }
    if (!info) { replace(formSlot, skeletonRows(2)); return; }
    if (!info.enabled || !info.methods.length) { replace(formSlot, h('p', { class: 'muted' }, 'Payments are not available right now. Try again later.')); return; }
    let method = info.methods[0].id;
    const presets = [5, 10, 25, 50, 100].filter((n) => n >= info.minUnits && n <= info.maxUnits);
    const amount = field({ label: 'Amount in US dollars', value: String(Math.min(Math.max(10, info.minUnits), info.maxUnits)), inputmode: 'numeric', maxlength: 4, mono: true, prefix: '$', hint: `Whole dollars, from $${info.minUnits} to $${info.maxUnits}.` });
    const note = h('p', { class: 'hint method-note' }, METHOD_NOTE[method] || '');
    const submit = button('Add funds', { kind: 'primary', type: 'submit', iconName: 'plus' });
    const status = h('p', { class: 'small muted', role: 'status', hidden: true });
    const form = h('form', { class: 'stack', novalidate: true, onSubmit: (e) => {
      e.preventDefault();
      const raw = amount.value.trim().replace(/^\$/, '');
      const units = /^\d{1,4}$/.test(raw) ? Number(raw) : NaN;
      if (!Number.isInteger(units) || units < info.minUnits || units > info.maxUnits) { amount.setError(`Enter whole dollars from $${info.minUnits} to $${info.maxUnits}.`); return; }
      status.hidden = false;
      status.textContent = 'Making a private payment. This takes a moment…';
      runBusy(submit, async () => {
        const made = await startPurchase({ units, method });
        if (made.checkoutUrl) toast('Invoice made. Open the payment page to pay.', { kind: 'ok' });
      }).finally(() => { status.hidden = true; });
    } },
      h('div', { class: 'stack stack-2' },
        amount.el,
        presets.length ? h('div', { class: 'chips', role: 'group', 'aria-label': 'Quick amounts' }, presets.map((n) => h('button', { class: 'chip mono', type: 'button', onClick: () => { amount.value = String(n); amount.setError(''); } }, `$${n}`))) : null,
      ),
      h('div', { class: 'field' },
        h('span', { class: 'label', id: 'method-label' }, 'Pay with'),
        segmented({ label: 'Pay with', value: method, options: info.methods.map((m) => ({ value: m.id, label: m.label })), onChange: (v) => { method = v; note.textContent = METHOD_NOTE[v] || ''; } }),
        note,
      ),
      h('div', { class: 'row row-wrap' }, submit, status),
    );
    replace(formSlot, form);
  }
  async function loadInfo() {
    if (!payOn) { paintForm(); return; }
    paintForm();
    try {
      info = await payInfo({ fresh: true });
      methodLabels = Object.fromEntries((info.methods || []).map((m) => [m.id, m.label]));
      if (scope.disposed) return;
      paintForm();
      paintPurchases(store.get());
    } catch (err) { if (!scope.disposed) paintForm(err.message); }
  }

  // ---- waiting payments ----
  const purchasesSlot = h('div', { class: 'section-slot' });
  function purchaseRow(p) {
    const label = methodLabels[p.method] || p.method;
    // Only a normal web address is used as a link.
    const payUrl = /^https?:\/\//i.test(p.checkoutUrl || '') ? p.checkoutUrl : '';
    let state;
    let actions = null;
    const remove = (title, message) => button('Remove', { size: 'sm', onClick: async () => {
      const ok = await confirmDialog({ title, message, confirmLabel: 'Remove' });
      if (!ok) return;
      try { await removePurchase(p.localId); } catch (err) { reportError(err); }
    } });
    if (p.status === 'starting') state = h('span', { class: 'pay-state' }, spinner(), 'Making a private payment');
    else if (p.status === 'waiting') {
      state = h('span', { class: 'pay-state' }, spinner('Waiting'), 'Waiting for payment');
      actions = [
        payUrl ? h('a', { class: 'btn btn-primary btn-sm', href: payUrl, target: '_blank', rel: 'noopener noreferrer' }, icon('external', { size: 16 }), h('span', null, 'Open payment page')) : null,
        mock ? button('Simulate payment (test mode)', { size: 'sm', kind: payUrl ? '' : 'primary', onClick: (e, btn) => runBusy(btn, () => simulatePayment(p.localId)) }) : null,
        remove('Remove this payment?', 'If you paid this invoice already, wait until the credit arrives. If you remove it now, that money is lost.'),
      ];
    } else if (p.status === 'paid' || p.status === 'redeeming') state = h('span', { class: 'pay-state' }, spinner(), 'Paid — adding credit');
    else if (p.status === 'done') {
      state = h('span', { class: 'pay-state is-done' }, icon('check', { size: 16 }), 'Done');
      actions = [button('Hide', { size: 'sm', kind: 'quiet', onClick: () => forgetDone(p.localId) })];
    } else if (p.status === 'expired') {
      state = h('span', { class: 'pay-state is-warn' }, icon('warning', { size: 16 }), 'Expired. Nothing was paid.');
      actions = [remove('Remove this payment?', 'The invoice expired. Remove it from the list.')];
    } else if (p.status === 'failed') {
      state = h('span', { class: 'pay-state is-warn' }, icon('warning', { size: 16 }), h('span', null, 'Paid — adding credit. ', p.error || 'We try again soon.'));
      actions = [button('Try again', { size: 'sm', onClick: () => pollNow() })];
    } else {
      state = h('span', { class: 'pay-state is-warn' }, icon('warning', { size: 16 }), 'Not started. No invoice was made.');
      actions = [remove('Remove this payment?', 'This payment was never started. Nothing was paid.')];
    }
    return h('li', { class: 'pay-row' },
      h('div', { class: 'pay-main' },
        h('span', { class: 'pay-amount mono' }, money(p.units * 100)),
        h('span', { class: 'small muted' }, label),
      ),
      h('div', { class: 'pay-status', role: 'status' }, state),
      actions ? h('div', { class: 'pay-actions' }, actions) : null,
    );
  }
  function paintPurchases(state) {
    const list = state.purchases || [];
    if (!list.length) { replace(purchasesSlot); return; }
    replace(purchasesSlot, section({ title: 'Payments in progress', lede: 'You can close this page. The credit is added the next time you open Postern.' },
      h('ul', { class: 'sheet pay-list' }, list.map(purchaseRow))));
  }
  scope.add(store.subscribe(['purchases'], paintPurchases));

  // ---- history ----
  const historySlot = h('div', { class: 'sheet' });
  let ledger = null;
  async function loadLedger() {
    try {
      const res = await api.get('/api/billing');
      if (scope.disposed) return;
      ledger = res.ledger || [];
      if (typeof res.balance === 'number') store.set({ balance: res.balance });
      paintLedger();
    } catch (err) {
      if (scope.disposed) return;
      replace(historySlot, loadError(err.message, loadLedger));
    }
  }
  function paintLedger() {
    if (ledger === null) { replace(historySlot, skeletonRows(4)); return; }
    if (!ledger.length) { replace(historySlot, emptyState({ title: 'No history yet', text: 'Payments and charges show here. The history keeps the day, not the time.', compact: true, figure: false })); return; }
    replace(historySlot, h('table', { class: 'ledger' },
      h('caption', { class: 'sr-only' }, 'Payments and charges'),
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Day'), h('th', { scope: 'col' }, 'What'), h('th', { scope: 'col', class: 'right' }, 'Amount'))),
      h('tbody', null, ledger.map((row) => h('tr', null,
        h('td', { class: 'nowrap muted' }, dayText(row.day)),
        h('td', null, LEDGER[row.kind] || row.kind),
        h('td', { class: `right mono ${row.delta > 0 ? 'is-plus' : ''}`.trim() }, money(row.delta, { sign: true })),
      ))),
    ));
  }
  scope.add(bus.on('balance', () => loadLedger()));

  // ---- prices ----
  const p = config.prices;
  const priceRow = (what, credits, unit) => h('tr', null, h('td', null, what), h('td', { class: 'right mono nowrap' }, credits ? money(credits) : 'Free'), h('td', { class: 'muted' }, credits ? unit : ''));
  const prices = h('table', { class: 'ledger prices' },
    h('caption', { class: 'sr-only' }, 'Prices'),
    h('tbody', null,
      priceRow('Inbox', p.mailboxMonth, 'per 30 days'),
      h('tr', null, h('td', null, 'Alias'), h('td', { class: 'right mono' }, 'Free'), h('td', { class: 'muted' }, config.limits.aliases ? `up to ${config.limits.aliases}` : 'no limit')),
      config.features.phone ? priceRow('Number', p.numberMonth, 'per 30 days') : null,
      config.features.phone ? priceRow('Text you send', p.textOut, 'per text') : null,
      config.features.phone ? priceRow('Call', p.callMinute, 'per minute') : null,
    ),
  );

  const el = h('div', { class: 'page' },
    pageHeader({ title: 'Funds', lede: config.features.phone ? 'Your credit pays for inboxes, numbers, texts and calls.' : 'Your credit pays for inboxes.' }),
    h('div', { class: 'funds-grid' },
      h('div', { class: 'funds-main' },
        h('div', { class: 'balance' },
          h('p', { class: 'balance-label' }, 'Balance'),
          region(scope, store, ['balance'], (s) => h('p', { class: 'balance-value mono' }, money(s.balance))),
          h('p', { class: 'small muted' }, 'US dollars of credit'),
        ),
        section({ title: 'Add funds' }, formSlot, mock ? h('p', { class: 'hint test-hint' }, tag('Test mode', 'warn'), ' No real money moves. Use "Simulate payment" after you start a payment.') : null),
        purchasesSlot,
        section({ title: 'History' }, historySlot),
      ),
      h('aside', { class: 'funds-side' },
        section({ title: 'Prices' }, h('div', { class: 'sheet' }, prices), h('p', { class: 'hint prices-hint' }, 'When your balance is too low to renew, the inbox or number is paused. It is not deleted at once.')),
        !payOn ? null : section({ title: 'Why payments are private' },
          h('div', { class: 'private-note' },
            icon('shield', { size: 20 }),
            h('p', { class: 'read small' }, 'You pay an invoice that has no link to your account. When it is paid, your browser gets credit tokens that only it can open, and adds them to your balance. The payment system never learns which account the money went to. The account system never learns which invoice paid for it.'),
          ),
        ),
      ),
    ),
  );

  paintLedger();
  paintPurchases(store.get());
  loadInfo();
  loadLedger();
  // Purchases from an earlier visit: read them from the vault again and continue.
  resumePurchases();
  return el;
}
