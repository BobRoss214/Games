# Postern API contract

This file is the contract between the server modules and the web app.
If you must change it, change this file in the same commit.

## 1. Conventions

- All bodies are JSON. Requests that change data must send `content-type: application/json`.
- Binary values are **base64url without padding** strings (`b64u`).
- IDs are 22-character base64url strings (`randomId()`), unless stated.
- `at` values are Unix seconds. `day` values are `YYYY-MM-DD`. The server keeps day precision where it can.
- Errors: HTTP status + `{ "error": { "code": "snake_case", "message": "Plain words for the user." } }`.
  Common codes: `bad_request` 400, `not_signed_in` 401, `insufficient_funds` 402 (has `needed`),
  `bad_origin` 403, `not_found` 404, `conflict`/`taken` 409, `too_large` 413, `rate_limited` 429, `limit_reached` 409.
- Login state is one `HttpOnly; SameSite=Strict` cookie. Routes marked **(auth)** need it.
- The server must never return another account's data. Every query has `account_id = ?`. Unknown or foreign IDs give 404.
- Phone numbers are E.164: `^\+[1-9]\d{6,14}$`. Email addresses are lower case.

### Encrypted fields

| Name | Who encrypts | Who can read | How |
|---|---|---|---|
| `enc` | browser | browser | `encryptJson(vaultKey, obj, aad)`. The server stores it as an opaque blob (max 2048 bytes). |
| `sealed…` | server | browser | `sealJson(publicKey, obj, aad)` via `store.sealJsonFor(accountId, obj, aad)`. The server forgets the plain value. |
| message envelope | server (incoming) or browser (sent copy) | browser | `sealEnvelope()` in `shared/crypto.js` |

`enc` plaintext shape and AAD per item:

| Item | AAD | Plain JSON |
|---|---|---|
| mailbox | `mailbox` | `{ "label": "Personal", "note": "" }` |
| alias | `alias` | `{ "label": "Shop X", "note": "" }` |
| number | `number` | `{ "label": "Selling the bike", "note": "" }` |
| real phone | `phone` | `{ "label": "My mobile" }` |
| passkey | `passkey` | `{ "label": "Laptop" }` |
| vault value | `vault:<key>` | any JSON |

`sealed…` plaintext shape and AAD:

| Field | AAD | Plain JSON |
|---|---|---|
| `sealedAddress` | `address` | `{ "address": "quiet.river482@example.com" }` |
| `sealedNumber` (VoIP number) | `number` | `{ "number": "+14155550123" }` |
| `sealedNumber` (real phone) | `phone` | `{ "number": "+14155550199" }` |
| text `sealed` | `text` | `{ "peer": "+1415…", "body": "Hello" }` |
| call `sealed` | `call` | `{ "peer": "+1415…" }` |

**The database never stores an alias address or a VoIP number in plain form.** It stores
`keys.indexHmac('addr', address)` / `keys.indexHmac('num', number)` for lookup, plus the sealed copy.
When the browser asks for an action that needs the plain value (send mail, send text), it sends the
plain value and the server checks it against the stored HMAC.

Message envelope (mail):
- `sealedKey`: content key sealed to the account (`aad "content-key"`).
- `encMeta` (aad `meta`): `{ from: {name,address}, to: [{name,address}], cc: [...], subject, date (ISO), snippet (max 160 chars), deliveredTo: "alias@domain", attachments: [{ filename, contentType, size, cid? }] }`
- part 0 (aad `body`): `{ text, html, messageId, inReplyTo, references: [], replyTo: [{name,address}] }`
- part i ≥ 1 (aad `att:i`): raw attachment bytes, same order as `meta.attachments`.

## 2. Core (done, in `server/app.js`)

| Route | Result |
|---|---|
| `GET /api/config` | `{ appName, dev, signup: "open"\|"closed", powBits, mailDomains: [], features: { phone, pay, mockPhone, mockPay, mockMail }, phoneCountries: [], prices: { mailboxMonth, numberMonth, textOut, callMinute }, limits: { mailboxes, aliases (0 = no limit), numbers, phones, sendPerDay, maxMessageBytes } }` |
| `GET /api/events` **(auth)** | Server-sent events. Each event: `event: change`, `data: {"type": "mail"\|"text"\|"call"\|"balance"\|"mailbox"\|"number"\|"aliases"\|"phones", ...}`. The app then reloads that kind of data. |

Prices are in credits. 100 credits = 1.00 USD.

## 3. Auth module (`server/auth/`)

`account` object: `{ id, publicKey, encPrivateKey, recoveryWrap, balance, createdDay }` (key fields are b64u).

| Route | Body | Result |
|---|---|---|
| `POST /api/auth/pow` | — | `{ challenge, bits }`. The challenge is valid for 10 minutes and for one sign-up. Rate limit 20/minute per IP. |
| `POST /api/auth/signup` | `{ accountId, authKey, publicKey, encPrivateKey, recoveryWrap, pow: { challenge, nonce } }` | 201 `{ account }` + cookie. 403 `signup_closed`, 400 `bad_request`, 400 `bad_pow`, 409 `account_exists`, 503 `busy`. Rate limit 5/hour per IP. |
| `POST /api/auth/login` | `{ accountId, authKey }` | `{ account }` + cookie. 401 `bad_login` (same error for unknown account and wrong key). 400 `bad_request` if a value is not well formed. Rate limit 10/minute per IP. |
| `POST /api/auth/logout` **(auth)** | — | 204, cookie cleared, session deleted. |
| `GET /api/account` **(auth)** | — | `{ account }` |
| `DELETE /api/account` **(auth)** | `{ confirm: "delete my account" }` | 204, cookie cleared. Calls `app.deleteAccount(id)`. 400 `bad_request` if `confirm` is not exactly this text. |
| `GET /api/sessions` **(auth)** | — | `{ sessions: [{ id, createdDay, current: bool }] }`, newest first |
| `DELETE /api/sessions/:id` **(auth)** | — | 204. 404 `not_found`. If it is the current session, the cookie is cleared too. |
| `POST /api/sessions/revoke-others` **(auth)** | — | 204 |
| `GET /api/passkeys` **(auth)** | — | `{ passkeys: [{ id, enc, createdDay, hasKey: bool }] }`, oldest first. `enc` is null if the passkey has no label. |
| `POST /api/passkeys/register/options` **(auth)** | — | `{ options }` (WebAuthn creation options as JSON; `residentKey: "required"`, `userVerification: "required"`, `extensions: { prf: {} }`, `attestation: "none"`; all fields are in the notes). 409 `limit_reached` if the account has 10 passkeys. Rate limit 20/minute per account. |
| `POST /api/passkeys/register/verify` **(auth)** | `{ response, enc? }` | 201 `{ passkey }`. 400 `bad_passkey`, 400 `bad_request`, 409 `conflict`, 409 `limit_reached`. Rate limit 20/minute per account. |
| `PUT /api/passkeys/:id/key` **(auth)** | `{ wrappedKey }` (61 bytes) | 204. Stores the account key wrapped with the passkey PRF key. 400 `bad_request` if it is not exactly 61 bytes. 404 `not_found`. |
| `PATCH /api/passkeys/:id` **(auth)** | `{ enc }` (`enc: null` removes the label) | `{ passkey }`. 400 `bad_request` if `enc` is absent. 404 `not_found`. |
| `DELETE /api/passkeys/:id` **(auth)** | — | 204. 404 `not_found`. |
| `POST /api/auth/passkey/options` | — | `{ challengeId, options }` (request options; empty `allowCredentials`; `userVerification: "required"`). Rate limit 20/minute per IP. |
| `POST /api/auth/passkey/verify` | `{ challengeId, response }` | `{ account, passkeyId, wrappedKey: b64u\|null }` + cookie. 401 `bad_login` (the same error for every failed check). 400 `bad_request` if a value is not well formed. Rate limit 10/minute per IP. |
| `GET /api/vault` **(auth)** | — | `{ keys: [] }`, in alphabetical order |
| `GET /api/vault/:key` **(auth)** | — | `{ value }` (b64u) or 404 `not_found` |
| `PUT /api/vault/:key` **(auth)** | `{ value }` (b64u, 1 byte to 256 KB; max 50 keys; key matches `^[a-z0-9-]{1,40}$`) | 204. 413 `too_large`, 409 `limit_reached`, 400 `bad_request`. |
| `DELETE /api/vault/:key` **(auth)** | — | 204, also when the key does not exist. |

Rate limits give 429 `rate_limited`. "Per IP" is for routes without login, "per account" for routes with login.
All rate limits are off when `config.rateLimits` is false (the tests use this).

Sign-up notes:
- Values: `accountId` is 32 lower-case hex characters. `authKey` is 32 bytes. `publicKey` is 65 bytes, an uncompressed P-256 point
  (the server checks that the point is on the curve). `encPrivateKey` is 100 to 400 bytes. `recoveryWrap` is 61 bytes.
  A value that is not correct gives 400 `bad_request`.
- Order of the checks: `signup_closed`, then the values (`bad_request`), then the proof of work (`bad_pow`), then `account_exists`.
- `bad_pow` means: no proof, a wrong nonce, a challenge that this server did not make, a challenge older than 10 minutes,
  or a challenge that was used before.
- The first request with a correct solution uses the challenge up, also when this request then gets 409 `account_exists`.
  A wrong nonce does not use it up. After `bad_pow` or `account_exists` the browser asks for a new challenge.
- 503 `busy`: the server holds 200,000 used challenges and cannot take more now. This is not expected in normal use.
- The server keeps used challenges in memory until they expire. A restart of the server forgets them.

Session notes:
- A sign-in (recovery key or passkey) and a sign-up make a new session.
- An account keeps its newest 50 sessions. When a sign-in makes session number 51, the oldest session is deleted.

Vault notes:
- A key that does not match the pattern gives 400 `bad_request` (GET, PUT, DELETE).
- A value larger than 256 KB (262,144 bytes) gives 413 `too_large`.
- A new key number 51 gives 409 `limit_reached`. To replace the value of an existing key always works.

Passkey notes:
- `user.id` = `account.userHandle`. `user.name` = `"Postern account"` (never an identifier of the person). rpID = `config.rpId`, origin = `config.origin`.
- The passkey id is the WebAuthn credential id (base64url).
- An account can have 10 passkeys. `enc` is 1 to 2048 bytes.
- The browser asks the passkey for a PRF value with the fixed salt `SHA-256("postern/v1/prf-salt")`,
  makes `prfKek(prfOutput)`, and stores `wrapAccountKey(kek, accountKey)` with `PUT /api/passkeys/:id/key`.
  After a passkey login the browser gets `wrappedKey` back and opens the account key with the same PRF value.
  If the passkey has no PRF support, `wrappedKey` stays null and the app asks for the recovery key one time on each new browser session.
- Creation options, all fields: `rp: { name: config.appName, id: config.rpId }`, `user: { id, name: "Postern account", displayName: "Postern account" }`,
  `challenge`, `pubKeyCredParams` (EdDSA -8, ES256 -7, RS256 -257; also ML-DSA-44 -48 if the server runtime supports it), `timeout: 300000`,
  `attestation: "none"`, `excludeCredentials: [{ id, type: "public-key", transports }]` (the passkeys that the account has already),
  `authenticatorSelection: { residentKey: "required", userVerification: "required", requireResidentKey: true }`,
  `extensions: { prf: {}, credProps: true }`, `hints: []`. The values `credProps`, `hints`, and `requireResidentKey` come from the library.
- Request options, all fields: `{ rpId, challenge, allowCredentials: [], timeout: 300000, userVerification: "required" }`.
  The browser adds `extensions.prf.eval.first` itself.
- Challenges are in the memory of the server. A challenge is valid for 5 minutes and for one well-formed `verify` request, also when the check in that request fails.
  A new `register/options` request replaces the open challenge of the account. A restart of the server cancels open challenges.
- `response` for `register/verify` is the WebAuthn JSON form: `{ id, rawId, type: "public-key", response: { clientDataJSON, attestationObject, transports? } }`.
  `response` for `passkey/verify`: `{ id, rawId, type: "public-key", response: { clientDataJSON, authenticatorData, signature, userHandle? } }`.
  All binary values are b64u. The server ignores other fields. It does not read `clientExtensionResults`: the browser must not send a PRF result.
- `bad_passkey` (register): there is no open challenge, the challenge is too old or was used, or a check failed
  (wrong origin, wrong rpID, no user verification, or `id` is not the credential id in the signed data). The browser starts again with `register/options`.
- `conflict` (register): this credential is registered already, in this account or in a different account.
- `bad_login` (passkey sign-in): unknown, old, or used `challengeId`; unknown passkey; wrong signature; wrong origin or rpID; no user verification;
  a `userHandle` that is not the handle of the account; a signature counter that did not go up. The answer does not say which check failed.

## 4. Mail module (`server/mail/`)

Address rules: `local@domain`, domain is one of `config.mail.domains`, local part matches
`^[a-z0-9](?:[a-z0-9._-]{1,62}[a-z0-9])$` (3 to 64 characters), no `..`. Reserved local parts are refused
(postmaster, abuse, admin, administrator, root, hostmaster, webmaster, noreply, no-reply, mailer-daemon, support, security, info, help, billing).
If `localPart` is absent, the server makes a random readable one (`word.word123`).
A deleted address is never given out again (tombstone on its HMAC).

Errors when an address is made (`POST /api/mailboxes`, `POST /api/aliases`):
- `localPart` does not match the rules (upper case too): 400 `bad_request`. The server does not change the text to lower case.
- `domain` is not in `config.mail.domains`: 400 `bad_request`. If `domain` is absent, the first domain of the list is used.
- The address exists, or it existed before and was deleted: 409 `taken` ("This address is taken. Choose a different one."). The answer does not say which of the two.
- A reserved local part: 409 `taken` with the message "This name is reserved. Choose a different one."
- 503 `busy`: the server tried 20 random names and all were taken. 503 `mail_off`: the server has no mail domain.

| Route | Body / query | Result |
|---|---|---|
| `GET /api/mailboxes` **(auth)** | — | `{ mailboxes: [{ id, addressId, sealedAddress, enc, status: "active"\|"suspended", paidUntil, createdDay, unread, total }] }`, oldest first |
| `POST /api/mailboxes` **(auth)** | `{ localPart?, domain?, enc? }` | 201 `{ mailbox, address }`. Charges `prices.mailboxMonth` (kind `mailbox`). `address` is the plain address, returned this one time. 409 `taken`, 409 `limit_reached`, 402, 400 `bad_request`. Rate limit 60/hour per account. |
| `PATCH /api/mailboxes/:id` **(auth)** | `{ enc }` (`enc: null` removes the label) | `{ mailbox }`. 400 `bad_request` if `enc` is absent. |
| `DELETE /api/mailboxes/:id` **(auth)** | — | 204. Deletes its messages and its aliases. No credit is given back. |
| `GET /api/aliases` **(auth)** | — | `{ aliases: [{ id, mailboxId, sealedAddress, enc, enabled, createdDay, received }] }`, oldest first (`received` = count of delivered messages) |
| `POST /api/aliases` **(auth)** | `{ mailboxId, localPart?, domain?, enc? }` | 201 `{ alias, address }`. Free. 404 `not_found` (mailbox), 409 `taken`, 409 `limit_reached`, 400 `bad_request`. Rate limit 120/hour per account. |
| `PATCH /api/aliases/:id` **(auth)** | `{ enabled?, mailboxId?, enc? }` (at least one; `enc: null` removes the label) | `{ alias }`. 400 `bad_request` if no value is given. 404 `not_found` if `mailboxId` is not a mailbox of the account. |
| `DELETE /api/aliases/:id` **(auth)** | — | 204. Messages stay in the mailbox. Their `addressId` becomes null. |
| `GET /api/messages` **(auth)** | `?mailboxId=&direction=in\|out&before=<at>&beforeId=&limit=` (limit 1 to 100, default 50) | `{ messages: [{ id, mailboxId, addressId, direction, at, seen, size, attachments (count), sealedKey, encMeta }], more: bool }` newest first. 400 `bad_request` for a bad query value. 404 `not_found` if `mailboxId` is not a mailbox of the account. |
| `GET /api/messages/:id` **(auth)** | — | `{ message: { ...same fields, body: b64u (part 0) } }` |
| `GET /api/messages/:id/parts/:index` **(auth)** | index ≥ 1 | 200 `application/octet-stream` (the encrypted attachment). 404 `not_found` if the part does not exist. |
| `PATCH /api/messages/:id` **(auth)** | `{ seen: bool }` | 204 |
| `DELETE /api/messages/:id` **(auth)** | — | 204 |
| `POST /api/mail/send` **(auth)** | see below | 201 `{ id }` (`id` of the Sent copy, or null). Errors: see below. Rate limit 30/minute per account. |

All routes with `:id` give 404 `not_found` for an unknown id, for an id of a different account, and for an id that is not well formed.
An id in a body or in a query that is not well formed gives 400 `bad_request`.

Mailbox and alias notes:
- `enc` is 1 to 2048 bytes. `enc` is null if there is no label.
- `unread` = incoming messages of the mailbox that are not seen. `total` = all stored messages of the mailbox: incoming messages and Sent copies.
- `POST /api/mailboxes` checks in this order: `limit_reached` (`limits.mailboxes`), the address (`bad_request`, `taken`), then the charge (402 `insufficient_funds` with `needed`).
  A refused request charges nothing. `paidUntil` = now + 30 days. A price of 0 charges nothing.
- `limits.mailboxes` and `limits.aliases`: 0 = no limit. The alias limit counts the aliases of the account, not the mailbox addresses.
- The address of a mailbox (`mailbox.addressId`) is not an alias. It is not in `GET /api/aliases`, and the alias routes give 404 for it. It can send mail (`addressId` in `POST /api/mail/send`).
- An alias can be made for a suspended mailbox. `PATCH` with `mailboxId` moves the alias: new mail goes to the new mailbox, old messages stay where they are.
- A disabled alias gets no mail (SMTP answer 550, like an unknown address) and cannot send.
- Events for the browser: `mailbox` (mailbox made, changed, deleted, suspended, active again), `aliases` (alias made, changed, deleted; mailbox deleted),
  `mail` with `mailboxId` (new message, seen flag changed, message deleted, Sent copy stored), `balance` (after a charge).

Message notes:
- Order: `at` from new to old; messages of the same second by `id` from high to low.
- Pages: send `before` = `at` and `beforeId` = `id` of the last message of the page before. The answer has the messages after this position.
  `before` alone gives the messages with `at < before` (it skips other messages of the same second). `beforeId` alone has no effect.
- `limit` below 1, above 100, or not a number: 400 `bad_request`. `direction` other than `in` or `out`: 400 `bad_request`.
- `at` = the time when the server stored the message. `seen` is a boolean; a Sent copy is stored with `seen: true`.
- `size` = stored bytes of the message in encrypted form (sealed key + meta + all parts). The mailbox size limit uses the sum of `size`.
- `addressId` = the address that got the message (direction `in`) or sent it (direction `out`). It is null after this alias was deleted.
- `attachments` = number of parts after part 0. `parts/:index` takes an index from 1 to this number.

Content of an incoming message (the server makes it; see the envelope in section 1):
- `meta.from` is the first address of the From header, or `{ name: "", address: "" }`. `to` and `cc` have 100 entries at most. Addresses are lower case. A name has 200 characters at most.
- `meta.subject` has 998 characters at most. `meta.date` is the Date header, or the arrival time if the header is absent or not valid.
- `meta.snippet` = the first 160 characters of the text with white space collapsed. If the message has no text part, the server takes the HTML with all tags removed.
- `meta.attachments[i]`: `filename` has no path and no control characters (`attachment-N` if the sender gave no name); `contentType` is lower case;
  `size` is the size of the file in bytes; `cid` is present for an image that the HTML shows with `cid:`. The order is the order of the parts in the message.
- `body.text` is the text part. **It is `""` when the message has HTML only.** The server makes no text from HTML. The web app must make the text itself
  (for the plain view and for the quote in a reply), for example from `body.html`.
- `body.html` is the HTML part, or null. The server stores it as it arrived: scripts, remote images, and `cid:` links are still in it. The web app must clean it and show it in a sandbox.
- `body.messageId` and `body.inReplyTo` are null if the header is absent. `body.references` has 100 entries at most.
- The content of a Sent copy comes from the browser. The server cannot read it and checks sizes only.

`POST /api/mail/send` body (limit: `config.mail.maxMessageBytes` × 1.5):
```json
{
  "addressId": "…", "from": "quiet.river482@example.com", "fromName": "",
  "to": ["a@b.com"], "cc": [], "bcc": [],
  "subject": "…", "text": "…", "html": null,
  "inReplyTo": null, "references": [],
  "attachments": [{ "filename": "a.pdf", "contentType": "application/pdf", "content": "b64u" }],
  "copy": { "sealedKey": "b64u", "encMeta": "b64u", "parts": ["b64u"] }
}
```
- The server checks that `indexHmac('addr', from)` belongs to `addressId` of this account, that the address is enabled, and that its mailbox is active.
- Max 20 recipients in total. Daily limit `limits.sendPerDay` per account (429 `send_limit`). The limit counts messages, not recipients. 0 = no limit. A refused request does not count.
- Recipients on one of our own domains are delivered inside the server. Other recipients go to the relay
  (`config.mail.relayUrl`). If there is no relay and `config.dev` is true, the message goes to the simulated outbox (`app.services.mail.outbox`).
  If there is no relay and `config.dev` is false, a message with a recipient on a different server is refused (503 `no_relay`); mail between our own addresses still works.
  `features.mockMail` in `GET /api/config` is true when there is no relay.
- All recipients on our own domains are checked before anything is sent. If one of them cannot get mail, the request fails with `bad_recipient` and nobody gets the message.
- `copy` is the browser-encrypted Sent copy. The server stores it as a message with `direction: "out"` in the mailbox of the from-address.
  `id` in the answer is null if no `copy` was sent.
- Outgoing headers: no client IP, no user agent. `Message-ID` uses the from domain. Bcc recipients are in no header.
  The headers are: From, To, Cc, Subject, Date (UTC), Message-ID, In-Reply-To, References, MIME-Version, and the Content headers;
  DKIM-Signature if `DKIM_SELECTOR` and `DKIM_KEY_FILE` are set (the signing domain is the from domain).

Fields of the send body:

| Field | Rule |
|---|---|
| `addressId` | Required. An address of this account (alias or mailbox address). |
| `from` | Required. The plain address of `addressId`. Upper case letters are accepted. |
| `fromName` | Optional. Max 100 characters, no control characters. |
| `to`, `cc`, `bcc` | Arrays of addresses. Absent or null = empty. At least 1 and at most 20 different addresses in total. The server changes them to lower case. |
| recipient address | ASCII only, max 254 characters. Local part: 1 to 64 of `a-z 0-9 . _ + - = ' & ~ #`, no dot at the start or the end, no `..`. Domain: two or more labels of letters, digits, and `-`; the last label has 2 or more characters and starts with a letter (use the `xn--` form for international domains). |
| `subject` | Optional. Max 998 characters, no control characters (no line break, no tab). |
| `text` | Optional string. Can be empty. |
| `html` | Optional string or null. |
| `inReplyTo`, `references` | A Message-ID in angle brackets (a string, max 998 characters), and an array of them (max 100). A string that is not a Message-ID in angle brackets is left out; it gives no error. |
| `attachments` | Max 50. `filename`: 1 to 255 characters, no control characters. `content`: b64u, can be empty. `contentType`: optional string; parameters are removed (`text/plain; charset=utf-8` becomes `text/plain`); a text that is not `type/subtype` becomes `application/octet-stream`. |
| `copy` | Optional. `sealedKey` is exactly 126 bytes. `encMeta` is 29 bytes to 64 KB. `parts` has 1 to 51 entries. |
| size | `text` + `html` + all attachments together: max `maxMessageBytes`. The finished message (with base64 encoding of the attachments, about 37 % larger) must also be max `maxMessageBytes`. The `copy`: max `maxMessageBytes` + 64 KB. |

Errors of `POST /api/mail/send`:

| Status and code | When |
|---|---|
| 400 `bad_request` | A value is not valid, or `from` is not the address of `addressId`. |
| 400 `bad_recipient` | No recipient; more than 20 recipients; an address that is not well formed; a recipient on our own domains that does not exist or is disabled ("This address does not exist: x@…"); a recipient on our own domains with a suspended or full mailbox ("This address cannot receive mail now: x@…"). |
| 404 `not_found` | `addressId` is not an address of this account. |
| 409 `conflict` | The from-address is disabled, or its mailbox is suspended. |
| 409 `limit_reached` | The mailbox has no room for the Sent copy. |
| 413 `too_large` | The request, the content, the finished message, or the copy is over its size limit. |
| 429 `send_limit` | The daily limit is reached. |
| 429 `rate_limited` | More than 30 requests in one minute. |
| 502 `send_failed` | The relay refused the message or did not answer. Nothing was delivered, also not to our own addresses. The request does not count for the daily limit. |
| 503 `no_relay` | The message has a recipient on a different server, the server has no relay, and `config.dev` is false. |

Incoming SMTP (`smtp-server` on `config.mail.smtpPort`; port 0 = pick a free port, expose as `app.services.mail.smtpPort`):
- The server accepts mail for its own addresses only. It has no login (no AUTH) and is no relay. The greeting shows no software name and no version.
- For each accepted recipient: parse with `mailparser`, build meta/body/attachments, `sealEnvelope(publicKey, …)`, store, add 1 to `received`, `events.publish(accountId, 'mail', { mailboxId })`.
  Each recipient gets an own copy with an own content key.
- The plain message is never written to disk and never logged.
- Limits: 20 recipients for one message, 50 connections at the same time, 10 connections from one IP address, 60 seconds without activity.

SMTP answers:

| Answer | When |
|---|---|
| `250` | The message is stored for at least one recipient. |
| `550 5.1.1` | Unknown recipient, disabled alias, or an address on a domain that is not ours. |
| `450 4.2.1` | The mailbox of the recipient is suspended. |
| `452 4.2.2` | The mailbox of the recipient is full (`config.limits.mailboxBytes`, default 1 GB, 0 = no limit). The check runs before the message arrives, so a mailbox can go over the limit by one message. |
| `452` | More than 20 recipients in one message. The message is accepted for the first 20. |
| `552 5.3.4` | The message is larger than `config.mail.maxMessageBytes`. |
| `554 5.6.0` | The message cannot be parsed (for example more than 1000 MIME parts). |
| `451 4.3.0` | A temporary problem in the server. The sender tries again later. |
| `421 4.7.0` | More than 10 unknown recipients on one connection, or more than 10 connections from one IP address. The connection is closed. |
| `421` | More than 50 connections in total, or 60 seconds without activity. |

TLS on the SMTP port (STARTTLS):
- If `SMTP_TLS_KEY` and `SMTP_TLS_CERT` are set, the server uses these files. Files that cannot be read, or that do not belong together, stop the start with an error.
  If only one of the two is set, the server writes a warning and continues as if none was set.
- If they are not set, the server makes a self-signed key and certificate on the first start, with the `openssl` program:
  `smtp-selfsigned.key` (mode 0600) and `smtp-selfsigned.crt` in `config.dataDir`, common name = `config.mail.hostname`, valid for 10 years.
  Later starts use the same files. The server makes a new pair only if a file is missing or broken, if the host name changed, or if the certificate ends in less than 30 days.
- If the `openssl` program is not available, the server uses the test certificate of the `smtp-server` package and writes a warning in the log.
  The private key of this certificate is public. To fix this, install `openssl` or set the two variables.
- With configured or self-made files, the lowest protocol version is TLS 1.2.
- The server looks at the file times every 10 minutes. If the files changed (a renewed certificate), it loads them without a restart. New connections get the new certificate.
  If the new files do not belong together or cannot be read, the old certificate stays in use.

Service object: `app.services.mail = { smtpPort, outbox: [], deliverLocal({ from, to: [], raw: Buffer }) → Promise<{ accepted: [], rejected: [] }>, checkTls() → bool, tlsStatus() → { source, minVersion } }`.
- `deliverLocal` gives the lower-case addresses back. `rejected` has the addresses that are unknown, disabled, suspended, full, or not ours. It rejects (error code `EPARSE`) if the message cannot be parsed.
- `outbox` entries: `{ accountId, from, to: [], subject, at, raw: Buffer }`. The outbox keeps the newest 200 messages and 64 MB at most. It is in memory only.
- `checkTls()` runs the check of the certificate files now. It returns true if a new certificate was loaded.
- `tlsStatus()`: `source` is `"configured"`, `"generated"`, or `"default"` (the test certificate of the package). `minVersion` is `"TLSv1.2"`, or null for `"default"`.

Dev routes (register only if `config.dev`):
- `POST /api/dev/inbound-mail` **(auth)** `{ to, from?, fromName?, subject?, text?, html?, attachments?: [{filename, contentType, content}] }` → 204. Injects a message as if it came from the internet. `to` must be an address of this account.
  The fields have the same rules as in `POST /api/mail/send`. `from` is `sender@example.com` if absent. 404 `not_found` if `to` is not an address of this account. 409 `conflict` if the address cannot get mail now (disabled alias, suspended or full mailbox).
- `GET /api/dev/outbox` **(auth)** → `{ mail: [{ from, to: [], subject, at }] }` from the simulated outbox, own messages only.

Renewal: register a renewable of kind `mailbox` with `app.renewables.register(...)` (see `server/core/renew.js`). A suspended mailbox is readable but receives no mail and cannot send. There is no `expire` for mailboxes.
The user can still change and delete a suspended mailbox and its aliases.

## 5. Phone module (`server/phone/`)

| Route | Body / query | Result |
|---|---|---|
| `GET /api/numbers/search` **(auth)** | `?country=US&areaCode=415` | `{ numbers: [{ number, locality, region, country, sms, voice }] }` (max 20). Rate limit 30/minute. |
| `GET /api/numbers` **(auth)** | — | `{ numbers: [{ id, sealedNumber, enc, country, sms, voice, status: "active"\|"suspended", paidUntil, createdDay, forwardPhoneId, forwardTexts, forwardCalls, unread }] }` |
| `POST /api/numbers` **(auth)** | `{ number, enc? }` | 201 `{ number: {…}, plain: "+1…" }`. Charges `prices.numberMonth` (kind `number`). If the provider purchase fails, the charge is returned (kind `refund`). |
| `PATCH /api/numbers/:id` **(auth)** | `{ enc?, forwardPhoneId? (null clears), forwardTexts?, forwardCalls? }` | `{ number }`. `forwardPhoneId` must be a verified phone of this account. |
| `DELETE /api/numbers/:id` **(auth)** | — | 204. Releases the number at the provider. Deletes its texts and calls. |
| `GET /api/numbers/:id/texts` **(auth)** | `?before=<at>&limit=` (max 200, default 100) | `{ texts: [{ id, direction: "in"\|"out", at, seen, sealed }], more }` newest first |
| `POST /api/numbers/:id/texts` **(auth)** | `{ number, to, body }` (`number` = our own number in plain form; body max 1600 chars) | 201 `{ text }`. Charges `prices.textOut` (kind `text`). Rate limit 30/minute. |
| `POST /api/numbers/:id/texts/seen` **(auth)** | — | 204. Marks all texts of this number as seen. |
| `DELETE /api/texts/:id` **(auth)** | — | 204 |
| `GET /api/numbers/:id/calls` **(auth)** | `?before=&limit=` | `{ calls: [{ id, direction, at, seconds, status: "answered"\|"missed"\|"failed", sealed }], more }` |
| `POST /api/numbers/:id/calls` **(auth)** | `{ number, to }` | 201 `{ ok: true }`. Click-to-call: the provider calls the linked real phone, then connects it to `to` with the VoIP number as caller ID. Needs a verified forward phone on this number (409 `no_phone`). |
| `DELETE /api/calls/:id` **(auth)** | — | 204 |
| `GET /api/phones` **(auth)** | — | `{ phones: [{ id, sealedNumber, enc, verified, createdDay }] }` |
| `POST /api/phones` **(auth)** | `{ number, enc?, via: { numberId, number } }` | 201 `{ phone }`. Sends a 6-digit code by text from the VoIP number `via` (charges `textOut`). 409 `no_number` if the account has no active VoIP number. Rate limit 5/hour. |
| `POST /api/phones/:id/verify` **(auth)** | `{ code }` | `{ phone }`. 400 `bad_code`. Max 5 tries, code valid 10 minutes. |
| `DELETE /api/phones/:id` **(auth)** | — | 204. Clears forwarding that used it. |

Real phone numbers: the server must read them to forward calls and texts. Store `keys.srvEncrypt(number, 'phone')`,
plus `sealedNumber` for display. The provider reference of a VoIP number is stored with `keys.srvEncrypt(ref, 'ref')`.

Provider webhooks (no cookie; the provider signature is mandatory; reply 403 if it is wrong):
- `POST /api/hooks/phone/text` — incoming text. Seal `{ peer, body }`, store, publish `text`. If `forwardTexts` and the phone is verified and the balance allows `textOut`: send `"<peer>: <body>"` to the real phone from the VoIP number and charge.
- `POST /api/hooks/phone/voice` — incoming call. If `forwardCalls`, verified phone, and balance ≥ `callMinute`: answer with a dial instruction to the real phone (timeout 25 s). If not: say "The person you called is not available." and hang up; record a missed call.
- `POST /api/hooks/phone/bridge` — click-to-call, runs when the real phone answers: dial the destination with the VoIP number as caller ID.
- `POST /api/hooks/phone/status` — call ended. Record the call (`seconds`, `status`), charge `ceil(seconds / 60) × callMinute` (never more than the balance), publish `call`.

Provider adapters in `server/phone/providers/`: `mock.js` (in memory; used by tests and development) and `twilio.js` (REST with `fetch`, form-encoded webhooks, `X-Twilio-Signature` check, TwiML answers). Service object: `app.services.phone = { provider, … }`.

Dev routes (register only if `config.dev` and the provider is `mock`):
- `POST /api/dev/inbound-text` **(auth)** `{ numberId, number, from, body }` → 204
- `POST /api/dev/inbound-call` **(auth)** `{ numberId, number, from, seconds? }` → 204 (simulates a full call: forwarded and answered if forwarding is on, otherwise missed)
- `GET /api/dev/phone-outbox` **(auth)** → `{ texts: [{ from, to, body, at }], calls: [{ from, to, at }] }` (what the mock provider "sent")

Renewal: register a renewable of kind `number`. `expire` releases the number at the provider and deletes it.

## 6. Payments (`server/pay/`)

The payment routes do **not** use the login cookie. The web app calls them with `credentials: "omit"`.
The payment database (`app.paydb`) must not contain account IDs. The account database must not contain invoice IDs.

Credit tokens: one token = `config.pay.unitCredits` (100) credits = 1.00 USD. See `shared/blind.js` and `server/core/blindsign.js`.

| Route | Body | Result |
|---|---|---|
| `GET /api/pay/info` | — | `{ enabled, provider: "mock"\|"btcpay"\|"off", unitCredits, minUnits, maxUnits, methods: [{ id, label }], key: { id, n, e } }` |
| `POST /api/pay/invoices` | `{ units, method, keyId, blinded: [b64u × units] }` | 201 `{ invoice: { id, status: "pending", units, amountUsd, method, checkoutUrl, expiresAt } }`. Rate limit 10/hour per IP. |
| `GET /api/pay/invoices/:id` | — | `{ invoice: { id, status: "pending"\|"paid"\|"expired", units, amountUsd, method, checkoutUrl, expiresAt, keyId, signed: [b64u × units] \| null } }` |
| `POST /api/hooks/btcpay` | BTCPay webhook, raw body, header `BTCPay-Sig` | 200. The server then asks BTCPay for the invoice state. It does not trust the webhook body. |
| `POST /api/billing/redeem` **(auth)** | `{ keyId, tokens: [{ token, sig }] }` (max 200) | `{ credited, balance }`. Each token is accepted one time (409 `token_spent` if all tokens were used before; partially new sets credit only the new ones). Then `app.renewables.run(accountId)` and publish `balance`. |
| `GET /api/billing` **(auth)** | — | `{ balance, prices, ledger: [{ delta, kind, day }] }` (ledger kinds: `topup`, `mailbox`, `number`, `text`, `call`, `refund`) |

- `methods` ids: `BTC-LN` ("Bitcoin Lightning"), `XMR-CHAIN` ("Monero"), `BTC-CHAIN` ("Bitcoin on-chain"). The mock provider offers all three.
- `invoice.id` is 22 random characters. It is the only way to read the invoice. Signed values are useless without the secret blinding values in the browser.
- The server signs the blinded values only when the provider says that the invoice is settled.
- Paid invoices are deleted after 30 days. Expired invoices are deleted after 1 day. The spent-token table keeps only `SHA-256(token)`.
- The server checks pending invoices at the provider every minute, and also when the browser reads a pending invoice (not more than one check each 10 seconds per invoice).

Dev route (register only if `config.dev` and the provider is `mock`):
- `POST /api/dev/pay-invoice` `{ id }` → 204. Marks the mock invoice as paid.

Service object: `app.services.pay = { signer, markPaid(invoiceId), … }`.

## 7. Browser flow summary

Sign-up:
1. `generateRecoveryKey()` → show the text to the user (copy, download, confirm).
2. `createAccountKeys(recovery.bytes)` → `upload` goes to `POST /api/auth/signup` together with a solved proof of work.
3. Keep `local.accountKey` in `sessionStorage` (base64url) so that a page reload does not lock the app. Clear it on sign-out.
4. Offer "Add a passkey".

Sign-in with recovery key: `parseRecoveryKey(text)` → `deriveFromRecoveryKey()` → `POST /api/auth/login` → `unlockWithRecoveryKey(bytes, account)`.

Sign-in with passkey: `POST /api/auth/passkey/options` → `navigator.credentials.get` with `extensions.prf.eval.first = salt` →
`POST /api/auth/passkey/verify` → if `wrappedKey` and a PRF result exist: `unwrapAccountKey(prfKek(prf), wrappedKey)` → `unlockWithAccountKey()`.
If not: ask for the recovery key ("Unlock" screen), then offer to save the wrapped key for the next time when PRF is available.

Add funds:
1. `GET /api/pay/info`. Make `units` tokens: `newToken()`, `blind(key, token)`.
2. Save `{ keyId, units, method, tokens: [{ token, r }] }` in the vault key `pending-purchases` (encrypted) **before** the invoice request. Add the invoice id after the request.
3. `POST /api/pay/invoices` (no cookie). Open `checkoutUrl` in a new tab (mock provider: show a "Simulate payment" button that calls `/api/dev/pay-invoice`).
4. Poll `GET /api/pay/invoices/:id` (no cookie) until `paid`. `unblind()` each value. `POST /api/billing/redeem`. Remove the entry from the vault.
