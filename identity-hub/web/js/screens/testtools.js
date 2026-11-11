// Test tools. Only for servers in development mode with simulated providers.
// Simulate incoming mail, texts and calls, and look at the simulated outboxes.
import { h, replace } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { api } from '../lib/api.js';
import { phoneText, fullTime, cleanPhone } from '../lib/format.js';
import { button, field, selectField, checkbox, tabs, runBusy, emptyState, skeletonRows, loadError, callout } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { allAddresses } from '../lib/data.js';
import { b64u, utf8 } from '/shared/bytes.js';

const SAMPLE_HTML = (subject) => `<!doctype html><html><head><style>.box{font-family:Georgia,serif;max-width:520px;margin:auto;padding:24px;border:1px solid #ddd}h1{color:#1f5e4b;font-size:22px}</style></head>
<body><div class="box"><h1>${subject}</h1>
<p>Thank you for your order. This is a <b>test message</b> with HTML.</p>
<p><a href="https://example.com/orders/1042?utm_source=mail">See your order</a></p>
<p><img src="https://tracker.example.com/open.gif?id=123" width="1" height="1" alt=""><img src="https://example.com/banner.png" alt="Banner image" width="320" height="80"></p>
<script>document.body.textContent = 'A script ran. This must never show.'</script>
<p style="color:#666;font-size:12px">You get this mail because you are a customer.</p></div></body></html>`;

let open = null;

export function openTestTools(startTab = 'mail') {
  const config = store.get('config');
  if (!config || !config.dev) return;
  if (open) { open.select(startTab); return; }
  const f = config.features;

  // ---- incoming mail ----
  function mailTab() {
    const addresses = allAddresses();
    if (!addresses.length) return emptyState({ title: 'No address yet', text: 'Make an inbox first. Then you can simulate mail to it.', compact: true, figure: false });
    const to = selectField({ label: 'To (one of your addresses)', mono: true, options: addresses.map((a) => ({ value: a.address, label: `${a.address}${a.kind === 'alias' ? (a.enabled ? '  alias' : '  alias, off') : '  inbox'}` })), value: addresses[addresses.length - 1].address });
    const from = field({ label: 'From', mono: true, value: 'orders@shop.example' });
    const fromName = field({ label: 'Sender name', value: 'Maple Shop', optional: true });
    const subject = field({ label: 'Subject', value: 'Your order 1042 is on its way' });
    const text = field({ label: 'Text', rows: 3, value: 'Thank you for your order.\nSee your order: https://example.com/orders/1042\n\nMaple Shop' });
    const html = checkbox('Add an HTML part with a link, a remote image and a script', { checked: true });
    const att = checkbox('Add an attachment (receipt.txt)', { checked: true });
    const send = button('Simulate incoming mail', { kind: 'primary', type: 'submit' });
    return h('form', { class: 'stack', novalidate: true, onSubmit: (e) => {
      e.preventDefault();
      runBusy(send, async () => {
        const body = { to: to.value, from: from.value.trim() || undefined, fromName: fromName.value.trim(), subject: subject.value, text: text.value };
        if (html.checked) body.html = SAMPLE_HTML(subject.value.replace(/[<>&]/g, ''));
        if (att.checked) body.attachments = [{ filename: 'receipt.txt', contentType: 'text/plain', content: b64u(utf8(`Receipt 1042\r\nTotal: 12.40 USD\r\nMade ${new Date().toISOString()}\r\n`)) }];
        await api.post('/api/dev/inbound-mail', body);
        toast('Test mail delivered', { kind: 'ok' });
      });
    } }, to.el, h('div', { class: 'form-two' }, from.el, fromName.el), subject.el, text.el, html.el, att.el, h('div', { class: 'dialog-actions' }, send));
  }

  // ---- incoming text / call ----
  function phoneTab(kind) {
    if (!f.mockPhone) return emptyState({ title: 'Not available', text: 'The phone provider on this server is not the simulated one.', compact: true, figure: false });
    const numbers = store.get('numbers') || [];
    if (!numbers.length) return emptyState({ title: 'No number yet', text: 'Get a number first. Then you can simulate a text or a call to it.', compact: true, figure: false });
    const to = selectField({ label: 'To (one of your numbers)', mono: true, options: numbers.map((n) => ({ value: n.id, label: `${phoneText(n.number)}${n.label ? `  (${n.label})` : ''}` })), value: numbers[0].id });
    const from = field({ label: 'From', type: 'tel', mono: true, value: '+14155550142', hint: 'Start with + and the country code.' });
    const body = field({ label: 'Text', rows: 2, value: 'Hi, is the bike still for sale?' });
    const seconds = field({ label: 'Length in seconds', value: '45', inputmode: 'numeric', mono: true, hint: 'The call is answered only when call forwarding is on. If not, it is a missed call.' });
    const leaves = f.voicemail ? checkbox('The caller leaves a voicemail') : null; // only where the server has voicemail
    const send = button(kind === 'text' ? 'Simulate incoming text' : 'Simulate incoming call', { kind: 'primary', type: 'submit' });
    return h('form', { class: 'stack', novalidate: true, onSubmit: (e) => {
      e.preventDefault();
      const number = numbers.find((n) => n.id === to.value);
      const clean = cleanPhone(from.value);
      if (!clean) { from.setError('Enter the full number with + and the country code.'); return; }
      runBusy(send, async () => {
        if (kind === 'text') {
          await api.post('/api/dev/inbound-text', { numberId: number.id, number: number.number, from: clean, body: body.value });
          toast('Test text delivered', { kind: 'ok' });
        } else {
          const secs = Math.max(0, Math.min(86400, Number.parseInt(seconds.value, 10) || 0));
          await api.post('/api/dev/inbound-call', { numberId: number.id, number: number.number, from: clean, seconds: secs, ...(leaves && leaves.checked ? { voicemail: true } : {}) });
          toast('Test call done', { kind: 'ok' });
        }
      });
    } }, to.el, from.el, kind === 'text' ? body.el : seconds.el, kind === 'call' && leaves ? leaves.el : null, h('div', { class: 'dialog-actions' }, send));
  }

  // ---- outboxes ----
  function outboxTab() {
    const slot = h('div', { class: 'stack stack-5' }, skeletonRows(3));
    const load = async () => {
      replace(slot, skeletonRows(3));
      try {
        const [mail, phone] = await Promise.all([
          api.get('/api/dev/outbox').catch((err) => { if (err.status === 404) return { mail: null }; throw err; }),
          f.mockPhone ? api.get('/api/dev/phone-outbox').catch((err) => { if (err.status === 404) return { texts: null, calls: null }; throw err; }) : Promise.resolve({ texts: null, calls: null }),
        ]);
        const block = (title, rows, render, none) => h('section', { class: 'stack stack-2' },
          h('h3', { class: 'outbox-title' }, title),
          rows === null ? h('p', { class: 'small muted' }, 'Not available on this server.')
            : rows.length === 0 ? h('p', { class: 'small muted' }, none)
            : h('ul', { class: 'outbox-list' }, [...rows].reverse().map(render)),
        );
        replace(slot,
          h('div', { class: 'row row-between' }, h('p', { class: 'small muted' }, 'What the app sent to the outside. Nothing here left the server.'), button('Reload', { size: 'sm', iconName: 'refresh', onClick: load })),
          block('Texts', phone.texts, (t) => h('li', { class: 'outbox-item' },
            h('p', { class: 'mono small' }, `${phoneText(t.from)} to ${phoneText(t.to)}`),
            h('p', { class: 'outbox-body break' }, t.body),
            h('p', { class: 'tiny faint' }, fullTime(t.at)),
          ), 'No texts sent yet.'),
          block('Calls', phone.calls, (c) => h('li', { class: 'outbox-item' },
            h('p', { class: 'mono small' }, `${phoneText(c.from)} to ${phoneText(c.to)}`),
            c.say ? h('p', { class: 'outbox-body break' }, `The voice said: ${c.say}`) : null,
            h('p', { class: 'tiny faint' }, fullTime(c.at)),
          ), 'No calls made yet.'),
          block('Mail to the outside', mail.mail, (m) => h('li', { class: 'outbox-item' },
            h('p', { class: 'mono small break' }, `${m.from} to ${(m.to || []).join(', ')}`),
            h('p', { class: 'outbox-body break' }, m.subject || '(no subject)'),
            h('p', { class: 'tiny faint' }, fullTime(m.at)),
          ), 'No mail sent to the outside yet.'),
        );
      } catch (err) { replace(slot, loadError(err.message, load)); }
    };
    load();
    return slot;
  }

  const dlg = openDialog({
    title: 'Test tools', size: 'lg', cls: 'testtools',
    content: () => {
      const t = tabs({ label: 'Test tools', value: startTab, items: [
        { id: 'mail', label: 'Mail in', render: mailTab },
        f.phone ? { id: 'text', label: 'Text in', render: () => phoneTab('text') } : null,
        f.phone ? { id: 'call', label: 'Call in', render: () => phoneTab('call') } : null,
        { id: 'outbox', label: 'Outboxes', render: outboxTab },
      ].filter(Boolean) });
      open = t;
      return h('div', { class: 'stack' },
        callout('warn', 'Test mode', h('p', null, 'These tools exist only on a server with simulated providers. No real mail, text or call is made.')),
        t,
      );
    },
  });
  dlg.closed.then(() => { open = null; });
}
