// Aliases: make one fast, turn it off, move it, delete it.
import { h, replace, debounce } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { icon } from '../ui/icons.js';
import { button, chips, emptyState, skeletonRows, pageHeader } from '../ui/components.js';
import { identityItems, identityList, matchesSearch } from '../ui/rows.js';
import { openNewAlias, openNewInbox } from '../ui/identities.js';

export function aliasesScreen({ scope }) {
  let filter = 'all';
  let search = '';
  let box = 'all';

  const listRegion = h('div', { class: 'sheet id-sheet' });
  const tools = h('div', { class: 'id-tools' });
  const searchInput = h('input', { class: 'input search-input', type: 'search', placeholder: 'Search aliases and labels', 'aria-label': 'Search aliases and labels', autocomplete: 'off', spellcheck: 'false' });
  searchInput.addEventListener('input', debounce(() => { search = searchInput.value; paint(); }, 80));

  let toolsKey = '';
  function paintTools(state) {
    const boxes = state.mailboxes || [];
    const aliases = state.aliases || [];
    const key = `${boxes.map((m) => m.id + m.label).join('|')}:${aliases.length}:${aliases.filter((a) => !a.enabled).length}`;
    if (key === toolsKey) return;
    toolsKey = key;
    if (box !== 'all' && !boxes.some((m) => m.id === box)) box = 'all';
    const boxSelect = boxes.length > 1 ? h('div', { class: 'select-wrap id-box-filter' },
      h('select', { class: 'input select', 'aria-label': 'Show aliases of', onChange: (e) => { box = e.target.value; paint(); } },
        h('option', { value: 'all', selected: box === 'all' }, 'All inboxes'),
        boxes.map((m) => h('option', { value: m.id, selected: box === m.id }, m.label || m.address))),
      icon('chevronDown', { size: 16, cls: 'select-caret' }),
    ) : null;
    replace(tools,
      h('div', { class: 'search-wrap' }, icon('search', { size: 16, cls: 'search-icon' }), searchInput),
      boxSelect,
      chips({ label: 'Show', value: filter, options: [
        { value: 'all', label: 'All', count: aliases.length },
        { value: 'on', label: 'On', count: aliases.filter((a) => a.enabled).length },
        { value: 'off', label: 'Off', count: aliases.filter((a) => !a.enabled).length },
      ], onChange: (v) => { filter = v; paint(); } }),
    );
  }

  const newButton = button('New alias', { kind: 'primary', iconName: 'plus', onClick: () => openNewAlias({ mailboxId: box !== 'all' ? box : '' }) });

  function paint() {
    const state = store.get();
    // The empty states have their own button. Two buttons for one action would be noise.
    newButton.hidden = !state.aliases || state.aliases.length === 0;
    if (state.mailboxes === null || state.aliases === null) { tools.hidden = true; replace(listRegion, skeletonRows(5)); return; }
    if (state.mailboxes.length === 0) {
      tools.hidden = true;
      replace(listRegion, emptyState({
        title: 'Make an inbox first',
        text: 'An alias delivers mail to an inbox. You have no inbox yet.',
        action: button('Make inbox', { kind: 'primary', iconName: 'plus', onClick: () => openNewInbox() }),
      }));
      return;
    }
    if (state.aliases.length === 0) {
      tools.hidden = true;
      replace(listRegion, emptyState({
        title: 'No aliases yet',
        text: 'Give each shop, site or newsletter its own address. When one gets spam, turn it off.',
        action: button('Make alias', { kind: 'primary', iconName: 'plus', onClick: () => openNewAlias() }),
      }));
      return;
    }
    tools.hidden = false;
    paintTools(state);
    const items = identityItems(state).filter((it) => it.kind === 'alias')
      .filter((it) => (filter === 'on' ? it.enabled : filter === 'off' ? !it.enabled : true))
      .filter((it) => box === 'all' || it.mailboxId === box)
      .filter((it) => matchesSearch(it, search))
      .reverse(); // newest first
    if (items.length === 0) {
      replace(listRegion, emptyState({
        title: search ? 'Nothing matches your search' : filter === 'off' ? 'No alias is turned off' : 'No aliases here',
        text: search ? 'Check the spelling, or clear the search.' : '',
        compact: true, figure: false,
        action: search ? button('Clear search', { onClick: () => { searchInput.value = ''; search = ''; paint(); searchInput.focus(); } }) : null,
      }));
      return;
    }
    replace(listRegion, identityList(items, { showReceived: true }));
  }

  scope.add(store.subscribe(['mailboxes', 'aliases'], paint));
  const el = h('div', { class: 'page' },
    pageHeader({
      title: 'Aliases',
      lede: 'An alias is an extra address. Mail to it lands in your inbox. Turn it off when you get spam.',
      actions: newButton,
    }),
    tools,
    listRegion,
  );
  paint();
  return el;
}
