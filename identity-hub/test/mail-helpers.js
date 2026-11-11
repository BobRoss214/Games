// Helpers for the mail tests.
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { createHash, createVerify } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import nodemailer from 'nodemailer';
import * as C from '../shared/crypto.js';
import { utf8 } from '../shared/bytes.js';
import { b64u, unb64u } from './helpers.js';

export const errorCode = (res) => res.data && res.data.error && res.data.error.code;

export async function newMailbox(account, body = {}) {
  const res = await account.api.post('/api/mailboxes', body);
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data; // { mailbox, address }
}

export async function newAlias(account, mailboxId, body = {}) {
  const res = await account.api.post('/api/aliases', { mailboxId, ...body });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data; // { alias, address }
}

export async function listMessages(account, query = '') {
  const res = await account.api.get(`/api/messages${query}`);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return res.data;
}

// Sends a message to the SMTP port of the app, like a mail server on the internet.
// Resolves with the nodemailer result, or rejects with the SMTP error (err.responseCode).
export async function smtpSend(app, mail, options = { ignoreTLS: true }) {
  const transport = nodemailer.createTransport({
    host: '127.0.0.1', port: app.services.mail.smtpPort, secure: false, name: 'mx.sender.example', ...options,
  });
  try {
    return await transport.sendMail({ from: 'Sender <sender@elsewhere.example>', ...mail });
  } finally {
    transport.close();
  }
}

// Opens a stored message with the keys of the account, as the browser does.
export async function openMessage(account, id) {
  const res = await account.api.get(`/api/messages/${id}`);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const message = res.data.message;
  const key = await C.openContentKey(account.keys, unb64u(message.sealedKey));
  const meta = await C.openMeta(key, unb64u(message.encMeta));
  const body = await C.openBody(key, unb64u(message.body));
  const attachment = async (index) => {
    const part = await account.api.get(`/api/messages/${id}/parts/${index}`);
    assert.equal(part.status, 200);
    assert.equal(part.headers.get('content-type'), 'application/octet-stream');
    return Buffer.from(await C.openAttachment(key, new Uint8Array(part.data), index));
  };
  return { message, key, meta, body, attachment };
}

// The Sent copy as the browser makes it: sealed to the public key of the own account.
export async function makeCopy(account, { meta, body, attachments = [] }) {
  const env = await C.sealEnvelope(account.keys.publicKey, { meta, body, attachments });
  return { sealedKey: b64u(env.sealedKey), encMeta: b64u(env.encMeta), parts: env.parts.map((p) => b64u(p)) };
}

// All bytes of the account database on disk, with the write-ahead log.
export function databaseBytes(app) {
  const file = join(app.config.dataDir, 'accounts.db');
  const parts = [readFileSync(file)];
  for (const suffix of ['-wal', '-shm']) if (existsSync(file + suffix)) parts.push(readFileSync(file + suffix));
  return Buffer.concat(parts);
}

// True if the text is in the database files, as UTF-8 or as UTF-16.
export function databaseHas(app, text) {
  const bytes = databaseBytes(app);
  return bytes.includes(Buffer.from(utf8(text))) || bytes.includes(Buffer.from(text, 'utf16le'));
}

// A raw SMTP conversation: sends each line and collects the replies. For checks that a mail library hides.
export function smtpTalk(app, lines) {
  return new Promise((resolve, reject) => {
    const socket = connect(app.services.mail.smtpPort, '127.0.0.1');
    const replies = [];
    let buffer = '';
    let next = 0;
    const finish = () => { socket.destroy(); resolve(replies); };
    socket.setEncoding('utf8');
    socket.setTimeout(5000, () => { socket.destroy(); reject(new Error('smtp test timeout')); });
    socket.on('error', reject);
    socket.on('close', () => resolve(replies));
    socket.on('data', (chunk) => {
      buffer += chunk;
      // A reply ends with a line that has a space after the code ("250 OK"), not a dash ("250-SIZE").
      for (;;) {
        const match = /^(?:\d{3}-.*\r\n)*\d{3} .*\r\n/.exec(buffer);
        if (!match) return;
        replies.push(match[0].trimEnd());
        buffer = buffer.slice(match[0].length);
        if (next >= lines.length) return finish();
        socket.write(lines[next++] + '\r\n');
      }
    });
  });
}

// Upgrades a plain SMTP connection with STARTTLS and returns the certificate that the server shows.
export function smtpCertificate(app) {
  return new Promise((resolve, reject) => {
    const socket = connect(app.services.mail.smtpPort, '127.0.0.1');
    let step = 0;
    let buffer = '';
    socket.setTimeout(5000, () => { socket.destroy(); reject(new Error('smtp test timeout')); });
    socket.on('error', reject);
    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1');
      // Wait for the last line of a reply: a code with a space after it.
      const lines = buffer.split('\r\n');
      if (lines.pop() !== '' || !/^\d{3} /.test(lines[lines.length - 1] || '')) return;
      const reply = buffer;
      buffer = '';
      if (step === 0) { step = 1; socket.write('EHLO mx.sender.example\r\n'); return; }
      if (step === 1) {
        if (!/STARTTLS/.test(reply)) { socket.destroy(); return reject(new Error('STARTTLS is not offered')); }
        step = 2;
        socket.write('STARTTLS\r\n');
        return;
      }
      if (step === 2) {
        step = 3;
        socket.removeAllListeners('data');
        const secure = tlsConnect({ socket, rejectUnauthorized: false }, () => {
          const cert = secure.getPeerCertificate();
          const protocol = secure.getProtocol();
          secure.destroy();
          resolve({ subject: cert.subject, fingerprint256: cert.fingerprint256, protocol });
        });
        secure.on('error', reject);
      }
    });
  });
}

// Checks a DKIM signature (rsa-sha256, relaxed/relaxed) against a public key.
// Returns the tags of the signature and the two results: body hash and header signature.
export function verifyDkim(raw, publicKeyPem) {
  const text = raw.toString('latin1');
  const split = text.indexOf('\r\n\r\n');
  const body = text.slice(split + 4);
  const headers = [];
  for (const line of text.slice(0, split).split('\r\n')) {
    if (/^[ \t]/.test(line) && headers.length) headers[headers.length - 1] += line; // folded line
    else headers.push(line);
  }
  const relax = (h) => `${h.slice(0, h.indexOf(':')).toLowerCase().trim()}:${h.slice(h.indexOf(':') + 1).replace(/[ \t]+/g, ' ').trim()}`;
  const signature = headers.find((h) => /^dkim-signature:/i.test(h));
  const tags = Object.fromEntries(signature.slice(signature.indexOf(':') + 1).split(';').map((t) => t.trim()).filter(Boolean)
    .map((t) => [t.slice(0, t.indexOf('=')).trim(), t.slice(t.indexOf('=') + 1).replace(/\s+/g, '')]));

  // Body: white space at line ends removed, runs of white space made one space, empty lines at the end removed.
  let canonBody = body.split('\r\n').map((l) => l.replace(/[ \t]+/g, ' ').replace(/ $/, '')).join('\r\n').replace(/(\r\n)+$/, '');
  canonBody = canonBody ? canonBody + '\r\n' : '';
  const bodyHashOk = createHash('sha256').update(canonBody, 'latin1').digest('base64') === tags.bh;

  // Headers: the ones named in h=, then the signature header itself with an empty b= value.
  const others = headers.filter((h) => h !== signature).map(relax);
  let signed = '';
  for (const name of tags.h.toLowerCase().split(':')) {
    const found = others.filter((h) => h.startsWith(`${name}:`)).pop();
    if (found) signed += found + '\r\n';
  }
  signed += relax(signature).replace(/(^|;\s*)b=[^;]*/, '$1b=');
  const signatureOk = createVerify('RSA-SHA256').update(signed, 'latin1').verify(publicKeyPem, tags.b, 'base64');
  return { tags, bodyHashOk, signatureOk };
}
