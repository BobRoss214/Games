// Voicemail: a caller who does not reach the user can leave a message.
//
// The provider plays the greeting and records the audio. When it reports that the
// recording is ready, the server fetches it, encrypts it for the account in the same form
// as a mail message (sealEnvelope), stores it, and then deletes the recording at the
// provider. The plain audio is in memory for a moment only. It is never written to a file
// and never logged.
//
// Limits of this design (the user must know them): the provider records the audio itself,
// so it hears the complete message. See "What the phone company hears and keeps" in docs/API.md.
import { sealEnvelope } from '../../shared/crypto.js';
import { nowSec } from '../core/db.js';
import { safeEqual } from '../core/keys.js';
import { ProviderError } from './providers/errors.js';

// No name and no number in the greeting: the caller learns nothing about the owner.
export const GREETING = 'The person you called is not available. Please leave a message after the tone.';
const MAX_BYTES = 5 * 1024 * 1024;
// The provider can count a second more than the limit that we gave.
const SECONDS_MARGIN = 5;
// A recording report is accepted this long after the end of the longest possible message.
const WAIT_SECONDS = 3600;
const FETCH_TRIES = 3;
const FETCH_PAUSE_MS = 300;

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

export function createVoicemail(app, ph) {
  const { config, db, keys, store, events, log } = app;
  // The caller of a call that can still get a voicemail: base64(call HMAC) -> { peer, expires }.
  // In memory only. The database has the caller only in sealed form, which the server cannot read.
  const peers = new Map();

  const maxSeconds = () => {
    const n = config.phone.voicemailMaxSeconds;
    return Number.isInteger(n) ? Math.min(3600, Math.max(1, n)) : 120;
  };

  // The time until which a recording for a call is accepted (stored in calls.vm_until).
  const until = () => nowSec() + maxSeconds() + WAIT_SECONDS;
  function sweep() {
    const now = nowSec();
    for (const [k, v] of peers) if (v.expires <= now) peers.delete(k);
  }

  // Nobody wants this recording (any more): delete it at the provider. If that fails, a job tries again.
  async function drop(ref) {
    try {
      await ph.provider.deleteRecording(ref);
    } catch (err) {
      if (err instanceof ProviderError && err.notFound) return;
      ph.releaseLater(keys.srvEncrypt(ref, 'ref'), 'recording');
      log.warn('a recording could not be deleted at the provider; a job tries again');
    }
  }

  async function fetchAudio(rec) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await ph.provider.fetchRecording({ ref: rec.recordingRef, url: rec.url }, { maxBytes: MAX_BYTES });
      } catch (err) {
        // Too large or gone: another try does not help.
        const final = err instanceof ProviderError && (err.tooLarge || err.notFound);
        if (final || attempt >= FETCH_TRIES) throw err;
        await pause(FETCH_PAUSE_MS * attempt);
      }
    }
  }

  return {
    maxSeconds,

    // Voicemail is offered if the user switched it on, the number works and has voice,
    // and the balance pays for one voicemail.
    applies(num) {
      return num.voicemail === 1 && num.status === 'active' && ph.hasVoice(num) && ph.capabilities.voicemail === true
        && store.canAfford(num.account_id, config.prices.voicemail);
    },
    // The voice instructions: greeting, tone, recording, end.
    actions() {
      return [{ say: GREETING }, { record: { maxSeconds: maxSeconds(), doneUrl: ph.urls.recording, actionUrl: ph.urls.status } }, { hangup: true }];
    },
    until,
    sweep,
    rememberPeer(callKey, peer) {
      if (peers.size > 5000) sweep();
      peers.set(callKey.toString('base64'), { peer, expires: until() });
    },

    // The provider reports a recording. Store it as a voicemail of its call, or delete it at
    // the provider if it belongs to nothing that we wait for. Either way, when this is
    // done the recording is gone at the provider (or is in the list of the retry job).
    async receive(rec) {
      const ref = rec && typeof rec.recordingRef === 'string' ? rec.recordingRef : '';
      if (!ref || rec.ready === false) return;
      const callKey = rec.callId ? keys.indexHmac('call', rec.callId) : null;
      const recKey = keys.indexHmac('rec', ref);
      const call = callKey ? db.get('SELECT id, account_id, number_id, vm_until FROM calls WHERE call_hmac = ?', callKey) : null;
      const have = call ? db.get('SELECT rec_hmac FROM voicemails WHERE call_id = ?', call.id) : null;
      // The same report again: the voicemail is stored already.
      if (have && safeEqual(have.rec_hmac, recKey)) return;

      const seconds = rec.seconds;
      const wanted = call && !have && call.vm_until !== null && call.vm_until >= nowSec()
        && Number.isInteger(seconds) && seconds >= 1 && seconds <= maxSeconds() + SECONDS_MARGIN;
      // A call that we do not know (its number or account is deleted), a call that got no
      // greeting, a second recording, or a wrong length: keep nothing, and leave nothing at the provider.
      if (!wanted) { await drop(ref); return; }

      let audio;
      try {
        audio = await fetchAudio(rec);
      } catch (err) {
        if (!(err instanceof ProviderError)) throw err;
        if (!err.tooLarge) log.warn('a voicemail recording could not be fetched from the provider');
        await drop(ref);
        return;
      }
      const account = store.getAccount(call.account_id);
      if (!account) { await drop(ref); return; }
      const k = callKey.toString('base64');
      const peer = peers.has(k) ? peers.get(k).peer : '';
      const env = await sealEnvelope(account.publicKey, { meta: { peer, seconds, contentType: audio.contentType }, body: {}, attachments: [audio.bytes] });
      // parts[1] is the encrypted audio. parts[0] is the empty body; it is not stored.
      let stored = 0;
      try {
        stored = db.run('INSERT OR IGNORE INTO voicemails (call_id, account_id, sealed_key, enc_meta, audio, size, seconds, rec_hmac) VALUES (?,?,?,?,?,?,?,?)',
          call.id, call.account_id, env.sealedKey, env.encMeta, env.parts[1], env.parts[1].length, seconds, recKey).changes;
      } catch {
        stored = 0; // the call was deleted while the audio arrived
      }
      // Only now, after the copy is safe (or not wanted any more): delete the recording at the provider.
      await drop(ref);
      if (!stored) return;
      peers.delete(k);
      let charged = false;
      try {
        store.charge(call.account_id, config.prices.voicemail, 'voicemail');
        charged = config.prices.voicemail > 0;
      } catch (err) {
        // The balance went down since the greeting. The user keeps the voicemail.
        if (err.code !== 'insufficient_funds') throw err;
      }
      events.publish(call.account_id, 'call', { numberId: call.number_id });
      if (charged) events.publish(call.account_id, 'balance');
    },
  };
}
