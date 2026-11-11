// Development routes for the mock provider. They are registered only when
// config.dev is true and the provider is "mock".
import { need } from '../core/http.js';
import { E164 } from './common.js';

export function registerDevRoutes(app, ph) {
  const { db, http, keys } = app;
  const mock = ph.provider;
  const e164 = (v, name) => need.string(v, name, { max: 16, pattern: E164 });

  // The plain number of the request must be a number of this account.
  function ownPlain(c) {
    const num = ph.ownNumber(c.account.id, need.string(c.body.numberId, 'numberId', { max: 64 }));
    const number = e164(c.body.number, 'number');
    ph.matchPlain(num, number);
    return number;
  }

  http.post('/api/dev/inbound-text', { auth: true }, async (c) => {
    const to = ownPlain(c);
    await mock.simulateText({ to, from: e164(c.body.from, 'from'), body: need.string(c.body.body, 'body', { max: 1600 }) });
  });

  // A full call: forwarded and answered if forwarding is on, otherwise missed.
  // voicemail: true = nobody answers, and the caller leaves a message of `seconds` (a short
  // tone) if the number has voicemail on.
  http.post('/api/dev/inbound-call', { auth: true }, async (c) => {
    const to = ownPlain(c);
    const voicemail = need.optional(c.body.voicemail, need.bool, 'voicemail') === true;
    const seconds = need.optional(c.body.seconds, need.int, 'seconds', { min: 0, max: 86400 }) ?? (voicemail ? 5 : 30);
    await mock.simulateCall({ to, from: e164(c.body.from, 'from'), seconds, voicemail });
  });

  // What the mock provider "sent" for this account. The outbox is shared by all accounts,
  // so each entry is checked: its sender is a number of the account, or its
  // destination is a linked phone of the account.
  http.get('/api/dev/phone-outbox', { auth: true }, (c) => {
    const accountId = c.account.id;
    const isMine = (item) => Boolean(
      db.get('SELECT 1 AS x FROM numbers WHERE account_id = ? AND number_hmac = ?', accountId, keys.indexHmac('num', String(item.from)))
      || db.get('SELECT 1 AS x FROM phones WHERE account_id = ? AND number_hmac = ?', accountId, keys.indexHmac('phone', String(item.to))),
    );
    return {
      texts: mock.outbox.texts.filter(isMine).map((t) => ({ from: t.from, to: t.to, body: t.body, at: t.at })),
      // say: what a verification call spoke (it has the code). Only on such calls.
      calls: mock.outbox.calls.filter(isMine).map((k) => (k.say ? { from: k.from, to: k.to, at: k.at, say: k.say } : { from: k.from, to: k.to, at: k.at })),
    };
  });
}
