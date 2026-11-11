// A small router on the History API. The server returns index.html for every
// path without a file extension, so deep links and reloads work.
// URLs hold only route names and random IDs. Never addresses, numbers or keys.
import { createScope } from './dom.js';

const routes = [];
let current = null;        // { route, params, scope, instance }
let outlet = null;         // function (routeMatch, element) that puts the screen on the page
let resolver = (m) => m;   // lets the app redirect by sign-in state

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

export function currentPath() { return location.pathname; }
export function currentRoute() { return current; }

export function navigate(path, { replace = false } = {}) {
  if (path !== location.pathname) {
    if (replace) history.replaceState(null, '', path);
    else history.pushState(null, '', path);
  }
  render();
}

// Renders the screen for the current URL.
export function render({ force = false } = {}) {
  let m = match(location.pathname);
  const redirected = resolver(m);
  if (typeof redirected === 'string') {
    if (redirected !== location.pathname) history.replaceState(null, '', redirected);
    m = match(redirected);
    const again = resolver(m);
    if (typeof again === 'string') return; // guard against loops
  }
  // The same screen with new params can update in place (mail keeps its lists).
  if (!force && current && current.route.name === m.route.name && current.instance && typeof current.instance.update === 'function' && current.layout === m.route.layout) {
    current.params = m.params;
    current.instance.update(m.params);
    return;
  }
  if (current) current.scope.dispose();
  const scope = createScope();
  current = { route: m.route, params: m.params, scope, instance: null, layout: m.route.layout };
  const result = m.route.screen({ params: m.params, scope });
  const el = result instanceof Node ? result : result.el;
  if (!(result instanceof Node)) current.instance = result;
  outlet(m, el);
  document.title = m.route.title ? `${m.route.title} · Postern` : 'Postern';
  window.scrollTo(0, 0);
}

export function startRouter() {
  window.addEventListener('popstate', () => render());
  // In-app links: <a href="/mail" data-link>
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target instanceof Element ? e.target.closest('a[data-link]') : null;
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || !href.startsWith('/')) return;
    e.preventDefault();
    navigate(href);
  });
}
