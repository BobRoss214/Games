// Blocked senders. A user blocks one sender address or a whole domain on one of the user's addresses.
// Mail from that sender to that address is refused; everything else keeps working.
// The blocked value is not stored in plain form: a keyed hash for matching, and a copy
// that only the browser of the account can open.
import { fail, reply, b64u } from '../core/http.js';
import { today } from '../core/db.js';
import { randomId } from '../core/keys.js';
import { blockValue } from './address.js';

const ID = /^[A-Za-z0-9_-]{22}$/;
const MAX_BLOCKS = 200; // for one address

const notFound = () => fail(404, 'not_found', 'Not found.');
const idParam = (v) => { if (typeof v !== 'string' || !ID.test(v)) throw notFound(); return v; };

export function registerBlocks(app, { data }) {
  const { http, db, store, config, events } = app;
  // The tests set a smaller limit. There is no setting for it in normal use.
  const limit = Number.isInteger(config.limits.addressBlocks) && config.limits.addressBlocks > 0 ? config.limits.addressBlocks : MAX_BLOCKS;

  const view = (r) => ({ id: r.id, sealed: b64u(r.sealed), createdDay: r.created_day });
  // An alias or the address of a mailbox, of this account.
  const getAddress = (c) => {
    const row = db.get('SELECT id, kind FROM addresses WHERE account_id = ? AND id = ?', c.account.id, idParam(c.params.id));
    if (!row) throw notFound();
    return row;
  };
  const findBlock = (addressId, hmac) => db.get('SELECT id, sealed, created_day FROM address_blocks WHERE address_id = ? AND value_hmac = ?', addressId, hmac);
  const count = (addressId) => db.get('SELECT COUNT(*) AS n FROM address_blocks WHERE address_id = ?', addressId).n;
  const full = () => fail(409, 'limit_reached', `An address can have ${limit} blocked senders. Remove one first.`);
  // The lists of mailboxes and aliases show the number of blocks.
  const changed = (c, address) => events.publish(c.account.id, address.kind === 'alias' ? 'aliases' : 'mailbox');

  http.get('/api/addresses/:id/blocks', { auth: true }, (c) => {
    const address = getAddress(c);
    return { blocks: db.all('SELECT id, sealed, created_day FROM address_blocks WHERE account_id = ? AND address_id = ? ORDER BY rowid', c.account.id, address.id).map(view) };
  });

  http.post('/api/addresses/:id/blocks', { auth: true, rate: { max: 60, per: 60 } }, async (c) => {
    const address = getAddress(c);
    const kind = c.body.kind;
    if (kind !== 'address' && kind !== 'domain') throw fail(400, 'bad_request', 'The value "kind" is not valid.');
    const value = blockValue(kind, c.body.value);
    const hmac = data.blockHmac(kind, value);

    const existing = findBlock(address.id, hmac);
    if (existing) return { block: view(existing) };
    if (count(address.id) >= limit) throw full();
    const sealed = await store.sealJsonFor(c.account.id, { kind, value }, 'block');
    const id = randomId();
    // The checks run again in the transaction: a second request can arrive while the value is sealed.
    const made = db.tx(() => {
      const again = findBlock(address.id, hmac);
      if (again) return { block: again, isNew: false };
      if (count(address.id) >= limit) throw full();
      db.run('INSERT INTO address_blocks (id, account_id, address_id, value_hmac, sealed, created_day) VALUES (?,?,?,?,?,?)',
        id, c.account.id, address.id, hmac, sealed, today());
      return { block: { id, sealed, created_day: today() }, isNew: true };
    });
    if (!made.isNew) return { block: view(made.block) };
    changed(c, address);
    return reply(201, { block: view(made.block) });
  });

  http.del('/api/addresses/:id/blocks/:blockId', { auth: true }, (c) => {
    const address = getAddress(c);
    const removed = db.run('DELETE FROM address_blocks WHERE account_id = ? AND address_id = ? AND id = ?', c.account.id, address.id, idParam(c.params.blockId)).changes;
    if (!removed) throw notFound();
    changed(c, address);
  });
}
