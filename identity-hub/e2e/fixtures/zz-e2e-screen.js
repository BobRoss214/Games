// The screen of the test-only feature (see zz-e2e.js). It loads when its path is opened.
import { h } from '../lib/dom.js';
import { pageHeader } from '../ui/components.js';

window.e2eScreenLoads = (window.e2eScreenLoads || 0) + 1;

export default function screen({ params }) {
  const word = h('p', { class: 'e2e-word' }, params.word || 'none');
  const el = h('div', { class: 'page page-narrow' },
    pageHeader({ title: 'Test place' }),
    word,
    h('p', null, h('a', { href: '/e2e/pear', 'data-link': true }, 'Go to pear')),
  );
  return { el, update(p) { word.textContent = p.word || 'none'; } };
}
