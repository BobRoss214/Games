// A small "Why?" button that opens a short explanation in place, and closes it again.
//
// The words come from web/js/help/content.js. That file loads with the app, so opening
// an explanation asks the server for nothing and saves nothing ("do not track what I read").
// No navigation. Works with the keyboard: Enter or Space opens and closes, Escape closes.
import { h, uid } from '../lib/dom.js';
import { appName } from '../lib/store.js';
import { icon } from './icons.js';
import { WHY } from '../help/content.js';

const words = (text) => String(text).split('{app}').join(appName());

// Returns { button, panel } for the places where the two cannot sit in one box:
// put the button next to the thing and the panel under it.
// key: a key of WHY in help/content.js. text: the words on the button.
// (the question itself when left out; pass 'Why?' where the place is tight and the thing is clear).
export function whyParts(key, { text = '' } = {}) {
  const entry = WHY[key];
  if (!entry) return { button: null, panel: null };
  const id = uid('why');
  const titleId = `${id}-title`;
  const title = words(entry.title);
  text = text || title;
  const close = h('button', { class: 'btn btn-quiet btn-sm why-close', type: 'button' }, 'Close');
  const panel = h('div', { class: 'why-panel', id, role: 'region', 'aria-labelledby': titleId, hidden: true, dataset: { why: key } },
    h('p', { class: 'why-title', id: titleId }, title),
    entry.paragraphs.map((p) => h('p', null, words(p))),
    h('div', null, close),
  );
  const button = h('button', { class: 'why-btn', type: 'button', 'aria-expanded': 'false', 'aria-controls': id, dataset: { why: key } },
    icon('info', { size: 14 }),
    h('span', null, text),
    // The whole question for screen readers, so that two "Why?" buttons on one screen do not sound the same.
    text === title ? null : h('span', { class: 'sr-only' }, ` ${title}`),
  );
  const setOpen = (open, refocus = false) => {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (refocus) button.focus();
  };
  button.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); setOpen(panel.hidden); });
  close.addEventListener('click', () => setOpen(false, true));
  // Escape closes the explanation only (not the dialog around it).
  const onKey = (e) => {
    if (e.key !== 'Escape' || panel.hidden) return;
    e.preventDefault();
    e.stopPropagation();
    setOpen(false, true);
  };
  button.addEventListener('keydown', onKey);
  panel.addEventListener('keydown', onKey);
  return { button, panel };
}

// The button with its explanation under it, as one block.
export function why(key, opts) {
  const { button, panel } = whyParts(key, opts);
  return button ? h('div', { class: 'why' }, button, panel) : null;
}

// Two or more buttons on one line, with their explanations under the line.
// entries: [[key, { text }], ...]
export function whyGroup(entries) {
  const parts = entries.map(([key, opts]) => whyParts(key, opts)).filter((p) => p.button);
  return h('div', { class: 'why' }, h('div', { class: 'why-line' }, parts.map((p) => p.button)), parts.map((p) => p.panel));
}
