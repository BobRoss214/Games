// Shared interface parts: buttons, fields, toggles, chips, tabs, empty states, skeletons.
import { h, append, uid } from '../lib/dom.js';
import { icon, archFigure } from './icons.js';
import { toast, copyText } from './toast.js';
import { openDialog } from './dialog.js';
import { ApiError } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { money } from '../lib/format.js';
import { store } from '../lib/store.js';

// ---- buttons ----
export function button(label, { kind = '', iconName = '', onClick = null, type = 'button', size = '', disabled = false, block = false, attrs = null, iconAfter = '' } = {}) {
  const cls = ['btn', kind && `btn-${kind}`, size && `btn-${size}`, block && 'btn-block'].filter(Boolean).join(' ');
  const el = h('button', { class: cls, type, disabled, ...(attrs || {}) },
    iconName ? icon(iconName, { size: 18 }) : null,
    h('span', { class: 'btn-label' }, label),
    iconAfter ? icon(iconAfter, { size: 18 }) : null,
  );
  if (onClick) el.addEventListener('click', (e) => onClick(e, el));
  return el;
}

export function iconButton(name, label, { onClick = null, cls = '', size = 18, attrs = null } = {}) {
  const el = h('button', { class: `icon-btn ${cls}`.trim(), type: 'button', 'aria-label': label, title: label, ...(attrs || {}) }, icon(name, { size }));
  if (onClick) el.addEventListener('click', (e) => onClick(e, el));
  return el;
}

export function linkButton(label, href, { kind = '', iconName = '', size = '', block = false, external = false } = {}) {
  const cls = ['btn', kind && `btn-${kind}`, size && `btn-${size}`, block && 'btn-block'].filter(Boolean).join(' ');
  const props = external ? { class: cls, href, target: '_blank', rel: 'noopener noreferrer' } : { class: cls, href, 'data-link': true };
  return h('a', props, iconName ? icon(iconName, { size: 18 }) : null, h('span', { class: 'btn-label' }, label));
}

// Runs an async action with the button disabled and marked busy.
// Errors go to reportError unless onError handles them.
export async function runBusy(btn, fn, { onError = null } = {}) {
  if (btn.getAttribute('aria-busy') === 'true') return undefined;
  const was = btn.disabled;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  try {
    return await fn();
  } catch (err) {
    if (!onError || onError(err) !== true) reportError(err);
    return undefined;
  } finally {
    btn.removeAttribute('aria-busy');
    btn.disabled = was;
  }
}

export function copyButton(getValue, label = 'Copy', { what = 'Copied', withLabel = false, cls = '' } = {}) {
  const el = withLabel
    ? h('button', { class: `btn ${cls}`.trim(), type: 'button' }, icon('copy', { size: 18 }), h('span', { class: 'btn-label' }, label))
    : h('button', { class: `icon-btn ${cls}`.trim(), type: 'button', 'aria-label': label, title: label }, icon('copy', { size: 18 }));
  el.addEventListener('click', async (e) => {
    e.stopPropagation();
    const ok = await copyText(typeof getValue === 'function' ? getValue() : getValue, what);
    if (!ok) return;
    const old = el.querySelector('svg');
    const done = icon('check', { size: 18 });
    old.replaceWith(done);
    el.classList.add('is-done');
    setTimeout(() => { if (done.isConnected) done.replaceWith(icon('copy', { size: 18 })); el.classList.remove('is-done'); }, 1400);
  });
  return el;
}

// ---- errors ----
export function reportError(err, fallback = 'That did not work. Try again.') {
  if (err && err.name === 'AbortError') return;
  if (err instanceof ApiError) {
    if (err.status === 401 && err.code === 'not_signed_in') return; // the app goes to the sign-in screen
    if (err.status === 402) { needFunds(err); return; }
  }
  toast((err && err.message) || fallback, { kind: 'error' });
}

let fundsDialogOpen = false;
export function needFunds(err) {
  if (fundsDialogOpen) return;
  fundsDialogOpen = true;
  const needed = err && err.extra && typeof err.extra.needed === 'number' ? err.extra.needed : null;
  const balance = store.get('balance') || 0;
  const payOn = !!store.get('config')?.features?.pay;
  const dlg = openDialog({
    title: 'Add funds to continue', size: 'sm',
    content: (api) => h('div', { class: 'stack' },
      h('p', { class: 'read' }, (err && err.message) || 'Your balance is too low.'),
      needed !== null ? h('dl', { class: 'kv' },
        h('dt', null, 'This costs'), h('dd', { class: 'mono' }, money(needed)),
        h('dt', null, 'Your balance'), h('dd', { class: 'mono' }, money(balance)),
      ) : null,
      payOn ? null : h('p', { class: 'small muted' }, 'Payments are turned off on this server.'),
      h('div', { class: 'dialog-actions' },
        button('Not now', { onClick: () => api.close() }),
        payOn ? button('Add funds', { kind: 'primary', attrs: { autofocus: true }, onClick: () => { api.close(); navigate('/funds'); } }) : null,
      ),
    ),
  });
  dlg.closed.then(() => { fundsDialogOpen = false; });
}

// ---- form fields ----
// Returns { el, input, setError(message), value }.
export function field({ label, type = 'text', value = '', placeholder = '', hint = '', name = '', mono = false, required = false, autocomplete = 'off', inputmode = '', maxlength = null, rows = 0, attrs = null, optional = false, suffix = null, prefix = null }) {
  const id = uid('f');
  const hintId = hint ? `${id}-hint` : null;
  const errId = `${id}-err`;
  const common = {
    id, name: name || null, class: ['input', mono && 'mono', rows && 'textarea'].filter(Boolean).join(' '), placeholder: placeholder || null,
    required, autocomplete, 'aria-describedby': [hintId, errId].filter(Boolean).join(' '), maxlength,
    autocapitalize: mono || type === 'email' ? 'off' : null, spellcheck: mono || type === 'email' || type === 'tel' ? 'false' : null, inputmode: inputmode || null,
    ...(attrs || {}),
  };
  const input = rows ? h('textarea', { ...common, rows }) : h('input', { ...common, type });
  input.value = value;
  const err = h('p', { class: 'field-error', id: errId, hidden: true });
  const control = prefix || suffix
    ? h('div', { class: 'input-group' }, prefix ? h('span', { class: 'input-affix' }, prefix) : null, input, suffix ? h('span', { class: 'input-affix' }, suffix) : null)
    : input;
  const el = h('div', { class: 'field' },
    h('label', { class: 'label', for: id }, label, optional ? h('span', { class: 'label-opt' }, ' (optional)') : null),
    control,
    hint ? h('p', { class: 'hint', id: hintId }, hint) : null,
    err,
  );
  const api = {
    el, input,
    get value() { return input.value; },
    set value(v) { input.value = v; },
    setError(message) {
      err.textContent = message || '';
      err.hidden = !message;
      input.toggleAttribute('aria-invalid', !!message);
      if (message) input.focus();
    },
  };
  input.addEventListener('input', () => { if (!err.hidden) api.setError(''); });
  return api;
}

export function selectField({ label, options, value = '', hint = '', optional = false, mono = false }) {
  const id = uid('f');
  const hintId = hint ? `${id}-hint` : null;
  const select = h('select', { id, class: ['input', 'select', mono && 'mono'].filter(Boolean).join(' '), 'aria-describedby': hintId });
  for (const o of options) select.appendChild(h('option', { value: o.value, selected: o.value === value, disabled: !!o.disabled }, o.label));
  const el = h('div', { class: 'field' },
    h('label', { class: 'label', for: id }, label, optional ? h('span', { class: 'label-opt' }, ' (optional)') : null),
    h('div', { class: 'select-wrap' }, select, icon('chevronDown', { size: 16, cls: 'select-caret' })),
    hint ? h('p', { class: 'hint', id: hintId }, hint) : null,
  );
  return { el, input: select, get value() { return select.value; }, set value(v) { select.value = v; } };
}

export function checkbox(label, { checked = false, onChange = null } = {}) {
  const id = uid('c');
  const input = h('input', { type: 'checkbox', id, class: 'check-input', checked });
  if (onChange) input.addEventListener('change', () => onChange(input.checked));
  const el = h('div', { class: 'check' }, input, h('label', { for: id }, label));
  return { el, input, get checked() { return input.checked; } };
}

// An on/off switch. onChange may return a promise. If it rejects, the switch goes back.
export function toggle({ checked, label, onChange, disabled = false, withText = false }) {
  const el = h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(!!checked), 'aria-label': label, disabled, title: label },
    h('span', { class: 'switch-track' }, h('span', { class: 'switch-knob' })),
    withText ? h('span', { class: 'switch-text' }, checked ? 'On' : 'Off') : null,
  );
  el.addEventListener('click', async (e) => {
    e.stopPropagation();
    const next = el.getAttribute('aria-checked') !== 'true';
    el.setAttribute('aria-checked', String(next));
    const t = el.querySelector('.switch-text');
    if (t) t.textContent = next ? 'On' : 'Off';
    el.disabled = true;
    try {
      await onChange(next);
    } catch (err) {
      el.setAttribute('aria-checked', String(!next));
      if (t) t.textContent = !next ? 'On' : 'Off';
      reportError(err);
    } finally {
      if (el.isConnected) el.disabled = disabled;
    }
  });
  return el;
}

// ---- choices ----
// Filter chips: one is pressed.
export function chips({ options, value, onChange, label }) {
  const el = h('div', { class: 'chips', role: 'group', 'aria-label': label });
  const paint = (v) => {
    for (const b of el.children) b.setAttribute('aria-pressed', String(b.dataset.value === v));
  };
  for (const o of options) {
    el.appendChild(h('button', { class: 'chip', type: 'button', dataset: { value: o.value }, 'aria-pressed': String(o.value === value), onClick: () => { paint(o.value); onChange(o.value); } },
      o.label, o.count !== undefined ? h('span', { class: 'chip-count mono' }, String(o.count)) : null));
  }
  el.setValue = paint;
  return el;
}

// Tabs with panels made on demand. tabs = [{ id, label, render: () => Node, badge? }]
export function tabs({ items, value, onChange = null, label }) {
  const list = h('div', { class: 'tabs', role: 'tablist', 'aria-label': label });
  const panel = h('div', { class: 'tab-panel', role: 'tabpanel', tabIndex: 0 });
  const el = h('div', { class: 'tabs-wrap' }, list, panel);
  let active = null;
  const buttons = new Map();
  function select(id, focus = false) {
    const item = items.find((t) => t.id === id) || items[0];
    active = item.id;
    for (const [bid, b] of buttons) {
      const on = bid === active;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
    panel.setAttribute('aria-labelledby', buttons.get(active).id);
    while (panel.firstChild) panel.removeChild(panel.firstChild);
    append(panel, item.render());
    if (onChange) onChange(active);
  }
  for (const t of items) {
    const b = h('button', { class: 'tab', type: 'button', role: 'tab', id: uid('tab'), 'aria-selected': 'false', tabIndex: -1, onClick: () => select(t.id) },
      t.label, t.badge ? h('span', { class: 'badge' }, String(t.badge)) : null);
    buttons.set(t.id, b);
    list.appendChild(b);
  }
  list.addEventListener('keydown', (e) => {
    const ids = items.map((t) => t.id);
    const i = ids.indexOf(active);
    if (e.key === 'ArrowRight') { e.preventDefault(); select(ids[(i + 1) % ids.length], true); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); select(ids[(i - 1 + ids.length) % ids.length], true); }
    else if (e.key === 'Home') { e.preventDefault(); select(ids[0], true); }
    else if (e.key === 'End') { e.preventDefault(); select(ids[ids.length - 1], true); }
  });
  select(value || items[0].id);
  el.select = select;
  el.setBadge = (id, n) => {
    const b = buttons.get(id);
    if (!b) return;
    b.querySelector('.badge')?.remove();
    if (n) b.appendChild(h('span', { class: 'badge' }, String(n)));
  };
  Object.defineProperty(el, 'active', { get: () => active });
  return el;
}

// One choice from a short list, shown as a row of buttons (theme, payment method).
export function segmented({ options, value, onChange, label }) {
  const name = uid('seg');
  const el = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label });
  for (const o of options) {
    const id = uid('seg-o');
    const input = h('input', { type: 'radio', class: 'sr-only', name, id, value: o.value, checked: o.value === value });
    input.addEventListener('change', () => { if (input.checked) onChange(o.value); });
    el.appendChild(h('div', { class: 'segmented-item' }, input, h('label', { for: id }, o.icon ? icon(o.icon, { size: 16 }) : null, h('span', null, o.label))));
  }
  return el;
}

// ---- states ----
export function emptyState({ title, text = '', action = null, compact = false, figure = true }) {
  return h('div', { class: `empty ${compact ? 'empty-compact' : ''}`.trim() },
    figure ? archFigure({ width: compact ? 44 : 60 }) : null,
    h('h3', { class: 'empty-title' }, title),
    text ? h('p', { class: 'empty-text' }, text) : null,
    action,
  );
}

export function skeletonRows(count = 4, { tall = false } = {}) {
  const el = h('div', { class: 'skeleton-list', 'aria-hidden': 'true' });
  for (let i = 0; i < count; i++) {
    el.appendChild(h('div', { class: `skeleton-row ${tall ? 'is-tall' : ''}`.trim() },
      h('span', { class: 'skeleton skeleton-dot' }),
      h('span', { class: 'skeleton skeleton-line', style: { width: `${38 + ((i * 17) % 30)}%` } }),
      h('span', { class: 'skeleton skeleton-line skeleton-short' }),
    ));
  }
  return h('div', { role: 'status', 'aria-label': 'Loading' }, el);
}

export function spinner(label = 'Working') {
  return h('span', { class: 'spinner', role: 'status', 'aria-label': label });
}

export function callout(kind, title, ...body) {
  return h('div', { class: `callout callout-${kind}`, role: kind === 'danger' || kind === 'warn' ? 'note' : null },
    icon(kind === 'warn' || kind === 'danger' ? 'warning' : kind === 'ok' ? 'shield' : 'info', { size: 18, cls: 'callout-icon' }),
    h('div', { class: 'callout-body' }, title ? h('p', { class: 'callout-title' }, title) : null, ...body),
  );
}

export function badge(textValue, kind = '') {
  return h('span', { class: `badge ${kind ? 'badge-' + kind : ''}`.trim() }, String(textValue));
}

export function tag(textValue, kind = '') {
  return h('span', { class: `tag ${kind ? 'tag-' + kind : ''}`.trim() }, textValue);
}

// Page title row with optional actions on the right.
export function pageHeader({ title, lede = '', actions = null, back = null }) {
  return h('header', { class: 'page-head' },
    back ? h('a', { class: 'back-link', href: back.href, 'data-link': true }, icon('chevronLeft', { size: 16 }), back.label) : null,
    h('div', { class: 'page-head-row' },
      h('div', { class: 'grow' },
        h('h1', { class: 'page-title', tabIndex: -1 }, title),
        lede ? h('p', { class: 'page-lede' }, lede) : null,
      ),
      actions ? h('div', { class: 'page-actions' }, actions) : null,
    ),
  );
}

export function section({ title, lede = '', actions = null, cls = '' }, ...children) {
  return h('section', { class: `section ${cls}`.trim() },
    h('div', { class: 'section-head' },
      h('div', { class: 'grow' }, h('h2', { class: 'section-title' }, title), lede ? h('p', { class: 'section-lede' }, lede) : null),
      actions,
    ),
    ...children,
  );
}

export function loadError(message, retry) {
  return h('div', { class: 'empty empty-compact' },
    h('h3', { class: 'empty-title' }, 'This did not load'),
    h('p', { class: 'empty-text' }, message || 'Check your connection, then try again.'),
    retry ? button('Try again', { iconName: 'refresh', onClick: retry }) : null,
  );
}
