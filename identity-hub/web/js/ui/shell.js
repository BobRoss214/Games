// The frame around signed-in screens: sidebar (desktop), top bar and tab bar (phone),
// and the test-mode banner.
import { h, replace } from '../lib/dom.js';
import { store, appName } from '../lib/store.js';
import { money } from '../lib/format.js';
import { icon, logoMark } from './icons.js';
import { button, iconButton } from './components.js';
import { confirmDialog } from './dialog.js';
import { signOut, lock } from '../lib/session.js';
import { navigate } from '../lib/router.js';
import { registered } from '../lib/registry.js';
import { menuButton } from './menu.js';
import { whyParts } from './why.js';

const NAV = [
  { id: 'home', label: 'Home', href: '/', icon: 'home', order: 10 },
  { id: 'mail', label: 'Mail', href: '/mail', icon: 'mail', order: 20 },
  { id: 'aliases', label: 'Aliases', href: '/aliases', icon: 'alias', order: 30 },
  { id: 'numbers', label: 'Numbers', href: '/numbers', icon: 'phone', feature: 'phone', order: 40 },
  { id: 'funds', label: 'Funds', href: '/funds', icon: 'funds', order: 50 },
  { id: 'settings', label: 'Settings', href: '/settings', icon: 'settings', order: 90 },
];
// The bottom bar of a phone has room for this many places.
const TAB_PLACES = 5;

// The places of the app plus the ones that feature files registered, in order.
function navItems(config) {
  const own = NAV.filter((n) => !n.feature || config.features[n.feature]);
  const extra = registered.navItems().filter((n) => !NAV.some((b) => b.id === n.id)).map((n) => ({ id: n.id, label: n.label, href: n.path, icon: n.icon, order: n.order, more: n.more }));
  return [...own, ...extra].sort((a, b) => a.order - b.order);
}

let shellEl = null;
let mainEl = null;
let unsub = [];
let hooks = { onTestTools: null, onSignedOut: null };

export function setShellHooks(h2) { hooks = { ...hooks, ...h2 }; }

export function brand(href = '/') {
  return h('a', { class: 'brand', href, 'data-link': true, 'aria-label': `${appName()}, home` }, logoMark({ size: 30 }), h('span', { class: 'brand-name' }, appName()));
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

// The words of the banner are a "Why?" button: they open the explanation of test mode under the banner.
export function testBanner() {
  const config = store.get('config');
  if (!isMockMode(config)) return null;
  const whyTest = whyParts('test-mode', { text: 'Test mode — simulated providers' });
  return h('div', { class: 'banner-wrap' },
    h('div', { class: 'banner', role: 'note' },
      whyTest.button,
      config.dev && hooks.onTestTools && store.get('phase') === 'in' ? h('button', { class: 'banner-btn', type: 'button', onClick: () => hooks.onTestTools() }, 'Test tools') : null,
    ),
    whyTest.panel,
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
  const items = navItems(config);

  const navLinks = new Map();
  const tabLinks = new Map();
  const nav = h('nav', { class: 'nav', 'aria-label': 'Main' });
  for (const n of items) {
    const a = h('a', { class: 'nav-item', href: n.href, 'data-link': true }, icon(n.icon, { size: 20 }), h('span', { class: 'nav-label' }, n.label));
    navLinks.set(n.id, a);
    nav.appendChild(a);
  }
  const balanceValue = h('span', { class: 'side-balance-value mono' });
  // Actions of feature files (registerTopBarAction): on a wide screen they are entries above the menu,
  // each with the key that opens it too ("Search", "/").
  const sideActions = registered.topBarActions().map((a) => h('button', { class: 'side-action', type: 'button', dataset: { sideAction: a.id }, onClick: () => a.run() },
    icon(a.icon, { size: 18 }), h('span', { class: 'grow' }, a.label),
    (a.key || (a.id === 'quick-jump' ? '/' : '')) ? h('kbd', { class: 'side-key', title: 'Press this key to open it' }, a.key || '/') : null));
  const sidebar = h('aside', { class: 'sidebar' },
    brand(),
    sideActions.length ? h('div', { class: 'side-actions-top' }, sideActions) : null,
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
      // buttons of feature files (registerTopBarAction), for example a search button
      registered.topBarActions().map((a) => iconButton(a.icon, a.label, { size: 20, onClick: () => a.run(), attrs: { dataset: { topAction: a.id } } })),
      h('a', { class: 'icon-btn', href: '/settings', 'data-link': true, 'aria-label': 'Settings', dataset: { nav: 'settings' } }, icon('settings', { size: 20 })),
    ),
  );

  // Phone: the bar holds five places. When there are more places than that, the bar shows the
  // first four and "More", and "More" lists every other place (Funds, Help, …, Settings).
  // Funds and Settings are also in the top bar (the balance and the gear).
  // A place registered with more: true is always under "More".
  const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Main' });
  const tabItems = items.filter((n) => n.id !== 'settings');
  const wanted = tabItems.filter((n) => !n.more);
  const needMore = wanted.length < tabItems.length || wanted.length > TAB_PLACES;
  const onBar = needMore ? wanted.slice(0, TAB_PLACES - 1) : wanted;
  const inMore = needMore ? items.filter((n) => !onBar.includes(n)) : [];
  tabbar.style.gridTemplateColumns = `repeat(${onBar.length + (inMore.length ? 1 : 0)}, 1fr)`;
  for (const n of onBar) {
    const a = h('a', { class: 'tab-link', href: n.href, 'data-link': true }, icon(n.icon, { size: 22 }), h('span', null, n.label));
    tabLinks.set(n.id, a);
    tabbar.appendChild(a);
  }
  const moreTab = inMore.length ? menuButton({
    label: 'More places', cls: 'tab-link tab-more',
    content: [icon('more', { size: 22 }), h('span', null, 'More')],
    items: () => inMore.map((n) => ({ label: n.label, icon: n.icon, onSelect: () => navigate(n.href) })),
  }) : null;
  if (moreTab) tabbar.appendChild(moreTab);

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
    if (moreTab) {
      moreTab.querySelector('.badge')?.remove();
      const n = inMore.reduce((sum, it) => sum + unreadFor(it.id, state), 0);
      if (n > 0) moreTab.appendChild(h('span', { class: 'badge', 'aria-label': `${n} unread` }, n > 99 ? '99+' : String(n)));
    }
  };
  paintCounts(store.get());
  unsub.push(store.subscribe(['balance', 'mailboxes', 'numbers'], paintCounts));
  unsub.push(store.subscribe(['config'], () => replace(bannerSlot, testBanner())));

  el.setActive = (id) => {
    for (const [nid, a] of [...navLinks, ...tabLinks]) {
      if (nid === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
    if (moreTab) { if (inMore.some((n) => n.id === id)) moreTab.setAttribute('aria-current', 'page'); else moreTab.removeAttribute('aria-current'); }
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
// page: the content is a whole page (class "page") and not a narrow form column.
export function bareLayout(content, { head = null, foot = null, wide = false, page = false } = {}) {
  return h('div', { class: 'bare' },
    testBanner(),
    h('header', { class: 'bare-head' }, brand('/'), head),
    page
      ? h('main', { class: 'bare-body bare-body-page', id: 'main', tabIndex: -1 }, content)
      : h('main', { class: 'bare-body', id: 'main', tabIndex: -1 }, h('div', { class: `bare-col ${wide ? 'bare-col-wide' : ''}`.trim() }, content)),
    foot ? h('footer', { class: 'bare-foot' }, foot) : null,
  );
}
