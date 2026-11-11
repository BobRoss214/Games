// A small router on the History API. The server returns index.html for every
// path without a file extension, so deep links and reloads work.
// URLs hold only route names and random IDs. Never addresses, numbers or keys.
import { createScope } from './dom.js';
import { appName } from './store.js';

const routes = [];
let current = null;        // { route, params, scope, instance }
let outlet = null;         // function (routeMatch, element) that puts the screen on the page
let resolver = (m) => m;   // lets the app redirect by sign-in state
let phaseKey = () => '';   // changes when the sign-in state changes: the same address then shows a different screen
export function setPhaseKey(fn) { phaseKey = fn; }

export function defineRoutes(list) {
  for (const r of list) routes.push({ ...r, segs: r.path.split('/').filter(Boolean) });
}

export function setOutlet(fn) { outlet = fn; }
export function setResolver(fn) { resolver = fn; }

function match(pathname) {
  const segs = pathname.split('/').filter(Boolean);
  for (const r of routes) {
    if (r.segs.length !== segs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < segs.length && ok; i++) {
      if (r.segs[i][0] === ':') {
        try { params[r.segs[i].slice(1)] = decodeURIComponent(segs[i]); } catch { ok = false; }
      } else if (r.segs[i] !== segs[i]) ok = false;
    }
    if (ok) return { route: r, params };
  }
  return { route: routes.find((r) => r.name === 'notfound'), params: {} };
}

const here = () => location.pathname + location.search + location.hash;

// path may end with "#id": after the screen is there, the page moves to the element with that id.
export function navigate(path, { replace = false } = {}) {
  if (path !== here()) {
    if (replace) history.replaceState(null, '', path);
    else history.pushState(null, '', path);
  }
  render();
}

// Moves the page and the keyboard focus to the element that the address names after "#".
// The router calls it after each screen change. A screen that paints later (after a load) can call it again.
// Returns true when the element was found.
export function jumpToAnchor() {
  let id = '';
  try { id = decodeURIComponent(location.hash.slice(1)); } catch { id = ''; }
  const el = id ? document.getElementById(id) : null;
  if (!el) return false;
  if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
  el.scrollIntoView({ block: 'start' });
  el.focus({ preventScroll: true });
  return true;
}

// Renders the screen for the current URL.
export function render({ force = false } = {}) {
  let m = match(location.pathname);
  // The resolver may send the person to another path, or swap the screen (unlock).
  let resolved = resolver(m);
  if (typeof resolved === 'string') {
    if (resolved !== location.pathname) history.replaceState(null, '', resolved);
    m = match(resolved);
    resolved = resolver(m);
    if (typeof resolved === 'string') return; // guard against loops
  }
  if (resolved && resolved.route) m = resolved;
  const place = location.pathname + location.search;
  // The same screen at the same place: only the part after "#" changed (or nothing). Keep the screen.
  if (!force && current && current.route === m.route && current.place === place && current.phaseKey === phaseKey()) {
    jumpToAnchor();
    return;
  }
  // The same screen with new params can update in place (mail keeps its lists).
  if (!force && current && current.route.name === m.route.name && current.instance && typeof current.instance.update === 'function' && current.layout === m.route.layout) {
    current.params = m.params;
    current.place = place;
    current.phaseKey = phaseKey();
    current.instance.update(m.params);
    jumpToAnchor();
    return;
  }
  if (current) current.scope.dispose();
  const scope = createScope();
  current = { route: m.route, params: m.params, scope, instance: null, layout: m.route.layout, place, phaseKey: phaseKey() };
  const result = m.route.screen({ params: m.params, scope });
  const el = result instanceof Node ? result : result.el;
  if (!(result instanceof Node)) current.instance = result;
  outlet(m, el);
  document.title = m.route.title ? `${m.route.title} · ${appName()}` : appName();
  if (!jumpToAnchor()) window.scrollTo(0, 0);
}

export function startRouter() {
  window.addEventListener('popstate', () => render());
  // In-app links: <a href="/mail" data-link>
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target instanceof Element ? e.target.closest('a[data-link]') : null;
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || !href.startsWith('/') || href.startsWith('//')) return; // paths of this app only
    e.preventDefault();
    navigate(href);
  });
}
