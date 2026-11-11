// Settings: "Test my recovery key". The person types the key and the app says if it is right.
//
// Rules:
// - The test runs in this browser only. This file calls no server and imports no API client.
// - The key is never stored, never logged, and never put into the address or into an error report.
//   It lives in the field and in local variables of one function call.
// - The field is emptied after a test that gave an answer about the account. After a typing
//   error the text stays, so that the person can correct it (the sign-in screen does the same).
//
// How the test works: the text is checked for typing errors (its last 4 characters are a check
// group). Then the account id that the key makes must be the id of this account, and the key
// must open the same account key that this tab uses.
import { h, uid, replace } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { registerSettingsSection } from '../lib/registry.js';
import { button, runBusy, callout } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { why } from '../ui/why.js';
import { getKeys } from '../lib/session.js';
import { recoveryInput } from '../screens/signin.js';
import { unb64u, bytesEqual } from '/shared/bytes.js';
import { deriveFromRecoveryKey, unlockWithRecoveryKey } from '/shared/crypto.js';
import { parseRecoveryKey } from '/shared/recovery.js';

const TITLE = 'Test my recovery key';
const LEDE = 'Type your recovery key to see if your copy is right. The test runs in this browser. Nothing is sent to the server.';

const ANSWERS = {
  right: { kind: 'ok', text: 'This is the right key for this account.' },
  typo: { kind: 'warn', text: 'This key has a typing error. Check each group of four characters.' },
  format: { kind: 'warn', text: 'A recovery key has 36 letters and numbers, in 9 groups of 4.' },
  other: { kind: 'warn', text: 'This is a valid key, but for a different account.' },
  broken: { kind: 'danger', text: 'This key is for this account, but it did not open your data. Do not sign out of this browser.' },
  empty: { kind: 'warn', text: 'Enter your recovery key.' },
};

// Gives 'right' | 'typo' | 'format' | 'other' | 'broken'. It makes no request.
export async function checkRecoveryKey(text) {
  let bytes;
  try {
    bytes = await parseRecoveryKey(text);
  } catch (err) {
    return err && err.code === 'bad_checksum' ? 'typo' : 'format';
  }
  const account = store.get('account');
  const keys = getKeys();
  if (!account || !keys) return 'broken';
  const derived = await deriveFromRecoveryKey(bytes);
  if (derived.accountId !== account.id) return 'other';
  try {
    const opened = await unlockWithRecoveryKey(bytes, {
      publicKey: unb64u(account.publicKey), encPrivateKey: unb64u(account.encPrivateKey), recoveryWrap: unb64u(account.recoveryWrap),
    });
    return bytesEqual(opened.accountKey, keys.accountKey) ? 'right' : 'broken';
  } catch {
    return 'broken';
  }
}

// The field, the button and the answer. onRight runs after a test with the right key.
// actions: more buttons for the row of the test button (the dialog adds "Done").
export function recoveryTestForm({ onRight = null, actions = null } = {}) {
  const id = uid('rtest');
  const input = recoveryInput(id);
  const answer = h('div', { class: 'f-rtest-answer', role: 'status' });
  const submit = button('Test the key', { kind: 'primary', type: 'submit', iconName: 'key' });
  const show = (name) => {
    const a = ANSWERS[name];
    replace(answer, callout(a.kind, a.text));
    answer.dataset.answer = name;
  };
  input.addEventListener('input', () => { if (answer.firstChild) { replace(answer); delete answer.dataset.answer; } });
  return h('form', { class: 'stack', novalidate: true, autocomplete: 'off', onSubmit: (e) => {
    e.preventDefault();
    if (!input.value.trim()) { show('empty'); input.focus(); return; }
    runBusy(submit, async () => {
      const result = await checkRecoveryKey(input.value);
      // A typing error stays in the field, so that the person can correct it.
      if (result === 'typo' || result === 'format') input.focus(); else input.value = '';
      show(result);
      if (result === 'right' && onRight) onRight();
    });
  } },
    h('div', { class: 'field' },
      h('label', { class: 'label', for: id }, 'Recovery key'),
      input,
      h('p', { class: 'hint', id: `${id}-hint` }, 'Capital letters and dashes do not matter.'),
    ),
    h('div', { class: 'row row-wrap' }, submit, actions),
    answer,
  );
}

// The same test in a dialog. Resolves to true if a test gave "right" before the dialog closed.
export function openRecoveryTest() {
  let right = false;
  const dlg = openDialog({
    title: TITLE, description: LEDE, size: 'md',
    content: (api) => recoveryTestForm({ onRight: () => { right = true; }, actions: button('Done', { onClick: () => api.close() }) }),
  });
  return dlg.closed.then(() => right);
}

registerSettingsSection({ id: 'recovery-test', title: TITLE, lede: LEDE, order: 15, render: () => h('div', { class: 'stack stack-3' }, why('recovery-test'), recoveryTestForm()) });
