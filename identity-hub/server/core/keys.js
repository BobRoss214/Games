// Server secrets. All keys come from one SECRET_KEY.
//
// indexKey: keyed hash for lookups. The database stores HMAC(address) and not the
//           address. A stolen database does not show the addresses and numbers.
// dataKey:  encrypts the few values that the server must read again later
//           (real phone numbers for call forwarding).
import { createHmac, createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

export function createKeys(secretKey) {
  const derive = (info) => Buffer.from(hkdfSync('sha256', secretKey, Buffer.alloc(0), 'postern/server/' + info, 32));
  const indexKey = derive('index');
  const dataKey = derive('data');
  const powKey = derive('pow');

  return {
    // kind separates name spaces: "addr" for email addresses, "num" for phone numbers.
    indexHmac(kind, value) {
      return createHmac('sha256', indexKey).update(kind + '\0' + value).digest();
    },
    sign(purpose, value) {
      return createHmac('sha256', powKey).update(purpose + '\0' + value).digest('base64url');
    },
    srvEncrypt(plaintext, aad = '') {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', dataKey, iv);
      c.setAAD(Buffer.from(aad));
      const ct = Buffer.concat([c.update(plaintext), c.final()]);
      return Buffer.concat([Buffer.from([1]), iv, ct, c.getAuthTag()]);
    },
    srvDecrypt(data, aad = '') {
      const buf = Buffer.from(data);
      if (buf.length < 29 || buf[0] !== 1) throw new Error('bad ciphertext');
      const d = createDecipheriv('aes-256-gcm', dataKey, buf.subarray(1, 13));
      d.setAAD(Buffer.from(aad));
      d.setAuthTag(buf.subarray(buf.length - 16));
      return Buffer.concat([d.update(buf.subarray(13, buf.length - 16)), d.final()]);
    },
  };
}

export const sha256 = (v) => createHash('sha256').update(v).digest();
export const randomId = () => randomBytes(16).toString('base64url');
export const randomToken = () => randomBytes(32).toString('base64url');
export function safeEqual(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
