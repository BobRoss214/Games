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
    h('p', null, h('a', { href: `${location.pathname}#e2e-far`, 'data-link': true }, 'Go to the far part')),
    h('div', { style: { height: '200vh' } }),
    h('h2', { id: 'e2e-far' }, 'The far part'),
    h('div', { style: { height: '100vh' } }),
  );
  return { el, update(p) { word.textContent = p.word || 'none'; } };
}
