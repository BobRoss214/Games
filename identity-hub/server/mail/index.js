// Mail module: mailboxes, aliases, incoming SMTP, stored messages, and sending.
// Contract: docs/API.md section 4.
//
// Privacy rules of this module:
// - The database has no plain address. It has a keyed hash and a copy sealed to the account.
// - An incoming message is encrypted for the account before it is stored. The plain form
//   stays in memory for the time of the delivery and is never logged.
import { createMailData } from './data.js';
import { createInbound } from './inbound.js';
import { createSmtp } from './smtp.js';
import { createComposer } from './compose.js';
import { registerRoutes } from './routes.js';
import { registerBlocks } from './blocks.js';
import { createRetention } from './retention.js';
import { registerSend } from './send.js';
import { registerDev } from './dev.js';

const TLS_CHECK_SECONDS = 600;

export async function register(app) {
  const { db, config } = app;
  const data = createMailData(app);
  const inbound = createInbound(app, data);
  const compose = createComposer(app);
  const outbox = []; // simulated outbox, in memory, used when no relay is configured

  app.services.mail = {
    smtpPort: null,
    outbox,
    // Delivers a raw message to addresses on our own domains.
    async deliverLocal({ from, to, raw }) {
      if (!(raw instanceof Uint8Array) || !Array.isArray(to)) throw new TypeError('deliverLocal needs { to: [], raw: Buffer }');
      const result = await inbound.deliver({ from, to, raw });
      return { accepted: result.accepted, rejected: result.rejected };
    },
  };

  const parts = { data, inbound, compose, outbox };
  registerRoutes(app, parts);
  registerBlocks(app, parts);
  registerSend(app, parts);

  // Auto-delete of old mail for the mailboxes that have the setting, one time each hour.
  app.every('mail-retention', 3600, createRetention(app));
  if (config.dev) registerDev(app, parts);

  // Monthly renewal. A mailbox that is not paid is suspended: it stays readable,
  // but it gets no mail and cannot send. Mailboxes do not expire.
  app.renewables.register({
    kind: 'mailbox',
    price: () => config.prices.mailboxMonth,
    due: (now, accountId) => (accountId
      ? db.all('SELECT id, account_id AS accountId, paid_until AS paidUntil, status FROM mailboxes WHERE paid_until <= ? AND account_id = ?', now, accountId)
      : db.all('SELECT id, account_id AS accountId, paid_until AS paidUntil, status FROM mailboxes WHERE paid_until <= ?', now)),
    renew: (id, paidUntil) => { db.run("UPDATE mailboxes SET paid_until = ?, status = 'active' WHERE id = ?", paidUntil, id); },
    suspend: (id) => { db.run("UPDATE mailboxes SET status = 'suspended' WHERE id = ?", id); },
  });

  // The addresses of a deleted account must never be given out again.
  // This runs before the account row is deleted and the delete cascades.
  app.onAccountDelete((accountId) => {
    data.tombstone('account_id = ?', accountId);
    for (let i = outbox.length - 1; i >= 0; i--) if (outbox[i].accountId === accountId) outbox.splice(i, 1);
  });

  const smtp = createSmtp(app, inbound);
  let listening = false;
  let tlsTimer = null;
  app.onStart(async () => {
    app.services.mail.smtpPort = await smtp.listen();
    listening = true;
    // A renewed certificate is picked up without a restart. The check only compares file times.
    tlsTimer = setInterval(smtp.checkTls, TLS_CHECK_SECONDS * 1000);
    tlsTimer.unref();
  });
  app.onStop(async () => {
    clearInterval(tlsTimer);
    tlsTimer = null;
    if (listening) await smtp.close();
    listening = false;
  });
  // Also on demand, for example after a renewal script replaced the files.
  app.services.mail.checkTls = () => (listening ? smtp.checkTls() : false);
  app.services.mail.tlsStatus = () => smtp.tlsStatus();
}
