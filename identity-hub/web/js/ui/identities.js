// Dialogs for inboxes, aliases and numbers. Home, Mail, Aliases and Numbers all use them.
import { h, replace } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { navigate } from '../lib/router.js';
import { money, phoneText, countryName, plural } from '../lib/format.js';
import { icon } from './icons.js';
import { button, field, selectField, copyButton, runBusy, reportError, needFunds, tag, skeletonRows, emptyState } from './components.js';
import { openDialog, formDialog, confirmDialog } from './dialog.js';
import { toast } from './toast.js';
import {
  createAlias, createMailbox, buyNumber, renameMailbox, updateAlias, updateNumber, deleteMailbox, deleteAlias, releaseNumber,
  mailboxName, findMailbox,
} from '../lib/data.js';
import { searchNumbers } from '../lib/phone.js';

const config = () => store.get('config') || { mailDomains: [], prices: {}, features: {}, phoneCountries: [] };
const LOCAL_PART = /^[a-z0-9](?:[a-z0-9._-]{1,62}[a-z0-9])$/;

function checkLocalPart(value) {
  if (!value) return '';
  if (value.length < 3) return 'Use 3 characters or more.';
  if (!LOCAL_PART.test(value) || value.includes('..')) return 'Use lower-case letters, numbers, dots, dashes or underscores. Start and end with a letter or a number.';
  return '';
}

// Close on 402 and show the "Add funds" dialog. Returns true if handled.
function fundsOrFalse(err, api) {
  if (err && err.status === 402) { api.close(); needFunds(err); return true; }
  return false;
}

// Shows a new address or number with a Copy button.
function madeDialog({ title, value, display, note }) {
  openDialog({
    title, size: 'sm',
    content: (api) => h('div', { class: 'stack' },
      h('div', { class: 'made' }, h('span', { class: 'made-value mono break' }, display || value), copyButton(() => value, 'Copy', { what: 'Copied' })),
      note ? h('p', { class: 'small muted' }, note) : null,
      h('div', { class: 'dialog-actions' }, button('Done', { kind: 'primary', attrs: { autofocus: true }, onClick: () => api.close() })),
    ),
  });
}

// The name part of a new address: random by default, or typed.
function nameChoice() {
  const domains = config().mailDomains || [];
  const local = field({ label: 'Name', mono: true, placeholder: 'anna.reed', maxlength: 64, hint: '3 to 64 characters: lower-case letters, numbers, dots and dashes.', suffix: domains.length === 1 ? '@' + domains[0] : null });
  const domain = domains.length > 1 ? selectField({ label: 'Domain', options: domains.map((d) => ({ value: d, label: '@' + d })), value: domains[0], mono: true }) : null;
  const custom = h('div', { class: 'stack', hidden: true }, local.el, domain ? domain.el : null);
  const toggleBtn = h('button', { class: 'btn btn-quiet btn-sm disclose', type: 'button', 'aria-expanded': 'false' }, icon('chevronRight', { size: 14 }), h('span', null, 'Choose the name myself'));
  toggleBtn.addEventListener('click', () => {
    const open = custom.hidden;
    custom.hidden = !open;
    toggleBtn.setAttribute('aria-expanded', String(open));
    if (open) local.input.focus(); else local.value = '';
  });
  return {
    el: h('div', { class: 'stack stack-3' }, h('p', { class: 'hint' }, 'We pick a random, readable name. For example ', h('span', { class: 'mono' }, 'quiet.river482'), '.'), toggleBtn, custom),
    read() {
      const value = custom.hidden ? '' : local.value.trim().toLowerCase();
      const problem = checkLocalPart(value);
      if (problem) { local.setError(problem); return null; }
      return { localPart: value || undefined, domain: !custom.hidden && domain ? domain.value : undefined };
    },
    local,
  };
}

// ---- new alias ----
export async function openNewAlias({ mailboxId = '' } = {}) {
  const boxes = (store.get('mailboxes') || []).filter((m) => m.status === 'active');
  if (boxes.length === 0) {
    const all = store.get('mailboxes') || [];
    openDialog({
      title: 'Make an inbox first', size: 'sm',
      content: (api) => h('div', { class: 'stack' },
        h('p', { class: 'read' }, all.length ? 'Your inboxes are paused. Add funds to turn them on again. An alias needs an active inbox.' : 'An alias delivers mail to an inbox. You have no inbox yet.'),
        h('div', { class: 'dialog-actions' },
          button('Cancel', { onClick: () => api.close() }),
          all.length ? button('Add funds', { kind: 'primary', onClick: () => { api.close(); navigate('/funds'); } }) : button('Make inbox', { kind: 'primary', onClick: () => { api.close(); openNewInbox(); } }),
        ),
      ),
    });
    return;
  }
  const target = selectField({ label: 'Delivers to', options: boxes.map((m) => ({ value: m.id, label: m.label ? `${m.label} (${m.address})` : m.address })), value: boxes.some((m) => m.id === mailboxId) ? mailboxId : boxes[0].id });
  const label = field({ label: 'Label', optional: true, placeholder: 'for example: Shop X', maxlength: 60, hint: 'What you use it for. Only you see this.' });
  const name = nameChoice();
  const made = await formDialog({
    title: 'New alias', description: 'An alias is an extra address. Mail to it lands in your inbox. Turn it off when you get spam.',
    submitLabel: 'Make alias',
    build: () => h('div', { class: 'stack' }, boxes.length > 1 ? target.el : null, label.el, name.el),
    onSubmit: async () => {
      const n = name.read();
      if (!n) return false;
      return createAlias({ mailboxId: target.value, label: label.value.trim(), ...n });
    },
    onError: (err) => { if (err.code === 'taken') { name.local.setError(err.message); return true; } return false; },
  });
  if (made && made.address) madeDialog({ title: 'Alias made', value: made.address, note: `Mail to this address goes to ${mailboxName(findMailbox(target.value))}.` });
}

// ---- new inbox ----
export async function openNewInbox() {
  const price = config().prices.mailboxMonth || 0;
  const label = field({ label: 'Label', optional: true, placeholder: 'for example: Personal', maxlength: 60, hint: 'Only you see this.' });
  const name = nameChoice();
  const made = await formDialog({
    title: 'New inbox', description: 'An inbox is a real mailbox with its own address. You read and send mail here.',
    submitLabel: price ? `Make inbox for ${money(price)}` : 'Make inbox',
    build: () => h('div', { class: 'stack' },
      label.el, name.el,
      price ? h('p', { class: 'price-note' }, icon('funds', { size: 16 }), h('span', null, `An inbox costs ${money(price)} for each 30 days. The first 30 days are charged now.`)) : null,
    ),
    onSubmit: async () => {
      const n = name.read();
      if (!n) return false;
      return createMailbox({ label: label.value.trim(), ...n });
    },
    onError: (err, api) => { if (err.code === 'taken') { name.local.setError(err.message); return true; } return fundsOrFalse(err, api); },
  });
  if (made && made.address) madeDialog({ title: 'Inbox made', value: made.address, note: 'This is your new address. You can add aliases that deliver to it.' });
}

// ---- get a number ----
export function openGetNumber() {
  const c = config();
  if (!c.features.phone) { toast('Phone numbers are turned off on this server.'); return; }
  const price = c.prices.numberMonth || 0;
  const countries = c.phoneCountries && c.phoneCountries.length ? c.phoneCountries : ['US'];
  const country = selectField({ label: 'Country', options: countries.map((code) => ({ value: code, label: countryName(code) })), value: countries[0] });
  const area = field({ label: 'Area code', optional: true, inputmode: 'numeric', maxlength: 6, placeholder: '415', mono: true });
  const results = h('div', { class: 'number-results', 'aria-live': 'polite' });

  // Step 2: a label and the price, then the purchase.
  async function buy(n, api) {
    const label = field({ label: 'Label', optional: true, placeholder: 'for example: Selling the bike', maxlength: 60, hint: 'What you use it for. Only you see this.' });
    const res = await formDialog({
      title: `Buy ${phoneText(n.number)}?`, size: 'sm',
      submitLabel: price ? `Buy for ${money(price)}` : 'Get number',
      build: () => h('div', { class: 'stack' },
        label.el,
        price ? h('p', { class: 'price-note' }, icon('funds', { size: 16 }), h('span', null, `You pay ${money(price)} now, then ${money(price)} every 30 days while you keep the number.`)) : null,
      ),
      onSubmit: async () => buyNumber({ number: n.number, label: label.value.trim() }),
      onError: (err, inner) => { if (err.status === 402) { inner.close(); api.close(); needFunds(err); return true; } return false; },
    });
    if (!res || !res.number) return;
    api.close();
    toast('Number added', { kind: 'ok' });
    if (res.number.id) navigate(`/numbers/${res.number.id}`);
  }

  openDialog({
    title: 'Get a number', size: 'lg',
    description: price ? `A number costs ${money(price)} for each 30 days. The first 30 days are charged when you buy.` : 'Choose a number.',
    content: (api) => {
      const searchBtn = button('Search', { kind: 'primary', type: 'submit', iconName: 'search' });
      const run = () => runBusy(searchBtn, async () => {
        const code = area.value.trim();
        if (code && !/^\d{1,6}$/.test(code)) { area.setError('Use numbers only.'); return; }
        replace(results, skeletonRows(4));
        let list;
        try { list = await searchNumbers(country.value, code || undefined); } catch (err) { replace(results); throw err; }
        if (!list.length) { replace(results, emptyState({ title: 'No numbers found', text: 'Try another area code, or leave the area code empty.', compact: true, figure: false })); return; }
        replace(results, h('ul', { class: 'number-list' }, list.map((n) => h('li', { class: 'number-option' },
          h('div', { class: 'grow' },
            h('p', { class: 'mono number-option-value' }, phoneText(n.number)),
            h('p', { class: 'small muted' }, [n.locality, n.region, countryName(n.country)].filter(Boolean).join(', ')),
          ),
          h('div', { class: 'row row-2 no-shrink' }, n.sms ? tag('Texts') : null, n.voice ? tag('Calls') : null),
          button('Buy', { size: 'sm', attrs: { 'aria-label': `Buy ${phoneText(n.number)}` }, onClick: () => buy(n, api) }),
        ))));
      });
      const form = h('form', { class: 'stack', novalidate: true, onSubmit: (e) => { e.preventDefault(); run(); } },
        h('div', { class: 'number-search' }, country.el, area.el, searchBtn),
        results,
      );
      queueMicrotask(run);
      return form;
    },
  });
}

// ---- the "New" chooser ----
export function openNewChooser() {
  const phoneOn = !!config().features.phone;
  const prices = config().prices;
  const option = (iconName, title, textValue, price, onPick) => h('button', { class: 'choice', type: 'button', onClick: onPick },
    h('span', { class: 'choice-icon' }, icon(iconName, { size: 22 })),
    h('span', { class: 'choice-body' }, h('span', { class: 'choice-title' }, title), h('span', { class: 'choice-text' }, textValue)),
    h('span', { class: 'choice-price mono' }, price),
  );
  openDialog({
    title: 'New', size: 'md',
    content: (api) => h('div', { class: 'choices' },
      option('alias', 'Alias', 'An extra address that delivers to an inbox. Make one for each shop or site.', 'Free', () => { api.close(); openNewAlias(); }),
      option('inbox', 'Inbox', 'A real mailbox with its own address. Read and send mail.', prices.mailboxMonth ? `${money(prices.mailboxMonth)} / 30 days` : 'Free', () => { api.close(); openNewInbox(); }),
      phoneOn ? option('phone', 'Number', 'A phone number for texts and calls. Forward it to your real phone if you like.', prices.numberMonth ? `${money(prices.numberMonth)} / 30 days` : 'Free', () => { api.close(); openGetNumber(); }) : null,
    ),
  });
}

// ---- rename ----
export async function openRename(item) {
  const label = field({ label: 'Label', value: item.label || '', maxlength: 60, placeholder: item.kind === 'inbox' ? 'for example: Personal' : item.kind === 'alias' ? 'for example: Shop X' : 'for example: Selling the bike', hint: 'Only you see this. It is encrypted.' });
  const ok = await formDialog({
    title: 'Rename', submitLabel: 'Save',
    build: () => h('div', { class: 'stack' }, h('p', { class: 'mono small muted break' }, item.kind === 'number' ? phoneText(item.number) : item.address), label.el),
    onSubmit: async () => {
      const v = label.value.trim();
      if (item.kind === 'inbox') await renameMailbox(item.id, v);
      else if (item.kind === 'alias') await updateAlias(item.id, { label: v });
      else await updateNumber(item.id, { label: v });
    },
  });
  if (ok) toast('Saved', { kind: 'ok', timeout: 2000 });
}

// ---- move an alias to another inbox ----
export async function openMoveAlias(alias) {
  const boxes = store.get('mailboxes') || [];
  if (boxes.length < 2) { toast('You have one inbox. Make a second inbox to move this alias.'); return; }
  const target = selectField({ label: 'Deliver to', options: boxes.map((m) => ({ value: m.id, label: m.label ? `${m.label} (${m.address})` : m.address })), value: alias.mailboxId });
  const ok = await formDialog({
    title: 'Move alias', submitLabel: 'Move',
    description: 'New mail to this alias goes to the inbox you choose. Old messages stay where they are.',
    build: () => h('div', { class: 'stack' }, h('p', { class: 'mono small muted break' }, alias.address), target.el),
    onSubmit: async () => { if (target.value !== alias.mailboxId) await updateAlias(alias.id, { mailboxId: target.value }); },
  });
  if (ok) toast('Alias moved', { kind: 'ok', timeout: 2000 });
}

// ---- delete ----
export async function confirmDeleteItem(item) {
  if (item.kind === 'inbox') {
    const count = (store.get('aliases') || []).filter((a) => a.mailboxId === item.id).length;
    const ok = await confirmDialog({
      title: 'Delete this inbox?',
      message: h('div', { class: 'stack stack-3' },
        h('p', { class: 'mono break' }, item.address),
        h('p', { class: 'read' }, `This deletes all messages in the inbox${count ? ` and its ${plural(count, 'alias', 'aliases')}` : ''}. You cannot undo this. The address is never given out again.`),
      ),
      confirmLabel: 'Delete inbox',
    });
    if (!ok) return false;
    try { await deleteMailbox(item.id); toast('Inbox deleted', { kind: 'ok' }); return true; } catch (err) { reportError(err); return false; }
  }
  if (item.kind === 'alias') {
    const ok = await confirmDialog({
      title: 'Delete this alias?',
      message: h('div', { class: 'stack stack-3' },
        h('p', { class: 'mono break' }, item.address),
        h('p', { class: 'read' }, 'Mail to this address is refused from now on. Messages you have stay in the inbox. The address is never given out again.'),
      ),
      confirmLabel: 'Delete alias',
    });
    if (!ok) return false;
    try { await deleteAlias(item.id); toast('Alias deleted', { kind: 'ok' }); return true; } catch (err) { reportError(err); return false; }
  }
  const ok = await confirmDialog({
    title: 'Release this number?',
    message: h('div', { class: 'stack stack-3' },
      h('p', { class: 'mono' }, phoneText(item.number)),
      h('p', { class: 'read' }, 'Its texts and its call log are deleted. You cannot get this number back. Money for the days that are left is not returned.'),
    ),
    confirmLabel: 'Release number',
  });
  if (!ok) return false;
  try { await releaseNumber(item.id); toast('Number released', { kind: 'ok' }); return true; } catch (err) { reportError(err); return false; }
}
