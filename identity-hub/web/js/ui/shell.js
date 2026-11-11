// The frame around signed-in screens: sidebar (desktop), top bar and tab bar (phone),
// and the test-mode banner.
import { h, replace } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { money } from '../lib/format.js';
import { icon, logoMark } from './icons.js';
import { button } from './components.js';
import { confirmDialog } from './dialog.js';
import { signOut, lock } from '../lib/session.js';
import { navigate } from '../lib/router.js';

const NAV = [
  { id: 'home', label: 'Home', href: '/', icon: 'home' },
  { id: 'mail', label: 'Mail', href: '/mail', icon: 'mail' },
  { id: 'aliases', label: 'Aliases', href: '/aliases', icon: 'alias' },
  { id: 'numbers', label: 'Numbers', href: '/numbers', icon: 'phone', feature: 'phone' },
  { id: 'funds', label: 'Funds', href: '/funds', icon: 'funds' },
  { id: 'settings', label: 'Settings', href: '/settings', icon: 'settings' },
];

let shellEl = null;
let mainEl = null;
let unsub = [];
let hooks = { onTestTools: null, onSignedOut: null };

export function setShellHooks(h2) { hooks = { ...hooks, ...h2 }; }

export function brand(href = '/') {
  return h('a', { class: 'brand', href, 'data-link': true, 'aria-label': 'Postern, home' }, logoMark({ size: 30 }), h('span', { class: 'brand-name' }, 'Postern'));
}

function unreadFor(id, state) {
  if (id === 'mail') return (state.mailboxes || []).reduce((n, m) => n + (m.unread || 0), 0);
  if (id === 'numbers') return (state.numbers || []).reduce((n, m) => n + (m.unread || 0), 0);
  return 0;
}

export function isMockMode(config) {
  const f = (config && config.features) || {};
  return !!(f.mockPhone || f.mockPay || f.mockMail);
}

export function testBanner() {
  const config = store.get('config');
  if (!isMockMode(config)) return null;
  return h('div', { class: 'banner', role: 'note' },
    h('span', null, 'Test mode — simulated providers'),
    config.dev && hooks.onTestTools && store.get('phase') === 'in' ? h('button', { class: 'banner-btn', type: 'button', onClick: () => hooks.onTestTools() }, 'Test tools') : null,
  );
}

async function doSignOut() {
  const ok = await confirmDialog({
    title: 'Sign out?',
    message: 'This tab forgets your key. To sign in again you need a passkey or your recovery key.',
    confirmLabel: 'Sign out', danger: false,
  });
  if (!ok) return;
  await signOut();
  if (hooks.onSignedOut) hooks.onSignedOut();
  navigate('/', { replace: true });
}

function doLock() {
  lock();
  if (hooks.onLocked) hooks.onLocked();
  navigate(location.pathname, { replace: true });
}

function build() {
  const config = store.get('config') || { features: {} };
  const items = NAV.filter((n) => !n.feature || config.features[n.feature]);

  const navLinks = new Map();
  const tabLinks = new Map();
  const nav = h('nav', { class: 'nav', 'aria-label': 'Main' });
  for (const n of items) {
    const a = h('a', { class: 'nav-item', href: n.href, 'data-link': true }, icon(n.icon, { size: 20 }), h('span', { class: 'nav-label' }, n.label));
    navLinks.set(n.id, a);
    nav.appendChild(a);
  }
  const balanceValue = h('span', { class: 'side-balance-value mono' });
  const sidebar = h('aside', { class: 'sidebar' },
    brand(),
    nav,
    h('div', { class: 'sidebar-foot' },
      h('a', { class: 'side-balance', href: '/funds', 'data-link': true }, h('span', { class: 'side-balance-label' }, 'Balance'), balanceValue),
      h('div', { class: 'side-actions' },
        button('Lock', { iconName: 'lock', size: 'sm', onClick: doLock, attrs: { title: 'Forget the key in this tab. You stay signed in.' } }),
        button('Sign out', { iconName: 'signOut', size: 'sm', onClick: doSignOut }),
      ),
    ),
  );

  const topBalance = h('a', { class: 'topbar-balance mono', href: '/funds', 'data-link': true, 'aria-label': 'Balance' });
  const topbar = h('header', { class: 'topbar' },
    brand(),
    h('div', { class: 'topbar-actions' },
      topBalance,
      h('a', { class: 'icon-btn', href: '/settings', 'data-link': true, 'aria-label': 'Settings', dataset: { nav: 'settings' } }, icon('settings', { size: 20 })),
    ),
  );

  const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Main' });
  const tabItems = items.filter((n) => n.id !== 'settings');
  tabbar.style.gridTemplateColumns = `repeat(${tabItems.length}, 1fr)`;
  for (const n of tabItems) {
    const a = h('a', { class: 'tab-link', href: n.href, 'data-link': true }, icon(n.icon, { size: 22 }), h('span', null, n.label));
    tabLinks.set(n.id, a);
    tabbar.appendChild(a);
  }

  const bannerSlot = h('div', null, testBanner());
  mainEl = h('main', { class: 'main', id: 'main', tabIndex: -1 });
  const el = h('div', { class: 'shell' }, sidebar, h('div', { class: 'shell-main' }, bannerSlot, topbar, mainEl), tabbar);

  const paintCounts = (state) => {
    balanceValue.textContent = money(state.balance);
    topBalance.textContent = money(state.balance);
    for (const [id, a] of [...navLinks, ...tabLinks]) {
      a.querySelector('.badge')?.remove();
      const n = unreadFor(id, state);
      if (n > 0) a.appendChild(h('span', { class: 'badge', 'aria-label': `${n} unread` }, n > 99 ? '99+' : String(n)));
    }
  };
  paintCounts(store.get());
  unsub.push(store.subscribe(['balance', 'mailboxes', 'numbers'], paintCounts));
  unsub.push(store.subscribe(['config'], () => replace(bannerSlot, testBanner())));

  el.setActive = (id) => {
    for (const [nid, a] of [...navLinks, ...tabLinks]) {
      if (nid === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
    const gear = topbar.querySelector('[data-nav="settings"]');
    if (gear) { if (id === 'settings') gear.setAttribute('aria-current', 'page'); else gear.removeAttribute('aria-current'); }
  };
  return el;
}

// Puts a screen inside the shell. The shell is made one time and kept between screens.
export function showInShell(root, screenEl, navId) {
  if (!shellEl || !shellEl.isConnected) {
    destroyShell();
    shellEl = build();
    replace(root, shellEl);
  }
  replace(mainEl, screenEl);
  shellEl.setActive(navId);
}

export function destroyShell() {
  for (const u of unsub) u();
  unsub = [];
  shellEl = null;
  mainEl = null;
}

// Screens without the shell (welcome, sign-in, create account, unlock).
export function bareLayout(content, { head = null, foot = null, wide = false } = {}) {
  return h('div', { class: 'bare' },
    testBanner(),
    h('header', { class: 'bare-head' }, brand('/'), head),
    h('main', { class: 'bare-body', id: 'main', tabIndex: -1 }, h('div', { class: `bare-col ${wide ? 'bare-col-wide' : ''}`.trim() }, content)),
    foot ? h('footer', { class: 'bare-foot' }, foot) : null,
  );
}
