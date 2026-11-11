// A server that takes no new accounts says so on the first screen and on the direct link.
import { assert } from '../lib.mjs';

export const server = { SIGNUP: 'closed' };

export default async function (t) {
  const s = await t.open();
  const { page } = s;
  await page.goto(t.base + '/');
  await page.getByText('New accounts are closed on this server.').waitFor();
  assert(await page.getByRole('button', { name: 'Create account' }).isDisabled(), '"Create account" is not disabled');
  t.ok('the first screen says that new accounts are closed');
  await page.goto(t.base + '/create');
  await page.getByRole('heading', { name: 'New accounts are closed' }).waitFor();
  assert((await page.getByRole('button', { name: 'Make my account' }).count()) === 0, 'the create screen still offers to make an account');
  t.ok('the create screen says it too');
}
