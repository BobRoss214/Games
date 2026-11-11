// The part that "My stats" and "Who leaked me" share: one loader for the newest mail, and
// what the screen shows while it reads (progress in words, "Cancel"), after an error
// ("Try again"), after a stop, and after a finished read.
//
// The mail that was read stays in the memory of the open screen only. This file stores
// nothing and sends nothing: it asks for the mail list, as the Mail screen does.
import { h, replace } from '../../lib/dom.js';
import { store } from '../../lib/store.js';
import { listMessages } from '../../lib/mail.js';
import { dayText } from '../../lib/format.js';
import { button, loadError, skeletonRows } from '../../ui/components.js';
import { readNewestMail } from './work.js';

const two = (n) => String(n).padStart(2, '0');
// Unix seconds to the day on the clock of the person: "Nov 11, 2026".
export const day = (at) => { const d = new Date(at * 1000); return dayText(`${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`); };
// 1000 -> "1,000"
export const count = (n) => n.toLocaleString('en-US');
// "1 mail", "12 mails", "1,000 mails"
export const mails = (n) => `${count(n)} ${n === 1 ? 'mail' : 'mails'}`;

// "Counted from your newest 1,000 mails." or "Counted from all your 37 mails."
export function basisLine(result, verb) {
  if (!result.complete) return `${verb} from your newest ${count(result.read)} mails.`;
  return result.messages.length === 1 ? `${verb} from your 1 mail.` : `${verb} from all your ${count(result.messages.length)} mails.`;
}

// paint(result, state) gives the content after a finished read. It runs again when one of `keys` of the store changes.
// onDone(result) runs one time after each finished read. again: the words on the button that reads again.
// stopped: the words after "Cancel".
// Returns { el, start(), repaint(), againButton }. start() reads the mail again from the beginning.
// againButton does the same; the screen puts it in its header.
export function mailReport(scope, { paint, keys = ['aliases'], again = 'Count again', stopped = 'Stopped. Nothing was counted.', onDone = null }) {
  const el = h('div', { dataset: { report: 'idle' } });
  const againButton = button(again, { iconName: 'refresh', onClick: () => start() });
  let run = 0;       // each start gets a number; a read that ends late paints nothing
  let result = null;
  const set = (state, ...children) => { el.dataset.report = state; replace(el, ...children); };
  const show = () => {
    if (scope.disposed || !result) return;
    if (store.get('aliases') === null) set('reading', skeletonRows(4));
    else set('done', paint(result, store.get()));
  };
  scope.add(store.subscribe(keys, show));

  function stop() {
    run += 1;
    set('stopped', h('div', { class: 'sheet sheet-pad' }, h('p', { role: 'status' }, stopped)));
    againButton.focus();
  }

  function start() {
    run += 1;
    const mine = run;
    const live = () => mine === run && !scope.disposed;
    result = null;
    const status = h('p', { class: 'grow', role: 'status' }, 'Reading your mail…');
    set('reading', h('div', { class: 'sheet sheet-pad row row-wrap row-between' }, status, button('Cancel', { onClick: () => { if (live()) stop(); } })));
    readNewestMail(listMessages, {
      onProgress: (n) => { if (live()) status.textContent = `Reading your mail: ${mails(n)} so far.`; },
      stopped: () => !live(),
    }).then((res) => {
      if (!res || !live()) return;
      result = res;
      show();
      if (onDone) onDone(res);
    }).catch((err) => {
      if (!live()) return;
      const fromServer = err && typeof err.status === 'number';
      set('error', h('div', { class: 'sheet' }, loadError(fromServer ? err.message : '', start)));
      if (!fromServer) queueMicrotask(() => { throw err; }); // a fault of the app: show it in the console
    });
  }

  return { el, start, repaint: show, againButton };
}
