// Numbers: the list of VoIP numbers, and the optional real phones for forwarding.
import { h, replace } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { money, phoneText, cleanPhone, dayText } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { button, emptyState, skeletonRows, pageHeader, section, field, selectField, tag, copyButton, callout, reportError, needFunds } from '../ui/components.js';
import { menuButton } from '../ui/menu.js';
import { openDialog, formDialog, confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { identityItems, identityList } from '../ui/rows.js';
import { openGetNumber } from '../ui/identities.js';
import { linkPhone, verifyPhone, removePhone, findPhone } from '../lib/data.js';
import { openTestTools } from './testtools.js';

// Step 2 of linking: type the code that was sent to the real phone.
export function openVerifyPhone(phoneId) {
  const phone = findPhone(phoneId);
  if (!phone) return Promise.resolve(false);
  const dev = store.get('config').dev;
  const code = field({ label: 'Code', mono: true, inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code', placeholder: '000000', hint: 'The code has 6 numbers. It works for 10 minutes.' });
  return formDialog({
    title: 'Enter the code', size: 'sm', submitLabel: 'Link phone',
    description: `We sent a text with a code to ${phoneText(phone.number)}.`,
    build: (api) => h('div', { class: 'stack' },
      code.el,
      dev ? h('p', { class: 'hint' }, 'Test mode: no real text is sent. ', h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onClick: () => { api.close(); openTestTools('outbox'); } }, 'Find the code in Test tools')) : null,
    ),
    onSubmit: async () => {
      const v = code.value.replace(/\D/g, '');
      if (v.length !== 6) { code.setError('Enter the 6 numbers from the text.'); return false; }
      await verifyPhone(phoneId, v);
      toast('Phone linked', { kind: 'ok' });
      return true;
    },
    onError: (err) => { if (err.code === 'bad_code') { code.setError(err.message); return true; } return false; },
  });
}

export async function openLinkPhone() {
  const state = store.get();
  const numbers = (state.numbers || []).filter((n) => n.status === 'active' && n.sms);
  const usable = numbers.length ? numbers : (state.numbers || []).filter((n) => n.status === 'active');
  if (usable.length === 0) {
    openDialog({
      title: 'Get a number first', size: 'sm',
      content: (api) => h('div', { class: 'stack' },
        h('p', { class: 'read' }, 'We send the code to your real phone from one of your Postern numbers. You have no active number yet.'),
        h('div', { class: 'dialog-actions' }, button('Cancel', { onClick: () => api.close() }), button('Get a number', { kind: 'primary', onClick: () => { api.close(); openGetNumber(); } })),
      ),
    });
    return;
  }
  const price = state.config.prices.textOut || 0;
  const number = field({ label: 'Your real phone number', type: 'tel', mono: true, autocomplete: 'tel', placeholder: '+14155550199', hint: 'Start with + and the country code.' });
  const label = field({ label: 'Label', optional: true, maxlength: 40, placeholder: 'for example: My mobile', hint: 'Only you see this.' });
  const via = selectField({ label: 'Send the code from', options: usable.map((n) => ({ value: n.id, label: `${phoneText(n.number)}${n.label ? `  (${n.label})` : ''}` })), value: usable[0].id, mono: true });
  const made = await formDialog({
    title: 'Link a real phone', submitLabel: 'Send code',
    build: () => h('div', { class: 'stack' },
      callout('info', 'This is optional', h('p', null, 'Link a real phone only if you want texts or calls forwarded to it. To forward, the server must know this number. It is stored encrypted on the server.')),
      number.el, label.el,
      usable.length > 1 ? via.el : null,
      price ? h('p', { class: 'price-note' }, icon('funds', { size: 16 }), h('span', null, `The text with the code costs ${money(price)}.`)) : null,
    ),
    onSubmit: async () => {
      const clean = cleanPhone(number.value);
      if (!clean) { number.setError('Enter the full number with + and the country code. For example +14155550199.'); return false; }
      const from = usable.find((n) => n.id === via.value) || usable[0];
      return linkPhone({ number: clean, label: label.value.trim(), via: from });
    },
    onError: (err, api) => { if (err.status === 402) { api.close(); needFunds(err); return true; } return false; },
  });
  if (made && made.id) openVerifyPhone(made.id);
}

function phoneRow(p) {
  return h('li', { class: 'phone-row' },
    h('span', { class: 'id-icon' }, icon('phone', { size: 20 })),
    h('div', { class: 'id-main' },
      h('span', { class: 'id-value mono' }, phoneText(p.number)),
      h('div', { class: 'id-sub' },
        p.label ? h('span', { class: 'id-label' }, p.label) : h('span', { class: 'id-label is-empty' }, 'No label'),
        p.verified ? tag('Linked', 'ok') : tag('Waiting for code', 'warn'),
        h('span', { class: 'small faint' }, `Added on ${dayText(p.createdDay)}`),
      ),
    ),
    h('div', { class: 'id-actions' },
      p.verified ? null : button('Enter code', { size: 'sm', onClick: () => openVerifyPhone(p.id) }),
      copyButton(() => p.number, 'Copy number', { what: 'Number copied' }),
      menuButton({ label: `More actions for ${phoneText(p.number)}`, items: [
        { label: 'Remove', icon: 'trash', danger: true, onSelect: async () => {
          const ok = await confirmDialog({ title: 'Remove this phone?', message: 'Forwarding to this phone stops. The server deletes the number.', confirmLabel: 'Remove' });
          if (!ok) return;
          try { await removePhone(p.id); toast('Phone removed', { kind: 'ok' }); } catch (err) { reportError(err); }
        } },
      ] }),
    ),
  );
}

export function numbersScreen({ scope }) {
  const config = store.get('config');
  if (!config.features.phone) {
    return h('div', { class: 'page' },
      pageHeader({ title: 'Numbers' }),
      h('div', { class: 'sheet' }, emptyState({ title: 'Numbers are turned off', text: 'This server has no phone provider. You can still use inboxes and aliases.' })),
    );
  }
  const price = config.prices.numberMonth || 0;
  const numbersRegion = h('div', { class: 'sheet id-sheet' });
  const phonesRegion = h('div', { class: 'sheet id-sheet' });

  function paint() {
    const state = store.get();
    if (state.numbers === null) replace(numbersRegion, skeletonRows(3));
    else if (state.numbers.length === 0) {
      replace(numbersRegion, emptyState({
        title: 'No numbers yet',
        text: `A number gets texts and calls for you. Give it out in place of your real number.${price ? ` ${money(price)} for each 30 days.` : ''}`,
        action: button('Get a number', { kind: 'primary', iconName: 'plus', onClick: () => openGetNumber() }),
      }));
    } else replace(numbersRegion, identityList(identityItems(state).filter((it) => it.kind === 'number')));

    if (state.phones === null) replace(phonesRegion, skeletonRows(2));
    else if (state.phones.length === 0) {
      replace(phonesRegion, emptyState({
        title: 'No real phone linked', compact: true, figure: false,
        text: 'Without a real phone, texts and calls stay in this app.',
        action: button('Link a phone', { onClick: () => openLinkPhone() }),
      }));
    } else replace(phonesRegion, h('ul', { class: 'id-list' }, state.phones.map(phoneRow)));
  }
  scope.add(store.subscribe(['numbers', 'phones'], paint));

  const el = h('div', { class: 'page' },
    pageHeader({
      title: 'Numbers',
      lede: 'Phone numbers for texts and calls. Read texts here, or forward them to your real phone.',
      actions: button('Get a number', { kind: 'primary', iconName: 'plus', onClick: () => openGetNumber() }),
    }),
    numbersRegion,
    section({
      title: 'Real phones',
      lede: 'Optional. Link your real phone if you want texts or calls forwarded to it. The server must know that number to forward to it.',
      actions: button('Link a phone', { size: 'sm', iconName: 'plus', onClick: () => openLinkPhone() }),
    }, phonesRegion),
  );
  paint();
  return el;
}
