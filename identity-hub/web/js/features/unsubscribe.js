// Newsletter panel in an open email.
//
// Decision: this app never opens an unsubscribe web link. To open a link from a stranger tells
// the sender that the address is read, and where from. So there are two ways only:
// - "Unsubscribe by email": a normal mail from the address that got the newsletter to the
//   address that the newsletter names for this (the server reads it from the List-Unsubscribe
//   header at delivery and keeps it inside the encrypted message). A copy is kept in "Sent".
// - Turn off the alias (the button is in the "Sent to" line of the message), or block the sender.
// The panel shows only for mail that the server marked as bulk mail (meta.bulk).
import { h, replace } from '../lib/dom.js';
import { appName } from '../lib/store.js';
import { registerMessagePanel } from '../lib/registry.js';
import { findMailbox } from '../lib/data.js';
import { sendMail } from '../lib/mail.js';
import { emailOk } from '../lib/format.js';
import { button, callout, runBusy } from '../ui/components.js';
import { confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { aliasFacts } from './common/facts.js';

const DEFAULT_SUBJECT = 'unsubscribe';
// Messages that got an unsubscribe mail in this tab. Memory only: nothing about it is saved.
const sent = new Set();

// The values come from a stranger (through the server): check each one.
function targetOf(message) {
  const u = message.body && message.body.unsubscribe;
  if (!u || typeof u !== 'object') return { mailto: '', subject: DEFAULT_SUBJECT, hasLink: false };
  const mailto = typeof u.mailto === 'string' && u.mailto.length <= 254 && emailOk(u.mailto) ? u.mailto.toLowerCase() : '';
  const subject = typeof u.subject === 'string' ? u.subject.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 200) : '';
  return { mailto, subject: subject || DEFAULT_SUBJECT, hasLink: u.hasLink === true };
}

// The address that got the message and can send the answer: the alias, or the address of the inbox.
function senderOf(message, alias) {
  if (alias) return { addressId: alias.id, address: alias.address, kind: 'alias' };
  const box = findMailbox(message.mailboxId);
  return box && box.addressId === message.addressId && box.status === 'active' ? { addressId: box.addressId, address: box.address, kind: 'inbox' } : null;
}

registerMessagePanel((message, alias) => {
  if (message.direction !== 'in' || !message.meta || message.meta.bulk !== true) return null;
  const title = 'This looks like a newsletter';
  const wrap = (...lines) => h('div', { dataset: { newsletter: '' } }, callout('info', title, ...lines));
  if (alias && !alias.enabled) return wrap(h('p', null, 'This alias is off. Mail to it is refused.'));
  // An alias past its end date refuses mail too, and it cannot send.
  const end = alias ? aliasFacts(alias.id).expiresAt : null;
  if (end && end <= Date.now() / 1000) return wrap(h('p', null, 'This alias is past its end date. Mail to it is refused.'));

  const target = targetOf(message);
  const from = senderOf(message, alias);
  // What stops the newsletter without an unsubscribe mail.
  const other = alias ? 'turn off this alias' : 'select "Block this sender" in "More actions"';

  if (target.mailto && from) {
    const slot = h('div', null);
    const done = () => replace(slot, h('p', null, `${appName()} sent the unsubscribe mail. It can take some days until the newsletter stops.`));
    const ask = (e, btn) => runBusy(btn, async () => {
      const ok = await confirmDialog({
        title: 'Unsubscribe by email?', confirmLabel: 'Send unsubscribe mail', danger: false,
        message: `${appName()} sends an empty mail from this ${from.kind} to the newsletter. The sender learns that this ${from.kind} is in use.`,
        details: h('dl', { class: 'kv' },
          h('dt', null, 'From'), h('dd', { class: 'mono break' }, from.address),
          h('dt', null, 'To'), h('dd', { class: 'mono break' }, target.mailto),
          h('dt', null, 'Subject'), h('dd', { class: 'break' }, target.subject),
        ),
      });
      if (!ok) return;
      await sendMail({ from: { addressId: from.addressId, address: from.address }, to: [target.mailto], subject: target.subject, text: '' });
      sent.add(message.id);
      done();
      toast('Unsubscribe mail sent', { kind: 'ok' });
    });
    if (sent.has(message.id)) done();
    else replace(slot, h('div', { class: 'row row-wrap row-2' }, button('Unsubscribe by email', { size: 'sm', iconName: 'send', onClick: ask })));
    return wrap(h('p', null, `You can ask the sender by email to stop. If the mail keeps coming, ${other}.`), slot);
  }
  if (target.hasLink) {
    return wrap(h('p', null, `This newsletter can only be stopped through a web link. ${appName()} does not open such links. To stop it, ${other}.`));
  }
  return wrap(h('p', null, `It names no way to unsubscribe. To stop it, ${other}.`));
});
