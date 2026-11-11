// Small helpers that the auth files share.
import { fail, b64u } from '../core/http.js';

// The account as the browser gets it. The passkey user handle stays on the server.
export const accountView = (a) => ({
  id: a.id,
  publicKey: b64u(a.publicKey),
  encPrivateKey: b64u(a.encPrivateKey),
  recoveryWrap: b64u(a.recoveryWrap),
  balance: a.balance,
  createdDay: a.createdDay,
});

// One error for every failed login. It must not show if the account or the passkey exists.
export const badLogin = () => fail(401, 'bad_login', 'Sign-in failed. Check your key, then try again.');

export const notFound = () => fail(404, 'not_found', 'Not found.');
