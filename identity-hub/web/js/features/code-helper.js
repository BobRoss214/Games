// Code helper: an email or a text with a sign-up code shows the code with a "Copy" button.
// In the browser only. (The same chip is in Home "Recent" and in the feed of an identity:
// those are shared screens, see ui/code.js.)
import { h } from '../lib/dom.js';
import { registerMessagePanel, registerTextAddon } from '../lib/registry.js';
import { htmlToText } from '../lib/sanitize.js';
import { codeIn } from '../ui/code.js';

registerMessagePanel((message) => {
  if (message.direction !== 'in' || message.broken) return null;
  const body = message.body || {};
  const chip = codeIn(body.text || (body.html ? htmlToText(body.html) : ''), message.meta.subject);
  return chip ? h('div', { class: 'code-panel' }, chip) : null;
});

registerTextAddon((text) => (text.direction === 'in' ? codeIn(text.body) : null));
