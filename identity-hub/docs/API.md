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
| blocked sender `sealed` | `block` | `{ "kind": "address"\|"domain", "value": "spam@shop.example" }` |

**The database never stores an alias address or a VoIP number in plain form.** It stores
`keys.indexHmac('addr', address)` / `keys.indexHmac('num', number)` for lookup, plus the sealed copy.
When the browser asks for an action that needs the plain value (send mail, send text), it sends the
plain value and the server checks it against the stored HMAC.

Message envelope (mail):
- `sealedKey`: content key sealed to the account (`aad "content-key"`).
- `encMeta` (aad `meta`): `{ from: {name,address}, to: [{name,address}], cc: [...], subject, date (ISO), snippet (max 160 chars), deliveredTo: "alias@domain", attachments: [{ filename, contentType, size, cid? }], bulk: bool }` (`bulk` = newsletter or list mail)
- part 0 (aad `body`): `{ text, html, messageId, inReplyTo, references: [], replyTo: [{name,address}], unsubscribe: { mailto, subject, hasLink } \| null }`
- part i ≥ 1 (aad `att:i`): raw attachment bytes, same order as `meta.attachments`.

## 2. Core (done, in `server/app.js`)

| Route | Result |
|---|---|
| `GET /api/config` | `{ appName, dev, signup: "open"\|"closed", powBits, graceDays, renewDays, mailDomains: [], personalDomains: [], voicemailMaxSeconds, features: { phone, pay, mockPhone, mockPay, mockMail, voice, voicemail, ownPhone, searchByArea }, phoneCountries: [], prices: { mailboxMonth, numberMonth, textOut, callMinute, voicemail }, limits: { mailboxes, aliases (0 = no limit), numbers, phones, sendPerDay, maxMessageBytes } }` |
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
| `GET /api/mailboxes` **(auth)** | — | `{ mailboxes: [{ id, addressId, sealedAddress, enc, status: "active"\|"suspended", paidUntil, createdDay, unread, total, retentionDays, blocks, refused }] }`, oldest first |
| `POST /api/mailboxes` **(auth)** | `{ localPart?, domain?, enc? }` | 201 `{ mailbox, address }`. Charges `prices.mailboxMonth` (kind `mailbox`). `address` is the plain address, returned this one time. 409 `taken`, 409 `limit_reached`, 402, 400 `bad_request`. Rate limit 60/hour per account. |
| `PATCH /api/mailboxes/:id` **(auth)** | `{ enc?, retentionDays? }` (at least one; `enc: null` removes the label; `retentionDays`: null or 1 to 3650) | `{ mailbox }`. 400 `bad_request` if no value is given or a value is not valid. |
| `DELETE /api/mailboxes/:id` **(auth)** | — | 204. Deletes its messages and its aliases. No credit is given back. |
| `GET /api/aliases` **(auth)** | — | `{ aliases: [{ id, mailboxId, sealedAddress, enc, enabled, createdDay, received, expiresAt, blocks, oneShot, usedUp, refused }] }`, oldest first (`received` = count of delivered messages, `refused` = count of refused messages) |
| `POST /api/aliases` **(auth)** | `{ mailboxId, localPart?, domain?, enc?, oneShot? }` (`oneShot`: boolean, default false) | 201 `{ alias, address }`. Free. 404 `not_found` (mailbox), 409 `taken`, 409 `limit_reached`, 400 `bad_request`. Rate limit 120/hour per account. |
| `PATCH /api/aliases/:id` **(auth)** | `{ enabled?, mailboxId?, enc?, expiresAt?, oneShot? }` (at least one; `enc: null` removes the label; `expiresAt`: null or Unix seconds in the future; `oneShot`: boolean) | `{ alias }`. 400 `bad_request` if no value is given or a value is not valid. 404 `not_found` if `mailboxId` is not a mailbox of the account. |
| `DELETE /api/aliases/:id` **(auth)** | — | 204. Messages stay in the mailbox. Their `addressId` becomes null. Its blocks are deleted. |
| `GET /api/addresses/:id/blocks` **(auth)** | — | `{ blocks: [{ id, sealed, createdDay }] }`, oldest first. `:id` is an alias id or `mailbox.addressId`. |
| `POST /api/addresses/:id/blocks` **(auth)** | `{ kind: "address"\|"domain", value }` | 201 `{ block }`. 200 `{ block }` with the block that exists, if this sender is blocked on this address already. 400 `bad_request`, 409 `limit_reached` (200 blocks for one address). Rate limit 60/minute per account. |
| `DELETE /api/addresses/:id/blocks/:blockId` **(auth)** | — | 204. 404 `not_found` if the block is not a block of this address. |
| `DELETE /api/addresses/:id/messages` **(auth)** | — | 200 `{ deleted: n }`. "Burn": deletes all stored messages of this address (see below). `:id` is an alias id or `mailbox.addressId`. Rate limit 30/minute per account. |
| `GET /api/messages` **(auth)** | `?mailboxId=&addressIds=<id,id,…>&direction=in\|out&before=<at>&beforeId=&limit=` (limit 1 to 100, default 50; `addressIds` 1 to 50 ids) | `{ messages: [{ id, mailboxId, addressId, direction, at, seen, size, attachments (count), sealedKey, encMeta }], more: bool }` newest first. 400 `bad_request` for a bad query value. 404 `not_found` if `mailboxId` is not a mailbox of the account. |
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
- A disabled alias gets no mail (SMTP answer 550, like an unknown address) and cannot send. Each message that it refuses adds 1 to `refused`.
- `expiresAt` is the end date of an alias: null (no end date, the default) or Unix seconds. `PATCH` accepts null or a time in the future, 10 years ahead at most.
  From this time on, the alias behaves exactly like a disabled alias: it gets no mail (SMTP `550 5.1.1`, also for mail inside the server) and it cannot send (the same 409 `conflict`).
  The alias stays in the list with `enabled` as it was; the web app compares `expiresAt` with the clock. A new date in the future or null makes the alias work again.
  The address of a mailbox has no end date.
- `oneShot` makes an alias that works for one message. It is a boolean, false by default; a value that is not a boolean gives 400 `bad_request`.
  Only an alias can be one-shot. The address of a mailbox cannot.
  - The first message that the server stores for the alias turns the alias off: `enabled` becomes false and `usedUp` becomes true.
    The server does this in the same database transaction that stores the message. It reads the state of the alias again inside this transaction,
    so a second message is not stored, also when two messages arrive at the same moment. The second sender gets `550 5.1.1`.
  - A used-up alias behaves exactly like a disabled alias: it gets no mail (SMTP `550 5.1.1`, also for mail inside the server), it cannot send (409 `conflict`),
    and each message that it refuses adds 1 to `refused`.
  - A message that is not stored does not use the alias up: mail from a blocked sender, mail while the mailbox is suspended or full, a message that cannot be parsed.
  - `PATCH { enabled: true }` turns a used-up alias on again and sets `usedUp` to false. The alias is still one-shot: it stops again after the next message.
  - `PATCH { oneShot: false }` makes it a normal alias and sets `usedUp` to false. It does not turn the alias on: `enabled` stays false until the request has `enabled: true`
    (the two values can be in one request).
  - `PATCH { oneShot: true }` on a normal alias: the next message that arrives is the last one. Messages that arrived before do not count.
  - `usedUp` is true only while the alias is off because its one message arrived. `PATCH { enabled: false }` does not change `usedUp`.
- `refused` is the number of messages that the address refused. It is one whole number for each address: for an alias, and for the address of a mailbox (`mailbox.refused`).
  The server stores nothing more about a refused message: no sender, no time, no size, no content. The number starts at 0. No route sets it back. It is deleted with the address.
  - Counted: mail for an address that exists, when the refusal is final: the alias is turned off, is past its end date, or is used up, or the address blocks the sender.
  - Not counted: mail for an address that does not exist (also a deleted address and a domain that is not ours); a temporary refusal (suspended mailbox, full mailbox,
    a problem in the server); a message that is too large or cannot be parsed.
  - One count for each message and recipient, not for each SMTP command. If a sender repeats `RCPT TO` for the same recipient in one message, the server counts 1.
    A new message counts again, also on the same connection and also if it is a new try of the same message. A message for three addresses that refuse adds 1 to each of them.
  - A block that is found after DATA (From line or Sender line) counts 1 for each recipient that blocks. A one-shot alias that is used up between RCPT and the end of DATA counts 1.
  - Mail inside the server counts in the same way: `POST /api/mail/send` (each recipient on our own domains with a final refusal), `deliverLocal`, and the dev route.
  - A change of `refused` publishes no event. The web app gets the number with the next `GET /api/aliases` or `GET /api/mailboxes`.
- `retentionDays` is the auto-delete of a mailbox: null (off, the default) or 1 to 3650. The server deletes the messages of this mailbox that are older than this number of days
  (by `at`; incoming messages and Sent copies, with their attachments). A job does this one time each hour, also for a suspended mailbox, and publishes `mail` with the `mailboxId`.
  The deleted messages cannot be brought back. The setting changes nothing in the counter `received` of an alias.
- `blocks` = the number of blocked senders of the address (for a mailbox: of `mailbox.addressId`).
- Events for the browser: `mailbox` (mailbox made, changed, deleted, suspended, active again; a block of the mailbox address added or removed),
  `aliases` (alias made, changed, deleted; mailbox deleted; a block of an alias added or removed; a one-shot alias used up, after the `mail` event of its message),
  `mail` with `mailboxId` (new message, seen flag changed, message deleted by the user, by the auto-delete, or by a burn, Sent copy stored), `balance` (after a charge).

Blocked senders:
- A block belongs to one address (an alias, or the address of a mailbox). Mail from the blocked sender to this address is refused. Everything else on the address keeps working,
  and other addresses of the account still accept the sender. A block does not stop the user from sending mail to the blocked sender.
- `kind: "address"` blocks one sender address. `kind: "domain"` blocks every address of this domain and of its subdomains (`shop.example` also blocks `mail.shop.example`,
  not `myshop.example`).
- `value` is changed to lower case. An address must pass the recipient address rule of the send body (below). A domain needs at least one dot, no `@`, no dot at the start or the end,
  and a last label that starts with a letter. A domain with letters outside ASCII is accepted and stored in its `xn--` form (`bücher.example` becomes `xn--bcher-kva.example`).
- The server does not store the blocked value in plain form. It stores `keys.indexHmac('block', kind + ':' + value)` for matching, and `sealed`:
  `store.sealJsonFor(accountId, { kind, value }, 'block')`. The browser opens `sealed` with `openJson(keys, sealed, 'block')` and gets `{ kind, value }`.
- The server checks the envelope sender (MAIL FROM) and every address in the From line and in the Sender line of the message. Upper case, a dot at the end of the domain,
  and the two spellings of an international domain make no difference.
- A refused message is not stored, is not counted in `received`, and publishes no event. It adds 1 to `refused` of the address. The sender is not written to a log.
- To block the sender of a message, the web app takes `meta.from.address` (kind `address`) or the part after the `@` (kind `domain`).

Burn (`DELETE /api/addresses/:id/messages`):
- Deletes all stored messages with this `addressId`: incoming messages and Sent copies, with their attachments, in all mailboxes of the account
  (an alias that was moved has messages in two mailboxes).
- For the address of a mailbox, only the messages of this address are deleted. The messages of the aliases of the mailbox stay.
  Messages of a deleted alias (`addressId: null`) are not reached by this route.
- Answer: 200 `{ deleted: n }`, the number of deleted messages. It is 0 if there was nothing to delete. 404 `not_found` for an unknown id, an id of a different account,
  an address that was deleted, and an id that is not well formed. 429 `rate_limited` after 30 requests in one minute.
- The server deletes in steps of 500 messages, like the auto-delete, so that a large delete does not stop other requests. Then it empties the write-ahead file of the database.
  A message that arrives while the delete runs can stay.
- The address is not changed: `enabled`, `received`, `refused`, its blocks, and its label stay, and it accepts new mail.
- Publishes `mail` with the `mailboxId`, one time for each mailbox that lost messages. No event if nothing was deleted.
- The deleted messages cannot be brought back.

Message notes:
- Order: `at` from new to old; messages of the same second by `id` from high to low.
- Pages: send `before` = `at` and `beforeId` = `id` of the last message of the page before. The answer has the messages after this position.
  `before` alone gives the messages with `at < before` (it skips other messages of the same second). `beforeId` alone has no effect.
- `limit` below 1, above 100, or not a number: 400 `bad_request`. `direction` other than `in` or `out`: 400 `bad_request`.
- `addressIds` is a list of address ids with commas between them, for example `addressIds=<id1>,<id2>` (no spaces). The ids are alias ids and inbox address ids (`mailbox.addressId`).
  The answer has only the messages with an `addressId` from the list, from all mailboxes of the account. This is the list for a group of aliases.
  - It works together with the other values: with `mailboxId` both filters apply; `direction`, `before`, `beforeId`, `limit`, and `more` work as without it.
  - A Sent copy has the id of its from-address, so it is in the list when this address is in `addressIds` (use `direction=in` to leave Sent copies out).
  - An id that does not exist, or an id of a different account, matches nothing. It gives no error. An id two times in the list changes nothing.
  - 400 `bad_request`: more than 50 ids, an id that is not well formed, or an empty list (`addressIds=`). To get all messages, leave `addressIds` out.
  - Messages of a deleted alias have `addressId: null`. They are in no such list; they are still in the list of their mailbox.
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
- `meta.bulk` is a boolean. It is true when the message has a `List-Unsubscribe` header or a `List-Id` header (also with an empty value), or a `Precedence` header
  with the value `bulk` or `list` (upper case makes no difference). It is false for all other messages.
- `body.unsubscribe` is null when the message has no `List-Unsubscribe` header. If the message has one, it is `{ mailto, subject, hasLink }`:
  - `mailto`: the address of the first valid `mailto:` target of the header, in lower case, or null. It passes the recipient address rule of the send body (below).
    Percent-encoding is decoded (`leave%40list.example`). If one target names several addresses, the first address is used. A target that is not valid is passed over.
  - `subject`: the `subject=` value of this target, decoded, or null. It has 200 characters at most. Line breaks and control characters become one space,
    so the text is safe as the subject of a message. Other values of the target (`body`, `cc`, `bcc`) are not kept.
  - `hasLink`: true if the header has an `http://` or `https://` target. The link itself is not kept.
  - The server reads the first `List-Unsubscribe` header of the message, its first 4,000 characters, and its first 10 targets. A target stands in angle brackets.
    If the header has no angle brackets, the server splits the text at the commas. `mailto:` and `http` can be in upper case.
  - A header without a usable target gives `{ mailto: null, subject: null, hasLink: false }`, and `meta.bulk` is true.
- `bulk` and `unsubscribe` are in the sealed envelope only (`encMeta` and part 0). The server stores no column for them and cannot filter or count by them.
- The content of a Sent copy comes from the browser. The server cannot read it and checks sizes only.

Newsletters and "unsubscribe":
- Decision: **the server never opens an unsubscribe web link**, and there is no route that does. To open a link from a stranger tells the sender that the address is read,
  and it makes the server request a web address that a stranger chose. For the same reason the server does not send a one-click request (`List-Unsubscribe-Post`).
- To unsubscribe, the web app sends a normal message with `POST /api/mail/send`: `addressId` and `from` = the address that got the message, `to: [body.unsubscribe.mailto]`,
  `subject` = `body.unsubscribe.subject` (if it is null, a text such as "unsubscribe"). All rules of the send route apply (relay, daily limit, rate limit, Sent copy).
  The list sees the alias address, which it has already, and the mail server. It does not see the IP address of the user.
- If `mailto` is null, unsubscribe by email is not possible. The web app can offer to turn the alias off. `hasLink` tells that the sender offers a web link, which Postern does not open.
- There is no new route and no new event for this.

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
  The answer names the first of these recipients. Each of them that gives a final refusal (see `refused`) gets 1 added to `refused`.
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
| 400 `bad_recipient` | No recipient; more than 20 recipients; an address that is not well formed; a recipient on our own domains that does not exist, is disabled, is used up, or is past its end date ("This address does not exist: x@…"); a recipient on our own domains that blocks the from-address ("This address does not accept mail from your address: x@…"); a recipient on our own domains with a suspended or full mailbox ("This address cannot receive mail now: x@…"). |
| 404 `not_found` | `addressId` is not an address of this account. |
| 409 `conflict` | The from-address is disabled, used up, or past its end date (one message for all three), or its mailbox is suspended. |
| 409 `limit_reached` | The mailbox has no room for the Sent copy. |
| 413 `too_large` | The request, the content, the finished message, or the copy is over its size limit. |
| 429 `send_limit` | The daily limit is reached. |
| 429 `rate_limited` | More than 30 requests in one minute. |
| 502 `send_failed` | The relay refused the message or did not answer. Nothing was delivered, also not to our own addresses. The request does not count for the daily limit. |
| 503 `no_relay` | The message has a recipient on a different server, the server has no relay, and `config.dev` is false. |

Incoming SMTP (`smtp-server` on `config.mail.smtpPort`; port 0 = pick a free port, expose as `app.services.mail.smtpPort`):
- The server accepts mail for its own addresses only. It has no login (no AUTH) and is no relay. The greeting shows no software name and no version.
- For each accepted recipient: parse with `mailparser`, build meta/body/attachments, `sealEnvelope(publicKey, …)`, store, add 1 to `received`, `events.publish(accountId, 'mail', { mailboxId })`.
  Each recipient gets an own copy with an own content key. A one-shot alias is turned off in the transaction that stores its copy; then the server also publishes `aliases`.
- Final refusals of an address that exists are counted in `refused` (see the rules above): at RCPT one time for each recipient of a message, and after DATA for a recipient
  that was accepted at RCPT but then blocks the From line or is used up.
- Blocked senders are checked two times. At RCPT: the envelope sender, for each recipient. After the message arrived: the From line and the Sender line, for each recipient.
  A recipient that blocks the sender gets no copy. If other recipients are left, they get the message and the answer is 250. A bounce (empty envelope sender) is checked by its From line only.
- The plain message is never written to disk and never logged.
- Limits: 20 recipients for one message, 50 connections at the same time, 10 connections from one IP address, 60 seconds without activity.

SMTP answers:

| Answer | When |
|---|---|
| `250` | The message is stored for at least one recipient. |
| `550 5.1.1` | Unknown recipient, disabled alias, one-shot alias that is used up, alias past its end date, or an address on a domain that is not ours. After DATA: a one-shot alias got its one message in the meantime and no recipient is left. |
| `550 5.7.1` | The recipient blocks this sender. At RCPT for the envelope sender (the other recipients can still be accepted). After DATA if the From line or the Sender line is blocked and no recipient is left. The answer does not repeat the sender. A block is answered before a suspended or full mailbox. |
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
- `deliverLocal` gives the lower-case addresses back. `rejected` has the addresses that are unknown, disabled, used up, past their end date, suspended, full, not ours, or that block the sender.
  `from` is the envelope sender (leave it out for none); it is checked against the blocks, like the From line of `raw`. It rejects (error code `EPARSE`) if the message cannot be parsed.
- `outbox` entries: `{ accountId, from, to: [], subject, at, raw: Buffer }`. The outbox keeps the newest 200 messages and 64 MB at most. It is in memory only.
- `checkTls()` runs the check of the certificate files now. It returns true if a new certificate was loaded.
- `tlsStatus()`: `source` is `"configured"`, `"generated"`, or `"default"` (the test certificate of the package). `minVersion` is `"TLSv1.2"`, or null for `"default"`.

Dev routes (register only if `config.dev`):
- `POST /api/dev/inbound-mail` **(auth)** `{ to, from?, fromName?, subject?, text?, html?, attachments?: [{filename, contentType, content}] }` → 204. Injects a message as if it came from the internet. `to` must be an address of this account.
  The fields have the same rules as in `POST /api/mail/send`. `from` is `sender@example.com` if absent. 404 `not_found` if `to` is not an address of this account. 409 `conflict` if the address cannot get mail now (disabled alias, used-up alias, alias past its end date, suspended or full mailbox), or if the address blocks `from` (message "This address blocks this sender."). A message through this route uses a one-shot alias up and counts in `received` and `refused` like mail from the internet.
- `GET /api/dev/outbox` **(auth)** → `{ mail: [{ from, to: [], subject, at }] }` from the simulated outbox, own messages only.

Renewal: register a renewable of kind `mailbox` with `app.renewables.register(...)` (see `server/core/renew.js`). A suspended mailbox is readable but receives no mail and cannot send. There is no `expire` for mailboxes.
The user can still change and delete a suspended mailbox and its aliases.

## 5. Phone module (`server/phone/`)

The provider is `config.phone.provider`: `mock`, `twilio`, or `off`.

| Route | Body / query | Result |
|---|---|---|
| `GET /api/numbers/search` **(auth)** | `?country=US&areaCode=415` | `{ numbers: [{ number, locality, region, country, sms, voice }] }` (max 20). `country` must be one of `phoneCountries` (if absent: the first one). `areaCode` is optional, 1 to 6 digits. 400 `bad_request`, 502 `provider_error`. Rate limit 30/minute. |
| `GET /api/numbers` **(auth)** | — | `{ numbers: [{ id, sealedNumber, enc, country, sms, voice, status: "active"\|"suspended", paidUntil, createdDay, forwardPhoneId, forwardTexts, forwardCalls, retentionDays, voicemail, unread }] }`, oldest first. `unread` = count of incoming texts that are not seen. `retentionDays` is null or a count of days (see "Automatic deletion of old texts"). `voicemail` is a boolean (see "Voicemail"). |
| `POST /api/numbers` **(auth)** | `{ number, enc? }` | 201 `{ number: {…}, plain: "+1…" }`. Charges `prices.numberMonth` (kind `number`). 409 `taken`, 409 `limit_reached`, 402, 502 `provider_error`. See "Buying a number". |
| `PATCH /api/numbers/:id` **(auth)** | `{ enc?, forwardPhoneId? (null clears), forwardTexts?, forwardCalls?, retentionDays? (null = off), voicemail? }` | `{ number }`. 400 `bad_request`, 404 `not_found`, 409 `conflict`, 409 `no_voice`, 409 `no_voicemail`. See "Forwarding", "Automatic deletion of old texts" and "Voicemail". |
| `DELETE /api/numbers/:id` **(auth)** | — | 204. Releases the number at the provider, then deletes it with its texts and calls. No credit is given back. 502 `provider_error` if the provider fails; then the number stays. |
| `GET /api/numbers/:id/texts` **(auth)** | `?before=<at>&limit=` (limit 1 to 200, default 100; a larger value counts as 200) | `{ texts: [{ id, direction: "in"\|"out", at, seen, sealed, status }], more }` newest first. See "Pages" and "Status of a sent text". |
| `POST /api/numbers/:id/texts` **(auth)** | `{ number, to, body }` (`number` = our own number in plain form; body 1 to 1600 characters) | 201 `{ text }`. Charges `prices.textOut` (kind `text`). 400 `bad_destination`, 409 `suspended`, 409 `conflict` (the number has no texts), 402, 502 `provider_error` (the charge comes back, no text is stored). Rate limit 30/minute. |
| `POST /api/numbers/:id/texts/seen` **(auth)** | — | 204. Marks all texts of this number as seen. |
| `DELETE /api/texts/:id` **(auth)** | — | 204 |
| `GET /api/numbers/:id/calls` **(auth)** | `?before=&limit=` (as for texts) | `{ calls: [{ id, direction: "in"\|"out", at, seconds, status: "answered"\|"missed"\|"failed", sealed, voicemail }], more }` newest first. `at` is the start of the call. `voicemail` is null or `{ seconds, size, sealedKey, encMeta }` (see "Voicemail"). |
| `POST /api/numbers/:id/calls` **(auth)** | `{ number, to }` | 201 `{ ok: true }`. Click-to-call: the provider calls the linked real phone, then connects it to `to` with the VoIP number as caller ID. 409 `no_phone` (no verified forward phone on this number), 409 `no_voice`, 409 `suspended`, 400 `bad_destination`, 402 (balance below `prices.callMinute`), 502 `provider_error`. Rate limit 10/minute. |
| `GET /api/calls/:id/voicemail` **(auth)** | — | 200 `application/octet-stream`: the encrypted audio of the voicemail. 404 `not_found` if the call is unknown or has no voicemail. |
| `DELETE /api/calls/:id` **(auth)** | — | 204. Deletes its voicemail too. |
| `GET /api/phones` **(auth)** | — | `{ phones: [{ id, sealedNumber, enc, verified, createdDay }] }`, oldest first |
| `POST /api/phones` **(auth)** | `{ number, enc?, method?: "text"\|"call", via: { numberId, number } }` | 201 `{ phone }`. Sends a 6-digit code to the real phone from the VoIP number `via`, by text (default) or by a call that speaks the code. See "Linking a real phone". Rate limit 5/hour. |
| `POST /api/phones/:id/verify` **(auth)** | `{ code }` | `{ phone }`. 400 `bad_code`. Max 5 tries, code valid 10 minutes. Rate limit 20 in 10 minutes. |
| `DELETE /api/phones/:id` **(auth)** | — | 204. Each number that forwarded to it gets `forwardPhoneId: null`, `forwardTexts: false`, `forwardCalls: false`. |

Rules for all routes:
- Where a body has our own number in plain form (`number`, `via.number`), the server checks it against the stored HMAC of the number with that ID. If it does not match: 400 `bad_request` ("The number does not match.").
- Unknown and foreign IDs give 404 `not_found`.
- A suspended number can be read, changed and deleted. It receives nothing, and it cannot send or call (409 `suspended`).
- The module publishes these events: `number`, `text`, `call` (with `numberId` when one number changed), `phones`, `balance`. `POST …/texts/seen` publishes `text` only if a text changed.

Error codes of this module:

| Code | Status | When |
|---|---|---|
| `taken` | 409 | The number cannot be bought ("This number is not available. Choose a different one."). |
| `limit_reached` | 409 | The account has `limits.numbers` numbers or `limits.phones` phones. |
| `suspended` | 409 | A text or a call from a suspended number. |
| `no_phone` | 409 | Click-to-call from a number with no verified forward phone. |
| `no_number` | 409 | A phone link, and the account has no active VoIP number, or `via` is suspended. |
| `no_voice` | 409 | A call function, and the number or the provider has no voice ("This number cannot make or get calls through Postern."). |
| `no_voicemail` | 409 | `voicemail: true`, and the provider has voice but cannot record ("Voicemail is not available for this number."). |
| `conflict` | 409 | The forward phone is not verified. The phone is linked already. The number has no texts. |
| `bad_destination` | 400 | The destination is not permitted ("You cannot text or call this number from here."). |
| `bad_code` | 400 | The code is wrong, too old, or used up. |
| `provider_error` | 502 | The provider refused the request or did not answer. The message is plain text and has no number in it. |
| `phone_off` | 503 | The provider is `off`. |
| `bad_signature` | 403 | A webhook with a wrong or missing signature. |

### Buying a number

- An account can buy only a number that one of its own searches returned in the last 30 minutes. All other numbers give 409 `taken`. This stops a purchase of any number that the provider sells (a different country, a costly number type).
- The search results are in memory. After a restart of the server, the user must search again.
- A number that an account on this server has is not in the search results.
- `country`, `sms` and `voice` of the new number come from the search result. With a provider that has no voice, `voice` is false.
- Order: limit (409 `limit_reached`), search result (409 `taken`), charge (402), purchase at the provider. If the purchase fails, the charge comes back (kind `refund`): 409 `taken` if the provider says that the number is gone, 502 `provider_error` for other failures.
- The server handles the purchases of one account one after the other. Two requests at the same time cannot both pass the limit.

### Pages

- `before` is the `at` value of the last row of the page before.
- Rows of the same second are never split over two pages. For that reason a page can be longer than `limit`.
- `more` is true if older rows exist.

### Status of a sent text

- `status` of an outgoing text: `"queued"` (the provider accepted the text and will try later), `"sent"`, `"delivered"`, or `"failed"`. `status` of an incoming text: null.
- The status moves forward only: `queued` → `sent` → `delivered` or `failed`. `delivered` and `failed` are final. A report that comes two times or in the wrong order changes nothing.
- `failed` means: the provider accepted the text and reported later that it was not delivered. The charge comes back (kind `refund`), one time. The text stays in the list.
- If the provider refuses a text at once, the answer is 502 `provider_error`, no text is stored, and the charge comes back.
- Each change of status publishes `text`. A refund publishes `balance`.
- The code text of a phone link and a forwarded text have no row. If the provider reports that one of them failed, the charge comes back too.
- A sent text can be deleted (by the user, or by the automatic deletion) before its final status arrives. If the provider then reports that it failed, the charge still comes back, one time.
- The server waits 7 days for the final status of a text. After that, a report changes nothing.
- The mock provider gives `sent` at once. Twilio gives `queued` and reports the result later.

### Automatic deletion of old texts

- Each number has `retentionDays`: null (off, the default) or an integer from 1 to 3650. `PATCH /api/numbers/:id` sets it. Other values give 400 `bad_request`.
- Every hour the server deletes the texts of each number with a value: all texts of that number, incoming and sent, whose `at` is more than `retentionDays` × 24 hours ago. The server does this by itself. The app does not have to be open.
- After a change of the setting, the first deletion comes with the next hourly run.
- Only the texts of that number are deleted. Calls are not deleted.
- The deletion is final. The database overwrites deleted rows.
- The server publishes `text` (with `numberId`) for each number that lost texts.
- The setting also works for a suspended number, and with provider `off`.

### Voicemail

A caller who does not reach the user can leave a message. It is off by default.

- `PATCH /api/numbers/:id` with `voicemail: true` or `false` switches it for one number. `true` needs a number and a provider with voice (409 `no_voice`) and a provider that can record (409 `no_voicemail`). `false` always works.
- Price: `prices.voicemail` credits for each stored voicemail (kind `voicemail`). Longest message: `voicemailMaxSeconds` seconds. `GET /api/config` gives both, so the app can show them before the user switches it on.
- Voicemail is used for a call if the number has it on, the number is active, and the balance is not below `prices.voicemail`, in two cases:
  1. The call is not forwarded (forwarding is off, there is no verified phone, or the balance is below `prices.callMinute`).
  2. The call was forwarded and was not answered (no answer, busy, failed, or the caller gave up).
- The caller then hears exactly: "The person you called is not available. Please leave a message after the tone." The greeting has no name and no number. After a tone the provider records for `voicemailMaxSeconds` at most, and the call ends.
- In all other cases, and with voicemail off, calls behave as described in "Provider webhooks".
- A call with voicemail is in the call log as a `missed` call. When the recording is stored, the call gets `voicemail: { seconds, size, sealedKey, encMeta }` and the server publishes `call`. `size` is the count of bytes of the encrypted audio.
- The voicemail is encrypted for the account like a mail message (`sealEnvelope` in `shared/crypto.js`):
  - `sealedKey`: the content key, sealed to the account. Open it with `openContentKey(keys, sealedKey)`.
  - `encMeta`: `{ peer, seconds, contentType }`. Open it with `openMeta(contentKey, encMeta)`. `peer` is the caller, or `""` if the server was restarted between the call and the recording (the call itself still has the caller in `sealed`). `contentType` is `audio/mpeg` with Twilio and `audio/wav` with the mock provider.
  - The audio: `GET /api/calls/:id/voicemail` gives part 1 of the envelope. Open it with `openAttachment(contentKey, bytes, 1)`.
- What the server does when the provider reports a recording:
  1. It finds the call. The call must have got the greeting not long ago, must have no voicemail yet, and the recording must be 1 second to `voicemailMaxSeconds` (+ 5) seconds long.
  2. It fetches the audio from the provider (5 MB at most), encrypts it, and stores it. The plain audio is in memory only. It is never written to a file and never logged.
  3. Then it deletes the recording at the provider. If that fails, a job tries again every hour, for 30 days.
  4. It charges `prices.voicemail`. If the balance went down in the meantime, the user keeps the voicemail and nothing is charged.
- A recording that is not accepted in step 1, that is too large, or that cannot be fetched is not stored and is deleted at the provider. This is also true for a recording that arrives after its call, number, or account was deleted.
- The same report two times does nothing the second time.
- `DELETE /api/calls/:id` deletes the voicemail of the call. The voicemails of a number go away with the number (delete, expiry) and with the account.
- The automatic deletion of old texts does not delete calls or voicemails.

**What the phone company hears and keeps.** The user must know this before voicemail is switched on:
- The provider (for example Twilio) plays the greeting and records the audio itself. So the provider hears the complete message. Postern cannot encrypt a voicemail before the provider has it.
- Postern deletes the recording at the provider right after it has stored its own encrypted copy. From then on only the browser of the account can play the message.
- The provider can keep call records under its own policy: who called which number, when, and for how long. It can also have its own backups for some time. Postern cannot delete those.
- Postern does not ask the provider for a transcription.

### Destination limits

- `config.phone.allowedPrefixes` and `config.phone.blockedPrefixes` (`PHONE_ALLOWED_PREFIXES`, `PHONE_BLOCKED_PREFIXES`) limit the numbers that a user can choose.
- The server checks `to` in `POST …/texts` and `POST …/calls`, and `number` in `POST /api/phones`.
- The number must start with one of the allowed prefixes and with none of the blocked prefixes. If not: 400 `bad_destination`. An empty allowed list permits all numbers. `+1` and `1` mean the same prefix.
- Default: allowed `+1`; blocked `+1900`, `+1976`, and the Caribbean area codes inside `+1`.
- Forwarded texts and calls go to a linked phone. That phone passed the check when it was linked.
- Incoming texts and calls are not checked.

### Linking a real phone

The server must read a real phone number to forward calls and texts. It stores `keys.srvEncrypt(number, 'phone')`,
plus `sealedNumber` for display. The provider reference of a VoIP number is stored with `keys.srvEncrypt(ref, 'ref')`.

`POST /api/phones`:
- 409 `no_number` if the account has no active VoIP number, or if `via` is suspended.
- `via` must be a number of the account (404 `not_found`), and `via.number` must match it (400 `bad_request`).
- `number` must not be a VoIP number of the same account (400 `bad_request`). The destination limits apply (400 `bad_destination`).
- `method: "text"` (default): the text is "Your Postern code is 123456. Do not share it." (the name is `config.appName`). `via` must have texts (409 `conflict`). Charges `prices.textOut` (kind `text`). If the provider refuses the text (502 `provider_error`) or reports later that it failed, the charge comes back.
- `method: "call"`: the provider calls the real phone from `via`. When the phone answers, a voice says "Your Postern code is 4, 8, 2, 9, 1, 3." two times, and the call ends. `via` must have voice (409 `no_voice`). Charges `prices.callMinute` one time (kind `call`); 402 if the balance is lower. The charge comes back only if the provider cannot start the call (502 `provider_error`). The call is not in the call log.
- Other values of `method`: 400 `bad_request`.
- A phone that is linked and verified: 409 `conflict`.
- A phone that is linked and not verified: the same request sends a new code. The answer is 201 with the same `id`. The charge is taken again. The old code stops working. This is how the app sends a code again.
- More than `limits.phones` phones: 409 `limit_reached`.

`POST /api/phones/:id/verify`:
- The server stores only SHA-256 of `"<phone id>:<code>"`. The code is valid for 10 minutes.
- After 5 wrong codes the code is used up. A new code (see above) starts again at 0.
- Wrong, too old, and used up all give 400 `bad_code`. The message says which.
- A value that is not 6 digits gives 400 `bad_code` and does not count as a try.
- A phone that is verified already: the answer is the phone.

### Forwarding

`PATCH /api/numbers/:id`:
- `forwardPhoneId` must be a verified phone of this account: 404 `not_found` if it is unknown, 409 `conflict` if it is not verified.
- `forwardPhoneId: null` also sets `forwardTexts` and `forwardCalls` to false.
- `forwardCalls: true` gives 409 `no_voice` if the number or the provider has no voice.
- The two switches can be set while there is no phone. Then nothing is forwarded.

Forwarded texts:
- An incoming text is stored first. Then, if `forwardTexts` is on, the phone is verified, and the balance allows `prices.textOut`, the server sends `"<peer>: <body>"` (max 1600 characters) to the real phone from the VoIP number and charges `prices.textOut` (kind `text`).
- A text from the linked phone itself is not forwarded.
- One number forwards 30 texts each minute at most. This stops a loop of two numbers that forward to each other.
- If the provider refuses the forwarded text, the charge comes back.

### Provider webhooks

No cookie. The provider signature is mandatory: 403 `bad_signature` if it is wrong or absent.
The server calculates the signature with `config.publicUrl` + path + query string, never with the Host header.
A webhook for a number that is unknown or suspended gets the same answer as a webhook for a good number, and nothing is stored.

- `POST /api/hooks/phone/text` — incoming text. Seal `{ peer, body }`, store, publish `text`, then forward (see "Forwarding"). `peer` is the sender as the provider gives it (max 32 characters; `"unknown"` if empty). The body is cut at 1600 characters. A text with a message ID that was stored before is ignored.
- `POST /api/hooks/phone/text-status` — the provider reports the status of a text that the server sent (see "Status of a sent text").
- `POST /api/hooks/phone/voice` — incoming call.
  - The call is forwarded if `forwardCalls` is on, the number has voice, the phone is verified, the caller is not the linked phone itself, and the balance is not below `prices.callMinute`.
  - Forwarded: the answer is a dial instruction to the real phone: ring time 25 seconds, caller ID = the number of the caller (none if the caller hides the number), and a time limit.
  - Not forwarded: a missed call is recorded. With voicemail (see "Voicemail") the caller hears the voicemail greeting and can leave a message. Without it the caller hears "The person you called is not available." and the call ends.
  - A call ID that is in the call log already is ignored.
- `POST /api/hooks/phone/bridge?t=<token>` — click-to-call, runs when the real phone answers: dial the destination with the VoIP number as caller ID (ring time 25 seconds, with a time limit). The token is valid for 5 minutes. If the token is unknown, the number is suspended, or the balance is below `prices.callMinute`, the call ends and is recorded as `failed` with no charge.
- `POST /api/hooks/phone/say-code?token=<token>` — phone link by call, runs when the real phone answers: speak the code two times, then end the call. The token is valid for 5 minutes. An unknown token ends the call.
- `POST /api/hooks/phone/status` — a call ended. Record the call (`seconds`, `status`), charge `ceil(seconds / 60) × prices.callMinute` (kind `call`, never more than the balance), publish `call`.
  - Only the first final report for a call counts. A second report for the same call changes nothing and charges nothing.
  - `seconds` is the time that the two parties were connected. A call that was not answered has 0 seconds and no charge.
  - The answer tells the provider how the call goes on: the voicemail greeting and the recording if an incoming forwarded call was not answered and voicemail applies (the call is then logged as `missed`), else "end the call".
- `POST /api/hooks/phone/recording` — a voicemail recording is ready (see "Voicemail").

The time limit of a dial instruction is the count of full minutes that the balance pays for (at least 1 minute, at most 4 hours). The provider ends the call at the limit. If `prices.callMinute` is 0, the limit is 4 hours.

The call webhooks (`voice`, `bridge`, `say-code`, `status`) exist only if the provider has voice. `recording` exists only if the provider also has voicemail.

### Provider adapters

Adapters are in `server/phone/providers/`. The comment at the top of `mock.js` is the interface.

- `capabilities = { voice, voicemail, asyncText, searchByArea }` (all boolean):
  - `voice`: the provider can make and receive calls. If false: the search and the number list show `voice: false`, new numbers are stored with no voice, and each call function gives 409 `no_voice` (`forwardCalls: true`, click-to-call, phone link by call, `voicemail: true`).
  - `voicemail`: the provider can record a caller. If false, no caller gets the voicemail greeting.
  - `asyncText`: the result of a text can come after the send request.
  - `searchByArea`: the search can filter by area code. If false, `areaCode` is ignored.
  - `mock`: `{ voice: true, voicemail: true, asyncText: false, searchByArea: true }`. `twilio`: `{ voice: true, voicemail: true, asyncText: true, searchByArea: true }`. With provider `off`: all false.
- `sendText({ from, to, body, statusUrl })` returns `{ ref, status }` with status `queued` or `sent`. A later result arrives at the `text-status` webhook, or the adapter calls `app.services.phone.reportTextStatus`.
- `mock.js`: in memory; used by tests and development. Webhook bodies are JSON. The header `x-mock-signature` must be `keys.sign('mock-hook', rawBody)`.
- `twilio.js`: REST with `fetch`, form-encoded webhooks, `X-Twilio-Signature` check, TwiML answers.
  - Each text carries `StatusCallback` = the `text-status` webhook. `MessageStatus` `queued` → `queued`; `sending`, `sent` → `sent`; `delivered` → `delivered`; `undelivered`, `failed` → `failed`. Also: `accepted` and `scheduled` count as `queued`, `read` as `delivered`, `canceled` as `failed`. Other values are ignored.
  - A call status `completed` is `answered`; `busy`, `no-answer`, `canceled` are `missed`; `failed` is `failed`. The result of a `<Dial>` (`DialCallStatus`, `DialCallDuration`) comes before the result of the whole call, so it is the one that counts.
  - Optional settings: `messagingServiceSid` (each new number is added to this Messaging Service, and texts name it), `bundleSid` and `addressSid` (sent with each purchase).
  - Voicemail: `<Say>greeting</Say><Record maxLength="…" playBeep="true" trim="trim-silence" action="<status webhook>" method="POST" recordingStatusCallback="<recording webhook>" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed"/><Hangup/>`. The `action` makes the call end cleanly after the recording. The audio is fetched as MP3 from `<baseUrl>/2010-04-01/Accounts/<sid>/Recordings/<RecordingSid>.mp3`. The address is built from the configured API address and the recording ID. The `RecordingUrl` of the webhook is never used, so the server sends no request and no password to a host that came in with a request. The recording is deleted with `DELETE …/Recordings/<RecordingSid>.json`.

Service object: `app.services.phone = { provider, name, capabilities, reportTextStatus({ ref, status, errorText? }) → bool }`.
- `reportTextStatus` is the function behind the `text-status` webhook. `ref` is the message ID that `sendText` returned. It returns true if the report changed something. `errorText` is for the server log only.
- With the mock provider the object also has `mock` (the adapter), `outbox`, `simulateText({ to, from, body })`, `simulateCall({ to, from, seconds?, answered?, voicemail? })`, `answerCall(ref, { answered?, peerAnswered?, seconds? })` and `reportText(ref, status, errorText?)`. For voicemail tests the adapter has `mock.addRecording({ bytes?, contentType? }) → ref`, `mock.reportRecording({ callId, recordingRef, seconds })`, `mock.recordings` and `mock.deletedRecordings`.
- With provider `off`, `provider` is null.

Provider `off`:
- `GET /api/numbers`, `GET /api/phones`, the text and call lists, `PATCH`, `POST …/texts/seen`, the delete routes for texts, calls and phones, and `POST …/verify` work.
- Search, purchase, `DELETE /api/numbers/:id`, send, call, and phone link give 503 `phone_off`.
- There are no webhooks, and numbers are not renewed or charged. The automatic deletion of old texts still runs.

Dev routes (register only if `config.dev` and the provider is `mock`):
- `POST /api/dev/inbound-text` **(auth)** `{ numberId, number, from, body }` → 204
- `POST /api/dev/inbound-call` **(auth)** `{ numberId, number, from, seconds?, voicemail? }` → 204 (simulates a full call: forwarded and answered if forwarding is on, otherwise missed; `seconds` is 30 if absent)
  - `voicemail: true`: nobody answers, and the caller leaves a message of `seconds` seconds (5 if absent, `voicemailMaxSeconds` at most) if the number has voicemail on. The "recording" of the mock provider is a real WAV file (a tone of one second, 8 kHz, mono, 16 bit), so the app can play it.
- `GET /api/dev/phone-outbox` **(auth)** → `{ texts: [{ from, to, body, at }], calls: [{ from, to, at, say? }] }` (what the mock provider "sent"). Own entries only: the sender is a number of the account, or the destination is a linked phone of the account. `say` is the text that a phone-link call spoke. It is there after the simulated phone answered.

More behaviour of the mock provider:
- A text to a number of an account on the same server arrives there as an incoming text.
- In development, a call that the mock provider starts (click-to-call, phone link by call) is answered after 800 ms. `config.phone.mockAutoAnswer`: `false` = never, a number = milliseconds.

Renewal: the module registers a renewable of kind `number`. A number that is due is charged `prices.numberMonth` for 30 more days. If the balance is too low, the number is suspended. After `config.graceDays`, `expire` releases the number at the provider and deletes it; if the provider fails, the number stays and the next run tries again.
When an account is deleted, its numbers are released at the provider first. A release that fails is tried again each hour.

## 6. Payments (`server/pay/`)

The payment routes do **not** use the login cookie. The web app calls them with `credentials: "omit"`.
The payment database (`app.paydb`) must not contain account IDs. The account database must not contain invoice IDs.

Credit tokens: one token = `config.pay.unitCredits` (100) credits = 1.00 USD. See `shared/blind.js` and `server/core/blindsign.js`.

The provider is `config.pay.provider`: `mock`, `btcpay`, or `off`.

| Route | Body | Result |
|---|---|---|
| `GET /api/pay/info` | — | `{ enabled, provider: "mock"\|"btcpay"\|"off", unitCredits, minUnits, maxUnits, methods: [{ id, label }], key: { id, n, e } }`. With provider `off`: `enabled: false`, `methods: []`. |
| `POST /api/pay/invoices` | `{ units, method, keyId, blinded: [b64u × units] }` | 201 `{ invoice: { id, status: "pending", units, amountUsd, method, checkoutUrl, expiresAt } }`. 400 `bad_request`, 400 `bad_key`, 503 `pay_off`, 502 `provider_error`. Rate limit 10/hour per IP. |
| `GET /api/pay/invoices/:id` | — | `{ invoice: { id, status: "pending"\|"paid"\|"expired", units, amountUsd, method, checkoutUrl, expiresAt, keyId, signed: [b64u × units] \| null } }`. 404 `not_found`. |
| `POST /api/hooks/btcpay` | BTCPay webhook, raw body, header `BTCPay-Sig` | 200 `{}`. 403 `bad_signature`. The server then asks BTCPay for the invoice state. It does not trust the webhook body. The route exists only with provider `btcpay`. |
| `POST /api/billing/redeem` **(auth)** | `{ keyId, tokens: [{ token, sig }] }` (1 to 200) | `{ credited, balance }`. 400 `bad_token`, 400 `bad_request`, 409 `token_spent`. Rate limit 30/minute. See "Redeem". |
| `GET /api/billing` **(auth)** | — | `{ balance, prices, ledger: [{ delta, kind, day }] }`, newest first, 100 lines at most (ledger kinds: `topup`, `mailbox`, `number`, `text`, `call`, `voicemail`, `refund`) |

- `methods` ids: `BTC-LN` ("Bitcoin Lightning"), `XMR-CHAIN` ("Monero"), `BTC-CHAIN` ("Bitcoin on-chain"). The mock provider offers all three. BTCPay offers the ids in `config.pay.btcpay.methods`; an id with no known label uses the id as its label.
- `invoice.id` is 22 random characters. It is the only way to read the invoice. Signed values are useless without the secret blinding values in the browser.
- `amountUsd` is a number and equal to `units`.
- `checkoutUrl` is the payment page of the provider, or null (mock provider; or the provider gave a link that is not a web address).
- `expiresAt` is `config.pay.invoiceMinutes` (60) after the request.
- `signed` is null until the invoice is paid.

### Invoice requests

`POST /api/pay/invoices` gives 400 `bad_request` if:
- `units` is not an integer from `minUnits` to `maxUnits`,
- `method` is not one of the offered methods,
- the count of `blinded` values is not `units`,
- a blinded value is not exactly as long as the key modulus (256 bytes), or is not below the modulus.

`keyId` must be the key that `GET /api/pay/info` shows now. If not: 400 `bad_key`. The app must load the info again.
With provider `off`: 503 `pay_off`. If the provider cannot make the invoice: 502 `provider_error`.

### When the server signs

The server signs the blinded values of an invoice only if both of these are true:
1. The provider itself says that the invoice is settled (BTCPay: status `Settled`). A webhook body or a caller is not sufficient.
2. The amount and the currency that the provider reports for the invoice are what the server asked for: `units` × 1.00 USD.

If the provider says "settled" for a different amount or currency, nothing is signed and the invoice does not change. The server writes one warning with the invoice ID to its log.

The server asks the provider:
- every minute for each pending invoice,
- when the browser reads a pending invoice (not more than one time each 10 seconds for each invoice),
- when a BTCPay webhook arrives (any event type; the invoice is found by `invoiceId`).

If the provider does not answer, the invoice stays as it is and can still be read.

### Expiry and deletion

- A pending invoice becomes `expired` when the provider says so (BTCPay: `Expired`, `Invalid`, or the invoice is gone), or when the provider says "not paid" and `expiresAt` was more than 120 seconds ago.
- While the provider sees a payment that is not final (BTCPay: `Processing`), the invoice stays `pending`, also after `expiresAt`.
- An expired invoice is still signed if a BTCPay webhook arrives for it and BTCPay then says that it is settled.
- Paid invoices are deleted 30 days after the payment. Expired invoices are deleted 1 day after `expiresAt`. An invoice that is pending 30 days after `expiresAt` is deleted too.
- The tokens of a deleted invoice can still be redeemed.

### Redeem

`POST /api/billing/redeem` (tokens are bearer values: any account can redeem them):
- `token` is 32 bytes, `sig` is 256 bytes. `keyId` is the key that signed them. Tokens of an older key stay valid.
- 400 `bad_request` if `keyId` is absent, or `tokens` is absent, empty, or longer than 200.
- 400 `bad_token` if the key is unknown, a value has the wrong size, or a signature is not valid. Then nothing is spent, also not the good tokens of the same request.
- The same token two times in one request counts one time.
- A token that was spent before is skipped. If all tokens were spent before: 409 `token_spent`.
- Order: (1) check all signatures; (2) mark the new tokens as spent, in one transaction of the payment database; (3) add `count × unitCredits` to the balance (kind `topup`). If step 3 fails, the tokens are free again.
- Then `app.renewables.run(accountId)` and publish `balance`. `balance` in the answer is the balance after the renewals.
- The spent-token table keeps only `SHA-256(token)`. It has no time and no account.
- Redeem and `GET /api/billing` also work with provider `off`.

### Keys, providers, service

- The first start makes one RSA-2048 key. The database keeps the private key encrypted with the server data key (`keys.srvEncrypt`).
- `rotateKey()` makes a new key for new invoices. Older keys stay valid for redeem.
- Provider adapters are in `server/pay/providers/`: `mock.js` (an invoice is pending until `markPaid`) and `btcpay.js` (Greenfield API with `fetch`). The comment at the top of `mock.js` is the interface. `getStatus(ref)` returns `{ state, amount, currency }`.
- BTCPay: the invoice request is `{ amount: "10.00", currency: "USD", metadata: { orderId: <invoice id> }, checkout: { paymentMethods: [method], expirationMinutes, redirectURL: <publicUrl>/funds } }` with the header `Authorization: token <apiKey>`. The webhook signature is `BTCPay-Sig: sha256=<hex HMAC-SHA256(webhookSecret, raw body)>`.

Dev route (register only if `config.dev` and the provider is `mock`):
- `POST /api/dev/pay-invoice` `{ id }` → 204. Marks the mock invoice as paid and signs it. 404 `not_found` if the invoice does not exist.

Service object: `app.services.pay = { signer, provider, settle(invoiceId), refresh(invoiceId), checkPending(), purge(), rotateKey(), markPaid(invoiceId) → bool }`.
- `signer` is the active key. `provider` is null with provider `off`.
- `settle` is the only function that signs. It is safe to call it many times.
- `markPaid` works with the mock provider only. It returns false if there is no such invoice.

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
