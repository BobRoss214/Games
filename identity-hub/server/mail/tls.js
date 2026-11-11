// TLS key and certificate for STARTTLS on the SMTP port.
//
// Order of choice:
// 1. The files that the operator configured (SMTP_TLS_KEY, SMTP_TLS_CERT).
// 2. A self-signed pair that this server makes one time and keeps in the data folder.
// 3. The test certificate inside the smtp-server package. Its private key is public,
//    so this is the last resort when the `openssl` program is not available.
//
// Mail servers on the internet do not check the certificate of the receiving server (they use
// "opportunistic" TLS). A self-signed certificate with a private key is enough to stop a listener
// who only reads the traffic.
import { execFile } from 'node:child_process';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import { closeSync, openSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const SELF_SIGNED_KEY = 'smtp-selfsigned.key';
export const SELF_SIGNED_CERT = 'smtp-selfsigned.crt';
const VALID_DAYS = 3650; // 10 years
const RENEW_BEFORE_MS = 30 * 86400 * 1000;
const OPENSSL_TIMEOUT_MS = 15_000;
// A common name has 64 characters at most. Only host name characters go on the command line.
const HOST_NAME = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/;

// Reads a key and a certificate and checks that they belong together. Throws if they do not.
export function readPair(keyFile, certFile) {
  const key = readFileSync(keyFile);
  const cert = readFileSync(certFile);
  const x509 = new X509Certificate(cert); // the first certificate in the file
  if (!x509.checkPrivateKey(createPrivateKey(key))) throw new Error('The TLS key does not belong to the certificate.');
  return { key, cert, x509 };
}

// A value that changes when one of the two files changes on disk.
export function fileStamp(keyFile, certFile) {
  return [keyFile, certFile].map((file) => { const s = statSync(file); return `${s.mtimeMs}:${s.size}`; }).join('|');
}

// Runs the openssl program with fixed arguments. No shell is used. Resolves true on success.
function openssl(args) {
  return new Promise((resolve) => {
    execFile('openssl', args, { timeout: OPENSSL_TIMEOUT_MS, windowsHide: true }, (err) => resolve(!err));
  });
}

function removeQuietly(file) {
  try { rmSync(file, { force: true }); } catch { /* nothing to remove */ }
}

// Makes a new self-signed pair in the data folder. Returns true on success.
async function makeSelfSigned(keyFile, certFile, commonName) {
  const tmpKey = `${keyFile}.new`;
  const tmpCert = `${certFile}.new`;
  const subject = ['-subj', `/CN=${commonName}`];
  const output = ['-keyout', tmpKey, '-out', tmpCert];
  const base = ['req', '-x509', '-nodes', '-sha256', '-days', String(VALID_DAYS)];
  // First choice: a small elliptic curve key with the host name also as "subject alternative name".
  // Second choice: an RSA key with the options that every old version of the program knows.
  const attempts = [
    [...base, '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', ...subject, '-addext', `subjectAltName=DNS:${commonName}`, ...output],
    [...base, '-newkey', 'rsa:2048', ...subject, ...output],
  ];
  try {
    for (const args of attempts) {
      removeQuietly(tmpKey);
      removeQuietly(tmpCert);
      // The key file exists with mode 0600 before the program writes the key into it.
      closeSync(openSync(tmpKey, 'wx', 0o600));
      if (!(await openssl(args))) continue;
      try {
        readPair(tmpKey, tmpCert);
      } catch {
        continue;
      }
      renameSync(tmpKey, keyFile);
      renameSync(tmpCert, certFile);
      return true;
    }
    return false;
  } catch {
    return false; // for example: the data folder is read-only
  } finally {
    removeQuietly(tmpKey);
    removeQuietly(tmpCert);
  }
}

// True if the self-signed pair on disk is usable: a matching pair, the right name, not close to its end.
function selfSignedIsGood(keyFile, certFile, commonName) {
  try {
    const { x509 } = readPair(keyFile, certFile);
    const names = x509.subject.split('\n');
    return names.includes(`CN=${commonName}`) && Date.parse(x509.validTo) - Date.now() > RENEW_BEFORE_MS;
  } catch {
    return false;
  }
}

// Finds the files to use. Returns { source: 'configured' | 'generated', keyFile, certFile },
// or null when the server must fall back to the certificate of the library.
// Configured files that cannot be read stop the start with an error: a silent fallback would hide the mistake.
export async function chooseTlsFiles({ config }) {
  const { tlsKeyFile, tlsCertFile } = config.mail;
  if (tlsKeyFile && tlsCertFile) {
    readPair(tlsKeyFile, tlsCertFile);
    return { source: 'configured', keyFile: tlsKeyFile, certFile: tlsCertFile };
  }
  const keyFile = join(config.dataDir, SELF_SIGNED_KEY);
  const certFile = join(config.dataDir, SELF_SIGNED_CERT);
  const hostname = String(config.mail.hostname || '').toLowerCase();
  const commonName = HOST_NAME.test(hostname) ? hostname : 'localhost';
  if (selfSignedIsGood(keyFile, certFile, commonName) || await makeSelfSigned(keyFile, certFile, commonName)) {
    return { source: 'generated', keyFile, certFile };
  }
  return null;
}
