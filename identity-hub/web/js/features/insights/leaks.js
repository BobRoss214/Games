// "Who leaked me": the aliases with a "possibly leaked" hint, and the sender that caused each hint.
// Worked out in the browser from the mail that it read. The rules are in lib/leak.js.
// The known senders of an alias are in its encrypted extra field "senders" (the same field as the
// hint on the alias row uses, lib/leakwatch.js). The server cannot read that field.
import { h } from '../../lib/dom.js';
import { store } from '../../lib/store.js';
import { setItemExtra, updateAlias, findAlias } from '../../lib/data.js';
import { findIdentity } from '../../lib/identities.js';
import { isUnlocked } from '../../lib/session.js';
import { expectSender, whenIdle } from '../../lib/leakwatch.js';
import { pageHeader, button, emptyState, tag, runBusy, reportError } from '../../ui/components.js';
import { icon } from '../../ui/icons.js';
import { toast } from '../../ui/toast.js';
import { why } from '../../ui/why.js';
import { leakView, knownOf } from './work.js';
import { mailReport, basisLine, day, mails } from './report.js';

const HONEST = '“Possibly leaked” is only a hint: a company can use several sender names, and the From line can be forged.';

export function leaksScreen({ scope }) {
  // After an action the pressed button is gone. The focus then goes to the card of that alias,
  // or to the heading of the screen if the card is gone too.
  const focusAfter = (aliasId) => {
    const target = report.el.querySelector(`[data-alias="${aliasId}"] h2`) || head.querySelector('h1');
    if (target) target.focus();
  };

  // "This sender is expected". If the first sender of the alias is not saved yet, it is saved first,
  // so that the new sender is added to it and does not take its place.
  async function expect(alias, known, domain) {
    let now = findAlias(alias.id) || alias;
    if (!knownOf(now).length && known.length) {
      await setItemExtra('alias', alias.id, { senders: known });
      now = findAlias(alias.id) || now;
    }
    await expectSender(now, domain);
  }

  function hintLine(alias, known, hint) {
    return h('li', { class: 'f-insights-hint', dataset: { hint: hint.domain } },
      h('div', { class: 'grow stack stack-1' },
        h('p', null, 'Mail from ', h('span', { class: 'mono strong break' }, hint.domain)),
        h('p', { class: 'small muted' }, 'Sender: ', h('span', { class: 'mono break' }, hint.fromAddress)),
        h('p', { class: 'small muted' }, `${mails(hint.count)}. First: ${day(hint.firstAt)}. Last: ${day(hint.lastAt)}.`),
      ),
      button('This sender is expected', { onClick: (e, btn) => runBusy(btn, async () => {
        await expect(alias, known, hint.domain);
        toast(`Saved. Mail from ${hint.domain} gives no hint from now on.`, { kind: 'ok' });
        focusAfter(alias.id);
      }), attrs: { 'aria-label': `This sender is expected: ${hint.domain}` } }),
    );
  }

  function card({ alias, known, hints }) {
    const id = `leak-${alias.id}`;
    const identity = alias.identityId ? findIdentity(alias.identityId) : null;
    return h('li', null, h('article', { class: 'sheet sheet-pad stack stack-3', 'aria-labelledby': id, dataset: { alias: alias.id } },
      h('div', { class: 'stack stack-2' },
        h('h2', { class: 'f-insights-address', id, tabIndex: -1 }, alias.address),
        h('div', { class: 'item-sub' },
          alias.label ? h('span', { class: 'item-label' }, alias.label) : h('span', { class: 'item-label is-empty' }, 'No label'),
          tag('Possibly leaked', 'warn'),
          alias.enabled ? null : tag('Off'),
          identity ? h('a', { class: 'tag tag-link', href: `/identities/${identity.id}`, 'data-link': true, title: `In the identity ${identity.name}` }, icon('folder', { size: 12 }), h('span', { class: 'truncate' }, identity.name)) : null,
        ),
        h('p', { class: 'small muted' }, 'Expected: ', known.map((d, i) => [i ? ', ' : '', h('span', { class: 'mono break' }, d)])),
      ),
      h('ul', { class: 'f-insights-hints' }, hints.map((hint) => hintLine(alias, known, hint))),
      alias.enabled
        ? h('div', null, button('Turn off this alias', { onClick: (e, btn) => runBusy(btn, async () => {
          await updateAlias(alias.id, { enabled: false });
          toast('Alias turned off. Mail to it is refused.', { kind: 'ok', action: { label: 'Undo', onClick: () => updateAlias(alias.id, { enabled: true }).catch(reportError) } });
          focusAfter(alias.id);
        }), attrs: { 'aria-label': `Turn off this alias: ${alias.address}` } }))
        : h('p', { class: 'small' }, 'This alias is off. Mail to it is refused.'),
    ));
  }

  function body(result, state) {
    const { rows } = leakView(result.messages, state.aliases, { complete: result.complete });
    const basis = h('p', { class: 'muted', dataset: { basis: '' } }, basisLine(result, 'Worked out in this browser'));
    if (!rows.length) {
      return h('div', { class: 'stack' },
        h('div', { class: 'sheet' }, emptyState({ title: 'No alias looks leaked', text: 'An alias shows here when it gets mail from a sender that it does not know.' })),
        basis,
      );
    }
    return h('div', { class: 'stack' },
      h('div', { class: 'stack stack-1' }, basis, h('p', { class: 'small muted', dataset: { honest: '' } }, HONEST)),
      h('ul', { class: 'stack', dataset: { list: 'leaks' } }, rows.map(card)),
    );
  }

  // An alias that knows no sender yet learns the sender of its oldest mail. That is saved, encrypted,
  // so that the hint on the alias row and this screen use the same list.
  async function learn(result) {
    try {
      await whenIdle(); // the watch of the alias rows saves the same thing; do not save it two times
      for (let i = 0; i < 100 && store.get('aliases') === null; i++) await new Promise((r) => setTimeout(r, 50));
      if (scope.disposed || !isUnlocked()) return;
      const todo = leakView(result.messages, store.get('aliases'), { complete: result.complete }).learn;
      for (const { aliasId, senders } of todo) {
        if (scope.disposed || !isUnlocked()) return;
        await setItemExtra('alias', aliasId, { senders });
      }
    } catch { /* the screen shows the hints also without the saved list; the next visit tries again */ }
  }

  const report = mailReport(scope, { paint: body, keys: ['aliases', 'identities'], again: 'Check again', stopped: 'Stopped. Nothing was checked.', onDone: learn });
  const head = pageHeader({
    title: 'Who leaked me',
    lede: 'Aliases that got mail from a sender they do not know.',
    back: { href: '/', label: 'Home' },
    actions: report.againButton,
  });
  report.start();
  return h('div', { class: 'page page-narrow' }, head, h('div', { class: 'page-why' }, why('who-leaked-me')), report.el);
}
