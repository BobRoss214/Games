// The code helper on the screens: "Code 482913 · Copy" for a text or an email that has a
// sign-up or login code. The code is found in the browser (lib/codes.js). It is sent nowhere:
// the only thing that happens with it is the copy to the clipboard when the person asks.
import { h } from '../lib/dom.js';
import { findCode } from '../lib/codes.js';
import { icon } from './icons.js';
import { copyText } from './toast.js';

// found: { code, display } from findCode(), or null. Returns an element or null.
export function codeChip(found) {
  if (!found || !found.code) return null;
  const copy = h('button', { class: 'code-copy', type: 'button', 'aria-label': `Copy the code ${found.display}` }, icon('copy', { size: 14 }), h('span', null, 'Copy'));
  // The chip can sit next to a link or a row that opens something: the click stays here.
  copy.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); copyText(found.code, 'Code copied'); });
  return h('span', { class: 'code-chip', dataset: { code: '' } },
    h('span', { class: 'code-chip-label' }, 'Code'),
    h('span', { class: 'mono code-chip-value' }, found.display),
    copy,
  );
}

// The chip for a text, or for the subject and the first words of an email. Null when there is no code.
export const codeIn = (text, subject) => codeChip(findCode(text, { subject }));
