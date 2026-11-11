// The page that opens an export file again: /open-export.
//
// It works with no account and no server data. Every file that this page needs is imported
// at the top (no import() later), so after the page has loaded it asks the server for nothing.
// The file is read in pieces from the disk of the person. The key and the open contents stay
// in memory, and they are gone when the page closes. Nothing goes into a URL or into browser storage.
//
// Email HTML shows the same way as on the Mail screen: lib/sanitize.js cleans it, and it sits in
// a frame with sandbox="allow-popups allow-popups-to-escape-sandbox" (no scripts, no access to this page).
import { h, replace, uid, debounce } from '../../lib/dom.js';
import { store } from '../../lib/store.js';
import { getKeys, isUnlocked } from '../../lib/session.js';
import { downloadBlob, personText, personShort } from '../../lib/mail.js';
import { sanitizeEmail, inlineImageUrl, cidKey, htmlToText, INLINE_IMAGE_MAX } from '../../lib/sanitize.js';
import { threadsOf } from '../../lib/phone.js';
import { isPersona, fullName, addressLines } from '../../lib/persona/index.js';
import { bytesText, dayText, fullTime, shortTime, phoneText, plural, duration } from '../../lib/format.js';
import { button, callout, tabs, chips, segmented, pageHeader, emptyState, tag, runBusy } from '../../ui/components.js';
import { icon } from '../../ui/icons.js';
import { recoveryInput } from '../../screens/signin.js';
import { readExportHeader, openExport, EXPORT_ERRORS } from '../../lib/exportfile.js';
import { parseRecoveryKey } from '/shared/recovery.js';
import { closePlayer } from '../voicemail/player.js';
import { voicemailLine } from '../voicemail/line.js';

const ROWS = 100;                          // mail rows that show at first, and with each "Show more"
const AUTO_CHECK_BYTES = 64 * 1024 * 1024; // a file up to this size is checked whole right after it opens

// The same words as on the sign-in screen.
function keyMessage(err) {
  if (err && err.code === 'bad_checksum') return 'This key has a typing error. Check each group of four characters.';
  if (err && err.code === 'bad_format') return 'A recovery key has 36 letters and numbers, in 9 groups of 4.';
  return (err && err.message) || 'That did not work. Try again.';
}
const errorBox = () => h('p', { class: 'form-error', role: 'alert', hidden: true });
const showError = (box, message) => { box.textContent = message || ''; box.hidden = !message; };
const timeEl = (at, cls = 'small muted nowrap') => h('time', { class: cls, datetime: new Date(at * 1000).toISOString() }, fullTime(at));
const byNewest = (a, b) => b.at - a.at;

// Random identifiers of an alias, a number or an identity. Read-only.
function identifiers(persona) {
  if (!isPersona(persona)) return null;
  return h('div', { class: 'stack stack-1', dataset: { export: 'identifiers' } },
    h('p', { class: 'small muted' }, 'Random identifiers'),
    h('p', { class: 'strong' }, fullName(persona)),
    h('address', { class: 'persona-address small' }, addressLines(persona).map((line) => h('span', null, line))),
  );
}

export default function openExportScreen({ scope }) {
  const root = h('div', { class: 'page page-narrow', dataset: { export: 'viewer' } });
  const signedIn = store.get('phase') === 'in';
  const header = (lede) => pageHeader({ title: 'Open an export file', lede, back: signedIn ? { href: '/settings', label: 'Settings' } : null });
  scope.add(closePlayer);

  // ---------- step 1: choose the file ----------
  function showPick(message = '') {
    closePlayer();
    root.className = 'page page-narrow';
    const error = errorBox();
    const input = h('input', { type: 'file', accept: '.postern,application/octet-stream', hidden: true, 'aria-label': 'Export file' });
    const choose = button('Choose a file', { kind: 'primary', iconName: 'file', onClick: () => input.click() });
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      runBusy(choose, async () => { showKey(file, await readExportHeader(file)); }, { onError: (err) => { showError(error, (err && err.message) || EXPORT_ERRORS.notExport); return true; } });
    });
    replace(root,
      header('Read a file that you made with “Download my data”. The file opens in this browser. Nothing from it is sent to the server.'),
      h('div', { class: 'sheet sheet-pad stack' },
        h('p', { class: 'read' }, 'You need the file and the recovery key of the account that made it. You do not need to sign in.'),
        h('div', null, choose, input),
        h('p', { class: 'hint' }, 'The name of the file ends in .postern.'),
        error,
      ),
    );
    showError(error, message);
  }

  // ---------- step 2: the key ----------
  function showKey(file, head) {
    root.className = 'page page-narrow';
    const error = errorBox();
    const unlocked = isUnlocked();
    const keyField = recoveryInput('export-key');
    const submit = button('Open the file', { kind: unlocked ? '' : 'primary', type: 'submit' });
    const opened = (result) => { keyField.value = ''; showFile(file, result); };

    const withAccount = unlocked ? button('Open with this account', { kind: 'primary', onClick: (e, btn) => {
      showError(error, '');
      runBusy(btn, async () => { opened(await openExport(file, { accountKey: getKeys().accountKey })); }, { onError: (err) => {
        showError(error, err && err.message === EXPORT_ERRORS.wrongKey ? 'This file is from a different account. Use the recovery key of the account that made the file.' : ((err && err.message) || EXPORT_ERRORS.damaged));
        if (!keyField.disabled) keyField.focus();
        return true;
      } });
    } }) : null;

    const form = h('form', { class: 'stack', novalidate: true, onSubmit: (e) => {
      e.preventDefault();
      showError(error, '');
      if (!keyField.value.trim()) { showError(error, 'Enter the recovery key.'); keyField.focus(); return; }
      runBusy(submit, async () => {
        let bytes;
        try { bytes = await parseRecoveryKey(keyField.value); } catch (err) { throw Object.assign(new Error(keyMessage(err)), { typing: true }); }
        try { opened(await openExport(file, { recoveryBytes: bytes })); } finally { bytes.fill(0); }
      }, { onError: (err) => { showError(error, (err && err.message) || EXPORT_ERRORS.damaged); keyField.focus(); return true; } });
    } },
      h('div', { class: 'field' },
        h('label', { class: 'label', for: 'export-key' }, 'Recovery key'),
        keyField,
        h('p', { class: 'hint', id: 'export-key-hint' }, 'The recovery key of the account that made this file. It stays in this browser. Capital letters and dashes do not matter.'),
      ),
      h('div', null, submit),
    );

    // A recovery key has no line breaks: Enter in the field opens the file.
    keyField.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });

    replace(root,
      header('The file is encrypted. The recovery key opens it.'),
      h('div', { class: 'sheet sheet-pad stack' },
        h('dl', { class: 'kv kv-left', dataset: { export: 'header' } },
          h('dt', null, 'File'), h('dd', { class: 'mono break' }, file.name || 'export'),
          h('dt', null, 'Made with'), h('dd', null, head.appName || 'Unknown'),
          h('dt', null, 'Made on'), h('dd', null, dayText(head.createdDay)),
          h('dt', null, 'Size'), h('dd', { class: 'mono' }, bytesText(file.size)),
        ),
        file.size < head.fileLength ? callout('warn', 'This file is not complete', h('p', null, `It has ${bytesText(file.size)} of ${bytesText(head.fileLength)}. Some parts may not open. Use a different copy of the file if you have one.`)) : null,
        withAccount ? h('div', { class: 'stack stack-2' }, h('div', null, withAccount), h('p', { class: 'hint' }, 'This works if the account that you are signed in to made the file.')) : null,
        withAccount ? h('div', { class: 'or-rule' }, h('span', null, 'or')) : null,
        form,
        error,
        h('div', null, button('Choose a different file', { kind: 'quiet', size: 'sm', onClick: () => showPick() })),
      ),
    );
    if (withAccount) withAccount.focus(); else keyField.focus();
  }

  // ---------- step 3: read the file ----------
  function showFile(file, opened) {
    root.className = 'page';
    const idx = opened.index;
    const inboxById = new Map(idx.inboxes.map((x) => [x.id, x]));
    const aliasById = new Map(idx.aliases.map((x) => [x.id, x]));
    const numberById = new Map(idx.numbers.map((x) => [x.id, x]));
    const identityById = new Map(idx.identities.map((x) => [x.id, x]));
    const inboxByAddressId = new Map(idx.inboxes.filter((x) => x.addressId).map((x) => [x.addressId, x]));
    const day = dayText(opened.header.createdDay);
    const numberName = (id) => { const n = numberById.get(id); return n ? (n.label || phoneText(n.number) || 'Number') : 'A number that is not in the file'; };
    const identityTag = (id) => { const g = id ? identityById.get(id) : null; return g ? tag(g.name) : null; };
    const readProblem = (err) => (err && err.message) || EXPORT_ERRORS.damaged;

    // ----- Overview -----
    function overview() {
      const counts = [
        ['Inboxes', idx.inboxes.length], ['Aliases', idx.aliases.length], ['Numbers', idx.numbers.length], ['Real phones', idx.phones.length],
        ['Identities', idx.identities.length], ['Messages', idx.mail.length], ['Texts', idx.texts.length], ['Calls', idx.calls.length], ['Blocked senders', idx.blocks.length],
      ];
      // The check reads every part of the file. A small file is checked at once.
      const checkText = h('p', { class: 'read', role: 'status', dataset: { export: 'check' } });
      const checkBtn = button('Check the whole file', { size: 'sm', onClick: () => check() });
      async function check() {
        checkBtn.hidden = true;
        checkText.textContent = 'Checking the file…';
        try {
          await opened.verify((done, all) => { checkText.textContent = `Checking the file: part ${done} of ${all}`; });
          checkText.textContent = 'Checked. Every part of the file is complete and unchanged.';
        } catch (err) {
          replace(checkText, h('span', { class: 'field-error' }, `${readProblem(err)} Some items may not open.`));
        }
      }
      if (file.size <= AUTO_CHECK_BYTES) check();
      else checkText.textContent = `This file is large (${bytesText(file.size)}), so it was not checked as a whole. Each item is checked when you open it.`;

      const members = (g) => [
        ...idx.aliases.filter((a) => a.identityId === g.id).map((a) => ({ icon: 'alias', value: a.address, label: a.label })),
        ...idx.numbers.filter((n) => n.identityId === g.id).map((n) => ({ icon: 'phone', value: phoneText(n.number), label: n.label })),
      ];
      return h('div', { class: 'stack stack-6' },
        h('section', { class: 'stack stack-3' },
          h('h2', { class: 'section-title' }, 'In this file'),
          h('dl', { class: 'sheet sheet-pad f-export-counts', dataset: { export: 'counts' } }, counts.map(([label, n]) => h('div', null, h('dt', { class: 'small muted' }, label), h('dd', { class: 'mono strong' }, String(n))))),
        ),
        idx.notIncluded.length ? h('section', { class: 'stack stack-3' },
          h('h2', { class: 'section-title' }, 'Not in this file'),
          h('div', { class: 'prose' }, h('ul', null, idx.notIncluded.map((line) => h('li', null, line)))),
        ) : null,
        h('section', { class: 'stack stack-3' },
          h('h2', { class: 'section-title' }, 'Identities'),
          idx.identities.length === 0 ? h('p', { class: 'muted' }, 'No identities in this file.') : h('div', { class: 'cards' }, idx.identities.map((g) => {
            const list = members(g);
            return h('div', { class: 'sheet sheet-pad stack stack-3', dataset: { export: 'identity' } },
              h('h3', { class: 'break' }, g.name),
              g.note ? h('p', { class: 'small muted break' }, g.note) : null,
              identifiers(g.persona),
              list.length ? h('ul', { class: 'stack stack-2' }, list.map((m) => h('li', { class: 'row row-2 row-top' },
                icon(m.icon, { size: 16 }),
                h('div', { class: 'grow' }, h('p', { class: 'mono small break' }, m.value), m.label ? h('p', { class: 'small muted break' }, m.label) : null),
              ))) : h('p', { class: 'small muted' }, 'No aliases or numbers in this identity.'),
            );
          })),
        ),
        h('section', { class: 'stack stack-3' },
          h('h2', { class: 'section-title' }, 'File check'),
          checkText,
          h('div', null, checkBtn),
        ),
      );
    }

    // ----- Mail -----
    function mailPanel() {
      const el = h('div', { class: 'stack', dataset: { export: 'mail' } });
      let q = '';
      let direction = 'all';
      let shown = ROWS;
      const sender = (m) => (m.direction === 'out' ? `To: ${m.to.map(personShort).filter(Boolean).join(', ') || 'nobody'}` : (personShort(m.from) || 'Unknown sender'));
      const hay = (m) => [m.from ? m.from.name : '', m.from ? m.from.address : '', m.subject, ...m.to.flatMap((p) => [p.name, p.address])].join(' ').toLowerCase();
      const viaOf = (m) => { const a = m.addressId ? aliasById.get(m.addressId) : null; return a ? (a.label || a.address) : ''; };

      const searchId = uid('export-search');
      const search = h('input', { class: 'input search-input', type: 'search', id: searchId, placeholder: 'Search by sender or subject', autocomplete: 'off', spellcheck: 'false' });
      const count = h('p', { class: 'small muted', role: 'status' });
      const listBox = h('div', { class: 'sheet f-export-list' });
      const tools = h('div', { class: 'row row-wrap' },
        h('div', { class: 'search-wrap' }, h('label', { class: 'sr-only', for: searchId }, 'Search mail by sender or subject'), icon('search', { size: 16, cls: 'search-icon' }), search),
        chips({ label: 'Show', value: direction, options: [{ value: 'all', label: 'All' }, { value: 'in', label: 'Received' }, { value: 'out', label: 'Sent' }], onChange: (v) => { direction = v; shown = ROWS; paintRows(); } }),
      );
      search.addEventListener('input', debounce(() => { q = search.value.trim().toLowerCase(); shown = ROWS; paintRows(); }, 120));

      function paintRows() {
        const found = idx.mail.filter((m) => (direction === 'all' || m.direction === direction) && (!q || hay(m).includes(q)));
        count.textContent = found.length === idx.mail.length ? plural(found.length, 'message') : `${found.length} of ${plural(idx.mail.length, 'message')}`;
        if (!found.length) {
          replace(listBox, emptyState({ compact: true, figure: false, title: idx.mail.length ? 'No message matches' : 'No mail in this file', text: idx.mail.length ? 'Try a different word.' : '' }));
          return;
        }
        replace(listBox,
          h('ul', { class: 'msg-list' }, found.slice(0, shown).map((m) => {
            const files = m.attachments.length;
            const via = viaOf(m);
            return h('li', null, h('button', { class: 'msg-row f-export-row', type: 'button', dataset: { mail: m.id }, onClick: () => openMessage(m) },
              h('span', { class: 'msg-dot' }),
              h('span', { class: 'msg-body' },
                h('span', { class: 'msg-top' }, h('span', { class: 'msg-from truncate' }, sender(m)), h('time', { class: 'msg-time', datetime: new Date(m.at * 1000).toISOString() }, shortTime(m.at))),
                h('span', { class: 'msg-subject truncate' }, m.subject || '(no subject)'),
                m.snippet ? h('span', { class: 'msg-snippet' }, m.snippet) : null,
                via || files ? h('span', { class: 'msg-meta' },
                  via ? h('span', { class: 'msg-alias' }, icon('alias', { size: 12 }), h('span', { class: 'truncate' }, via)) : null,
                  files ? h('span', { class: 'msg-attach' }, icon('attach', { size: 12 }), String(files), h('span', { class: 'sr-only' }, files === 1 ? ' attachment' : ' attachments')) : null,
                ) : null,
              ),
            ));
          })),
          found.length > shown ? h('div', { class: 'list-more' }, button('Show more', { size: 'sm', onClick: () => { shown += ROWS; paintRows(); } })) : null,
        );
      }
      function showList(focusId = '') {
        replace(el, tools, count, listBox);
        paintRows();
        const row = focusId ? [...listBox.querySelectorAll('.msg-row')].find((b) => b.dataset.mail === focusId) : null;
        if (row) row.focus();
      }

      function bodyView(m, body) {
        const wrap = h('div', { class: 'mail-body' });
        const text = body.text || (body.html ? htmlToText(body.html) : '');
        const plain = () => h('pre', { class: 'mail-text' }, text || h('span', { class: 'faint' }, 'This message has no text.'));
        if (!body.html) { wrap.append(plain()); return wrap; }
        let mode = 'html';
        const inline = new Map();
        const slot = h('div', { class: 'mail-body-slot' });
        const note = h('p', { class: 'mail-note', hidden: true }, icon('eyeOff', { size: 14 }), h('span', null, 'Remote images are blocked to stop tracking.'));
        const paint = () => {
          if (mode === 'text') { note.hidden = true; replace(slot, plain()); return null; }
          const clean = sanitizeEmail(body.html, inline);
          note.hidden = !clean.blockedRemote;
          // The frame has no scripts and no access to this page. Links open in a new tab.
          const frame = h('iframe', { class: 'mail-frame', sandbox: 'allow-popups allow-popups-to-escape-sandbox', referrerpolicy: 'no-referrer', title: 'Message text', srcdoc: clean.srcdoc });
          replace(slot, h('div', { class: 'mail-frame-wrap' }, frame));
          return clean;
        };
        const first = paint();
        wrap.append(
          h('div', { class: 'mail-body-bar' },
            segmented({ label: 'Show the message as', value: mode, options: [{ value: 'html', label: 'Formatted' }, { value: 'text', label: 'Plain text' }], onChange: (v) => { mode = v; paint(); } }),
            note,
          ),
          slot,
        );
        // Pictures inside the message ("cid:") come from the attachments in the file.
        const wanted = (first && first.wantedCids) || [];
        const jobs = [];
        for (const a of m.attachments) {
          const key = cidKey(a.cid);
          if (!key || !wanted.includes(key) || !a.blob || a.blob.n > INLINE_IMAGE_MAX) continue;
          jobs.push(opened.readBlob(a.blob).then((bytes) => { const url = inlineImageUrl(bytes, a.contentType); if (url) inline.set(key, url); }).catch(() => {}));
        }
        if (jobs.length) Promise.all(jobs).then(() => { if (wrap.isConnected && inline.size && mode === 'html') paint(); });
        return wrap;
      }

      function openMessage(m) {
        const back = button('Back to the list', { kind: 'quiet', size: 'sm', iconName: 'chevronLeft', onClick: () => showList(m.id) });
        const subject = h('h2', { class: 'message-subject', tabIndex: -1 }, m.subject || '(no subject)');
        const bodySlot = h('div', { class: 'mail-body' }, h('p', { class: 'muted', role: 'status' }, 'Opening the message…'));
        const inbox = inboxById.get(m.inboxId);
        const via = m.addressId ? aliasById.get(m.addressId) : null;
        const line = (label, value) => (value ? h('div', { class: 'head-line' }, h('dt', null, label), h('dd', { class: 'break' }, value)) : null);
        const files = m.attachments.length ? h('section', { class: 'message-atts' },
          h('h3', { class: 'message-atts-title' }, plural(m.attachments.length, 'attachment')),
          h('ul', { class: 'attach-list' }, m.attachments.map((a) => {
            const status = h('p', { class: 'small field-error', role: 'alert', hidden: true });
            return h('li', { class: 'attach-item', dataset: { export: 'attachment' } },
              icon('file', { size: 18 }),
              h('div', { class: 'grow' }, h('p', { class: 'truncate' }, a.filename), h('p', { class: 'small muted' }, bytesText(a.size)), status),
              a.blob
                ? button('Download', { size: 'sm', iconName: 'download', attrs: { 'aria-label': `Download ${a.filename}` }, onClick: (e, btn) => runBusy(btn, async () => {
                  status.hidden = true;
                  downloadBlob(await opened.readBlob(a.blob), a.filename, a.contentType);
                }, { onError: (err) => { status.textContent = readProblem(err); status.hidden = false; return true; } }) })
                : h('span', { class: 'small muted nowrap' }, 'Not in this file'),
            );
          })),
        ) : null;
        replace(el,
          h('div', null, back),
          h('article', { class: 'sheet' }, h('div', { class: 'message', dataset: { export: 'message' } },
            h('header', { class: 'message-head' },
              subject,
              h('div', { class: 'message-from' },
                h('span', { class: 'message-sender break' }, m.direction === 'out' ? 'You' : (personShort(m.from) || 'Unknown sender')),
                m.direction === 'in' && m.from && m.from.name && m.from.address ? h('span', { class: 'small muted mono break' }, m.from.address) : null,
                timeEl(m.at),
              ),
              h('dl', { class: 'message-lines' },
                line('To', m.to.map(personText).filter(Boolean).join(', ')),
                line('Cc', m.cc.map(personText).filter(Boolean).join(', ')),
                line(m.direction === 'out' ? 'From' : 'Via', via ? `${via.label ? `${via.label}, ` : ''}${via.address}` : (m.direction === 'in' && m.deliveredTo && !m.to.some((p) => p.address === m.deliveredTo) ? m.deliveredTo : '')),
                line('In', inbox ? (inbox.label || inbox.address) : ''),
              ),
            ),
            bodySlot,
            files,
          )),
        );
        subject.focus();
        opened.readJson(m.body).then((body) => {
          if (!bodySlot.isConnected) return;
          const safe = body && typeof body === 'object' ? { text: typeof body.text === 'string' ? body.text : '', html: typeof body.html === 'string' && body.html ? body.html : null } : { text: '', html: null };
          bodySlot.replaceWith(bodyView(m, safe));
        }).catch((err) => { if (bodySlot.isConnected) replace(bodySlot, h('p', { class: 'form-error', role: 'alert' }, readProblem(err))); });
      }

      showList();
      return el;
    }

    // ----- Texts -----
    function textsPanel() {
      const el = h('div', { class: 'stack stack-6', dataset: { export: 'texts' } });
      const groups = new Map(); // number id -> texts, newest first
      for (const t of [...idx.texts].sort(byNewest)) { if (!groups.has(t.numberId)) groups.set(t.numberId, []); groups.get(t.numberId).push({ ...t, seen: true }); }

      function showThreads(focusKey = '') {
        if (!groups.size) { replace(el, h('div', { class: 'sheet' }, emptyState({ compact: true, figure: false, title: 'No texts in this file' }))); return; }
        replace(el, [...groups].map(([numberId, texts]) => {
          const number = numberById.get(numberId);
          return h('section', { class: 'stack stack-3' },
            h('div', null, h('h2', { class: 'section-title' }, numberName(numberId)), number ? h('p', { class: 'mono small muted' }, phoneText(number.number)) : null),
            h('div', { class: 'sheet f-export-list' }, h('ul', { class: 'threads' }, threadsOf(texts).map((th) => h('li', null,
              h('button', { class: 'thread', type: 'button', dataset: { thread: `${numberId}:${th.peer}` }, onClick: () => showConversation(numberId, th) },
                h('span', { class: 'thread-top' }, h('span', { class: 'thread-peer mono truncate' }, phoneText(th.peer)), h('span', { class: 'thread-time' }, shortTime(th.last.at))),
                h('span', { class: 'thread-bottom' }, h('span', { class: 'thread-snippet truncate' }, `${th.last.direction === 'out' ? 'You: ' : ''}${th.last.body}`), h('span', { class: 'small muted nowrap' }, plural(th.texts.length, 'text'))),
              ),
            )))),
          );
        }));
        const btn = focusKey ? [...el.querySelectorAll('.thread')].find((b) => b.dataset.thread === focusKey) : null;
        if (btn) btn.focus();
      }

      function showConversation(numberId, th) {
        const number = numberById.get(numberId);
        const title = h('h2', { class: 'section-title', tabIndex: -1 }, 'Texts with ', h('span', { class: 'mono' }, phoneText(th.peer)));
        replace(el, h('div', { class: 'stack stack-3' },
          h('div', null, button('Back to the conversations', { kind: 'quiet', size: 'sm', iconName: 'chevronLeft', onClick: () => showThreads(`${numberId}:${th.peer}`) })),
          h('div', null, title, h('p', { class: 'small muted' }, 'On ', numberName(numberId), number ? [' (', h('span', { class: 'mono' }, phoneText(number.number)), ')'] : null)),
          h('div', { class: 'sheet' }, h('ol', { class: 'bubbles', dataset: { export: 'bubbles' } }, th.texts.map((t) => h('li', { class: `bubble-row is-${t.direction}` },
            h('div', { class: 'bubble' },
              h('p', { class: 'bubble-text' }, t.body),
              h('span', { class: 'bubble-meta' }, h('span', { class: 'sr-only' }, t.direction === 'out' ? 'You, ' : 'They, '), fullTime(t.at), t.direction === 'out' && t.status === 'failed' ? h('span', { class: 'bubble-status is-failed' }, 'Not sent') : null),
            ),
          )))),
        ));
        title.focus();
      }

      showThreads();
      return el;
    }

    // ----- Calls -----
    const CALL_KIND = { in: { answered: ['callIn', 'Incoming call'], missed: ['callMissed', 'Missed call'], failed: ['callMissed', 'Failed call'] }, out: { answered: ['callOut', 'Outgoing call'], missed: ['callOut', 'No answer'], failed: ['callMissed', 'Failed call'] } };
    function callsPanel() {
      const groups = new Map();
      for (const c of [...idx.calls].sort(byNewest)) { if (!groups.has(c.numberId)) groups.set(c.numberId, []); groups.get(c.numberId).push(c); }
      if (!groups.size) return h('div', { class: 'sheet', dataset: { export: 'calls' } }, emptyState({ compact: true, figure: false, title: 'No calls in this file' }));
      return h('div', { class: 'stack stack-6', dataset: { export: 'calls' } }, [...groups].map(([numberId, calls]) => {
        const number = numberById.get(numberId);
        return h('section', { class: 'stack stack-3' },
          h('div', null, h('h2', { class: 'section-title' }, numberName(numberId)), number ? h('p', { class: 'mono small muted' }, phoneText(number.number)) : null),
          h('div', { class: 'sheet' }, h('ul', { class: 'call-list' }, calls.map((c) => {
            const [ic, label] = (CALL_KIND[c.direction] || CALL_KIND.in)[c.status] || ['phone', 'Call'];
            const vm = c.voicemail;
            return h('li', { class: `call-row is-${c.status}` },
              h('span', { class: 'call-icon' }, icon(ic, { size: 18 })),
              h('div', { class: 'grow' },
                h('p', { class: 'mono call-peer truncate' }, phoneText(c.peer) || 'Unknown number'),
                h('p', { class: 'small muted' }, label, c.status === 'answered' ? `, ${duration(c.seconds)}` : ''),
                vm ? h('div', { class: 'addons' }, voicemailLine({
                  key: `file:${c.id}`, seconds: vm.seconds, at: c.at, missing: 'The sound is not in this file.',
                  load: vm.blob ? async () => ({ bytes: await opened.readBlob(vm.blob), contentType: vm.contentType }) : null,
                })) : null,
              ),
              timeEl(c.at, 'small muted nowrap f-export-when'),
            );
          }))),
        );
      }));
    }

    // ----- Aliases and numbers -----
    function itemsPanel() {
      const row = (ic, value, parts) => h('li', { class: 'phone-row' },
        h('span', { class: 'item-icon' }, icon(ic, { size: 18 })),
        h('div', { class: 'item-main' }, h('span', { class: 'item-value mono break f-export-value' }, value), parts),
        h('span', null),
      );
      const sub = (...nodes) => { const list = nodes.flat().filter(Boolean); return list.length ? h('div', { class: 'item-sub' }, list) : null; };
      const labelOf = (x) => (x.label ? h('span', { class: 'item-label' }, x.label) : h('span', { class: 'item-label is-empty' }, 'No label'));
      const noteOf = (x) => (x.note ? h('p', { class: 'small muted break' }, x.note) : null);
      const block = (title, list, empty, make) => h('section', { class: 'stack stack-3' },
        h('h2', { class: 'section-title' }, title),
        list.length ? h('div', { class: 'sheet item-sheet' }, h('ul', { class: 'item-list f-export-items' }, list.map(make))) : h('p', { class: 'muted' }, empty),
      );
      return h('div', { class: 'stack stack-6', dataset: { export: 'items' } },
        block('Inboxes', idx.inboxes, 'No inboxes in this file.', (m) => row('inbox', m.address, [
          sub(labelOf(m), m.status === 'suspended' ? tag('Paused', 'warn') : null),
          noteOf(m),
        ])),
        block('Aliases', idx.aliases, 'No aliases in this file.', (a) => {
          const box = inboxById.get(a.inboxId);
          return row('alias', a.address, [
            sub(labelOf(a), a.enabled ? null : tag('Off'), identityTag(a.identityId)),
            h('p', { class: 'small muted break' }, 'Delivers to ', box ? (box.label || box.address) : 'an inbox that is not in the file', a.expiresAt ? `. Ends on ${fullTime(a.expiresAt)}` : ''),
            noteOf(a),
            identifiers(a.persona),
          ]);
        }),
        block('Numbers', idx.numbers, 'No numbers in this file.', (n) => row('phone', phoneText(n.number), [
          sub(labelOf(n), n.status === 'suspended' ? tag('Paused', 'warn') : null, identityTag(n.identityId)),
          noteOf(n),
          identifiers(n.persona),
        ])),
        idx.phones.length ? block('Real phones', idx.phones, '', (p) => row('phone', phoneText(p.number), [sub(labelOf(p))])) : null,
      );
    }

    // ----- Blocked senders -----
    function blocksPanel() {
      if (!idx.blocks.length) return h('div', { class: 'sheet', dataset: { export: 'blocks' } }, emptyState({ compact: true, figure: false, title: 'No blocked senders in this file' }));
      const groups = new Map();
      for (const b of idx.blocks) { if (!groups.has(b.addressId)) groups.set(b.addressId, []); groups.get(b.addressId).push(b); }
      const addressOf = (id) => { const a = aliasById.get(id); if (a) return a.address; const m = inboxByAddressId.get(id); return m ? m.address : ''; };
      return h('div', { class: 'stack stack-6', dataset: { export: 'blocks' } }, [...groups].map(([addressId, list]) => h('section', { class: 'stack stack-3' },
        h('div', null, h('h2', { class: 'section-title' }, 'Blocked on'), h('p', { class: 'mono small break' }, addressOf(addressId) || 'An address that is not in the file')),
        h('div', { class: 'sheet item-sheet' }, h('ul', { class: 'item-list f-export-items' }, list.map((b) => h('li', { class: 'phone-row' },
          h('span', { class: 'item-icon' }, icon(b.kind === 'domain' ? 'globe' : 'mail', { size: 18 })),
          h('div', { class: 'item-main' }, h('span', { class: 'item-value mono break f-export-value' }, b.value), h('div', { class: 'item-sub' }, h('span', { class: 'item-label' }, b.kind === 'domain' ? 'Every address of this domain' : 'One address'))),
          h('span', null),
        )))),
      )));
    }

    // Each part is made one time, so that a search or an open message stays when the person changes the tab.
    const made = new Map();
    const once = (id, make) => () => { if (!made.has(id)) made.set(id, make()); return made.get(id); };
    const parts = tabs({ label: 'Parts of the file', value: 'overview', onChange: () => closePlayer(), items: [
      { id: 'overview', label: 'Overview', render: once('overview', overview) },
      { id: 'mail', label: 'Mail', render: once('mail', mailPanel) },
      { id: 'texts', label: 'Texts', render: once('texts', textsPanel) },
      { id: 'calls', label: 'Calls', render: once('calls', callsPanel) },
      { id: 'items', label: 'Aliases and numbers', render: once('items', itemsPanel) },
      { id: 'blocks', label: 'Blocked senders', render: once('blocks', blocksPanel) },
    ] });

    replace(root,
      pageHeader({
        title: 'Export file', lede: file.name || '',
        actions: button('Close the file', { onClick: () => showPick() }),
      }),
      h('div', { class: 'stack stack-5' },
        h('div', { dataset: { export: 'banner' } }, callout('info', `Read-only copy from ${day}`,
          h('p', null, `This page shows what was in the account on that day. It changes nothing in an account, and it sends nothing to the server. Close this page and the open contents are gone from the browser.`),
        )),
        parts,
      ),
    );
    const h1 = root.querySelector('.page-title');
    if (h1) h1.focus();
  }

  showPick();
  return root;
}
