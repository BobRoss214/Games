// Automatic deletion.
// - An inbox can delete mail that is older than a number of days (off by default).
// - An alias can have an end date. After it the alias refuses mail, like an alias that is turned off.
// - A number has the same setting for texts on its own screen (Settings, "Old texts").
// - Settings, "Automatic deletion": one list of everything that has it on.
// The server does the work, also when this app is closed (docs/API.md: retentionDays, expiresAt).
// A row says in words what is on: "Deletes mail after 30 days", "Stops in 6 days", "Ended".
import { h, region } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { registerRowAction, registerRowBadge, registerSettingsSection } from '../lib/registry.js';
import { fullTime, phoneText, plural } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { button, tag, emptyState, skeletonRows, reportError, linkButton } from '../ui/components.js';
import { why } from '../ui/why.js';
import { aliasFacts, inboxFacts, keepCurrent } from './common/facts.js';

// The dialogs load when the person opens one.
const open = (name, ...args) => import('./autodelete/dialogs.js').then((m) => m[name](...args)).catch(reportError);
const now = () => Math.floor(Date.now() / 1000);
const days = (n) => plural(n, 'day');

// "Stops in 6 days", "Stops in 3 hours", "Ended".
export function endWords(expiresAt, at = now()) {
  const left = expiresAt - at;
  if (left <= 0) return 'Ended';
  if (left < 3600) return 'Stops in less than 1 hour';
  if (left < 86400) return `Stops in ${plural(Math.ceil(left / 3600), 'hour')}`;
  return `Stops in ${days(Math.ceil(left / 86400))}`;
}

// ---- inbox: delete old mail ----
registerRowAction('inbox', (item) => ({ label: 'Delete old mail automatically', icon: 'trash', run: () => open('openInboxAutoDelete', item.raw) }));
registerRowBadge('inbox', (item) => {
  const n = inboxFacts(item.raw).retentionDays;
  return n ? h('span', { class: 'small faint nowrap', dataset: { autodelete: String(n) } }, `Deletes mail after ${days(n)}`) : null;
});

// ---- alias: an end date ----
registerRowAction('alias', (item) => ({
  label: aliasFacts(item.raw).expiresAt ? 'Change the end date' : 'Set an end date',
  icon: 'clock', run: () => open('openAliasEnd', item.raw),
}));
// The words change with the clock ("Stops in 2 hours", then "Ended"), so this mark sets its words again each minute.
// data-end="ended" tells the row that this mark says "Ended" (the row then shows no second one).
registerRowBadge('alias', (item) => {
  const end = aliasFacts(item.raw).expiresAt;
  if (!end) return null;
  return keepCurrent(tag(''), (mark) => {
    const words = endWords(end);
    const ended = words === 'Ended';
    mark.textContent = words;
    mark.className = ended ? 'tag tag-warn' : 'tag';
    mark.dataset.end = ended ? 'ended' : 'set';
    mark.title = ended ? `This alias ended on ${fullTime(end)}. It refuses mail.` : `This alias stops on ${fullTime(end)}. After that it refuses mail.`;
  });
});

// ---- Settings: everything that has it on ----
function row({ iconName, value, words, action }) {
  return h('li', { class: 'phone-row' },
    h('span', { class: 'item-icon' }, icon(iconName, { size: 20 })),
    h('div', { class: 'item-main' }, h('span', { class: 'item-value mono break' }, value), h('div', { class: 'item-sub' }, h('span', { class: 'small muted' }, words))),
    h('div', { class: 'item-actions' }, action),
  );
}
function overview() {
  const app = store.get();
  if (app.mailboxes === null || app.aliases === null || app.numbers === null) return h('div', { class: 'sheet item-sheet' }, skeletonRows(2));
  const rows = [];
  for (const m of app.mailboxes) {
    const n = inboxFacts(m).retentionDays;
    if (n) rows.push(row({ iconName: 'inbox', value: m.address, words: `Mail older than ${days(n)} is deleted`, action: button('Change', { size: 'sm', attrs: { 'aria-label': `Change the automatic deletion of ${m.address}` }, onClick: () => open('openInboxAutoDelete', m) }) }));
  }
  for (const n of app.numbers) {
    if (n.retentionDays) rows.push(row({ iconName: 'phone', value: phoneText(n.number), words: `Texts older than ${days(n.retentionDays)} are deleted`, action: linkButton('Open number', `/numbers/${n.id}`, { size: 'sm' }) }));
  }
  for (const a of app.aliases) {
    const end = aliasFacts(a).expiresAt;
    if (end) rows.push(row({ iconName: 'alias', value: a.address, words: end <= now() ? `Ended on ${fullTime(end)}. It refuses mail.` : `Stops on ${fullTime(end)}`, action: button('Change', { size: 'sm', attrs: { 'aria-label': `Change the end date of ${a.address}` }, onClick: () => open('openAliasEnd', a) }) }));
  }
  return h('div', { class: 'sheet item-sheet' }, rows.length
    ? h('ul', { class: 'item-list' }, rows)
    : emptyState({ title: 'Nothing is deleted automatically', text: 'No inbox and no number deletes old messages. No alias has an end date.', compact: true, figure: false }));
}
registerSettingsSection({
  id: 'autodelete',
  title: 'Automatic deletion',
  lede: 'Inboxes and numbers that delete old messages, and aliases with an end date. To turn it on, open the menu of an inbox or an alias.',
  order: 45,
  render: ({ scope }) => {
    const el = region(scope, store, ['mailboxes', 'aliases', 'numbers'], overview);
    // "Stops on …" becomes "Ended on …" with the clock.
    scope.timer(() => el.repaint(), 60_000);
    return h('div', { class: 'stack stack-3' }, why('auto-delete'), el);
  },
});
