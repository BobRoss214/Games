// "My stats" and "Who leaked me": two screens that count in the browser, and two links to them on Home.
//
// The screens are a normal import here, not files that load on first use. So a visit to a screen asks
// the server only for the mail list, as the Mail screen does. The server gets no other sign of what a
// person looks at, and it keeps no stats.
// The counting is in ./insights/work.js. The shared loader and its progress part are in ./insights/report.js.
import { h, region } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { registerRoute, registerHomeSection } from '../lib/registry.js';
import { linkButton } from '../ui/components.js';
import { statsScreen } from './insights/stats.js';
import { leaksScreen } from './insights/leaks.js';

registerRoute('/stats', () => statsScreen, { title: 'My stats', nav: 'home' });
registerRoute('/leaks', () => leaksScreen, { title: 'Who leaked me', nav: 'home' });

// Home, at the end: two plain links. The number of aliases with a hint comes from what the app has in
// memory already (store "leaks", filled by the watch of the alias rows). Home reads no mail for it.
function links(state) {
  if (!state.mailboxes || !state.mailboxes.length) return null; // no inbox: no mail to count
  const ids = new Set((state.aliases || []).map((a) => a.id));
  const n = Object.keys(state.leaks || {}).filter((id) => ids.has(id)).length;
  return h('nav', { class: 'row row-wrap', 'aria-label': 'Stats and leaks' },
    linkButton('My stats', '/stats'),
    h('a', { class: 'btn', href: '/leaks', 'data-link': true },
      h('span', { class: 'btn-label' }, 'Who leaked me'),
      n ? h('span', { class: 'badge', dataset: { leaks: String(n) } }, String(n), h('span', { class: 'sr-only' }, n === 1 ? ' alias possibly leaked' : ' aliases possibly leaked')) : null,
    ),
  );
}

registerHomeSection({ id: 'insights', order: 40, render: ({ scope }) => region(scope, store, ['mailboxes', 'aliases', 'leaks'], links) });
