// "My stats": which alias gets the most mail, and who mails the person most.
// Counted in the browser each time the screen opens. Nothing is saved, in the browser or on the server.
import { h } from '../../lib/dom.js';
import { pageHeader, section, button, emptyState, tag } from '../../ui/components.js';
import { statsView } from './work.js';
import { mailReport, basisLine, day, count } from './report.js';

const TOP = 10; // a list shows this many lines first

export function statsScreen({ scope }) {
  const all = { aliases: false, senders: false }; // "Show all" was used

  // One ranked list. line(row) gives { main, sub, count } for one row.
  function ranked(name, rows, line) {
    const shown = all[name] ? rows : rows.slice(0, TOP);
    return h('div', { class: 'stack stack-3' },
      h('div', { class: 'sheet item-sheet' }, h('ol', { class: 'item-list', dataset: { list: name } }, shown.map((row, i) => {
        const { main, sub, n } = line(row);
        return h('li', { class: 'phone-row' },
          h('span', { class: 'item-icon mono small', 'aria-hidden': 'true' }, String(i + 1)),
          h('div', { class: 'item-main' }, main, sub ? h('div', { class: 'item-sub' }, sub) : null),
          h('div', { class: 'item-actions' }, h('span', { class: 'nowrap', dataset: { count: '' } }, h('span', { class: 'mono strong' }, count(n)), h('span', { class: 'small muted' }, n === 1 ? ' mail' : ' mails'))),
        );
      }))),
      rows.length > shown.length ? h('div', null, button(`Show all ${rows.length}`, { onClick: () => { all[name] = true; report.repaint(); } })) : null,
    );
  }

  function body(result, state) {
    const view = statsView(result.messages, state.aliases);
    if (!view.total) return h('div', { class: 'sheet' }, emptyState({ title: 'No mail yet', text: 'When mail arrives, the counts show here.' }));
    return [
      h('p', { class: 'muted', dataset: { basis: '' } }, basisLine(result, 'Counted')),
      section({ title: 'Aliases with the most mail' },
        view.aliases.length
          ? ranked('aliases', view.aliases, ({ alias, count, lastAt }) => ({
            main: h('span', { class: 'item-value mono', title: alias.address }, alias.address),
            sub: [
              alias.label ? h('span', { class: 'item-label' }, alias.label) : h('span', { class: 'item-label is-empty' }, 'No label'),
              alias.enabled ? null : tag('Off'),
              h('span', { class: 'small faint' }, `Last mail ${day(lastAt)}`),
            ],
            n: count,
          }))
          : h('div', { class: 'sheet' }, emptyState({ title: 'No mail to an alias yet', compact: true, figure: false })),
      ),
      section({ title: 'Who mails you most', lede: 'A sender name can be forged. This is a count of what the mails say.' },
        view.senders.length
          ? ranked('senders', view.senders, ({ domain, count, lastAt }) => ({
            main: h('span', { class: 'item-value mono', title: domain }, domain),
            sub: h('span', { class: 'small faint' }, `Last mail ${day(lastAt)}`),
            n: count,
          }))
          : h('div', { class: 'sheet' }, emptyState({ title: 'No sender to count', compact: true, figure: false })),
      ),
    ];
  }

  const report = mailReport(scope, { paint: body, keys: ['aliases'], again: 'Count again' });
  report.start();
  return h('div', { class: 'page page-narrow' },
    pageHeader({
      title: 'My stats',
      lede: 'Counted in this browser. The server keeps no stats.',
      back: { href: '/', label: 'Home' },
      actions: report.againButton,
    }),
    report.el,
  );
}
