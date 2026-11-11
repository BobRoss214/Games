// "Own phone": the fixed pool of phones and SIM cards (docs/API.md section 5, "Own phone").
//
// A phone is an Android phone with the app "SMS Gateway for Android". Each SIM in it is
// one number. The operator adds phones and SIMs with server/tools/ownphone.js. Accounts
// get a number from the pool with "Get a number" and give it back when they release it.
//
// Privacy rules of these two tables:
// - The server must read a pool number: it hands the number out and sends from it. So
//   the number is stored with server encryption (keys.srvEncrypt), never in plain form.
//   For lookups there is number_hmac, the same value as numbers.number_hmac.
// - The login and the password of the gateway, the signing key and the label are stored
//   with server encryption too. The webhook token is stored as a keyed hash only.
// - There is no account here. Which account holds a number is in the table "numbers".
//
// Nothing is cached in memory: the server and the operator tool are two processes on one
// database file, and each must see at once what the other one wrote.
import { nowSec, today } from '../core/db.js';
import { randomId, randomToken } from '../core/keys.js';
import { E164 } from './common.js';

const TABLES = `
CREATE TABLE IF NOT EXISTS own_devices (
  id TEXT PRIMARY KEY,
  label BLOB NOT NULL,                -- keys.srvEncrypt(label, 'own-label')
  login BLOB NOT NULL,                -- keys.srvEncrypt(API login of the phone, 'own-login')
  password BLOB NOT NULL,             -- keys.srvEncrypt(API password of the phone, 'own-password')
  gateway_id TEXT NOT NULL,           -- the id of the phone at the gateway (random letters)
  hook_hash BLOB NOT NULL UNIQUE,     -- keys.indexHmac('own-hook', webhook token)
  signing_key BLOB NOT NULL,          -- keys.srvEncrypt(webhook signing key, 'own-sign')
  last_seen INTEGER,                  -- time of the last valid webhook of this phone; NULL = never
  online INTEGER NOT NULL DEFAULT 0,  -- what the accounts were told last (see the job "ownphone-online")
  created_day TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS own_sims (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES own_devices(id) ON DELETE CASCADE,
  sim_number INTEGER NOT NULL CHECK (sim_number BETWEEN 1 AND 3),
  number_hmac BLOB NOT NULL UNIQUE,   -- keys.indexHmac('num', number)
  number_srv BLOB NOT NULL,           -- keys.srvEncrypt(number, 'pool')
  country TEXT NOT NULL,
  UNIQUE (device_id, sim_number)
) STRICT;
CREATE INDEX IF NOT EXISTS own_sims_device ON own_sims(device_id);
`;

// Calling codes for the country of a SIM, longest first. "+1" is the United States unless the operator says CA.
const CALLING_CODES = [
  ['353', 'IE'], ['351', 'PT'], ['358', 'FI'], ['420', 'CZ'],
  ['31', 'NL'], ['32', 'BE'], ['33', 'FR'], ['34', 'ES'], ['39', 'IT'], ['41', 'CH'], ['43', 'AT'], ['44', 'GB'], ['45', 'DK'],
  ['46', 'SE'], ['47', 'NO'], ['48', 'PL'], ['49', 'DE'], ['61', 'AU'], ['64', 'NZ'],
  ['1', 'US'],
];
export function countryOfNumber(number) {
  const digits = String(number).slice(1);
  const hit = CALLING_CODES.find(([code]) => digits.startsWith(code));
  return hit ? hit[1] : '';
}

export function createPool({ db, keys, config }) {
  db.exec(TABLES);
  const offlineSeconds = () => Math.max(1, config.phone.ownphone.offlineMinutes) * 60;
  const plain = (blob, aad) => keys.srvDecrypt(blob, aad).toString('utf8');
  const hmacOf = (number) => keys.indexHmac('num', number);
  const hookHash = (token) => keys.indexHmac('own-hook', token);
  const isOnline = (lastSeen, now = nowSec()) => Number.isInteger(lastSeen) && lastSeen > now - offlineSeconds();

  const simView = (r) => ({ id: r.id, deviceId: r.device_id, simNumber: r.sim_number, country: r.country, number: plain(r.number_srv, 'pool'), inUse: r.held === 1 });
  const SIM_COLS = 's.*, EXISTS (SELECT 1 FROM numbers n WHERE n.number_hmac = s.number_hmac) AS held';

  const pool = {
    isOnline,
    offlineSeconds,

    // ---- devices ----
    // The fields that the server needs to talk to the gateway for one phone.
    device(id) {
      const r = db.get('SELECT * FROM own_devices WHERE id = ?', id);
      return r ? pool.open(r) : null;
    },
    open(r) {
      return {
        id: r.id, label: plain(r.label, 'own-label'), login: plain(r.login, 'own-login'), password: plain(r.password, 'own-password'),
        gatewayId: r.gateway_id, signingKey: plain(r.signing_key, 'own-sign'), lastSeen: r.last_seen ?? null, online: isOnline(r.last_seen), createdDay: r.created_day,
      };
    },
    devices() {
      return db.all('SELECT * FROM own_devices ORDER BY rowid').map(pool.open);
    },
    // The phone that a webhook token belongs to, or null.
    deviceByToken(token) {
      if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
      const r = db.get('SELECT * FROM own_devices WHERE hook_hash = ?', hookHash(token));
      return r ? pool.open(r) : null;
    },
    deviceByLabel(label) {
      const want = String(label || '').trim().toLowerCase();
      return pool.devices().filter((d) => d.label.trim().toLowerCase() === want);
    },
    // Returns { id, token }: the token is shown one time (it is in the webhook address) and never stored.
    addDevice({ label, login, password, gatewayId, signingKey }) {
      const id = randomId();
      const token = randomToken();
      db.run('INSERT INTO own_devices (id, label, login, password, gateway_id, hook_hash, signing_key, created_day) VALUES (?,?,?,?,?,?,?,?)',
        id, keys.srvEncrypt(label, 'own-label'), keys.srvEncrypt(login, 'own-login'), keys.srvEncrypt(password, 'own-password'),
        gatewayId, hookHash(token), keys.srvEncrypt(signingKey, 'own-sign'), today());
      return { id, token };
    },
    removeDevice(id) {
      db.run('DELETE FROM own_devices WHERE id = ?', id);
    },
    // A valid webhook came from this phone. Returns true if the phone was offline before.
    seen(id, now = nowSec()) {
      const r = db.get('SELECT online FROM own_devices WHERE id = ?', id);
      if (!r) return false;
      db.run('UPDATE own_devices SET last_seen = ?, online = 1 WHERE id = ?', now, id);
      return r.online !== 1;
    },
    // Phones whose stored state is not what the clock says any more: [{ id, online }]. The new state is stored.
    changedStates(now = nowSec()) {
      const out = [];
      for (const r of db.all('SELECT id, last_seen, online FROM own_devices')) {
        const online = isOnline(r.last_seen, now);
        if ((r.online === 1) === online) continue;
        db.run('UPDATE own_devices SET online = ? WHERE id = ?', online ? 1 : 0, r.id);
        out.push({ id: r.id, online });
      }
      return out;
    },

    // ---- SIM cards ----
    sims(deviceId) {
      return db.all(`SELECT ${SIM_COLS} FROM own_sims s WHERE s.device_id = ? ORDER BY s.sim_number`, deviceId).map(simView);
    },
    sim(deviceId, simNumber) {
      const r = Number.isInteger(simNumber) ? db.get(`SELECT ${SIM_COLS} FROM own_sims s WHERE s.device_id = ? AND s.sim_number = ?`, deviceId, simNumber) : null;
      return r ? simView(r) : null;
    },
    // The SIM of a plain number, or null. number must be in the form +15551234567.
    simByNumber(number) {
      if (typeof number !== 'string' || !E164.test(number)) return null;
      const r = db.get(`SELECT ${SIM_COLS} FROM own_sims s WHERE s.number_hmac = ?`, hmacOf(number));
      return r ? simView(r) : null;
    },
    // Numbers that no account holds, oldest first.
    freeSims({ country, limit = 20 } = {}) {
      const rows = country
        ? db.all(`SELECT ${SIM_COLS} FROM own_sims s WHERE s.country = ? AND NOT EXISTS (SELECT 1 FROM numbers n WHERE n.number_hmac = s.number_hmac) ORDER BY s.rowid LIMIT ?`, country, limit)
        : db.all(`SELECT ${SIM_COLS} FROM own_sims s WHERE NOT EXISTS (SELECT 1 FROM numbers n WHERE n.number_hmac = s.number_hmac) ORDER BY s.rowid LIMIT ?`, limit);
      return rows.map(simView);
    },
    addSim({ deviceId, simNumber, number, country }) {
      const id = randomId();
      db.run('INSERT INTO own_sims (id, device_id, sim_number, number_hmac, number_srv, country) VALUES (?,?,?,?,?,?)',
        id, deviceId, simNumber, hmacOf(number), keys.srvEncrypt(number, 'pool'), country);
      return id;
    },
    removeSim(id) {
      db.run('DELETE FROM own_sims WHERE id = ?', id);
    },
    // The number rows (of accounts) that hold a number of this phone, or of one SIM of it.
    heldNumbers({ deviceId, simId }) {
      return simId
        ? db.all('SELECT n.id, n.account_id FROM numbers n JOIN own_sims s ON s.number_hmac = n.number_hmac WHERE s.id = ?', simId)
        : db.all('SELECT n.id, n.account_id FROM numbers n JOIN own_sims s ON s.number_hmac = n.number_hmac WHERE s.device_id = ?', deviceId);
    },
    // For the number object of an account: is the phone of this number online?
    // Returns { online, lastSeen } or null if the number is not in the pool (any more).
    gatewayOf(numberHmac) {
      const r = db.get('SELECT d.last_seen FROM own_sims s JOIN own_devices d ON d.id = s.device_id WHERE s.number_hmac = ?', numberHmac);
      return r ? { online: isOnline(r.last_seen), lastSeen: r.last_seen ?? null } : null;
    },
  };
  return pool;
}
