// "Add a passkey" as a dialog that every screen can open (Settings, the tutorial).
// When a passkey is added or removed in this tab, the bus says so: bus.on('passkeys', fn).
// How many passkeys the account has is in the store: store.get('passkeyCount').
import { h } from '../lib/dom.js';
import { bus } from '../lib/store.js';
import { field } from './components.js';
import { formDialog } from './dialog.js';
import { toast } from './toast.js';
import { saveKeyForPasskey } from '../lib/session.js';
import { passkeysSupported, registerPasskey } from '../lib/webauthn.js';
import { guessDeviceName } from '../screens/create.js';

// Resolves to { unlocks } when a passkey was added (unlocks: it can open the data alone),
// or to undefined when the person closed the dialog or the browser has no passkeys.
export async function openAddPasskey() {
  if (!passkeysSupported()) { toast('This browser does not support passkeys.', { kind: 'error' }); return undefined; }
  const label = field({ label: 'Name for this passkey', value: guessDeviceName(), maxlength: 40, hint: 'Only you see this name. It is encrypted.' });
  const result = await formDialog({
    title: 'Add a passkey', submitLabel: 'Add a passkey', size: 'sm',
    description: 'Your device asks for your fingerprint, your face or your PIN.',
    build: () => h('div', { class: 'stack' }, label.el),
    onSubmit: async () => {
      const { passkey, prf } = await registerPasskey(label.value.trim());
      if (prf) await saveKeyForPasskey(passkey.id, prf);
      return { unlocks: !!prf };
    },
  });
  if (!result) return undefined;
  toast(result.unlocks ? 'Passkey added' : 'Passkey added. It can sign you in, but it cannot unlock your data alone.', { kind: 'ok', timeout: result.unlocks ? 3000 : 8000 });
  bus.emit('passkeys', { added: true });
  return result;
}
