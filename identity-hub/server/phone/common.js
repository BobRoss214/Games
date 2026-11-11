// Small values that the files of the phone module share.

// Phone numbers in the API are E.164.
export const E164 = /^\+[1-9]\d{6,14}$/;

// Deletes texts of one number: one text (textId), or all texts older than a time (before).
// A send that still waits for its delivery status must not point at a text that is gone.
// The send itself stays: if the provider reports later that the text failed, the charge
// still comes back, one time. Returns the count of deleted texts.
export function deleteTextRows(db, accountId, numberId, { textId, before }) {
  const which = textId !== undefined ? 'id = ?' : 'at < ?';
  const value = textId !== undefined ? textId : before;
  return db.tx(() => {
    db.run(`UPDATE text_sends SET text_id = NULL WHERE account_id = ? AND text_id IN (SELECT id FROM texts WHERE account_id = ? AND number_id = ? AND ${which})`,
      accountId, accountId, numberId, value);
    return db.run(`DELETE FROM texts WHERE account_id = ? AND number_id = ? AND ${which}`, accountId, numberId, value).changes;
  });
}

// Deletes the row of a number. Its texts and calls go with it. This is the one way a number
// leaves an account: the routes use it, and so does the operator tool of "own phone".
export function deleteNumberRows(db, accountId, numberId) {
  db.tx(() => {
    deleteTextRows(db, accountId, numberId, { before: Number.MAX_SAFE_INTEGER });
    db.run('DELETE FROM numbers WHERE id = ? AND account_id = ?', numberId, accountId);
  });
}
