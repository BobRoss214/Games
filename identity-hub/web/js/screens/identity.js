// One identity: a named group of aliases and numbers.
// Shows its addresses and numbers, one feed with all their mail, texts and calls,
// its random identifiers, and a clear warning when something inside forwards to a real phone.
import { h, replace, debounce } from '../lib/dom.js';
import { store, bus } from '../lib/store.js';
import { navigate } from '../lib/router.js';
import { shortTime, phoneText, plural, duration } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { button, field, emptyState, skeletonRows, callout, runBusy, loadError } from '../ui/components.js';
import { menuButton } from '../ui/menu.js';
import { toast } from '../ui/toast.js';
import { rowItems, itemRows } from '../ui/rows.js';
import { personaCard } from '../ui/persona.js';
import { openAddExisting, confirmDeleteIdentity } from '../ui/identity.js';
import { openNewAlias, openGetNumber } from '../ui/items.js';
import { findIdentity, membersOf, forwardingOf, updateIdentity, setIdentityExtra, identityItem, identityState, colourOf, eventsOf, addIdentityEvent, NAME_MAX, NOTE_MAX } from '../lib/identities.js';
import { doorMark, colourDot, stateWord, colourPicker, historyList } from '../ui/identitylook.js';
import { registered } from '../lib/registry.js';
import { phoneName, mailboxName, findMailbox } from '../lib/data.js';
import { listMessages, personShort } from '../lib/mail.js';
import { listTexts, listCalls, setNumberOpen } from '../lib/phone.js';
import { codeChip } from '../ui/code.js';
import { findCode } from '../lib/codes.js';
import { why } from '../ui/why.js';

const PAGE = 20;
const CALL_TEXT = { in: { answered: 'Incoming call', missed: 'Missed call', failed: 'Failed call' }, out: { answered: 'Outgoing call', missed: 'No answer', failed: 'Failed call' } };

// ---- the feed: mail of the aliases + texts and calls of the numbers, newest first ----
// Each source loads its own pages. The feed shows items only down to the oldest point
// that every source has loaded, so that nothing is shown out of order.
function makeSources(aliases, numbers) {
  const sources = [];
  const ids = aliases.map((a) => a.id);
  // The server takes 50 address ids in one request. A list is never sent empty.
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50);
    sources.push({
      items: [], more: true,
      async next() {
        const last = this.items[this.items.length - 1];
        const res = await listMessages({ addressIds: part, limit: PAGE, before: last ? last.at : undefined, beforeId: last ? last.id : undefined });
        for (const m of res.messages) {
          const out = m.direction === 'out';
          this.items.push({
            key: `m:${m.id}`, id: m.id, type: 'mail', at: m.at, unread: !out && !m.seen,
            who: out ? `To ${(m.meta.to || []).map(personShort).filter(Boolean).join(', ') || 'nobody'}` : (personShort(m.meta.from) || 'Unknown sender'),
            text: m.broken ? 'This message cannot be opened' : (m.meta.subject || '(no subject)'),
            via: out ? `from ${m.meta.from.address || ''}` : (m.meta.deliveredTo || mailboxName(findMailbox(m.mailboxId))),
            label: out ? 'Sent email' : 'Email',
            code: out || m.broken ? null : findCode(m.meta.snippet, { subject: m.meta.subject }),
            open: () => navigate(`/mail/${m.mailboxId}/${m.id}`),
          });
        }
        this.more = res.more;
      },
    });
  }
  for (const n of numbers) {
    sources.push({
      items: [], more: true,
      async next() {
        const last = this.items[this.items.length - 1];
        const res = await listTexts(n.id, { limit: PAGE, before: last ? last.at : undefined });
        for (const t of res.texts) {
          const out = t.direction === 'out';
          this.items.push({
            key: `t:${t.id}`, id: t.id, type: 'text', at: t.at, unread: !out && !t.seen,
            who: `${out ? 'To ' : ''}${phoneText(t.peer) || 'Unknown number'}`, text: t.broken ? 'This text cannot be opened' : t.body,
            via: `${out ? 'from ' : ''}${phoneText(n.number)}`, label: out ? 'Sent text' : 'Text',
            code: out || t.broken ? null : findCode(t.body),
            open: () => { setNumberOpen({ numberId: n.id, peer: t.peer }); navigate(`/numbers/${n.id}`); },
          });
        }
        this.more = res.more;
      },
    });
    sources.push({
      items: [], more: true,
      async next() {
        const last = this.items[this.items.length - 1];
        const res = await listCalls(n.id, { limit: PAGE, before: last ? last.at : undefined });
        for (const c of res.calls) {
          const words = (CALL_TEXT[c.direction] || CALL_TEXT.in)[c.status] || 'Call';
          this.items.push({
            key: `c:${c.id}`, id: c.id, type: 'call', at: c.at, unread: false, missed: c.status !== 'answered',
            who: phoneText(c.peer) || 'Unknown number', text: c.status === 'answered' ? `${words}, ${duration(c.seconds)}` : words,
            via: phoneText(n.number), label: 'Call',
            open: () => { setNumberOpen({ numberId: n.id, tab: 'calls' }); navigate(`/numbers/${n.id}`); },
          });
        }
        this.more = res.more;
      },
    });
  }
  return sources;
}

function mergeFeed(sources) {
  const waiting = sources.filter((s) => s.more);
  // Oldest time that every unfinished source has reached.
  const horizon = waiting.length ? Math.max(...waiting.map((s) => (s.items.length ? s.items[s.items.length - 1].at : Infinity))) : -Infinity;
  const seen = new Set();
  const items = [];
  for (const s of sources) for (const it of s.items) if (it.at >= horizon && !seen.has(it.key)) { seen.add(it.key); items.push(it); }
  items.sort((a, b) => b.at - a.at);
  return { items, more: waiting.length > 0 };
}

export function identityScreen({ params, scope }) {
  const id = params.id;
  const root = h('div', { class: 'page' });
  const headSlot = h('header', { class: 'page-head' });
  const warnSlot = h('div', { class: 'identity-warn' });
  const membersSlot = h('div', { class: 'sheet item-sheet' });
  const feedSlot = h('div', { class: 'sheet feed-sheet' });
  const sideSlot = h('aside', { class: 'identity-side' });
  const colourSlot = h('div', null);
  const historySlot = h('div', null);
  let built = false;
  let editing = false;
  let personaEl = null;
  let memberKey = null;   // which items are inside, to see changes
  let sources = [];
  let feedState = 'loading'; // loading | ready | error
  let feedError = '';
  let feedToken = 0;

  // ---- header: name and note, edit in place ----
  function paintHead() {
    const g = findIdentity(id);
    if (!g) return;
    const m = membersOf(id);
    const back = h('a', { class: 'back-link', href: '/', 'data-link': true }, icon('chevronLeft', { size: 16 }), 'Home');
    if (editing) {
      const name = field({ label: 'Name', value: g.name, maxlength: NAME_MAX, hint: 'Only you see this. It is encrypted.' });
      const note = field({ label: 'What it is for', optional: true, value: g.note, rows: 2, maxlength: NOTE_MAX });
      const save = button('Save', { kind: 'primary', type: 'submit' });
      replace(headSlot, back,
        h('h1', { class: 'sr-only' }, `Edit the identity ${g.name}`),
        h('form', { class: 'stack identity-edit', novalidate: true, onSubmit: (e) => {
          e.preventDefault();
          const v = name.value.trim();
          if (!v) { name.setError('Give the identity a name.'); return; }
          runBusy(save, async () => {
            await updateIdentity(id, { name: v, note: note.value });
            editing = false;
            toast('Saved', { kind: 'ok', timeout: 2000 });
            paintHead();
          });
        } },
          name.el, note.el,
          h('div', { class: 'row row-2' }, save, button('Cancel', { onClick: () => { editing = false; paintHead(); headSlot.querySelector('.identity-edit-btn')?.focus(); } })),
        ),
      );
      name.input.focus();
      return;
    }
    const door = identityState(g, m);
    // Marks and menu entries of feature files (registerRowBadge, registerRowAction with the kind 'identity').
    const item = identityItem(g);
    const marks = registered.rowBadges('identity', item);
    const actions = registered.rowActions('identity', item);
    replace(headSlot, back,
      h('div', { class: 'page-head-row' },
        h('div', { class: 'grow' },
          h('div', { class: 'identity-title' }, doorMark(door, { size: 28 }), colourDot(g), h('h1', { class: 'page-title break', tabIndex: -1 }, g.name)),
          g.note ? h('p', { class: 'page-lede identity-note' }, g.note) : null,
          h('p', { class: 'identity-count small muted' }, stateWord(door), h('span', null, `${plural(m.aliases.length, 'address', 'addresses')}, ${plural(m.numbers.length, 'number')}`), marks),
        ),
        h('div', { class: 'page-actions' },
          button('Edit name and note', { iconName: 'edit', onClick: () => { editing = true; paintHead(); }, attrs: { class: 'btn identity-edit-btn' } }),
          actions.length ? menuButton({ label: `More actions for ${g.name}`, text: 'More', items: () => registered.rowActions('identity', identityItem(findIdentity(id) || g)).map((a) => ({ label: a.label, icon: a.icon, danger: a.danger, onSelect: () => a.run(identityItem(findIdentity(id) || g)) })) }) : null,
        ),
      ),
    );
  }

  // ---- warning: something inside forwards to a real phone ----
  function paintWarn() {
    const state = store.get();
    const m = membersOf(id, state);
    const forwards = forwardingOf(m.numbers, state);
    if (!forwards.length) { replace(warnSlot); return; }
    replace(warnSlot, forwards.map((f) => {
      const what = f.texts && f.calls ? 'texts and calls' : f.texts ? 'texts' : 'calls';
      const from = m.numbers.filter((n) => n.forwardPhoneId === f.phone.id && (n.forwardTexts || n.forwardCalls));
      return callout('warn', 'Forwards to your real phone',
        h('p', { class: 'identity-warn-text' }, `This identity forwards to your real phone “${phoneName(f.phone)}”: ${what}.`),
        h('p', null, 'The phone company of that phone can see these texts and calls. Change it in the settings of the number: ',
          from.map((n, i) => [i ? ', ' : '', h('a', { href: `/numbers/${n.id}`, 'data-link': true, class: 'mono', onClick: () => setNumberOpen({ numberId: n.id, tab: 'settings' }) }, phoneText(n.number))]), '.'),
      );
    }));
  }

  // ---- addresses and numbers ----
  function paintMembers() {
    const state = store.get();
    const items = rowItems(state).filter((it) => it.identityId === id && it.kind !== 'inbox');
    if (!items.length) {
      replace(membersSlot, emptyState({
        title: 'Nothing in this identity yet', compact: true,
        text: 'Add the aliases and numbers that you use for it.',
        action: addMenu('primary'),
      }));
      return;
    }
    replace(membersSlot, itemRows(items, { showIdentity: false, showReceived: true }));
  }
  function addMenu(kind = '') {
    const g = findIdentity(id);
    const phoneOn = !!store.get('config').features.phone;
    return menuButton({ label: 'Add to this identity', text: 'Add', iconName: 'plus', cls: kind ? `btn-${kind}` : 'btn-sm', items: () => [
      { label: 'Aliases and numbers I have', icon: 'folder', onSelect: () => openAddExisting(g) },
      { label: 'New alias', icon: 'alias', onSelect: () => openNewAlias({ identityId: id }) },
      phoneOn ? { label: 'Get a number', icon: 'phone', onSelect: () => openGetNumber({ identityId: id }) } : null,
    ] });
  }

  // ---- feed ----
  function paintFeed() {
    if (sources.length === 0) { replace(feedSlot, h('p', { class: 'feed-empty small muted' }, 'Mail and texts of this identity show here when it has an alias or a number.')); return; }
    if (feedState === 'loading') { replace(feedSlot, skeletonRows(4, { tall: true })); return; }
    const { items, more } = mergeFeed(sources);
    if (feedState === 'error' && !items.length) { replace(feedSlot, loadError(feedError, () => loadFeed())); return; }
    if (!items.length && !more) { replace(feedSlot, h('p', { class: 'feed-empty small muted' }, 'No mail and no texts yet. They show here when they arrive.')); return; }
    replace(feedSlot,
      h('ul', { class: 'feed-list' }, items.map((it) => h('li', null,
        h('button', { class: `feed-item ${it.unread ? 'is-unread' : ''} ${it.missed ? 'is-missed' : ''}`.trim(), type: 'button', dataset: { type: it.type }, onClick: it.open },
          h('span', { class: 'recent-icon' }, icon(it.type === 'mail' ? 'mail' : it.type === 'text' ? 'message' : 'phone', { size: 18, label: it.label })),
          h('span', { class: 'recent-body' },
            h('span', { class: 'recent-top' },
              h('span', { class: 'recent-from truncate' }, it.who, it.unread ? h('span', { class: 'sr-only' }, ' (unread)') : null),
              h('time', { class: 'recent-time', datetime: new Date(it.at * 1000).toISOString() }, shortTime(it.at)),
            ),
            h('span', { class: 'recent-text truncate' }, it.text),
            h('span', { class: 'recent-to mono truncate' }, it.via),
          ),
        ),
        it.code ? h('div', { class: 'recent-code' }, codeChip(it.code)) : null,
      ))),
      more ? h('div', { class: 'list-more' }, button('Show more', { size: 'sm', onClick: (e, btn) => runBusy(btn, loadMoreFeed) })) : null,
    );
  }
  async function loadFeed() {
    const token = ++feedToken;
    const state = store.get();
    const m = membersOf(id, state);
    const fresh = makeSources(m.aliases, m.numbers);
    if (!sources.length) { feedState = fresh.length ? 'loading' : 'ready'; sources = fresh; paintFeed(); }
    const results = await Promise.allSettled(fresh.map((s) => s.next()));
    if (scope.disposed || token !== feedToken) return;
    const failed = results.find((r) => r.status === 'rejected');
    // A source that failed must not hold the others back.
    fresh.forEach((s, i) => { if (results[i].status === 'rejected') s.more = false; });
    sources = fresh;
    feedState = failed && fresh.every((s) => !s.items.length) ? 'error' : 'ready';
    feedError = failed ? (failed.reason && failed.reason.message) || 'The feed did not load.' : '';
    paintFeed();
    const g = findIdentity(id);
    if (g) noteHistory(g, membersOf(id));
  }
  async function loadMoreFeed() {
    const token = feedToken;
    const waiting = sources.filter((s) => s.more);
    const results = await Promise.allSettled(waiting.map((s) => s.next()));
    if (scope.disposed || token !== feedToken) return;
    waiting.forEach((s, i) => { if (results[i].status === 'rejected') s.more = false; });
    paintFeed();
  }
  const reloadFeed = debounce(() => { if (!scope.disposed) loadFeed(); }, 200);

  // ---- side: random identifiers, delete ----
  function paintSide() {
    const g = findIdentity(id);
    if (!g) return;
    if (!personaEl) {
      personaEl = personaCard({ persona: g.persona, headingLevel: 'h2', onSave: (next) => updateIdentity(id, { persona: next }), username: g.extra.username, onSaveUsername: (next) => setIdentityExtra(id, { username: next }) });
      replace(sideSlot,
        h('div', { class: 'sheet sheet-pad' }, personaEl),
        h('section', { class: 'sheet sheet-pad stack stack-3', 'aria-labelledby': 'colour-title' },
          h('div', null, h('h2', { class: 'section-title', id: 'colour-title' }, 'Colour'), h('p', { class: 'section-lede' }, 'A dot next to the name, to spot this identity fast.')),
          colourSlot,
          why('identity-look', { text: 'What do the door and the dot mean?' }),
        ),
        h('section', { class: 'sheet sheet-pad stack stack-3', 'aria-labelledby': 'history-title' },
          h('h2', { class: 'section-title', id: 'history-title' }, 'History'),
          historySlot,
        ),
        h('section', { class: 'danger-zone stack stack-3 identity-delete' },
          h('h2', { class: 'section-title' }, 'Delete this identity'),
          h('p', { class: 'muted small' }, 'Its aliases and numbers stay. They are then not in an identity.'),
          h('div', null, button('Delete identity', { kind: 'danger', iconName: 'trash', onClick: async () => {
            const now = findIdentity(id);
            if (now && await confirmDeleteIdentity(now)) navigate('/', { replace: true });
          } })),
        ),
      );
    } else { personaEl.setPersona(g.persona); personaEl.setUsername(g.extra.username); }
    // The colour choice is made again only when the saved colour is not the one it shows,
    // so that the focus stays in it while the person moves through the colours.
    const shown = colourSlot.firstElementChild;
    if (!shown || shown.dataset.colour !== colourOf(g)) {
      const hadFocus = colourSlot.contains(document.activeElement);
      replace(colourSlot, colourPicker(g, 'colour-title'));
      if (hadFocus) colourSlot.querySelector('input:checked')?.focus();
    }
    replace(historySlot, historyList(g));
  }

  // ---- history: the events that this screen can see ----
  let allOff = null;        // every alias of the identity is off (null = not looked yet)
  let askedFirstMail = false;
  function noteHistory(g, m) {
    const nowOff = m.aliases.length > 0 && m.aliases.every((a) => !a.enabled);
    if (allOff !== null && nowOff !== allOff) addIdentityEvent(id, nowOff ? 'turned-off' : 'turned-on').catch(() => {});
    allOff = nowOff;
    if (!askedFirstMail && !eventsOf(g).some((e) => e.type === 'first-mail')) {
      const mails = sources.flatMap((src) => src.items).filter((it) => it.type === 'mail');
      if (mails.length) {
        askedFirstMail = true;
        const oldest = Math.min(...mails.map((it) => it.at));
        addIdentityEvent(id, 'first-mail', new Date(oldest * 1000).toISOString().slice(0, 10)).catch(() => {});
      }
    }
  }

  function build() {
    built = true;
    replace(root,
      headSlot,
      warnSlot,
      h('div', { class: 'identity-grid' },
        h('div', { class: 'identity-main' },
          h('section', { 'aria-labelledby': 'members-title' },
            h('div', { class: 'section-head' }, h('h2', { class: 'section-title', id: 'members-title' }, 'Addresses and numbers'), addMenu()),
            membersSlot,
          ),
          h('section', { class: 'section', 'aria-labelledby': 'feed-title' },
            h('div', { class: 'section-head' }, h('div', { class: 'grow' }, h('h2', { class: 'section-title', id: 'feed-title' }, 'Mail and texts'), h('p', { class: 'section-lede' }, 'Everything that came to, or went out from, the addresses and numbers of this identity. Newest first.'))),
            feedSlot,
          ),
        ),
        sideSlot,
      ),
    );
  }

  function sync() {
    const state = store.get();
    if (state.identities === null || state.aliases === null || state.numbers === null) {
      if (!built) replace(root, h('header', { class: 'page-head' }, h('h1', { class: 'page-title' }, 'Identity')), skeletonRows(4));
      return;
    }
    const g = findIdentity(id);
    if (!g) {
      built = false; personaEl = null;
      replace(root, h('header', { class: 'page-head' }, h('a', { class: 'back-link', href: '/', 'data-link': true }, icon('chevronLeft', { size: 16 }), 'Home'), h('h1', { class: 'page-title' }, 'Identity')),
        h('div', { class: 'sheet' }, emptyState({ title: 'This identity does not exist', text: 'It may be deleted.', action: h('a', { class: 'btn', href: '/', 'data-link': true }, 'Back to Home') })));
      return;
    }
    if (!built) build();
    if (!editing) paintHead();
    paintWarn();
    paintMembers();
    paintSide();
    const m = membersOf(id, state);
    noteHistory(g, m);
    const key = `${m.aliases.map((a) => a.id).join(',')}|${m.numbers.map((n) => n.id).join(',')}`;
    if (key !== memberKey) { memberKey = key; sources = []; feedToken++; loadFeed(); }
  }

  scope.add(store.subscribe(['identities', 'aliases', 'numbers', 'phones', 'mailboxes', 'leaks'], sync));
  scope.add(bus.on('mail', reloadFeed));
  scope.add(bus.on('text', reloadFeed));
  scope.add(bus.on('call', reloadFeed));
  sync();
  return root;
}
