// A small action menu ("…" button). Arrow keys move, Escape closes, Tab leaves.
import { h, uid } from '../lib/dom.js';
import { icon } from './icons.js';

let closeOpen = null;

// items: array or function returning an array of
// { label, icon?, onSelect, danger?, disabled?, hint? } or 'separator'
// text: show a normal button with this text (and a small arrow) in place of the "…" icon.
// content: own children for the button (it then gets only the classes in cls). They must hold visible text.
export function menuButton({ label, items, iconName = 'more', cls = '', text = '', content = null }) {
  const id = uid('menu');
  const named = !!(text || content);
  const btn = h('button', {
    class: `${content ? '' : text ? 'btn' : 'icon-btn'} ${cls}`.trim(), type: 'button', 'aria-label': named ? null : label, title: named ? null : label, 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': id,
    onClick: (e) => { e.stopPropagation(); if (btn.getAttribute('aria-expanded') === 'true') closeOpen?.(); else open(); },
    onKeydown: (e) => { if (e.key === 'ArrowDown' || (content && e.key === 'ArrowUp')) { e.preventDefault(); open(); } },
  }, content || (text ? [iconName !== 'more' ? icon(iconName, { size: 18 }) : null, h('span', { class: 'btn-label' }, text), icon('chevronDown', { size: 16 })] : icon(iconName, { size: 18 })));

  function open() {
    closeOpen?.();
    const list = (typeof items === 'function' ? items() : items).filter(Boolean);
    const menu = h('div', { class: 'menu', id, role: 'menu', 'aria-label': label });
    for (const item of list) {
      if (item === 'separator') { menu.appendChild(h('div', { class: 'menu-sep', role: 'separator' })); continue; }
      menu.appendChild(h('button', {
        class: `menu-item ${item.danger ? 'is-danger' : ''}`.trim(), type: 'button', role: 'menuitem', tabIndex: -1, disabled: !!item.disabled,
        onClick: () => { close(true); item.onSelect(); },
      }, item.icon ? icon(item.icon, { size: 16 }) : h('span', { class: 'menu-gap' }), h('span', null, item.label)));
    }
    // The menu is a child of the open dialog (if any) so that it shows above it.
    const host = btn.closest('dialog') || document.body;
    host.appendChild(menu);
    place(menu);
    btn.setAttribute('aria-expanded', 'true');
    const itemsEls = () => [...menu.querySelectorAll('.menu-item:not(:disabled)')];
    const first = itemsEls()[0];
    if (first) first.focus();

    const onKey = (e) => {
      const els = itemsEls();
      const i = els.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
      else if (e.key === 'Home') { e.preventDefault(); els[0]?.focus(); }
      else if (e.key === 'End') { e.preventDefault(); els[els.length - 1]?.focus(); }
      else if (e.key === 'Tab') close(false);
    };
    const onDown = (e) => { if (!menu.contains(e.target) && !btn.contains(e.target)) close(false); };
    // The page moved (a scroll, a list that painted again): the menu follows its button.
    // It does not close, or a background update could take the menu away under the pointer.
    const onScroll = (e) => { if (!menu.contains(e.target) && btn.isConnected) place(menu); };
    menu.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);

    function close(refocus) {
      menu.remove();
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
      if (closeOpen === close) closeOpen = null;
      if (refocus && btn.isConnected) btn.focus();
    }
    closeOpen = close;
  }

  function place(menu) {
    const r = btn.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const pad = 8;
    let left = r.right - mw;
    if (left < pad) left = Math.min(r.left, window.innerWidth - mw - pad);
    let top = r.bottom + 4;
    if (top + mh > window.innerHeight - pad) top = Math.max(pad, r.top - mh - 4);
    menu.style.left = `${Math.max(pad, left)}px`;
    menu.style.top = `${top}px`;
  }

  return btn;
}

export function closeMenus() { closeOpen?.(); }
