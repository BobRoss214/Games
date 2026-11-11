// Home: the one dashboard. Counts, identities (named groups) first, then the aliases and
// numbers that are in no identity, then inboxes. Recent mail and texts on the side.
import { h, region, replace, debounce } from '../lib/dom.js';
import { store, bus } from '../lib/store.js';
import { money, shortTime, phoneText, plural } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { button, chips, emptyState, skeletonRows, pageHeader, copyButton } from '../ui/components.js';
import { rowItems, itemRows, matchesSearch } from '../ui/rows.js';
import { openNewChooser, openNewAlias, openNewInbox, openGetNumber } from '../ui/items.js';
import { openNewIdentity } from '../ui/identity.js';
import { forwardingOf, identityItem } from '../lib/identities.js';
import { fullName } from '../lib/persona/index.js';
import { listMessages, personShort } from '../lib/mail.js';
import { listTexts } from '../lib/phone.js';
import { mailboxName, findMailbox } from '../lib/data.js';
import { registered, renderSafe, mergeByOrder } from '../lib/registry.js';
import { why, whyParts, whyGroup } from '../ui/why.js';
import { codeChip } from '../ui/code.js';
import { findCode } from '../lib/codes.js';

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
  const groups = state.identities || [];
  const grouped = aliases.filter((a) => groups.some((g) => g.id === a.identityId)).length + numbers.filter((n) => groups.some((g) => g.id === n.identityId)).length;
  return h('div', { class: 'stats stats-5' },
    h('div', { class: 'stat' },
      h('span', { class: 'stat-label' }, 'Identities'),
      loading || state.identities === null ? h('span', { class: 'skeleton skeleton-block' }) : h('span', { class: 'stat-value mono' }, String(groups.length)),
      h('span', { class: 'stat-note' }, loading ? '\u00a0' : groups.length ? `${plural(grouped, 'item')} inside` : 'Named groups'),
    ),
    statTile({ label: 'Inboxes', value: String(boxes.length), note: unreadMail ? `${unreadMail} unread` : 'No unread mail', href: '/mail', loading }),
    statTile({ label: 'Aliases', value: String(aliases.length), note: off ? `${off} turned off` : 'All on', href: '/aliases', loading }),
    f.phone
      ? statTile({ label: 'Numbers', value: String(numbers.length), note: unreadTexts ? `${plural(unreadTexts, 'new text')}` : 'No new texts', href: '/numbers', loading })
      : h('div', { class: 'stat is-disabled' }, h('span', { class: 'stat-label' }, 'Numbers'), h('span', { class: 'stat-value mono' }, '–'), h('span', { class: 'stat-note' }, 'Turned off on this server')),
    statTile({ label: 'Balance', value: money(state.balance), note: 'US dollars of credit', href: '/funds', loading: false }),
  );
}

export function homeScreen({ scope }) {
  let filter = 'all';
  let search = '';
  let recent = null;          // null = loading
  let recentError = '';
  let aliasUnread = new Map();
  const phoneOn = !!store.get('config').features.phone;

  // ---- identities, then the rest ----
  const listRegion = h('div', { class: 'home-lists' });
  // One "Why?" for the section. It is made one time, so that it stays open when the list paints again.
  const whyIdentity = whyParts('identity', { text: 'Why?' });

  function identityCard(g, members, state) {
    const aliases = members.filter((m) => m.kind === 'alias');
    const numbers = members.filter((m) => m.kind === 'number');
    const unread = members.reduce((n, m) => n + (m.unread || 0), 0);
    const forwards = forwardingOf(numbers.map((m) => m.raw), state);
    const marks = registered.rowBadges('identity', identityItem(g));
    return h('li', null,
      h('a', { class: 'identity-card', href: `/identities/${g.id}`, 'data-link': true, dataset: { identity: g.id } },
        h('span', { class: 'identity-card-top' },
          icon('folder', { size: 18 }),
          h('span', { class: 'identity-card-name truncate' }, g.name),
          unread > 0 ? h('span', { class: 'badge', 'aria-label': `${unread} unread` }, unread > 99 ? '99+' : String(unread)) : null,
        ),
        g.note ? h('span', { class: 'identity-card-note' }, g.note) : null,
        h('span', { class: 'identity-card-count' }, members.length ? `${plural(aliases.length, 'address', 'addresses')}, ${plural(numbers.length, 'number')}` : 'Empty'),
        forwards.length || marks.length ? h('span', { class: 'identity-card-marks' },
          forwards.length ? h('span', { class: 'tag tag-warn identity-card-forward' }, icon('phone', { size: 12 }), 'Forwards to real phone') : null,
          marks,
        ) : null,
      ),
    );
  }

  const paintList = () => {
    const state = store.get();
    if (state.mailboxes === null || state.aliases === null || state.numbers === null || state.identities === null) { replace(listRegion, h('div', { class: 'sheet item-sheet' }, skeletonRows(5))); return; }
    const all = rowItems(state, aliasUnread);
    const groups = state.identities;
    if (all.length === 0 && groups.length === 0) {
      replace(listRegion, h('div', { class: 'sheet item-sheet' }, emptyState({
        title: phoneOn ? 'No addresses or numbers yet' : 'No addresses yet',
        text: 'Make an inbox first. Then add an alias for each place that asks for your email.',
        action: button('Make inbox', { kind: 'primary', iconName: 'plus', onClick: () => openNewInbox() }),
      })));
      return;
    }
    const kindOk = (it) => {
      if (filter === 'email' && it.kind === 'number') return false;
      if (filter === 'numbers' && it.kind !== 'number') return false;
      if (filter === 'off' && !it.off) return false;
      return true;
    };
    const needle = search.toLowerCase().trim();

    // Identities: shown when the group itself matches, or when something inside matches.
    const cards = [];
    for (const g of groups) {
      const members = all.filter((it) => it.identityId === g.id);
      const filtered = members.filter(kindOk);
      if (filter !== 'all' && filtered.length === 0) continue;
      const own = `${g.name} ${g.note} ${g.persona ? fullName(g.persona) : ''}`.toLowerCase();
      if (needle && !own.includes(needle) && !filtered.some((it) => matchesSearch(it, search))) continue;
      cards.push(identityCard(g, members, state));
    }
    const loose = all.filter((it) => it.kind !== 'inbox' && !it.identityId).filter(kindOk).filter((it) => matchesSearch(it, search));
    const boxes = all.filter((it) => it.kind === 'inbox').filter(kindOk).filter((it) => matchesSearch(it, search));

    if (cards.length === 0 && loose.length === 0 && boxes.length === 0) {
      replace(listRegion, h('div', { class: 'sheet item-sheet' }, emptyState({
        title: search ? 'Nothing matches your search' : filter === 'off' ? 'Nothing is turned off' : filter === 'numbers' ? 'No numbers yet' : 'Nothing here',
        text: search ? 'Check the spelling, or clear the search.' : filter === 'numbers' ? 'Get a number for texts and calls.' : '',
        compact: true, figure: false,
        action: search ? button('Clear search', { onClick: () => { searchInput.value = ''; search = ''; paintList(); searchInput.focus(); } })
          : filter === 'numbers' && phoneOn ? button('Get a number', { onClick: () => openGetNumber() }) : null,
      })));
      return;
    }

    const plain = filter === 'all' && !needle;
    replace(listRegion,
      (cards.length || plain) ? h('section', { class: 'home-section', 'aria-labelledby': 'identities-title' },
        h('div', { class: 'section-head' },
          h('div', { class: 'row row-2 grow' }, h('h2', { class: 'section-title', id: 'identities-title' }, 'Identities'), whyIdentity.button),
          button('New identity', { size: 'sm', iconName: 'plus', onClick: () => openNewIdentity() }),
        ),
        whyIdentity.panel,
        cards.length ? h('ul', { class: 'identity-cards' }, cards)
          : h('p', { class: 'identity-invite small muted' }, 'An identity is a named group, for example “Facebook”. Put the aliases and numbers that you use in one place in it, and see all their mail and texts together.'),
      ) : null,
      loose.length ? h('section', { class: 'home-section', 'aria-labelledby': 'loose-title' },
        h('div', { class: 'section-head' }, h('h2', { class: 'section-title', id: 'loose-title' }, 'Not in an identity')),
        h('div', { class: 'sheet item-sheet' }, itemRows(loose)),
      ) : null,
      boxes.length ? h('section', { class: 'home-section', 'aria-labelledby': 'boxes-title' },
        h('div', { class: 'section-head' }, h('h2', { class: 'section-title', id: 'boxes-title' }, 'Inboxes')),
        h('div', { class: 'sheet item-sheet' }, itemRows(boxes)),
      ) : null,
    );
  };
  scope.add(store.subscribe(['mailboxes', 'aliases', 'numbers', 'phones', 'identities', 'leaks'], paintList));

  const searchLabel = phoneOn ? 'Search identities, addresses, numbers and labels' : 'Search identities, addresses and labels';
  const searchInput = h('input', { class: 'input search-input', type: 'search', placeholder: 'Search', 'aria-label': searchLabel, title: searchLabel, autocomplete: 'off', spellcheck: 'false' });
  searchInput.addEventListener('input', debounce(() => { search = searchInput.value; paintList(); }, 80));
  const chipOptions = [{ value: 'all', label: 'All' }, { value: 'email', label: 'Email' }];
  if (phoneOn) chipOptions.push({ value: 'numbers', label: 'Numbers' });
  chipOptions.push({ value: 'off', label: 'Off' });
  const filterChips = chips({ label: 'Show', value: filter, options: chipOptions, onChange: (v) => { filter = v; paintList(); } });

  // ---- recent ----
  const recentRegion = h('div', { class: 'sheet recent-sheet' });
  const paintRecent = () => {
    if (recent === null && !recentError) { replace(recentRegion, skeletonRows(4, { tall: true })); return; }
    if (recentError && (!recent || !recent.length)) { replace(recentRegion, h('p', { class: 'recent-empty muted small' }, recentError)); return; }
    if (!recent.length) {
      const box = (store.get('mailboxes') || [])[0];
      replace(recentRegion, h('div', { class: 'recent-empty stack stack-3' },
        h('p', { class: 'muted small' }, box ? 'Nothing yet. New mail and texts show here. Give your address to someone to try it.' : 'Nothing yet. New mail and texts show here.'),
        h('div', null, box
          ? copyButton(() => box.address, 'Copy my address', { what: 'Address copied', withLabel: true, cls: 'btn-sm' })
          : button('Make inbox', { size: 'sm', onClick: () => openNewInbox() })),
      ));
      return;
    }
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
      // A sign-up code in the message: shown with a Copy button (found in the browser, sent nowhere).
      r.code ? h('div', { class: 'recent-code' }, codeChip(r.code)) : null,
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
            items.push({ kind: 'mail', at: m.at, unread: !m.seen, from: personShort(m.meta.from) || 'Unknown sender', text: m.meta.subject || '(no subject)', to: m.meta.deliveredTo || mailboxName(findMailbox(m.mailboxId)), href: `/mail/${m.mailboxId}/${m.id}`, code: m.broken ? null : findCode(m.meta.snippet, { subject: m.meta.subject }) });
          }
        }));
      }
      for (const n of state.numbers.slice(0, 8)) {
        jobs.push(listTexts(n.id, { limit: 6 }).then(({ texts }) => {
          for (const t of texts) {
            if (t.direction !== 'in') continue;
            items.push({ kind: 'text', at: t.at, unread: !t.seen, from: phoneText(t.peer) || 'Unknown number', text: t.body, to: phoneText(n.number), href: `/numbers/${n.id}`, code: t.broken ? null : findCode(t.body) });
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

  // The blocks of Home, with the blocks of feature files between them (registerHomeSection).
  const blocks = mergeByOrder(
    [
      { order: 20, make: () => region(scope, store, ['mailboxes', 'aliases', 'numbers', 'balance', 'identities'], stats) },
      { order: 30, make: () => h('div', { class: 'home-grid' },
        h('div', { class: 'home-items' },
          h('div', { class: 'item-tools' },
            h('div', { class: 'search-wrap' }, icon('search', { size: 16, cls: 'search-icon' }), searchInput),
            filterChips,
          ),
          listRegion,
        ),
        h('section', { class: 'home-recent', 'aria-labelledby': 'recent-title' },
          h('div', { class: 'section-head' }, h('h2', { class: 'section-title', id: 'recent-title' }, 'Recent')),
          recentRegion,
        ),
      ) },
    ],
    registered.homeSections().map((sec) => ({ order: sec.order, make: () => {
      const node = renderSafe(sec.render, { scope });
      return node ? h('div', { class: `home-slot ${sec.order < 20 ? 'is-top' : ''}`.trim(), dataset: { section: sec.id } }, node) : null;
    } })),
  );
  const el = h('div', { class: 'page' },
    pageHeader({ title: 'Home', actions: button('New', { kind: 'primary', iconName: 'plus', onClick: () => openNewChooser() }) }),
    blocks.map((b) => b.make()),
  );
  paintList();
  paintRecent();
  maybeStart();
  return el;
}
