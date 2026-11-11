// Voicemail data: which calls have a voicemail, and the audio of one voicemail.
//
// The server gives each call a "voicemail" field ({ seconds, size, sealedKey, encMeta } or null),
// and each number a "voicemail" switch. The shared loaders (lib/phone.js, lib/data.js) do not
// pass these two fields on yet. Until they do, this file asks the same two routes again and
// keeps only these fields, in memory. Nothing here is written to browser storage.
import { api, query } from '../../lib/api.js';
import { bus } from '../../lib/store.js';
import { getKeys, onForget } from '../../lib/session.js';
import { unb64u } from '/shared/bytes.js';
import { openContentKey, openMeta, openAttachment } from '/shared/crypto.js';

// ---------- the switch of each number ----------

const switches = new Map(); // number id -> true | false
let switchesLoad = null;

// true, false, or undefined when it is not known yet.
export function switchOf(number) {
  if (typeof number.voicemail === 'boolean') return number.voicemail; // for the day the store has the field
  return switches.get(number.id);
}
export function setSwitch(numberId, on) { switches.set(numberId, !!on); }

// One request for all numbers. Calls at the same time share it.
export function loadSwitches() {
  if (!switchesLoad) {
    switchesLoad = api.get('/api/numbers').then((res) => {
      for (const n of (res && res.numbers) || []) switches.set(n.id, n.voicemail === true);
    }).finally(() => { switchesLoad = null; });
  }
  return switchesLoad;
}

// ---------- the voicemail of each call ----------

const PAGE = 200;
const MAX_PAGES = 5;
const known = new Map();   // number id -> Map(call id -> voicemail | null)
const pending = new Map(); // number id -> { asks: Map(call id -> { at, done: [] }), started: bool }

// The voicemail of a call: an object, null (the call has none), or undefined (not known yet).
export function voicemailOf(call, number) {
  if (call.voicemail !== undefined) return call.voicemail || null; // for the day the list passes the field on
  const map = known.get(number.id);
  return map && map.has(call.id) ? map.get(call.id) : undefined;
}

// Asks the server. Calls of one number that are asked in the same moment share the requests.
export function askVoicemail(call, number) {
  const now = voicemailOf(call, number);
  if (now !== undefined) return Promise.resolve(now);
  return new Promise((resolve) => {
    let job = pending.get(number.id);
    if (!job) { job = { asks: new Map(), started: false }; pending.set(number.id, job); }
    const ask = job.asks.get(call.id) || { at: call.at, done: [] };
    ask.done.push(resolve);
    job.asks.set(call.id, ask);
    if (!job.started) { job.started = true; queueMicrotask(() => runJob(number.id, job)); }
  });
}

async function runJob(numberId, job) {
  pending.delete(numberId);
  const map = known.get(numberId) || new Map();
  try {
    const ats = [...job.asks.values()].map((a) => a.at);
    const oldest = Math.min(...ats);
    let before = Math.max(...ats) + 1;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await api.get(`/api/numbers/${numberId}/calls` + query({ before, limit: PAGE }));
      const calls = (res && res.calls) || [];
      for (const c of calls) map.set(c.id, c.voicemail && typeof c.voicemail === 'object' ? c.voicemail : null);
      if (!calls.length || !res.more) break;
      before = calls[calls.length - 1].at;
      if (before <= oldest) break;
    }
    known.set(numberId, map);
  } catch { /* the line of the call shows nothing; the next paint asks again */ }
  for (const [id, ask] of job.asks) {
    const value = map.has(id) ? map.get(id) : null;
    for (const done of ask.done) done(value);
  }
}

// The call list changed (a new call, a new voicemail, a call deleted): ask again at the next paint.
bus.on('call', (data) => { if (data && data.numberId) known.delete(data.numberId); else known.clear(); });
onForget(() => { known.clear(); switches.clear(); });

// ---------- the audio ----------

// Types that the audio element may get. Everything else plays (or not) as "unknown".
const AUDIO_TYPES = new Set(['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/mp4', 'audio/webm', 'audio/aac']);
export const audioType = (type) => { const t = String(type || '').toLowerCase().split(';')[0].trim(); return AUDIO_TYPES.has(t) ? t : ''; };
export function audioExtension(type) {
  const t = audioType(type);
  if (t === 'audio/mpeg' || t === 'audio/mp3') return 'mp3';
  if (t === 'audio/wav' || t === 'audio/x-wav' || t === 'audio/wave') return 'wav';
  if (t === 'audio/ogg') return 'ogg';
  if (t === 'audio/mp4' || t === 'audio/aac') return 'm4a';
  if (t === 'audio/webm') return 'webm';
  return 'bin';
}

// Downloads the encrypted audio of a call and opens it in this browser.
// voicemail: { sealedKey, encMeta } from the call. Returns { bytes, contentType, seconds }.
export async function loadVoicemailAudio(callId, voicemail) {
  const sealed = await api.bytes(`/api/calls/${callId}/voicemail`);
  let key;
  let bytes;
  try {
    key = await openContentKey(getKeys(), unb64u(voicemail.sealedKey));
    bytes = await openAttachment(key, sealed, 1);
  } catch {
    throw new Error('This voicemail cannot be opened with your key.');
  }
  let meta = null;
  try { meta = await openMeta(key, unb64u(voicemail.encMeta)); } catch { /* the audio still plays */ }
  return {
    bytes,
    contentType: audioType(meta && meta.contentType),
    seconds: Number.isInteger(voicemail.seconds) ? voicemail.seconds : 0,
  };
}
