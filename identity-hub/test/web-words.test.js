// A guard for the words of the web app: no screen may show a word that docs/UI-GUIDE.md
// forbids ("The words"), a word that promises too much, or the product name as a fixed text.
//
// The test reads every JavaScript file in web/js/ and web/index.html, takes the texts that a
// person can see, and looks for the forbidden words. A hit prints its file and line.
//
// What counts as a text that a person can see: a string in the code that has a space in it or
// starts with a capital letter. Not counted: comments, import paths, paths of the server
// ("/api/..."), CSS classes and selectors, and the names of object fields.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const WEB = join(ROOT, 'web');
const GUIDE = readFileSync(join(ROOT, 'docs', 'UI-GUIDE.md'), 'utf8');

// ---------- the forbidden words ----------

// Names that the guide forbids. say = the word that the guide wants. row = the first cell of the
// guide's table row that forbids it; guideWord = the exact words in the "Do not say" cell of that row.
const GUIDE_WORDS = [
  { find: /\bmailbox(es)?\b/i, name: 'mailbox', say: 'inbox', row: 'inbox', guideWord: 'mailbox' },
  { find: /\bburner\b/i, name: 'burner', say: 'alias', row: 'alias', guideWord: 'burner address' },
  { find: /\bmade[- ]up details?\b/i, name: 'made-up details', say: 'random identifiers', row: 'random identifiers', guideWord: 'made-up details' },
  { find: /\bfake identit(y|ies)\b/i, name: 'fake identity', say: 'random identifiers', row: 'random identifiers', guideWord: 'fake identity' },
  { find: /\bpersonas?\b/i, name: 'persona', say: 'random identifiers, or identity for the group', row: 'random identifiers', guideWord: 'persona' },
  { find: /\bsuspended\b/i, name: 'suspended', say: 'paused', row: 'paused', guideWord: 'suspended' },
  { find: /\bone-shot\b/i, name: 'one-shot', say: '"Stop after the first mail", "One mail only", "Used up"', row: 'used up', guideWord: 'one-shot' },
  { find: /\blog(ged|ging)?[ -]?(in|out|off)\b|\blogins?\b/i, name: 'log in, log out', say: 'sign in, sign out', row: 'sign in / sign out', guideWord: 'log in' },
  { find: /\bVoIP\b/i, name: 'VoIP', say: 'number', row: 'number', guideWord: 'VoIP number' },
  { find: /\bWebAuthn\b/i, name: 'WebAuthn', say: 'passkey', row: 'passkey', guideWord: 'WebAuthn' },
  { find: /\b(OTP|2FA)\b/i, name: 'OTP, 2FA', say: 'code', row: 'code', guideWord: 'OTP' },
  { find: /\btop[ -]?ups?\b/i, name: 'top up', say: 'add funds', row: 'funds / Add funds', guideWord: 'top up' },
];
// Words that promise too much. The guide: be honest about limits, never promise "anonymous" or "untraceable".
const PROMISES = [
  { find: /\banonym(ous|ously|ity)\b/i, name: 'anonymous' },
  { find: /\buntraceable\b/i, name: 'untraceable' },
  { find: /\binvisible\b/i, name: 'invisible' },
  { find: /100\s?%/, name: '100%' },
  { find: /\bguarantee[sd]?\b/i, name: 'guarantee' },
  { find: /\bmilitary[- ]grade\b/i, name: 'military-grade' },
  { find: /\bunhackable\b/i, name: 'unhackable' },
];
// The name of the product comes from the server (config.appName). A screen shows it with appName().
const PRODUCT = { find: /Postern/, name: 'the product name as a fixed text', say: 'appName() of lib/store.js' };
// The one place where the fixed name is right: the fallback inside appName().
const PRODUCT_ALLOWED = ['web/js/lib/store.js'];
// Files whose strings a person never sees.
const NOT_SHOWN = [
  'web/js/lib/codes.js', // the words that the code helper looks for in a message of a stranger ("log in", "OTP", ...)
];

// ---------- read the strings of a JavaScript file ----------

// Gives [{ text, line, before, after }] for each string of the source: 'single', "double", and the
// fixed parts of a `template`. Comments are left out. before = the code just before the string
// (one line at most), after = the first character of code after it.
export function stringsOf(source) {
  const out = [];
  const n = source.length;
  let i = 0;
  let line = 1;
  let lastCode = '';   // the last character of code that is not space
  let lastWord = '';   // the word that ends at lastCode, if it is a word
  const before = (at) => source.slice(Math.max(0, source.lastIndexOf('\n', at - 1) + 1), at).slice(-120);
  const afterOf = (at) => { let j = at; while (j < n && /\s/.test(source[j])) j++; return source[j] || ''; };
  const note = (ch) => { if (/[A-Za-z0-9_$]/.test(ch)) lastWord = /[A-Za-z0-9_$]/.test(lastCode) ? lastWord + ch : ch; else lastWord = ''; lastCode = ch; };
  // A "/" starts a regular expression when a value cannot end just before it.
  const regexCanStart = () => lastCode === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(lastCode) || /^(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/.test(lastWord);

  function readQuoted(quote) {
    const startLine = line;
    const start = i;
    let text = '';
    i++;
    while (i < n && source[i] !== quote) {
      if (source[i] === '\\') { text += source[i + 1] === 'n' ? '\n' : source[i + 1] || ''; i += 2; continue; }
      if (source[i] === '\n') line++;
      text += source[i++];
    }
    i++;
    out.push({ text, line: startLine, before: before(start), after: afterOf(i) });
    note('"');
  }
  // A template is one text. Each ${value} becomes a space, so that the fixed words stay one sentence.
  // (The strings inside a ${ } are read too, each as its own string.)
  function readTemplate() {
    const start = i;
    const startLine = line;
    const mine = { text: '', line: startLine, before: before(start), after: '' };
    out.push(mine);
    i++;
    while (i < n && source[i] !== '`') {
      if (source[i] === '\\') { mine.text += source[i + 1] || ''; i += 2; continue; }
      if (source[i] === '$' && source[i + 1] === '{') {
        i += 2;
        readCode('}');
        mine.text += ' ';
        continue;
      }
      if (source[i] === '\n') line++;
      mine.text += source[i++];
    }
    i++;
    mine.after = afterOf(i);
    note('"');
  }
  // Reads code up to the closing brace of a ${ } (stop = '}'), or to the end of the file (stop = '').
  function readCode(stop) {
    let depth = 0;
    while (i < n) {
      const ch = source[i];
      if (ch === '\n') { line++; i++; continue; }
      if (ch === '/' && source[i + 1] === '/') { while (i < n && source[i] !== '\n') i++; continue; }
      if (ch === '/' && source[i + 1] === '*') { const end = source.indexOf('*/', i + 2); const stopAt = end < 0 ? n : end + 2; line += source.slice(i, stopAt).split('\n').length - 1; i = stopAt; continue; }
      if (ch === "'" || ch === '"') { readQuoted(ch); continue; }
      if (ch === '`') { readTemplate(); continue; }
      if (ch === '/' && regexCanStart()) {
        // A regular expression: go to its end. A "/" inside [ ] does not end it.
        let j = i + 1;
        let inClass = false;
        while (j < n && source[j] !== '\n') {
          if (source[j] === '\\') { j += 2; continue; }
          if (source[j] === '[') inClass = true; else if (source[j] === ']') inClass = false; else if (source[j] === '/' && !inClass) break;
          j++;
        }
        i = j + 1;
        while (i < n && /[a-z]/.test(source[i])) i++;
        note(')');
        continue;
      }
      if (stop && ch === '{') depth++;
      if (stop && ch === '}') { if (depth === 0) { i++; return; } depth--; }
      if (!/\s/.test(ch)) note(ch);
      i++;
    }
  }
  readCode('');
  return out;
}

// ---------- which strings does a person see? ----------

const CLASS_WORD = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
// "sheet sheet-pad stack": words of small letters with a hyphen somewhere, and nothing else.
const looksLikeClasses = (text) => { const words = text.trim().split(/\s+/); return words.every((w) => CLASS_WORD.test(w)) && words.some((w) => w.includes('-')); };

export function isVisible({ text, before, after }) {
  const t = text.trim();
  if (!t || !/[A-Za-z]/.test(t)) return false;
  // A word that goes straight into a text on the screen, also when it is one small word: plural(n, 'inbox').
  const shown = /\b(plural|tag|toast|button|linkButton|iconButton)\([^()]*$/.test(before);
  // The rule: a space in it, or a capital letter at the start.
  if (!shown && !/\s/.test(t) && !/^[A-Z]/.test(t)) return false;
  // Paths: imports, routes, and paths of the server. Selectors of CSS.
  if (/^(\.{0,2}\/|https?:|[.#[*>])/.test(t)) return false;
  if (/\b(from|import)\s*\(?\s*$/.test(before)) return false;
  // CSS classes: after "class:" or "cls:", or a text that is a list of classes.
  if (/\b(class|cls|className)\s*[:=]\s*[^,;]*$/.test(before) || looksLikeClasses(t)) return false;
  // The name of an object field: { 'first-mail': ... }
  if (after === ':' && /[{,]\s*$/.test(before)) return false;
  return true;
}

// ---------- read the files ----------

function filesOf(dir, ext) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) out.push(...filesOf(file, ext));
    else if (name.endsWith(ext)) out.push(file);
  }
  return out.sort();
}

// The texts of an HTML file that a person can see or hear: the text between tags, and the
// attributes title, alt, placeholder, aria-label and content. Scripts and styles are left out.
export function htmlTexts(html) {
  const out = [];
  const lineAt = (index) => html.slice(0, index).split('\n').length;
  const clean = html.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' ')).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, (m) => m.replace(/[^\n]/g, ' '));
  for (const m of clean.matchAll(/>([^<>]+)</g)) if (m[1].trim()) out.push({ text: m[1].trim(), line: lineAt(m.index + 1 + m[1].search(/\S/)) });
  for (const m of clean.matchAll(/\b(title|alt|placeholder|aria-label|content)\s*=\s*"([^"]*)"/gi)) if (m[2].trim()) out.push({ text: m[2].trim(), line: lineAt(m.index) });
  return out;
}

function visibleTexts() {
  const out = [];
  for (const file of filesOf(join(WEB, 'js'), '.js')) {
    const path = relative(ROOT, file).split('\\').join('/');
    if (NOT_SHOWN.includes(path)) continue;
    for (const s of stringsOf(readFileSync(file, 'utf8'))) if (isVisible(s)) out.push({ path, line: s.line, text: s.text.replace(/\s+/g, ' ').trim() });
  }
  const index = join(WEB, 'index.html');
  for (const s of htmlTexts(readFileSync(index, 'utf8'))) out.push({ path: 'web/index.html', line: s.line, text: s.text.replace(/\s+/g, ' ').trim() });
  return out;
}

function hitsOf(rules, texts, allowed = []) {
  const hits = [];
  for (const t of texts) {
    if (allowed.includes(t.path)) continue;
    for (const rule of rules) {
      const m = rule.find.exec(t.text);
      if (m) hits.push(`${t.path}:${t.line}  "${m[0]}"${rule.say ? ` (say: ${rule.say})` : ''}  in: ${t.text.slice(0, 110)}`);
    }
  }
  return hits;
}
const report = (title, hits) => `${title}\n  ${hits.join('\n  ')}\n`;

// ---------- the tests ----------

test('words: the reader of the code finds strings, and leaves out comments and code', () => {
  const sample = [
    "import { h } from '../lib/dom.js'; // a comment with 'Mailbox in a comment'",
    "/* 'Also a comment' */",
    "const a = h('p', { class: 'small muted', title: 'A title here' }, 'Visible text', `Hello ${name}, you have ${n} mails`);",
    "const WORDS = { 'first-mail': 'First mail', made: 'Made' };",
    "const re = /['\"]quote in a regex['\"]/; const b = x / 2; const c = 'After a regex';",
    "api.get('/api/mailboxes'); el.querySelector('.persona-card'); const k = cond ? 'page' : 'page page-narrow';",
    "if (e.key === 'Enter') go(\"Double quotes work\");",
    "const kind = 'mailbox'; bus.on('mailbox', load); const words = plural(n, 'mailbox', 'mailboxes');",
    "const multi = `line one",
    "line two`;",
  ].join('\n');
  const all = stringsOf(sample);
  const texts = all.map((s) => s.text);
  for (const inside of ['Mailbox in a comment', 'Also a comment', 'quote in a regex']) assert.ok(!texts.some((t) => t.includes(inside)), `"${inside}" is not a string of the code`);
  assert.ok(texts.includes('After a regex') && texts.includes('Double quotes work'));
  assert.deepEqual(all.filter(isVisible).map((s) => [s.text.replace(/\s+/g, ' ').trim(), s.line]), [
    ['A title here', 3], ['Visible text', 3], ['Hello , you have mails', 3],
    ['First mail', 4], ['Made', 4], ['After a regex', 5], ['Enter', 7], ['Double quotes work', 7],
    ['mailbox', 8], ['mailboxes', 8], ['line one line two', 9],
  ]);
  // A forbidden word is found in a text for a person, and not in a name of the code.
  const found = hitsOf(GUIDE_WORDS, all.filter(isVisible).map((s) => ({ path: 'sample.js', line: s.line, text: s.text })));
  assert.equal(found.length, 2, found.join('\n'));
  assert.ok(found.every((hit) => hit.startsWith('sample.js:8  "mailbox')), found.join('\n'));
  assert.deepEqual(htmlTexts('<title>App</title>\n<!-- <p>No</p> -->\n<p class="x" title="Tip text">Hello <b>you</b></p>\n<script>var s = "<p>code</p>";</script>').map((s) => [s.text, s.line]),
    [['App', 1], ['Hello', 3], ['you', 3], ['Tip text', 3]]);
});

test('words: the list of forbidden names is the list of the guide', () => {
  // The rows of the table in "The words": | Say | Meaning | Do not say |
  const rows = new Map();
  for (const line of GUIDE.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length >= 5 && cells[1] && cells[1] !== 'Say' && !/^-+$/.test(cells[1])) rows.set(cells[1], cells[3]);
  }
  assert.ok(rows.size >= 20, 'the table of words in docs/UI-GUIDE.md was not found');
  for (const w of GUIDE_WORDS) {
    const row = [...rows].find(([say]) => say === w.row || say.startsWith(w.row));
    assert.ok(row, `docs/UI-GUIDE.md has no row "${w.row}"`);
    assert.ok(row[1].split(',').map((x) => x.trim()).includes(w.guideWord), `the guide does not forbid "${w.guideWord}" in the row "${w.row}": ${row[1]}`);
    assert.match(w.guideWord, w.find, `the pattern for "${w.name}" does not find the guide's word`);
  }
  assert.match(GUIDE, /Never promise "anonymous", "untraceable"/);
});

test('words: the reader finds many visible texts, in every part of the app', () => {
  const texts = visibleTexts();
  assert.ok(texts.length > 1500, `only ${texts.length} texts were found`);
  for (const part of ['web/js/screens/', 'web/js/ui/', 'web/js/features/', 'web/js/help/', 'web/js/lib/', 'web/index.html']) assert.ok(texts.some((t) => t.path.startsWith(part)), `no text from ${part}`);
  // Known texts of the app are in the list, with the right line.
  const has = (path, text) => texts.some((t) => t.path === path && t.text === text);
  assert.ok(has('web/js/features/insights/stats.js', 'Counted in this browser. The server keeps no stats.'));
  assert.ok(has('web/js/features/blocks.js', 'Block this sender'));
});

test('words: no screen shows a name that the guide forbids', () => {
  const hits = hitsOf(GUIDE_WORDS, visibleTexts());
  assert.equal(hits.length, 0, report(`${hits.length} text(s) use a name that docs/UI-GUIDE.md forbids:`, hits));
});

test('words: no screen shows a word that promises too much', () => {
  const hits = hitsOf(PROMISES, visibleTexts());
  assert.equal(hits.length, 0, report(`${hits.length} text(s) promise too much:`, hits));
});

test('words: no screen has the product name as a fixed text', () => {
  const hits = hitsOf([PRODUCT], visibleTexts(), PRODUCT_ALLOWED);
  assert.equal(hits.length, 0, report(`${hits.length} text(s) have the product name. A screen takes it from the config:`, hits));
});
