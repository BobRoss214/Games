// Makes an email's HTML safe to show.
//
// Two layers:
// 1. This file removes everything active and everything that loads from the network.
// 2. The result is shown only inside <iframe sandbox="allow-popups allow-popups-to-escape-sandbox">
//    with its own Content-Security-Policy: no scripts, no same-origin access, no network.
import { b64u } from '/shared/bytes.js';

const REMOVE = [
  'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'input', 'button', 'select', 'textarea',
  'option', 'link', 'meta', 'base', 'noscript', 'template', 'audio', 'video', 'source', 'track', 'svg', 'math', 'portal',
  'dialog', 'slot', 'canvas', 'title', 'picture > source',
].join(',');

const URL_ATTRS = ['href', 'src', 'action', 'formaction', 'background', 'poster', 'data', 'cite', 'longdesc', 'usemap', 'manifest', 'ping', 'xlink:href', 'srcset', 'lowsrc', 'dynsrc'];
const LINK_OK = /^(https?:|mailto:|tel:)/i;
const REMOTE = /^\s*(https?:)?\/\//i;
const INLINE_IMAGE = /^data:image\/(png|jpe?g|gif|webp|bmp);/i;
const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp']);
export const INLINE_IMAGE_MAX = 2 * 1024 * 1024;

// Removes url(...) and @import from CSS unless the url is an inline data image.
function cleanCss(css, note) {
  let out = String(css || '');
  if (/@import/i.test(out)) { note.blocked = true; out = out.replace(/@import[^;]*;?/gi, ''); }
  out = out.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (all, q, target) => {
    if (INLINE_IMAGE.test(target.trim())) return all;
    note.blocked = true;
    return 'none';
  });
  // Old script hooks in CSS.
  out = out.replace(/expression\s*\(|behavior\s*:|-moz-binding\s*:|javascript\s*:/gi, 'x-removed:');
  return out;
}

const cidKey = (v) => String(v || '').trim().replace(/^cid:/i, '').replace(/^<|>$/g, '').toLowerCase();

// html: string from the decrypted message.
// inlineImages: Map from content id to a data: URL (made from decrypted attachments).
// Returns { srcdoc, blockedRemote, wantedCids: [..] }.
export function sanitizeEmail(html, inlineImages = new Map()) {
  const note = { blocked: false };
  const wanted = new Set();
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');

  // Style elements: a style element with @import is removed. Others are cleaned.
  for (const el of [...doc.querySelectorAll('style')]) {
    const css = el.textContent || '';
    if (/@import/i.test(css)) { note.blocked = true; el.remove(); continue; }
    el.textContent = cleanCss(css, note);
  }
  for (const el of [...doc.querySelectorAll(REMOVE)]) el.remove();

  for (const el of [...doc.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      if (name.startsWith('on') || name === 'srcdoc' || name === 'ping' || name === 'formaction' || name === 'http-equiv' || name === 'is') { el.removeAttribute(attr.name); continue; }
      if (name === 'style') { el.setAttribute('style', cleanCss(value, note)); continue; }
      if (name === 'srcset' || name === 'imagesrcset') { note.blocked = true; el.removeAttribute(attr.name); continue; }
      if (!URL_ATTRS.includes(name)) continue;

      const compact = value.replace(/[\x00-\x20\xa0]+/g, '');
      if (el.localName === 'a' && name === 'href') {
        if (!LINK_OK.test(compact)) el.removeAttribute('href');
        continue;
      }
      if (el.localName === 'img' && name === 'src') {
        if (/^cid:/i.test(compact)) {
          const key = cidKey(compact);
          wanted.add(key);
          const data = inlineImages.get(key);
          if (data) el.setAttribute('src', data);
          else { el.removeAttribute('src'); el.setAttribute('data-inline-missing', ''); }
        } else if (INLINE_IMAGE.test(compact)) {
          /* an image inside the message itself: keep */
        } else {
          if (REMOTE.test(compact) || /^https?:/i.test(compact)) note.blocked = true;
          el.removeAttribute('src');
          el.setAttribute('data-blocked', '');
        }
        continue;
      }
      // Every other URL attribute (backgrounds, posters, map links, …) is removed.
      if (REMOTE.test(compact) || /^https?:/i.test(compact)) note.blocked = true;
      el.removeAttribute(attr.name);
    }
    if (el.localName === 'a') {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
      el.removeAttribute('download');
    }
  }

  // A blocked image becomes a small text mark with its alt text. A tracking pixel
  // (a tiny image) is removed with no mark.
  for (const img of [...doc.querySelectorAll('img')]) {
    if (img.hasAttribute('src')) { img.removeAttribute('loading'); continue; }
    const w = Number.parseInt(img.getAttribute('width') || '', 10);
    const ht = Number.parseInt(img.getAttribute('height') || '', 10);
    const alt = (img.getAttribute('alt') || '').trim();
    if ((w > 0 && w <= 3) || (ht > 0 && ht <= 3)) { img.remove(); continue; }
    const mark = doc.createElement('span');
    mark.setAttribute('data-blocked-image', '');
    mark.textContent = alt ? `Image: ${alt}` : 'Image';
    img.replaceWith(mark);
  }

  // Our own head: a strict policy for the frame and calm default type.
  const head = doc.head || doc.documentElement.insertBefore(doc.createElement('head'), doc.documentElement.firstChild);
  const csp = doc.createElement('meta');
  csp.setAttribute('http-equiv', 'Content-Security-Policy');
  csp.setAttribute('content', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'");
  const charset = doc.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  const base = doc.createElement('style');
  base.textContent = [
    'html{color-scheme:light;background:#fff}',
    'body{margin:16px;font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1b1d1a;background:#fff;overflow-wrap:anywhere}',
    'img{max-width:100%;height:auto}',
    'span[data-blocked-image]{display:inline-block;border:1px dashed #b9b2a0;border-radius:3px;font:12px/1.4 system-ui,sans-serif;color:#666960;padding:2px 6px;margin:2px 0}',
    'table{max-width:100%}',
    'pre{white-space:pre-wrap}',
    'a{color:#1f5e4b}',
    'blockquote{margin:0 0 0 12px;padding-left:12px;border-left:2px solid #dcd6c7;color:#4a4d46}',
  ].join('');
  head.insertBefore(base, head.firstChild);
  head.insertBefore(csp, head.firstChild);
  head.insertBefore(charset, head.firstChild);

  const srcdoc = '<!doctype html>' + doc.documentElement.outerHTML;
  return { srcdoc, blockedRemote: note.blocked, wantedCids: [...wanted] };
}

// Makes a data: URL for an inline image from decrypted attachment bytes.
export function inlineImageUrl(bytes, contentType) {
  const type = String(contentType || '').toLowerCase().split(';')[0].trim();
  if (!INLINE_TYPES.has(type) || bytes.length > INLINE_IMAGE_MAX) return null;
  // b64u gives URL-safe base64. A data: URL needs the normal alphabet.
  const b64 = b64u(bytes).replace(/-/g, '+').replace(/_/g, '/');
  return `data:${type};base64,${b64}${'='.repeat((4 - (b64.length % 4)) % 4)}`;
}

export { cidKey };

// Plain text from HTML, for messages that have no text part.
export function htmlToText(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  for (const el of [...doc.querySelectorAll('script,style,head,title,template,noscript')]) el.remove();
  for (const el of [...doc.querySelectorAll('br')]) el.replaceWith('\n');
  for (const el of [...doc.querySelectorAll('p,div,tr,li,h1,h2,h3,h4,h5,h6,blockquote')]) el.append('\n');
  return (doc.body ? doc.body.textContent : '').replace(/\n{3,}/g, '\n\n').trim();
}
