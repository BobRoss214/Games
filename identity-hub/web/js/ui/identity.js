// Dialogs for identities: make one, put an alias or a number in one, add items, delete.
// An identity is a named group of aliases and numbers. The server does not know the groups.
import { h } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { navigate } from '../lib/router.js';
import { phoneText, plural } from '../lib/format.js';
import { icon } from './icons.js';
import { button, field, checkbox, reportError } from './components.js';
import { openDialog, formDialog, confirmDialog } from './dialog.js';
import { toast } from './toast.js';
import { setItemIdentity } from '../lib/data.js';
import { createIdentity, deleteIdentity, findIdentity, identityOf, membersOf, NAME_MAX, NOTE_MAX } from '../lib/identities.js';

const NEW = '__new__';

function nameField(value = '') {
  return field({ label: 'Name', value, maxlength: NAME_MAX, placeholder: 'for example: Facebook', hint: 'Only you see this. It is encrypted.' });
}
function noteField(value = '') {
  return field({ label: 'What it is for', optional: true, value, rows: 2, maxlength: NOTE_MAX, placeholder: 'for example: Marketplace account for selling furniture' });
}
function readName(f) {
  const v = f.value.trim();
  if (!v) { f.setError('Give the identity a name.'); return ''; }
  return v;
}

// Makes a new identity. open = true goes to its screen after. Resolves to the new id, or ''.
export async function openNewIdentity({ open = true } = {}) {
  const name = nameField();
  const note = noteField();
  const id = await formDialog({
    title: 'New identity', submitLabel: 'Make identity',
    description: 'An identity is a named group. Put the aliases and numbers that you use in one place in it, for example everything for one website.',
    build: () => h('div', { class: 'stack' }, name.el, note.el),
    onSubmit: async () => {
      const n = readName(name);
      if (!n) return false;
      return createIdentity({ name: n, note: note.value });
    },
  });
  if (typeof id !== 'string') return '';
  toast('Identity made', { kind: 'ok', timeout: 2200 });
  if (open) navigate(`/identities/${id}`);
  return id;
}

// item = a row item: { kind: 'alias' | 'number', id, display, identityId }
export async function openPutInIdentity(item) {
  const groups = store.get('identities') || [];
  const current = identityOf(item);
  let choice = current || (groups[0] ? groups[0].id : NEW);
  const name = nameField();
  const newBox = h('div', { class: 'stack', hidden: choice !== NEW }, name.el);
  const groupName = 'identity-choice';
  const radio = (value, label, note = '') => {
    const id = `put-${value}`;
    const input = h('input', { type: 'radio', class: 'radio-input', name: groupName, id, value, checked: value === choice });
    input.addEventListener('change', () => { if (input.checked) { choice = value; newBox.hidden = choice !== NEW; if (choice === NEW) name.input.focus(); } });
    return h('div', { class: 'radio' }, input, h('label', { for: id }, h('span', { class: 'radio-label' }, label), note ? h('span', { class: 'radio-note' }, note) : null));
  };
  const ok = await formDialog({
    title: current ? 'Move to another identity' : 'Put in identity', submitLabel: 'Save',
    build: () => h('div', { class: 'stack' },
      h('p', { class: 'mono small muted break' }, item.display),
      h('div', { class: 'radio-list', role: 'radiogroup', 'aria-label': 'Identity' },
        groups.map((g) => {
          const m = membersOf(g.id);
          return radio(g.id, g.name, `${plural(m.aliases.length, 'address', 'addresses')}, ${plural(m.numbers.length, 'number')}`);
        }),
        radio(NEW, 'New identity…'),
      ),
      newBox,
    ),
    onSubmit: async () => {
      let target = choice;
      if (choice === NEW) {
        const n = readName(name);
        if (!n) return false;
        target = await createIdentity({ name: n });
      }
      if (target !== current) await setItemIdentity(item.kind, item.id, target);
      return target;
    },
  });
  if (typeof ok === 'string') {
    const g = findIdentity(ok);
    toast(g ? `Now in the identity ${g.name}` : 'Saved', { kind: 'ok', timeout: 2600, action: g ? { label: 'Open', onClick: () => navigate(`/identities/${g.id}`) } : null });
  }
}

export async function takeOutOfIdentity(item) {
  try {
    await setItemIdentity(item.kind, item.id, '');
    toast('Taken out of the identity', { kind: 'ok', timeout: 2200 });
  } catch (err) { reportError(err); }
}

// Pick aliases and numbers that are in no identity and put them in this one.
export function openAddExisting(identity) {
  const state = store.get();
  const free = [
    ...(state.aliases || []).filter((a) => !identityOf(a, state)).map((a) => ({ kind: 'alias', id: a.id, text: a.address, label: a.label })),
    ...(state.numbers || []).filter((n) => !identityOf(n, state)).map((n) => ({ kind: 'number', id: n.id, text: phoneText(n.number), label: n.label })),
  ];
  if (free.length === 0) {
    openDialog({
      title: 'Nothing to add', size: 'sm',
      content: (api) => h('div', { class: 'stack' },
        h('p', { class: 'read' }, 'Every alias and number is in an identity already, or you have none yet. Make a new alias or get a number for this identity.'),
        h('div', { class: 'dialog-actions' }, button('Close', { kind: 'primary', onClick: () => api.close() })),
      ),
    });
    return;
  }
  const boxes = free.map((f) => ({ item: f, box: checkbox(h('span', { class: 'pick-label' }, h('span', { class: 'mono break' }, f.text), f.label ? h('span', { class: 'small muted' }, f.label) : null)) }));
  formDialog({
    title: `Add to ${identity.name}`, submitLabel: 'Add',
    description: 'These aliases and numbers are in no identity yet.',
    build: () => h('div', { class: 'pick-list' }, boxes.map((b) => h('div', { class: 'pick-row' }, icon(b.item.kind === 'alias' ? 'alias' : 'phone', { size: 18 }), b.box.el))),
    onSubmit: async (api) => {
      const picked = boxes.filter((b) => b.box.checked).map((b) => b.item);
      if (picked.length === 0) { api.setError('Choose one or more.'); return false; }
      for (const p of picked) await setItemIdentity(p.kind, p.id, identity.id);
      toast(`${plural(picked.length, 'item')} added`, { kind: 'ok', timeout: 2200 });
      return true;
    },
  });
}

export async function confirmDeleteIdentity(identity) {
  const m = membersOf(identity.id);
  const count = m.aliases.length + m.numbers.length;
  const ok = await confirmDialog({
    title: `Delete the identity ${identity.name}?`,
    message: h('div', { class: 'stack stack-3' },
      h('p', { class: 'read' }, count
        ? `Its ${plural(count, 'alias or number', 'aliases and numbers')} ${count === 1 ? 'stays' : 'stay'}. ${count === 1 ? 'It is' : 'They are'} then not in an identity. Mail and texts are not deleted.`
        : 'This identity is empty. Nothing else is deleted.'),
      h('p', { class: 'read' }, 'The name, the note and the made-up details of the identity are deleted.'),
    ),
    confirmLabel: 'Delete identity',
  });
  if (!ok) return false;
  try { await deleteIdentity(identity.id); toast('Identity deleted', { kind: 'ok' }); return true; } catch (err) { reportError(err); return false; }
}
