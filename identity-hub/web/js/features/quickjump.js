// Quick jump: press "/" (or Ctrl+K, Command+K; on a phone the search button in the top bar),
// type a few letters, press Enter, and you are there.
//
// It finds identities, aliases, numbers, inboxes and pages. Everything is searched in this
// browser, in the data that the app already holds open in memory. It makes no request, it
// stores nothing, it keeps no history, and nothing of the search goes into the address bar
// (a place is /identities/<random id>, never a name or an address).
// The matching is in quickjump/match.js. It loads with the app, so that the first search asks the server for nothing.
import { h, replace, uid } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { navigate } from '../lib/router.js';
import { registerGlobalKey, registerTopBarAction, hasRoute } from '../lib/registry.js';
import { setMailFilter } from '../lib/mail.js';
import { membersOf } from '../lib/identities.js';
import { isPersona, fullName } from '../lib/persona/index.js';
import { phoneText, plural } from '../lib/format.js';
import { openDialog } from '../ui/dialog.js';
import { icon } from '../ui/icons.js';
import { prepare, search } from './quickjump/match.js';

const LIMIT = 20;
const KIND_WORD = { identity: 'Identity', alias: 'Alias', number: 'Number', inbox: 'Inbox', page: 'Page' };
const WHY_WORD = { note: 'Note', identifiers: 'Random identifiers', identity: 'Identity' };

// The pages. A page shows only when its screen is there (hasRoute). "words" are other words that find it.
// needs: a second screen that must be there. feature: a part of the server that must be on.
const PAGES = [
  { title: 'Home', path: '/', icon: 'home' },
  { title: 'Mail', path: '/mail', icon: 'mail', words: 'email messages' },
  { title: 'Aliases', path: '/aliases', icon: 'alias', words: 'addresses' },
  { title: 'Numbers', path: '/numbers', icon: 'phone', words: 'phone texts calls', feature: 'phone' },
  { title: 'Funds', path: '/funds', icon: 'funds', words: 'balance credit pay add funds' },
  { title: 'Help', path: '/help', icon: 'info', words: 'questions answers words' },
  { title: 'Settings', path: '/settings', icon: 'settings', words: 'passkeys sessions theme sign out delete account' },
  { title: 'Tutorial', path: '/tutorial', icon: 'check', words: 'first steps learn' },
  { title: 'My stats', path: '/stats', icon: 'group', words: 'counts statistics' },
  { title: 'Who leaked me', path: '/leaks', icon: 'shield', words: 'possibly leaked senders' },
  { title: 'Download my data', path: '/settings#download-my-data', needs: '/open-export', icon: 'download', words: 'export file copy backup' },
];

function pages() {
  const features = (store.get('config') || {}).features || {};
  return PAGES.filter((p) => (!p.feature || features[p.feature]) && hasRoute(p.path.split('#')[0]) && (!p.needs || hasRoute(p.needs)))
    .map((p) => prepare({
      kind: 'page', title: p.title, main: p.title, mono: false, sub: '', icon: p.icon, href: p.path,
      fields: [{ name: 'title', text: p.title, level: 0 }, { name: 'words', text: p.words || '', level: 2 }],
    }));
}

// Mail shows only the mail of one alias. From another screen, the Mail screen takes the choice when it
// opens (setMailFilter). When Mail is open on that inbox already, it would not look: then the choice is
// made in its "Show mail of" list, as the person would do it by hand.
function showMailOf(mailboxId, aliasId) {
  const select = location.pathname.split('/')[2] === mailboxId ? document.querySelector('.mail-address-filter select') : null;
  if (select && [...select.options].some((o) => o.value === aliasId)) {
    select.value = aliasId;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  } else setMailFilter({ mailboxId, addressId: aliasId });
}

// Every place to go, from the lists that the app holds open. A label is a name (level 0),
// an address or a number is level 1, the rest is level 2 (see quickjump/match.js).
function places() {
  const s = store.get();
  const groups = new Map((s.identities || []).map((g) => [g.id, g]));
  const groupOf = (x) => { const g = x.identityId ? groups.get(x.identityId) : null; return g ? g.name : ''; };
  const madeUp = (x) => (isPersona(x.persona) ? fullName(x.persona) : '');
  const rest = (x) => [
    { name: 'note', text: x.note, level: 2 },
    { name: 'identifiers', text: madeUp(x), level: 2 },
    { name: 'identity', text: groupOf(x), level: 2 },
  ];
  const sub = (label, state) => [label || 'No label', state].filter(Boolean).join(' · ');
  const out = [];
  for (const g of s.identities || []) {
    const m = membersOf(g.id, s);
    out.push({
      kind: 'identity', title: g.name, main: g.name, mono: false, icon: 'folder', href: `/identities/${g.id}`,
      sub: `${plural(m.aliases.length, 'alias', 'aliases')}, ${plural(m.numbers.length, 'number')}`,
      fields: [{ name: 'title', text: g.name, level: 0 }, { name: 'note', text: g.note, level: 2 }, { name: 'identifiers', text: madeUp(g), level: 2 }],
    });
  }
  for (const a of s.aliases || []) {
    const box = (s.mailboxes || []).find((m) => m.id === a.mailboxId);
    out.push({
      kind: 'alias', title: a.label || a.address, main: a.address, mono: true, icon: 'alias', sub: sub(a.label, a.enabled ? '' : 'Off'),
      // An alias has no screen of its own: the place is its mail, as "Show its mail" in the row menu.
      href: box ? `/mail/${box.id}` : '/aliases', before: box ? () => showMailOf(box.id, a.id) : null,
      fields: [{ name: 'title', text: a.label, level: 0 }, { name: 'address', text: a.address, level: 1 }, ...rest(a)],
    });
  }
  for (const n of s.numbers || []) {
    out.push({
      kind: 'number', title: n.label || n.number, main: phoneText(n.number), mono: true, icon: 'phone', sub: sub(n.label, n.status === 'active' ? '' : 'Paused'), href: `/numbers/${n.id}`,
      fields: [{ name: 'title', text: n.label, level: 0 }, { name: 'number', text: n.number, digits: n.number, level: 1 }, ...rest(n)],
    });
  }
  for (const m of s.mailboxes || []) {
    out.push({
      kind: 'inbox', title: m.label || m.address, main: m.address, mono: true, icon: 'inbox', sub: sub(m.label, m.status === 'active' ? '' : 'Paused'), href: `/mail/${m.id}`,
      fields: [{ name: 'title', text: m.label, level: 0 }, { name: 'address', text: m.address, level: 1 }, { name: 'note', text: m.note, level: 2 }],
    });
  }
  return [...out.map(prepare), ...pages()];
}

export function openQuickJump() {
  // One search at a time, and only for a person who is signed in with the key in this tab.
  if (store.get('phase') !== 'in' || document.querySelector('dialog.f-quickjump[open]')) return;
  const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  let all = places();
  // With no letters typed: the identities and the pages.
  const start = () => [...all.filter((e) => e.kind === 'identity').slice(0, 6), ...all.filter((e) => e.kind === 'page')].map((e) => ({ ...e, why: null }));
  // Right after the app starts, a list can still be on its way (null).
  const LISTS = ['identities', 'aliases', 'numbers', 'mailboxes'];
  const loading = () => LISTS.some((key) => store.get(key) === null);
  const listId = uid('quickjump');
  const inputId = `${listId}-input`;
  const hintId = `${listId}-hint`;
  let shown = [];
  let active = -1;
  let went = false;

  const input = h('input', {
    class: 'input search-input', type: 'text', id: inputId, role: 'combobox', 'aria-expanded': 'true', 'aria-controls': listId, 'aria-autocomplete': 'list', 'aria-describedby': hintId,
    autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', inputmode: 'search', enterkeyhint: 'go', maxlength: 100, placeholder: 'Name, label, address or number',
  });
  const list = h('ul', { class: 'f-quickjump-list', id: listId, role: 'listbox', 'aria-label': 'Places' });
  const status = h('p', { class: 'muted', role: 'status', hidden: true });
  const say = (text) => { status.textContent = text; status.hidden = !text; };

  const dlg = openDialog({
    title: 'Search', size: 'md', cls: 'f-quickjump',
    content: () => h('div', { class: 'stack stack-3' },
      // (the outer div keeps the field at its own height inside the column)
      h('div', null, h('div', { class: 'search-wrap' },
        h('label', { class: 'sr-only', for: inputId }, 'Search for an identity, an alias, a number, an inbox or a page'),
        icon('search', { size: 16, cls: 'search-icon' }),
        input,
      )),
      list,
      status,
      h('p', { class: 'small muted f-quickjump-hint', id: hintId }, 'Arrow keys move. Enter opens.'),
    ),
  });
  // The lists can change while the search is open (they load, or another tab changed them): search again.
  const stop = store.subscribe(LISTS, () => { all = places(); paint(true); });
  dlg.closed.then(() => {
    stop();
    // Closed with no place chosen: the focus goes back to where it was.
    if (!went && opener && opener.isConnected && document.activeElement !== opener) opener.focus();
  });

  function go(item) {
    if (!item) return;
    went = true;
    dlg.close();
    if (item.before) item.before();
    navigate(item.href);
  }
  function setActive(i, scroll = true) {
    if (i === active) return;
    const rows = list.querySelectorAll('[role="option"]');
    if (rows[active]) rows[active].setAttribute('aria-selected', 'false');
    active = i;
    const row = rows[active];
    if (row) {
      row.setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', row.id);
      if (scroll) row.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }
  // keep: the lists changed under the same letters; the mark stays on the same place if it is still there.
  function paint(keep = false) {
    const query = input.value;
    const marked = keep && shown[active] ? shown[active].href : '';
    const first = start();
    const result = query.trim() ? search(all, query, { limit: LIMIT }) : { items: first, total: first.length };
    shown = result.items;
    active = -1;
    replace(list, shown.map((item, i) => {
      const why = item.why && WHY_WORD[item.why.name] ? `${WHY_WORD[item.why.name]}: ${item.why.text}` : '';
      const sub = [item.sub, why].filter(Boolean).join(' · ');
      return h('li', { role: 'presentation' }, h('a', {
        class: 'f-quickjump-row', id: `${listId}-${i}`, role: 'option', 'aria-selected': 'false', href: item.href, tabIndex: -1, dataset: { kind: item.kind },
        // A plain click or tap goes there in this tab. With Ctrl, Command or Shift the browser opens the link in its own way.
        onClick: (e) => { if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); go(item); },
        onMousemove: () => setActive(i, false),
      },
        h('span', { class: 'f-quickjump-icon' }, icon(item.icon, { size: 18 })),
        h('span', { class: 'f-quickjump-main' },
          h('span', { class: `f-quickjump-value truncate ${item.mono ? 'mono' : ''}`.trim() }, item.main),
          sub ? h('span', { class: 'small muted truncate' }, sub) : null,
        ),
        h('span', { class: 'small muted nowrap' }, KIND_WORD[item.kind]),
      ));
    }));
    input.removeAttribute('aria-activedescendant');
    input.setAttribute('aria-expanded', String(shown.length > 0));
    if (shown.length) setActive(Math.max(0, marked ? shown.findIndex((item) => item.href === marked) : 0), !keep);
    say(loading() ? 'Loading your items…' : !shown.length ? 'Nothing found.' : result.total > shown.length ? `The first ${shown.length} of ${result.total}. Type more letters to see fewer.` : '');
  }

  input.addEventListener('input', () => paint());
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!shown.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((active + step + shown.length) % shown.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(shown[active]);
    }
  });
  paint();
  input.focus();
}

// "/" opens it. The registry keeps the key quiet while the person types in a field,
// and while a dialog or a menu is open.
registerGlobalKey('/', () => openQuickJump());

// The second way: Ctrl+K, or Command+K on a Mac. The registry takes one key with no Ctrl or
// Command, so this listens by itself, with the same rules as the registry.
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.defaultPrevented || e.isComposing) return;
  if (String(e.key).toLowerCase() !== 'k' || store.get('phase') !== 'in') return;
  const t = e.target;
  if (t instanceof Element && t.closest('input, textarea, select, [contenteditable], [role="menu"], dialog')) return;
  if (document.querySelector('dialog[open], .menu')) return;
  e.preventDefault();
  openQuickJump();
});

// A phone has no "/" key in reach: the search button is in its top bar, before the gear.
registerTopBarAction({ id: 'quick-jump', label: 'Search', icon: 'search', run: () => openQuickJump(), order: 10 });
