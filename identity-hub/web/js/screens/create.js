// Create account: (1) make keys, (2) save the recovery key, (3) add a passkey.
// The account is made on the server only after the person confirms that the
// recovery key is saved. Before that, nothing is stored anywhere.
import { h, replace } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { navigate } from '../lib/router.js';
import { icon } from '../ui/icons.js';
import { button, runBusy, callout, checkbox, copyButton, field } from '../ui/components.js';
import { bareLayout } from '../ui/shell.js';
import { toast } from '../ui/toast.js';
import { prepareSignup, finishSignup, saveKeyForPasskey, isUnlocked } from '../lib/session.js';
import { passkeysSupported, registerPasskey } from '../lib/webauthn.js';

function steps(current) {
  const names = ['Make keys', 'Save recovery key', 'Add a passkey'];
  return h('ol', { class: 'steps', 'aria-label': `Step ${current} of 3` },
    names.map((name, i) => h('li', { class: `step ${i + 1 === current ? 'is-current' : ''} ${i + 1 < current ? 'is-done' : ''}`.trim(), 'aria-current': i + 1 === current ? 'step' : null },
      h('span', { class: 'step-num mono' }, i + 1 < current ? icon('check', { size: 14 }) : String(i + 1)),
      h('span', { class: 'step-name' }, name),
    )),
  );
}

export function guessDeviceName() {
  const ua = navigator.userAgent || '';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android phone';
  if (/Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows computer';
  if (/Linux/.test(ua)) return 'Linux computer';
  return 'This device';
}

export function createScreen({ scope }) {
  const body = h('div', { class: 'stack stack-5' });
  const el = bareLayout(body, { wide: true });
  let prepared = null;

  const errorBox = () => h('p', { class: 'form-error', role: 'alert', hidden: true });
  const focusTitle = () => { const t = body.querySelector('h1'); if (t) { t.tabIndex = -1; t.focus({ preventScroll: true }); } window.scrollTo(0, 0); };

  // ---- step 1 ----
  function stepOne() {
    if ((store.get('config') || {}).signup === 'closed') {
      replace(body,
        h('div', { class: 'stack stack-3' },
          h('h1', null, 'New accounts are closed'),
          h('p', { class: 'read' }, 'This server does not take new accounts now. If you have an account, sign in.'),
        ),
        h('div', null, h('a', { class: 'btn btn-primary btn-lg', href: '/sign-in', 'data-link': true }, 'Sign in')),
      );
      return;
    }
    const err = errorBox();
    const bar = h('div', { class: 'progress-bar' });
    const progress = h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Making your keys', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', hidden: true }, bar);
    const status = h('p', { class: 'small muted', role: 'status', hidden: true });
    const go = button('Make my account', { kind: 'primary', size: 'lg', block: true });
    go.addEventListener('click', () => runBusy(go, async () => {
      err.hidden = true;
      progress.hidden = false;
      status.hidden = false;
      status.textContent = 'Your browser solves a small puzzle. This takes a few seconds.';
      prepared = await prepareSignup((p) => {
        const pct = Math.round(Math.min(1, p) * 100);
        bar.style.width = `${pct}%`;
        progress.setAttribute('aria-valuenow', String(pct));
      });
      if (scope.disposed) return;
      stepTwo();
    }, { onError: (e) => { progress.hidden = true; status.hidden = true; err.textContent = e.message; err.hidden = false; return true; } }));

    replace(body,
      steps(1),
      h('div', { class: 'stack stack-3' },
        h('h1', null, 'Create your account'),
        h('p', { class: 'read' }, 'Your browser makes a secret recovery key that locks your account, and only you have it.'),
      ),
      h('ul', { class: 'plain-list' },
        h('li', null, icon('check', { size: 18 }), h('span', null, 'The server never sees the key. It cannot read your mail or your labels.')),
        h('li', null, icon('check', { size: 18 }), h('span', null, 'We ask for no name, no email address and no phone number.')),
        h('li', null, icon('check', { size: 18 }), h('span', null, 'There is no CAPTCHA and no tracking. Your browser solves a small puzzle to show that it is not a robot.')),
      ),
      go, progress, status, err,
      h('p', { class: 'small muted' }, 'Have an account? ', h('a', { href: '/sign-in', 'data-link': true }, 'Sign in')),
    );
    focusTitle();
  }

  // ---- step 2 ----
  function stepTwo() {
    const err = errorBox();
    const keyText = prepared.recovery.text;
    const groups = keyText.split('-');
    const saved = checkbox('I saved my recovery key', { onChange: (on) => { next.disabled = !on; } });
    const next = button('Continue', { kind: 'primary', size: 'lg', block: true, disabled: true });
    const status = h('p', { class: 'small muted', role: 'status', hidden: true });
    next.addEventListener('click', () => runBusy(next, async () => {
      err.hidden = true;
      await finishSignup(prepared, () => { status.hidden = false; status.textContent = 'Finishing. One more small puzzle…'; });
      prepared.recovery = null; // the key is saved by the person now; forget it here
      if (scope.disposed) return;
      stepThree();
    }, { onError: (e) => { status.hidden = true; err.textContent = e.code === 'signup_closed' ? 'New accounts are closed on this server.' : e.message; err.hidden = false; return true; } }));

    const download = button('Download', { iconName: 'download', onClick: () => {
      const day = new Date().toISOString().slice(0, 10);
      const lines = [
        'Postern recovery key', '', keyText, '',
        'This key is the only way to get back in if you lose your passkey.',
        'Postern cannot reset it. Anyone who has this key can open your account.',
        'Keep this file private, for example in a password manager.', '',
        `Sign in at: ${location.origin}`, `Saved on: ${day}`, '',
      ];
      const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/plain' }));
      const a = h('a', { href: url, download: 'postern-recovery-key.txt', hidden: true });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast('Recovery key downloaded', { kind: 'ok' });
    } });

    replace(body,
      steps(2),
      h('div', { class: 'stack stack-3' },
        h('h1', null, 'Save your recovery key'),
        h('p', { class: 'read' }, 'Write it down, or keep it in a password manager. You see it only this one time.'),
      ),
      h('div', { class: 'keycard' },
        h('p', { class: 'keycard-label' }, 'Recovery key'),
        h('div', { class: 'keycard-groups mono', 'aria-label': `Recovery key: ${groups.join(' ')}`, role: 'group' }, groups.map((g) => h('span', { class: 'keycard-group', 'aria-hidden': 'true' }, g))),
        h('div', { class: 'keycard-actions' },
          copyButton(() => keyText, 'Copy', { what: 'Recovery key copied', withLabel: true }),
          download,
        ),
      ),
      callout('warn', 'Keep this key safe', h('p', null, 'This key is the only way to get back in if you lose your passkey. We cannot reset it.')),
      saved.el,
      next, status, err,
    );
    focusTitle();
  }

  // ---- step 3 ----
  function stepThree() {
    const err = errorBox();
    const done = () => navigate('/', { replace: true });
    if (!passkeysSupported()) {
      replace(body,
        steps(3),
        h('div', { class: 'stack stack-3' }, h('h1', null, 'Add a passkey'), h('p', { class: 'read' }, 'This browser does not support passkeys. You can sign in with your recovery key. You can add a passkey later in Settings.')),
        button('Continue', { kind: 'primary', size: 'lg', block: true, onClick: done }),
      );
      focusTitle();
      return;
    }
    const label = field({ label: 'Name for this passkey', value: guessDeviceName(), maxlength: 40, hint: 'Only you see this name. It is encrypted.' });
    const add = button('Add a passkey', { kind: 'primary', size: 'lg', block: true, iconName: 'passkey' });
    const skip = button('Skip for now', { size: 'lg', block: true, onClick: done });
    add.addEventListener('click', () => runBusy(add, async () => {
      err.hidden = true;
      const { passkey, prf } = await registerPasskey(label.value.trim());
      if (prf && isUnlocked()) {
        await saveKeyForPasskey(passkey.id, prf);
        toast('Passkey added', { kind: 'ok' });
        if (!scope.disposed) done();
        return;
      }
      if (scope.disposed) return;
      replace(body,
        steps(3),
        h('div', { class: 'stack stack-3' }, h('h1', null, 'Passkey added'), h('p', { class: 'read' }, 'This passkey can sign you in. It cannot unlock your data alone, so we ask for your recovery key one time in each new browser session.')),
        button('Continue', { kind: 'primary', size: 'lg', block: true, onClick: done }),
      );
      focusTitle();
    }, { onError: (e) => { err.textContent = e.message; err.hidden = false; return true; } }));

    replace(body,
      steps(3),
      h('div', { class: 'stack stack-3' },
        h('h1', null, 'Add a passkey'),
        h('p', { class: 'read' }, 'A passkey lets you sign in with your fingerprint, your face or your device PIN. It is faster than typing the recovery key. Keep the recovery key anyway.'),
      ),
      label.el,
      h('div', { class: 'stack stack-3' }, add, skip),
      err,
    );
    focusTitle();
  }

  // A reload in the middle: an account exists already, so only step 3 is left.
  if (store.get('phase') === 'in') stepThree(); else stepOne();
  return el;
}
