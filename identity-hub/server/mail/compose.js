// Builds the raw MIME message for outgoing mail, and checks the message fields of a request.
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import { fail, need } from '../core/http.js';
import { parseAddress } from './address.js';
import { quietError } from './errors.js';

export const MAX_RECIPIENTS = 20;
const MAX_ATTACHMENTS = 50;
const MAX_REFERENCES = 100;
const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;
const CONTENT_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;
// A Message-ID in angle brackets, printable ASCII only.
const MESSAGE_ID = /^<[\x21-\x3b\x3d\x3f-\x7e]{1,300}>$/;

const badRecipient = (message) => fail(400, 'bad_recipient', message);
const tooLarge = () => fail(413, 'too_large', 'The message is too large.');

function addressList(value, name) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_RECIPIENTS) throw fail(400, 'bad_request', `The value "${name}" is not valid.`);
  return value.map((item) => {
    const parsed = parseAddress(item);
    // The text is not repeated in the error: it did not pass the check and can hold anything.
    if (!parsed) throw badRecipient('One of the addresses is not valid. Check the recipients.');
    return parsed;
  });
}

// Message-IDs come from mail of other people. An entry that is not well formed is dropped,
// so that a strange message can still get a reply.
function messageIds(value, name) {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  if (list.length > MAX_REFERENCES) throw fail(400, 'bad_request', `The value "${name}" is not valid.`);
  return list.map((v) => need.string(v, name, { min: 0, max: 998 }).trim()).filter((v) => MESSAGE_ID.test(v));
}

function attachmentList(value, maxBytes) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) throw fail(400, 'bad_request', 'The value "attachments" is not valid.');
  return value.map((item) => {
    if (item === null || typeof item !== 'object') throw fail(400, 'bad_request', 'The value "attachments" is not valid.');
    const contentType = item.contentType === undefined || item.contentType === null || item.contentType === ''
      ? 'application/octet-stream'
      : need.string(String(item.contentType).toLowerCase(), 'attachments.contentType', { min: 3, max: 255, pattern: CONTENT_TYPE });
    return {
      filename: need.string(item.filename, 'attachments.filename', { min: 1, max: 255, pattern: NO_CONTROL }),
      contentType,
      content: need.bytes(item.content, 'attachments.content', { min: 0, max: maxBytes }),
    };
  });
}

// Reads and checks the message fields that the send route and the development route share.
export function readMessageFields(body, maxBytes) {
  const out = {
    fromName: need.optional(body.fromName, need.string, 'fromName', { min: 0, max: 100, pattern: NO_CONTROL }) || '',
    to: addressList(body.to, 'to'),
    cc: addressList(body.cc, 'cc'),
    bcc: addressList(body.bcc, 'bcc'),
    subject: need.optional(body.subject, need.string, 'subject', { min: 0, max: 998, pattern: NO_CONTROL }) || '',
    text: need.optional(body.text, need.string, 'text', { min: 0, max: maxBytes }) || '',
    html: need.optional(body.html, need.string, 'html', { min: 0, max: maxBytes }) || null,
    inReplyTo: messageIds(body.inReplyTo, 'inReplyTo')[0] || null,
    references: messageIds(body.references, 'references'),
    attachments: attachmentList(body.attachments, maxBytes),
  };
  let size = Buffer.byteLength(out.text) + (out.html ? Buffer.byteLength(out.html) : 0);
  for (const a of out.attachments) size += a.content.length;
  if (size > maxBytes) throw tooLarge();
  return out;
}

export function createComposer(app) {
  const { config } = app;
  // This transport sends nothing. It only builds the message and returns it as a Buffer.
  // File and URL access are off: content comes from the request body only.
  const builder = nodemailer.createTransport({
    streamTransport: true, buffer: true, newline: 'windows', disableFileAccess: true, disableUrlAccess: true,
  });
  const dkimKey = config.mail.dkimSelector && config.mail.dkimKeyFile ? readFileSync(config.mail.dkimKeyFile, 'utf8') : null;

  // Returns the raw message. `envelopeTo` lists all recipients; Bcc recipients are in no header.
  return async function compose({ from, fromName = '', to = [], cc = [], envelopeTo, subject, text, html, inReplyTo, references = [], attachments = [], sign = true }) {
    const domain = from.slice(from.lastIndexOf('@') + 1);
    const message = {
      // Address objects, so that the library does not parse the text of an address again.
      from: { name: fromName, address: from },
      to: to.map((address) => ({ name: '', address })),
      cc: cc.map((address) => ({ name: '', address })),
      envelope: { from, to: envelopeTo },
      subject,
      text,
      // The headers must not identify the browser or the user: a random id, no X-Mailer, no Received.
      messageId: `<${randomBytes(16).toString('hex')}@${domain}>`,
      date: new Date(),
      xMailer: false,
      attachments: attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, content: a.content, contentDisposition: 'attachment' })),
    };
    if (html) message.html = html;
    if (inReplyTo) message.inReplyTo = inReplyTo;
    if (references.length) message.references = references;
    if (sign && dkimKey) message.dkim = { domainName: domain, keySelector: config.mail.dkimSelector, privateKey: dkimKey };
    let raw;
    try {
      raw = (await builder.sendMail(message)).message;
    } catch {
      throw quietError('The message could not be built.', 'ECOMPOSE');
    }
    if (raw.length > config.mail.maxMessageBytes) throw tooLarge();
    return raw;
  };
}
