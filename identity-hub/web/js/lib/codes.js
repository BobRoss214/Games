// Code helper: finds a sign-up, login, or verification code in a text or an email,
// so that the app can show it with a copy button. It runs in the browser only.
//
// Rules:
// - It is careful, not eager. It answers only when a number is clearly a code.
// - A code needs a keyword close to it in the same sentence: "code", "verification", "PIN",
//   "OTP", "login", and the like, also in Spanish, French, German, Italian, and Portuguese.
//   The keyword comes before the code ("Your code is 482913") or after it ("482913 is your code").
// - A code is 4 to 8 digits, or two groups of digits ("123 456", "123-456"), or a short token of
//   capital letters and digits ("AB12CD"), or a letter prefix with digits ("G-482913").
// - It never answers with a year, a date, a time, a price, a phone number, a ZIP code, a number
//   inside a web address, or an order, invoice, tracking, or account number.
// - It reads the subject first, then the first 2,000 characters of the text. The work does not
//   grow with the length of the text.
//
// This file has no access to the page, to the network, or to storage.

const TEXT_LIMIT = 2000;
const SUBJECT_LIMIT = 300;
const BEFORE_WINDOW = 60; // a keyword can be this far before the code
const AFTER_WINDOW = 50;  // or this far after it

// Words that say "this is a code". Lower case; the text is compared without regard to case.
const POSITIVE = [
  '(?:pass|bestätigungs|bestaetigungs|sicherheits|verifizierungs|zugangs|einmal|anmelde|aktivierungs|freischalt|prüf|pruef|sms-?)?codes?',
  'c[óo]digos?', 'codic[ei]', 'claves?', 'kode', 'kod',
  'verification', 'verificaci[óo]n', 'verifica[çc][ãa]o', 'vérification', 'verifica', 'verify', 'verifying', 'verifizier\\w*', 'bestätig\\w*',
  'confirm(?:ation|ar|er)?', 'security', 'sécurité', 'seguridad', 'one[- ]time', 'otp', 'pin', 'pass ?code', 'password', 'passwort', 'contraseña',
  'log[- ]?in', 'sign[- ]?in', 'signing in', 'logging in', '2fa', 'two[- ]factor', 'two[- ]step', 'authentication', 'authenticate', 'authentification', 'autenticaci[óo]n',
];

// Words that say "this number is something else". A number right after one of them is no code.
const NEGATIVE = [
  // a kind of code that is not a login code
  '(?:promo(?:tional)?|discount|coupon|voucher|gift|referral|invite|invitation|booking|reservation|order|tracking|zip|post|postal|area|country|dial(?:ing)?|bar|qr|source|product|item|error|status|tax|sort|bank|swift|dress|offer|colou?r|rabatt|gutschein)[ -]?codes?',
  'zipcode', 'postcode', 'plz',
  'orders?', 'invoices?', 'tracking', 'track', 'ref', 'reference', 'receipt', 'transaction', 'ticket', 'case', 'booking', 'reservation', 'customer', 'member(?:ship)?',
  'account (?:number|no\\.?|nr\\.?)', 'acct', 'zip', 'postal', 'card', 'iban', 'routing', 'sku', 'item', 'model', 'serial', 'imei', 'vat', 'po box',
  'ext', 'extension', 'flight', 'gate', 'room', 'apt', 'suite', 'unit', 'version', 'build', 'call', 'dial', 'tel', 'fax',
  'bestellung', 'bestellnummer', 'rechnung', 'rechnungsnummer', 'kundennummer', 'pedido', 'factura', 'commande', 'facture', 'ordine', 'fattura',
];

// One pass finds all keywords. A negative phrase wins over the positive word inside it ("promo code").
const KEYWORDS = new RegExp(`(?:(${NEGATIVE.join('|')})|(${POSITIVE.join('|')}))(?![\\p{L}\\p{N}])`, 'giu');

// Candidates: a letter prefix with digits, two groups of digits, plain digits, or capital letters with digits.
const CANDIDATES = /[A-Z]{1,3}-[0-9]{4,8}|[0-9]{4}[ -][0-9]{4}|[0-9]{3}[ -][0-9]{3}|[0-9]{4,8}|[A-Z0-9]{4,10}/g;

const WORD_CHAR = /[\p{L}\p{N}]/u;
// Tokens of capital letters and digits that are words, sizes, or names of things.
const NOT_A_CODE = /^(?:2FA|[A-Z]{5,}[0-9]{1,4}|[0-9]+(?:ST|ND|RD|TH|AM|PM|KM|MB|GB|KG|X|D|G|K|P)|(?:MP|H|IPV|WIN|IOS|HTML|CSS|ES|PS|A|B|Q)[0-9]+)$/;
const MIXED_WINDOW = 25; // letters with digits must be this close after the keyword
const MONTH = /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|ene|abr|ago|dic|janv|févr|fév|mars|avr|mai|juin|juil|août|déc|mär|märz|okt|dez)[a-zéûä]*\.?,?\s+(?:[0-9]{1,2}(?:st|nd|rd|th)?\.?,?\s+)?$/i;
const MONTH_AFTER = /^\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;
const CURRENCY_BEFORE = /(?:[$€£¥₹]|\b(?:usd|eur|gbp|jpy|cad|aud|chf|inr|rs\.?))\s?$/i;
const AMOUNT_BEFORE = /\b(?:total|amount|balance|price|paid|payment of|charged?|cost|fee|refund(?:ed)?|deposit of|betrag|summe|importe|montant)\s*(?:of|is|was|:|=)?\s*$/i;
const UNIT_AFTER = /^\s?(?:[$€£¥₹%°]|(?:usd|eur|gbp|jpy|cad|aud|chf|inr|dollars?|euros?|pounds?|yen|minutes?|mins?|hours?|hrs?|seconds?|secs?|days?|weeks?|months?|years?|points?|pts|items?|km|miles?|mb|gb|kb|kg|lbs?|px|users?|people|times|characters?|digits?|credits?|units?|pieces?|steps?|calories|mah|views?|followers|likes)\b)/i;
const ENDING_BEFORE = /(?:ending (?:in|with)|ends (?:in|with)|last (?:4|four)(?: digits)?(?: are| is)?|terminad[ao] en|se terminant par|endet (?:auf|mit)|\*{2,}|x{3,}|•{2,})\s*:?\s*$/i;
const PROMO_NEAR = /%\s?off|\bdiscount|\bcoupon|\bpromo|\bvoucher|\bcheckout\b|free shipping|\brabatt|\bdescuento|\bréduction|\bsale\b/i;
const STATE_BEFORE = /(?:^|[\s,])[A-Z]{2}\s$/;
// A new sentence starts between the two places. A line break alone is no new sentence.
const SENTENCE_BREAK = /[.!?]["')\]]?\s+\p{L}/u;
const SENTENCE_END = /[.!?]["')\]]?\s/;
// "code is", "code:", "código es" directly before the number, and "is your" directly after it.
const STRONG_BEFORE = /(?:code|pin|otp|c[óo]digo|codice|clave|passcode)\s*(?:is|est|es|ist|lautet|è|é|:|=|-|–)?\s*:?\s*$/i;
const STRONG_AFTER = /^\s+(?:is|est|es|ist|é|è)\s+(?:your|the|ton|votre|tu|su|ihr|dein|seu|il)\b/i;

function keywordsOf(text) {
  const found = [];
  KEYWORDS.lastIndex = 0;
  for (let m = KEYWORDS.exec(text); m; m = KEYWORDS.exec(text)) {
    // A keyword is a whole word: "barcode" is not "code".
    if (m.index > 0 && WORD_CHAR.test(text[m.index - 1])) { KEYWORDS.lastIndex = m.index + 1; continue; }
    found.push({ start: m.index, end: m.index + m[0].length, positive: m[1] === undefined });
    if (found.length > 400) break;
  }
  return found;
}

// The run of characters without white space around a place: a web address or an email address is one such run.
function wordAround(text, start, end) {
  let a = start;
  let b = end;
  while (a > 0 && !/\s/.test(text[a - 1]) && start - a < 300) a--;
  while (b < text.length && !/\s/.test(text[b]) && b - end < 300) b++;
  return text.slice(a, b);
}

// True if the token is certainly something else than a code, by the characters around it.
function isSomethingElse(text, start, end, token, digitsOnly) {
  const before = text.slice(Math.max(0, start - 40), start);
  const after = text.slice(end, end + 40);
  const prev = before.slice(-1);
  const next = after.slice(0, 1);

  // Part of a longer word or number.
  if ((prev && WORD_CHAR.test(prev)) || (next && WORD_CHAR.test(next))) return true;
  if (prev !== '' && '#/=@_+$€£¥₹\\~^'.includes(prev)) return true;
  if (next !== '' && '/@=_%°'.includes(next)) return true;
  // A decimal number, a time, a date with dots or dashes, a version number.
  if (/[0-9][.,:]$/.test(before) || /^[.,:][0-9]/.test(after)) return true;
  // A phone number or another number in groups: more digits right before or right after.
  if (/[0-9+(](?:[ -]|\) ?)$/.test(before) || /[0-9]\)$/.test(before) || prev === '+' || prev === '(' || prev === '-') return true;
  if (/^(?:[ -]|\) ?)[0-9]/.test(after) || /^-[0-9]/.test(after)) return true;
  // Inside a web address or an email address.
  const word = wordAround(text, start, end);
  if (word.length > token.length && (/:\/\/|www\.|@/.test(word) || /[/=?&]/.test(word) || /\.[a-z]{2,}/i.test(word.replace(token, '')))) return true;
  // Money, units, card and phone endings, dates, places.
  if (CURRENCY_BEFORE.test(before) || AMOUNT_BEFORE.test(before) || UNIT_AFTER.test(after)) return true;
  if (ENDING_BEFORE.test(before)) return true;
  if (MONTH.test(before) || MONTH_AFTER.test(after)) return true;
  if (digitsOnly && token.length === 5 && STATE_BEFORE.test(before)) return true;
  // A year needs "code is 2025" or "2025 is your code" to count as a code.
  if (digitsOnly && token.length === 4) {
    const n = Number(token);
    if (n >= 1900 && n <= 2099 && !STRONG_BEFORE.test(before) && !STRONG_AFTER.test(after)) return true;
  }
  // An offer: "use code 482913 for 20% off".
  if (PROMO_NEAR.test(text.slice(Math.max(0, start - 60), end + 60))) return true;
  return false;
}

// Looks for the best code in one piece of text. Returns { code, display, score } or null.
function scan(text) {
  if (!text) return null;
  const keywords = keywordsOf(text);
  if (!keywords.some((k) => k.positive)) return null;
  let best = null;

  CANDIDATES.lastIndex = 0;
  let checked = 0;
  for (let m = CANDIDATES.exec(text); m && checked < 300; m = CANDIDATES.exec(text)) {
    checked++;
    const token = m[0];
    const start = m.index;
    const end = start + token.length;
    const digitsOnly = /^[0-9]+$/.test(token);
    const grouped = /^[0-9]+[ -][0-9]+$/.test(token);
    const prefixed = /^[A-Z]{1,3}-[0-9]+$/.test(token);
    const mixed = !digitsOnly && !grouped && !prefixed;
    // Capital letters with digits: both kinds must be there, and it must not be a word like "2FA".
    // A word with a number at its end ("COVID19") is no code either.
    if (mixed && (!/[0-9]/.test(token) || !/[A-Z]/.test(token) || NOT_A_CODE.test(token))) continue;
    if (isSomethingElse(text, start, end, token, digitsOnly)) continue;

    // The nearest keyword before the token, in the same sentence.
    let score = null;
    let before = null;
    for (const k of keywords) {
      if (k.end > start) break;
      if (start - k.end <= BEFORE_WINDOW) before = k;
    }
    if (before) {
      const between = text.slice(before.end, start);
      // A keyword counts in its own sentence only. "Ticket 99887 closed. 482913 is your code": the ticket is a different sentence.
      // A positive keyword also reaches a number that stands alone after the sentence ("...to finish signing in.\n\n482913").
      if (before.positive ? SENTENCE_BREAK.test(between) : SENTENCE_END.test(between)) before = null;
    }
    if (before && !before.positive) continue; // "order 482913"
    if (before && (!mixed || start - before.end <= MIXED_WINDOW)) score = start - before.end;

    // Or the nearest keyword after it: "482913 is your code". Letters with digits need the keyword in front.
    if (score === null && !mixed) {
      const after = keywords.find((k) => k.start >= end);
      if (after && after.positive && after.start - end <= AFTER_WINDOW && !SENTENCE_BREAK.test(text.slice(end, after.start))) score = 100 + (after.start - end);
    }
    if (score === null) continue;
    if (!best || score < best.score) {
      best = { code: prefixed ? token.slice(token.indexOf('-') + 1) : token.replace(/[ -]/g, ''), display: token, score };
    }
  }
  return best;
}

// Finds a verification code. Returns { code, display } or null.
// `code` is the text to copy ("123456"). `display` is the code as it was written ("123-456").
export function findCode(text, { subject } = {}) {
  const head = typeof subject === 'string' ? subject.slice(0, SUBJECT_LIMIT) : '';
  const body = typeof text === 'string' ? text.slice(0, TEXT_LIMIT) : '';
  let found = scan(head);
  if (!found) found = scan(body);
  // The subject says "code" and the text has the number alone on a line.
  if (!found && head && body) {
    const headWords = keywordsOf(head);
    if (headWords.some((k) => k.positive) && !headWords.some((k) => !k.positive)) {
      const line = /(?:^|\n)[ \t]*([0-9]{3}[ -][0-9]{3}|[0-9]{4}[ -][0-9]{4}|[0-9]{4,8})[ \t]*(?=\r?\n|$)/.exec(body);
      if (line) {
        const token = line[1];
        const at = line.index + line[0].indexOf(token);
        const year = /^[0-9]{4}$/.test(token) && Number(token) >= 1900 && Number(token) <= 2099;
        if (!year && !PROMO_NEAR.test(body.slice(Math.max(0, at - 60), at + 60))) found = { code: token.replace(/[ -]/g, ''), display: token };
      }
    }
  }
  return found ? { code: found.code, display: found.display } : null;
}
