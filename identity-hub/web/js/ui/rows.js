// One row for an inbox, an alias or a number. Used on Home, Aliases and Numbers.
import { h } from '../lib/dom.js';
import { phoneText, plural } from '../lib/format.js';
import { icon } from './icons.js';
import { toggle, copyButton, tag } from './components.js';
import { menuButton } from './menu.js';
import { updateAlias, mailboxName, phoneName } from '../lib/data.js';
import { openRename, openMoveAlias, confirmDeleteItem } from './items.js';
import { toast } from './toast.js';
import { navigate } from '../lib/router.js';
import { setMailFilter } from '../lib/mail.js';
import { fullName } from '../lib/persona/index.js';
import { openPersonaDialog } from './persona.js';
import { openPutInIdentity, takeOutOfIdentity } from './identity.js';
import { registered } from '../lib/registry.js';

const KIND_ICON = { inbox: 'inbox', alias: 'alias', number: 'phone' };
const KIND_NAME = { inbox: 'Inbox', alias: 'Alias', number: 'Number' };

// Makes one list of view items from the store: { kind, id, value, display, label, ... }
export function rowItems(state, aliasUnread = new Map()) {
  const boxes = state.mailboxes || [];
  const phones = state.phones || [];
  const groups = new Map((state.identities || []).map((g) => [g.id, g]));
  // identityId is '' when the item is in no identity, or in one that does not exist any more.
  const group = (x) => { const g = x.identityId ? groups.get(x.identityId) : null; return { identityId: g ? g.id : '', identityName: g ? g.name : '', persona: x.persona || null }; };
  const items = [];
  for (const m of boxes) {
    items.push({ kind: 'inbox', id: m.id, address: m.address, value: m.address, display: m.address, label: m.label, off: m.status !== 'active', paused: m.status !== 'active', unread: m.unread, href: `/mail/${m.id}`, route: { text: 'Inbox', plain: true }, extra: m.extra || {}, raw: m });
  }
  for (const a of state.aliases || []) {
    const box = boxes.find((m) => m.id === a.mailboxId);
    items.push({ kind: 'alias', id: a.id, address: a.address, value: a.address, display: a.address, label: a.label, off: !a.enabled, enabled: a.enabled, mailboxId: a.mailboxId, unread: aliasUnread.get(a.id) || 0, received: a.received, href: box ? `/mail/${box.id}` : '/mail', route: { text: `Inbox ${mailboxName(box)}` }, ...group(a), extra: a.extra || {}, raw: a });
  }
  for (const n of state.numbers || []) {
    const phone = n.forwardPhoneId ? phones.find((p) => p.id === n.forwardPhoneId) : null;
    const forwards = phone && phone.verified && (n.forwardTexts || n.forwardCalls);
    items.push({ kind: 'number', id: n.id, number: n.number, value: n.number, display: phoneText(n.number), label: n.label, off: n.status !== 'active', paused: n.status !== 'active', unread: n.unread, href: `/numbers/${n.id}`, forwards: !!forwards, route: forwards ? { text: `forwards to ${phoneName(phone)}` } : { text: 'in app only', plain: true }, ...group(n), extra: n.extra || {}, raw: n });
  }
  return items;
}

export function matchesSearch(item, q) {
  if (!q) return true;
  const needle = q.toLowerCase().trim();
  const hay = `${item.value} ${item.display} ${item.label || ''} ${item.route.text} ${item.identityName || ''} ${item.persona ? fullName(item.persona) : ''}`.toLowerCase();
  if (hay.includes(needle)) return true;
  const digits = needle.replace(/[^\d+]/g, '');
  return digits.length >= 3 && item.kind === 'number' && item.value.includes(digits);
}

// An address may wrap after a dot and before the @ sign, not in the middle of a word.
export function breakable(address) {
  const out = [];
  for (const part of String(address).split(/(?<=\.)|(?=@)/)) { out.push(part); out.push(document.createElement('wbr')); }
  out.pop();
  return out;
}

// showIdentity: show the name of the identity that the item is in (not needed on the identity screen itself).
export function itemRow(item, { showReceived = false, showIdentity = true } = {}) {
  const groupable = item.kind === 'alias' || item.kind === 'number';
  // Entries of feature files: the usual ones go above the line, the dangerous ones below it.
  const menuItems = (extra = registered.rowActions(item.kind, item).map((a) => ({ label: a.label, icon: a.icon, danger: a.danger, onSelect: () => a.run(item) }))) => [
    { label: 'Rename', icon: 'edit', onSelect: () => openRename(item) },
    groupable ? { label: 'Random identifiers generator', icon: 'person', onSelect: () => openPersonaDialog(item) } : null,
    groupable ? { label: item.identityId ? 'Move to another identity…' : 'Put in identity…', icon: 'folder', onSelect: () => openPutInIdentity(item) } : null,
    groupable && item.identityId ? { label: 'Take out of this identity', icon: 'close', onSelect: () => takeOutOfIdentity(item) } : null,
    item.kind === 'alias' ? { label: 'Move to another inbox', icon: 'move', onSelect: () => openMoveAlias(item) } : null,
    item.kind === 'alias' ? { label: 'Show its mail', icon: 'mail', onSelect: () => { setMailFilter({ mailboxId: item.mailboxId, addressId: item.id }); navigate(item.href); } } : null,
    item.kind === 'inbox' ? { label: 'Open inbox', icon: 'mail', onSelect: () => navigate(item.href) } : null,
    item.kind === 'number' ? { label: 'Open number', icon: 'message', onSelect: () => navigate(item.href) } : null,
    ...extra.filter((a) => !a.danger),
    'separator',
    ...extra.filter((a) => a.danger),
    { label: item.kind === 'number' ? 'Release number' : 'Delete', icon: 'trash', danger: true, onSelect: () => confirmDeleteItem(item) },
  ];

  const sw = item.kind === 'alias' ? toggle({
    checked: item.enabled,
    label: item.enabled ? `Turn off ${item.address}` : `Turn on ${item.address}`,
    onChange: async (on) => {
      await updateAlias(item.id, { enabled: on });
      toast(on ? 'Alias turned on' : 'Alias turned off. Mail to it is refused.', { kind: 'ok', timeout: 2600 });
    },
  }) : null;

  return h('li', { class: `item-row ${item.off ? 'is-off' : ''}`.trim(), dataset: { kind: item.kind, id: item.id } },
    h('span', { class: 'item-icon', title: KIND_NAME[item.kind] }, icon(KIND_ICON[item.kind], { size: 20, label: KIND_NAME[item.kind] })),
    h('div', { class: 'item-main' },
      h('a', { class: 'item-value mono', href: item.href, 'data-link': true, title: item.display }, item.kind === 'number' ? item.display : breakable(item.display)),
      h('div', { class: 'item-sub' },
        item.label ? h('span', { class: 'item-label' }, item.label) : h('span', { class: 'item-label is-empty' }, 'No label'),
        item.kind === 'alias' && !item.enabled ? tag('Off') : null,
        item.paused ? tag('Paused', 'warn') : null,
        item.unread > 0 ? h('span', { class: 'badge', 'aria-label': `${item.unread} unread` }, item.unread > 99 ? '99+' : String(item.unread)) : null,
        showIdentity && item.identityId ? h('a', { class: 'tag tag-link item-group', href: `/identities/${item.identityId}`, 'data-link': true, title: `In the identity ${item.identityName}` }, icon('folder', { size: 12 }), h('span', { class: 'truncate' }, item.identityName)) : null,
        item.persona ? h('button', { class: 'tag tag-link item-persona', type: 'button', title: 'Random identifiers', onClick: () => openPersonaDialog(item) }, icon('person', { size: 12 }), h('span', { class: 'truncate' }, fullName(item.persona))) : null,
        registered.rowBadges(item.kind, item),
      ),
    ),
    h('div', { class: `item-route ${item.route.plain ? 'is-plain' : ''}`.trim() },
      item.route.plain ? null : icon('arrowRight', { size: 14, label: 'delivers to' }),
      h('span', { class: 'truncate' }, item.route.text),
      showReceived && item.kind === 'alias' ? h('span', { class: 'item-count' }, plural(item.received || 0, 'message')) : null,
    ),
    h('div', { class: 'item-actions' },
      sw || h('span', { class: 'item-switch-gap', 'aria-hidden': 'true' }),
      copyButton(() => item.value, `Copy ${item.kind === 'number' ? 'number' : 'address'}`, { what: item.kind === 'number' ? 'Number copied' : 'Address copied' }),
      menuButton({ label: `More actions for ${item.display}`, items: menuItems }),
    ),
  );
}

export function itemRows(items, opts) {
  return h('ul', { class: 'item-list' }, items.map((it) => itemRow(it, opts)));
}
