// Builds the application from its modules. Tests use createApp() with overrides.
import { join } from 'node:path';
import { loadConfig } from './core/config.js';
import { createLog } from './core/log.js';
import { openDb } from './core/db.js';
import { createKeys } from './core/keys.js';
import { createStore } from './core/store.js';
import { createEvents } from './core/events.js';
import { createHttp, fail, HANDLED } from './core/http.js';
import * as auth from './auth/index.js';
import * as mail from './mail/index.js';
import * as phone from './phone/index.js';
import * as pay from './pay/index.js';
import { createRenewables } from './core/renew.js';

export async function createApp(overrides = {}, env = process.env) {
  const config = loadConfig(env, overrides);
  const log = createLog(config);
  // Two database files. The payment database has no account identifiers.
  const db = openDb(join(config.dataDir, 'accounts.db'));
  const paydb = openDb(join(config.dataDir, 'payments.db'));
  const keys = createKeys(config.secretKey);
  const store = createStore({ db, config });
  const events = createEvents();
  const http = createHttp({ config, store, log });

  const startHooks = [];
  const stopHooks = [];
  const deleteHooks = [];
  const jobs = [];
  const timers = [];

  const app = {
    config, log, db, paydb, keys, store, events, http,
    services: {}, // modules put their service objects here: app.services.mail, .phone, .pay
    renewables: null, // monthly renewal engine, see core/renew.js
    onStart: (fn) => startHooks.push(fn),
    onStop: (fn) => stopHooks.push(fn),
    // fn(accountId) runs before an account is deleted. Use it to release provider resources.
    onAccountDelete: (fn) => deleteHooks.push(fn),
    // Registers a repeating job. Tests call app.runJobs() and do not wait for timers.
    every: (name, seconds, fn) => jobs.push({ name, seconds, fn }),
    async runJobs(only) {
      for (const job of jobs) if (!only || job.name === only) await job.fn();
    },
    async deleteAccount(accountId) {
      for (const fn of deleteHooks) {
        try { await fn(accountId); } catch (err) { log.error('account delete hook failed', err); }
      }
      events.closeAccount(accountId);
      store.deleteAccount(accountId);
    },
    port: null,
    url: null,
    async start() {
      app.port = await http.listen();
      app.url = `http://127.0.0.1:${app.port}`;
      for (const fn of startHooks) await fn();
      for (const job of jobs) {
        const t = setInterval(() => job.fn().catch((err) => log.error(`job ${job.name} failed`, err)), job.seconds * 1000);
        t.unref();
        timers.push(t);
      }
      const paid = Object.entries(config.prices).filter(([, v]) => v > 0).map(([k]) => k);
      if (config.pay.provider === 'off' && paid.length) {
        log.warn(`Payments are off but these items have a price: ${paid.join(', ')}. Nobody can add funds. Set the prices to 0 or turn payments on.`);
      }
      log.info(`${config.appName} is ready at ${config.publicUrl} (port ${app.port})`);
      return app;
    },
    async stop() {
      for (const t of timers) clearInterval(t);
      for (const fn of stopHooks.reverse()) {
        try { await fn(); } catch (err) { log.error('stop hook failed', err); }
      }
      events.stop();
      await http.close();
      db.close();
      paydb.close();
    },
  };

  // Public settings for the web app. No secrets here.
  http.get('/api/config', () => ({
    appName: config.appName,
    dev: config.dev,
    signup: config.signup,
    powBits: config.powBits,
    mailDomains: config.mail.domains,
    features: {
      phone: config.phone.provider !== 'off',
      pay: config.pay.provider !== 'off',
      mockPhone: config.phone.provider === 'mock',
      mockPay: config.pay.provider === 'mock',
      mockMail: !config.mail.relayUrl,
    },
    phoneCountries: config.phone.countries,
    prices: config.prices,
    limits: { mailboxes: config.limits.mailboxes, aliases: config.limits.aliases, numbers: config.limits.numbers, phones: config.limits.phones, sendPerDay: config.limits.sendPerDay, maxMessageBytes: config.mail.maxMessageBytes },
  }));

  // Live change notices for the signed-in account.
  http.get('/api/events', { auth: true }, (c) => {
    if (!events.subscribe(c.account.id, c.req, c.res)) throw fail(429, 'too_many_streams', 'Too many open tabs.');
    return HANDLED;
  });

  app.renewables = createRenewables({ store, config, log, events });
  app.every('renew', 3600, () => app.renewables.run());
  app.every('purge-sessions', 3600, async () => store.purgeExpiredSessions());

  for (const mod of [auth, mail, phone, pay]) await mod.register(app);
  return app;
}
