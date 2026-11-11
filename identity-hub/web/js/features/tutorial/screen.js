// The tutorial screen (/tutorial): one step at a time, with Back, Next and a progress bar.
//
// - The words of each step come from web/js/help/content.js (TUTORIAL).
// - A step is "done" when the data of the account proves it: an inbox exists, a message arrived
//   on an alias, and so on. The mark shows without a reload.
// - The one button of a step opens the real dialog or goes to the real screen.
// - A step that costs credit shows the real price before the button. A step whose part of the
//   server is off is grey, and Next goes past it.
// - The progress is saved encrypted (see state.js). To read a step sends nothing to the server.
import { h, replace } from '../../lib/dom.js';
import { store, bus } from '../../lib/store.js';
import { navigate } from '../../lib/router.js';
import { money, plural } from '../../lib/format.js';
import { onRoute } from '../../lib/registry.js';
import { icon } from '../../ui/icons.js';
import { button, callout, tag, pageHeader, section, skeletonRows, loadError, copyButton, reportError } from '../../ui/components.js';
import { openNewInbox, openNewAlias, openGetNumber } from '../../ui/items.js';
import { openNewIdentity } from '../../ui/identity.js';
import { openPersonaDialog } from '../../ui/persona.js';
import { openLinkPhone } from '../../screens/numbers.js';
import { openTestTools } from '../../screens/testtools.js';
import { openRecoveryTest } from '../recovery-test.js';
import { progress, loadProgress, saveProgress } from './state.js';
import { STEPS, TOTAL, stepIndex, stepById, priceOf, fill, proofs, statusOf, nextIndex, prevIndex, missingFor, withProven } from './steps.js';
import { extra, onExtra, refreshExtra, watchStep, stopWatch } from './watch.js';

// The last step offers "Open Help" only when the Help screen exists.
let helpExists = false;
onRoute((r) => { if (r.path === '/help') helpExists = true; });

const fresh = () => ({ v: 1, step: '', done: [], skipped: [], state: 'active' });
const article = (thing) => (/^[aeiou]/.test(thing) ? 'an' : 'a');
const dialogOpen = () => !!document.querySelector('dialog[open]');
const stepText = (n) => `Step ${n} of ${TOTAL}`;

export default function screen({ scope }) {
  // The person is here again: the notice with "Back to the tutorial" is not needed.
  stopWatch();
  // The page is painted again and again. The line for screen readers must stay the same
  // element, so it lives next to the painted part.
  const body = h('div', null);
  const live = h('p', { class: 'sr-only', role: 'status' });
  const root = h('div', { class: 'page page-narrow f-tutorial' }, body, live);
  let shown = { id: '', status: '' }; // what the last paint showed, to say "done" one time
  let index = -1;          // the step on the screen; -1 until the progress is read
  let failed = '';         // why the progress did not load
  let focusTitle = false;  // after a change of step, the title of the new step gets the focus
  let dirty = false;       // a paint that waits until the open dialog closes

  const listsReady = (app) => app.mailboxes !== null && app.aliases !== null && app.numbers !== null && app.phones !== null && app.identities !== null;
  const provenNow = () => proofs(store.get(), extra);

  // ---- changes of the progress (each one is one encrypted write) ----

  const settle = (old, change) => {
    const base = old || fresh();
    const merged = withProven(base, provenNow());
    const next = { v: 1, step: STEPS[index].id, done: merged.done, skipped: merged.skipped, state: base.state === 'finished' ? 'finished' : 'active' };
    change(next);
    next.skipped = next.skipped.filter((id) => !next.done.includes(id));
    return next;
  };
  const save = (change, opts) => saveProgress((old) => settle(old, change), opts).catch(reportError);

  function go(to, { skip = false } = {}) {
    const from = STEPS[index];
    index = to;
    focusTitle = true;
    save((next) => {
      // The first step has nothing to do: to leave it is to do it.
      if (from.id === 'welcome' && !next.done.includes('welcome')) next.done.push('welcome');
      if (skip && !next.done.includes(from.id) && !next.skipped.includes(from.id)) next.skipped.push(from.id);
    });
    paint();
  }
  function markDone(id) {
    save((next) => { if (!next.done.includes(id)) next.done.push(id); });
    requestPaint();
  }
  function finish() {
    save((next) => {
      for (const id of ['welcome', 'finish']) if (!next.done.includes(id)) next.done.push(id);
      next.state = 'finished';
    });
    paint();
  }
  function startAgain() {
    index = 0;
    focusTitle = true;
    saveProgress(() => ({ v: 1, step: STEPS[0].id, done: [], skipped: [], state: 'active' }), { keep: false }).catch(reportError);
    paint();
  }
  // The step sends the person to a different screen. A notice there offers the way back.
  function leave(path, stepId, test = null) {
    watchStep(stepId, test);
    navigate(path);
  }

  // ---- the one button of a step ----

  function actionOf(step, app) {
    const dev = !!(app.config && app.config.dev);
    switch (step.id) {
      case 'recovery-key': return { label: 'Test my recovery key', icon: 'key', run: async () => { if (await openRecoveryTest()) markDone('recovery-key'); } };
      case 'passkey': return { label: 'Open Settings', icon: 'settings', run: () => navigate('/settings') };
      case 'funds': return { label: 'Open Funds', icon: 'funds', run: () => leave('/funds', 'funds') };
      case 'inbox': return { label: 'Make inbox', icon: 'plus', run: () => openNewInbox() };
      case 'alias': return { label: 'Make alias', icon: 'plus', run: () => openNewAlias() };
      case 'first-mail': return dev
        ? { label: 'Open test tools', icon: 'tools', run: () => openTestTools('mail') }
        : { label: 'Open Mail', icon: 'mail', run: () => leave('/mail', 'first-mail') };
      case 'alias-off': return { label: 'Open Aliases', icon: 'alias', run: () => leave('/aliases', 'alias-off') };
      case 'identity': return { label: 'Make identity', icon: 'plus', run: () => openNewIdentity({ open: false }) };
      case 'made-up-details': {
        const a = (app.aliases || [])[0];
        const n = (app.numbers || [])[0];
        const item = a ? { kind: 'alias', id: a.id } : n ? { kind: 'number', id: n.id } : null;
        return item ? { label: 'Open the random identifiers generator', icon: 'person', run: () => openPersonaDialog(item) } : null;
      }
      // After the purchase the app opens the screen of the new number.
      case 'number': return { label: 'Get a number', icon: 'plus', run: () => { watchStep('number'); openGetNumber(); } };
      case 'first-text': {
        const n = (app.numbers || [])[0];
        return n ? { label: 'Open my number', icon: 'message', run: () => leave(`/numbers/${n.id}`, 'first-text') } : null;
      }
      case 'link-phone': return { label: 'Link a phone', icon: 'phone', run: () => openLinkPhone() };
      case 'finish': return helpExists ? { label: 'Open Help', icon: 'info', run: () => navigate('/help') } : null;
      default: return null;
    }
  }

  // ---- parts of the screen ----

  function statusTag(st) {
    if (st === 'done') return tag('Done', 'ok');
    if (st === 'skipped') return tag('Skipped');
    if (st === 'off') return tag('Turned off');
    return null;
  }

  // What the person does in this step: the sentence, the price, the button, and the ways around it.
  function doPart(step, st, app) {
    const t = (text) => fill(text, step, app.config);
    if (st === 'off') return h('div', { class: 'f-tutorial-do stack stack-3' }, h('p', { class: 'read muted' }, t(step.offNote)));
    if (st === 'done') return h('div', { class: 'f-tutorial-do' }, callout('ok', t(step.done)));

    const dev = !!(app.config && app.config.dev);
    const payOn = !!(app.config && app.config.features && app.config.features.pay);
    const price = priceOf(step, app.config);
    const missing = missingFor(step, app);
    const skip = () => button('Skip this step', { attrs: { 'data-key': 'skip' }, onClick: () => go(nextIndex(index, app.config), { skip: true }) });
    const parts = [
      h('div', { class: 'stack stack-1' }, h('p', { class: 'label' }, 'Do it now'), h('p', { class: 'read' }, t(dev && step.doItTest ? step.doItTest : step.doIt))),
    ];
    let buttons = [];

    if (missing) {
      // The step builds on an earlier step that was skipped.
      const earlier = stepById(missing.stepId);
      parts.push(callout('info', `This step needs ${article(missing.thing)} ${missing.thing}`, h('p', null, `You have no ${missing.thing} yet.`)));
      buttons = [
        button(`Go to “${fill(earlier.title, earlier, app.config)}”`, { attrs: { 'data-key': 'action' }, onClick: () => go(stepIndex(earlier.id)) }),
        skip(),
      ];
    } else if (price > 0 && app.balance < price) {
      // Never a dead end: add funds, or skip the step.
      const fundsStep = stepById('funds');
      parts.push(callout('warn', 'Your balance is too low for this step',
        h('p', null, 'This step costs ', h('span', { class: 'mono' }, money(price)), '. Your balance is ', h('span', { class: 'mono' }, money(app.balance)), '.'),
        payOn || !fundsStep ? null : h('p', null, fill(fundsStep.offNote, fundsStep, app.config)),
      ));
      buttons = [
        payOn ? button('Add funds', { kind: 'primary', iconName: 'funds', attrs: { 'data-key': 'action' }, onClick: () => leave('/funds', 'funds', () => store.get('balance') >= price) }) : null,
        skip(),
      ];
    } else {
      if (price !== null) {
        parts.push(h('p', { class: 'price-note' }, icon('funds', { size: 16 }), price > 0
          ? h('span', null, 'This step costs ', h('span', { class: 'mono' }, money(price)), '. Your balance is ', h('span', { class: 'mono' }, money(app.balance)), '.')
          : h('span', null, 'This step costs nothing on this server.')));
      }
      // The address to send the first mail to, when no test tools exist.
      if (step.id === 'first-mail' && !dev) {
        const alias = (app.aliases || []).find((a) => a.enabled) || (app.aliases || [])[0];
        if (alias) parts.push(h('div', { class: 'row row-2' }, h('span', { class: 'mono break' }, alias.address), copyButton(() => alias.address, 'Copy address', { what: 'Address copied' })));
      }
      const action = actionOf(step, app);
      buttons = [
        action ? button(action.label, { kind: 'primary', iconName: action.icon, attrs: { 'data-key': 'action' }, onClick: () => action.run() }) : null,
        step.skipNote ? skip() : null,
      ];
    }
    if (buttons.some(Boolean)) parts.push(h('div', { class: 'row row-wrap' }, buttons));
    if (step.skipNote) parts.push(h('p', { class: 'hint' }, t(step.skipNote)));
    return h('div', { class: 'f-tutorial-do stack stack-3' }, parts);
  }

  // After the end: what was done, and how to do the rest later.
  function summary(statuses) {
    const count = (st) => statuses.filter((x) => x === st).length;
    const open = count('todo') + count('skipped');
    const off = count('off');
    return h('p', { class: 'read' },
      `You did ${count('done')} of ${TOTAL} steps.`,
      open ? ` ${plural(open, 'step')} ${open === 1 ? 'is' : 'are'} not done. To do one later, select it in the list below.` : '',
      off ? ` ${plural(off, 'step')} ${off === 1 ? 'is' : 'are'} turned off on this server.` : '',
    );
  }

  function stepList(statuses, app) {
    return section({ title: 'All steps' },
      h('div', { class: 'sheet item-sheet' }, h('ol', { class: 'item-list f-tutorial-steps' }, STEPS.map((step, i) => {
        const st = statuses[i];
        const title = fill(step.title, step, app.config);
        const here = i === index;
        return h('li', { class: `phone-row ${st === 'off' ? 'f-tutorial-off' : ''}`.trim(), 'aria-current': here ? 'step' : null, dataset: { step: step.id, status: st } },
          h('span', { class: 'item-icon mono small', 'aria-hidden': 'true' }, st === 'done' ? icon('check', { size: 18 }) : String(i + 1)),
          h('div', { class: 'item-main' },
            h('span', { class: 'item-value' }, h('span', { class: 'sr-only' }, `Step ${i + 1}: `), title),
            st === 'off' ? h('p', { class: 'hint' }, fill(step.offNote, step, app.config)) : null,
          ),
          // The state in words on the right, so that every line has the same height.
          h('div', { class: 'item-actions' }, h('div', { class: 'row row-2' },
            here ? tag('You are here') : null,
            statusTag(st),
            st === 'off' || here ? null : button('Open', { size: 'sm', attrs: { 'aria-label': `Open step ${i + 1}: ${title}`, 'data-key': `open-${step.id}` }, onClick: () => go(i) }),
          )),
        );
      }))),
    );
  }

  // ---- paint ----

  function paint() {
    if (scope.disposed) return;
    dirty = false;
    const app = store.get();
    const saved = progress.get('value');
    if (failed) {
      replace(body, pageHeader({ title: 'Tutorial' }), loadError(failed, () => { failed = ''; paint(); start(); }));
      return;
    }
    if (saved === undefined || !listsReady(app)) {
      replace(body, pageHeader({ title: 'Tutorial' }), skeletonRows(4));
      return;
    }
    if (index < 0) {
      index = saved && saved.step ? stepIndex(saved.step) : 0;
      // The two proofs that the store does not have. Asked one time, for every step alike.
      refreshExtra();
    }

    const active = document.activeElement;
    const hadKey = active && body.contains(active) ? (active.dataset.key || 'title') : null;

    const ctx = { config: app.config, saved, proven: provenNow() };
    const statuses = STEPS.map((s) => statusOf(s, ctx));
    const step = STEPS[index];
    const st = statuses[index];
    const t = (text) => fill(text, step, app.config);
    const finished = !!saved && saved.state === 'finished';
    const last = index === TOTAL - 1;
    const back = prevIndex(index, app.config);
    const next = nextIndex(index, app.config);

    const title = h('h2', { id: 'tutorial-step-title', tabIndex: -1, 'data-key': 'title' }, t(step.title));
    const nav = h('div', { class: 'f-tutorial-nav' },
      back !== index ? button('Back', { iconName: 'arrowLeft', attrs: { 'data-key': 'back' }, onClick: () => go(back) }) : h('span', null),
      last
        ? (finished
          ? button('Go to Home', { kind: 'primary', attrs: { 'data-key': 'next' }, onClick: () => navigate('/') })
          : button('Finish the tutorial', { kind: 'primary', iconName: 'check', attrs: { 'data-key': 'next' }, onClick: finish }))
        : button('Next', { kind: 'primary', iconAfter: 'arrowRight', attrs: { 'data-key': 'next' }, onClick: () => go(next) }),
    );

    replace(body,
      pageHeader({ title: 'Tutorial' }),
      h('div', { class: 'f-tutorial-progress' },
        h('p', { class: 'small strong nowrap', id: 'tutorial-progress-text' }, stepText(index + 1)),
        h('div', { class: 'progress grow', role: 'progressbar', 'aria-label': 'Tutorial', 'aria-valuemin': '1', 'aria-valuemax': String(TOTAL), 'aria-valuenow': String(index + 1), 'aria-valuetext': stepText(index + 1) },
          h('div', { class: 'progress-bar', style: { width: `${Math.round(((index + 1) / TOTAL) * 100)}%` } })),
      ),
      h('section', { class: `sheet sheet-pad stack ${st === 'off' ? 'f-tutorial-off' : ''}`.trim(), 'aria-labelledby': 'tutorial-step-title', dataset: { step: step.id, status: st } },
        h('div', { class: 'row row-between row-top' }, title, statusTag(st)),
        h('div', { class: 'stack stack-1' }, h('p', { class: 'label' }, 'What it is'), h('p', { class: 'read' }, t(step.what))),
        h('div', { class: 'stack stack-1' }, h('p', { class: 'label' }, 'Why it exists'), h('p', { class: 'read' }, t(step.why))),
        doPart(step, st, app),
        last && finished ? summary(statuses) : null,
        last && finished ? h('div', null, button('Start again', { iconName: 'refresh', attrs: { 'data-key': 'again' }, onClick: startAgain })) : null,
      ),
      nav,
      stepList(statuses, app),
    );

    // A screen reader hears the sentence when the step on the screen becomes done.
    if (shown.id === step.id && shown.status !== 'done' && st === 'done') live.textContent = t(step.done);
    else if (shown.id !== step.id) live.textContent = '';
    shown = { id: step.id, status: st };

    if (focusTitle) {
      focusTitle = false;
      window.scrollTo(0, 0);
      title.focus({ preventScroll: true });
    } else if (hadKey !== null) {
      // The part with the focus was made again. Keep the focus on the same control, or on "Next".
      const same = body.querySelector(`[data-key="${CSS.escape(hadKey)}"]`) || body.querySelector('[data-key="next"]') || title;
      same.focus({ preventScroll: true });
    }
  }

  // A dialog of the app is open on top of this screen (New inbox, Test tools). To paint now
  // would remove the button that the focus goes back to. Paint when the dialog is closed.
  function requestPaint() {
    if (scope.disposed) return;
    if (index >= 0 && dialogOpen()) { dirty = true; return; }
    paint();
  }
  const dialogs = new MutationObserver(() => {
    if (!dirty) return;
    // One dialog can open the next one ("Inbox made"). Wait a moment before the look.
    setTimeout(() => { if (dirty && !scope.disposed && !dialogOpen()) paint(); }, 80);
  });
  dialogs.observe(document.body, { childList: true });
  scope.add(() => dialogs.disconnect());

  scope.add(store.subscribe(['config', 'balance', 'mailboxes', 'aliases', 'numbers', 'phones', 'identities'], requestPaint));
  scope.add(onExtra(requestPaint));
  // A text was sent or came in while this screen is open.
  scope.add(bus.on('text', () => { if (index >= 0) refreshExtra({ passkeys: false }); }));

  function start() {
    loadProgress().then(() => requestPaint(), (err) => { failed = (err && err.message) || 'Check your connection, then try again.'; paint(); });
  }
  paint();
  start();
  return root;
}
