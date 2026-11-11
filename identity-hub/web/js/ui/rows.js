// One row for an inbox, an alias or a number. Used on Home, Aliases and Numbers.
import { h } from '../lib/dom.js';
import { phoneText, plural } from '../lib/format.js';
import { icon } from './icons.js';
import { toggle, copyButton, tag } from './components.js';
import { menuButton } from './menu.js';
import { updateAlias, mailboxName, phoneName } from '../lib/data.js';
import { openRename, openMoveAlias, confirmDeleteItem } from './identities.js';
import { toast } from './toast.js';
import { navigate } from '../lib/router.js';
import { setMailFilter } from '../lib/mail.js';

const KIND_ICON = { inbox: 'inbox', alias: 'alias', number: 'phone' };
const KIND_NAME = { inbox: 'Inbox', alias: 'Alias', number: 'Number' };

// Makes one list of view items from the store: { kind, id, value, display, label, ... }
export function identityItems(state, aliasUnread = new Map()) {
  const boxes = state.mailboxes || [];
  const phones = state.phones || [];
  const items = [];
  for (const m of boxes) {
    items.push({ kind: 'inbox', id: m.id, address: m.address, value: m.address, display: m.address, label: m.label, off: m.status !== 'active', paused: m.status !== 'active', unread: m.unread, href: `/mail/${m.id}`, route: { text: 'Inbox', plain: true }, raw: m });
  }
  for (const a of state.aliases || []) {
    const box = boxes.find((m) => m.id === a.mailboxId);
    items.push({ kind: 'alias', id: a.id, address: a.address, value: a.address, display: a.address, label: a.label, off: !a.enabled, enabled: a.enabled, mailboxId: a.mailboxId, unread: aliasUnread.get(a.id) || 0, received: a.received, href: box ? `/mail/${box.id}` : '/mail', route: { text: `Inbox ${mailboxName(box)}` }, raw: a });
  }
  for (const n of state.numbers || []) {
    const phone = n.forwardPhoneId ? phones.find((p) => p.id === n.forwardPhoneId) : null;
    const forwards = phone && phone.verified && (n.forwardTexts || n.forwardCalls);
    items.push({ kind: 'number', id: n.id, number: n.number, value: n.number, display: phoneText(n.number), label: n.label, off: n.status !== 'active', paused: n.status !== 'active', unread: n.unread, href: `/numbers/${n.id}`, route: forwards ? { text: `forwards to ${phoneName(phone)}` } : { text: 'in app only', plain: true }, raw: n });
  }
  return items;
}

export function matchesSearch(item, q) {
  if (!q) return true;
  const needle = q.toLowerCase().trim();
  const hay = `${item.value} ${item.display} ${item.label || ''} ${item.route.text}`.toLowerCase();
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

export function identityRow(item, { showReceived = false } = {}) {
  const menuItems = () => [
    { label: 'Rename', icon: 'edit', onSelect: () => openRename(item) },
    item.kind === 'alias' ? { label: 'Move to another inbox', icon: 'move', onSelect: () => openMoveAlias(item) } : null,
    item.kind === 'alias' ? { label: 'Show its mail', icon: 'mail', onSelect: () => { setMailFilter({ mailboxId: item.mailboxId, addressId: item.id }); navigate(item.href); } } : null,
    item.kind === 'inbox' ? { label: 'Open inbox', icon: 'mail', onSelect: () => navigate(item.href) } : null,
    item.kind === 'number' ? { label: 'Open number', icon: 'message', onSelect: () => navigate(item.href) } : null,
    'separator',
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

  return h('li', { class: `id-row ${item.off ? 'is-off' : ''}`.trim(), dataset: { kind: item.kind, id: item.id } },
    h('span', { class: 'id-icon', title: KIND_NAME[item.kind] }, icon(KIND_ICON[item.kind], { size: 20, label: KIND_NAME[item.kind] })),
    h('div', { class: 'id-main' },
      h('a', { class: 'id-value mono', href: item.href, 'data-link': true, title: item.display }, item.kind === 'number' ? item.display : breakable(item.display)),
      h('div', { class: 'id-sub' },
        item.label ? h('span', { class: 'id-label' }, item.label) : h('span', { class: 'id-label is-empty' }, 'No label'),
        item.kind === 'alias' && !item.enabled ? tag('Off') : null,
        item.paused ? tag('Paused', 'warn') : null,
        item.unread > 0 ? h('span', { class: 'badge', 'aria-label': `${item.unread} unread` }, item.unread > 99 ? '99+' : String(item.unread)) : null,
      ),
    ),
    h('div', { class: `id-route ${item.route.plain ? 'is-plain' : ''}`.trim() },
      item.route.plain ? null : icon('arrowRight', { size: 14, label: 'delivers to' }),
      h('span', { class: 'truncate' }, item.route.text),
      showReceived && item.kind === 'alias' ? h('span', { class: 'id-count' }, plural(item.received || 0, 'message')) : null,
    ),
    h('div', { class: 'id-actions' },
      sw || h('span', { class: 'id-switch-gap', 'aria-hidden': 'true' }),
      copyButton(() => item.value, `Copy ${item.kind === 'number' ? 'number' : 'address'}`, { what: item.kind === 'number' ? 'Number copied' : 'Address copied' }),
      menuButton({ label: `More actions for ${item.display}`, items: menuItems }),
    ),
  );
}

export function identityList(items, opts) {
  return h('ul', { class: 'id-list' }, items.map((it) => identityRow(it, opts)));
}
