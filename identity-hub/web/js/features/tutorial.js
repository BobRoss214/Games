// The guided tutorial: its screen (/tutorial), the offer on Home, and the "Tutorial" section in Settings.
// The screen and the words of the steps load when they are needed. The progress is saved
// encrypted in the vault (see tutorial/state.js). Nothing goes into browser storage.
import { h, region } from '../lib/dom.js';
import { navigate } from '../lib/router.js';
import { store } from '../lib/store.js';
import { registerRoute, registerHomeSection, registerSettingsSection } from '../lib/registry.js';
import { button, reportError } from '../ui/components.js';
import { progress, loadProgress, saveProgress } from './tutorial/state.js';

const PATH = '/tutorial';
registerRoute(PATH, () => import('./tutorial/screen.js'), { title: 'Tutorial', nav: 'home' });

// The steps (with the words from the help content) load with the first card that needs them.
let steps = null;
let loading = null;
function ready() {
  if (!loading) {
    loading = Promise.all([loadProgress(), steps ? null : import('./tutorial/steps.js').then((m) => { steps = m; })])
      .finally(() => { loading = null; });
  }
  return loading;
}
// A part that shows the progress. It paints again when the progress changes and when the steps are loaded.
function progressPart(scope, render) {
  const el = region(scope, progress, ['value'], (s) => (steps && s.value !== undefined ? render(s.value) : null));
  ready().then(() => { if (!scope.disposed) el.repaint(); }, () => { /* no card is better than a broken card */ });
  return el;
}

const started = (saved) => !!saved && (saved.state === 'active' || saved.state === 'finished' || saved.done.length > 0 || saved.step !== '');
const place = (saved) => {
  const i = steps.stepIndex(saved.step);
  const step = steps.STEPS[i];
  return `Step ${i + 1} of ${steps.TOTAL}: ${steps.fill(step.title, step, store.get('config'))}`;
};

const startNow = (keepSteps) => saveProgress((old) => (keepSteps && old
  ? { ...old, state: 'active' }
  : { v: 1, step: steps.STEPS[0].id, done: [], skipped: [], state: 'active' }), { keep: keepSteps });
function start({ again = false } = {}) {
  const saved = progress.get('value');
  // A tutorial that is active already needs no write: only the way to its screen.
  if (again || !saved || saved.state !== 'active') startNow(!again).catch(reportError);
  navigate(PATH);
}
// "Not now" and "Stop": the card on Home goes away. The steps that were done stay saved.
function dismiss() {
  saveProgress((old) => ({ v: 1, step: old ? old.step : '', done: old ? old.done : [], skipped: old ? old.skipped : [], state: 'dismissed' })).catch(reportError);
}

// ---- Home: the offer for a new account, or the way back to a tutorial that is not finished ----
function homeCard(saved) {
  const state = saved ? saved.state : 'offered';
  if (state !== 'offered' && state !== 'active') return null;
  const active = state === 'active';
  const first = steps.STEPS[0];
  return h('section', { class: 'sheet sheet-pad f-tutorial-card', 'aria-labelledby': 'tutorial-card-title' },
    h('div', { class: 'grow stack stack-1' },
      h('h2', { class: 'section-title', id: 'tutorial-card-title' }, active ? 'Continue the tutorial' : 'Take the tutorial'),
      h('p', { class: 'small muted read' }, active ? place(saved) : steps.fill(first.what, first, store.get('config'))),
    ),
    h('div', { class: 'row row-wrap row-2' },
      active
        ? button('Stop the tutorial', { kind: 'quiet', onClick: dismiss })
        : button('Not now', { kind: 'quiet', onClick: dismiss }),
      active
        ? button('Continue the tutorial', { kind: 'primary', iconAfter: 'arrowRight', onClick: () => navigate(PATH) })
        : button('Start the tutorial', { kind: 'primary', iconAfter: 'arrowRight', onClick: () => start() }),
    ),
  );
}
registerHomeSection({ id: 'tutorial', order: 5, render: ({ scope }) => progressPart(scope, homeCard) });

// ---- Settings: play the tutorial again ----
function settingsPart(saved) {
  const active = !!saved && saved.state === 'active';
  const finished = !!saved && saved.state === 'finished';
  const line = active ? `You are at ${place(saved).replace(/^Step/, 'step')}.`
    : finished ? 'You finished the tutorial.'
    : started(saved) ? `You stopped at ${place(saved).replace(/^Step/, 'step')}.`
    : 'You did not start the tutorial yet.';
  return h('div', { class: 'stack stack-3' },
    h('p', { class: 'read' }, line),
    h('div', { class: 'row row-wrap' },
      active || (started(saved) && !finished) ? button('Continue the tutorial', { kind: 'primary', onClick: () => start() }) : null,
      started(saved)
        ? button('Start again', { iconName: 'refresh', onClick: () => start({ again: true }) })
        : button('Start the tutorial', { kind: 'primary', onClick: () => start() }),
    ),
  );
}
registerSettingsSection({
  id: 'tutorial',
  title: 'Tutorial',
  lede: 'The tutorial shows you the main parts, one step at a time. Your progress is saved encrypted. The server cannot read it.',
  order: 70,
  render: ({ scope }) => progressPart(scope, settingsPart),
});
