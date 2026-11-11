// One number: Texts (conversations), Calls (log, click-to-call), Settings (label, forwarding, release).
import { h, replace, uid } from '../lib/dom.js';
import { store, bus, appName } from '../lib/store.js';
import { navigate } from '../lib/router.js';
import { money, phoneText, cleanPhone, shortTime, clock, dayLabel, duration, textParts, dayText } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { button, iconButton, emptyState, skeletonRows, pageHeader, field, selectField, tag, copyButton, toggle, tabs, runBusy, reportError, loadError, callout, needFunds } from '../ui/components.js';
import { menuButton } from '../ui/menu.js';
import { formDialog, confirmDialog } from '../ui/dialog.js';
import { toast, copyText } from '../ui/toast.js';
import { findNumber, findPhone, updateNumber, loadNumbers, phoneName, renewDays, graceDays, setItemPersona, setItemExtra, gatewayWords, ownPhone } from '../lib/data.js';
import { OFFLINE_SECONDS } from '../lib/warnings.js';
import { listTexts, sendText, markTextsSeen, deleteText, listCalls, startCall, deleteCall, threadsOf, takeNumberOpen } from '../lib/phone.js';
import { personaCard } from '../ui/persona.js';
import { openPutInIdentity, takeOutOfIdentity } from '../ui/identity.js';
import { findIdentity } from '../lib/identities.js';
import { confirmDeleteItem } from '../ui/items.js';
import { openLinkPhone } from './numbers.js';
import { openTestTools } from './testtools.js';
import { registered, renderSafe, mergeByOrder } from '../lib/registry.js';
import { why, whyParts, whyGroup } from '../ui/why.js';

const MAX_TEXT = 1600;
const TEXT_STATUS = { queued: 'Sending', sent: 'Sent', delivered: 'Delivered', failed: 'Not delivered' };

export function numberScreen({ params, scope }) {
  const id = params.id;
  const config = store.get('config');
  const prices = config.prices;
  const root = h('div', { class: 'page' });
  let built = false;
  let headRegion = null;
  let tabsEl = null;

  // ---------- texts ----------
  let texts = null;         // null = loading
  let textsMore = false;    // the server has older texts
  let textsError = '';
  let openPeer = null;      // the other party of the open conversation (memory only, never in the URL)
  const unreadIds = new Set(); // texts that were unread when this screen loaded them
  let textsToken = 0;
  const textsPane = h('div', { class: 'texts', dataset: { view: 'threads' } });
  let draft = '';

  async function loadTexts() {
    const token = ++textsToken;
    try {
      // Keep as many texts loaded as before (older pages stay on screen after a refresh).
      const res = await listTexts(id, { limit: 200 });
      if (scope.disposed || token !== textsToken) return;
      const fresh = new Set(res.texts.map((t) => t.id));
      const oldest = res.texts.length ? res.texts[res.texts.length - 1].at : 0;
      const older = (texts || []).filter((t) => !fresh.has(t.id) && t.at < oldest);
      texts = [...res.texts, ...older];
      textsMore = older.length ? textsMore : res.more;
      textsError = '';
      // The server marks all texts of the number as seen at one time. Keep the marks for this visit.
      const unseen = texts.filter((t) => t.direction === 'in' && !t.seen);
      for (const t of unseen) if (t.peer !== openPeer) unreadIds.add(t.id);
      if (unseen.length && isTextsVisible()) markTextsSeen(id).then(() => loadNumbers()).catch(() => {});
    } catch (err) {
      if (scope.disposed || token !== textsToken) return;
      textsError = err.message;
      if (texts === null) texts = [];
    }
    paintTexts();
  }
  const isTextsVisible = () => !tabsEl || tabsEl.active === 'texts';

  async function loadOlderTexts() {
    if (!texts || !texts.length) return;
    const res = await listTexts(id, { before: texts[texts.length - 1].at, limit: 200 });
    if (scope.disposed) return;
    const have = new Set(texts.map((t) => t.id));
    texts = [...texts, ...res.texts.filter((t) => !have.has(t.id))];
    textsMore = res.more;
    paintTexts();
  }

  function openThread(peer) {
    openPeer = peer;
    for (const t of texts || []) if (t.peer === peer) unreadIds.delete(t.id);
    draft = '';
    paintTexts();
    const input = textsPane.querySelector('.composer-input');
    if (input && window.matchMedia('(min-width: 721px)').matches) input.focus();
  }

  async function openNewText() {
    const to = field({ label: 'To', type: 'tel', mono: true, placeholder: '+14155550100', hint: 'Start with + and the country code.' });
    const ok = await formDialog({
      title: 'New text', size: 'sm', submitLabel: 'Continue',
      build: () => h('div', { class: 'stack' }, to.el),
      onSubmit: async () => {
        const clean = cleanPhone(to.value);
        if (!clean) { to.setError('Enter the full number with + and the country code.'); return false; }
        return clean;
      },
    });
    if (typeof ok === 'string') openThread(ok);
  }

  function composer(number, peer) {
    const inputId = uid('sms');
    const input = h('textarea', { class: 'input textarea composer-input', id: inputId, rows: 2, maxlength: MAX_TEXT, placeholder: 'Write a text', 'aria-label': `Text to ${phoneText(peer)}`, 'aria-describedby': `${inputId}-count` });
    input.value = draft;
    const count = h('span', { class: 'mono composer-count', id: `${inputId}-count` });
    const partsNote = h('span', { class: 'composer-parts' });
    const send = button('Send', { kind: 'primary', type: 'submit', iconName: 'send' });
    const paintCount = () => {
      draft = input.value;
      const p = textParts(input.value);
      count.textContent = `${p.length} / ${MAX_TEXT}`;
      partsNote.textContent = p.parts > 1 ? `${p.parts} parts` : '';
      send.disabled = input.value.trim().length === 0 || number.status !== 'active';
    };
    input.addEventListener('input', paintCount);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); } });
    paintCount();
    const form = h('form', { class: 'composer', onSubmit: (e) => {
      e.preventDefault();
      const bodyText = input.value.trim();
      if (!bodyText) return;
      runBusy(send, async () => {
        await sendText({ id, number: number.number }, peer, bodyText);
        input.value = '';
        draft = '';
        await loadTexts();
      }, { onError: (err) => { if (err.status === 402) { needFunds(err); return true; } return false; } }).then(() => { if (input.isConnected) { paintCount(); input.focus(); } });
    } },
      input,
      h('div', { class: 'composer-foot' },
        h('span', { class: 'small faint composer-note' }, count, partsNote, prices.textOut ? h('span', { class: 'composer-price' }, `${money(prices.textOut)} for each text`) : null),
        send,
      ),
    );
    return form;
  }

  // A number of the "own phone" provider: texts only, carried by a phone of this server.
  const isOwnPhone = () => { const n = findNumber(id); return ownPhone() || !!(n && n.gateway); };

  // Made one time, so that it stays open when the texts paint again.
  const whyStatus = whyParts('delivery-status', { text: 'What does this mean?' });
  const whyCalls = why('own-phone-calls'); // the words come later from the help file; nothing shows until then

  // Parts of feature files under one text or one call (registerTextAddon, registerCallAddon).
  const addons = (nodes, cls) => (nodes.length ? h('div', { class: `addons ${cls}` }, nodes) : null);

  // whyStatus: the newest sent text of a conversation explains the words "Sending", "Sent", "Delivered".
  function bubble(t, whyStatus = null) {
    return h('li', { class: `bubble-row is-${t.direction}` },
      h('div', { class: 'bubble' },
        h('p', { class: 'bubble-text' }, t.broken ? 'This text cannot be opened.' : t.body),
        h('span', { class: 'bubble-meta' },
          h('time', { datetime: new Date(t.at * 1000).toISOString() }, clock(new Date(t.at * 1000))),
          t.direction === 'out' ? h('span', { class: `bubble-status ${t.status === 'failed' ? 'is-failed' : ''}`.trim() }, (t.status === 'queued' && isOwnPhone() ? 'Waiting for the phone' : TEXT_STATUS[t.status]) || 'Sent') : h('span', { class: 'sr-only' }, ' received'),
          whyStatus ? whyStatus.button : null,
        ),
        whyStatus ? whyStatus.panel : null,
        t.direction === 'out' && t.status === 'failed' ? h('p', { class: 'bubble-failed' }, 'The provider did not deliver this text. The charge came back.') : null,
        t.broken ? null : addons(registered.textAddons(t, findNumber(id)), 'bubble-addons'),
      ),
      menuButton({ label: 'Text actions', cls: 'icon-btn-sm bubble-menu', items: [
        { label: 'Copy text', icon: 'copy', onSelect: () => copyText(t.body, 'Text copied') },
        { label: 'Delete', icon: 'trash', danger: true, onSelect: async () => {
          try { await deleteText(t.id); await loadTexts(); } catch (err) { reportError(err); }
        } },
      ] }),
    );
  }

  function paintTexts() {
    const number = findNumber(id);
    if (!number) return;
    if (texts === null) { replace(textsPane, skeletonRows(4, { tall: true })); return; }
    const threads = threadsOf(texts);
    if (openPeer && !threads.some((t) => t.peer === openPeer)) threads.unshift({ peer: openPeer, texts: [], unread: 0, last: null });
    textsPane.dataset.view = openPeer ? 'thread' : 'threads';

    const threadList = h('div', { class: 'thread-list' },
      h('div', { class: 'thread-list-head' },
        h('h2', { class: 'section-title' }, 'Conversations'),
        button('New text', { size: 'sm', iconName: 'plus', onClick: openNewText, disabled: number.status !== 'active' }),
      ),
      textsError && !threads.length ? loadError(textsError, () => { texts = null; paintTexts(); loadTexts(); })
        : threads.length === 0 ? emptyState({
          title: 'No texts yet', compact: true,
          text: 'Texts to this number show here.',
          action: config.dev && config.features.mockPhone ? button('Simulate a text', { size: 'sm', onClick: () => openTestTools('text') }) : copyButton(() => number.number, 'Copy number', { what: 'Number copied', withLabel: true, cls: 'btn-sm' }),
        })
        : h('ul', { class: 'threads' }, threads.map((th) => {
          const unread = th.texts.filter((t) => unreadIds.has(t.id)).length;
          return h('li', null, h('button', { class: `thread ${th.peer === openPeer ? 'is-open' : ''} ${unread ? 'is-unread' : ''}`.trim(), type: 'button', 'aria-current': th.peer === openPeer ? 'true' : null, onClick: () => openThread(th.peer) },
            h('span', { class: 'thread-top' },
              h('span', { class: 'thread-peer mono truncate' }, phoneText(th.peer)),
              th.last ? h('time', { class: 'thread-time', datetime: new Date(th.last.at * 1000).toISOString() }, shortTime(th.last.at)) : null,
            ),
            h('span', { class: 'thread-bottom' },
              h('span', { class: 'thread-snippet truncate' }, th.last ? `${th.last.direction === 'out' ? 'You: ' : ''}${th.last.body}` : 'New conversation'),
              unread ? h('span', { class: 'badge', 'aria-label': `${unread} unread` }, String(unread)) : null,
            ),
          ));
        })),
      textsMore ? h('div', { class: 'list-more' }, button('Show older texts', { size: 'sm', onClick: (e, btn) => runBusy(btn, loadOlderTexts) })) : null,
    );

    let conversation;
    if (!openPeer) {
      conversation = h('div', { class: 'conversation is-empty' }, threads.length ? emptyState({ title: 'No conversation open', text: 'Choose a conversation, or start a new text.', compact: true }) : null);
    } else {
      const th = threads.find((t) => t.peer === openPeer);
      const items = [];
      let day = '';
      const lastOut = [...th.texts].reverse().find((t) => t.direction === 'out');
      for (const t of th.texts) {
        const d = dayLabel(t.at);
        if (d !== day) { day = d; items.push(h('li', { class: 'bubble-day' }, h('span', null, d))); }
        items.push(bubble(t, t === lastOut ? whyStatus : null));
      }
      const scroller = h('ol', { class: 'bubbles', tabIndex: 0, 'aria-label': `Texts with ${phoneText(openPeer)}` }, items.length ? items : h('li', { class: 'bubble-day' }, h('span', null, 'No texts yet')));
      conversation = h('div', { class: 'conversation' },
        h('div', { class: 'conversation-head' },
          iconButton('chevronLeft', 'Back to conversations', { cls: 'conversation-back', onClick: () => { openPeer = null; paintTexts(); } }),
          h('span', { class: 'mono conversation-peer truncate' }, phoneText(openPeer)),
          copyButton(() => openPeer, 'Copy number', { what: 'Number copied', cls: 'icon-btn-sm' }),
          th.texts.length ? menuButton({ label: 'Conversation actions', cls: 'icon-btn-sm', items: [
            { label: 'Delete conversation', icon: 'trash', danger: true, onSelect: async () => {
              const ok = await confirmDialog({ title: 'Delete this conversation?', message: `All ${th.texts.length} texts with ${phoneText(th.peer)} are removed from the server.`, confirmLabel: 'Delete' });
              if (!ok) return;
              try { for (const t of th.texts) await deleteText(t.id); openPeer = null; toast('Conversation deleted', { kind: 'ok' }); } catch (err) { reportError(err); }
              await loadTexts();
            } },
          ] }) : null,
        ),
        scroller,
        number.status !== 'active'
          ? h('p', { class: 'composer-paused small' }, icon('warning', { size: 14 }), h('span', null, 'This number is paused. Add funds to send texts. ', releaseNote(number)))
          : number.sms === false ? h('p', { class: 'composer-paused small' }, 'This number cannot send texts.') : composer(number, openPeer),
      );
      queueMicrotask(() => { scroller.scrollTop = scroller.scrollHeight; });
    }
    // Keep the cursor in the text box when the list repaints (a new text arrived).
    const active = document.activeElement;
    const hadFocus = active && active.classList && active.classList.contains('composer-input') && textsPane.contains(active);
    const sel = hadFocus ? [active.selectionStart, active.selectionEnd] : null;
    replace(textsPane, threadList, conversation);
    if (hadFocus) {
      const input = textsPane.querySelector('.composer-input');
      if (input) { input.focus(); try { input.setSelectionRange(sel[0], sel[1]); } catch { /* not a text field */ } }
    }
  }

  // ---------- calls ----------
  let calls = null;
  let callsMore = false;
  let callsError = '';
  const callsPane = h('div', { class: 'calls' });

  async function loadCalls() {
    try {
      const res = await listCalls(id);
      if (scope.disposed) return;
      calls = res.calls;
      callsMore = res.more;
      callsError = '';
    } catch (err) {
      if (scope.disposed) return;
      callsError = err.message;
      if (calls === null) calls = [];
    }
    paintCalls();
  }

  async function loadOlderCalls() {
    if (!calls || !calls.length) return;
    const res = await listCalls(id, { before: calls[calls.length - 1].at });
    if (scope.disposed) return;
    const have = new Set(calls.map((c) => c.id));
    calls = [...calls, ...res.calls.filter((c) => !have.has(c.id))];
    callsMore = res.more;
    paintCalls();
  }

  async function openCall(prefill = '') {
    const number = findNumber(id);
    const phone = number && number.forwardPhoneId ? findPhone(number.forwardPhoneId) : null;
    if (!phone || !phone.verified) {
      const go = await confirmDialog({
        title: 'Link a real phone to call', danger: false, confirmLabel: 'Open Settings',
        message: 'To call from this number we ring your real phone first, then connect you. Choose a linked phone in the Settings tab of this number.',
      });
      if (go && tabsEl) tabsEl.select('settings', true);
      return;
    }
    const to = field({ label: 'Number to call', type: 'tel', mono: true, value: prefill, placeholder: '+14155550100', hint: 'Start with + and the country code.' });
    const ok = await formDialog({
      title: 'Call', size: 'sm', submitLabel: 'Call',
      description: `We ring ${phoneName(phone)} first. When you pick up, we connect you. The other person sees ${phoneText(number.number)}.`,
      build: () => h('div', { class: 'stack' }, to.el, prices.callMinute ? h('p', { class: 'price-note' }, icon('funds', { size: 16 }), h('span', null, `Calls cost ${money(prices.callMinute)} for each minute.`)) : null),
      onSubmit: async () => {
        const clean = cleanPhone(to.value);
        if (!clean) { to.setError('Enter the full number with + and the country code.'); return false; }
        await startCall({ id, number: number.number }, clean);
        return true;
      },
      onError: (err, api) => { if (err.status === 402) { api.close(); needFunds(err); return true; } return false; },
    });
    if (ok) toast('We are calling your phone now. Pick up to be connected.', { kind: 'ok', timeout: 7000 });
  }

  function paintCalls() {
    const number = findNumber(id);
    if (!number) return;
    // "Own phone": no calls through the app, so no call list. One short explanation.
    if (isOwnPhone()) {
      replace(callsPane, h('div', { class: 'stack stack-3 calls-none' },
        h('p', { class: 'read' }, `This number cannot make or get calls through ${appName()}. To get calls, set call forwarding on the SIM card. Help explains how.`),
        whyCalls,
      ));
      return;
    }
    const head = number.voice
      ? h('div', { class: 'calls-head' },
        h('p', { class: 'muted read' }, 'To call from this number, we ring your real phone first and then connect you. The other person sees this number, not your real one.'),
        button('Call', { kind: 'primary', iconName: 'phone', onClick: () => openCall(), disabled: number.status !== 'active' }),
      )
      : h('div', { class: 'calls-head' }, callout('info', 'This number has no calls', h('p', null, 'It can send and get texts. It cannot make or get calls.')));
    if (calls === null) { replace(callsPane, head, h('div', { class: 'sheet' }, skeletonRows(3))); return; }
    if (callsError && !calls.length) { replace(callsPane, head, h('div', { class: 'sheet' }, loadError(callsError, () => { calls = null; paintCalls(); loadCalls(); }))); return; }
    if (!calls.length) {
      replace(callsPane, head, h('div', { class: 'sheet' }, emptyState({
        title: 'No calls yet', compact: true, text: 'Calls to and from this number show here.',
        action: config.dev && config.features.mockPhone ? button('Simulate a call', { size: 'sm', onClick: () => openTestTools('call') }) : null,
      })));
      return;
    }
    const KIND = { in: { answered: ['callIn', 'Incoming call'], missed: ['callMissed', 'Missed call'], failed: ['callMissed', 'Failed call'] }, out: { answered: ['callOut', 'Outgoing call'], missed: ['callOut', 'No answer'], failed: ['callMissed', 'Failed call'] } };
    replace(callsPane, head, h('div', { class: 'sheet' }, h('ul', { class: 'call-list' }, calls.map((c) => {
      const [ic, label] = (KIND[c.direction] || KIND.in)[c.status] || ['phone', 'Call'];
      return h('li', { class: `call-row is-${c.status}` },
        h('span', { class: 'call-icon' }, icon(ic, { size: 18 })),
        h('div', { class: 'grow' },
          h('p', { class: 'mono call-peer truncate' }, phoneText(c.peer) || 'Unknown number'),
          h('p', { class: 'small muted' }, label, c.status === 'answered' ? `, ${duration(c.seconds)}` : ''),
          addons(registered.callAddons(c, number), 'call-addons'),
        ),
        h('time', { class: 'small muted nowrap', datetime: new Date(c.at * 1000).toISOString() }, shortTime(c.at)),
        menuButton({ label: 'Call actions', items: [
          c.peer ? { label: 'Call back', icon: 'phone', onSelect: () => openCall(c.peer) } : null,
          c.peer ? { label: 'Copy number', icon: 'copy', onSelect: () => copyText(c.peer, 'Number copied') } : null,
          { label: 'Delete', icon: 'trash', danger: true, onSelect: async () => { try { await deleteCall(c.id); await loadCalls(); } catch (err) { reportError(err); } } },
        ] }),
      );
    })), callsMore ? h('div', { class: 'list-more' }, button('Show older calls', { size: 'sm', onClick: (e, btn) => runBusy(btn, loadOlderCalls) })) : null));
  }

  // A paused number is given back to the provider after some days.
  function releaseNote(number) {
    const days = graceDays();
    if (!days || !number.paidUntil) return null;
    const day = new Date((number.paidUntil + days * 86400) * 1000).toISOString().slice(0, 10);
    return `If the balance stays too low, the number is released after ${dayText(day)}.`;
  }

  // ---------- settings ----------
  const settingsPane = h('div', { class: 'number-settings stack stack-6' });
  let personaEl = null;
  function paintSettings() {
    const number = findNumber(id);
    if (!number) return;
    const phones = (store.get('phones') || []).filter((p) => p.verified);
    const label = field({ label: 'Label', value: number.label, maxlength: 60, placeholder: 'for example: Selling the bike', hint: 'Only you see this. It is encrypted.' });
    const save = button('Save label', { type: 'submit' });
    const labelForm = h('form', { class: 'settings-row', onSubmit: (e) => { e.preventDefault(); runBusy(save, async () => { await updateNumber(id, { label: label.value.trim() }); toast('Saved', { kind: 'ok', timeout: 2000 }); }); } }, label.el, save);

    const current = number.forwardPhoneId && phones.some((p) => p.id === number.forwardPhoneId) ? number.forwardPhoneId : '';
    const target = selectField({
      label: 'Forward to', value: current,
      options: [{ value: '', label: 'No forwarding (in app only)' }, ...phones.map((p) => ({ value: p.id, label: `${phoneName(p)}${p.label ? `  ${phoneText(p.number)}` : ''}` }))],
    });
    target.input.addEventListener('change', async () => {
      target.input.disabled = true;
      try {
        const v = target.value || null;
        await updateNumber(id, v ? { forwardPhoneId: v } : { forwardPhoneId: null, forwardTexts: false, forwardCalls: false });
        toast(v ? 'Forwarding phone saved' : 'Forwarding turned off', { kind: 'ok', timeout: 2200 });
      } catch (err) { reportError(err); paintSettings(); }
    });
    const hasTarget = !!current;
    const groupNow = number.identityId ? findIdentity(number.identityId) : null;
    const rowItem = () => ({ kind: 'number', id, display: phoneText(number.number), identityId: groupNow ? groupNow.id : '' });

    // Automatic deletion of old texts.
    const KEEP = [1, 7, 30, 90, 365];
    const days = number.retentionDays;
    const keepOptions = [{ value: '', label: 'Keep all texts' }, ...KEEP.map((d) => ({ value: String(d), label: d === 1 ? 'Delete texts after 1 day' : d === 365 ? 'Delete texts after 1 year' : `Delete texts after ${d} days` }))];
    if (days && !KEEP.includes(days)) keepOptions.push({ value: String(days), label: `Delete texts after ${days} days` });
    const keep = selectField({ label: 'Delete old texts', value: days ? String(days) : '', options: keepOptions });
    keep.input.addEventListener('change', async () => {
      const next = keep.value ? Number(keep.value) : null;
      if (next) {
        const ok = await confirmDialog({ title: 'Delete old texts?', danger: true, confirmLabel: 'Turn on', message: `Texts of this number that are older than ${next === 1 ? '1 day' : next === 365 ? '1 year' : `${next} days`} are deleted from the server, now and from now on. You cannot get them back.` });
        if (!ok) { paintSettings(); return; }
      }
      keep.input.disabled = true;
      try {
        await updateNumber(id, { retentionDays: next });
        toast(next ? 'Old texts are deleted from now on' : 'All texts are kept from now on', { kind: 'ok', timeout: 2600 });
      } catch (err) { reportError(err); }
      if (!scope.disposed) paintSettings();
    });
    // The card is made one time and kept: a password that is on the screen must not go away
    // when something else of the number changes.
    if (!personaEl) personaEl = personaCard({ persona: number.persona, headingLevel: 'h2', onSave: (next) => setItemPersona('number', id, next), username: number.extra.username, onSaveUsername: (next) => setItemExtra('number', id, { username: next }) });
    else { personaEl.setPersona(number.persona); personaEl.setUsername(number.extra.username); }
    const forwardRow = (title, textValue, key, on) => h('div', { class: 'switch-row' },
      h('div', { class: 'grow' }, h('p', { class: 'strong' }, title), h('p', { class: 'small muted' }, textValue)),
      toggle({ checked: on && hasTarget, label: title, disabled: !hasTarget, withText: true, onChange: (v) => updateNumber(id, { [key]: v }) }),
    );

    const own = [
      h('section', null, labelForm),
      h('section', { class: 'stack stack-3' },
        h('div', null,
          h('h2', { class: 'section-title' }, 'Forwarding'),
          h('p', { class: 'section-lede' }, isOwnPhone() ? 'Optional. Without forwarding, texts stay in this app. To forward, the server must know your real phone number.' : 'Optional. Without forwarding, texts and calls stay in this app. To forward, the server must know your real phone number.'),
          whyGroup([['forwarding'], ['link-phone']]),
        ),
        phones.length === 0
          ? callout('info', 'No real phone linked', h('p', null, 'Link a real phone to forward texts and calls to it.'), h('div', null, button('Link a phone', { size: 'sm', onClick: () => openLinkPhone() })))
          : h('div', { class: 'sheet sheet-pad stack' },
            target.el,
            forwardRow('Forward texts', prices.textOut ? `Each forwarded text costs ${money(prices.textOut)}.` : 'Texts are sent on to your phone.', 'forwardTexts', number.forwardTexts),
            number.voice
              ? forwardRow('Forward calls', prices.callMinute ? `Forwarded calls cost ${money(prices.callMinute)} for each minute.` : 'Calls ring on your phone.', 'forwardCalls', number.forwardCalls)
              : isOwnPhone() ? null : h('div', { class: 'switch-row' }, h('div', { class: 'grow' }, h('p', { class: 'strong' }, 'Forward calls'), h('p', { class: 'small muted' }, 'This number cannot make or get calls.'))),
          ),
      ),
      h('section', { class: 'stack stack-3' },
        h('h2', { class: 'section-title' }, 'Identity'),
        h('div', { class: 'sheet sheet-pad settings-identity' },
          h('p', { class: 'grow' }, groupNow ? ['This number is in the identity ', h('a', { href: `/identities/${groupNow.id}`, 'data-link': true }, groupNow.name), '.'] : 'This number is in no identity. An identity is a named group of aliases and numbers.'),
          h('div', { class: 'row row-wrap row-2' },
            button(groupNow ? 'Move to another identity' : 'Put in identity', { size: 'sm', onClick: () => openPutInIdentity(rowItem()) }),
            groupNow ? button('Take out', { size: 'sm', onClick: () => takeOutOfIdentity(rowItem()) }) : null,
          ),
        ),
      ),
      h('section', { class: 'sheet sheet-pad' }, personaEl),
      h('section', { class: 'stack stack-3' },
        h('div', null,
          h('h2', { class: 'section-title' }, 'Old texts'),
          h('p', { class: 'section-lede' }, 'The server can delete old texts of this number by itself. It checks each hour, also when this app is closed. Deleted texts cannot come back. Calls are not deleted.'),
        ),
        h('div', { class: 'sheet sheet-pad' }, keep.el),
      ),
      h('section', { class: 'stack stack-3' },
        h('h2', { class: 'section-title' }, 'Renewal'),
        h('dl', { class: 'kv kv-left sheet sheet-pad' },
          h('dt', null, 'Status'), h('dd', null, number.status === 'active' ? 'Active' : h('span', null, 'Paused. Add funds to turn it on again. ', releaseNote(number))),
          h('dt', null, 'Price'), h('dd', { class: 'mono' }, prices.numberMonth ? `${money(prices.numberMonth)} / ${renewDays()} days` : 'Free'),
          h('dt', null, number.status === 'active' ? 'Renews on' : 'Paid until'), h('dd', null, number.paidUntil ? dayText(new Date(number.paidUntil * 1000).toISOString().slice(0, 10)) : '–'),
          h('dt', null, 'Can do'), h('dd', null, (number.sms && number.voice ? 'Texts and calls' : number.sms ? 'Texts' : number.voice ? 'Calls' : '–')),
        ),
      ),
      h('section', { class: 'danger-zone stack stack-3' },
        h('h2', { class: 'section-title' }, 'Release this number'),
        h('p', { class: 'muted read' }, 'The number goes back to the provider. Its texts and its call log are deleted. You cannot get the number back.'),
        h('div', null, button('Release number', { kind: 'danger', iconName: 'trash', onClick: async () => {
          const ok = await confirmDeleteItem({ kind: 'number', id, number: number.number });
          if (ok) navigate('/numbers', { replace: true });
        } })),
      ),
    ];
    // The sections above, with the sections of feature files between them (registerNumberSetting).
    const ORDERS = [10, 20, 30, 40, 50, 80, 100];
    const extra = registered.numberSettings().map((sec) => {
      const node = renderSafe(sec.render, { number, scope });
      return node ? { order: sec.order, el: h('section', { class: 'stack stack-3', dataset: { section: sec.id } },
        h('div', null, h('h2', { class: 'section-title' }, sec.title), sec.lede ? h('p', { class: 'section-lede' }, sec.lede) : null),
        node) } : null;
    }).filter(Boolean);
    replace(settingsPane, mergeByOrder(own.map((el, i) => ({ order: ORDERS[i], el })), extra).map((part) => part.el));
  }

  // ---------- page ----------
  function paintHead() {
    const number = findNumber(id);
    if (!number || !headRegion) return;
    const phone = number.forwardPhoneId ? findPhone(number.forwardPhoneId) : null;
    const forwards = phone && phone.verified && (number.forwardTexts || number.forwardCalls);
    const group = number.identityId ? findIdentity(number.identityId) : null;
    const phoneWords = gatewayWords(number, shortTime);
    // The phone of this number is offline for more than one hour: say what that means.
    const g = number.gateway;
    const longOffline = !!(g && !g.online && (g.lastSeen === null || Date.now() / 1000 - g.lastSeen > OFFLINE_SECONDS));
    replace(headRegion,
      h('a', { class: 'back-link', href: '/numbers', 'data-link': true }, icon('chevronLeft', { size: 16 }), 'Numbers'),
      h('div', { class: 'page-head-row' },
        h('div', { class: 'grow' },
          h('div', { class: 'number-title' },
            h('h1', { class: 'page-title mono number-heading' }, phoneText(number.number)),
            copyButton(() => number.number, 'Copy number', { what: 'Number copied' }),
          ),
          h('p', { class: 'page-lede number-sub' },
            number.label ? h('span', null, number.label) : h('span', { class: 'faint' }, 'No label'),
            number.status !== 'active' ? tag('Paused', 'warn') : null,
            h('span', { class: 'number-route' }, forwards ? [icon('arrowRight', { size: 14 }), `forwards to ${phoneName(phone)}`] : 'in app only'),
            phoneWords ? h('span', { class: `tag ${number.gateway.online ? '' : 'tag-warn'}`.trim(), dataset: { phone: number.gateway.online ? 'online' : 'offline' } }, phoneWords) : null,
            group ? h('a', { class: 'tag tag-link', href: `/identities/${group.id}`, 'data-link': true, title: `In the identity ${group.name}` }, icon('folder', { size: 12 }), h('span', { class: 'truncate' }, group.name)) : null,
          ),
        ),
      ),
      longOffline ? h('div', { class: 'number-offline', dataset: { warning: 'offline' } }, callout('warn', 'The phone is offline', h('p', null, 'The phone for this number is offline. Texts wait until it is online again.'))) : null,
    );
  }

  function build() {
    built = true;
    headRegion = h('header', { class: 'page-head' });
    // Texts, Calls and Settings, with the tabs of feature files between them (registerNumberTab).
    tabsEl = tabs({ label: 'Number', value: 'texts', items: mergeByOrder([
      { order: 10, id: 'texts', label: 'Texts', render: () => { queueMicrotask(() => { paintTexts(); if (texts && texts.some((t) => t.direction === 'in' && !t.seen)) markTextsSeen(id).then(() => loadNumbers()).catch(() => {}); }); return textsPane; } },
      { order: 20, id: 'calls', label: 'Calls', render: () => { if (calls === null && !isOwnPhone()) loadCalls(); queueMicrotask(paintCalls); return callsPane; } },
      { order: 90, id: 'settings', label: 'Settings', render: () => { queueMicrotask(paintSettings); return settingsPane; } },
    ], registered.numberTabs().map((t) => ({ order: t.order, id: t.id, label: t.label, render: () => renderSafe(t.render, { number: findNumber(id), scope }) || h('div') }))) });
    replace(root, headRegion, tabsEl);
    paintHead();
    // Another screen asked for one conversation, or for another tab.
    const open = takeNumberOpen(id);
    if (open && open.peer) openPeer = open.peer;
    if (open && open.tab && open.tab !== 'texts') tabsEl.select(open.tab);
    loadTexts();
  }

  function sync() {
    const numbers = store.get('numbers');
    if (numbers === null) { if (!built) replace(root, pageHeader({ title: 'Number', back: { href: '/numbers', label: 'Numbers' } }), skeletonRows(4)); return; }
    const number = findNumber(id);
    if (!number) {
      built = false;
      replace(root, pageHeader({ title: 'Number', back: { href: '/numbers', label: 'Numbers' } }),
        h('div', { class: 'sheet' }, emptyState({ title: 'This number does not exist', text: 'It may be released.', action: h('a', { class: 'btn', href: '/numbers', 'data-link': true }, 'Back to Numbers') })));
      return;
    }
    if (!built) { build(); return; }
    paintHead();
    if (tabsEl.active === 'settings') paintSettings();
    else if (tabsEl.active === 'texts') paintTexts();
    else if (tabsEl.active === 'calls') paintCalls();
  }

  if (!config.features.phone) {
    replace(root, pageHeader({ title: 'Numbers' }), h('div', { class: 'sheet' }, emptyState({ title: 'Numbers are turned off', text: 'This server has no phone provider.' })));
    return root;
  }
  scope.add(store.subscribe(['numbers', 'phones', 'identities'], sync));
  scope.add(bus.on('text', () => { if (built) loadTexts(); }));
  scope.add(bus.on('call', () => { if (built && calls !== null) loadCalls(); }));
  sync();
  return root;
}
