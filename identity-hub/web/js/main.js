// Start of the app: load settings, find out the sign-in state, set up routes.
import { h, replace } from './lib/dom.js';
import { store } from './lib/store.js';
import { api, setSignedOutHandler } from './lib/api.js';
import { defineRoutes, setOutlet, setResolver, startRouter, render, navigate } from './lib/router.js';
import { onRoute, runGlobalKey, registered } from './lib/registry.js';
import { boot, dropLocal } from './lib/session.js';
import { loadAll, startEvents, stopEvents } from './lib/data.js';
import { resumePurchases, stopPolling } from './lib/pay.js';
import { showInShell, destroyShell, setShellHooks, bareLayout } from './ui/shell.js';
import { closeAllDialogs } from './ui/dialog.js';
import { closeMenus } from './ui/menu.js';
import { toast } from './ui/toast.js';
import { button, reportError, skeletonRows, loadError } from './ui/components.js';
import { initTheme } from './lib/theme.js';

import { welcomeScreen } from './screens/welcome.js';
import { createScreen } from './screens/create.js';
import { signInScreen, unlockScreen } from './screens/signin.js';
import { homeScreen } from './screens/home.js';
import { mailScreen } from './screens/mail.js';
import { aliasesScreen } from './screens/aliases.js';
import { numbersScreen } from './screens/numbers.js';
import { numberScreen } from './screens/number.js';
import { fundsScreen } from './screens/funds.js';
import { settingsScreen } from './screens/settings.js';
import { identityScreen } from './screens/identity.js';
import { noticeUnknownIdentities } from './lib/identities.js';
import { openTestTools } from './screens/testtools.js';

// Every feature file registers its parts when this file loads (see docs/UI-GUIDE.md).
// It loads on its own, so that one broken feature file cannot stop the whole app:
// the app then starts without the feature parts, and says so.
let featuresFailed = false;
const featuresLoaded = import('./features/index.js').catch((err) => { featuresFailed = true; queueMicrotask(() => { throw err; }); });

const root = document.getElementById('app');

function notFoundScreen() {
  const signedIn = store.get('phase') === 'in';
  const content = h('div', { class: 'stack stack-3' },
    h('h1', null, 'This page does not exist'),
    h('p', { class: 'muted' }, 'The link may be old, or the item was deleted.'),
    h('div', null, h('a', { class: 'btn btn-primary', href: '/', 'data-link': true }, signedIn ? 'Go to Home' : 'Go to the start')),
  );
  return signedIn ? h('div', { class: 'page page-narrow' }, content) : bareLayout(content);
}

const unlockRoute = { name: 'unlock', title: 'Unlock', layout: 'bare', screen: unlockScreen };

defineRoutes([
  { path: '/', name: 'home', title: '', layout: 'auto', nav: 'home', screen: (ctx) => (store.get('phase') === 'in' ? homeScreen(ctx) : welcomeScreen(ctx)) },
  { path: '/create', name: 'create', title: 'Create account', layout: 'bare', screen: createScreen },
  { path: '/sign-in', name: 'signin', title: 'Sign in', layout: 'bare', screen: signInScreen },
  { path: '/mail', name: 'mail', title: 'Mail', layout: 'shell', nav: 'mail', screen: mailScreen },
  { path: '/mail/:mailboxId', name: 'mail', title: 'Mail', layout: 'shell', nav: 'mail', screen: mailScreen },
  { path: '/mail/:mailboxId/:messageId', name: 'mail', title: 'Mail', layout: 'shell', nav: 'mail', screen: mailScreen },
  { path: '/aliases', name: 'aliases', title: 'Aliases', layout: 'shell', nav: 'aliases', screen: aliasesScreen },
  { path: '/numbers', name: 'numbers', title: 'Numbers', layout: 'shell', nav: 'numbers', screen: numbersScreen },
  { path: '/numbers/:id', name: 'number', title: 'Number', layout: 'shell', nav: 'numbers', screen: numberScreen },
  { path: '/identities/:id', name: 'identity', title: 'Identity', layout: 'shell', nav: 'home', screen: identityScreen },
  { path: '/funds', name: 'funds', title: 'Funds', layout: 'shell', nav: 'funds', screen: fundsScreen },
  { path: '/settings', name: 'settings', title: 'Settings', layout: 'shell', nav: 'settings', screen: settingsScreen },
  { path: '/not-found', name: 'notfound', title: 'Not found', layout: 'auto', screen: notFoundScreen },
]);

// ---- screens of feature files (registerRoute) ----
// The file of the screen loads when the person opens the path. Signed in, the screen shows in
// the shell. Signed out (only for routes with signedOut: true), it shows on a plain page.
function featureScreen(route) {
  return ({ params, scope }) => {
    const signedIn = store.get('phase') === 'in';
    const slot = h('div', { class: 'feature-slot' }, h('div', { class: 'page page-narrow' }, skeletonRows(4)));
    let inner = null;      // the screen of the feature, when it can update in place
    let loaded = false;
    let lastParams = params;
    const load = () => Promise.resolve().then(() => route.loader()).then((mod) => {
      if (scope.disposed) return;
      const fn = typeof mod === 'function' ? mod : (mod && (mod.default || mod.screen));
      if (typeof fn !== 'function') throw new Error(`The file for ${route.path} has no screen function.`);
      const result = fn({ params: lastParams, scope });
      inner = result instanceof Node ? null : result;
      loaded = true;
      replace(slot, result instanceof Node ? result : result.el);
    }).catch((err) => {
      if (scope.disposed) return;
      replace(slot, h('div', { class: 'page page-narrow' }, loadError('This page did not load. Check your connection, then try again.', () => { replace(slot, h('div', { class: 'page page-narrow' }, skeletonRows(4))); load(); })));
      queueMicrotask(() => { throw err; });
    });
    load();
    const head = store.get('phase') === 'locked'
      ? h('a', { class: 'btn btn-sm', href: '/', 'data-link': true }, 'Unlock')
      : h('a', { class: 'btn btn-sm', href: '/sign-in', 'data-link': true }, 'Sign in');
    return {
      el: signedIn ? slot : bareLayout(slot, { head, page: true }),
      update(p) {
        lastParams = p;
        // Signed in or out since the screen was made, or a screen that cannot update: make it again.
        if ((store.get('phase') === 'in') !== signedIn || (loaded && !(inner && typeof inner.update === 'function'))) { render({ force: true }); return; }
        if (inner) inner.update(p);
      },
    };
  };
}
// The menu item to mark: the one the route names, or the one whose path is the start of the address.
function navFor(route) {
  if (route.nav) return route.nav;
  const path = location.pathname;
  const item = registered.navItems().find((n) => path === n.path || path.startsWith(`${n.path}/`));
  return item ? item.id : '';
}
onRoute((r) => defineRoutes([{ path: r.path, name: `feature:${r.path}`, title: r.title, layout: 'auto', nav: () => navFor(r), signedOut: r.signedOut, screen: featureScreen(r) }]));

// Which screen may show in which sign-in state.
setResolver((m) => {
  const phase = store.get('phase');
  const name = m.route.name;
  if (phase === 'out') {
    if (name === 'home' || name === 'create' || name === 'signin' || name === 'notfound' || m.route.signedOut) return m;
    return '/sign-in';
  }
  if (phase === 'locked') {
    if (name === 'create' || name === 'signin') return '/';
    if (m.route.signedOut) return m;
    return { route: unlockRoute, params: {} };
  }
  if (name === 'signin') return '/';
  return m;
});

setOutlet((m, el) => {
  closeMenus();
  // Was the keyboard focus on the old screen? Then it moves to the new screen below.
  const hadFocus = document.activeElement && document.activeElement !== document.body;
  const inShell = store.get('phase') === 'in' && (m.route.layout === 'shell' || m.route.layout === 'auto');
  if (inShell) {
    showInShell(root, el, (typeof m.route.nav === 'function' ? m.route.nav() : m.route.nav) || '');
  } else {
    destroyShell();
    replace(root, el);
  }
  root.removeAttribute('aria-busy');
  const main = document.getElementById('main');
  if (main && hadFocus && !main.contains(document.activeElement)) main.focus({ preventScroll: true });
});

// What runs when the sign-in state changes.
let running = false;
function onPhase(phase) {
  if (phase === 'in' && !running) {
    running = true;
    loadAll().then((errors) => { if (errors.length && store.get('phase') === 'in') reportError(errors[0]); });
    startEvents();
    resumePurchases();
  } else if (phase !== 'in' && running) {
    running = false;
    stopEvents();
    stopPolling();
    closeAllDialogs();
    closeMenus();
  }
}
store.subscribe(['phase'], (s) => onPhase(s.phase));
// An alias or a number names an identity that this tab does not know yet (made in another tab).
store.subscribe(['aliases', 'numbers', 'identities'], (s) => { if (s.phase === 'in') noticeUnknownIdentities(s); });

// A request said "not signed in": the session ended on the server.
setSignedOutHandler(() => {
  if (store.get('phase') === 'out') return;
  dropLocal();
  toast('You are signed out. Sign in again.');
  navigate('/sign-in', { replace: true });
});

setShellHooks({ onTestTools: () => openTestTools() });

// Keys of feature files (registerGlobalKey). They do nothing while the person types.
document.addEventListener('keydown', (e) => { runGlobalKey(e, { signedIn: store.get('phase') === 'in' }); });

window.addEventListener('offline', () => toast('You are offline. Changes do not save until the connection is back.', { kind: 'error' }));

function fatal(message, retry) {
  replace(root, bareLayout(h('div', { class: 'stack stack-3' },
    h('h1', null, 'Postern did not start'),
    h('p', { class: 'muted' }, message),
    h('div', null, button('Try again', { kind: 'primary', iconName: 'refresh', onClick: retry })),
  )));
  root.removeAttribute('aria-busy');
}

async function start() {
  initTheme();
  try {
    // The feature files are in before the sign-in state is known, so that they see every change of it.
    const [config] = await Promise.all([api.get('/api/config'), featuresLoaded]);
    store.set({ config });
    await boot();
  } catch (err) {
    fatal(err && err.message ? err.message : 'Check your connection, then try again.', () => location.reload());
    return;
  }
  startRouter();
  render();
  if (featuresFailed) toast('Some parts of the app did not load. Load the page again.', { kind: 'error' });
}

start();
