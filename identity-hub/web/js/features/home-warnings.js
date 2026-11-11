// Home: warnings about money. (a) The renewals of the next 7 days cost more than the balance.
// (b) An inbox or a number is paused. Nothing to warn about: nothing shows.
// The numbers are worked out in the browser (lib/warnings.js). Nothing is asked from the server for this.
import { h, region } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { registerHomeSection } from '../lib/registry.js';
import { homeWarnings, WARN_DAYS } from '../lib/warnings.js';
import { money, dayText, phoneText, plural } from '../lib/format.js';
import { callout, linkButton } from '../ui/components.js';
import { graceDays } from '../lib/data.js';

const day = (at) => dayText(new Date(at * 1000).toISOString().slice(0, 10));

function nameOf(kind, id, state) {
  if (kind === 'inbox') {
    const m = (state.mailboxes || []).find((x) => x.id === id);
    return m ? ['Inbox ', h('span', { class: m.label ? 'strong' : 'mono strong break' }, m.label || m.address)] : ['An inbox'];
  }
  const n = (state.numbers || []).find((x) => x.id === id);
  return n ? ['Number ', h('span', { class: 'mono strong nowrap' }, phoneText(n.number)), n.label ? ` (${n.label})` : ''] : ['A number'];
}

function warnings(state) {
  if (state.mailboxes === null || state.numbers === null || !state.config) return null;
  const w = homeWarnings({
    now: Math.floor(Date.now() / 1000), balance: state.balance, prices: state.config.prices, graceDays: graceDays(),
    mailboxes: state.mailboxes, numbers: state.numbers,
  });
  if (!w.renewals && !w.paused.length) return null;
  const payOn = !!(state.config.features && state.config.features.pay);
  const addFunds = () => (payOn ? h('div', null, linkButton('Add funds', '/funds', { kind: 'primary', size: 'sm' })) : h('p', { class: 'small' }, 'Payments are turned off on this server.'));
  const parts = [];

  if (w.paused.length) {
    parts.push(h('div', { dataset: { warning: 'paused' } }, callout('warn', w.paused.length === 1 ? 'One thing is paused' : `${w.paused.length} things are paused`,
      h('ul', { class: 'warn-list' }, w.paused.map((p) => h('li', null,
        nameOf(p.kind, p.id, state),
        p.kind === 'inbox' ? ' is paused. It receives no mail. Mail to it and to its aliases is refused. Your old mail is kept.'
          : [' is paused. It receives no texts and no calls.', p.releaseAt ? ` It is released on ${day(p.releaseAt)} if the balance stays too low. Then the number and its texts are gone.` : ''],
      ))),
      h('p', null, 'The balance was too low to renew. Add funds to turn ', w.paused.length === 1 ? 'it' : 'them', ' on again.'),
      addFunds(),
    )));
  }

  if (w.renewals) {
    const r = w.renewals;
    parts.push(h('div', { dataset: { warning: 'renewals' } }, callout('warn', 'Your balance does not cover the next renewals',
      h('p', null, `${plural(r.items.length, 'renewal')} in the next ${WARN_DAYS} days ${r.items.length === 1 ? 'costs' : 'cost'} `, h('span', { class: 'mono strong' }, money(r.total)), '. Your balance is ', h('span', { class: 'mono strong' }, money(state.balance)), '.'),
      h('ul', { class: 'warn-list' }, r.items.map((it) => h('li', null, nameOf(it.kind, it.id, state), ': ', h('span', { class: 'mono' }, money(it.cost)), ` on ${day(it.dueAt)}`))),
      h('p', null, `The first one is on ${day(r.firstAt)}. What the balance does not cover is paused: a paused inbox receives no mail, a paused number receives no texts and no calls.`),
      addFunds(),
    )));
  }
  return h('div', { class: 'stack stack-3' }, parts);
}

registerHomeSection({
  id: 'warnings',
  order: 5,
  render: ({ scope }) => region(scope, store, ['balance', 'mailboxes', 'numbers', 'config'], warnings),
});
