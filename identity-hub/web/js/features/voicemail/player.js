// One audio player for decrypted sound (a voicemail). One plays at a time.
//
// The sound is in memory. The audio element reads it from a blob: URL. That URL is taken
// away when the player closes, when a different player opens, when the player leaves the
// page, and when the tab forgets the key.
import { h } from '../../lib/dom.js';
import { onForget } from '../../lib/session.js';

let active = null; // { key, el, audio, url, watch }

export function closePlayer() {
  if (!active) return;
  const old = active;
  active = null;
  clearInterval(old.watch);
  try { old.audio.pause(); } catch { /* not started */ }
  old.audio.removeAttribute('src');
  try { old.audio.load(); } catch { /* nothing to drop */ }
  URL.revokeObjectURL(old.url);
  if (old.onClose) old.onClose();
}

// The element that holds the open player of this key, or null.
// A list that paints again can put the same element back, and the sound goes on.
export const playerOf = (key) => (active && active.key === key ? active.holder : null);

// Makes the player and starts it. holder: the element that the caller shows (the player is inside it).
// Returns the audio element. onClose runs when the player goes away.
export function openPlayer(key, { bytes, contentType = '', label = 'Voicemail', holder, onClose = null, onError = null }) {
  closePlayer();
  const url = URL.createObjectURL(new Blob([bytes], contentType ? { type: contentType } : undefined));
  const audio = h('audio', { class: 'f-vm-audio', controls: true, preload: 'auto', 'aria-label': label });
  audio.addEventListener('error', () => { if (onError) onError(); });
  audio.src = url;
  const mine = { key, holder, audio, url, onClose, watch: 0, gone: 0 };
  // The element can be out of the page for a moment while a list paints again. Two checks in a row mean it is gone.
  mine.watch = setInterval(() => {
    if (active !== mine) { clearInterval(mine.watch); return; }
    mine.gone = holder.isConnected ? 0 : mine.gone + 1;
    if (mine.gone >= 2) closePlayer();
  }, 1500);
  active = mine;
  // The click of the person allows the sound. If the browser says no, the controls are there.
  const started = audio.play();
  if (started && typeof started.catch === 'function') started.catch(() => {});
  return audio;
}

onForget(closePlayer);
window.addEventListener('pagehide', closePlayer);
