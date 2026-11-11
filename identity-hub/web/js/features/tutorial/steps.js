// The steps of the tutorial: which step is off, which is done, what a step costs, what it needs.
// The words of the steps come from web/js/help/content.js. This file has no words of its own
// for the steps, and it touches no page: every function gets plain data.
import { TUTORIAL } from '../../help/content.js';
import { money } from '../../lib/format.js';

export const STEPS = TUTORIAL;
export const TOTAL = STEPS.length;

export const stepIndex = (id) => Math.max(0, STEPS.findIndex((s) => s.id === id));
export const stepById = (id) => STEPS.find((s) => s.id === id) || null;

const features = (config) => (config && config.features) || {};
const prices = (config) => (config && config.prices) || {};

// The price of a step in credits. null = the step costs nothing.
export function priceOf(step, config) {
  if (!step.costKey) return null;
  const p = prices(config)[step.costKey];
  return Number.isFinite(p) && p > 0 ? p : 0;
}

// Puts the name of the product and the real price into a text of the content file.
export function fill(text, step, config) {
  const app = (config && typeof config.appName === 'string' && config.appName) || 'Postern';
  const price = priceOf(step, config);
  return String(text || '').replaceAll('{app}', app).replaceAll('{price}', money(price || 0));
}

// A step is off when the part of the server that it needs is off.
export function isOff(step, config) {
  if (step.needs === 'pay') return !features(config).pay;
  if (step.needs === 'phone') return !features(config).phone;
  return false;
}

// What the data of the account proves. app = the store state. extra = { passkeys, sentText }
// for the two things that are not in the store. A list that did not load yet proves nothing.
export function proofs(app, extra = {}) {
  const boxes = app.mailboxes || [];
  const aliases = app.aliases || [];
  const numbers = app.numbers || [];
  const phones = app.phones || [];
  const groups = app.identities || [];
  const p = prices(app.config);
  const out = new Set();
  if (extra.passkeys > 0) out.add('passkey');
  // Credit now, or something that only credit could buy.
  if (app.balance > 0 || (p.mailboxMonth > 0 && boxes.length > 0) || (p.numberMonth > 0 && numbers.length > 0)) out.add('funds');
  if (boxes.length > 0) out.add('inbox');
  if (aliases.length > 0) out.add('alias');
  if (aliases.some((a) => a.received > 0)) out.add('first-mail');
  if (aliases.some((a) => !a.enabled)) out.add('alias-off');
  if (groups.length > 0) out.add('identity');
  if (aliases.some((a) => a.persona) || numbers.some((n) => n.persona) || groups.some((g) => g.persona)) out.add('made-up-details');
  if (numbers.length > 0) out.add('number');
  if (extra.sentText) out.add('first-text');
  if (phones.some((ph) => ph.verified)) out.add('link-phone');
  return out;
}

// 'off' | 'done' | 'skipped' | 'todo'
export function statusOf(step, { config, saved, proven }) {
  if (isOff(step, config)) return 'off';
  if ((saved && saved.done.includes(step.id)) || proven.has(step.id)) return 'done';
  if (saved && saved.skipped.includes(step.id)) return 'skipped';
  return 'todo';
}

// The step after or before index i that is not off. The same index when there is none.
export function nextIndex(i, config) {
  for (let n = i + 1; n < TOTAL; n++) if (!isOff(STEPS[n], config)) return n;
  return i;
}
export function prevIndex(i, config) {
  for (let n = i - 1; n >= 0; n--) if (!isOff(STEPS[n], config)) return n;
  return i;
}

// Some steps need a thing from an earlier step. Returns { thing, stepId } when it is missing, or null.
const NEEDS_THING = {
  alias: { thing: 'inbox', stepId: 'inbox', has: (app) => (app.mailboxes || []).length > 0 },
  'first-mail': { thing: 'alias', stepId: 'alias', has: (app) => (app.aliases || []).length > 0 },
  'alias-off': { thing: 'alias', stepId: 'alias', has: (app) => (app.aliases || []).length > 0 },
  'made-up-details': { thing: 'alias', stepId: 'alias', has: (app) => (app.aliases || []).length > 0 || (app.numbers || []).length > 0 },
  'first-text': { thing: 'number', stepId: 'number', has: (app) => (app.numbers || []).length > 0 },
  'link-phone': { thing: 'number', stepId: 'number', has: (app) => (app.numbers || []).length > 0 },
};
export function missingFor(step, app) {
  const need = NEEDS_THING[step.id];
  if (!need || need.has(app)) return null;
  return { thing: need.thing, stepId: need.stepId };
}

// The ids that the saved progress must get: the steps that the data proves now.
export function withProven(saved, proven) {
  const done = [...new Set([...(saved ? saved.done : []), ...proven])].filter((id) => stepById(id));
  return { done, skipped: (saved ? saved.skipped : []).filter((id) => !done.includes(id)) };
}
