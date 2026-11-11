// Monthly renewal of paid items (mailboxes, phone numbers).
// A module registers one "renewable" for each kind of item. The job charges the
// account when an item is due. If the balance is too low, the item is suspended.
// After the grace period, the optional expire() releases the item.
import { nowSec } from './db.js';

export const PERIOD_SECONDS = 30 * 86400;

export function createRenewables({ store, config, log, events }) {
  const list = [];
  return {
    PERIOD_SECONDS,
    // r = {
    //   kind: 'mailbox',                         ledger kind
    //   price: () => credits per 30 days,
    //   due: (now, accountId?) => [{ id, accountId, paidUntil, status }]  rows with paid_until <= now
    //   renew: (id, paidUntil) => void,          set paid_until and status 'active'
    //   suspend: (id) => void,                   set status 'suspended'
    //   expire: async (id, accountId) => void,   optional: release the item after the grace period
    // }
    register(r) { list.push(r); },
    // Runs for all accounts, or for one account (for example after a top-up).
    async run(accountId) {
      const now = nowSec();
      for (const r of list) {
        for (const row of r.due(now, accountId)) {
          try {
            const price = r.price();
            if (store.canAfford(row.accountId, price)) {
              store.charge(row.accountId, price, r.kind);
              r.renew(row.id, now + PERIOD_SECONDS);
              if (row.status !== 'active') events.publish(row.accountId, r.kind);
              if (price > 0) events.publish(row.accountId, 'balance');
            } else if (row.status === 'active') {
              r.suspend(row.id);
              events.publish(row.accountId, r.kind);
            } else if (r.expire && now > row.paidUntil + config.graceDays * 86400) {
              await r.expire(row.id, row.accountId);
              events.publish(row.accountId, r.kind);
            }
          } catch (err) {
            log.error(`renewal of ${r.kind} failed`, err);
          }
        }
      }
    },
  };
}
