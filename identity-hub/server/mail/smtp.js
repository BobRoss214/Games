// SMTP server for incoming mail from the internet.
// It accepts mail for our own addresses only (no relay) and has no login.
import { SMTPServer } from 'smtp-server';
import { safeError } from './errors.js';
import { MIN_TLS_VERSION, chooseTlsFiles, fileStamp, readPair } from './tls.js';

const MAX_RECIPIENTS = 20;
const MAX_CLIENTS = 50;
const MAX_PER_ADDRESS = 10; // open connections from one IP address
const MAX_BAD_RECIPIENTS = 10; // per connection, slows down address guessing
const SOCKET_TIMEOUT_MS = 60_000;
const CLOSE_TIMEOUT_MS = 2_000;

// The text starts with the enhanced status code (RFC 3463). Nothing from the message goes in a reply.
const REPLIES = {
  unknown: [550, '5.1.1 This address does not exist'],
  blocked: [550, '5.7.1 The recipient does not accept mail from this sender'],
  suspended: [450, '4.2.1 This mailbox cannot receive mail now'],
  full: [452, '4.2.2 This mailbox is full'],
  tooLarge: [552, '5.3.4 The message is too large'],
  busy: [451, '4.3.0 Temporary problem. Try again later'],
  unreadable: [554, '5.6.0 The message could not be read'],
  tooManyBad: [421, '4.7.0 Too many unknown recipients'],
  tooManyConnections: [421, '4.7.0 Too many connections from your address'],
};

// The address of MAIL FROM. It is '' for a bounce, which has no sender.
const envelopeSender = (session) => (session.envelope.mailFrom && session.envelope.mailFrom.address) || '';

function smtpError(kind) {
  const [code, message] = REPLIES[kind] || REPLIES.busy;
  const err = new Error(message);
  err.responseCode = code;
  return err;
}

export function createSmtp(app, inbound) {
  const { config, log } = app;
  const maxBytes = config.mail.maxMessageBytes;
  // Messages are held in memory while they arrive. This limit covers all connections together.
  const memoryLimit = Math.max(maxBytes * 8, 64 * 1024 * 1024);
  let inMemory = 0;
  const badRecipients = new WeakMap(); // session -> count
  const countedRefusals = new WeakMap(); // envelope of one message -> address ids that were counted
  // Open connections for each sender IP address. In memory only, never logged.
  const perAddress = new Map();
  const counted = new WeakMap(); // session -> the address that was counted

  const options = {
    name: config.mail.hostname,
    banner: 'ready', // no software name and no version
    authOptional: true,
    disabledCommands: ['AUTH'],
    size: maxBytes,
    maxRecipients: MAX_RECIPIENTS,
    maxClients: MAX_CLIENTS,
    socketTimeout: SOCKET_TIMEOUT_MS,
    closeTimeout: CLOSE_TIMEOUT_MS,
    disableReverseLookup: true, // no DNS lookups of sender IP addresses
    logger: false,

    // One sender must not use all connections.
    onConnect(session, done) {
      const address = session.remoteAddress;
      const open = perAddress.get(address) || 0;
      if (open >= MAX_PER_ADDRESS) return done(smtpError('tooManyConnections'));
      perAddress.set(address, open + 1);
      counted.set(session, address);
      done();
    },
    onClose(session) {
      const address = counted.get(session);
      if (address === undefined) return;
      counted.delete(session);
      const open = (perAddress.get(address) || 1) - 1;
      if (open > 0) perAddress.set(address, open);
      else perAddress.delete(address);
    },

    onRcptTo(address, session, done) {
      let verdict;
      try {
        verdict = inbound.check(String(address.address || '').toLowerCase(), envelopeSender(session));
      } catch (err) {
        log.error('smtp recipient check failed', safeError(err));
        return done(smtpError('busy'));
      }
      if (verdict.ok) return done();
      // One refused message is counted one time for a recipient, also if the sender repeats the command.
      // The envelope object lives for one message.
      if (verdict.countable) {
        let seen = countedRefusals.get(session.envelope);
        if (!seen) { seen = new Set(); countedRefusals.set(session.envelope, seen); }
        if (!seen.has(verdict.addressId)) { seen.add(verdict.addressId); inbound.countRefusal(verdict); }
      }
      if (verdict.reason === 'unknown') {
        const n = (badRecipients.get(session) || 0) + 1;
        badRecipients.set(session, n);
        if (n > MAX_BAD_RECIPIENTS) return done(smtpError('tooManyBad'));
      }
      done(smtpError(verdict.reason));
    },

    onData(stream, session, done) {
      const chunks = [];
      let held = 0;
      let refused = null; // 'tooLarge' | 'busy'
      const release = () => { inMemory -= held; held = 0; chunks.length = 0; };
      const refuse = (kind) => { refused = kind; release(); };

      stream.on('data', (chunk) => {
        if (refused) return; // keep reading to the end, but keep nothing
        if (stream.sizeExceeded || held + chunk.length > maxBytes) return refuse('tooLarge');
        if (inMemory + chunk.length > memoryLimit) return refuse('busy');
        chunks.push(chunk);
        held += chunk.length;
        inMemory += chunk.length;
      });
      // The client went away in the middle of the message.
      stream.once('error', release);
      stream.once('end', async () => {
        if (stream.sizeExceeded) refuse('tooLarge');
        if (refused) return done(smtpError(refused));
        try {
          const to = session.envelope.rcptTo.map((r) => r.address);
          const result = await inbound.deliver({ from: envelopeSender(session), to, raw: Buffer.concat(chunks, held) });
          if (result.accepted.length > 0) return done(null, 'OK');
          // Every recipient was lost between RCPT and DATA. Answer with the reason of the first one.
          done(smtpError(result.reasons[result.rejected[0]]));
        } catch (err) {
          // A message that cannot be parsed is the problem of the sender: a final error and no log entry.
          if (err && err.code === 'EPARSE') return done(smtpError('unreadable'));
          log.error('incoming mail failed', safeError(err));
          done(smtpError('busy'));
        } finally {
          release();
        }
      });
    },
  };

  const server = new SMTPServer(options);
  // Socket errors of single connections are normal on the internet. They must not stop the process.
  server.on('error', (err) => log.debug('smtp connection error', { code: err && err.code }));

  // ---- TLS for STARTTLS (see tls.js) ----
  let tlsFiles = null;   // { source, keyFile, certFile }, or null for the certificate of the library
  let inUse = null;      // { key, cert } that the server shows now
  let loadedStamp = '';  // state of the files that are in use now
  let refusedStamp = ''; // state of files that could not be loaded, so that the log gets one line only

  // Runs before the server listens. The server never shows a certificate that it should not show.
  async function setUpTls() {
    const { tlsKeyFile, tlsCertFile } = config.mail;
    if (Boolean(tlsKeyFile) !== Boolean(tlsCertFile)) {
      log.warn('Only one of SMTP_TLS_KEY and SMTP_TLS_CERT is set. Both are needed. A self-signed certificate is used.');
    }
    tlsFiles = await chooseTlsFiles(app);
    if (!tlsFiles) {
      log.warn('SMTP uses the test certificate of the smtp-server package. Its private key is public, so TLS on the mail port '
        + 'does not protect the mail. To fix this, install the "openssl" program, or set SMTP_TLS_KEY and SMTP_TLS_CERT.');
      return;
    }
    loadedStamp = fileStamp(tlsFiles.keyFile, tlsFiles.certFile);
    const pair = readPair(tlsFiles.keyFile, tlsFiles.certFile);
    inUse = { key: pair.key, cert: pair.cert };
    server.updateSecureContext({ ...inUse, minVersion: MIN_TLS_VERSION });
  }

  // Loads the key and the certificate again if the files changed on disk (a renewed certificate).
  // No restart is needed. Returns true if a new certificate is in use now.
  function checkTls() {
    if (!tlsFiles) return false;
    let stamp;
    try {
      stamp = fileStamp(tlsFiles.keyFile, tlsFiles.certFile);
    } catch {
      return false; // a file is missing for a moment while it is replaced
    }
    if (stamp === loadedStamp || stamp === refusedStamp) return false;
    let pair;
    try {
      pair = readPair(tlsFiles.keyFile, tlsFiles.certFile);
    } catch {
      // For example: the new certificate is on disk and the new key is not yet. The old pair stays in use.
      refusedStamp = stamp;
      log.warn('The changed SMTP certificate files could not be loaded. The old certificate stays in use.');
      return false;
    }
    try {
      server.updateSecureContext({ key: pair.key, cert: pair.cert });
    } catch (err) {
      // readPair() checked the pair, so this is not expected. Put the old pair back: the server must not stay without one.
      server.updateSecureContext(inUse);
      refusedStamp = stamp;
      log.error('The SMTP certificate could not be changed', safeError(err));
      return false;
    }
    inUse = { key: pair.key, cert: pair.cert };
    loadedStamp = stamp;
    refusedStamp = '';
    log.info('The SMTP certificate was loaded again from disk.');
    return true;
  }

  return {
    async listen() {
      await setUpTls();
      return new Promise((resolve, reject) => {
        server.server.once('error', reject);
        server.listen(config.mail.smtpPort, config.mail.smtpHost, () => {
          server.server.removeListener('error', reject);
          resolve(server.server.address().port);
        });
      });
    },
    checkTls,
    // Which certificate is in use and the lowest TLS version, read back from the SMTP server object.
    tlsStatus: () => ({ source: tlsFiles ? tlsFiles.source : 'default', minVersion: server.options.minVersion || null }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
