// Burn: the dialogs and the work.
//   Step 1  the exact list of what is destroyed (with counts from the server)
//   Step 2  type BURN
//   Then    the steps run one after the other, with the progress in words
// Every step is safe to run again: an alias that is off stays off, mail that is gone stays
// gone, a number that is released counts as done.
import { h, replace } from '../../lib/dom.js';
import { store } from '../../lib/store.js';
import { api, query } from '../../lib/api.js';
import { phoneText, plural } from '../../lib/format.js';
import { updateAlias, releaseNumber, setItemExtra, loadAliases, loadMailboxes, findAlias, findNumber } from '../../lib/data.js';
import { findIdentity, membersOf, setIdentityExtra, addIdentityEvent } from '../../lib/identities.js';
import { button, callout, skeletonRows, loadError } from '../../ui/components.js';
import { openDialog, confirmDialog } from '../../ui/dialog.js';

const WORD = 'BURN';
const ID = /^[A-Za-z0-9_-]{22}$/;
const PAGE_MAIL = 100;
const PAGE_PHONE = 200;
const MAX_PAGES = 10;    // counting stops here and says "at least"
const today = () => new Date().toISOString().slice(0, 10);
const aliasWord = (n) => plural(n, 'alias', 'aliases');
const gone = (err) => !!err && err.status === 404;

// ---- what a burn covers ----
// target = { kind: 'identity' | 'alias' | 'number', id }. Gives { name, aliases, numbers } or null.
function coverOf(target) {
  if (target.kind === 'identity') {
    const g = findIdentity(target.id);
    if (!g) return null;
    const m = membersOf(g.id);
    return { name: `“${g.name}”`, aliases: m.aliases, numbers: m.numbers };
  }
  if (target.kind === 'alias') {
    const a = findAlias(target.id);
    return a ? { name: a.address, aliases: [a], numbers: [] } : null;
  }
  const n = findNumber(target.id);
  return n ? { name: phoneText(n.number), aliases: [], numbers: [n] } : null;
}

// ---- exact counts ----
// Counts rows of a list that has pages. next(page) gives the query of the page after it.
async function countPages(path, key, first, next) {
  let total = 0;
  let params = first;
  for (let i = 0; i < MAX_PAGES; i++) {
    const res = await api.get(path + query(params));
    const rows = (res && res[key]) || [];
    total += rows.length;
    if (!res.more || rows.length === 0) return { count: total, atLeast: false };
    params = next(rows[rows.length - 1]);
  }
  return { count: total, atLeast: true };
}
async function countAll(cover) {
  const sum = (parts) => parts.reduce((a, b) => ({ count: a.count + b.count, atLeast: a.atLeast || b.atLeast }), { count: 0, atLeast: false });
  const ids = cover.aliases.map((a) => a.id);
  const mailJobs = [];
  for (let i = 0; i < ids.length; i += 50) {
    const addressIds = ids.slice(i, i + 50).join(',');
    mailJobs.push(countPages('/api/messages', 'messages', { addressIds, limit: PAGE_MAIL }, (last) => ({ addressIds, limit: PAGE_MAIL, before: last.at, beforeId: last.id })));
  }
  const phone = (kind) => Promise.all(cover.numbers.map((n) => countPages(`/api/numbers/${n.id}/${kind}`, kind, { limit: PAGE_PHONE }, (last) => ({ limit: PAGE_PHONE, before: last.at }))));
  const [mail, texts, calls] = await Promise.all([Promise.all(mailJobs), phone('texts'), phone('calls')]);
  return { mail: sum(mail), texts: sum(texts), calls: sum(calls) };
}
const amount = (c, one, many) => `${c.atLeast ? 'at least ' : ''}${plural(c.count, one, many)}`;

// The list of step 1: every line is one thing that the burn does.
function listOf(cover, counts) {
  const lines = [];
  const single = cover.aliases.length + cover.numbers.length === 1;
  if (cover.aliases.length) {
    lines.push(h('li', { dataset: { burns: 'aliases' } },
      h('p', { class: 'strong' }, single ? 'Turns off this alias' : `Turns off ${aliasWord(cover.aliases.length)}`),
      cover.aliases.map((a) => h('p', { class: 'mono small break' }, a.address)),
    ));
    lines.push(h('li', { dataset: { burns: 'mail' } },
      h('p', { class: 'strong' }, `Deletes ${amount(counts.mail, 'mail')}`),
      h('p', { class: 'small muted' }, single ? 'All mail that this alias got and sent.' : 'All mail that these aliases got and sent.'),
    ));
  }
  if (cover.numbers.length) {
    lines.push(h('li', { dataset: { burns: 'numbers' } },
      h('p', { class: 'strong' }, single ? 'Releases this number' : `Releases ${plural(cover.numbers.length, 'number')}`),
      cover.numbers.map((n) => h('p', { class: 'mono small' }, phoneText(n.number))),
      h('p', { class: 'small muted' }, cover.numbers.length === 1 ? 'You cannot get this number back.' : 'You cannot get these numbers back.'),
    ));
    lines.push(h('li', { dataset: { burns: 'phone' } },
      h('p', { class: 'strong' }, `Deletes ${amount(counts.texts, 'text')} and ${amount(counts.calls, 'call')}`),
    ));
  }
  return h('ul', { class: 'f-burn-list' }, lines);
}

// ---- the work ----
// steps: [{ words, run }]. say(text, done, total) tells the progress.
function stepsOf(cover) {
  const steps = [];
  for (const a of cover.aliases) {
    steps.push({ words: `Turning off ${a.address}`, run: async () => {
      const now = findAlias(a.id);
      if (!now || !now.enabled) return;
      try { await updateAlias(a.id, { enabled: false }); } catch (err) { if (!gone(err)) throw err; }
    } });
    steps.push({ words: `Deleting the mail of ${a.address}`, run: async () => {
      try { await api.del(`/api/addresses/${a.id}/messages`); } catch (err) { if (!gone(err)) throw err; }
    } });
  }
  for (const n of cover.numbers) {
    steps.push({ words: `Releasing ${phoneText(n.number)}`, run: async () => {
      try { await releaseNumber(n.id); } catch (err) { if (!gone(err)) throw err; }
    } });
  }
  return steps;
}

async function work(target, cover, say) {
  const day = today();
  const steps = stepsOf(cover);
  // The identity remembers the burn before the first step. A burn that stops can be finished later.
  if (target.kind === 'identity') {
    await setIdentityExtra(target.id, { burning: { day, aliasIds: cover.aliases.map((a) => a.id), numberIds: cover.numbers.map((n) => n.id) } });
  }
  for (let i = 0; i < steps.length; i++) {
    say(steps[i].words, i, steps.length);
    await steps[i].run();
  }
  say('Saving the result', steps.length, steps.length);
  if (target.kind === 'identity') {
    await setIdentityExtra(target.id, { burned: { day }, burning: null });
    await addIdentityEvent(target.id, 'burned', day);
  } else if (target.kind === 'alias' && findAlias(target.id)) {
    await setItemExtra('alias', target.id, { burned: { day } });
  }
  // The counts of the inboxes changed with the deleted mail.
  await Promise.allSettled([loadMailboxes(), loadAliases()]);
}

const DONE_WORDS = {
  identity: 'This identity is burned. Its aliases are off, their mail is deleted, and its numbers are released.',
  alias: 'This alias is burned. It is off, and its mail is deleted.',
  number: 'This number is released. Its texts and calls are deleted.',
};

// The dialog that shows the progress. The person cannot close it while the work runs.
function runDialog(target, cover) {
  const status = h('p', { class: 'read', role: 'status' }, 'Starting');
  const bar = h('div', { class: 'progress-bar' });
  const slot = h('div', { class: 'stack' });
  // Not dismissable: Escape and a click next to the dialog do nothing. It closes with its buttons.
  const dlg = openDialog({
    title: `Burning ${cover.name}`, size: 'sm', dismissable: false,
    content: () => slot,
  });
  const say = (text, done, total) => {
    status.textContent = `Step ${Math.min(done + 1, total)} of ${total}: ${text}`;
    bar.style.width = `${Math.round((done / Math.max(total, 1)) * 100)}%`;
  };
  async function start() {
    replace(slot, status, h('div', { class: 'progress', 'aria-hidden': 'true' }, bar), h('p', { class: 'hint' }, 'Keep this page open until the burn is done.'));
    try {
      await work(target, cover, say);
      const close = button('Done', { kind: 'primary', attrs: { autofocus: true }, onClick: () => dlg.close(true) });
      replace(slot, h('div', { role: 'status' }, callout('ok', DONE_WORDS[target.kind])), h('div', { class: 'dialog-actions' }, close));
      close.focus();
    } catch (err) {
      const again = button('Try again', { kind: 'primary', iconName: 'refresh', onClick: start });
      replace(slot,
        h('div', { role: 'alert' }, callout('danger', 'The burn did not finish',
          h('p', null, (err && err.message) || 'A step did not work.'),
          h('p', null, target.kind === 'identity' ? 'What is done stays done. Try again now, or open the identity later and select "Finish the burn".' : 'What is done stays done. Try again now, or start the burn again later.'),
        )),
        h('div', { class: 'dialog-actions' }, button('Close', { onClick: () => dlg.close(false) }), again),
      );
      again.focus();
    }
  }
  start();
  return dlg.closed;
}

// ---- start a burn: the list, then the word ----
export async function openBurn(target) {
  const cover = coverOf(target);
  if (!cover) return;
  if (cover.aliases.length + cover.numbers.length === 0) {
    await confirmDialog({ title: `Burn ${cover.name}`, message: 'This identity has no aliases and no numbers. There is nothing to burn.', confirmLabel: 'Close', danger: false });
    return;
  }
  // Step 1: what is destroyed.
  const go = await new Promise((resolve) => {
    const slot = h('div', { class: 'stack' }, skeletonRows(3));
    const dlg = openDialog({ title: `Burn ${cover.name}`, size: 'md', content: () => slot });
    dlg.closed.then((v) => resolve(v === true));
    const load = async () => {
      try {
        const counts = await countAll(cover);
        const cancel = button('Cancel', { attrs: { autofocus: true }, onClick: () => dlg.close(false) });
        replace(slot,
          h('p', { class: 'read' }, 'The burn does all of this:'),
          listOf(cover, counts),
          callout('danger', 'This cannot be undone'),
          h('div', { class: 'dialog-actions' }, cancel, button('Continue', { kind: 'danger', onClick: () => dlg.close(true) })),
        );
        cancel.focus();
      } catch (err) {
        replace(slot, loadError(err.message, () => { replace(slot, skeletonRows(3)); load(); }));
      }
    };
    load();
  });
  if (!go) return;
  // Step 2: a different question. No single click burns.
  const sure = await confirmDialog({
    title: `Burn ${cover.name}?`, typed: WORD, confirmLabel: 'Burn',
    message: 'This is the last step. After it nothing can bring the mail, the texts, the calls or the numbers back.',
  });
  if (!sure) return;
  // The lists can be old by now: take what is there at this moment.
  const fresh = coverOf(target);
  if (fresh) await runDialog(target, fresh);
}

// ---- finish a burn that stopped (identity only) ----
export async function finishBurn(identityId) {
  const g = findIdentity(identityId);
  const saved = g && g.extra ? g.extra.burning : null;
  if (!g || !saved || typeof saved !== 'object') return;
  const ids = (list) => (Array.isArray(list) ? list.filter((id) => typeof id === 'string' && ID.test(id)).slice(0, 500) : []);
  // What is left of the saved burn: the aliases and numbers that still exist.
  const aliases = ids(saved.aliasIds).map((id) => (store.get('aliases') || []).find((a) => a.id === id)).filter(Boolean);
  const numbers = ids(saved.numberIds).map((id) => (store.get('numbers') || []).find((n) => n.id === id)).filter(Boolean);
  const cover = { name: `“${g.name}”`, aliases, numbers };
  const ok = await confirmDialog({
    title: `Finish the burn of ${cover.name}?`, confirmLabel: 'Finish the burn',
    message: h('div', { class: 'stack stack-3' },
      h('p', { class: 'read' }, 'This burn stopped in the middle. To finish it:'),
      h('ul', { class: 'f-burn-list' },
        aliases.length ? h('li', null, h('p', { class: 'strong' }, `Turns off ${aliasWord(aliases.length)} and deletes their mail`), aliases.map((a) => h('p', { class: 'mono small break' }, a.address))) : null,
        numbers.length ? h('li', null, h('p', { class: 'strong' }, `Releases ${plural(numbers.length, 'number')} with their texts and calls`), numbers.map((n) => h('p', { class: 'mono small' }, phoneText(n.number)))) : null,
        !aliases.length && !numbers.length ? h('li', null, h('p', { class: 'strong' }, 'Marks the identity as burned. Everything else is done.')) : null,
      ),
      h('p', { class: 'read strong' }, 'This cannot be undone.'),
    ),
  });
  if (ok) await runDialog({ kind: 'identity', id: identityId }, cover);
}
