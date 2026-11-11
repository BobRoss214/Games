// Two helpers for the tutorial that live outside its screen.
//
// 1. Two proofs that are not in the store: "a passkey exists" and "a text was sent".
//    They are asked when the tutorial screen opens (the same requests for every step, so they
//    do not tell the server which step the person reads) and after the person sent a text.
// 2. The way back. A step can send the person to a different screen (Funds, Aliases, a number).
//    When the data shows that the step is done, a notice says so and offers "Back to the tutorial".
//    This is kept in memory only. After a reload, Home has the way back.
import { store, bus } from '../../lib/store.js';
import { api } from '../../lib/api.js';
import { navigate } from '../../lib/router.js';
import { listTexts } from '../../lib/phone.js';
import { onForget } from '../../lib/session.js';
import { toast } from '../../ui/toast.js';
import { progress, saveProgress } from './state.js';
import { proofs, stepById, fill, withProven } from './steps.js';

const TUTORIAL_PATH = '/tutorial';
const MAX_NUMBERS = 8; // numbers that are asked for a sent text

export const extra = { passkeys: 0, sentText: false };
const listeners = new Set();
// fn runs when one of the two proofs changed. Returns the function that stops it.
export function onExtra(fn) { listeners.add(fn); return () => listeners.delete(fn); }

let asking = null;
// Asks the server for the two proofs that are not known yet. A step that is saved as done is not asked again.
export function refreshExtra({ passkeys = true, texts = true } = {}) {
  if (asking) return asking;
  const saved = progress.get('value');
  const saidDone = (id) => !!saved && saved.done.includes(id);
  const before = `${extra.passkeys}/${extra.sentText}`;
  const jobs = [];
  if (passkeys && !extra.passkeys && !saidDone('passkey')) {
    jobs.push(api.get('/api/passkeys').then((res) => { extra.passkeys = ((res && res.passkeys) || []).length; }));
  }
  const numbers = store.get('numbers') || [];
  if (texts && !extra.sentText && !saidDone('first-text')) {
    for (const n of numbers.slice(0, MAX_NUMBERS)) {
      jobs.push(listTexts(n.id, { limit: 100 }).then((res) => { if (res.texts.some((t) => t.direction === 'out')) extra.sentText = true; }));
    }
  }
  if (jobs.length === 0) return Promise.resolve();
  // A request that fails proves nothing. The step then stays open.
  asking = Promise.allSettled(jobs).then(() => {
    asking = null;
    if (`${extra.passkeys}/${extra.sentText}` !== before) for (const fn of [...listeners]) fn();
  });
  return asking;
}

// ---- the way back ----
let waiting = '';   // id of the step that the person went away to do
let reached = null; // an own test for "done", or null for the proof of the step
let stops = [];

export function stopWatch() {
  waiting = '';
  reached = null;
  for (const stop of stops) stop();
  stops = [];
}

function announce(step) {
  // The person is on the tutorial screen (again): the screen shows the result itself.
  if (location.pathname === TUTORIAL_PATH) return;
  // The person did something: the done steps are saved now (one encrypted write).
  if (progress.get('value')) {
    const proven = proofs(store.get(), extra);
    saveProgress((old) => (old ? { ...old, ...withProven(old, proven) } : old)).catch(() => { /* the screen saves it with the next step */ });
  }
  toast(fill(step.done, step, store.get('config')), {
    kind: 'ok', timeout: 12000,
    action: { label: 'Back to the tutorial', onClick: () => navigate(TUTORIAL_PATH) },
  });
}

function check() {
  if (!waiting) return;
  if (!(reached ? reached() : proofs(store.get(), extra).has(waiting))) {
    // A sent text is not in the store. Ask for it when something changed.
    if (waiting === 'first-text') refreshExtra({ passkeys: false }).then(() => { if (extra.sentText) check(); });
    return;
  }
  const step = stepById(waiting);
  stopWatch();
  if (!step) return;
  // A dialog on the tutorial screen can finish the step and then go to a new screen (a new number).
  if (location.pathname === TUTORIAL_PATH) setTimeout(() => announce(step), 800); else announce(step);
}

// Call this right before the person leaves the tutorial screen to do the step with this id.
// test: an own test for "done" (for example: the balance is high enough). The notice then
// uses the words of the step with this id.
export function watchStep(id, test = null) {
  stopWatch();
  waiting = id;
  reached = test;
  stops = [
    store.subscribe(['balance', 'mailboxes', 'aliases', 'numbers', 'phones', 'identities'], check),
    bus.on('text', check),
  ];
}

onForget(() => { stopWatch(); extra.passkeys = 0; extra.sentText = false; });
