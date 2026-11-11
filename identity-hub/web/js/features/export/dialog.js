// The "Download my data" dialog: look at what there is, show the estimated size, build the
// file with progress in words, and hand it to the browser as a normal download.
import { h, replace } from '../../lib/dom.js';
import { store } from '../../lib/store.js';
import { openDialog } from '../../ui/dialog.js';
import { button, callout, checkbox } from '../../ui/components.js';
import { navigate } from '../../lib/router.js';
import { toast } from '../../ui/toast.js';
import { downloadBlob } from '../../lib/mail.js';
import { bytesText, plural } from '../../lib/format.js';
import { LARGE_EXPORT_BYTES } from '../../lib/exportfile.js';
import { surveyExport, buildExport } from './collect.js';
import { VIEWER_PATH } from '../export.js';

const about = (bytes) => `about ${bytesText(bytes)}`;
const FOUND = { items: 'Reading your inboxes, aliases and numbers', mail: 'Mail', texts: 'Texts', calls: 'Calls', blocks: 'Blocked senders' };
const PART = { mail: 'Mail', voicemail: 'Voicemail' };

let open = false; // one export at a time

export function openExportDialog() {
  if (open) return;
  open = true;
  const controller = new AbortController();
  const body = h('div', { class: 'stack', dataset: { export: 'dialog' } });
  const dlg = openDialog({ title: 'Download my data', size: 'md', content: () => body });
  let working = false; // true while the lists are read or the file is built
  dlg.closed.then(() => {
    open = false;
    controller.abort();
    if (working) toast('Export cancelled. No file was saved.', { timeout: 3200 });
  });
  const alive = () => !controller.signal.aborted;
  const focus = (el) => { if (el && alive()) el.focus(); };
  const cancelButton = (label = 'Cancel') => button(label, { onClick: () => dlg.close() });
  const waitNote = h('p', { class: 'small muted', hidden: true }, 'The server asked for a pause. Waiting, then going on.');
  const onWait = (on) => { waitNote.hidden = !on; };

  function fail(err, again) {
    if (!alive() || (err && err.name === 'AbortError')) return;
    const retry = button('Try again', { kind: 'primary', iconName: 'refresh', onClick: again });
    replace(body,
      h('p', { class: 'form-error', role: 'alert' }, (err && err.message) || 'The export did not work. Try again.'),
      h('p', { class: 'small muted' }, 'No file was saved.'),
      h('div', { class: 'dialog-actions' }, cancelButton('Close'), retry),
    );
    focus(retry);
  }

  // Step 1: the lists.
  async function look() {
    const status = h('p', { class: 'strong', role: 'status' }, 'Looking at what you have…');
    const cancel = cancelButton();
    replace(body,
      status,
      h('p', { class: 'small muted' }, 'No file is made yet. You see the size first.'),
      waitNote,
      h('div', { class: 'dialog-actions' }, cancel),
    );
    focus(cancel);
    working = true;
    try {
      const survey = await surveyExport({
        signal: controller.signal, onWait,
        onProgress: ({ part, done }) => { status.textContent = part === 'items' ? `${FOUND.items}…` : `${FOUND[part] || part}: ${done} found…`; },
      });
      working = false;
      if (alive()) ready(survey);
    } catch (err) { working = false; fail(err, look); }
  }

  // Step 2: the estimate and the choice.
  function ready(survey) {
    const c = survey.counts;
    const large = (lean) => survey.estimate[lean ? 'lean' : 'full'] > LARGE_EXPORT_BYTES;
    const size = h('dd', { class: 'mono', dataset: { export: 'estimate' } });
    const warn = h('div', null);
    const phone = !!(store.get('config') && store.get('config').features && store.get('config').features.phone);
    const big = phone ? 'attachments and voicemail' : 'attachments';
    const lean = checkbox(`Leave out ${big}`, { onChange: () => paintSize() });
    const start = button('Build the file', { kind: 'primary', onClick: () => build(survey, lean.checked) });
    function paintSize() {
      size.textContent = about(survey.estimate[lean.checked ? 'lean' : 'full']);
      replace(warn, large(lean.checked) ? callout('warn', 'This is a large export',
        h('p', null, `Your browser must hold ${about(survey.estimate[lean.checked ? 'lean' : 'full'])} in its memory. It can stop before the file is saved, and a phone can stop earlier.`),
        h('p', null, lean.checked ? 'Use a computer, and close other tabs first.' : `Leave out ${big} to make the file smaller, or use a computer and close other tabs first.`),
      ) : null);
    }
    paintSize();
    replace(body,
      h('dl', { class: 'kv' },
        h('dt', null, 'Mail'), h('dd', null, `${plural(c.mail, 'message')}, ${plural(c.attachments, 'attachment')}`),
        phone ? [h('dt', null, 'Texts'), h('dd', null, String(c.texts))] : null,
        phone ? [h('dt', null, 'Calls'), h('dd', null, c.voicemails ? `${c.calls}, ${c.voicemails} with voicemail` : String(c.calls))] : null,
        h('dt', null, 'Other'), h('dd', null, [plural(c.inboxes, 'inbox', 'inboxes'), plural(c.aliases, 'alias', 'aliases'), phone ? plural(c.numbers, 'number') : null, plural(c.identities, 'identity', 'identities')].filter(Boolean).join(', ')),
        h('dt', null, 'Estimated size'), size,
      ),
      warn,
      lean.el,
      h('p', { class: 'small muted' }, 'Your recovery key opens the file. Your browser encrypts the file. The server sees none of the plain contents.'),
      h('div', { class: 'dialog-actions' }, cancelButton(), start),
    );
    focus(start);
  }

  // Step 3: the file.
  async function build(survey, lean) {
    const bar = h('div', { class: 'progress-bar' });
    const progress = h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Building the file', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, bar);
    const status = h('p', { class: 'strong', role: 'status', dataset: { export: 'progress' } }, 'Starting…');
    const cancel = cancelButton();
    waitNote.hidden = true;
    replace(body,
      progress, status,
      h('p', { class: 'small muted' }, 'Keep this tab open. Your browser makes the file. Cancel stops it, and no file is saved.'),
      waitNote,
      h('div', { class: 'dialog-actions' }, cancel),
    );
    focus(cancel);
    const totals = { mail: survey.counts.mail, voicemail: lean ? 0 : survey.counts.voicemails };
    const done = { mail: 0, voicemail: 0 };
    working = true;
    try {
      const result = await buildExport(survey, {
        lean, signal: controller.signal, onWait,
        onProgress: ({ part, done: n, total }) => {
          if (part === 'file') { status.textContent = 'Writing the list of contents…'; return; }
          done[part] = n;
          status.textContent = `${PART[part]} ${n} of ${total}`;
          const all = totals.mail + totals.voicemail;
          const pct = all ? Math.round(((done.mail + done.voicemail) / all) * 100) : 100;
          bar.style.setProperty('width', `${pct}%`);
          progress.setAttribute('aria-valuenow', String(pct));
        },
      });
      working = false;
      if (!alive()) return;
      finished(result);
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      working = false;
      fail(err, () => build(survey, lean));
    }
  }

  // Step 4: the download.
  function finished(result) {
    const save = () => downloadBlob(result.blob, result.filename);
    save();
    const close = button('Close', { kind: 'primary', onClick: () => dlg.close() });
    const left = [
      result.skipped.mail ? plural(result.skipped.mail, 'message') : null,
      result.skipped.attachments ? plural(result.skipped.attachments, 'attachment') : null,
      result.skipped.voicemails ? plural(result.skipped.voicemails, 'voicemail') : null,
    ].filter(Boolean);
    replace(body,
      callout('ok', 'Your file is ready',
        h('p', { class: 'mono break', dataset: { export: 'filename' } }, result.filename),
        h('p', null, `${bytesText(result.blob.size)}. Look in the downloads of your browser.`),
      ),
      left.length ? callout('warn', 'Some things are not in the file', h('p', null, `${left.join(', ')} could not be read. The file says so when you open it.`)) : null,
      h('p', { class: 'read' }, 'Your recovery key opens this file. Keep the key and the file in two different places.'),
      h('div', { class: 'dialog-actions' },
        button('Save the file again', { iconName: 'download', onClick: save }),
        button('Open an export file', { onClick: () => { dlg.close(); navigate(VIEWER_PATH); } }),
        close,
      ),
    );
    focus(close);
    toast('Export file made', { kind: 'ok', timeout: 2600 });
  }

  look();
}
