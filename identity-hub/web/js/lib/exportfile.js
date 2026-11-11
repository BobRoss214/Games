// The file format of "Download my data": one encrypted file, made in the browser.
// This library writes and reads the format. It has no screen code and makes no
// network request. The server never sees the plain contents.
//
// WHICH KEY OPENS THE FILE
//   The recovery key of the account opens it, with no server. An unlocked session opens
//   it too (it has the account key). There is no extra passphrase.
//   - The file key is  hkdf(accountKey, "postern/v1/export", 32)  for AES-256-GCM.
//   - The plain header has the account's "recoveryWrap": the account key, encrypted with
//     a key that comes from the recovery key. With the recovery key the reader opens the
//     wrap, gets the account key, and derives the file key. All of this is offline.
//
// LAYOUT OF THE FILE (all numbers are big-endian)
//   Header, plain, three parts:
//     Fixed part (F bytes; known when the export starts):
//       0     8   magic          89 50 53 54 52 4E 58 0A   ("\x89PSTRNX\n")
//       8     2   version        u16, now 1
//       10    2   F              u16, length of the fixed part
//       12    4   chunk size     u32, plain bytes in one chunk (default 1 MiB)
//       16    8   nonce prefix   random, new for each file
//       24    10  created day    "YYYY-MM-DD" (the day only, no time)
//       34    1   A              u8, length of the app name
//       35    A   app name       UTF-8
//       35+A  2   W              u16, length of the recovery wrap
//       37+A  W   recovery wrap  as the server stores it for the account
//     Final part (known when the export ends):
//       F     8   total length   u64, bytes of the plaintext stream
//       F+8   8   index offset   u64, where the index starts in the plaintext stream
//       F+16  8   index length   u64
//     F+24  16  header tag       AES-GCM tag over the fixed part and the final part
//                                (empty plaintext, nonce = prefix + FF FF FF FF)
//   Body: the plaintext stream, cut into chunks of "chunk size" bytes (the last chunk can
//   be shorter, never empty). Chunk i is stored as  AES-256-GCM(plain chunk) + 16-byte tag:
//       nonce            = nonce prefix (8) + i as u32
//       additional data  = SHA-256(fixed part) (32) + i as u32 + 1 byte: 1 for the last chunk, else 0
//   So chunk i starts at  header length + i × (chunk size + 16).
//
//   The header has no account ID and no counts. It shows the app name, the day, the
//   chunk size and the sizes, and the recovery wrap. The wrap is the same in each export
//   of one account, so two exports of one account can be recognised as such.
//
// THE PLAINTEXT STREAM
//   First the binary blobs, one after the other (mail bodies as UTF-8 JSON, attachments,
//   voicemail audio). Then the index: one UTF-8 JSON value (see INDEX_SCHEMA_V1). The index
//   names a blob as  { o: offset, n: length }  in the plaintext stream. The index is the
//   last part of the stream.
//
// WHAT THE READER DETECTS
//   - A wrong key: the recovery wrap or the header tag does not open.
//   - A changed header: the header tag fails. (With an account key, a changed header and
//     a wrong key look the same. With a recovery key the reader can tell them apart.)
//   - A changed byte in a chunk or in its tag: that chunk does not open.
//   - Chunks that were moved, swapped, or copied from a different place or file: the
//     chunk number and the header hash are part of the additional data.
//   - A file that was cut, or that lost or got chunks: the header says how long the file
//     must be, and the last chunk is marked.
//   A chunk is checked when it is read. open() reads the header and the index only.
//   verify() reads all chunks.
//   Reading a byte range decrypts only the chunks that cover it.
//
// LIMITS (be honest with the user)
//   - One blob: 64 MB at most (MAX_BLOB_BYTES). The index: 64 MB at most (MAX_INDEX_BYTES).
//   - The format itself allows very large files. The browser is the real limit:
//       * The writer keeps one chunk of plain data in memory. But the finished file is one
//         Blob, and the browser must hold all encrypted chunks until the download starts.
//         A desktop browser can put a large Blob on the disk. A phone has much less room.
//       * The index is built in memory, and it is in memory again when a file is opened.
//       * The app must get every message from the server, one by one, and decrypt it.
//         A huge inbox takes a long time, and the tab must stay open.
//   - As a rule: up to a few hundred MB works on a desktop computer. Above
//     LARGE_EXPORT_BYTES (256 MB) the app must warn. On a phone, expect problems far below that.
//     Use estimateExportBytes() before the export starts.
//
// The same AES key is used for many files. That is safe as long as no (key, nonce) pair
// repeats: each file has a new random 8-byte prefix, and the last 4 bytes count the chunks.
import { utf8, fromUtf8, randomBytes, concat } from '/shared/bytes.js';
import { sha256, hkdf, aesKey, deriveFromRecoveryKey, unwrapAccountKey } from '/shared/crypto.js';

export const EXPORT_FORMAT_VERSION = 1;
export const INDEX_VERSION = 1;
export const DEFAULT_CHUNK_BYTES = 1024 * 1024;
export const MIN_CHUNK_BYTES = 1024;
export const MAX_CHUNK_BYTES = 16 * 1024 * 1024;
export const MAX_BLOB_BYTES = 64 * 1024 * 1024;
export const MAX_INDEX_BYTES = 64 * 1024 * 1024;
// Above this size the app must warn the user before it starts (see LIMITS above).
export const LARGE_EXPORT_BYTES = 256 * 1024 * 1024;
export const EXPORT_MIME_TYPE = 'application/octet-stream';

// The messages are for the user. They say what is wrong and never show a key or file content.
export const EXPORT_ERRORS = Object.freeze({
  notExport: 'This is not a Postern export file.',
  tooNew: 'This export file was made by a newer version of the app. Update the app, then open the file again.',
  wrongKey: 'This key does not open this file.',
  damaged: 'This file is damaged or was changed. It cannot be opened safely.',
  incomplete: 'This file is not complete. Use a different copy of the file.',
  badIndex: 'This export file has a list of contents that this app cannot read.',
  blobTooLarge: 'One item is larger than 64 MB. It cannot be put in the export.',
  indexTooLarge: 'The list of contents is too large for one export. Export fewer items.',
});

const MAGIC = Uint8Array.of(0x89, 0x50, 0x53, 0x54, 0x52, 0x4e, 0x58, 0x0a);
const KEY_INFO = 'postern/v1/export';
const TAG_BYTES = 16;
const PREFIX_BYTES = 8;
const FINAL_BYTES = 24;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const APP_NAME_MAX = 64;
const WRAP_MIN = 29;
const WRAP_MAX = 255;
const HEADER_MAX = 37 + APP_NAME_MAX + WRAP_MAX + FINAL_BYTES + TAG_BYTES;
// The header tag uses this chunk number for its nonce. No chunk can have it.
const HEADER_COUNTER = 0xffffffff;
const subtle = globalThis.crypto.subtle;

function fail(message, cause) {
  const err = new Error(message);
  if (cause !== undefined) err.detail = cause;
  return err;
}
const isBytes = (v, length) => v instanceof Uint8Array && (length === undefined || v.length === length);
const isCount = (v) => Number.isSafeInteger(v) && v >= 0;

function nonce(prefix, counter) {
  const out = new Uint8Array(PREFIX_BYTES + 4);
  out.set(prefix, 0);
  new DataView(out.buffer).setUint32(PREFIX_BYTES, counter);
  return out;
}
// The additional data of chunk `index`: header hash + chunk number + "last chunk" flag.
function chunkAad(headerHash, index, last) {
  const out = new Uint8Array(32 + 5);
  out.set(headerHash, 0);
  new DataView(out.buffer).setUint32(32, index);
  out[36] = last ? 1 : 0;
  return out;
}
const fileKey = async (accountKey) => aesKey(await hkdf(accountKey, KEY_INFO, 32));

function buildFixedPart({ chunkSize, prefix, createdDay, appName, recoveryWrap }) {
  const name = utf8(appName);
  const length = 37 + name.length + recoveryWrap.length;
  const out = new Uint8Array(length);
  const view = new DataView(out.buffer);
  out.set(MAGIC, 0);
  view.setUint16(8, EXPORT_FORMAT_VERSION);
  view.setUint16(10, length);
  view.setUint32(12, chunkSize);
  out.set(prefix, 16);
  out.set(utf8(createdDay), 24);
  out[34] = name.length;
  out.set(name, 35);
  view.setUint16(35 + name.length, recoveryWrap.length);
  out.set(recoveryWrap, 37 + name.length);
  return out;
}
function buildFinalPart(totalLength, indexOffset, indexLength) {
  const out = new Uint8Array(FINAL_BYTES);
  const view = new DataView(out.buffer);
  view.setBigUint64(0, BigInt(totalLength));
  view.setBigUint64(8, BigInt(indexOffset));
  view.setBigUint64(16, BigInt(indexLength));
  return out;
}
const headerTagParams = (prefix, fixed, final) => ({ name: 'AES-GCM', iv: nonce(prefix, HEADER_COUNTER), additionalData: concat(fixed, final), tagLength: 128 });

// ---------------------------------------------------------------------------
// The index
// ---------------------------------------------------------------------------

// Index schema, version 1. Words: "string", "bool", "count" (a whole number, 0 or more),
// "day" (YYYY-MM-DD), "direction" ("in" or "out"), "ref" ({ o, n }: a blob in the file),
// "object" (any JSON object, for example random identifiers). "?" at the end: null is allowed.
// [x] is a list of x. A field that is not named here is permitted and ignored.
// The blob of an attachment or of a voicemail is null when the person chose to leave the
// large files out: the entry then says what there was, and the bytes are not in the file.
const PERSON = Object.freeze({ name: 'string', address: 'string' });
export const INDEX_SCHEMA_V1 = Object.freeze({
  v: 'version',
  app: 'string',
  createdDay: 'day',
  inboxes: [{ id: 'string', address: 'string', label: 'string', note: 'string', status: 'string' }],
  aliases: [{ id: 'string', address: 'string', inboxId: 'string', label: 'string', note: 'string', enabled: 'bool', identityId: 'string?', persona: 'object?', expiresAt: 'count?' }],
  numbers: [{ id: 'string', number: 'string', label: 'string', note: 'string', identityId: 'string?', persona: 'object?' }],
  phones: [{ id: 'string', number: 'string', label: 'string' }],
  identities: [{ id: 'string', name: 'string', note: 'string', persona: 'object?', createdDay: 'string' }],
  mail: [{
    id: 'string', inboxId: 'string', addressId: 'string?', direction: 'direction', at: 'count', seen: 'bool',
    from: { $or: null, ...PERSON }, to: [PERSON], cc: [PERSON], subject: 'string', snippet: 'string', deliveredTo: 'string',
    body: 'ref', attachments: [{ filename: 'string', contentType: 'string', size: 'count', blob: 'ref?' }],
  }],
  texts: [{ id: 'string', numberId: 'string', direction: 'direction', at: 'count', peer: 'string', body: 'string', status: 'string?' }],
  calls: [{
    id: 'string', numberId: 'string', direction: 'direction', at: 'count', seconds: 'count', status: 'string', peer: 'string',
    voicemail: { $or: null, seconds: 'count', contentType: 'string', blob: 'ref?' },
  }],
  blocks: [{ addressId: 'string', kind: 'string', value: 'string' }],
  notIncluded: ['string'],
});

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Returns the path of the first value that has a wrong form, or '' if all is right.
function findBad(value, schema, path, dataLength) {
  if (typeof schema === 'string') {
    const optional = schema.endsWith('?');
    if (optional && value === null) return '';
    const kind = optional ? schema.slice(0, -1) : schema;
    let ok = false;
    if (kind === 'string') ok = typeof value === 'string';
    else if (kind === 'bool') ok = typeof value === 'boolean';
    else if (kind === 'count') ok = isCount(value);
    else if (kind === 'day') ok = typeof value === 'string' && DAY.test(value);
    else if (kind === 'direction') ok = value === 'in' || value === 'out';
    else if (kind === 'version') ok = value === INDEX_VERSION;
    else if (kind === 'object') ok = isObject(value);
    else if (kind === 'ref') {
      ok = isObject(value) && isCount(value.o) && isCount(value.n) && value.n <= MAX_BLOB_BYTES
        && (dataLength === undefined || value.o + value.n <= dataLength);
    }
    return ok ? '' : path;
  }
  if (Array.isArray(schema)) {
    if (!Array.isArray(value)) return path;
    for (let i = 0; i < value.length; i++) {
      const bad = findBad(value[i], schema[0], `${path}[${i}]`, dataLength);
      if (bad) return bad;
    }
    return '';
  }
  if (Object.hasOwn(schema, '$or') && value === schema.$or) return '';
  if (!isObject(value)) return path;
  for (const key of Object.keys(schema)) {
    if (key === '$or') continue;
    if (!Object.hasOwn(value, key)) return `${path}.${key}`;
    const bad = findBad(value[key], schema[key], `${path}.${key}`, dataLength);
    if (bad) return bad;
  }
  return '';
}

// Checks an index against INDEX_SCHEMA_V1. A viewer must call this before it trusts the
// contents of a file. Returns the same object. Throws an Error with a plain message if a
// value is absent or has a wrong type; err.path names that value (for example "mail[3].body").
// dataLength (optional): each blob reference must end at or before this offset.
export function validateIndex(index, { dataLength } = {}) {
  let bad = isObject(index) ? '' : 'index';
  // A version that this code does not know is refused first, with its own path.
  if (!bad && index.v !== INDEX_VERSION) bad = 'index.v';
  if (!bad) bad = findBad(index, INDEX_SCHEMA_V1, 'index', dataLength);
  if (bad) {
    const err = fail(EXPORT_ERRORS.badIndex);
    err.path = bad.replace(/^index\.?/, '') || 'index';
    throw err;
  }
  return index;
}

// ---------------------------------------------------------------------------
// Size
// ---------------------------------------------------------------------------

// A rough size of the finished file in bytes, for a warning before the export starts.
// counts: { mailCount, mailBytes, textCount, callCount, voicemailBytes, itemCount }
//   mailBytes: the sum of the `size` values of the messages (bodies and attachments).
//   voicemailBytes: the sum of the `size` values of the voicemails.
//   itemCount: inboxes + aliases + numbers + phones + identities + blocks.
// Compare the result with LARGE_EXPORT_BYTES.
export function estimateExportBytes(counts = {}) {
  const n = (v) => (isCount(v) ? v : 0);
  const blobs = n(counts.mailBytes) + n(counts.voicemailBytes);
  // One line in the index for each message, text, call, and item. These are typical sizes of the JSON.
  const index = 2000 + n(counts.mailCount) * 700 + n(counts.textCount) * 300 + n(counts.callCount) * 200 + n(counts.itemCount) * 500;
  const plain = blobs + index;
  const chunks = Math.ceil(plain / DEFAULT_CHUNK_BYTES);
  return HEADER_MAX + plain + chunks * TAG_BYTES;
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

// Makes an export file piece by piece. Only one chunk of plain data is in memory at a time.
// Each full chunk is encrypted at once and kept as a Blob part.
//
//   accountKey    Uint8Array(32), from the unlocked session
//   recoveryWrap  Uint8Array, account.recoveryWrap from the server
//   appName       text for the header (64 bytes at most)
//   createdDay    "YYYY-MM-DD"
//   chunkSize     plain bytes in one chunk (1 KiB to 16 MiB; default 1 MiB)
//
// Returns { addBlob, finish, bytesWritten }:
//   addBlob(bytes) → Promise<{ o, n }>   Appends bytes (Uint8Array) to the file and gives the
//                    reference for the index. Do not change the bytes before the promise resolves.
//                    Calls are written in the order in which they were made.
//   finish(index)  → Promise<Blob>       Checks the index (validateIndex), appends it, and gives
//                    the finished file. The writer cannot be used after that.
//   bytesWritten   plain bytes that were given to the writer until now
export function createExportWriter({ accountKey, recoveryWrap, appName, createdDay, chunkSize = DEFAULT_CHUNK_BYTES } = {}) {
  if (!isBytes(accountKey, 32)) throw fail('The account key is not valid.');
  if (!isBytes(recoveryWrap) || recoveryWrap.length < WRAP_MIN || recoveryWrap.length > WRAP_MAX) throw fail('The recovery data of the account is not valid.');
  if (typeof appName !== 'string' || utf8(appName).length > APP_NAME_MAX) throw fail('The app name is not valid.');
  if (typeof createdDay !== 'string' || !DAY.test(createdDay)) throw fail('The day is not valid.');
  if (!Number.isInteger(chunkSize) || chunkSize < MIN_CHUNK_BYTES || chunkSize > MAX_CHUNK_BYTES) throw fail('The chunk size is not valid.');

  const prefix = randomBytes(PREFIX_BYTES);
  const fixed = buildFixedPart({ chunkSize, prefix, createdDay, appName, recoveryWrap });
  const ready = Promise.all([fileKey(accountKey), sha256(fixed)]);
  const buffer = new Uint8Array(chunkSize); // the plain chunk that is not full yet
  const parts = []; // encrypted chunks, as Blobs
  let used = 0;
  let chunkIndex = 0;
  let position = 0; // plain bytes that were accepted
  let open = true;
  let queue = ready.then(() => {});

  async function flush(last) {
    const [key, headerHash] = await ready;
    if (chunkIndex >= HEADER_COUNTER) throw fail('The export has too many chunks.');
    const data = await subtle.encrypt({ name: 'AES-GCM', iv: nonce(prefix, chunkIndex), additionalData: chunkAad(headerHash, chunkIndex, last), tagLength: 128 }, key, buffer.subarray(0, used));
    parts.push(new Blob([data]));
    chunkIndex++;
    used = 0;
  }
  async function write(bytes) {
    let done = 0;
    while (done < bytes.length) {
      // A full chunk is written only when more data comes. So the chunk that is in the
      // buffer at the end is the last chunk, and it is never empty.
      if (used === chunkSize) await flush(false);
      const take = Math.min(chunkSize - used, bytes.length - done);
      buffer.set(bytes.subarray(done, done + take), used);
      used += take;
      done += take;
    }
  }
  function append(bytes) {
    const ref = { o: position, n: bytes.length };
    position += bytes.length;
    queue = queue.then(() => write(bytes));
    return queue.then(() => ref);
  }

  return {
    get bytesWritten() { return position; },

    addBlob(bytes) {
      if (!open) return Promise.reject(fail('This export is finished. Start a new export.'));
      const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
      if (!isBytes(view)) return Promise.reject(fail('An item of the export is not binary data.'));
      if (view.length > MAX_BLOB_BYTES) return Promise.reject(fail(EXPORT_ERRORS.blobTooLarge));
      return append(view);
    },

    async finish(index) {
      if (!open) throw fail('This export is finished. Start a new export.');
      // Every blob reference of the index must point into the data that was written.
      validateIndex(index, { dataLength: position });
      const json = utf8(JSON.stringify(index));
      if (json.length > MAX_INDEX_BYTES) throw fail(EXPORT_ERRORS.indexTooLarge);
      open = false;
      const indexOffset = position;
      await append(json);
      await flush(true);
      const [key] = await ready;
      const final = buildFinalPart(position, indexOffset, json.length);
      const tag = new Uint8Array(await subtle.encrypt(headerTagParams(prefix, fixed, final), key, new Uint8Array(0)));
      return new Blob([fixed, final, tag, ...parts], { type: EXPORT_MIME_TYPE });
    },
  };
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

const isBlob = (v) => v !== null && typeof v === 'object' && typeof v.size === 'number' && typeof v.slice === 'function' && typeof v.arrayBuffer === 'function';
const readBytes = async (blob, start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer());

// Reads and checks the plain header. It needs no key, so it proves nothing about the
// contents: use it to show "export of <day>" before the user gives a key.
// Returns { version, appName, createdDay, chunkSize, totalLength, indexOffset, indexLength,
//           recoveryWrap, headerLength, chunkCount, fileLength }.
// Throws an Error with a plain message if this is not an export file, or if it has a newer version.
export async function readExportHeader(blob) {
  if (!isBlob(blob) || blob.size < 12) throw fail(EXPORT_ERRORS.notExport);
  const head = await readBytes(blob, 0, Math.min(blob.size, HEADER_MAX));
  for (let i = 0; i < MAGIC.length; i++) if (head[i] !== MAGIC[i]) throw fail(EXPORT_ERRORS.notExport);
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const version = view.getUint16(8);
  if (version < 1) throw fail(EXPORT_ERRORS.notExport);
  if (version > EXPORT_FORMAT_VERSION) throw fail(EXPORT_ERRORS.tooNew);

  const fixedLength = view.getUint16(10);
  const headerLength = fixedLength + FINAL_BYTES + TAG_BYTES;
  if (fixedLength < 37 + WRAP_MIN || headerLength > HEADER_MAX) throw fail(EXPORT_ERRORS.damaged);
  if (head.length < headerLength) throw fail(EXPORT_ERRORS.incomplete);
  const nameLength = head[34];
  if (nameLength > APP_NAME_MAX || 37 + nameLength > fixedLength) throw fail(EXPORT_ERRORS.damaged);
  const wrapLength = view.getUint16(35 + nameLength);
  if (wrapLength < WRAP_MIN || wrapLength > WRAP_MAX || 37 + nameLength + wrapLength !== fixedLength) throw fail(EXPORT_ERRORS.damaged);

  const chunkSize = view.getUint32(12);
  let appName;
  let createdDay;
  try {
    appName = fromUtf8(head.subarray(35, 35 + nameLength));
    createdDay = fromUtf8(head.subarray(24, 34));
  } catch {
    throw fail(EXPORT_ERRORS.damaged);
  }
  const big = (offset) => {
    const v = view.getBigUint64(fixedLength + offset);
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw fail(EXPORT_ERRORS.damaged);
    return Number(v);
  };
  const totalLength = big(0);
  const indexOffset = big(8);
  const indexLength = big(16);
  // The index is the last part of the plaintext stream, and it is never empty.
  if (!DAY.test(createdDay) || chunkSize < MIN_CHUNK_BYTES || chunkSize > MAX_CHUNK_BYTES
    || indexLength < 2 || indexLength > MAX_INDEX_BYTES || indexOffset + indexLength !== totalLength) {
    throw fail(EXPORT_ERRORS.damaged);
  }
  const chunkCount = Math.ceil(totalLength / chunkSize);
  if (chunkCount >= HEADER_COUNTER) throw fail(EXPORT_ERRORS.damaged);
  return {
    version, appName, createdDay, chunkSize, totalLength, indexOffset, indexLength,
    recoveryWrap: head.slice(37 + nameLength, fixedLength),
    headerLength, chunkCount,
    fileLength: headerLength + totalLength + chunkCount * TAG_BYTES,
    // For the reader below. Not for the screen.
    fixedPart: head.slice(0, fixedLength),
    finalPart: head.slice(fixedLength, fixedLength + FINAL_BYTES),
    headerTag: head.slice(fixedLength + FINAL_BYTES, headerLength),
    noncePrefix: head.slice(16, 16 + PREFIX_BYTES),
  };
}

// Opens an export file with the recovery key or with the account key.
//   blob           a Blob or File. It is read in pieces with blob.slice(); never as a whole.
//   recoveryBytes  Uint8Array(20): the recovery key (parseRecoveryKey() makes it from the text)
//   accountKey     Uint8Array(32): the account key of an unlocked session
// Returns { header, index, readBlob, readJson, verify }:
//   readBlob({ o, n }) → Promise<Uint8Array>   the bytes of one blob (only its chunks are decrypted)
//   readJson({ o, n }) → Promise<any>          a blob that is UTF-8 JSON (a mail body)
//   verify(onProgress?) → Promise<true>        reads every chunk; throws if one is damaged.
//                                              onProgress(chunksDone, chunkCount) is optional.
// The index was checked with validateIndex(). A wrong key throws "This key does not open this file."
export async function openExport(blob, { recoveryBytes, accountKey } = {}) {
  const header = await readExportHeader(blob);
  let secret = accountKey;
  let fromRecovery = false;
  if (recoveryBytes !== undefined) {
    if (!isBytes(recoveryBytes) || recoveryBytes.length === 0) throw fail(EXPORT_ERRORS.wrongKey);
    try {
      const derived = await deriveFromRecoveryKey(recoveryBytes);
      secret = await unwrapAccountKey(derived.recoveryKek, header.recoveryWrap);
    } catch {
      throw fail(EXPORT_ERRORS.wrongKey);
    }
    fromRecovery = true;
  }
  if (!isBytes(secret, 32)) throw fail(EXPORT_ERRORS.wrongKey);
  const key = await fileKey(secret);
  try {
    await subtle.decrypt(headerTagParams(header.noncePrefix, header.fixedPart, header.finalPart), key, header.headerTag);
  } catch {
    // The recovery key opened the wrap, so the key is right and the header is not.
    throw fail(fromRecovery ? EXPORT_ERRORS.damaged : EXPORT_ERRORS.wrongKey);
  }
  // The header is authentic now. It says how long the file must be.
  if (blob.size < header.fileLength) throw fail(EXPORT_ERRORS.incomplete);
  if (blob.size > header.fileLength) throw fail(EXPORT_ERRORS.damaged);

  const { chunkSize, chunkCount, totalLength, headerLength } = header;
  const headerHash = await sha256(header.fixedPart);
  let cached = { index: -1, bytes: null }; // the last chunk that was read: small blobs are often neighbours

  async function readChunk(i) {
    if (cached.index === i) return cached.bytes;
    const last = i === chunkCount - 1;
    const plainLength = last ? totalLength - i * chunkSize : chunkSize;
    const start = headerLength + i * (chunkSize + TAG_BYTES);
    const data = await readBytes(blob, start, start + plainLength + TAG_BYTES);
    if (data.length !== plainLength + TAG_BYTES) throw fail(EXPORT_ERRORS.incomplete);
    let bytes;
    try {
      bytes = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce(header.noncePrefix, i), additionalData: chunkAad(headerHash, i, last), tagLength: 128 }, key, data));
    } catch {
      throw fail(EXPORT_ERRORS.damaged);
    }
    cached = { index: i, bytes };
    return bytes;
  }
  async function readRange(o, n) {
    const out = new Uint8Array(n);
    if (n === 0) return out;
    const end = o + n;
    for (let i = Math.floor(o / chunkSize); i * chunkSize < end; i++) {
      const base = i * chunkSize;
      const chunk = await readChunk(i);
      const from = Math.max(o, base);
      out.set(chunk.subarray(from - base, Math.min(end, base + chunkSize) - base), from - o);
    }
    return out;
  }

  let index;
  try {
    index = JSON.parse(fromUtf8(await readRange(header.indexOffset, header.indexLength)));
  } catch (err) {
    if (err instanceof Error && Object.values(EXPORT_ERRORS).includes(err.message)) throw err;
    throw fail(EXPORT_ERRORS.badIndex);
  }
  // Blobs are before the index. A reference into the index or past the end is refused.
  validateIndex(index, { dataLength: header.indexOffset });

  async function readBlob(ref) {
    if (!isObject(ref) || !isCount(ref.o) || !isCount(ref.n) || ref.n > MAX_BLOB_BYTES || ref.o + ref.n > header.indexOffset) {
      throw fail(EXPORT_ERRORS.badIndex);
    }
    return readRange(ref.o, ref.n);
  }

  return {
    header: {
      version: header.version, appName: header.appName, createdDay: header.createdDay, chunkSize,
      totalLength, indexOffset: header.indexOffset, indexLength: header.indexLength, chunkCount, fileLength: header.fileLength,
    },
    index,
    readBlob,
    async readJson(ref) {
      const bytes = await readBlob(ref);
      try {
        return JSON.parse(fromUtf8(bytes));
      } catch {
        throw fail(EXPORT_ERRORS.damaged);
      }
    },
    async verify(onProgress) {
      for (let i = 0; i < chunkCount; i++) {
        await readChunk(i);
        if (typeof onProgress === 'function') onProgress(i + 1, chunkCount);
      }
      return true;
    },
  };
}
