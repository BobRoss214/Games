// Development routes. They are registered only when config.dev is true.
import { fail, need } from '../core/http.js';
import { parseAddress } from './address.js';
import { readMessageFields } from './compose.js';

export function registerDev(app, { data, inbound, compose, outbox }) {
  const { http, db, config } = app;
  const maxBytes = config.mail.maxMessageBytes;

  // Puts a message in a mailbox of this account, as if it came from the internet.
  http.post('/api/dev/inbound-mail', { auth: true, limit: Math.ceil(maxBytes * 1.5) }, async (c) => {
    const b = c.body;
    const to = parseAddress(need.string(b.to, 'to', { min: 3, max: 254 }));
    const own = to && db.get('SELECT 1 AS x FROM addresses WHERE account_id = ? AND address_hmac = ?', c.account.id, data.hmac(to.address));
    if (!own) throw fail(404, 'not_found', 'This address is not an address of your account.');
    const from = b.from === undefined || b.from === null ? parseAddress('sender@example.com') : parseAddress(need.string(b.from, 'from', { min: 3, max: 254 }));
    if (!from) throw fail(400, 'bad_request', 'The value "from" is not valid.');
    const fields = readMessageFields({ ...b, to: [to.address], cc: [], bcc: [] }, maxBytes);
    const raw = await compose({
      from: from.address, fromName: fields.fromName, to: [to.address], envelopeTo: [to.address],
      subject: fields.subject, text: fields.text, html: fields.html, attachments: fields.attachments, sign: false,
    });
    const result = await inbound.deliver({ from: from.address, to: [to.address], raw });
    if (result.accepted.length === 0) throw fail(409, 'conflict', 'This address cannot receive mail now.');
  });

  // The messages that this account "sent" to the outside while no relay is configured.
  http.get('/api/dev/outbox', { auth: true }, (c) => ({
    mail: outbox.filter((m) => m.accountId === c.account.id).map((m) => ({ from: m.from, to: m.to, subject: m.subject, at: m.at })),
  }));
}
