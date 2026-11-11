// The line of one voicemail: "Voicemail · 0:23", Play, Download, and the words for loading and errors.
// It is used under a call in the Calls tab, and for a voicemail inside an export file.
import { h, replace } from '../../lib/dom.js';
import { ApiError } from '../../lib/api.js';
import { downloadBlob } from '../../lib/mail.js';
import { fullTime } from '../../lib/format.js';
import { button, runBusy } from '../../ui/components.js';
import { audioType, audioExtension } from './calls.js';
import { openPlayer, playerOf } from './player.js';

// 23 -> "0:23"
export const clockTime = (seconds) => { const s = Math.max(0, Math.round(Number(seconds) || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// key: a name for the player, different for each voicemail. at: start of the call (Unix seconds).
// load(): a promise with { bytes, contentType } (the open sound). Leave it out when the sound is
// not there; missing then says why in a few words.
export function voicemailLine({ key, seconds, at, load = null, missing = '' }) {
  const live = playerOf(key);
  if (live) return live; // the list painted again while this voicemail plays: keep the same player
  const label = h('span', { class: 'small strong nowrap' }, `Voicemail · ${clockTime(seconds)}`);
  const line = h('div', { class: 'f-vm', dataset: { vm: key } });
  if (!load) {
    line.append(h('div', { class: 'row row-2 row-wrap' }, label, h('span', { class: 'small muted' }, missing)));
    return line;
  }
  let audio = null; // { bytes, contentType } after the first load
  const status = h('p', { class: 'small muted', role: 'status', hidden: true });
  const say = (text, error = false) => {
    status.textContent = text || '';
    status.hidden = !text;
    status.classList.toggle('field-error', !!error);
    status.classList.toggle('muted', !error);
  };
  const problem = (err) => {
    if (err instanceof ApiError && err.status === 404) return 'This voicemail does not exist any more.';
    return (err && err.message) || 'The voicemail did not load. Try again.';
  };
  const get = async () => { if (!audio) audio = await load(); return audio; };
  const slot = h('div', { class: 'f-vm-slot' });

  const play = button('Play', { size: 'sm', attrs: { 'aria-label': `Play the voicemail, ${clockTime(seconds)}` }, onClick: (e, btn) => runBusy(btn, async () => {
    say('Loading the voicemail…');
    const a = await get();
    const el = openPlayer(key, {
      bytes: a.bytes, contentType: audioType(a.contentType), holder: line, label: `Voicemail of ${fullTime(at)}`,
      onClose: () => { replace(slot); play.hidden = false; },
      onError: () => say('This browser cannot play this sound. Download it, then open it with a different app.', true),
    });
    replace(slot, el);
    play.hidden = true;
    say('');
  }, { onError: (err) => { say(problem(err), true); return true; } }) });

  const download = button('Download', { size: 'sm', kind: 'quiet', iconName: 'download', attrs: { 'aria-label': 'Download the voicemail' }, onClick: (e, btn) => runBusy(btn, async () => {
    if (!audio) say('Loading the voicemail…');
    const a = await get();
    const d = new Date(at * 1000);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    downloadBlob(a.bytes, `voicemail-${day}.${audioExtension(a.contentType)}`, a.contentType);
    if (status.textContent.startsWith('Loading')) say('');
  }, { onError: (err) => { say(problem(err), true); return true; } }) });

  line.append(h('div', { class: 'row row-2 row-wrap' }, label, play, slot, download), status);
  return line;
}
