// Display helpers: money, dates, phone numbers, sizes.

// Credits to "$12.40". 100 credits = 1.00 USD.
export function money(credits, { sign = false } = {}) {
  const n = Number(credits) || 0;
  const abs = Math.abs(n) / 100;
  const body = '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n < 0) return '−' + body;
  return sign && n > 0 ? '+' + body : body;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');

export function clock(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Unix seconds to a short time: "14:32" today, "Mon 14:32" this week, "Nov 3", "Nov 3, 2025".
export function shortTime(at) {
  if (!at) return '';
  const d = new Date(at * 1000);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return clock(d);
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  if (d.getFullYear() === now.getFullYear()) return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function fullTime(at) {
  if (!at) return '';
  const d = new Date(at * 1000);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${clock(d)}`;
}

export function isoTime(at) {
  return at ? new Date(at * 1000).toISOString() : '';
}

// "2026-11-03" to "Nov 3, 2026".
export function dayText(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!m) return String(day || '');
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

export function dayLabel(at) {
  const d = new Date(at * 1000);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${d.getFullYear() === now.getFullYear() ? '' : ', ' + d.getFullYear()}`;
}

export const E164 = /^\+[1-9]\d{6,14}$/;

// Accepts "+1 (415) 555-0123" and gives "+14155550123". Returns '' if it is not a full number.
export function cleanPhone(input) {
  const raw = String(input || '').trim();
  const digits = raw.replace(/[^\d+]/g, '');
  const withPlus = digits.startsWith('+') ? '+' + digits.slice(1).replace(/\+/g, '') : (digits.startsWith('00') ? '+' + digits.slice(2) : digits);
  return E164.test(withPlus) ? withPlus : '';
}

// "+14155550123" to "+1 415 555 0123". Other countries get plain groups.
export function phoneText(e164) {
  const v = String(e164 || '');
  if (!E164.test(v)) return v;
  if (v.startsWith('+1') && v.length === 12) return `+1 ${v.slice(2, 5)} ${v.slice(5, 8)} ${v.slice(8)}`;
  if (v.startsWith('+44') && v.length === 13) return `+44 ${v.slice(3, 7)} ${v.slice(7)}`;
  const cc = v.length > 11 ? v.slice(0, 3) : v.slice(0, 2);
  const rest = v.slice(cc.length);
  const groups = rest.match(/.{1,4}(?=(?:.{3,4})*$)|.+/g) || [rest];
  return `${cc} ${groups.join(' ')}`;
}

export function bytesText(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(v < 10240 ? 1 : 0)} KB`;
  return `${(v / 1024 / 1024).toFixed(1)} MB`;
}

export function duration(seconds) {
  const sNum = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(sNum / 60);
  const r = sNum % 60;
  return m ? `${m} min ${pad(r)} s` : `${r} s`;
}

export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

const COUNTRY = { US: 'United States', CA: 'Canada', GB: 'United Kingdom', DE: 'Germany', FR: 'France', NL: 'Netherlands', AU: 'Australia', SE: 'Sweden', ES: 'Spain', IT: 'Italy', IE: 'Ireland', CH: 'Switzerland', AT: 'Austria', BE: 'Belgium', DK: 'Denmark', FI: 'Finland', NO: 'Norway', PL: 'Poland', PT: 'Portugal' };
export const countryName = (code) => COUNTRY[String(code || '').toUpperCase()] || String(code || '').toUpperCase();

// Text message parts: 160 characters in the basic alphabet, 70 with other characters.
const GSM = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/;
export function textParts(body) {
  const len = [...body].length;
  if (len === 0) return { length: 0, parts: 0 };
  const basic = GSM.test(body);
  const single = basic ? 160 : 70;
  const multi = basic ? 153 : 67;
  return { length: len, parts: len <= single ? 1 : Math.ceil(len / multi) };
}

export function emailOk(address) {
  return /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/.test(String(address || '').trim());
}

// "a@b.com, c@d.org" to ['a@b.com', 'c@d.org']
export function splitAddresses(input) {
  return String(input || '').split(/[,;\s]+/).map((v) => v.trim().toLowerCase()).filter(Boolean);
}
