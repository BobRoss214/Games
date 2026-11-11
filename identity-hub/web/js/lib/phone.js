// Texts and calls for VoIP numbers. The server seals each text and call record to
// the account. This file opens them.
import { api, query } from './api.js';
import { openSealed } from './session.js';

export async function searchNumbers(country, areaCode) {
  const res = await api.get('/api/numbers/search' + query({ country, areaCode }));
  return res.numbers || [];
}

export async function listTexts(numberId, { before, limit = 100 } = {}) {
  const res = await api.get(`/api/numbers/${numberId}/texts` + query({ before, limit }));
  const texts = await Promise.all((res.texts || []).map(async (t) => {
    const open = await openSealed(t.sealed, 'text');
    return { id: t.id, direction: t.direction, at: t.at, seen: !!t.seen, peer: open ? String(open.peer || '') : '', body: open ? String(open.body || '') : '', broken: !open };
  }));
  return { texts, more: !!res.more };
}

// number = { id, number } (our own VoIP number in plain form)
export async function sendText(number, to, body) {
  const res = await api.post(`/api/numbers/${number.id}/texts`, { number: number.number, to, body });
  return res ? res.text : null;
}

export async function markTextsSeen(numberId) {
  await api.post(`/api/numbers/${numberId}/texts/seen`);
}

export async function deleteText(id) {
  await api.del(`/api/texts/${id}`);
}

export async function listCalls(numberId, { before, limit = 100 } = {}) {
  const res = await api.get(`/api/numbers/${numberId}/calls` + query({ before, limit }));
  const calls = await Promise.all((res.calls || []).map(async (c) => {
    const open = await openSealed(c.sealed, 'call');
    return { id: c.id, direction: c.direction, at: c.at, seconds: c.seconds || 0, status: c.status, peer: open ? String(open.peer || '') : '' };
  }));
  return { calls, more: !!res.more };
}

export async function startCall(number, to) {
  await api.post(`/api/numbers/${number.id}/calls`, { number: number.number, to });
}

export async function deleteCall(id) {
  await api.del(`/api/calls/${id}`);
}

// Groups texts by the other party. Returns threads, newest first.
export function threadsOf(texts) {
  const map = new Map();
  for (const t of texts) {
    const key = t.peer || 'Unknown';
    if (!map.has(key)) map.set(key, { peer: key, texts: [], unread: 0, last: null });
    const th = map.get(key);
    th.texts.push(t);
    if (t.direction === 'in' && !t.seen) th.unread++;
    if (!th.last || t.at > th.last.at) th.last = t;
  }
  const threads = [...map.values()];
  for (const th of threads) th.texts.sort((a, b) => a.at - b.at);
  threads.sort((a, b) => b.last.at - a.last.at);
  return threads;
}
