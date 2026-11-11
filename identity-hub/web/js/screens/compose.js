// Write a message or a reply. The browser encrypts the Sent copy before sending.
import { h, replace, uid } from '../lib/dom.js';
import { bytesText, emailOk, splitAddresses, fullTime } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { button, field, selectField, iconButton, callout } from '../ui/components.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { allAddresses } from '../lib/data.js';
import { sendMail, attachmentLimit, personText } from '../lib/mail.js';
import { openNewInbox } from '../ui/items.js';
import { bus } from '../lib/store.js';
import { htmlToText } from '../lib/sanitize.js';

const quote = (text) => String(text || '').split('\n').map((l) => '> ' + l).join('\n');

// options: { mailboxId?, reply?: full message (with body) }
export function openCompose({ mailboxId = '', reply = null } = {}) {
  const from = allAddresses({ onlyUsable: true });
  if (from.length === 0) {
    openDialog({
      title: 'No address to send from', size: 'sm',
      content: (api) => h('div', { class: 'stack' },
        h('p', { class: 'read' }, 'You need an active inbox to send mail.'),
        h('div', { class: 'dialog-actions' }, button('Cancel', { onClick: () => api.close() }), button('Make inbox', { kind: 'primary', onClick: () => { api.close(); openNewInbox(); } })),
      ),
    });
    return;
  }

  // Default sender: for a reply, the address the message came to. If not, the inbox address.
  let defaultFrom = from.find((a) => a.kind === 'inbox' && a.mailboxId === mailboxId) || from[0];
  let toValue = '';
  let subjectValue = '';
  let bodyValue = '';
  let inReplyTo = null;
  let references = [];
  if (reply) {
    const meta = reply.meta;
    const own = new Set(allAddresses().map((a) => a.address));
    const delivered = String(meta.deliveredTo || '').toLowerCase();
    const match = from.find((a) => a.address === delivered) || from.find((a) => a.addressId === reply.addressId) || from.find((a) => a.kind === 'inbox' && a.mailboxId === reply.mailboxId);
    if (match) defaultFrom = match;
    if (reply.direction === 'out') toValue = (meta.to || []).map((p) => p.address).filter(Boolean).join(', ');
    else {
      const target = (reply.body.replyTo && reply.body.replyTo[0] && reply.body.replyTo[0].address) || meta.from.address || '';
      toValue = own.has(target) ? '' : target;
    }
    const subj = meta.subject || '';
    subjectValue = /^re:/i.test(subj) ? subj : `Re: ${subj}`;
    // A message with HTML only has no text part. The text is made from the HTML here.
    const original = reply.body.text || (reply.body.html ? htmlToText(reply.body.html) : '');
    bodyValue = `\n\nOn ${fullTime(reply.at)}, ${personText(meta.from) || 'the sender'} wrote:\n${quote(original)}`;
    inReplyTo = reply.body.messageId || null;
    references = [...(reply.body.references || []), reply.body.messageId].filter(Boolean).slice(-20);
  }
  const initial = { to: toValue, subject: subjectValue, body: bodyValue };

  const fromField = selectField({
    label: 'From', mono: true, value: defaultFrom.addressId,
    options: from.map((a) => ({ value: a.addressId, label: `${a.address}${a.label ? `  (${a.label})` : ''}${a.kind === 'alias' ? '  alias' : ''}` })),
    hint: 'The other person sees this address.',
  });
  const to = field({ label: 'To', type: 'text', value: toValue, placeholder: 'name@example.com', autocomplete: 'off', inputmode: 'email', mono: true, hint: 'More than one? Put a comma between the addresses.' });
  const cc = field({ label: 'Cc', optional: true, mono: true, inputmode: 'email' });
  const bcc = field({ label: 'Bcc', optional: true, mono: true, inputmode: 'email' });
  const subject = field({ label: 'Subject', value: subjectValue, maxlength: 240 });
  const body = field({ label: 'Message', rows: 10, value: bodyValue, attrs: { spellcheck: 'true' } });
  const more = h('div', { class: 'stack', hidden: true }, cc.el, bcc.el);
  const moreBtn = h('button', { class: 'btn btn-quiet btn-sm disclose', type: 'button', 'aria-expanded': 'false' }, icon('chevronRight', { size: 14 }), h('span', null, 'Add Cc or Bcc'));
  moreBtn.addEventListener('click', () => { more.hidden = !more.hidden; moreBtn.setAttribute('aria-expanded', String(!more.hidden)); if (!more.hidden) cc.input.focus(); });

  // ---- attachments ----
  const files = []; // { filename, contentType, bytes }
  const limit = attachmentLimit();
  const fileList = h('ul', { class: 'attach-list' });
  const fileError = h('p', { class: 'field-error', hidden: true, role: 'alert' });
  const paintFiles = () => replace(fileList, files.map((f, i) => h('li', { class: 'attach-item' },
    icon('file', { size: 16 }),
    h('span', { class: 'truncate grow' }, f.filename),
    h('span', { class: 'small faint mono nowrap' }, bytesText(f.bytes.length)),
    iconButton('close', `Remove ${f.filename}`, { cls: 'icon-btn-sm', size: 14, onClick: () => { files.splice(i, 1); paintFiles(); } }),
  )));
  const fileId = uid('file');
  const fileInput = h('input', { type: 'file', id: fileId, class: 'sr-only', multiple: true, tabIndex: -1 });
  fileInput.addEventListener('change', async () => {
    fileError.hidden = true;
    for (const f of fileInput.files) {
      const total = files.reduce((n, x) => n + x.bytes.length, 0);
      if (total + f.size > limit) { fileError.textContent = `Attachments can be ${bytesText(limit)} in total. "${f.name}" is too large.`; fileError.hidden = false; continue; }
      const bytes = new Uint8Array(await f.arrayBuffer());
      const type = String(f.type || '').toLowerCase();
      files.push({
        filename: f.name.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200) || 'file',
        contentType: /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/.test(type) ? type : 'application/octet-stream',
        bytes,
      });
    }
    fileInput.value = '';
    paintFiles();
  });
  const attachBtn = button('Attach files', { iconName: 'attach', size: 'sm', onClick: () => fileInput.click() });

  const dirty = () => to.value !== initial.to || subject.value !== initial.subject || body.value !== initial.body || files.length > 0 || cc.value || bcc.value;

  const dlg = openDialog({
    title: reply ? 'Reply' : 'New message', size: 'lg', cls: 'compose',
    canClose: async () => (dirty() ? confirmDialog({ title: 'Discard this message?', message: 'The text you wrote is not saved.', confirmLabel: 'Discard' }) : true),
    content: (api) => {
      const send = button('Send', { kind: 'primary', type: 'submit', iconName: 'send' });
      const parse = (f, required) => {
        const list = splitAddresses(f.value);
        if (required && list.length === 0) { f.setError('Enter an address.'); return null; }
        const bad = list.find((a) => !emailOk(a));
        if (bad) { f.setError(`"${bad}" is not an email address.`); return null; }
        return list;
      };
      return h('form', { class: 'stack', novalidate: true, onSubmit: async (e) => {
        e.preventDefault();
        api.setError('');
        const toList = parse(to, true); if (!toList) return;
        const ccList = parse(cc, false); if (!ccList) return;
        const bccList = parse(bcc, false); if (!bccList) return;
        if (toList.length + ccList.length + bccList.length > 20) { to.setError('A message can go to 20 addresses at most.'); return; }
        if (!subject.value.trim() && !body.value.trim() && files.length === 0) { body.setError('Write a message first.'); return; }
        const sender = from.find((a) => a.addressId === fromField.value);
        api.setBusy(true);
        send.setAttribute('aria-busy', 'true');
        try {
          await sendMail({
            from: { addressId: sender.addressId, address: sender.address },
            to: toList, cc: ccList, bcc: bccList,
            subject: subject.value.trim(), text: body.value, attachments: files, inReplyTo, references,
          });
          api.close(true);
          toast('Message sent', { kind: 'ok' });
          bus.emit('mail', { mailboxId: sender.mailboxId, sent: true });
        } catch (err) {
          api.setError(err && err.message ? err.message : 'The message was not sent. Try again.');
        } finally {
          send.removeAttribute('aria-busy');
          api.setBusy(false);
        }
      } },
        fromField.el,
        to.el,
        moreBtn, more,
        subject.el,
        body.el,
        h('div', { class: 'stack stack-2' }, h('div', { class: 'row row-wrap' }, attachBtn, fileInput, h('span', { class: 'hint' }, `Up to ${bytesText(limit)} in total.`)), fileList, fileError),
        reply ? null : callout('info', '', h('p', null, 'Mail to people outside Postern is not end-to-end encrypted. Your Sent copy is encrypted in this browser before it is stored.')),
        h('div', { class: 'dialog-actions' }, button('Discard', { onClick: () => api.tryClose() }), send),
      );
    },
  });
  // In a reply, the cursor starts at the top of the message.
  if (reply) queueMicrotask(() => { body.input.focus(); body.input.setSelectionRange(0, 0); body.input.scrollTop = 0; });
  return dlg;
}
