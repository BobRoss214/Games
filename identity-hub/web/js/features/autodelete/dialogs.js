// The dialogs of "Automatic deletion": old mail of one inbox, and the end date of one alias.
// Before deletion is turned on (or made shorter), the person reads plainly that deleted
// mail cannot come back, and how much mail is that old now.
import { h } from '../../lib/dom.js';
import { api, query } from '../../lib/api.js';
import { fullTime, plural } from '../../lib/format.js';
import { button, field, callout, runBusy } from '../../ui/components.js';
import { formDialog, confirmDialog } from '../../ui/dialog.js';
import { toast } from '../../ui/toast.js';
import { choiceList } from '../common/choices.js';
import { refreshFacts, aliasFacts, inboxFacts } from '../common/facts.js';

const DAY = 86400;
const PRESETS = [7, 30, 90, 365];
const MAX_DAYS = 3650;           // the limit of the server for both settings
const COUNT_LIMIT = 100;         // one request: "100 or more" is exact enough
const now = () => Math.floor(Date.now() / 1000);
const days = (n) => plural(n, 'day');

// How much mail of the inbox is older than this number of days now.
async function countOlder(inboxId, n) {
  const res = await api.get('/api/messages' + query({ mailboxId: inboxId, before: now() - n * DAY, limit: COUNT_LIMIT }));
  return { count: (res.messages || []).length, more: !!res.more };
}

// ---- inbox: delete old mail ----
export async function openInboxAutoDelete(inbox) {
  await refreshFacts();
  const current = inboxFacts(inbox.id).retentionDays;
  const own = field({ label: 'Days', mono: true, inputmode: 'numeric', maxlength: 4, value: current && !PRESETS.includes(current) ? String(current) : '', hint: `A whole number from 1 to ${MAX_DAYS}.` });
  const ownBox = h('div', { hidden: true }, own.el);
  const choice = choiceList({
    legend: 'Delete mail that is older than',
    value: !current ? 'off' : PRESETS.includes(current) ? String(current) : 'own',
    options: [
      { value: 'off', label: 'Off', note: 'All mail is kept.' },
      ...PRESETS.map((n) => ({ value: String(n), label: days(n) })),
      { value: 'own', label: 'My own number of days' },
    ],
    onChange: (v) => { ownBox.hidden = v !== 'own'; if (v === 'own') own.input.focus(); },
  });
  ownBox.hidden = choice.value !== 'own';

  // null = off, a number = days, undefined = the field has an error.
  const read = () => {
    if (choice.value === 'off') return null;
    if (choice.value !== 'own') return Number(choice.value);
    const text = own.value.trim();
    const n = /^\d{1,4}$/.test(text) ? Number(text) : 0;
    if (n < 1 || n > MAX_DAYS) { own.setError(`Enter a whole number from 1 to ${MAX_DAYS}.`); return undefined; }
    return n;
  };

  const saved = await formDialog({
    title: 'Delete old mail automatically', submitLabel: 'Save', size: 'md',
    description: 'The server deletes old mail of this inbox by itself, also when this app is closed.',
    build: () => h('div', { class: 'stack' }, h('p', { class: 'mono small muted break' }, inbox.address), choice.el, ownBox),
    onSubmit: async () => {
      const next = read();
      if (next === undefined) return false;
      if (next === current) return { same: true };
      // Deletion starts, or reaches more mail than before: say what is lost and ask.
      if (next && (!current || next < current)) {
        const old = await countOlder(inbox.id, next);
        const amount = old.more ? `${COUNT_LIMIT} or more mails are` : `${plural(old.count, 'mail')} ${old.count === 1 ? 'is' : 'are'}`;
        const ok = await confirmDialog({
          title: 'Delete old mail?', confirmLabel: 'Delete old mail',
          message: h('div', { class: 'stack stack-3' },
            h('p', { class: 'read' }, `Mail older than ${days(next)} is deleted for good. This cannot be undone. The first deletion happens within one hour.`),
            h('p', { class: 'read strong' }, old.count ? `${amount} that old in this inbox now.` : 'No mail in this inbox is that old now.'),
          ),
        });
        if (!ok) return false;
      }
      await api.patch(`/api/mailboxes/${inbox.id}`, { retentionDays: next });
      await refreshFacts();
      return { next };
    },
  });
  if (saved && !saved.same) toast(saved.next ? `Mail older than ${days(saved.next)} is deleted from now on` : 'All mail is kept from now on', { kind: 'ok', timeout: 3200 });
}

// ---- alias: an end date ----
const pad = (n) => String(n).padStart(2, '0');
const dayValue = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export async function openAliasEnd(alias) {
  await refreshFacts();
  const current = aliasFacts(alias.id).expiresAt;
  const ended = !!current && current <= now();
  const today = new Date();
  const last = new Date(today.getFullYear(), today.getMonth(), today.getDate() + MAX_DAYS - 2);
  const day = field({ label: 'Last day', type: 'date', hint: 'The alias works until the end of this day.', attrs: { min: dayValue(today), max: dayValue(last) } });
  const dayBox = h('div', { hidden: true }, day.el);
  const choice = choiceList({
    legend: 'The alias stops',
    value: '7',
    options: [
      { value: '1', label: 'In 1 day' },
      { value: '7', label: 'In 7 days' },
      { value: '30', label: 'In 30 days' },
      { value: 'day', label: 'On a day that I choose' },
    ],
    onChange: (v) => { dayBox.hidden = v !== 'day'; if (v === 'day') day.input.focus(); },
  });

  // The time in Unix seconds, or undefined when the day field has an error.
  const read = () => {
    if (choice.value !== 'day') return now() + Number(choice.value) * DAY;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.value);
    // The start of the next day, in the time of this device.
    const at = m ? Math.floor(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1).getTime() / 1000) : 0;
    if (!at || at <= now() || at > now() + MAX_DAYS * DAY) { day.setError('Choose a day from today on, 10 years ahead at most.'); return undefined; }
    return at;
  };
  const patch = (expiresAt) => api.patch(`/api/aliases/${alias.id}`, { expiresAt }).then(() => refreshFacts());

  const result = await formDialog({
    title: current ? 'Change the end date' : 'Set an end date', submitLabel: 'Set end date', size: 'md',
    description: 'After the end date the alias refuses mail, like an alias that is turned off. Its mail stays.',
    build: (dlg) => h('div', { class: 'stack' },
      h('p', { class: 'mono small muted break' }, alias.address),
      current ? callout(ended ? 'warn' : 'info', ended ? `This alias ended on ${fullTime(current)}` : `This alias stops on ${fullTime(current)}`,
        h('div', null, button('Remove the end date', { size: 'sm', onClick: (e, btn) => runBusy(btn, async () => { await patch(null); dlg.close({ removed: true }); }) })),
      ) : null,
      choice.el, dayBox,
    ),
    onSubmit: async () => {
      const at = read();
      if (at === undefined) return false;
      await patch(at);
      return { at };
    },
  });
  if (!result) return;
  if (result.removed) toast(ended && alias.enabled ? 'End date removed. The alias works again.' : 'End date removed', { kind: 'ok', timeout: 3200 });
  else if (result.at) toast(`This alias stops on ${fullTime(result.at)}`, { kind: 'ok', timeout: 3200 });
}
