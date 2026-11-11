// All settings come from environment variables. Every setting has a safe default
// so that `npm start` works on a development computer with no configuration.
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const int = (v, d) => (v === undefined || v === '' ? d : Number.parseInt(v, 10));
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));
const list = (v, d) => (v ? v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : d);

function loadSecret(env, dataDir) {
  if (env.SECRET_KEY) {
    const key = Buffer.from(env.SECRET_KEY, 'hex');
    if (key.length !== 32) throw new Error('SECRET_KEY must be 64 hex characters');
    return key;
  }
  const file = join(dataDir, 'secret.key');
  if (existsSync(file)) return Buffer.from(readFileSync(file, 'utf8').trim(), 'hex');
  const key = randomBytes(32);
  writeFileSync(file, key.toString('hex') + '\n', { mode: 0o600 });
  chmodSync(file, 0o600);
  return key;
}

export function loadConfig(env = process.env, overrides = {}) {
  const production = env.NODE_ENV === 'production';
  const dataDir = resolve(overrides.dataDir || env.DATA_DIR || './data');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const publicUrl = (env.PUBLIC_URL || 'http://localhost:8080').replace(/\/+$/, '');
  const url = new URL(publicUrl);

  const config = {
    appName: env.APP_NAME || 'Postern',
    production,
    dev: !production,
    publicUrl,
    origin: url.origin,
    rpId: url.hostname,
    secureCookies: url.protocol === 'https:',
    host: env.HOST || (production ? '0.0.0.0' : '127.0.0.1'),
    port: int(env.PORT, 8080),
    trustProxy: bool(env.TRUST_PROXY, production),
    dataDir,
    secretKey: null,
    signup: env.SIGNUP === 'closed' ? 'closed' : 'open',
    powBits: int(env.POW_BITS, 16),
    sessionDays: int(env.SESSION_DAYS, 30),
    graceDays: int(env.GRACE_DAYS, 7),
    logLevel: env.LOG_LEVEL || (production ? 'warn' : 'info'),
    rateLimits: bool(env.RATE_LIMITS, true),

    mail: {
      domains: list(env.MAIL_DOMAINS, ['postern.test']),
      hostname: env.MAIL_HOSTNAME || url.hostname,
      smtpHost: env.SMTP_HOST || (production ? '0.0.0.0' : '127.0.0.1'),
      smtpPort: int(env.SMTP_PORT, production ? 25 : 2525),
      tlsKeyFile: env.SMTP_TLS_KEY || '',
      tlsCertFile: env.SMTP_TLS_CERT || '',
      // Outgoing relay, for example smtp://user:pass@relay.example.com:587 . Empty = simulated outbox.
      relayUrl: env.SMTP_RELAY_URL || '',
      dkimSelector: env.DKIM_SELECTOR || '',
      dkimKeyFile: env.DKIM_KEY_FILE || '',
      maxMessageBytes: int(env.MAIL_MAX_BYTES, 15 * 1024 * 1024),
    },

    phone: {
      provider: env.PHONE_PROVIDER || (production ? 'off' : 'mock'), // mock | twilio | off
      countries: list(env.PHONE_COUNTRIES, ['us', 'ca']).map((c) => c.toUpperCase()),
      twilio: {
        accountSid: env.TWILIO_ACCOUNT_SID || '',
        authToken: env.TWILIO_AUTH_TOKEN || '',
        baseUrl: (env.TWILIO_BASE_URL || 'https://api.twilio.com').replace(/\/+$/, ''),
        // Optional. US numbers can send texts only from a Messaging Service with an approved 10DLC campaign.
        messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID || '',
        // Optional. Some countries need a regulatory bundle and an address to buy a number.
        bundleSid: env.TWILIO_BUNDLE_SID || '',
        addressSid: env.TWILIO_ADDRESS_SID || '',
      },
    },

    pay: {
      provider: env.PAY_PROVIDER || (production ? 'off' : 'mock'), // mock | btcpay | off
      unitCredits: 100, // one token = 100 credits = 1.00 USD
      minUnits: int(env.PAY_MIN_USD, 5),
      maxUnits: int(env.PAY_MAX_USD, 200),
      invoiceMinutes: int(env.PAY_INVOICE_MINUTES, 60),
      btcpay: {
        url: (env.BTCPAY_URL || '').replace(/\/+$/, ''),
        apiKey: env.BTCPAY_API_KEY || '',
        storeId: env.BTCPAY_STORE_ID || '',
        webhookSecret: env.BTCPAY_WEBHOOK_SECRET || '',
        methods: (env.BTCPAY_METHODS || 'BTC-LN,XMR-CHAIN,BTC-CHAIN').split(',').map((s) => s.trim()).filter(Boolean),
      },
    },

    // Prices in credits. 100 credits = 1.00 USD. Set a price to 0 to make the item free.
    prices: {
      mailboxMonth: int(env.PRICE_MAILBOX_MONTH, 100),
      numberMonth: int(env.PRICE_NUMBER_MONTH, 400),
      textOut: int(env.PRICE_TEXT_OUT, 3),
      callMinute: int(env.PRICE_CALL_MINUTE, 3),
    },

    limits: {
      mailboxes: int(env.LIMIT_MAILBOXES, 25),
      aliases: int(env.LIMIT_ALIASES, 0), // 0 = no limit
      numbers: int(env.LIMIT_NUMBERS, 25),
      phones: int(env.LIMIT_PHONES, 5),
      sendPerDay: int(env.LIMIT_SEND_PER_DAY, 100), // 0 = no limit
      mailboxBytes: int(env.LIMIT_MAILBOX_BYTES, 1024 * 1024 * 1024),
      requestsPerMinute: int(env.LIMIT_REQUESTS_PER_MINUTE, 900),
    },
  };

  deepAssign(config, overrides);
  config.dataDir = dataDir;
  config.secretKey = overrides.secretKey || loadSecret(env, dataDir);
  if (production && !config.secureCookies) throw new Error('PUBLIC_URL must start with https:// in production');
  return config;
}

function deepAssign(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v) && typeof target[k] === 'object' && target[k]) deepAssign(target[k], v);
    else target[k] = v;
  }
}
