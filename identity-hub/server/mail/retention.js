// Auto-delete of old mail. A mailbox can have a number of days: messages older than that are
// deleted by the server, because the browser of the user is not always open.
import { nowSec } from '../core/db.js';

const DAY = 86400;

export function createRetention(app, data) {
  const { db, events } = app;

  // Deletes the old messages of every mailbox that has the setting. Returns the number of deleted messages.
  // Incoming messages and Sent copies are deleted, with their parts. Suspended mailboxes are included.
  return async function runRetention(now = nowSec()) {
    let deleted = 0;
    const boxes = db.all('SELECT id, account_id AS accountId, retention_days AS days FROM mailboxes WHERE retention_days IS NOT NULL');
    for (const box of boxes) {
      const removed = await data.deleteMessages('mailbox_id = ? AND at < ?', box.id, now - box.days * DAY);
      if (removed > 0) {
        deleted += removed;
        events.publish(box.accountId, 'mail', { mailboxId: box.id });
      }
    }
    if (deleted > 0) data.checkpoint();
    return deleted;
  };
}
