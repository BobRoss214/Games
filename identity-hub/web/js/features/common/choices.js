// A list of choices in a dialog: one is picked (radio buttons with the look of the app).
// The dialogs of "Blocked senders", "Automatic deletion" and "Burn" share this file.
import { h, uid } from '../../lib/dom.js';

// options: [{ value, label, note }]. onChange(value) runs when the person picks one.
// Returns { el, value }.
export function choiceList({ legend, options, value, onChange = null }) {
  const name = uid('choice');
  let current = value;
  const el = h('fieldset', { class: 'stack stack-2' },
    h('legend', { class: 'label' }, legend),
    h('div', { class: 'radio-list' }, options.map((o) => {
      const id = uid('choice-o');
      const input = h('input', { type: 'radio', class: 'radio-input', name, id, value: o.value, checked: o.value === current });
      input.addEventListener('change', () => { if (input.checked) { current = o.value; if (onChange) onChange(current); } });
      return h('div', { class: 'radio' }, input, h('label', { for: id },
        h('span', { class: 'radio-label' }, o.label),
        o.note ? h('span', { class: 'radio-note' }, o.note) : null,
      ));
    })),
  );
  return { el, get value() { return current; } };
}
