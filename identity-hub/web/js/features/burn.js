// Burn: one action that ends an identity for good. It turns off its aliases, deletes their mail,
// and releases its numbers (with their texts and calls). Also for one alias or one number.
//
// - The person sees exactly what is destroyed, and confirms two times (the second time by typing BURN).
// - The work can stop in the middle (the page is closed, the connection fails). So the identity
//   remembers what must be burned (encrypted, with the identity) before the first step, and shows
//   "Burn not finished" with "Finish the burn" until every step is done. A step can run two times.
// Fields in the encrypted data of an identity: burning = { day, aliasIds, numberIds } while a burn
// runs; burned = { day } after it (the door of the identity then shows "Burned").
// Field in the encrypted data of an alias: burned = { day }.
import { registerRowAction, registerRowBadge } from '../lib/registry.js';
import { reportError, tag } from '../ui/components.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// The dialogs and the work load when the person starts a burn.
const open = (name, ...args) => import('./burn/run.js').then((m) => m[name](...args)).catch(reportError);

// "Burn" is under the line of the menu, next to Delete.
registerRowAction('identity', (item) => (isObject(item.extra.burning)
  ? { label: 'Finish the burn', icon: 'warning', danger: true, run: () => open('finishBurn', item.id) }
  : { label: 'Burn', icon: 'warning', danger: true, run: () => open('openBurn', { kind: 'identity', id: item.id }) }));
registerRowAction('alias', (item) => ({ label: 'Burn', icon: 'warning', danger: true, run: () => open('openBurn', { kind: 'alias', id: item.id }) }));
registerRowAction('number', (item) => ({ label: 'Burn', icon: 'warning', danger: true, run: () => open('openBurn', { kind: 'number', id: item.id }) }));

registerRowBadge('identity', (item) => {
  if (!isObject(item.extra.burning)) return null;
  const mark = tag('Burn not finished', 'warn');
  mark.dataset.burn = 'open';
  mark.title = 'A burn of this identity stopped in the middle. Open the identity and select "Finish the burn".';
  return mark;
});
// An alias that was burned and is still off. (Turned on again, it is a normal alias.)
registerRowBadge('alias', (item) => {
  if (!isObject(item.extra.burned) || !item.off) return null;
  const mark = tag('Burned');
  mark.dataset.burn = 'done';
  return mark;
});
