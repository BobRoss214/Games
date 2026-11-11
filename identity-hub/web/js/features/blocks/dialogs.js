// The dialogs of "Blocked senders": block the sender of one message, and the list of one address.
// target = { addressId, address, kind: 'alias' | 'inbox' }: the address that the block is on.
import { h, replace } from '../../lib/dom.js';
import { api } from '../../lib/api.js';
import { dayText } from '../../lib/format.js';
import { openSealed } from '../../lib/session.js';
import { loadAliases, loadMailboxes } from '../../lib/data.js';
import { senderDomain } from '../../lib/leak.js';
import { icon } from '../../ui/icons.js';
import { button, field, tag, runBusy, reportError, emptyState, skeletonRows, loadError } from '../../ui/components.js';
import { openDialog, formDialog } from '../../ui/dialog.js';
import { toast } from '../../ui/toast.js';
import { why } from '../../ui/why.js';
import { choiceList } from '../common/choices.js';

const thing = (target) => (target.kind === 'inbox' ? 'inbox' : 'alias');
const path = (target) => `/api/addresses/${target.addressId}/blocks`;

// The rows show the number of blocks. It comes with the list of aliases or inboxes: load that list again.
const reload = (target) => (target.kind === 'alias' ? loadAliases() : loadMailboxes()).catch(() => { /* the next change of the list shows it */ });
async function block(target, kind, value) {
  const res = await api.post(path(target), { kind, value });
  reload(target);
  return res.block;
}
async function unblock(target, blockId) {
  await api.del(`${path(target)}/${blockId}`);
  reload(target);
}
// What was blocked, in words: "news@shop.example" or "all addresses at shop.example".
const named = (kind, value) => (kind === 'domain' ? `all addresses at ${value}` : value);

// ---- from an open email ----
export async function openBlockSender(fromAddress, target) {
  const address = String(fromAddress).trim().toLowerCase();
  const domain = senderDomain(address) || address.slice(address.lastIndexOf('@') + 1);
  const choice = choiceList({
    legend: 'Block',
    value: 'address',
    options: [
      { value: 'address', label: `Only this address: ${address}` },
      { value: 'domain', label: `All addresses at ${domain}` },
    ],
  });
  const made = await formDialog({
    title: 'Block this sender', submitLabel: 'Block sender', size: 'md',
    description: `Mail from this sender to ${target.address} is refused. Everything else on this ${thing(target)} keeps working.`,
    build: () => h('div', { class: 'stack' }, choice.el, why('block-sender')),
    onSubmit: async () => {
      const kind = choice.value;
      const value = kind === 'domain' ? domain : address;
      // The server answers the same for a sender that was blocked before. The list from before tells the two apart.
      const before = ((await api.get(path(target))).blocks || []).map((b) => b.id);
      const made = await block(target, kind, value);
      return { kind, value, block: made, isNew: !before.includes(made.id) };
    },
  });
  if (!made || !made.block) return;
  const what = named(made.kind, made.value);
  // "Undo" takes away a block that this dialog made, never one that was there before.
  toast(`Blocked ${what}. Mail from ${made.kind === 'domain' ? 'them' : 'it'} to this ${thing(target)} is refused.`, {
    kind: 'ok', timeout: 8000,
    action: made.isNew ? { label: 'Undo', onClick: () => unblock(target, made.block.id).then(() => toast(`Unblocked ${what}`, { kind: 'ok', timeout: 2600 })).catch(reportError) } : null,
  });
}

// ---- the list of one address ----
export function openBlockList(target) {
  const slot = h('div', { class: 'sheet item-sheet' }, skeletonRows(2));
  let list = null;

  async function load() {
    try {
      const res = await api.get(path(target));
      const opened = await Promise.all((res.blocks || []).map(async (b) => {
        const plain = await openSealed(b.sealed, 'block');
        const ok = plain && (plain.kind === 'address' || plain.kind === 'domain') && typeof plain.value === 'string';
        return { id: b.id, createdDay: b.createdDay, kind: ok ? plain.kind : '', value: ok ? plain.value : '' };
      }));
      list = opened;
      paint();
    } catch (err) {
      replace(slot, loadError(err.message, () => { replace(slot, skeletonRows(2)); load(); }));
    }
  }

  function paint() {
    if (!list.length) {
      replace(slot, emptyState({ title: 'No blocked senders', text: `Mail from every sender arrives on this ${thing(target)}.`, compact: true, figure: false }));
      return;
    }
    replace(slot, h('ul', { class: 'item-list' }, list.map((b) => {
      const shown = b.value || 'A sender that this browser cannot read';
      return h('li', { class: 'phone-row', dataset: { block: b.kind } },
        h('span', { class: 'item-icon' }, icon('shield', { size: 20 })),
        h('div', { class: 'item-main' },
          h('span', { class: 'item-value mono break' }, shown),
          h('div', { class: 'item-sub' },
            b.kind ? tag(b.kind === 'domain' ? 'Whole domain' : 'One address') : null,
            h('span', { class: 'small faint' }, `Blocked on ${dayText(b.createdDay)}`),
          ),
        ),
        h('div', { class: 'item-actions' },
          button('Unblock', { size: 'sm', attrs: { 'aria-label': `Unblock ${shown}` }, onClick: (e, btn) => runBusy(btn, async () => {
            await unblock(target, b.id);
            toast(b.value ? `Unblocked ${named(b.kind, b.value)}` : 'Unblocked', { kind: 'ok', timeout: 2600 });
            await load();
          }) }),
        ),
      );
    })));
  }

  // Add a sender by hand: text with "@" is one address, text without it is a domain.
  const entry = field({ label: 'Block an address or a domain', mono: true, maxlength: 254, placeholder: 'news@shop.example or shop.example', hint: 'A domain also blocks its subdomains.' });
  const add = button('Block', { type: 'submit', iconName: 'shield' });
  const form = h('form', { class: 'stack stack-3', novalidate: true, onSubmit: (e) => {
    e.preventDefault();
    const value = entry.value.trim().toLowerCase();
    if (!value) { entry.setError('Enter an email address or a domain.'); return; }
    const kind = value.includes('@') ? 'address' : 'domain';
    runBusy(add, async () => {
      await block(target, kind, value);
      entry.value = '';
      toast(`Blocked ${named(kind, value)}`, { kind: 'ok', timeout: 2600 });
      await load();
    }, { onError: (err) => {
      if (err.status !== 400 && err.code !== 'limit_reached') return false;
      entry.setError(err.code === 'limit_reached' ? err.message : 'This is not an email address or a domain. For example: news@shop.example or shop.example.');
      return true;
    } });
  } }, entry.el, h('div', null, add));

  openDialog({
    title: 'Blocked senders', size: 'md',
    description: `Mail from these senders to this ${thing(target)} is refused. Everything else on it keeps working.`,
    content: (dlg) => h('div', { class: 'stack' },
      h('p', { class: 'mono small muted break' }, target.address),
      why('block-sender'),
      slot,
      form,
      h('div', { class: 'dialog-actions' }, button('Done', { kind: 'primary', onClick: () => dlg.close() })),
    ),
  });
  load();
}
