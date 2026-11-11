// Encrypted export: the "Download my data" section on Settings, and the page that opens
// an export file again (/open-export, also for people who are signed out).
//
// The browser builds one encrypted file (lib/exportfile.js). The recovery key opens it.
// The parts with the work load when the person asks for them:
//   export/dialog.js   the estimate, the progress and the download
//   export/collect.js  reads the data through the normal API and opens it in this browser
//   export/viewer.js   the page that reads a file. It asks the server for nothing.
import { h } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { registerRoute, registerSettingsSection, registerWelcomeLink } from '../lib/registry.js';
import { button, linkButton, runBusy } from '../ui/components.js';
import { LARGE_EXPORT_BYTES } from '../lib/exportfile.js';

export const VIEWER_PATH = '/open-export';
// What an export file never holds. The same words go into each file, so that the page that opens it can show them.
export const NEVER_INCLUDED = Object.freeze([
  'The numbers as working numbers. The file holds their digits and their labels. A number cannot be moved to a different account.',
  'Your credit. A balance cannot be moved.',
  'Passkeys, sessions and other sign-in data.',
]);
const megabytes = (bytes) => Math.round(bytes / 1024 / 1024);

registerRoute(VIEWER_PATH, () => import('./export/viewer.js'), { signedOut: true, title: 'Open an export file', nav: 'settings' });
// People without an account (or signed out) find the page on the start page.
registerWelcomeLink({ id: 'open-export', label: 'Open an export file', path: VIEWER_PATH, order: 60 });

function exportSection() {
  const config = store.get('config') || {};
  const app = config.appName || 'Postern';
  const phone = !!(config.features && config.features.phone);
  const list = (title, items) => h('div', { class: 'prose' }, h('h3', null, title), h('ul', null, items.filter(Boolean).map((t) => h('li', null, t))));
  // The id is for links to this part of Settings: /settings#download-my-data
  return h('div', { class: 'sheet sheet-pad stack', id: 'download-my-data', dataset: { export: 'section' } },
    h('div', { class: 'grid-2' },
      list('In the file', [
        'Your inboxes, aliases and numbers, with their labels and notes',
        'Your identities and the random identifiers',
        'All your mail, with attachments',
        phone ? 'The texts and the call history of each number, with voicemail' : null,
        phone ? 'Your linked real phones (label and number)' : null,
        'Blocked senders',
      ]),
      list('Not in the file', [...NEVER_INCLUDED]),
    ),
    h('dl', { class: 'kv kv-left' },
      h('dt', null, 'Opens with'),
      h('dd', null, `Your recovery key. It is the key that you saved when you made the account. Without it nobody can open the file, and ${app} cannot open it for you.`),
      h('dt', null, 'Use'),
      h('dd', null, 'A copy to read. You can open it in this app at any time, also when you are signed out. It cannot be loaded back into an account.'),
      h('dt', null, 'Size'),
      h('dd', null, `Your browser holds the whole file in its memory until it is saved. Up to about ${megabytes(LARGE_EXPORT_BYTES)} MB works on most computers. A larger file can fail, and a phone can fail earlier. You see the estimated size before the export starts, and you can leave out ${phone ? 'attachments and voicemail' : 'attachments'}.`),
    ),
    h('div', { class: 'row row-wrap' },
      button('Download my data', { kind: 'primary', iconName: 'download', onClick: (e, btn) => runBusy(btn, async () => {
        const { openExportDialog } = await import('./export/dialog.js');
        openExportDialog();
      }) }),
      linkButton('Open an export file', VIEWER_PATH, { iconName: 'file' }),
    ),
  );
}

registerSettingsSection({
  id: 'export',
  title: 'Download my data',
  lede: 'One encrypted file with a copy of your data. Your browser builds it. The server never sees the plain contents.',
  order: 60,
  render: exportSection,
});
