// Home: the "First steps" list for a new account (add funds, make an inbox, an alias, a number).
// It goes away when every step is done, or when the person hides it.
import { h, region } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { registerHomeSection } from '../lib/registry.js';
import { icon } from '../ui/icons.js';
import { button, linkButton } from '../ui/components.js';
import { openNewAlias, openNewInbox, openGetNumber } from '../ui/items.js';
import { setPref } from '../lib/data.js';

function checklist(state) {
  if (state.mailboxes === null || state.aliases === null || state.numbers === null) return null;
  if (state.prefs && state.prefs.hideChecklist) return null;
  const f = (state.config && state.config.features) || {};
  const hasBox = state.mailboxes.length > 0;
  const steps = [
    f.pay ? { done: state.balance > 0 || hasBox || state.numbers.length > 0, title: 'Add funds', text: 'Pay with Bitcoin or Monero. An inbox and a number cost a little each month.', action: linkButton('Add funds', '/funds', { size: 'sm' }) } : null,
    { done: hasBox, title: 'Make an inbox', text: 'Its own address. You read and send mail here.', action: button('Make inbox', { size: 'sm', onClick: () => openNewInbox() }) },
    { done: state.aliases.length > 0, title: 'Make an alias', text: 'An extra address for one shop or one site. Free.', action: button('Make alias', { size: 'sm', onClick: () => openNewAlias() }) },
    f.phone ? { done: state.numbers.length > 0, title: 'Get a number', text: 'A phone number for texts and calls.', action: button('Get a number', { size: 'sm', onClick: () => openGetNumber() }) } : null,
  ].filter(Boolean);
  if (steps.every((s) => s.done)) return null;
  const next = steps.findIndex((s) => !s.done);
  return h('section', { class: 'sheet firststeps', 'aria-labelledby': 'firststeps-title' },
    h('div', { class: 'firststeps-head' },
      h('div', null, h('h2', { class: 'section-title', id: 'firststeps-title' }, 'First steps'), h('p', { class: 'small muted' }, `${steps.filter((s) => s.done).length} of ${steps.length} done`)),
      button('Hide', { kind: 'quiet', size: 'sm', onClick: () => setPref('hideChecklist', true) }),
    ),
    h('ol', { class: 'firststeps-list' }, steps.map((s, i) => h('li', { class: `firststep ${s.done ? 'is-done' : ''} ${i === next ? 'is-next' : ''}`.trim() },
      h('span', { class: 'firststep-mark mono', 'aria-hidden': 'true' }, s.done ? icon('check', { size: 14 }) : String(i + 1)),
      h('div', { class: 'grow' }, h('p', { class: 'firststep-title' }, s.title, s.done ? h('span', { class: 'sr-only' }, ' (done)') : null), h('p', { class: 'small muted firststep-text' }, s.text)),
      !s.done && i === next ? s.action : null,
    ))),
  );
}

registerHomeSection({
  id: 'first-steps',
  order: 10,
  render: ({ scope }) => region(scope, store, ['mailboxes', 'aliases', 'numbers', 'balance', 'prefs'], checklist),
});
