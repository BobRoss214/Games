// Start of the app: load settings, find out the sign-in state, set up routes.
import { h, replace } from './lib/dom.js';
import { store } from './lib/store.js';
import { api, setSignedOutHandler } from './lib/api.js';
import { defineRoutes, setOutlet, setResolver, startRouter, render, navigate } from './lib/router.js';
import { boot, dropLocal } from './lib/session.js';
import { loadAll, startEvents, stopEvents } from './lib/data.js';
import { resumePurchases, stopPolling } from './lib/pay.js';
import { showInShell, destroyShell, setShellHooks, bareLayout } from './ui/shell.js';
import { closeAllDialogs } from './ui/dialog.js';
import { closeMenus } from './ui/menu.js';
import { toast } from './ui/toast.js';
import { button, reportError } from './ui/components.js';
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
import { openTestTools } from './screens/testtools.js';

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
  { path: '/funds', name: 'funds', title: 'Funds', layout: 'shell', nav: 'funds', screen: fundsScreen },
  { path: '/settings', name: 'settings', title: 'Settings', layout: 'shell', nav: 'settings', screen: settingsScreen },
  { path: '/not-found', name: 'notfound', title: 'Not found', layout: 'auto', screen: notFoundScreen },
]);

// Which screen may show in which sign-in state.
setResolver((m) => {
  const phase = store.get('phase');
  const name = m.route.name;
  if (phase === 'out') {
    if (name === 'home' || name === 'create' || name === 'signin' || name === 'notfound') return m;
    return '/sign-in';
  }
  if (phase === 'locked') {
    if (name === 'create' || name === 'signin') return '/';
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
    showInShell(root, el, m.route.nav || '');
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

// A request said "not signed in": the session ended on the server.
setSignedOutHandler(() => {
  if (store.get('phase') === 'out') return;
  dropLocal();
  toast('You are signed out. Sign in again.');
  navigate('/sign-in', { replace: true });
});

setShellHooks({ onTestTools: () => openTestTools() });

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
    const config = await api.get('/api/config');
    store.set({ config });
    await boot();
  } catch (err) {
    fatal(err && err.message ? err.message : 'Check your connection, then try again.', () => location.reload());
    return;
  }
  startRouter();
  render();
}

start();
