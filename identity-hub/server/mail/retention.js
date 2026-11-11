// Auto-delete of old mail. A mailbox can have a number of days: messages older than that are
// deleted by the server, because the browser of the user is not always open.
import { nowSec } from '../core/db.js';

const BATCH = 500;
const DAY = 86400;

export function createRetention(app) {
  const { db, events } = app;

  // Deletes the old messages of every mailbox that has the setting. Returns the number of deleted messages.
  // Incoming messages and Sent copies are deleted, with their parts. Suspended mailboxes are included.
  return async function runRetention(now = nowSec()) {
    let deleted = 0;
    const boxes = db.all('SELECT id, account_id AS accountId, retention_days AS days FROM mailboxes WHERE retention_days IS NOT NULL');
    for (const box of boxes) {
      const before = now - box.days * DAY;
      let removed = 0;
      for (;;) {
        // In batches, so that a large mailbox does not stop all other work for a long time.
        const n = db.run('DELETE FROM messages WHERE id IN (SELECT id FROM messages WHERE mailbox_id = ? AND at < ? LIMIT ?)', box.id, before, BATCH).changes;
        removed += n;
        if (n < BATCH) break;
        await new Promise((resolve) => { setImmediate(resolve); });
      }
      if (removed > 0) {
        deleted += removed;
        events.publish(box.accountId, 'mail', { mailboxId: box.id });
      }
    }
    if (deleted > 0) {
      // Deleted data must not stay in the write-ahead file.
      try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* a later checkpoint does it */ }
    }
    return deleted;
  };
}
