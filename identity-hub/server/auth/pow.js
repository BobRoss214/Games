// Proof of work for sign-up.
// The challenge is stateless: the server signs "expiry.random" and does not store it.
// The server stores a challenge only after it was used, until it expires.
import { randomBytes } from 'node:crypto';
import { verifyPow } from '../../shared/pow.js';
import { nowSec } from '../core/db.js';
import { safeEqual } from '../core/keys.js';
import { fail } from '../core/http.js';
import { createTtlMap } from './ttl-map.js';

export const POW_TTL_SECONDS = 600;
const MAX_USED = 200_000;

export function createPow({ keys, config }) {
  // A used challenge stays here for the full lifetime of a challenge. This is long enough,
  // because a challenge that is older than that fails the expiry check.
  const used = createTtlMap({ ttlMs: POW_TTL_SECONDS * 1000, max: MAX_USED });

  return {
    issue() {
      const payload = `${nowSec() + POW_TTL_SECONDS}.${randomBytes(16).toString('base64url')}`;
      return { challenge: `${payload}.${keys.sign('pow', payload)}`, bits: config.powBits };
    },

    // Returns true one time for each valid, solved challenge.
    async redeem(challenge, nonce) {
      if (typeof challenge !== 'string' || challenge.length > 128 || typeof nonce !== 'string' || nonce.length < 1 || nonce.length > 32) return false;
      const parts = challenge.split('.');
      if (parts.length !== 3 || !/^\d{1,12}$/.test(parts[0])) return false;
      if (!safeEqual(keys.sign('pow', `${parts[0]}.${parts[1]}`), parts[2])) return false;
      if (Number(parts[0]) <= nowSec()) return false;
      if (used.has(challenge)) return false;
      if (!(await verifyPow(challenge, nonce, config.powBits))) return false;
      // No "await" between this check and the write. Two requests with the same challenge cannot both pass.
      if (used.has(challenge)) return false;
      if (!used.set(challenge, true, { evict: false })) {
        // The list is full. Refuse, because to drop an entry would allow a second use.
        throw fail(503, 'busy', 'The server is busy. Try again in a few minutes.');
      }
      return true;
    },

    prune: () => used.prune(),
  };
}
