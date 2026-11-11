// Sign in with a passkey or with the recovery key. Also the unlock screen.
import { h } from '../lib/dom.js';
import { store, appName } from '../lib/store.js';
import { navigate } from '../lib/router.js';
import { archFigure } from '../ui/icons.js';
import { button, runBusy, callout, checkbox } from '../ui/components.js';
import { bareLayout } from '../ui/shell.js';
import { toast } from '../ui/toast.js';
import { passkeysSupported, passkeyAssertion } from '../lib/webauthn.js';
import {
  finishPasskeySignIn, signInWithRecoveryKey, unlockWithRecovery, signOut,
  getPendingPrf, clearPendingPrf, saveKeyForPasskey, getLockReason,
} from '../lib/session.js';

// A text area for the recovery key. Accepts lower case, spaces and missing dashes.
export function recoveryInput(id) {
  return h('textarea', {
    class: 'input textarea mono key-input', id, rows: 2, autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false',
    placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX', 'aria-describedby': `${id}-hint`,
  });
}

function recoveryMessage(err) {
  if (err && err.code === 'bad_checksum') return 'This key has a typing error. Check each group of four characters.';
  if (err && err.code === 'bad_format') return 'A recovery key has 36 letters and numbers, in 9 groups of 4.';
  if (err && err.code === 'bad_login') return 'No account matches this recovery key.';
  return (err && err.message) || 'That did not work. Try again.';
}

export function signInScreen({ scope }) {
  const errorBox = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const showError = (m) => { errorBox.textContent = m; errorBox.hidden = !m; };
  const input = recoveryInput('recovery');
  const submit = button('Sign in', { kind: 'primary', type: 'submit', size: 'lg', block: true });

  const form = h('form', { class: 'stack', novalidate: true, onSubmit: (e) => {
    e.preventDefault();
    showError('');
    if (!input.value.trim()) { showError('Enter your recovery key.'); input.focus(); return; }
    runBusy(submit, async () => {
      await signInWithRecoveryKey(input.value);
      input.value = '';
      if (!scope.disposed) navigate('/', { replace: true });
    }, { onError: (err) => { showError(recoveryMessage(err)); return true; } });
  } },
    h('div', { class: 'field' },
      h('label', { class: 'label', for: 'recovery' }, 'Recovery key'),
      input,
      h('p', { class: 'hint', id: 'recovery-hint' }, 'You saved this key when you made the account. Capital letters and dashes do not matter.'),
    ),
    submit,
  );

  const passkey = passkeysSupported() ? h('div', { class: 'stack' },
    button('Sign in with a passkey', { iconName: 'passkey', size: 'lg', block: true, onClick: (e, btn) => runBusy(btn, async () => {
      showError('');
      const result = await passkeyAssertion();
      await finishPasskeySignIn(result);
      if (!scope.disposed) navigate('/', { replace: true });
    }, { onError: (err) => { showError(err.message); return true; } }) }),
    h('div', { class: 'or-rule' }, h('span', null, 'or')),
  ) : null;

  return bareLayout(h('div', { class: 'stack stack-5' },
    h('div', { class: 'stack stack-2' },
      h('h1', null, 'Sign in'),
      h('p', { class: 'muted' }, 'Your key opens your data in this browser. It is never sent to the server.'),
    ),
    passkey,
    form,
    errorBox,
    h('p', { class: 'small muted' }, 'No account yet? ', h('a', { href: '/create', 'data-link': true }, 'Create account')),
  ));
}

// The cookie session is valid, but this tab does not have the account key.
export function unlockScreen({ scope }) {
  const errorBox = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const showError = (m) => { errorBox.textContent = m; errorBox.hidden = !m; };
  const input = recoveryInput('recovery');
  const pending = getPendingPrf();
  const noPrf = getLockReason() === 'passkey-no-prf';
  const remember = pending ? checkbox('Let this passkey unlock my data next time', { checked: true }) : null;
  const submit = button('Unlock', { kind: 'primary', type: 'submit', size: 'lg', block: true, iconName: 'key' });

  const form = h('form', { class: 'stack', novalidate: true, onSubmit: (e) => {
    e.preventDefault();
    showError('');
    if (!input.value.trim()) { showError('Enter your recovery key.'); input.focus(); return; }
    runBusy(submit, async () => {
      await unlockWithRecovery(input.value);
      input.value = '';
      if (pending && remember && remember.checked) {
        try { await saveKeyForPasskey(pending.passkeyId, pending.prf); toast('This passkey unlocks your data from now on.', { kind: 'ok' }); } catch { toast('The passkey was not updated. You can try again in Settings.', { kind: 'error' }); }
      }
      clearPendingPrf();
      if (!scope.disposed) navigate(location.pathname, { replace: true });
    }, { onError: (err) => { showError(recoveryMessage(err)); return true; } });
  } },
    h('div', { class: 'field' },
      h('label', { class: 'label', for: 'recovery' }, 'Recovery key'),
      input,
      h('p', { class: 'hint', id: 'recovery-hint' }, 'Capital letters and dashes do not matter.'),
    ),
    remember ? remember.el : null,
    submit,
  );

  const viaPasskey = !pending && !noPrf && passkeysSupported() ? h('div', { class: 'stack' },
    button('Unlock with a passkey', { iconName: 'passkey', size: 'lg', block: true, onClick: (e, btn) => runBusy(btn, async () => {
      showError('');
      const result = await passkeyAssertion();
      const current = store.get('account');
      if (current && result.account && result.account.id !== current.id) {
        // A passkey of another account: this tab is now signed in to that account.
        toast('This passkey belongs to a different account. You are signed in to that account now.');
      }
      const unlocked = await finishPasskeySignIn(result);
      if (scope.disposed) return;
      void unlocked; // if the passkey could not unlock, this screen shows again with the right note
      navigate(location.pathname, { replace: true });
    }, { onError: (err) => { showError(err.message); return true; } }) }),
    h('div', { class: 'or-rule' }, h('span', null, 'or')),
  ) : null;

  return bareLayout(h('div', { class: 'stack stack-5' },
    h('div', { class: 'lock-figure' }, archFigure({ width: 84, keyhole: true })),
    h('div', { class: 'stack stack-2 center' },
      h('h1', null, pending ? 'Unlock with your recovery key' : `Unlock ${appName()}`),
      h('p', { class: 'muted' }, 'You are signed in, but this tab does not have your key. The key never goes to the server, so we ask for it here.'),
    ),
    pending
      ? callout('info', 'One more step for this passkey', h('p', null, 'This passkey can sign you in. It does not hold your key yet. Enter the recovery key one time.'))
      : (noPrf ? callout('info', 'This passkey cannot unlock your data', h('p', null, 'It can sign you in, but it cannot hold your key. Enter the recovery key one time for this browser session.')) : null),
    viaPasskey,
    form,
    errorBox,
    h('p', { class: 'small center' },
      h('button', { class: 'btn btn-quiet', type: 'button', onClick: async () => { await signOut(); navigate('/', { replace: true }); } }, 'Sign out'),
    ),
  ));
}
