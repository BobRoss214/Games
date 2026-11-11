// A very small DOM toolkit. Everything goes into the page as text nodes or
// attributes. This file never uses innerHTML.
const SVG_NS = 'http://www.w3.org/2000/svg';
const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'readOnly', 'multiple', 'indeterminate', 'open', 'htmlFor', 'tabIndex', 'srcdoc']);

function setProps(el, props) {
  if (!props) return;
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'innerHTML' || k === 'outerHTML') throw new Error('innerHTML is not allowed');
    if (k === 'class') el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : v);
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'dataset') for (const [dk, dv] of Object.entries(v)) el.dataset[dk] = dv;
    else if (k === 'style') for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk, sv);
    else if (k === 'ref') v(el);
    else if (k[0] === 'o' && k[1] === 'n' && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (PROPS.has(k)) el[k] = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
}

export function append(el, ...children) {
  for (const c of children) {
    if (c === undefined || c === null || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, ...c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
  return el;
}

// h('div', { class: 'row', onClick: fn }, 'text', otherNode)
// The second argument is always a props object or null.
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  setProps(el, props);
  return append(el, ...children);
}

export function s(tag, props, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  if (props) for (const [k, v] of Object.entries(props)) if (v !== undefined && v !== null && v !== false) el.setAttribute(k, String(v));
  return append(el, ...children);
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function replace(el, ...children) {
  clear(el);
  return append(el, ...children);
}


// A scope collects clean-up functions for one screen. The router disposes it on navigation.
export function createScope() {
  const fns = [];
  const scope = {
    disposed: false,
    add(fn) { if (scope.disposed) fn(); else fns.push(fn); return fn; },
    dispose() {
      if (scope.disposed) return;
      scope.disposed = true;
      for (const fn of fns.splice(0).reverse()) { try { fn(); } catch { /* keep going */ } }
    },
    // Adds an event listener that goes away with the screen.
    listen(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      scope.add(() => target.removeEventListener(type, fn, opts));
    },
    timer(fn, ms) {
      const id = setInterval(fn, ms);
      scope.add(() => clearInterval(id));
      return id;
    },
  };
  return scope;
}

// A region is an element whose children are made again when one of the store keys changes.
export function region(scope, store, keys, render, tag = 'div', props = null) {
  const el = h(tag, props);
  const paint = () => { if (!scope.disposed) replace(el, render(store.get())); };
  scope.add(store.subscribe(keys, paint));
  paint();
  el.repaint = paint;
  return el;
}

let idCounter = 0;
export const uid = (prefix = 'id') => `${prefix}-${(++idCounter).toString(36)}`;

export function debounce(fn, ms) {
  let t = 0;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function focusFirst(root) {
  const el = root.querySelector('[autofocus], input:not([type=hidden]):not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])');
  if (el) el.focus({ preventScroll: false });
}
