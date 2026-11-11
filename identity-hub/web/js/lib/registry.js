// Extension points. A feature file calls the register…() functions at the top level of
// the file (at import time). The shared screens read the lists each time they paint.
// The guide with examples is docs/UI-GUIDE.md.
//
// This file imports nothing, so every file may import it.

const ROW_KINDS = ['alias', 'number', 'inbox', 'identity'];

const routes = [];
const routeSinks = [];
const navItems = [];
const rowActions = new Map(ROW_KINDS.map((k) => [k, []]));
const rowBadges = new Map(ROW_KINDS.map((k) => [k, []]));
const messageActions = [];
const messagePanels = [];
const textAddons = [];
const callAddons = [];
const settingsSections = [];
const homeSections = [];
const numberTabs = [];
const numberSettings = [];
const globalKeys = new Map();
const welcomeLinks = [];
const topBarActions = [];

function need(ok, message) { if (!ok) throw new TypeError(`registry: ${message}`); }
const isFn = (v) => typeof v === 'function';
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const isId = (v) => typeof v === 'string' && /^[a-z][a-z0-9-]*$/.test(v);
const byOrder = (list) => [...list].sort((a, b) => a.order - b.order);
function addUnique(list, entry, what) {
  need(isId(entry.id), `${what} needs an id of small letters, digits and "-"`);
  need(!list.some((x) => x.id === entry.id), `${what} "${entry.id}" is registered two times`);
  need(Number.isFinite(entry.order), `${what} "${entry.id}": order must be a number`);
  list.push(entry);
}

// A feature that throws must not break the shared screen. The error still shows in the console.
function safe(fn, ...args) {
  try { return fn(...args); } catch (err) { queueMicrotask(() => { throw err; }); return null; }
}
const nodesOf = (list, ...args) => list.map((fn) => safe(fn, ...args)).filter((n) => n instanceof Node);
function actionsOf(list, ...args) {
  const out = [];
  for (const fn of list) {
    const a = safe(fn, ...args);
    if (a && isText(a.label) && isFn(a.run)) out.push({ label: a.label, icon: a.icon || '', danger: !!a.danger, run: a.run });
  }
  return out;
}

// ---------- screens ----------

// A new screen at a path, for example '/help' or '/help/:topic'.
// loader: () => import('../features/help/screen.js'). The file exports the screen function
// as "default" or as "screen": ({ params, scope }) => Node or { el, update(params) }.
// signedOut: true = people without an account can open it too.
// title: text for the browser tab. nav: id of the menu item to mark (found from the path when left out).
export function registerRoute(path, loader, { signedOut = false, title = '', nav = '' } = {}) {
  need(typeof path === 'string' && /^\/[a-z0-9]/.test(path) && !path.includes('//'), 'a route path starts with "/" and a small letter');
  need(isFn(loader), `route ${path} needs a loader function`);
  need(!routes.some((r) => r.path === path), `route ${path} is registered two times`);
  const route = { path, loader, signedOut: !!signedOut, title: String(title || ''), nav: String(nav || '') };
  routes.push(route);
  for (const sink of routeSinks) sink(route);
}

// One more place in the sidebar. On a phone the bottom bar holds five places; when there are
// more, the bar shows the first four and "More", and "More" lists the rest.
// order: Home 10, Mail 20, Aliases 30, Numbers 40, Funds 50, Settings 90.
// more: true = on a phone this place is always under "More", also when the bar has room.
export function registerNavItem({ id, label, icon = 'dot', path, order = 60, more = false } = {}) {
  need(isText(label), `menu item "${id}" needs a label`);
  need(typeof path === 'string' && path.startsWith('/'), `menu item "${id}" needs a path`);
  addUnique(navItems, { id, label, icon, path, order, more: !!more }, 'menu item');
}

// ---------- rows ----------

// One more entry in the "…" menu of a row. kind: 'alias' | 'number' | 'inbox' | 'identity'.
// fn(item) returns { label, icon, danger, run } or null.
export function registerRowAction(kind, fn) {
  need(ROW_KINDS.includes(kind), `row kind must be one of ${ROW_KINDS.join(', ')}`);
  need(isFn(fn), 'a row action needs a function');
  rowActions.get(kind).push(fn);
}

// A small mark next to the label of a row. fn(item) returns an element (use tag()) or null.
// A mark is text with an optional icon. It is not a button and not a link.
export function registerRowBadge(kind, fn) {
  need(ROW_KINDS.includes(kind), `row kind must be one of ${ROW_KINDS.join(', ')}`);
  need(isFn(fn), 'a row badge needs a function');
  rowBadges.get(kind).push(fn);
}

// ---------- mail, texts, calls ----------

// One more entry in the "More actions" menu of an open email.
// fn(message, alias) returns { label, icon, danger, run } or null. alias is null for mail to the inbox address.
export function registerMessageAction(fn) { need(isFn(fn), 'a message action needs a function'); messageActions.push(fn); }

// A panel between the head and the text of an open email. fn(message, alias) returns an element or null.
export function registerMessagePanel(fn) { need(isFn(fn), 'a message panel needs a function'); messagePanels.push(fn); }

// Something under the words of one text. fn(text, number) returns an element or null.
export function registerTextAddon(fn) { need(isFn(fn), 'a text add-on needs a function'); textAddons.push(fn); }

// Something under one line of the call list. fn(call, number) returns an element or null.
export function registerCallAddon(fn) { need(isFn(fn), 'a call add-on needs a function'); callAddons.push(fn); }

// ---------- sections ----------

// One more section on Settings. render({ scope }) returns an element, or null to show nothing.
// order: Passkeys 10, Sessions 20, Theme 30, What the server sees 40, This browser 90, Delete account 100.
export function registerSettingsSection({ id, title, lede = '', order = 50, render } = {}) {
  need(isText(title), `settings section "${id}" needs a title`);
  need(isFn(render), `settings section "${id}" needs a render function`);
  addUnique(settingsSections, { id, title, lede, order, render }, 'settings section');
}

// One more block on Home. render({ scope }) returns an element, or null to show nothing.
// order: the counts are 20, the lists are 30. Below 20 = above the counts (warnings). Above 30 = at the end.
export function registerHomeSection({ id, order = 50, render } = {}) {
  need(isFn(render), `home section "${id}" needs a render function`);
  addUnique(homeSections, { id, order, render }, 'home section');
}

// One more tab on the screen of one number. render({ number, scope }) returns an element.
// order: Texts 10, Calls 20, Settings 90.
export function registerNumberTab({ id, label, order = 50, render } = {}) {
  need(isText(label), `number tab "${id}" needs a label`);
  need(isFn(render), `number tab "${id}" needs a render function`);
  need(!['texts', 'calls', 'settings'].includes(id), `number tab "${id}" exists already`);
  addUnique(numberTabs, { id, label, order, render }, 'number tab');
}

// One more section in the Settings tab of a number. render({ number, scope }) returns an element or null.
// It runs again each time the number changes, so it must be cheap.
// order: Label 10, Forwarding 20, Identity 30, Random identifiers 40, Old texts 50, Renewal 80, Release 100.
export function registerNumberSetting({ id, title, lede = '', order = 60, render } = {}) {
  need(isText(title), `number setting "${id}" needs a title`);
  need(isFn(render), `number setting "${id}" needs a render function`);
  addUnique(numberSettings, { id, title, lede, order, render }, 'number setting');
}

// ---------- the start page and the top bar of a phone ----------

// A link on the start page for people who are not signed in, under the buttons.
// The path must be a route with signedOut: true.
export function registerWelcomeLink({ id, label, path, order = 50 } = {}) {
  need(isText(label), `welcome link "${id}" needs a label`);
  need(typeof path === 'string' && path.startsWith('/'), `welcome link "${id}" needs a path`);
  addUnique(welcomeLinks, { id, label, path, order }, 'welcome link');
}

// An icon button in the top bar of the phone layout, before the gear (a search button, for example).
// The bar has room for two. On a wide screen there is no top bar: give the same action a key (registerGlobalKey).
export function registerTopBarAction({ id, label, icon = 'dot', run, order = 50 } = {}) {
  need(isText(label), `top bar action "${id}" needs a label`);
  need(isFn(run), `top bar action "${id}" needs a function`);
  addUnique(topBarActions, { id, label, icon, run, order }, 'top bar action');
}

// ---------- keys ----------

// One key for the whole app, for example '/'. It does nothing while the person types in a
// field, while a dialog or a menu is open, or with Ctrl, Alt or the Command key.
export function registerGlobalKey(key, run, { signedOut = false } = {}) {
  need(typeof key === 'string' && key.length === 1 && key.trim() !== '', 'a global key is one character that you can see');
  need(isFn(run), `global key "${key}" needs a function`);
  need(!globalKeys.has(key), `global key "${key}" is registered two times`);
  globalKeys.set(key, { run, signedOut: !!signedOut });
}

// ---------- for the shared screens (feature files do not need these) ----------

export const registered = {
  navItems: () => byOrder(navItems),
  rowActions: (kind, item) => actionsOf(rowActions.get(kind) || [], item),
  rowBadges: (kind, item) => nodesOf(rowBadges.get(kind) || [], item),
  messageActions: (message, alias) => actionsOf(messageActions, message, alias),
  messagePanels: (message, alias) => nodesOf(messagePanels, message, alias),
  textAddons: (text, number) => nodesOf(textAddons, text, number),
  callAddons: (call, number) => nodesOf(callAddons, call, number),
  settingsSections: () => byOrder(settingsSections),
  homeSections: () => byOrder(homeSections),
  numberTabs: () => byOrder(numberTabs),
  numberSettings: () => byOrder(numberSettings),
  welcomeLinks: () => byOrder(welcomeLinks),
  topBarActions: () => byOrder(topBarActions).slice(0, 2).map((a) => ({ ...a, run: () => safe(a.run) })),
};

// Runs a render function of a feature. Gives back an element or null.
export function renderSafe(render, ctx) {
  const el = safe(render, ctx);
  return el instanceof Node ? el : null;
}

// Mixes the parts of a shared screen with the registered parts: [{ order, ... }], lowest order first.
export const mergeByOrder = (...lists) => byOrder(lists.flat());

// Is there a screen at this path? It knows the app's own screens too ('/funds', '/numbers/x').
// A feature can ask before it shows a link to a screen of another feature file.
let routeCheck = null;
export function setRouteCheck(fn) { routeCheck = fn; } // main.js gives the check of the router
export function hasRoute(path) {
  return routeCheck ? !!routeCheck(path) : routes.some((r) => r.path === path);
}

// main.js gives the router here. It gets the routes that exist now and each later one.
export function onRoute(sink) {
  routeSinks.push(sink);
  for (const r of routes) sink(r);
}

// main.js calls this for each keydown on the page. True = a registered key ran.
export function runGlobalKey(e, { signedIn }) {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return false;
  const entry = globalKeys.get(e.key);
  if (!entry || (!signedIn && !entry.signedOut)) return false;
  const t = e.target;
  if (t instanceof Element && t.closest('input, textarea, select, [contenteditable], [role="menu"], dialog')) return false;
  if (document.querySelector('dialog[open], .menu')) return false;
  e.preventDefault();
  safe(entry.run, e);
  return true;
}
