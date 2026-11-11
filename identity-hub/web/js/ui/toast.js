// Short notices at the edge of the screen. The container has aria-live="polite".
import { h } from '../lib/dom.js';
import { icon } from './icons.js';

const root = () => document.getElementById('toasts');

export function toast(message, { kind = 'info', action = null, timeout = 4500 } = {}) {
  const container = root();
  if (!container) return () => {};
  // The same message is not stacked twice.
  for (const old of container.children) if (old.dataset.message === message) old.remove();
  let timer = 0;
  const close = () => {
    clearTimeout(timer);
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 160);
  };
  const el = h('div', { class: `toast toast-${kind}`, dataset: { message }, role: kind === 'error' ? 'alert' : null },
    icon(kind === 'error' ? 'warning' : kind === 'ok' ? 'check' : 'info', { size: 18, cls: 'toast-icon' }),
    h('p', { class: 'toast-text' }, message),
    action ? h('button', { class: 'btn btn-quiet btn-sm toast-action', type: 'button', onClick: () => { close(); action.onClick(); } }, action.label) : null,
    h('button', { class: 'icon-btn icon-btn-sm toast-close', type: 'button', 'aria-label': 'Close this notice', onClick: close }, icon('close', { size: 16 })),
  );
  container.appendChild(el);
  while (container.children.length > 3) container.firstElementChild.remove();
  const ms = kind === 'error' ? Math.max(timeout, 7000) : timeout;
  if (ms > 0) timer = setTimeout(close, ms);
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => { if (ms > 0) timer = setTimeout(close, 2000); });
  return close;
}

export async function copyText(value, what = 'Copied') {
  const textValue = String(value ?? '');
  try {
    await navigator.clipboard.writeText(textValue);
  } catch {
    // Older browsers and pages without clipboard permission.
    const ta = h('textarea', { class: 'sr-only', readOnly: true, 'aria-hidden': 'true', tabIndex: -1 });
    ta.value = textValue;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    if (!ok) { toast('Copy did not work. Select the text and copy it by hand.', { kind: 'error' }); return false; }
  }
  toast(what, { kind: 'ok', timeout: 2200 });
  return true;
}
