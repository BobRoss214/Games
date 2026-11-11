// "Possibly leaked": a mark on an alias that got mail from a sender it does not know, and a
// panel in that mail with "This sender is expected" and "Turn off this alias".
// The watching is in lib/leakwatch.js, the rules are in lib/leak.js. Browser only.
import { h } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { registerRowBadge, registerMessagePanel } from '../lib/registry.js';
import { startLeakWatch, leakOf, knownSenders, expectSender } from '../lib/leakwatch.js';
import { updateAlias } from '../lib/data.js';
import { button, callout, runBusy, reportError, tag } from '../ui/components.js';
import { toast } from '../ui/toast.js';

startLeakWatch();

registerRowBadge('alias', (item) => {
  const hints = (store.get('leaks') || {})[item.id];
  if (!hints || !hints.length) return null;
  const mark = tag('Possibly leaked', 'warn');
  mark.title = `Mail from a sender that this alias does not know: ${hints.map((x) => x.domain).join(', ')}. Open the mail to decide.`;
  mark.dataset.leak = '';
  return mark;
});

const list = (domains) => domains.map((d, i) => [i ? (i === domains.length - 1 ? ' and ' : ', ') : '', h('span', { class: 'mono strong break' }, d)]);

registerMessagePanel((message, alias) => {
  const hint = leakOf(message, alias);
  if (!hint) return null;
  const known = knownSenders(alias);
  return h('div', { dataset: { leakPanel: hint.domain } }, callout('warn', 'This alias was possibly leaked',
    h('p', null, 'This alias normally gets mail from ', list(known), '. This message says that it is from ', h('span', { class: 'mono strong break' }, hint.domain), '.'),
    h('p', null, 'It is only a hint: the From line of a mail can be forged, and one company can use several domains.'),
    h('div', { class: 'row row-wrap row-2 leak-actions' },
      button('This sender is expected', { size: 'sm', onClick: (e, btn) => runBusy(btn, async () => {
        await expectSender(alias, hint.domain);
        toast(`Saved. Mail from ${hint.domain} gives no hint from now on.`, { kind: 'ok' });
      }) }),
      alias.enabled ? button('Turn off this alias', { size: 'sm', onClick: (e, btn) => runBusy(btn, async () => {
        await updateAlias(alias.id, { enabled: false });
        toast('Alias turned off. Mail to it is refused.', { kind: 'ok', action: { label: 'Undo', onClick: () => updateAlias(alias.id, { enabled: true }).catch(reportError) } });
      }) }) : h('span', { class: 'small' }, 'This alias is off. Mail to it is refused.'),
    ),
  ));
});
