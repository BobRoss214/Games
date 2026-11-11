// The one viewer for the text of an email. Every place that shows an email body uses it
// (the Mail screen, the viewer of an export file), so that the safety rules are in one place:
// - Plain text goes into the page as text nodes. Addresses that start with http(s) become links
//   that open in a new tab.
// - HTML is cleaned (lib/sanitize.js) and shown only inside a frame with no scripts and no
//   access to this page. Remote images are blocked.
// - Images inside the message ("cid:") come from decrypted attachments, as data: addresses.
import { h, replace, append } from '../lib/dom.js';
import { icon } from './icons.js';
import { segmented } from './components.js';
import { whyParts } from './why.js';
import { sanitizeEmail, inlineImageUrl, cidKey, htmlToText, INLINE_IMAGE_MAX } from '../lib/sanitize.js';

// Plain text with links for http(s) addresses. Everything is added as text nodes.
export function textWithLinks(text) {
  const out = document.createDocumentFragment();
  const re = /https?:\/\/[^\s<>"')\]]+/g;
  let last = 0;
  let m;
  const value = String(text || '');
  while ((m = re.exec(value))) {
    if (m.index > last) out.appendChild(document.createTextNode(value.slice(last, m.index)));
    const raw = m[0].replace(/[.,;:!?]+$/, '');
    re.lastIndex = m.index + raw.length;
    let href = '';
    try { href = new URL(raw).href; } catch { href = ''; }
    if (href) out.appendChild(h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, raw));
    else out.appendChild(document.createTextNode(raw));
    last = re.lastIndex;
  }
  if (last < value.length) out.appendChild(document.createTextNode(value.slice(last)));
  return out;
}

// body: { text, html } (decrypted). attachments: the list from the message meta
// ([{ cid, contentType, size }], optional). getAttachment(index): gives the decrypted bytes of
// attachment number index (1 = the first), optional: without it, pictures inside the message are not shown.
// scope: the scope of the screen (optional). Returns an element.
export function mailBody({ body, attachments = [], getAttachment = null, scope = null }) {
  const wrap = h('div', { class: 'mail-body' });
  const safeBody = body && typeof body === 'object' ? body : {};
  const text = safeBody.text || (safeBody.html ? htmlToText(safeBody.html) : '');
  const plain = () => h('pre', { class: 'mail-text' }, text ? textWithLinks(text) : h('span', { class: 'faint' }, 'This message has no text.'));
  if (!safeBody.html) { append(wrap, plain()); return wrap; }

  let mode = 'html';
  const inline = new Map();
  const slot = h('div', { class: 'mail-body-slot' });
  const whyImages = whyParts('remote-images', { text: 'Why?' });
  const note = h('p', { class: 'mail-note', hidden: true }, icon('eyeOff', { size: 14 }), h('span', null, 'Remote images are blocked to stop tracking.'), whyImages.button);
  const paint = () => {
    if (mode === 'text') { note.hidden = true; whyImages.panel.hidden = true; whyImages.button.setAttribute('aria-expanded', 'false'); replace(slot, plain()); return null; }
    const clean = sanitizeEmail(safeBody.html, inline);
    note.hidden = !clean.blockedRemote;
    // The frame has no scripts and no access to this page. Links open in a new tab.
    const frame = h('iframe', { class: 'mail-frame', sandbox: 'allow-popups allow-popups-to-escape-sandbox', referrerpolicy: 'no-referrer', title: 'Message text', srcdoc: clean.srcdoc });
    replace(slot, h('div', { class: 'mail-frame-wrap' }, frame));
    return clean;
  };
  const first = paint();
  append(wrap,
    h('div', { class: 'mail-body-bar' },
      segmented({ label: 'Show the message as', value: mode, options: [{ value: 'html', label: 'Formatted' }, { value: 'text', label: 'Plain text' }], onChange: (v) => { mode = v; paint(); } }),
      note,
    ),
    whyImages.panel,
    slot,
  );

  // Images inside the message ("cid:") come from decrypted attachments.
  const wanted = (first && first.wantedCids) || [];
  const jobs = [];
  if (getAttachment) {
    (Array.isArray(attachments) ? attachments : []).forEach((a, i) => {
      const key = cidKey(a.cid);
      if (!key || !wanted.includes(key) || (a.size || 0) > INLINE_IMAGE_MAX) return;
      jobs.push(Promise.resolve().then(() => getAttachment(i + 1)).then((bytes) => { const url = inlineImageUrl(bytes, a.contentType); if (url) inline.set(key, url); }).catch(() => {}));
    });
  }
  if (jobs.length) Promise.all(jobs).then(() => { if (!(scope && scope.disposed) && wrap.isConnected && inline.size && mode === 'html') paint(); });
  return wrap;
}
