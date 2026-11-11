// Tests for the export file format (web/js/lib/exportfile.js).
// The library is plain JavaScript with WebCrypto and Blob, so it runs here in Node.js
// exactly as it runs in the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import v8 from 'node:v8';
import vm from 'node:vm';
import { createAccountKeys, hkdf, aesKey, sha256 } from '../shared/crypto.js';
import { generateRecoveryKey, parseRecoveryKey } from '../shared/recovery.js';
import { utf8 } from '../shared/bytes.js';

// The library imports the shared modules as every file of the web app does:
//   import … from '/shared/crypto.js'
// In the browser the server gives the folder shared/ at that address. In Node.js the same
// text means a file at the root of the disk. This small resolve hook maps "/shared/…" to
// the shared/ folder of the project, for this test process only. No other file changes.
const hooks = `
  let root;
  export function initialize(data) { root = data.root; }
  export function resolve(specifier, context, nextResolve) {
    return nextResolve(specifier.startsWith('/shared/') ? new URL('.' + specifier, root).href : specifier, context);
  }`;
register('data:text/javascript,' + encodeURIComponent(hooks), { parentURL: import.meta.url, data: { root: new URL('../', import.meta.url).href } });
const lib = await import('../web/js/lib/exportfile.js');
const {
  createExportWriter, readExportHeader, openExport, validateIndex, estimateExportBytes,
  INDEX_SCHEMA_V1, EXPORT_ERRORS, EXPORT_FORMAT_VERSION, INDEX_VERSION,
  DEFAULT_CHUNK_BYTES, MAX_BLOB_BYTES, MAX_INDEX_BYTES, LARGE_EXPORT_BYTES,
} = lib;

const MIB = 1024 * 1024;
const TAG = 16;
const WRONG_KEY = 'This key does not open this file.';

async function makeAccount() {
  const recovery = await generateRecoveryKey();
  const keys = await createAccountKeys(recovery.bytes);
  return { recovery, accountId: keys.upload.accountId, accountKey: keys.local.accountKey, recoveryWrap: keys.upload.recoveryWrap };
}
// Bytes that depend only on the seed: the test can make them again to compare, and does not have to keep them.
function pattern(seed, length) {
  const out = new Uint8Array(length);
  let x = (Math.imul(seed + 1, 2654435761) >>> 0) || 1;
  for (let i = 0; i < length; i++) {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    out[i] = x & 255;
  }
  return out;
}
const same = (a, b) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
const fileBytes = async (blob) => new Uint8Array(await blob.arrayBuffer());
const asBlob = (bytes) => new Blob([bytes]);
const person = (name) => ({ name, address: `${name.toLowerCase()}@example.com` });

// A complete, valid index. refs: { body, attachment, voicemail }.
function fullIndex(refs) {
  return {
    v: 1,
    app: 'Postern',
    createdDay: '2026-11-11',
    inboxes: [{ id: 'mb1', address: 'quiet.river482@postern.test', label: 'Personal', note: '', status: 'active' }],
    aliases: [
      { id: 'al1', address: 'shop.x@postern.test', inboxId: 'mb1', label: 'Shop X', note: 'a note', enabled: true, identityId: 'id1', persona: { country: 'US', first: 'Ada' }, expiresAt: 1800000000 },
      { id: 'al2', address: 'news@postern.test', inboxId: 'mb1', label: '', note: '', enabled: false, identityId: null, persona: null, expiresAt: null },
    ],
    numbers: [{ id: 'nu1', number: '+14155550100', label: 'Selling the bike', note: '', identityId: '', persona: null }],
    phones: [{ id: 'ph1', number: '+16505550100', label: 'My mobile' }],
    identities: [{ id: 'id1', name: 'Shop X', note: '', persona: null, createdDay: '2026-10-01' }],
    mail: [{
      id: 'm1', inboxId: 'mb1', addressId: 'al1', direction: 'in', at: 1794000000, seen: true,
      from: person('Alice'), to: [person('Me')], cc: [], subject: 'Your order 4711-secret', snippet: 'Thank you', deliveredTo: 'shop.x@postern.test',
      body: refs.body, attachments: [{ filename: 'invoice.pdf', contentType: 'application/pdf', size: refs.attachment.n, blob: refs.attachment }],
    }, {
      id: 'm2', inboxId: 'mb1', addressId: null, direction: 'out', at: 1794000100, seen: true,
      from: null, to: [person('Bob'), person('Carol')], cc: [person('Dave')], subject: '', snippet: '', deliveredTo: '',
      body: refs.body, attachments: [],
    }],
    texts: [
      { id: 't1', numberId: 'nu1', direction: 'in', at: 1794000200, peer: '+13055550100', body: 'Is the bike still for sale?', status: null },
      { id: 't2', numberId: 'nu1', direction: 'out', at: 1794000300, peer: '+13055550100', body: 'Yes', status: 'delivered' },
    ],
    calls: [
      { id: 'c1', numberId: 'nu1', direction: 'in', at: 1794000400, seconds: 0, status: 'missed', peer: '+13055550100', voicemail: { seconds: 7, contentType: 'audio/mpeg', blob: refs.voicemail } },
      { id: 'c2', numberId: 'nu1', direction: 'out', at: 1794000500, seconds: 61, status: 'answered', peer: '+13055550100', voicemail: null },
    ],
    blocks: [{ addressId: 'al1', kind: 'domain', value: 'spam.example' }],
    notIncluded: ['2 messages could not be opened.'],
  };
}
const emptyIndex = () => ({ v: 1, app: 'Postern', createdDay: '2026-11-11', inboxes: [], aliases: [], numbers: [], phones: [], identities: [], mail: [], texts: [], calls: [], blocks: [], notIncluded: [] });

// A small export with small chunks (1 KiB), so that a few KB of data make many chunks.
async function smallExport(account, { chunkSize = 1024 } = {}) {
  const writer = createExportWriter({ accountKey: account.accountKey, recoveryWrap: account.recoveryWrap, appName: 'Postern', createdDay: '2026-11-11', chunkSize });
  const blobs = [];
  for (const [seed, size] of [[1, 700], [2, 1500], [3, 2048], [4, 1], [5, 900]]) {
    const bytes = pattern(seed, size);
    blobs.push({ ref: await writer.addBlob(bytes), bytes });
  }
  const body = await writer.addBlob(utf8(JSON.stringify({ text: 'Hello from the body', html: null })));
  const index = fullIndex({ body, attachment: blobs[1].ref, voicemail: blobs[2].ref });
  const file = await writer.finish(index);
  return { file, bytes: await fileBytes(file), blobs, index, body };
}

test('the import style of the web app works in Node.js, and the source uses no browser page feature', async () => {
  assert.equal(typeof createExportWriter, 'function');
  const source = readFileSync(new URL('../web/js/lib/exportfile.js', import.meta.url), 'utf8');
  // The same import style as web/js/lib/session.js.
  assert.match(source, /from '\/shared\/bytes\.js';/);
  assert.match(source, /from '\/shared\/crypto\.js';/);
  assert.doesNotMatch(source, /from '\.\.\//);
  // Look at the code only, not at the comments.
  const code = source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n').replace(/\s\/\/ .*$/gm, '');
  for (const word of [/\bdocument\b/, /\bwindow\b/, /\bnavigator\b/, /\bfetch\s*\(/, /XMLHttpRequest/, /localStorage/, /sessionStorage/, /indexedDB/, /Math\.random/, /\bconsole\./, /\bDate\b/]) {
    assert.doesNotMatch(code, word);
  }
  assert.equal(EXPORT_FORMAT_VERSION, 1);
  assert.equal(INDEX_VERSION, 1);
  assert.equal(DEFAULT_CHUNK_BYTES, MIB);
  assert.equal(MAX_BLOB_BYTES, 64 * MIB);
  assert.equal(MAX_INDEX_BYTES, 64 * MIB);
  assert.equal(LARGE_EXPORT_BYTES, 256 * MIB);
  assert.ok(Object.isFrozen(INDEX_SCHEMA_V1));
});

test('round trip: blobs of odd sizes, random access over chunk borders, both keys', async () => {
  const account = await makeAccount();
  const writer = createExportWriter({ accountKey: account.accountKey, recoveryWrap: account.recoveryWrap, appName: 'Postern', createdDay: '2026-11-11' });
  // 0 bytes, 1 byte, a little under one chunk, exactly one chunk, one chunk + 1, several MB.
  const sizes = [0, 1, 2, MIB - 1, MIB, MIB + 1, 0, 3 * MIB + 12345, 5 * MIB, 17, 2 * MIB];
  const blobs = [];
  let expectedOffset = 0;
  for (const [i, size] of sizes.entries()) {
    const bytes = pattern(i, size);
    const ref = await writer.addBlob(bytes);
    assert.deepEqual(ref, { o: expectedOffset, n: size });
    expectedOffset += size;
    assert.equal(writer.bytesWritten, expectedOffset);
    blobs.push({ ref, bytes });
  }
  const bodyJson = { text: 'A mail body with a secret word: marzipan-4711', html: '<p>x</p>', messageId: '<1@example.com>', inReplyTo: null, references: [], replyTo: [] };
  const body = await writer.addBlob(utf8(JSON.stringify(bodyJson)));
  // An ArrayBuffer is accepted too.
  const fromBuffer = await writer.addBlob(pattern(99, 300).buffer);
  const dataLength = writer.bytesWritten;
  const index = fullIndex({ body, attachment: blobs[7].ref, voicemail: blobs[9].ref });
  const file = await writer.finish(index);
  assert.ok(file instanceof Blob);
  assert.equal(file.type, 'application/octet-stream');

  // The plain header.
  const header = await readExportHeader(file);
  assert.equal(header.version, 1);
  assert.equal(header.appName, 'Postern');
  assert.equal(header.createdDay, '2026-11-11');
  assert.equal(header.chunkSize, MIB);
  assert.equal(header.indexOffset, dataLength);
  assert.equal(header.indexLength, utf8(JSON.stringify(index)).length);
  assert.equal(header.totalLength, dataLength + header.indexLength);
  assert.ok(same(header.recoveryWrap, account.recoveryWrap));
  assert.equal(header.chunkCount, Math.ceil(header.totalLength / MIB));
  // The size of the file: header + plain bytes + one tag for each chunk.
  assert.equal(header.fileLength, file.size);
  assert.equal(file.size, header.headerLength + header.totalLength + header.chunkCount * TAG);
  assert.equal(header.headerLength, 37 + 'Postern'.length + account.recoveryWrap.length + 24 + 16);

  // Nothing of the contents is readable in the file, and the header names no account.
  const raw = Buffer.from(await file.arrayBuffer());
  for (const word of ['marzipan-4711', '4711-secret', 'quiet.river482', '+14155550100', 'Selling the bike', 'inboxes', account.accountId]) {
    assert.ok(!raw.includes(word), `the file shows "${word}"`);
  }
  assert.ok(!raw.includes(Buffer.from(account.accountKey)));
  assert.ok(!raw.includes(Buffer.from(blobs[9].bytes)));
  assert.equal(raw.subarray(0, 8).toString('latin1'), '\x89PSTRNX\n');

  // Open with the recovery key (as text, the way a person has it), and with the account key.
  const viaRecovery = await openExport(file, { recoveryBytes: await parseRecoveryKey(account.recovery.text) });
  const viaAccount = await openExport(file, { accountKey: account.accountKey });
  for (const opened of [viaRecovery, viaAccount]) {
    assert.deepEqual(opened.index, index);
    assert.deepEqual(opened.header, {
      version: 1, appName: 'Postern', createdDay: '2026-11-11', chunkSize: MIB, totalLength: header.totalLength,
      indexOffset: header.indexOffset, indexLength: header.indexLength, chunkCount: header.chunkCount, fileLength: file.size,
    });
    for (const b of blobs) assert.ok(same(await opened.readBlob(b.ref), b.bytes), `blob of ${b.bytes.length} bytes`);
    assert.deepEqual(await opened.readJson(body), bodyJson);
    assert.ok(same(await opened.readBlob(fromBuffer), pattern(99, 300)));
    assert.deepEqual(await opened.readBlob({ o: 0, n: 0 }), new Uint8Array(0));
    assert.equal(await opened.verify(), true);
  }

  // Random access: ranges that cross chunk borders, compared with the plain stream.
  const plain = Buffer.concat(blobs.map((b) => Buffer.from(b.bytes)));
  const ranges = [[MIB - 3, 7], [MIB - 1, 1], [MIB, 1], [MIB - 1, 2], [2 * MIB - 5, MIB + 10], [0, 10], [3 * MIB + 1, 2 * MIB + 3], [plain.length - 9, 9], [5 * MIB + 77, 1]];
  for (const [o, n] of ranges) {
    assert.ok(same(await viaAccount.readBlob({ o, n }), plain.subarray(o, o + n)), `range ${o}+${n}`);
  }
  // A reference that does not fit is refused. Blobs end where the index starts.
  for (const bad of [{ o: dataLength, n: 1 }, { o: 0, n: dataLength + 1 }, { o: -1, n: 1 }, { o: 0.5, n: 1 }, { o: 0 }, { o: '0', n: 1 }, null, { o: 0, n: MAX_BLOB_BYTES + 1 }]) {
    await assert.rejects(viaAccount.readBlob(bad), { message: EXPORT_ERRORS.badIndex });
  }
  await assert.rejects(viaAccount.readJson(blobs[1].ref), { message: EXPORT_ERRORS.damaged });

  // Wrong keys: the plain message.
  const stranger = await makeAccount();
  await assert.rejects(openExport(file, { recoveryBytes: stranger.recovery.bytes }), { message: WRONG_KEY });
  await assert.rejects(openExport(file, { accountKey: stranger.accountKey }), { message: WRONG_KEY });
  const oneBitOff = Uint8Array.from(account.accountKey);
  oneBitOff[31] ^= 1;
  await assert.rejects(openExport(file, { accountKey: oneBitOff }), { message: WRONG_KEY });
  for (const bad of [{}, undefined, { accountKey: new Uint8Array(31) }, { accountKey: 'text' }, { recoveryBytes: new Uint8Array(0) }, { recoveryBytes: 'ABCD' }, { accountKey: null }]) {
    await assert.rejects(openExport(file, bad), { message: WRONG_KEY });
  }
  assert.equal(EXPORT_ERRORS.wrongKey, WRONG_KEY);
});

test('two exports of one account use different nonces, and a file opens only as a whole', async () => {
  const account = await makeAccount();
  const one = await smallExport(account);
  const two = await smallExport(account);
  // The same data and the same key give different files: the nonce prefix is random.
  assert.equal(one.bytes.length, two.bytes.length);
  assert.ok(!same(one.bytes.subarray(16, 24), two.bytes.subarray(16, 24)));
  const header = await readExportHeader(one.file);
  assert.ok(!same(one.bytes.subarray(header.headerLength), two.bytes.subarray(header.headerLength)));
  // A chunk of the second file in the same place of the first file is not accepted.
  const step = 1024 + TAG;
  const mixed = Uint8Array.from(one.bytes);
  mixed.set(two.bytes.subarray(header.headerLength, header.headerLength + step), header.headerLength);
  const opened = await openExport(asBlob(mixed), { accountKey: account.accountKey });
  await assert.rejects(opened.verify(), { message: EXPORT_ERRORS.damaged });
  // The body of one file under the header of the other: no chunk opens.
  const swappedHeader = Uint8Array.from(one.bytes);
  swappedHeader.set(two.bytes.subarray(0, header.headerLength), 0);
  await assert.rejects(openExport(asBlob(swappedHeader), { accountKey: account.accountKey }), { message: EXPORT_ERRORS.damaged });
});

test('the layout on disk is as the comment in the library says', async () => {
  // This test reads a file with its own code, from the written layout only. If the
  // library changes the format, this test fails.
  const account = await makeAccount();
  const { bytes, blobs, index } = await smallExport(account);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const subtle = globalThis.crypto.subtle;

  // Fixed part.
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x53, 0x54, 0x52, 0x4e, 0x58, 0x0a]);
  assert.equal(view.getUint16(8), 1); // version
  const F = view.getUint16(10);
  const chunkSize = view.getUint32(12);
  assert.equal(chunkSize, 1024);
  const prefix = bytes.subarray(16, 24);
  assert.equal(Buffer.from(bytes.subarray(24, 34)).toString('ascii'), '2026-11-11');
  const A = bytes[34];
  assert.equal(Buffer.from(bytes.subarray(35, 35 + A)).toString('utf8'), 'Postern');
  const W = view.getUint16(35 + A);
  assert.ok(same(bytes.subarray(37 + A, 37 + A + W), account.recoveryWrap));
  assert.equal(F, 37 + A + W);
  // Final part and tag.
  const total = Number(view.getBigUint64(F));
  const indexOffset = Number(view.getBigUint64(F + 8));
  const indexLength = Number(view.getBigUint64(F + 16));
  const H = F + 24 + 16;
  assert.equal(indexOffset + indexLength, total);
  const count = Math.ceil(total / chunkSize);
  assert.equal(bytes.length, H + total + count * 16);

  // The key, the nonce and the additional data, as written.
  const key = await aesKey(await hkdf(account.accountKey, 'postern/v1/export', 32));
  const fixed = bytes.subarray(0, F);
  const headerHash = await sha256(fixed);
  const nonce = (counter) => { const n = new Uint8Array(12); n.set(prefix, 0); new DataView(n.buffer).setUint32(8, counter); return n; };
  const aad = (i, last) => { const a = new Uint8Array(37); a.set(headerHash, 0); new DataView(a.buffer).setUint32(32, i); a[36] = last ? 1 : 0; return a; };
  const chunkAt = (i) => bytes.subarray(H + i * (chunkSize + 16), Math.min(H + (i + 1) * (chunkSize + 16), bytes.length));
  const openChunk = async (i) => new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce(i), additionalData: aad(i, i === count - 1) }, key, chunkAt(i)));

  // The header tag: an AES-GCM tag over the fixed part and the final part, with no data.
  await subtle.decrypt({ name: 'AES-GCM', iv: nonce(0xffffffff), additionalData: bytes.subarray(0, F + 24) }, key, bytes.subarray(F + 24, H));
  // All chunks, joined, are the plaintext stream: the blobs, then the index.
  const plain = Buffer.concat(await Promise.all(Array.from({ length: count }, (_, i) => openChunk(i))));
  assert.equal(plain.length, total);
  for (const b of blobs) assert.ok(same(plain.subarray(b.ref.o, b.ref.o + b.ref.n), b.bytes));
  assert.deepEqual(JSON.parse(plain.subarray(indexOffset).toString('utf8')), index);
  // The first blob starts at offset 0 of the stream, and the index is the last part.
  assert.equal(blobs[0].ref.o, 0);
  // A chunk does not open with the number of a different chunk, or with the wrong "last" mark.
  await assert.rejects(subtle.decrypt({ name: 'AES-GCM', iv: nonce(0), additionalData: aad(1, false) }, key, chunkAt(0)));
  await assert.rejects(subtle.decrypt({ name: 'AES-GCM', iv: nonce(0), additionalData: aad(0, true) }, key, chunkAt(0)));

  // The reader checks the "last chunk" mark too. Make a file whose last chunk is correctly
  // encrypted, but marked as "not the last" (only a person with the key can make this).
  const seal = async (i, last, data) => new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce(i), additionalData: aad(i, last) }, key, data));
  const lastPlain = await openChunk(count - 1);
  const wrongMark = Uint8Array.from(bytes);
  wrongMark.set(await seal(count - 1, false, lastPlain), H + (count - 1) * (chunkSize + 16));
  await assert.rejects(openExport(asBlob(wrongMark), { accountKey: account.accountKey }), { message: EXPORT_ERRORS.damaged });
  // And a middle chunk that is marked as the last one.
  const wrongMark2 = Uint8Array.from(bytes);
  wrongMark2.set(await seal(1, true, await openChunk(1)), H + (chunkSize + 16));
  const opened = await openExport(asBlob(wrongMark2), { accountKey: account.accountKey });
  await assert.rejects(opened.verify(), { message: EXPORT_ERRORS.damaged });
  // The same chunks sealed again in the right way give a file that opens (the test's own writer works).
  const again = Uint8Array.from(bytes);
  again.set(await seal(1, false, await openChunk(1)), H + (chunkSize + 16));
  assert.ok(same(again, bytes));
  assert.equal(await (await openExport(asBlob(again), { accountKey: account.accountKey })).verify(), true);
});

test('tamper: every change of the file is detected', async () => {
  const account = await makeAccount();
  const { file, bytes, blobs, index } = await smallExport(account);
  const header = await readExportHeader(file);
  const H = header.headerLength;
  const step = 1024 + TAG;
  assert.ok(header.chunkCount >= 7, 'the test file must have several chunks');
  assert.equal(bytes.length, H + header.totalLength + header.chunkCount * TAG);
  const known = new Set(Object.values(EXPORT_ERRORS));
  const keys = [{ accountKey: account.accountKey }, { recoveryBytes: account.recovery.bytes }];

  // Opens the file and reads all of it. Resolves to the error message, or to 'ok'.
  async function outcome(changed, key) {
    try {
      const opened = await openExport(asBlob(changed), key);
      await opened.verify();
      for (const b of blobs) await opened.readBlob(b.ref);
      return 'ok';
    } catch (err) {
      assert.ok(known.has(err.message), `not a plain message: ${err.message}`);
      return err.message;
    }
  }
  const flip = (at) => { const copy = Uint8Array.from(bytes); copy[at] ^= 0x01; return copy; };
  // The file as it is opens with both keys.
  for (const key of keys) assert.equal(await outcome(bytes, key), 'ok');

  // 1. One changed bit in each byte of the header.
  const messages = new Set();
  for (let at = 0; at < H; at++) {
    for (const key of keys) {
      const result = await outcome(flip(at), key);
      assert.notEqual(result, 'ok', `a change of header byte ${at} was not detected`);
      messages.add(result);
    }
  }
  // The magic bytes: "not an export". The version: "newer version".
  assert.equal(await outcome(flip(0), keys[0]), EXPORT_ERRORS.notExport);
  const newer = Uint8Array.from(bytes);
  newer[9] = 2;
  assert.equal(await outcome(newer, keys[0]), EXPORT_ERRORS.tooNew);
  await assert.rejects(readExportHeader(asBlob(newer)), { message: EXPORT_ERRORS.tooNew });
  // With the recovery key the reader knows that the key is right, so it says "damaged"
  // for a changed header field (here: the day). With the account key it cannot know.
  assert.equal(await outcome(flip(24), { recoveryBytes: account.recovery.bytes }), EXPORT_ERRORS.damaged);
  assert.equal(await outcome(flip(24), { accountKey: account.accountKey }), EXPORT_ERRORS.wrongKey);
  // A changed total length, index place, or header tag.
  for (const at of [H - 40, H - 33, H - 32, H - 25, H - 24, H - 17, H - 16, H - 1]) assert.notEqual(await outcome(flip(at), keys[0]), 'ok');

  // 2. One changed bit in a chunk: in its data and in its tag. First, middle and last chunk.
  for (const chunk of [0, 3, header.chunkCount - 1]) {
    const start = H + chunk * step;
    const end = Math.min(start + step, bytes.length);
    for (const at of [start, start + 100, end - TAG - 1, end - TAG, end - 1]) {
      for (const key of keys) assert.equal(await outcome(flip(at), key), EXPORT_ERRORS.damaged, `chunk ${chunk}, byte ${at - start}`);
    }
  }
  // A damaged chunk does not stop the reading of the other chunks (random access).
  const damagedFirst = await openExport(asBlob(flip(H + 10)), keys[0]);
  assert.deepEqual(damagedFirst.index, index);
  await assert.rejects(damagedFirst.readBlob(blobs[0].ref), { message: EXPORT_ERRORS.damaged });
  assert.ok(same(await damagedFirst.readBlob(blobs[2].ref), blobs[2].bytes));
  await assert.rejects(damagedFirst.verify(), { message: EXPORT_ERRORS.damaged });

  // 3. Two chunks change places.
  const swapped = Uint8Array.from(bytes);
  swapped.set(bytes.subarray(H + step, H + 2 * step), H + 2 * step);
  swapped.set(bytes.subarray(H + 2 * step, H + 3 * step), H + step);
  assert.equal(await outcome(swapped, keys[0]), EXPORT_ERRORS.damaged);
  // 4. A chunk is there two times (a copy replaces its neighbour).
  const doubled = Uint8Array.from(bytes);
  doubled.set(bytes.subarray(H + step, H + 2 * step), H + 2 * step);
  assert.equal(await outcome(doubled, keys[0]), EXPORT_ERRORS.damaged);
  // 5. A chunk is inserted, or a middle chunk is removed: the length is wrong.
  const inserted = Buffer.concat([bytes.subarray(0, H + step), bytes.subarray(H, H + step), bytes.subarray(H + step)]);
  assert.equal(await outcome(inserted, keys[0]), EXPORT_ERRORS.damaged);
  const removed = Buffer.concat([bytes.subarray(0, H + step), bytes.subarray(H + 2 * step)]);
  assert.equal(await outcome(removed, keys[0]), EXPORT_ERRORS.incomplete);
  // 6. The last chunk is dropped.
  const lastStart = H + (header.chunkCount - 1) * step;
  assert.equal(await outcome(bytes.subarray(0, lastStart), keys[0]), EXPORT_ERRORS.incomplete);
  // 7. Bytes are appended.
  assert.equal(await outcome(Buffer.concat([bytes, Buffer.from([0])]), keys[0]), EXPORT_ERRORS.damaged);
  assert.equal(await outcome(Buffer.concat([bytes, bytes.subarray(H, H + step)]), keys[0]), EXPORT_ERRORS.damaged);
  // 8. The file is cut at any place.
  for (const length of [0, 1, 7, 8, 11, 12, 30, H - 1, H, H + 1, H + step, lastStart + 1, bytes.length - TAG, bytes.length - 1]) {
    for (const key of keys) {
      const result = await outcome(bytes.subarray(0, length), key);
      assert.notEqual(result, 'ok', `a file that was cut at ${length} was accepted`);
    }
  }
  // 9. The last chunk in the place of a middle chunk.
  const lastAsMiddle = Uint8Array.from(bytes);
  lastAsMiddle.set(bytes.subarray(lastStart, bytes.length), H + step);
  assert.equal(await outcome(lastAsMiddle, keys[0]), EXPORT_ERRORS.damaged);

  // Every failure used one of the plain messages (checked in outcome()).
  assert.ok(messages.size >= 2);
});

test('validateIndex: accepts a full index and refuses wrong shapes', () => {
  const ref = { o: 0, n: 10 };
  const good = fullIndex({ body: ref, attachment: ref, voicemail: ref });
  assert.equal(validateIndex(good), good);
  assert.equal(validateIndex(emptyIndex()).v, 1);
  // Fields that this version does not know are permitted, on every level.
  const extra = fullIndex({ body: ref, attachment: ref, voicemail: ref });
  extra.future = { anything: [1, 2, 3] };
  extra.mail[0].labels = ['x'];
  extra.mail[0].attachments[0].cid = 'abc';
  extra.calls[0].voicemail.transcript = null;
  extra.inboxes[0].retentionDays = 30;
  assert.equal(validateIndex(extra), extra);
  // The large files can be left out: an attachment or a voicemail with no blob (null) is valid.
  const lean = fullIndex({ body: ref, attachment: ref, voicemail: ref });
  lean.mail[0].attachments[0].blob = null;
  lean.calls[0].voicemail.blob = null;
  assert.equal(validateIndex(lean, { dataLength: 10 }), lean);
  // The body of a message is never left out.
  lean.mail[0].body = null;
  assert.throws(() => validateIndex(lean), { message: EXPORT_ERRORS.badIndex });
  // With the length of the data, every reference must fit.
  assert.equal(validateIndex(good, { dataLength: 10 }), good);
  assert.throws(() => validateIndex(good, { dataLength: 9 }), { message: EXPORT_ERRORS.badIndex });

  const cases = [
    ['not an object', () => null, 'index'],
    ['a list', () => [], 'index'],
    ['text', () => '{"v":1}', 'index'],
    ['a newer index version', (x) => { x.v = 2; }, 'v'],
    ['no version', (x) => { delete x.v; }, 'v'],
    ['the version as text', (x) => { x.v = '1'; }, 'v'],
    ['a list is absent', (x) => { delete x.texts; }, 'texts'],
    ['a list is an object', (x) => { x.mail = {}; }, 'mail'],
    ['a day with a time', (x) => { x.createdDay = '2026-11-11T10:00:00Z'; }, 'createdDay'],
    ['an id that is a number', (x) => { x.inboxes[0].id = 7; }, 'inboxes[0].id'],
    ['a label that is null', (x) => { x.aliases[1].label = null; }, 'aliases[1].label'],
    ['enabled as text', (x) => { x.aliases[0].enabled = 'yes'; }, 'aliases[0].enabled'],
    ['random identifiers as text', (x) => { x.aliases[0].persona = 'Ada'; }, 'aliases[0].persona'],
    ['an expiry time that is not whole', (x) => { x.aliases[0].expiresAt = 1.5; }, 'aliases[0].expiresAt'],
    ['a wrong direction', (x) => { x.mail[0].direction = 'sideways'; }, 'mail[0].direction'],
    ['a negative time', (x) => { x.texts[0].at = -1; }, 'texts[0].at'],
    ['a sender that is text', (x) => { x.mail[0].from = 'alice@example.com'; }, 'mail[0].from'],
    ['a recipient with no address', (x) => { delete x.mail[1].to[1].address; }, 'mail[1].to[1].address'],
    ['a body that is text and not a reference', (x) => { x.mail[0].body = 'Hello'; }, 'mail[0].body'],
    ['a reference with a negative offset', (x) => { x.mail[0].body = { o: -1, n: 5 }; }, 'mail[0].body'],
    ['a reference with no length', (x) => { x.mail[0].attachments[0].blob = { o: 3 }; }, 'mail[0].attachments[0].blob'],
    ['a reference that is too long', (x) => { x.mail[0].body = { o: 0, n: MAX_BLOB_BYTES + 1 }; }, 'mail[0].body'],
    ['an attachment size as text', (x) => { x.mail[0].attachments[0].size = '12'; }, 'mail[0].attachments[0].size'],
    ['a voicemail that is true', (x) => { x.calls[0].voicemail = true; }, 'calls[0].voicemail'],
    ['a voicemail with no audio field', (x) => { delete x.calls[0].voicemail.blob; }, 'calls[0].voicemail.blob'],
    ['an attachment whose blob is text', (x) => { x.mail[0].attachments[0].blob = 'none'; }, 'mail[0].attachments[0].blob'],
    ['a text with no body', (x) => { delete x.texts[1].body; }, 'texts[1].body'],
    ['a block that is text', (x) => { x.blocks[0] = 'spam.example'; }, 'blocks[0]'],
    ['a note in the "not included" list that is a number', (x) => { x.notIncluded.push(3); }, 'notIncluded[1]'],
    ['a list entry that is null', (x) => { x.phones.push(null); }, 'phones[1]'],
  ];
  assert.ok(cases.length >= 10);
  for (const [name, change, path] of cases) {
    const index = fullIndex({ body: ref, attachment: ref, voicemail: ref });
    const result = change(index);
    const subject = result === undefined ? index : result;
    assert.throws(() => validateIndex(subject), (err) => {
      assert.equal(err.message, EXPORT_ERRORS.badIndex, name);
      assert.equal(err.path, path, name);
      return true;
    }, name);
  }
});

test('the writer checks what it gets', async () => {
  const account = await makeAccount();
  const options = { accountKey: account.accountKey, recoveryWrap: account.recoveryWrap, appName: 'Postern', createdDay: '2026-11-11', chunkSize: 1024 };
  // Bad options are refused at once.
  for (const bad of [
    { accountKey: new Uint8Array(16) }, { accountKey: 'key' }, { recoveryWrap: new Uint8Array(3) }, { recoveryWrap: null },
    { appName: 'x'.repeat(65) }, { appName: 7 }, { createdDay: '11.11.2026' }, { createdDay: '2026-11-11T00:00:00Z' },
    { chunkSize: 1023 }, { chunkSize: 16 * MIB + 1 }, { chunkSize: 2000.5 },
  ]) {
    assert.throws(() => createExportWriter({ ...options, ...bad }), Error, JSON.stringify(Object.keys(bad)));
  }
  assert.throws(() => createExportWriter(), Error);

  const writer = createExportWriter(options);
  assert.equal(writer.bytesWritten, 0);
  await assert.rejects(writer.addBlob('text'), Error);
  await assert.rejects(writer.addBlob([1, 2, 3]), Error);
  await assert.rejects(writer.addBlob(null), Error);
  // A blob of more than 64 MB is refused, and nothing is written for it.
  await assert.rejects(writer.addBlob(new Uint8Array(MAX_BLOB_BYTES + 1)), { message: EXPORT_ERRORS.blobTooLarge });
  assert.equal(writer.bytesWritten, 0);

  // Calls that do not wait for each other are written in the order of the calls.
  const pieces = [pattern(1, 3000), pattern(2, 0), pattern(3, 1024), pattern(4, 5), pattern(5, 2500)];
  const refs = await Promise.all(pieces.map((p) => writer.addBlob(p)));
  assert.deepEqual(refs, [{ o: 0, n: 3000 }, { o: 3000, n: 0 }, { o: 3000, n: 1024 }, { o: 4024, n: 5 }, { o: 4029, n: 2500 }]);
  assert.equal(writer.bytesWritten, 6529);

  // An index with a wrong form, or with a reference past the data, is refused. The writer stays usable.
  await assert.rejects(writer.finish({ v: 1 }), { message: EXPORT_ERRORS.badIndex });
  const past = emptyIndex();
  past.mail.push({ id: 'm', inboxId: 'i', addressId: null, direction: 'in', at: 1, seen: false, from: null, to: [], cc: [], subject: '', snippet: '', deliveredTo: '', body: { o: 6000, n: 530 }, attachments: [] });
  await assert.rejects(writer.finish(past), { message: EXPORT_ERRORS.badIndex });
  past.mail[0].body = { o: 6000, n: 529 };
  const file = await writer.finish(past);

  // After the end the writer does nothing more.
  await assert.rejects(writer.addBlob(pattern(6, 10)), /finished/);
  await assert.rejects(writer.finish(emptyIndex()), /finished/);

  const opened = await openExport(file, { accountKey: account.accountKey });
  for (const [i, p] of pieces.entries()) assert.ok(same(await opened.readBlob(refs[i]), p));
  assert.deepEqual(opened.index, past);

  // The smallest export: no blob, an empty index. And an index that fills exactly one chunk.
  const tiny = createExportWriter(options);
  const tinyFile = await tiny.finish(emptyIndex());
  const tinyOpened = await openExport(tinyFile, { recoveryBytes: account.recovery.bytes });
  assert.deepEqual(tinyOpened.index, emptyIndex());
  assert.equal(tinyOpened.header.chunkCount, 1);
  assert.equal(tinyOpened.header.indexOffset, 0);
  const exact = createExportWriter(options);
  const filler = emptyIndex();
  filler.notIncluded.push('');
  filler.notIncluded[0] = 'x'.repeat(2048 - utf8(JSON.stringify(filler)).length);
  assert.equal(utf8(JSON.stringify(filler)).length, 2048);
  const exactFile = await exact.finish(filler);
  const exactOpened = await openExport(exactFile, { accountKey: account.accountKey });
  assert.equal(exactOpened.header.chunkCount, 2);
  assert.equal(exactFile.size, exactOpened.header.fileLength);
  assert.deepEqual(exactOpened.index, filler);
  assert.equal(await exactOpened.verify(), true);
  // Text that is not ASCII goes through unchanged.
  const unicode = createExportWriter({ ...options, appName: 'Pöstern ✉' });
  const names = emptyIndex();
  names.inboxes.push({ id: 'mb', address: 'a@b.test', label: 'Zoë — 日本語 🎉', note: 'ñ', status: 'active' });
  const unicodeOpened = await openExport(await unicode.finish(names), { accountKey: account.accountKey });
  assert.equal(unicodeOpened.header.appName, 'Pöstern ✉');
  assert.equal(unicodeOpened.index.inboxes[0].label, 'Zoë — 日本語 🎉');
});

test('readExportHeader: junk input gives the plain error', async () => {
  const account = await makeAccount();
  const { file, bytes } = await smallExport(account);
  const junk = [
    new Blob([]),
    new Blob(['hello, this is a text file and not an export']),
    new Blob([pattern(7, 4096)]),
    new Blob([Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82)]), // the start of a PNG file
    new Blob(['PK\u0003\u0004 a zip file'.padEnd(600, ' ')]),
    new Blob([JSON.stringify({ v: 1, app: 'Postern' }).padEnd(600, ' ')]),
    new Blob([bytes.subarray(0, 11)]), // the magic bytes and too little after them
    new Blob([bytes.subarray(1)]), // the right file, moved by one byte
  ];
  for (const blob of junk) {
    await assert.rejects(readExportHeader(blob), { message: 'This is not a Postern export file.' });
    await assert.rejects(openExport(blob, { accountKey: account.accountKey }), { message: 'This is not a Postern export file.' });
  }
  for (const notBlob of [null, undefined, 'file.postern', 42, {}, { size: 100 }, new Uint8Array(200), bytes]) {
    await assert.rejects(readExportHeader(notBlob), { message: EXPORT_ERRORS.notExport });
  }
  // The right start, but the header is cut or has values that cannot be.
  await assert.rejects(readExportHeader(new Blob([bytes.subarray(0, 60)])), { message: EXPORT_ERRORS.incomplete });
  const zeroChunk = Uint8Array.from(bytes);
  zeroChunk.fill(0, 12, 16);
  await assert.rejects(readExportHeader(new Blob([zeroChunk])), { message: EXPORT_ERRORS.damaged });
  const badLength = Uint8Array.from(bytes);
  badLength[10] = 0xff;
  badLength[11] = 0xff;
  await assert.rejects(readExportHeader(new Blob([badLength])), { message: EXPORT_ERRORS.damaged });
  const version0 = Uint8Array.from(bytes);
  version0[9] = 0;
  await assert.rejects(readExportHeader(new Blob([version0])), { message: EXPORT_ERRORS.notExport });
  // The header alone is enough for readExportHeader. It needs no key and reads no chunk.
  const header = await readExportHeader(file);
  const onlyHeader = await readExportHeader(new Blob([bytes.subarray(0, header.headerLength)]));
  assert.equal(onlyHeader.createdDay, '2026-11-11');
  assert.equal(onlyHeader.appName, 'Postern');
  await assert.rejects(openExport(new Blob([bytes.subarray(0, header.headerLength)]), { accountKey: account.accountKey }), { message: EXPORT_ERRORS.incomplete });
});

test('estimateExportBytes: a rough size for the warning', () => {
  assert.ok(estimateExportBytes() > 0 && estimateExportBytes() < 10_000);
  assert.equal(estimateExportBytes({}), estimateExportBytes());
  const small = estimateExportBytes({ mailCount: 100, mailBytes: 5 * MIB, textCount: 50, callCount: 10, voicemailBytes: MIB, itemCount: 20 });
  // Never less than the data itself, and not much more.
  assert.ok(small > 6 * MIB && small < 7 * MIB);
  assert.ok(small < LARGE_EXPORT_BYTES);
  const large = estimateExportBytes({ mailCount: 40_000, mailBytes: 900 * MIB });
  assert.ok(large > LARGE_EXPORT_BYTES);
  // More of anything is never smaller. Values that are not counts are read as 0.
  assert.ok(estimateExportBytes({ textCount: 10 }) < estimateExportBytes({ textCount: 11 }));
  assert.equal(estimateExportBytes({ mailBytes: -5, textCount: 'many', callCount: 1.5, itemCount: null }), estimateExportBytes());
});

test('estimateExportBytes is near the real size of a file', async () => {
  const account = await makeAccount();
  const writer = createExportWriter({ accountKey: account.accountKey, recoveryWrap: account.recoveryWrap, appName: 'Postern', createdDay: '2026-11-11' });
  const index = emptyIndex();
  let mailBytes = 0;
  for (let i = 0; i < 200; i++) {
    const bytes = utf8(JSON.stringify({ text: 'x'.repeat(2000 + i), html: null }));
    mailBytes += bytes.length;
    index.mail.push({
      id: `message-id-${i}`.padEnd(22, '0'), inboxId: 'mailbox-id-0000000000000', addressId: null, direction: 'in', at: 1794000000 + i, seen: true,
      from: person('Alice'), to: [person('Me')], cc: [], subject: `Subject line number ${i}`, snippet: 'The first words of the message, as the list shows them.', deliveredTo: 'shop.x@postern.test',
      body: await writer.addBlob(bytes), attachments: [],
    });
  }
  for (let i = 0; i < 300; i++) index.texts.push({ id: `text-id-${i}`.padEnd(22, '0'), numberId: 'number-id-00000000000000', direction: 'in', at: 1794000000 + i, peer: '+13055550100', body: 'A normal text message of some length.', status: null });
  const file = await writer.finish(index);
  const guess = estimateExportBytes({ mailCount: 200, mailBytes, textCount: 300 });
  // The guess is on the high side, and within a factor of 2.
  assert.ok(guess >= file.size, `${guess} < ${file.size}`);
  assert.ok(guess < file.size * 2, `${guess} is more than 2 x ${file.size}`);
});

test('64 MB: written and read back piece by piece, never as one buffer', async () => {
  const account = await makeAccount();
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc');
  // Node.js gives the memory of a dropped buffer back some time after the current turn of
  // the event loop. So wait and clean up two times, then measure.
  const usedBuffers = async () => {
    for (let i = 0; i < 2; i++) {
      await new Promise((resolve) => { setTimeout(resolve, 15); });
      gc();
    }
    return process.memoryUsage().arrayBuffers;
  };
  const PIECE = 4 * MIB;
  const PIECES = 16; // 16 x 4 MiB = 64 MiB of blobs
  const started = Date.now();

  // Watch the sizes that go through the encryption, and the parts that the file is made of.
  const subtle = globalThis.crypto.subtle;
  const realEncrypt = subtle.encrypt;
  const realDecrypt = subtle.decrypt;
  const RealBlob = globalThis.Blob;
  const seen = { encrypt: 0, decrypt: 0, part: 0, slice: 0, whole: 0 };
  const sizeOf = (v) => (v && (v.byteLength ?? v.size ?? v.length)) || 0;
  subtle.encrypt = function (params, key, data) { seen.encrypt = Math.max(seen.encrypt, sizeOf(data)); return realEncrypt.call(this, params, key, data); };
  subtle.decrypt = function (params, key, data) { seen.decrypt = Math.max(seen.decrypt, sizeOf(data)); return realDecrypt.call(this, params, key, data); };
  globalThis.Blob = class extends RealBlob {
    constructor(parts = [], options) {
      for (const part of parts) seen.part = Math.max(seen.part, sizeOf(part));
      super(parts, options);
    }
  };
  let file;
  let refs;
  let writePeak = 0;
  try {
    const before = await usedBuffers();
    const writer = createExportWriter({ accountKey: account.accountKey, recoveryWrap: account.recoveryWrap, appName: 'Postern', createdDay: '2026-11-11' });
    refs = [];
    for (let i = 0; i < PIECES; i++) {
      // The test makes each piece, gives it to the writer, and forgets it.
      refs.push(await writer.addBlob(pattern(i, PIECE)));
      // The encrypted chunks are the file itself: the writer must keep them until the end.
      // Count what it holds on top of them. (The newest chunk is still plain, in the writer's buffer.)
      const encrypted = (Math.ceil(writer.bytesWritten / MIB) - 1) * (MIB + TAG);
      if (i % 4 === 3) writePeak = Math.max(writePeak, (await usedBuffers()) - before - encrypted);
    }
    assert.equal(writer.bytesWritten, 64 * MIB);
    const index = emptyIndex();
    index.notIncluded.push('synthetic test data');
    file = await writer.finish(index);
  } finally {
    subtle.encrypt = realEncrypt;
    subtle.decrypt = realDecrypt;
    globalThis.Blob = RealBlob;
  }
  assert.ok(file.size > 64 * MIB && file.size < 64 * MIB + 4096);
  // No piece of plain data above one chunk went into the encryption, and no part of the
  // file is larger than one encrypted chunk.
  assert.equal(seen.encrypt, MIB);
  assert.equal(seen.part, MIB + TAG);

  // Read through an object that counts what is asked of the file.
  const watched = {
    size: file.size,
    slice(start, end) { seen.slice = Math.max(seen.slice, end - start); return file.slice(start, end); },
    arrayBuffer() { seen.whole++; return file.arrayBuffer(); },
  };
  subtle.decrypt = function (params, key, data) { seen.decrypt = Math.max(seen.decrypt, sizeOf(data)); return realDecrypt.call(this, params, key, data); };
  let readPeak = 0;
  try {
    const before = await usedBuffers();
    const opened = await openExport(watched, { recoveryBytes: account.recovery.bytes });
    assert.equal(opened.header.chunkCount, 65);
    assert.deepEqual(opened.index.notIncluded, ['synthetic test data']);
    for (let i = 0; i < PIECES; i++) {
      let piece = await opened.readBlob(refs[i]);
      assert.ok(same(piece, pattern(i, PIECE)), `piece ${i} came back changed`);
      piece = null;
      if (i % 4 === 3) readPeak = Math.max(readPeak, (await usedBuffers()) - before);
    }
    // A small read in the middle of the file touches one chunk.
    const middle = await opened.readBlob({ o: 37 * MIB + 5, n: 100 });
    assert.ok(same(middle, pattern(9, PIECE).subarray(MIB + 5, MIB + 105)));
    assert.equal(await opened.verify(), true);
  } finally {
    subtle.decrypt = realDecrypt;
  }
  // The reader never asked for the whole file, and never for more than one encrypted chunk.
  assert.equal(seen.whole, 0);
  assert.equal(seen.slice, MIB + TAG);
  assert.equal(seen.decrypt, MIB + TAG);
  // A rough measure of the memory for binary buffers (after a forced clean-up).
  // Writer: on top of the encrypted chunks (which are the finished file), it holds about one
  // chunk. Reader: on top of the file, it holds one chunk and the blob that was asked for.
  // This number moves with the timing of the engine, so the limit is loose: 24 MiB, far
  // below the 64 MiB of the data. The exact proof is in the size checks above.
  assert.ok(writePeak < 24 * MIB, `the writer held ${Math.round(writePeak / MIB)} MiB of buffers on top of the file`);
  assert.ok(readPeak < 24 * MIB, `the reader held ${Math.round(readPeak / MIB)} MiB of buffers on top of the file`);
  assert.ok(Date.now() - started < 10_000, 'the 64 MB case took more than 10 seconds');
});
