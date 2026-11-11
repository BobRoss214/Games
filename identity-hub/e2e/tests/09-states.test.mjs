// States that only time brings: a paused inbox and a paused number (the balance was too
// low at renewal). The test sets them in the database of its temporary server.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { signUp, signIn, seedAccount, assert } from '../lib.mjs';

export default async function (t) {
  const d = await t.open();
  const key = await signUp(d.page, t.base);
  const ids = await seedAccount(d.page);
  await d.close();
  const db = new DatabaseSync(join(t.server.dataDir, 'accounts.db'));
  db.prepare("UPDATE mailboxes SET status = 'suspended' WHERE id = ?").run(ids.personal);
  db.prepare("UPDATE numbers SET status = 'suspended' WHERE id = ?").run(ids.n1);
  db.close();

  for (const size of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const s = await t.open(size);
    const { page } = s;
    await signIn(page, t.base, key);
    await page.locator('.item-row').filter({ hasText: 'Paused' }).first().waitFor();
    await page.goto(t.base + '/mail/' + ids.personal);
    await page.getByText('This inbox is paused.').waitFor();
    await page.getByRole('button', { name: 'Write' }).first().click();
    const from = await page.getByRole('dialog').getByLabel('From').evaluate((el) => [...el.options].map((o) => o.textContent));
    assert(!from.some((o) => /anna\.reed/.test(o)), 'a paused inbox is offered as sender');
    await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
    await page.goto(t.base + '/numbers/' + ids.n1);
    await page.locator('.thread').first().click();
    await page.getByText('This number is paused.').waitFor();
    await page.getByText(/the number is released after/).first().waitFor();
    t.ok(`paused inbox and number are shown clearly (${size.width}px)`);
    await s.close();
  }
}
