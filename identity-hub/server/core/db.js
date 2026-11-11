// Thin wrapper on the SQLite database that is built into Node.js. No native packages.
import { DatabaseSync } from 'node:sqlite';

export function openDb(file) {
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA synchronous = NORMAL');
  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec('PRAGMA busy_timeout = 5000');
  // Deleted rows are overwritten with zeros. Deleted data must not stay on the disk.
  raw.exec('PRAGMA secure_delete = ON');

  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = raw.prepare(sql); cache.set(sql, s); }
    return s;
  };
  let depth = 0;

  const db = {
    raw,
    exec: (sql) => raw.exec(sql),
    get: (sql, ...params) => stmt(sql).get(...params),
    all: (sql, ...params) => stmt(sql).all(...params),
    run: (sql, ...params) => stmt(sql).run(...params),
    // Runs fn in one transaction. fn must be synchronous. Nested calls join the outer transaction.
    tx(fn) {
      if (depth > 0) return fn();
      raw.exec('BEGIN IMMEDIATE');
      depth++;
      try {
        const out = fn();
        raw.exec('COMMIT');
        return out;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      } finally {
        depth--;
      }
    },
    close() { cache.clear(); raw.close(); },
  };
  return db;
}

export const nowSec = () => Math.floor(Date.now() / 1000);
// Dates with day precision only. The service does not keep exact creation times.
export const today = () => new Date().toISOString().slice(0, 10);
