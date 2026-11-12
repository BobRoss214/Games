// Settings: passkeys, sessions, theme, what the server sees, delete account.
import { h, replace } from '../lib/dom.js';
import { store, bus } from '../lib/store.js';
import { api } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { dayText } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { button, emptyState, skeletonRows, pageHeader, section, field, segmented, runBusy, reportError, tag, loadError, callout } from '../ui/components.js';
import { menuButton } from '../ui/menu.js';
import { formDialog, confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { setTheme } from '../lib/theme.js';
import { decLabel, encLabel, saveKeyForPasskey, dropLocal, signOut } from '../lib/session.js';
import { passkeysSupported, passkeyPrf } from '../lib/webauthn.js';
import { openAddPasskey } from '../ui/passkeys.js';
import { registered, renderSafe, mergeByOrder } from '../lib/registry.js';
import { why, whyParts, whyGroup } from '../ui/why.js';

export function settingsScreen({ scope }) {
  // ---- passkeys ----
  const passkeySlot = h('div', { class: 'sheet item-sheet' });
  let passkeys = null;
  async function loadPasskeys() {
    try {
      const res = await api.get('/api/passkeys');
      const list = await Promise.all((res.passkeys || []).map(async (p) => ({ id: p.id, createdDay: p.createdDay, hasKey: !!p.hasKey, label: (await decLabel(p.enc, 'passkey')).label || '' })));
      if (scope.disposed) return;
      passkeys = list;
      paintPasskeys();
    } catch (err) {
      if (!scope.disposed) replace(passkeySlot, loadError(err.message, loadPasskeys));
    }
  }
  // The dialog is in ui/passkeys.js, so that other screens can open it too. The list loads again on the bus event.
  const addPasskey = () => openAddPasskey();
  scope.add(bus.on('passkeys', () => loadPasskeys()));
  function paintPasskeys() {
    if (passkeys === null) { replace(passkeySlot, skeletonRows(2)); return; }
    if (!passkeys.length) {
      replace(passkeySlot, emptyState({
        title: 'No passkey yet', compact: true,
        text: passkeysSupported() ? 'A passkey lets you sign in with your fingerprint, your face or your device PIN.' : 'This browser does not support passkeys. You sign in with your recovery key.',
        action: passkeysSupported() ? button('Add a passkey', { kind: 'primary', iconName: 'plus', onClick: addPasskey }) : null,
      }));
      return;
    }
    replace(passkeySlot, h('ul', { class: 'item-list' }, passkeys.map((p) => h('li', { class: 'phone-row' },
      h('span', { class: 'item-icon' }, icon('passkey', { size: 20 })),
      h('div', { class: 'item-main' },
        h('span', { class: 'item-value' }, p.label || 'Passkey'),
        h('div', { class: 'item-sub' },
          p.hasKey ? tag('Signs in and unlocks', 'ok') : tag('Signs in only', 'warn'),
          h('span', { class: 'small faint' }, `Added on ${dayText(p.createdDay)}`),
        ),
      ),
      h('div', { class: 'item-actions' },
        menuButton({ label: `More actions for ${p.label || 'passkey'}`, items: [
          { label: 'Rename', icon: 'edit', onSelect: async () => {
            const name = field({ label: 'Name', value: p.label, maxlength: 40 });
            const ok = await formDialog({ title: 'Rename passkey', submitLabel: 'Save', size: 'sm', build: () => h('div', { class: 'stack' }, name.el), onSubmit: async () => { await api.patch(`/api/passkeys/${encodeURIComponent(p.id)}`, { enc: await encLabel({ label: name.value.trim() }, 'passkey') }); } });
            if (ok) { toast('Saved', { kind: 'ok', timeout: 2000 }); loadPasskeys(); }
          } },
          !p.hasKey && passkeysSupported() ? { label: 'Let it unlock my data', icon: 'key', onSelect: async () => {
            try {
              const prf = await passkeyPrf(p.id);
              if (!prf) { toast('This passkey cannot hold a key. It can sign you in only.', { kind: 'error' }); return; }
              await saveKeyForPasskey(p.id, prf);
              toast('This passkey unlocks your data from now on.', { kind: 'ok' });
              loadPasskeys();
            } catch (err) { reportError(err); }
          } } : null,
          'separator',
          { label: 'Remove', icon: 'trash', danger: true, onSelect: async () => {
            const ok = await confirmDialog({ title: 'Remove this passkey?', message: 'You cannot sign in with it any more. Check that you have your recovery key or another passkey.', confirmLabel: 'Remove' });
            if (!ok) return;
            try { await api.del(`/api/passkeys/${encodeURIComponent(p.id)}`); toast('Passkey removed', { kind: 'ok' }); bus.emit('passkeys', { removed: true }); } catch (err) { reportError(err); }
          } },
        ] }),
      ),
    ))));
  }

  // ---- sessions ----
  const sessionSlot = h('div', { class: 'sheet item-sheet' });
  let sessions = null;
  async function loadSessions() {
    try {
      const res = await api.get('/api/sessions');
      if (scope.disposed) return;
      sessions = res.sessions || [];
      paintSessions();
    } catch (err) {
      if (!scope.disposed) replace(sessionSlot, loadError(err.message, loadSessions));
    }
  }
  const othersBtn = button('Sign out the others', { size: 'sm', onClick: (e, btn) => runBusy(btn, async () => {
    const ok = await confirmDialog({ title: 'Sign out all other sessions?', message: 'Every other browser and device is signed out. This browser stays signed in.', confirmLabel: 'Sign out the others', danger: false });
    if (!ok) return;
    await api.post('/api/sessions/revoke-others');
    toast('The other sessions are signed out', { kind: 'ok' });
    await loadSessions();
  }) });
  function paintSessions() {
    if (sessions === null) { replace(sessionSlot, skeletonRows(2)); return; }
    othersBtn.hidden = sessions.filter((s) => !s.current).length === 0;
    const sorted = [...sessions].sort((a, b) => Number(b.current) - Number(a.current));
    replace(sessionSlot, h('ul', { class: 'item-list' }, sorted.map((s) => h('li', { class: 'phone-row' },
      h('span', { class: 'item-icon' }, icon('system', { size: 20 })),
      h('div', { class: 'item-main' },
        h('span', { class: 'item-value' }, s.current ? 'This browser' : 'Another browser or device'),
        h('div', { class: 'item-sub' }, s.current ? tag('Current', 'ok') : null, h('span', { class: 'small faint' }, `Signed in on ${dayText(s.createdDay)}`)),
      ),
      h('div', { class: 'item-actions' },
        s.current ? null : button('Sign out', { size: 'sm', onClick: (e, btn) => runBusy(btn, async () => { await api.del(`/api/sessions/${s.id}`); toast('Session signed out', { kind: 'ok' }); await loadSessions(); }) }),
      ),
    ))));
  }

  // ---- what the server sees ----
  // These two lists follow docs/SECURITY.md, section 1. Change them together.
  // Texts, numbers and voicemail are named only where this server has them.
  const feat = (store.get('config') || {}).features || {};
  const phoneOn = !!feat.phone;
  const voicemailOn = phoneOn && !!feat.voicemail;
  const arrive = ['mail', phoneOn ? 'texts' : null, voicemailOn ? 'voicemail' : null].filter(Boolean);
  const stored = ['mail', phoneOn ? 'texts' : null, phoneOn ? 'call history' : null, voicemailOn ? 'voicemail' : null].filter(Boolean);
  const words = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0]);
  const can = [
    'That an account exists, and its credit balance.',
    phoneOn ? 'Which inboxes, aliases and numbers belong to one account. It needs this to deliver.' : 'Which inboxes and aliases belong to one account. It needs this to deliver.',
    `New ${words(arrive)} for a moment when ${arrive.length > 1 ? 'they arrive' : 'it arrives'}. It encrypts ${arrive.length > 1 ? 'them' : 'it'} for you, then forgets the readable form.`,
    phoneOn ? 'Mail and texts that you send, for the moment that it sends them.' : 'Mail that you send, for the moment that it sends it.',
    'The size and the time of each message.',
    `Your settings for each item: on or off, ${phoneOn ? 'forwarding, ' : ''}${voicemailOn ? 'voicemail, ' : ''}automatic deletion, an end date, "stop after the first mail".`,
    'Two numbers for each address: how many mails it received, and how many it refused.',
    phoneOn ? 'Your real phone number, if you link one. It needs it to forward. The phone company sees it too.' : null,
    'Your IP address while you are connected. It is kept in memory only, not in logs.',
  ].filter(Boolean);
  const cannot = [
    'Your name or who you are. It never asks.',
    'Your recovery key and your account key.',
    `Stored ${words(stored)}.`,
    'Your labels and notes.',
    'Your identities: their names, their notes, and what is in them.',
    'Your random identifiers and usernames. A password that the app makes is saved nowhere.',
    phoneOn ? 'A readable list of your addresses and numbers in the database.' : 'A readable list of your addresses in the database.',
    'The senders that you block, in readable form.',
    'Which payment added credit to your account.',
  ];
  const seeList = (items, kind) => h('ul', { class: `see-list is-${kind}` }, items.map((t) => h('li', null, icon(kind === 'no' ? 'eyeOff' : 'eye', { size: 16 }), h('span', null, t))));

  // ---- delete account ----
  async function deleteAccount() {
    const ok = await confirmDialog({
      title: 'Delete your account?',
      message: h('div', { class: 'stack stack-3' },
        h('p', { class: 'read' }, 'This deletes every inbox, alias, number, message and text, and your passkeys. Credit that is left is lost. Nobody can undo this.'),
      ),
      confirmLabel: 'Delete account', typed: 'delete my account', details: why('deleting'),
    });
    if (!ok) return;
    try {
      await api.del('/api/account', { confirm: 'delete my account' });
      dropLocal();
      navigate('/', { replace: true });
      toast('Your account is deleted.', { kind: 'ok', timeout: 6000 });
    } catch (err) { reportError(err); }
  }

  // The sections of Settings, with the sections of feature files between them (registerSettingsSection).
  const parts = mergeByOrder(
    [
      { order: 10, id: 'passkeys', make: () => section({ title: 'Passkeys', lede: 'Sign in with your fingerprint, your face or your device PIN. Keep your recovery key too.', actions: passkeysSupported() ? button('Add a passkey', { size: 'sm', iconName: 'plus', onClick: addPasskey }) : null }, whyGroup([['passkey'], ['recovery-key']]), passkeySlot) },
      { order: 20, id: 'sessions', make: () => section({ title: 'Sessions', lede: 'Browsers and devices that are signed in to this account. The server keeps the day of sign-in, and nothing about the device.', actions: othersBtn }, sessionSlot) },
      { order: 30, id: 'theme', make: () => section({ title: 'Theme' },
        segmented({ label: 'Theme', value: store.get('theme'), options: [{ value: 'dark', label: 'Dark', icon: 'moon' }, { value: 'light', label: 'Light', icon: 'sun' }, { value: 'system', label: 'System', icon: 'system' }], onChange: (v) => setTheme(v) }),
        h('p', { class: 'hint theme-hint' }, 'The app starts in the dark theme. "System" follows the theme of your device. Your choice is saved in this browser only.'),
      ) },
      { order: 40, id: 'privacy', make: () => section({ title: 'What the server can and cannot see', lede: 'Your data is encrypted with keys that stay in your browser. Some things the server must know to do its work.' },
        h('div', { class: 'see-grid' },
          h('div', { class: 'sheet sheet-pad' }, h('h3', { class: 'see-title' }, 'The server can see'), seeList(can, 'yes')),
          h('div', { class: 'sheet sheet-pad see-no' }, h('h3', { class: 'see-title' }, 'The server cannot see'), seeList(cannot, 'no')),
        ),
        callout('info', 'Know the limits', h('p', null, phoneOn ? 'Email and the phone network are not end-to-end encrypted. The phone provider sees texts and calls on its side. Use numbers for convenience, not for secrets.' : 'Email is not end-to-end encrypted on its way to this server. The server sees each new message for a moment.')),
      ) },
      { order: 90, id: 'browser', make: () => section({ title: 'This browser' },
        h('div', { class: 'row row-wrap' },
          button('Sign out', { iconName: 'signOut', onClick: async () => { await signOut(); navigate('/', { replace: true }); } }),
          h('span', { class: 'hint' }, `Account made on ${dayText(store.get('account')?.createdDay)}.`),
        ),
      ) },
      { order: 100, id: 'delete-account', make: () => section({ title: 'Delete account', cls: 'danger-zone' },
        h('p', { class: 'muted read' }, 'Deletes the account and everything in it from the server. Nobody can undo this.'),
        h('div', { class: 'danger-action' }, button('Delete account', { kind: 'danger', iconName: 'trash', onClick: deleteAccount })),
      ) },
    ],
    registered.settingsSections().map((sec) => ({ order: sec.order, make: () => {
      const node = renderSafe(sec.render, { scope });
      if (!node) return null;
      const el2 = section({ title: sec.title, lede: sec.lede }, node);
      el2.dataset.section = sec.id;
      return el2;
    }, id: sec.id })),
  );
  // Every section has the id "settings-<id>", so that an address with "#settings-<id>" moves the page to it.
  const el = h('div', { class: 'page page-narrow' },
    pageHeader({ title: 'Settings' }),
    parts.map((p) => { const node = p.make(); if (node && !node.id) node.id = `settings-${p.id}`; return node; }),
  );

  paintPasskeys();
  paintSessions();
  loadPasskeys();
  loadSessions();
  return el;
}
