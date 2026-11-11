// Blocked senders: block one sender address or a whole domain on one alias or on the address of
// an inbox. The server then refuses mail from that sender to that address. Everything else on
// the address keeps working.
//
// - In an open email: "Block this sender" in "More actions".
// - On the row of an alias or an inbox: "Blocked senders" (the list, "Unblock", add by hand).
// - A quiet mark on the row: "3 blocked".
// The server keeps the blocked value encrypted for the account (docs/API.md, "Blocked senders").
import { h } from '../lib/dom.js';
import { registerMessageAction, registerRowAction, registerRowBadge } from '../lib/registry.js';
import { findMailbox } from '../lib/data.js';
import { reportError } from '../ui/components.js';
import { aliasFacts, inboxFacts, liveMark } from './common/facts.js';

// The dialogs load when the person opens one.
const open = (name, ...args) => import('./blocks/dialogs.js').then((m) => m[name](...args)).catch(reportError);

// The address that got the message: the alias, or the address of the inbox itself.
// null for a message of an alias that was deleted: there is no address to put the block on.
function targetOf(message, alias) {
  if (alias) return { addressId: alias.id, address: alias.address, kind: 'alias' };
  const box = findMailbox(message.mailboxId);
  return box && box.addressId && box.addressId === message.addressId ? { addressId: box.addressId, address: box.address, kind: 'inbox' } : null;
}

registerMessageAction((message, alias) => {
  const from = message.meta && message.meta.from ? String(message.meta.from.address || '') : '';
  if (message.direction !== 'in' || !from.includes('@')) return null;
  const target = targetOf(message, alias);
  return target ? { label: 'Block this sender', icon: 'shield', run: () => open('openBlockSender', from, target) } : null;
});

registerRowAction('alias', (item) => ({ label: 'Blocked senders', icon: 'shield', run: () => open('openBlockList', { addressId: item.id, address: item.address, kind: 'alias' }) }));
registerRowAction('inbox', (item) => (item.raw && item.raw.addressId
  ? { label: 'Blocked senders', icon: 'shield', run: () => open('openBlockList', { addressId: item.raw.addressId, address: item.address, kind: 'inbox' }) }
  : null));

const mark = (n) => (n > 0 ? h('span', { class: 'small faint nowrap', dataset: { blocked: String(n) }, title: 'Senders that this address blocks. Mail from them is refused.' }, `${n} blocked`) : null);
registerRowBadge('alias', (item) => liveMark(() => mark(aliasFacts(item.id).blocks)));
registerRowBadge('inbox', (item) => liveMark(() => mark(inboxFacts(item.id).blocks)));
