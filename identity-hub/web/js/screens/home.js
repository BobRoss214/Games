// Home: the one dashboard. Counts, every identity in one list, and recent activity.
import { h, region, replace, debounce } from '../lib/dom.js';
import { store, bus } from '../lib/store.js';
import { money, shortTime, phoneText, plural } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { button, chips, emptyState, skeletonRows, pageHeader, linkButton } from '../ui/components.js';
import { identityItems, identityList, matchesSearch } from '../ui/rows.js';
import { openNewChooser, openNewAlias, openNewInbox, openGetNumber } from '../ui/identities.js';
import { listMessages, personShort } from '../lib/mail.js';
import { listTexts } from '../lib/phone.js';
import { setPref, mailboxName, findMailbox } from '../lib/data.js';

function statTile({ label, value, note, href, loading }) {
  return h('a', { class: 'stat', href, 'data-link': true },
    h('span', { class: 'stat-label' }, label),
    loading ? h('span', { class: 'skeleton skeleton-block' }) : h('span', { class: 'stat-value mono' }, value),
    h('span', { class: 'stat-note' }, loading ? ' ' : note),
  );
}

function stats(state) {
  const f = (state.config && state.config.features) || {};
  const loading = state.mailboxes === null || state.aliases === null || state.numbers === null;
  const boxes = state.mailboxes || [];
  const aliases = state.aliases || [];
  const numbers = state.numbers || [];
  const off = aliases.filter((a) => !a.enabled).length;
  const unreadMail = boxes.reduce((n, m) => n + (m.unread || 0), 0);
  const unreadTexts = numbers.reduce((n, m) => n + (m.unread || 0), 0);
  return h('div', { class: 'stats' },
    statTile({ label: 'Inboxes', value: String(boxes.length), note: unreadMail ? `${unreadMail} unread` : 'No unread mail', href: '/mail', loading }),
    statTile({ label: 'Aliases', value: String(aliases.length), note: off ? `${off} turned off` : 'All on', href: '/aliases', loading }),
    f.phone
      ? statTile({ label: 'Numbers', value: String(numbers.length), note: unreadTexts ? `${plural(unreadTexts, 'new text')}` : 'No new texts', href: '/numbers', loading })
      : h('div', { class: 'stat is-disabled' }, h('span', { class: 'stat-label' }, 'Numbers'), h('span', { class: 'stat-value mono' }, '–'), h('span', { class: 'stat-note' }, 'Turned off on this server')),
    statTile({ label: 'Balance', value: money(state.balance), note: 'US dollars of credit', href: '/funds', loading: false }),
  );
}

// First steps: add funds, make an inbox, make an alias, get a number.
function checklist(state) {
  if (state.mailboxes === null || state.aliases === null || state.numbers === null) return null;
  if (state.prefs && state.prefs.hideChecklist) return null;
  const f = (state.config && state.config.features) || {};
  const hasBox = state.mailboxes.length > 0;
  const steps = [
    f.pay ? { done: state.balance > 0 || hasBox || state.numbers.length > 0, title: 'Add funds', text: 'Pay with Bitcoin or Monero. An inbox and a number cost a little each month.', action: linkButton('Add funds', '/funds', { size: 'sm' }) } : null,
    { done: hasBox, title: 'Make an inbox', text: 'A real mailbox with its own address.', action: button('Make inbox', { size: 'sm', onClick: () => openNewInbox() }) },
    { done: state.aliases.length > 0, title: 'Make an alias', text: 'An extra address for one shop or one site. Free.', action: button('Make alias', { size: 'sm', onClick: () => openNewAlias() }) },
    f.phone ? { done: state.numbers.length > 0, title: 'Get a number', text: 'A phone number for texts and calls.', action: button('Get a number', { size: 'sm', onClick: () => openGetNumber() }) } : null,
  ].filter(Boolean);
  if (steps.every((s) => s.done)) return null;
  const next = steps.findIndex((s) => !s.done);
  return h('section', { class: 'sheet firststeps', 'aria-labelledby': 'firststeps-title' },
    h('div', { class: 'firststeps-head' },
      h('div', null, h('h2', { class: 'section-title', id: 'firststeps-title' }, 'First steps'), h('p', { class: 'small muted' }, `${steps.filter((s) => s.done).length} of ${steps.length} done`)),
      button('Hide', { kind: 'quiet', size: 'sm', onClick: () => setPref('hideChecklist', true) }),
    ),
    h('ol', { class: 'firststeps-list' }, steps.map((s, i) => h('li', { class: `firststep ${s.done ? 'is-done' : ''} ${i === next ? 'is-next' : ''}`.trim() },
      h('span', { class: 'firststep-mark mono', 'aria-hidden': 'true' }, s.done ? icon('check', { size: 14 }) : String(i + 1)),
      h('div', { class: 'grow' }, h('p', { class: 'firststep-title' }, s.title, s.done ? h('span', { class: 'sr-only' }, ' (done)') : null), h('p', { class: 'small muted' }, s.text)),
      !s.done && i === next ? s.action : null,
    ))),
  );
}

export function homeScreen({ scope }) {
  let filter = 'all';
  let search = '';
  let recent = null;          // null = loading
  let recentError = '';
  let aliasUnread = new Map();

  // ---- identities ----
  const listRegion = h('div', { class: 'sheet id-sheet' });
  const paintList = () => {
    const state = store.get();
    if (state.mailboxes === null || state.aliases === null || state.numbers === null) { replace(listRegion, skeletonRows(5)); return; }
    const all = identityItems(state, aliasUnread);
    if (all.length === 0) {
      replace(listRegion, emptyState({
        title: 'No addresses or numbers yet',
        text: 'Make an inbox first. Then add an alias for each place that asks for your email.',
        action: button('Make inbox', { kind: 'primary', iconName: 'plus', onClick: () => openNewInbox() }),
      }));
      return;
    }
    const shown = all.filter((it) => {
      if (filter === 'email' && it.kind === 'number') return false;
      if (filter === 'numbers' && it.kind !== 'number') return false;
      if (filter === 'off' && !it.off) return false;
      return matchesSearch(it, search);
    });
    if (shown.length === 0) {
      replace(listRegion, emptyState({
        title: search ? 'Nothing matches your search' : filter === 'off' ? 'Nothing is turned off' : filter === 'numbers' ? 'No numbers yet' : 'Nothing here',
        text: search ? 'Check the spelling, or clear the search.' : filter === 'numbers' ? 'Get a number for texts and calls.' : '',
        compact: true, figure: false,
        action: search ? button('Clear search', { onClick: () => { searchInput.value = ''; search = ''; paintList(); searchInput.focus(); } })
          : filter === 'numbers' && state.config.features.phone ? button('Get a number', { onClick: () => openGetNumber() }) : null,
      }));
      return;
    }
    replace(listRegion, identityList(shown));
  };
  scope.add(store.subscribe(['mailboxes', 'aliases', 'numbers', 'phones'], paintList));

  const searchInput = h('input', { class: 'input search-input', type: 'search', placeholder: 'Search addresses, numbers and labels', 'aria-label': 'Search addresses, numbers and labels', autocomplete: 'off', spellcheck: 'false' });
  searchInput.addEventListener('input', debounce(() => { search = searchInput.value; paintList(); }, 80));
  const chipOptions = [{ value: 'all', label: 'All' }, { value: 'email', label: 'Email' }];
  if (store.get('config').features.phone) chipOptions.push({ value: 'numbers', label: 'Numbers' });
  chipOptions.push({ value: 'off', label: 'Off' });
  const filterChips = chips({ label: 'Show', value: filter, options: chipOptions, onChange: (v) => { filter = v; paintList(); } });

  // ---- recent ----
  const recentRegion = h('div', { class: 'sheet recent-sheet' });
  const paintRecent = () => {
    if (recent === null && !recentError) { replace(recentRegion, skeletonRows(4, { tall: true })); return; }
    if (recentError && (!recent || !recent.length)) { replace(recentRegion, h('p', { class: 'recent-empty muted small' }, recentError)); return; }
    if (!recent.length) { replace(recentRegion, h('p', { class: 'recent-empty muted small' }, 'Nothing yet. New mail and texts show here.')); return; }
    replace(recentRegion, h('ul', { class: 'recent-list' }, recent.map((r) => h('li', null,
      h('a', { class: `recent-item ${r.unread ? 'is-unread' : ''}`.trim(), href: r.href, 'data-link': true },
        h('span', { class: 'recent-icon' }, icon(r.kind === 'mail' ? 'mail' : 'message', { size: 18, label: r.kind === 'mail' ? 'Email' : 'Text' })),
        h('span', { class: 'recent-body' },
          h('span', { class: 'recent-top' },
            h('span', { class: 'recent-from truncate' }, r.from, r.unread ? h('span', { class: 'sr-only' }, ' (unread)') : null),
            h('time', { class: 'recent-time', datetime: new Date(r.at * 1000).toISOString() }, shortTime(r.at)),
          ),
          h('span', { class: 'recent-text truncate' }, r.text),
          h('span', { class: 'recent-to mono truncate' }, r.to),
        ),
      ),
    ))));
  };

  let loadingRecent = false;
  let again = false;
  const loadRecent = async () => {
    if (loadingRecent) { again = true; return; }
    loadingRecent = true;
    try {
      const state = store.get();
      if (state.mailboxes === null || state.numbers === null) return;
      const items = [];
      const unread = new Map();
      const jobs = [];
      if (state.mailboxes.length) {
        jobs.push(listMessages({ direction: 'in', limit: 60 }).then(({ messages }) => {
          for (const m of messages) {
            if (!m.seen && m.addressId) unread.set(m.addressId, (unread.get(m.addressId) || 0) + 1);
            items.push({ kind: 'mail', at: m.at, unread: !m.seen, from: personShort(m.meta.from) || 'Unknown sender', text: m.meta.subject || '(no subject)', to: m.meta.deliveredTo || mailboxName(findMailbox(m.mailboxId)), href: `/mail/${m.mailboxId}/${m.id}` });
          }
        }));
      }
      for (const n of state.numbers.slice(0, 8)) {
        jobs.push(listTexts(n.id, { limit: 6 }).then(({ texts }) => {
          for (const t of texts) {
            if (t.direction !== 'in') continue;
            items.push({ kind: 'text', at: t.at, unread: !t.seen, from: phoneText(t.peer) || 'Unknown number', text: t.body, to: phoneText(n.number), href: `/numbers/${n.id}` });
          }
        }));
      }
      const results = await Promise.allSettled(jobs);
      if (scope.disposed) return;
      const failed = results.find((r) => r.status === 'rejected');
      recentError = failed && !items.length ? 'Recent activity did not load.' : '';
      items.sort((a, b) => b.at - a.at);
      recent = items.slice(0, 8);
      aliasUnread = unread;
      paintRecent();
      paintList();
    } finally {
      loadingRecent = false;
      if (again && !scope.disposed) { again = false; loadRecent(); }
    }
  };
  const reloadRecent = debounce(loadRecent, 120);
  scope.add(bus.on('mail', reloadRecent));
  scope.add(bus.on('text', reloadRecent));
  // The first load waits for the inbox and number lists.
  let started = false;
  const maybeStart = () => {
    const s = store.get();
    if (s.mailboxes !== null && s.numbers !== null) { if (!started) { started = true; loadRecent(); } else reloadRecent(); }
  };
  scope.add(store.subscribe(['mailboxes', 'numbers'], maybeStart));

  const el = h('div', { class: 'page' },
    pageHeader({ title: 'Home', actions: button('New', { kind: 'primary', iconName: 'plus', onClick: () => openNewChooser() }) }),
    region(scope, store, ['mailboxes', 'aliases', 'numbers', 'balance', 'prefs'], checklist),
    region(scope, store, ['mailboxes', 'aliases', 'numbers', 'balance'], stats),
    h('div', { class: 'home-grid' },
      h('section', { class: 'home-ids', 'aria-labelledby': 'ids-title' },
        h('div', { class: 'section-head' }, h('h2', { class: 'section-title', id: 'ids-title' }, 'Addresses and numbers')),
        h('div', { class: 'id-tools' },
          h('div', { class: 'search-wrap' }, icon('search', { size: 16, cls: 'search-icon' }), searchInput),
          filterChips,
        ),
        listRegion,
      ),
      h('section', { class: 'home-recent', 'aria-labelledby': 'recent-title' },
        h('div', { class: 'section-head' }, h('h2', { class: 'section-title', id: 'recent-title' }, 'Recent')),
        recentRegion,
      ),
    ),
  );
  paintList();
  paintRecent();
  maybeStart();
  return el;
}
