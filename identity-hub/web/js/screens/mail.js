// Mail: inbox list, message list, message view.
import { h, replace, append } from '../lib/dom.js';
import { store, bus } from '../lib/store.js';
import { navigate } from '../lib/router.js';
import { shortTime, fullTime, bytesText, plural } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { button, emptyState, skeletonRows, segmented, copyButton, tag, runBusy, reportError, loadError, linkButton } from '../ui/components.js';
import { menuButton } from '../ui/menu.js';
import { confirmDialog } from '../ui/dialog.js';
import { toast, copyText } from '../ui/toast.js';
import { listMessages, getMessage, getAttachment, setSeen, deleteMessage, personShort, personText, downloadBlob, takeMailFilter } from '../lib/mail.js';
import { sanitizeEmail, inlineImageUrl, cidKey, htmlToText, INLINE_IMAGE_MAX } from '../lib/sanitize.js';
import { loadMailboxes, updateAlias, findMailbox } from '../lib/data.js';
import { openNewInbox } from '../ui/items.js';
import { openCompose } from './compose.js';
import { openTestTools } from './testtools.js';
import { registered } from '../lib/registry.js';

// Plain text with links for http(s) addresses. Everything is added as text nodes.
function textWithLinks(text) {
  const out = document.createDocumentFragment();
  const re = /https?:\/\/[^\s<>"')\]]+/g;
  let last = 0;
  let m;
  const value = String(text || '');
  while ((m = re.exec(value))) {
    if (m.index > last) out.appendChild(document.createTextNode(value.slice(last, m.index)));
    const raw = m[0].replace(/[.,;:!?]+$/, '');
    re.lastIndex = m.index + raw.length;
    let href = '';
    try { href = new URL(raw).href; } catch { href = ''; }
    if (href) out.appendChild(h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, raw));
    else out.appendChild(document.createTextNode(raw));
    last = re.lastIndex;
  }
  if (last < value.length) out.appendChild(document.createTextNode(value.slice(last)));
  return out;
}

export function mailScreen({ params, scope }) {
  let mailboxId = null;
  let messageId = null;
  let direction = 'in';
  let addressFilter = ''; // '' = all mail of the inbox, or one address id (the inbox address or an alias)
  let list = null;        // null = loading
  let more = false;
  let listError = '';
  let listToken = 0;
  let msgToken = 0;
  let loadingMore = false;
  let currentMsg = null;  // the open message, decrypted
  let aliasMark = '';     // state of the alias of the open message, to see changes

  const boxesPane = h('aside', { class: 'mail-boxes', 'aria-label': 'Inboxes' });
  const listHead = h('div', { class: 'mail-list-head' });
  const listBody = h('div', { class: 'mail-list-body' });
  const listPane = h('section', { class: 'mail-list', 'aria-label': 'Messages' }, listHead, listBody);
  const viewPane = h('section', { class: 'mail-view', 'aria-label': 'Message' });
  const el = h('div', { class: 'mail', dataset: { view: 'list' } }, h('h1', { class: 'sr-only' }, 'Mail'), boxesPane, listPane, viewPane);

  const boxes = () => store.get('mailboxes');
  const currentBox = () => findMailbox(mailboxId);

  // ---- inbox list (left) ----
  function paintBoxes() {
    const all = boxes();
    if (all === null) { replace(boxesPane, skeletonRows(3)); return; }
    replace(boxesPane,
      h('div', { class: 'mail-boxes-head' },
        h('h2', { class: 'mail-title' }, 'Inboxes'),
        button('Write', { kind: 'primary', iconName: 'edit', size: 'sm', onClick: () => openCompose({ mailboxId }) }),
      ),
      h('ul', { class: 'box-list' }, all.map((m) => h('li', null,
        h('a', { class: 'box-item', href: `/mail/${m.id}`, 'data-link': true, 'aria-current': m.id === mailboxId ? 'page' : null },
          h('span', { class: 'box-main' },
            h('span', { class: 'box-name truncate' }, m.label || 'Inbox'),
            h('span', { class: 'box-address mono truncate' }, m.address),
          ),
          m.status !== 'active' ? tag('Paused', 'warn') : null,
          m.unread ? h('span', { class: 'badge', 'aria-label': `${m.unread} unread` }, m.unread > 99 ? '99+' : String(m.unread)) : null,
        ),
      ))),
      button('New inbox', { kind: 'quiet', size: 'sm', iconName: 'plus', onClick: () => openNewInbox() }),
    );
  }

  // ---- message list (middle) ----
  function paintListHead() {
    const all = boxes() || [];
    const box = currentBox();
    if (!box) { replace(listHead); return; }
    const select = h('select', { class: 'input select', 'aria-label': 'Inbox', onChange: (e) => navigate(`/mail/${e.target.value}`) },
      all.map((m) => h('option', { value: m.id, selected: m.id === mailboxId }, `${m.label || 'Inbox'}${m.unread ? ` (${m.unread})` : ''}`)));
    replace(listHead,
      h('div', { class: 'mail-list-top' },
        h('div', { class: 'select-wrap mail-box-select' }, select, icon('chevronDown', { size: 16, cls: 'select-caret' })),
        button('Write', { kind: 'primary', iconName: 'edit', size: 'sm', onClick: () => openCompose({ mailboxId }), attrs: { class: 'btn btn-primary btn-sm mail-write' } }),
      ),
      h('div', { class: 'mail-box-line' },
        h('span', { class: 'mono truncate mail-box-address', title: box.address }, box.address),
        copyButton(() => box.address, 'Copy address', { what: 'Address copied', cls: 'icon-btn-sm' }),
      ),
      box.status !== 'active' ? h('p', { class: 'mail-paused small' }, icon('warning', { size: 14 }), h('span', null, 'This inbox is paused. It receives no mail. '), h('a', { href: '/funds', 'data-link': true }, 'Add funds')) : null,
      h('div', { class: 'mail-filters' },
        segmented({ label: 'Folder', value: direction, options: [{ value: 'in', label: 'Inbox' }, { value: 'out', label: 'Sent' }], onChange: (v) => {
          direction = v; list = null; paintList(); loadList();
          // An open message of the other folder is closed.
          if (messageId && (!currentMsg || currentMsg.direction !== v)) navigate(`/mail/${mailboxId}`);
        } }),
        addressSelect(box),
      ),
    );
  }

  // "Show only mail of one address": the inbox address itself, or one of its aliases.
  function addressSelect(box) {
    const aliases = (store.get('aliases') || []).filter((a) => a.mailboxId === box.id);
    if (addressFilter && addressFilter !== box.addressId && !aliases.some((a) => a.id === addressFilter)) addressFilter = '';
    if (aliases.length === 0) return null;
    const option = (value, label) => h('option', { value, selected: value === addressFilter }, label);
    return h('div', { class: 'select-wrap mail-address-filter' },
      h('select', { class: 'input select', 'aria-label': 'Show mail of', onChange: (e) => { addressFilter = e.target.value; list = null; paintList(); loadList(); } },
        option('', 'All addresses'),
        option(box.addressId, 'Inbox address only'),
        aliases.map((a) => option(a.id, a.label ? `${a.label} (${a.address})` : a.address)),
      ),
      icon('chevronDown', { size: 16, cls: 'select-caret' }),
    );
  }

  function messageRow(m) {
    const meta = m.meta;
    const who = m.direction === 'out' ? `To: ${(meta.to || []).map(personShort).filter(Boolean).join(', ') || 'nobody'}` : (personShort(meta.from) || 'Unknown sender');
    const box = currentBox();
    const viaAlias = m.direction === 'in' && meta.deliveredTo && box && meta.deliveredTo !== box.address;
    const unread = m.direction === 'in' && !m.seen;
    return h('li', null,
      h('a', { class: `msg-row ${unread ? 'is-unread' : ''}`.trim(), href: `/mail/${m.mailboxId}/${m.id}`, 'data-link': true, 'aria-current': m.id === messageId ? 'true' : null },
        h('span', { class: 'msg-dot', 'aria-hidden': 'true' }),
        h('span', { class: 'msg-body' },
          h('span', { class: 'msg-top' },
            h('span', { class: 'msg-from truncate' }, who, unread ? h('span', { class: 'sr-only' }, ' (unread)') : null),
            h('time', { class: 'msg-time', datetime: new Date(m.at * 1000).toISOString() }, shortTime(m.at)),
          ),
          h('span', { class: 'msg-subject truncate' }, m.broken ? 'This message cannot be opened' : (meta.subject || '(no subject)')),
          h('span', { class: 'msg-snippet' }, meta.snippet || ''),
          (viaAlias || m.attachments > 0) ? h('span', { class: 'msg-meta' },
            viaAlias ? h('span', { class: 'msg-alias mono truncate' }, icon('alias', { size: 12, label: 'Came to alias' }), h('span', { class: 'truncate' }, meta.deliveredTo)) : null,
            m.attachments > 0 ? h('span', { class: 'msg-attach' }, icon('attach', { size: 13, label: plural(m.attachments, 'attachment') }), String(m.attachments)) : null,
          ) : null,
        ),
      ),
    );
  }

  function paintList() {
    const box = currentBox();
    if (!box) { replace(listBody); return; }
    if (list === null) { replace(listBody, skeletonRows(6, { tall: true })); return; }
    if (listError && !list.length) { replace(listBody, loadError(listError, () => { list = null; paintList(); loadList(); })); return; }
    if (!list.length && addressFilter) {
      replace(listBody, emptyState({ title: 'No mail for this address', compact: true, figure: false, text: direction === 'in' ? 'Nothing came to this address yet.' : 'Nothing was sent from this address yet.',
        action: button('Show all addresses', { onClick: () => { addressFilter = ''; list = null; paintListHead(); paintList(); loadList(); } }) }));
      return;
    }
    if (!list.length) {
      const dev = store.get('config').dev;
      replace(listBody, direction === 'in'
        ? emptyState({
          title: 'No mail yet', compact: true,
          text: 'Mail to this address and to its aliases shows here.',
          action: dev ? button('Send a test message', { onClick: () => openTestTools('mail') }) : copyButton(() => box.address, 'Copy address', { what: 'Address copied', withLabel: true }),
        })
        : emptyState({ title: 'Nothing sent yet', compact: true, text: 'Messages you send from this inbox show here.', action: button('Write a message', { onClick: () => openCompose({ mailboxId }) }) }));
      return;
    }
    replace(listBody,
      h('ul', { class: 'msg-list' }, list.map(messageRow)),
      more ? h('div', { class: 'mail-more' }, button('Show older messages', { size: 'sm', onClick: (e, btn) => runBusy(btn, loadMore) })) : null,
    );
  }

  async function loadList() {
    if (!mailboxId) return;
    const token = ++listToken;
    try {
      const res = await listMessages({ mailboxId, direction, addressIds: addressFilter ? [addressFilter] : undefined, limit: Math.max(50, Math.min(100, list ? list.length : 0)) });
      if (scope.disposed || token !== listToken) return;
      list = res.messages;
      more = res.more;
      listError = '';
    } catch (err) {
      if (scope.disposed || token !== listToken) return;
      if (err.status === 404) { navigate('/mail', { replace: true }); return; }
      listError = err.message;
      if (list === null) list = [];
    }
    paintList();
  }

  async function loadMore() {
    if (loadingMore || !list || !list.length) return;
    loadingMore = true;
    const token = listToken;
    try {
      const last = list[list.length - 1];
      const res = await listMessages({ mailboxId, direction, addressIds: addressFilter ? [addressFilter] : undefined, before: last.at, beforeId: last.id, limit: 50 });
      if (scope.disposed || token !== listToken) return;
      const have = new Set(list.map((m) => m.id));
      list = [...list, ...res.messages.filter((m) => !have.has(m.id))];
      more = res.more;
      paintList();
    } finally { loadingMore = false; }
  }

  // ---- message view (right) ----
  function paintViewEmpty() {
    const box = currentBox();
    replace(viewPane, box ? h('div', { class: 'mail-view-empty' }, emptyState({ title: 'No message open', text: 'Choose a message from the list to read it.' })) : null);
  }

  function addressLine(label, people) {
    if (!people || !people.length) return null;
    return h('div', { class: 'head-line' }, h('dt', null, label), h('dd', { class: 'break' }, people.map(personText).filter(Boolean).join(', ')));
  }

  function renderBody(msg) {
    const body = msg.body;
    const wrap = h('div', { class: 'mail-body' });
    const text = body.text || (body.html ? htmlToText(body.html) : '');
    const plain = () => h('pre', { class: 'mail-text' }, text ? textWithLinks(text) : h('span', { class: 'faint' }, 'This message has no text.'));
    if (!body.html) { append(wrap, plain()); return wrap; }

    let mode = 'html';
    const inline = new Map();
    const slot = h('div', { class: 'mail-body-slot' });
    const note = h('p', { class: 'mail-note', hidden: true }, icon('eyeOff', { size: 14 }), h('span', null, 'Remote images are blocked to stop tracking.'));
    const paint = () => {
      if (mode === 'text') { note.hidden = true; replace(slot, plain()); return; }
      const clean = sanitizeEmail(body.html, inline);
      note.hidden = !clean.blockedRemote;
      // The frame has no scripts and no access to this page. Links open in a new tab.
      const frame = h('iframe', { class: 'mail-frame', sandbox: 'allow-popups allow-popups-to-escape-sandbox', referrerpolicy: 'no-referrer', title: 'Message text', srcdoc: clean.srcdoc });
      replace(slot, h('div', { class: 'mail-frame-wrap' }, frame));
      return clean;
    };
    const first = paint();
    append(wrap,
      h('div', { class: 'mail-body-bar' },
        segmented({ label: 'Show the message as', value: mode, options: [{ value: 'html', label: 'Formatted' }, { value: 'text', label: 'Plain text' }], onChange: (v) => { mode = v; paint(); } }),
        note,
      ),
      slot,
    );

    // Images inside the message ("cid:") come from decrypted attachments.
    const atts = msg.meta.attachments || [];
    const wanted = (first && first.wantedCids) || [];
    const jobs = [];
    atts.forEach((a, i) => {
      const key = cidKey(a.cid);
      if (!key || !wanted.includes(key) || (a.size || 0) > INLINE_IMAGE_MAX) return;
      jobs.push(getAttachment(msg, i + 1).then((bytes) => { const url = inlineImageUrl(bytes, a.contentType); if (url) inline.set(key, url); }).catch(() => {}));
    });
    if (jobs.length) Promise.all(jobs).then(() => { if (!scope.disposed && wrap.isConnected && inline.size && mode === 'html') paint(); });
    return wrap;
  }

  function aliasOf(msg) {
    const aliases = store.get('aliases') || [];
    return aliases.find((a) => a.id === msg.addressId) || aliases.find((a) => a.address === msg.meta.deliveredTo) || null;
  }
  const markOf = (msg) => { const a = msg ? aliasOf(msg) : null; return a ? `${a.id}:${a.enabled}:${a.label}` : ''; };

  function renderMessage(msg) {
    const meta = msg.meta;
    const alias = aliasOf(msg);
    const incoming = msg.direction === 'in';

    const turnOff = alias && alias.enabled && incoming ? button('Turn off this alias', { size: 'sm', onClick: (e, btn) => runBusy(btn, async () => {
      await updateAlias(alias.id, { enabled: false });
      toast('Alias turned off. Mail to it is refused.', { kind: 'ok', action: { label: 'Undo', onClick: () => updateAlias(alias.id, { enabled: true }).catch(reportError) } });
    }) }) : null;

    const menu = menuButton({ label: 'More actions', items: () => [
      incoming ? { label: 'Mark as unread', icon: 'mail', onSelect: async () => {
        try {
          await setSeen(msg.id, false);
          if (list) { const it = list.find((m) => m.id === msg.id); if (it) it.seen = false; }
          navigate(`/mail/${mailboxId}`);
          loadMailboxes().catch(() => {});
        } catch (err) { reportError(err); }
      } } : null,
      { label: 'Copy sender address', icon: 'copy', onSelect: () => copyText(meta.from.address || '', 'Address copied') },
      // Entries of feature files (registerMessageAction).
      ...registered.messageActions(msg, alias).map((a) => ({ label: a.label, icon: a.icon, danger: a.danger, onSelect: () => a.run(msg, alias) })),
    ] });
    // Panels of feature files (registerMessagePanel), between the head and the text.
    const panels = msg.broken ? [] : registered.messagePanels(msg, alias);

    const atts = meta.attachments || [];
    return h('article', { class: 'message' },
      h('div', { class: 'message-bar' },
        h('a', { class: 'btn btn-sm message-back', href: `/mail/${mailboxId}`, 'data-link': true }, icon('chevronLeft', { size: 16 }), h('span', null, direction === 'out' ? 'Sent' : 'Inbox')),
        h('div', { class: 'message-actions' },
          button('Reply', { iconName: 'reply', size: 'sm', onClick: () => openCompose({ mailboxId, reply: msg }) }),
          button('Delete', { iconName: 'trash', size: 'sm', kind: 'danger', onClick: async () => {
            const ok = await confirmDialog({ title: 'Delete this message?', message: 'The message is removed from the server. You cannot undo this.', confirmLabel: 'Delete' });
            if (!ok) return;
            try {
              await deleteMessage(msg.id);
              if (list) list = list.filter((m) => m.id !== msg.id);
              toast('Message deleted', { kind: 'ok' });
              navigate(`/mail/${mailboxId}`);
              paintList();
              loadMailboxes().catch(() => {});
            } catch (err) { reportError(err); }
          } }),
          menu,
        ),
      ),
      h('header', { class: 'message-head' },
        h('h2', { class: 'message-subject', tabIndex: -1 }, meta.subject || '(no subject)'),
        h('div', { class: 'message-from' },
          h('div', { class: 'grow' },
            h('p', { class: 'message-sender' }, meta.from.name || meta.from.address || 'Unknown sender'),
            meta.from.name && meta.from.address ? h('p', { class: 'mono small muted break' }, meta.from.address) : null,
          ),
          h('time', { class: 'small muted nowrap', datetime: new Date(msg.at * 1000).toISOString() }, fullTime(msg.at)),
        ),
        h('dl', { class: 'message-lines' },
          addressLine('To', meta.to),
          addressLine('Cc', meta.cc),
          addressLine('Bcc', meta.bcc),
        ),
        incoming && meta.deliveredTo ? h('div', { class: 'message-via' },
          icon(alias ? 'alias' : 'inbox', { size: 16 }),
          h('span', { class: 'message-via-text' }, 'Sent to ', h('span', { class: 'mono break' }, meta.deliveredTo)),
          alias ? (alias.enabled ? tag('Alias') : tag('Alias, off')) : null,
          alias && alias.label ? h('span', { class: 'small muted' }, alias.label) : null,
          turnOff,
        ) : null,
      ),
      panels.length ? h('div', { class: 'message-panels' }, panels) : null,
      msg.broken ? h('p', { class: 'form-error' }, 'This message cannot be opened with your key.') : renderBody(msg),
      atts.length ? h('section', { class: 'message-atts', 'aria-label': 'Attachments' },
        h('h3', { class: 'message-atts-title' }, plural(atts.length, 'attachment')),
        h('ul', { class: 'attach-list' }, atts.map((a, i) => h('li', { class: 'attach-item' },
          icon('file', { size: 16 }),
          h('span', { class: 'truncate grow', title: a.filename || '' }, a.filename || `attachment ${i + 1}`),
          h('span', { class: 'small faint mono nowrap' }, bytesText(a.size)),
          button('Download', { size: 'sm', iconName: 'download', onClick: (e, btn) => runBusy(btn, async () => {
            const bytes = await getAttachment(msg, i + 1);
            downloadBlob(bytes, a.filename || `attachment-${i + 1}`, a.contentType);
          }) }),
        ))),
        h('p', { class: 'hint' }, 'Attachments are decrypted in this browser. Open files only from people you trust.'),
      ) : null,
    );
  }

  async function loadMessage(quiet = false) {
    const id = messageId;
    if (!id) { currentMsg = null; msgToken++; paintViewEmpty(); return; }
    const token = ++msgToken;
    if (!quiet) replace(viewPane, h('div', { class: 'message' }, skeletonRows(4)));
    try {
      const msg = await getMessage(id);
      if (scope.disposed || token !== msgToken) return;
      currentMsg = msg;
      aliasMark = markOf(msg);
      replace(viewPane, renderMessage(msg));
      if (!quiet) viewPane.querySelector('.message-subject')?.focus({ preventScroll: true });
      if (msg.direction === 'in' && !msg.seen) {
        setSeen(id, true).then(() => loadMailboxes()).catch(() => {});
        if (list) { const it = list.find((m) => m.id === id); if (it) { it.seen = true; paintList(); } }
      }
      if (msg.direction !== direction && !quiet) { direction = msg.direction; list = null; paintListHead(); paintList(); loadList(); }
    } catch (err) {
      if (scope.disposed || token !== msgToken) return;
      replace(viewPane, h('div', { class: 'mail-view-empty' }, err.status === 404
        ? emptyState({ title: 'This message does not exist', text: 'It may be deleted.', action: linkButton('Back to the inbox', `/mail/${mailboxId}`) })
        : loadError(err.message, () => loadMessage())));
    }
  }

  // ---- routing inside the screen ----
  function sync(p) {
    const all = boxes();
    paintBoxes();
    if (all === null) { replace(listHead); replace(listBody, skeletonRows(6, { tall: true })); replace(viewPane); return; }
    if (all.length === 0) {
      mailboxId = null; messageId = null;
      el.dataset.view = 'none';
      replace(listHead); replace(listBody); replace(boxesPane);
      replace(viewPane, h('div', { class: 'mail-view-empty' }, emptyState({
        title: 'No inbox yet',
        text: 'An inbox has its own address. You read and send mail here.',
        action: button('Make inbox', { kind: 'primary', iconName: 'plus', onClick: () => openNewInbox() }),
      })));
      return;
    }
    if (!p.mailboxId) { navigate(`/mail/${all[0].id}`, { replace: true }); return; }
    if (!all.some((m) => m.id === p.mailboxId)) { navigate(`/mail/${all[0].id}`, { replace: true }); return; }

    const boxChanged = p.mailboxId !== mailboxId;
    const msgChanged = (p.messageId || null) !== messageId;
    mailboxId = p.mailboxId;
    messageId = p.messageId || null;
    el.dataset.view = messageId ? 'message' : 'list';
    paintBoxes();
    paintListHead();
    if (boxChanged) { direction = 'in'; addressFilter = takeMailFilter(mailboxId); list = null; paintListHead(); paintList(); loadList(); }
    else paintList();
    if (boxChanged || msgChanged) loadMessage();
  }

  let lastParams = params;
  scope.add(store.subscribe(['mailboxes'], () => sync(lastParams)));
  // An alias was turned on or off: show the new state in the open message.
  scope.add(store.subscribe(['aliases'], () => {
    if (mailboxId) paintListHead();
    if (!currentMsg || currentMsg.id !== messageId) return;
    const mark = markOf(currentMsg);
    if (mark === aliasMark) return;
    aliasMark = mark;
    replace(viewPane, renderMessage(currentMsg));
  }));
  scope.add(bus.on('mail', () => { if (mailboxId) loadList(); }));
  sync(params);

  return { el, update(p) { lastParams = p; sync(p); } };
}
