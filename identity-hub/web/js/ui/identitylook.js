// How an identity looks: its door (open = on, shut = off, bricked up = burned), its colour dot,
// and its small history. The picture and the colour are never the only signal: the word
// (On, Off, Burned) and the name of the identity are always next to them.
import { h, uid } from '../lib/dom.js';
import { dayText } from '../lib/format.js';
import { icon } from './icons.js';
import { reportError } from './components.js';
import { toast } from './toast.js';
import { COLOURS, colourOf, setIdentityColour, eventsOf } from '../lib/identities.js';

export const COLOUR_NAMES = { red: 'Red', orange: 'Orange', gold: 'Gold', green: 'Green', teal: 'Teal', blue: 'Blue', purple: 'Purple', pink: 'Pink' };
const STATES = {
  on: { word: 'On', icon: 'doorOpen' },
  off: { word: 'Off', icon: 'doorShut' },
  burned: { word: 'Burned', icon: 'doorBricked' },
};

// The dot of an identity, or null when it has no colour. It has a name for screen readers.
export function colourDot(g) {
  const colour = colourOf(g);
  return colour ? h('span', { class: 'dot', dataset: { colour }, role: 'img', 'aria-label': `Colour: ${COLOUR_NAMES[colour].toLowerCase()}` }) : null;
}

// The door picture. It is decoration: put stateWord() next to it.
export function doorMark(state, { size = 20 } = {}) {
  const s = STATES[state] || STATES.off;
  return h('span', { class: `door-mark is-${STATES[state] ? state : 'off'}`, dataset: { door: STATES[state] ? state : 'off' } }, icon(s.icon, { size }));
}
export function stateWord(state) {
  const s = STATES[state] || STATES.off;
  return h('span', { class: `identity-state is-${STATES[state] ? state : 'off'}` }, s.word);
}

// The colour choice of one identity: a group of radio buttons, each with the name of the colour.
// A choice is saved at once (encrypted with the identity).
export function colourPicker(g, labelledBy) {
  const name = uid('colour');
  const current = colourOf(g);
  const option = (value, label) => {
    const id = uid('colour-o');
    const input = h('input', { type: 'radio', class: 'sr-only', name, id, value, checked: value === current });
    input.addEventListener('change', () => {
      if (!input.checked) return;
      setIdentityColour(g.id, value).then(() => toast(value ? `Colour saved: ${label.toLowerCase()}` : 'Colour removed', { kind: 'ok', timeout: 2000 })).catch(reportError);
    });
    return h('div', { class: 'colour-option' }, input,
      h('label', { for: id }, h('span', { class: `dot ${value ? '' : 'dot-none'}`.trim(), dataset: value ? { colour: value } : {}, 'aria-hidden': 'true' }), h('span', null, label)));
  };
  const el = h('div', { class: 'colour-picker', role: 'radiogroup', 'aria-labelledby': labelledBy }, option('', 'No colour'), COLOURS.map((c) => option(c, COLOUR_NAMES[c])));
  el.dataset.colour = current;
  return el;
}

const EVENT_WORDS = {
  made: 'Made',
  'first-mail': 'First mail',
  'turned-off': 'All aliases turned off',
  'turned-on': 'An alias turned on again',
  burned: 'Burned',
};
// The history of an identity as a short list, the oldest first.
export function historyList(g) {
  return h('ol', { class: 'history-list' }, eventsOf(g).map((e) => h('li', { dataset: { event: e.type } },
    h('time', { class: 'history-day', datetime: e.day }, dayText(e.day)),
    h('span', null, EVENT_WORDS[e.type] || e.type),
  )));
}
