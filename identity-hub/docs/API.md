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
| `POST /api/auth/pow` | — | `{ challenge, bits }`. The challenge is valid for 10 minutes and for one sign-up. |
| `POST /api/auth/signup` | `{ accountId, authKey, publicKey, encPrivateKey, recoveryWrap, pow: { challenge, nonce } }` | 201 `{ account }` + cookie. 403 `signup_closed`, 400 `bad_pow`, 409 `account_exists`. |
| `POST /api/auth/login` | `{ accountId, authKey }` | `{ account }` + cookie. 401 `bad_login` (same error for unknown account and wrong key). Rate limit 10/minute per IP. |
| `POST /api/auth/logout` **(auth)** | — | 204, cookie cleared, session deleted. |
| `GET /api/account` **(auth)** | — | `{ account }` |
| `DELETE /api/account` **(auth)** | `{ confirm: "delete my account" }` | 204. Calls `app.deleteAccount(id)`. |
| `GET /api/sessions` **(auth)** | — | `{ sessions: [{ id, createdDay, current: bool }] }` |
| `DELETE /api/sessions/:id` **(auth)** | — | 204 |
| `POST /api/sessions/revoke-others` **(auth)** | — | 204 |
| `GET /api/passkeys` **(auth)** | — | `{ passkeys: [{ id, enc, createdDay, hasKey: bool }] }` |
| `POST /api/passkeys/register/options` **(auth)** | — | `{ options }` (WebAuthn creation options as JSON; `residentKey: "required"`, `userVerification: "required"`, `extensions: { prf: {} }`, `attestation: "none"`) |
| `POST /api/passkeys/register/verify` **(auth)** | `{ response, enc? }` | 201 `{ passkey }` |
| `PUT /api/passkeys/:id/key` **(auth)** | `{ wrappedKey }` (61 bytes) | 204. Stores the account key wrapped with the passkey PRF key. |
| `PATCH /api/passkeys/:id` **(auth)** | `{ enc }` | `{ passkey }` |
| `DELETE /api/passkeys/:id` **(auth)** | — | 204 |
| `POST /api/auth/passkey/options` | — | `{ challengeId, options }` (request options; empty `allowCredentials`; `userVerification: "required"`) |
| `POST /api/auth/passkey/verify` | `{ challengeId, response }` | `{ account, passkeyId, wrappedKey: b64u\|null }` + cookie. 401 `bad_login`. |
| `GET /api/vault` **(auth)** | — | `{ keys: [] }` |
| `GET /api/vault/:key` **(auth)** | — | `{ value }` or 404 |
| `PUT /api/vault/:key` **(auth)** | `{ value }` (max 256 KB; max 50 keys; key matches `^[a-z0-9-]{1,40}$`) | 204 |
| `DELETE /api/vault/:key` **(auth)** | — | 204 |

Passkey notes:
- `user.id` = `account.userHandle`. `user.name` = `"Postern account"` (never an identifier of the person). rpID = `config.rpId`, origin = `config.origin`.
- The passkey id is the WebAuthn credential id (base64url).
- The browser asks the passkey for a PRF value with the fixed salt `SHA-256("postern/v1/prf-salt")`,
  makes `prfKek(prfOutput)`, and stores `wrapAccountKey(kek, accountKey)` with `PUT /api/passkeys/:id/key`.
  After a passkey login the browser gets `wrappedKey` back and opens the account key with the same PRF value.
  If the passkey has no PRF support, `wrappedKey` stays null and the app asks for the recovery key one time on each new browser session.

## 4. Mail module (`server/mail/`)

Address rules: `local@domain`, domain is one of `config.mail.domains`, local part matches
`^[a-z0-9](?:[a-z0-9._-]{1,62}[a-z0-9])$` (3 to 64 characters), no `..`. Reserved local parts are refused
(postmaster, abuse, admin, administrator, root, hostmaster, webmaster, noreply, no-reply, mailer-daemon, support, security, info, help, billing).
If `localPart` is absent, the server makes a random readable one (`word.word123`).
A deleted address is never given out again (tombstone on its HMAC).

| Route | Body / query | Result |
|---|---|---|
| `GET /api/mailboxes` **(auth)** | — | `{ mailboxes: [{ id, addressId, sealedAddress, enc, status: "active"\|"suspended", paidUntil, createdDay, unread, total }] }` |
| `POST /api/mailboxes` **(auth)** | `{ localPart?, domain?, enc? }` | 201 `{ mailbox, address }`. Charges `prices.mailboxMonth` (kind `mailbox`). `address` is the plain address, returned this one time. 409 `taken`, 409 `limit_reached`, 402. |
| `PATCH /api/mailboxes/:id` **(auth)** | `{ enc }` | `{ mailbox }` |
| `DELETE /api/mailboxes/:id` **(auth)** | — | 204. Deletes its messages and its aliases. |
| `GET /api/aliases` **(auth)** | — | `{ aliases: [{ id, mailboxId, sealedAddress, enc, enabled, createdDay, received }] }` (`received` = count of delivered messages) |
| `POST /api/aliases` **(auth)** | `{ mailboxId, localPart?, domain?, enc? }` | 201 `{ alias, address }`. Free. Rate limit 120/hour per account. |
| `PATCH /api/aliases/:id` **(auth)** | `{ enabled?, mailboxId?, enc? }` | `{ alias }` |
| `DELETE /api/aliases/:id` **(auth)** | — | 204. Messages stay in the mailbox. |
| `GET /api/messages` **(auth)** | `?mailboxId=&direction=in\|out&before=<at>&beforeId=&limit=` (limit max 100, default 50) | `{ messages: [{ id, mailboxId, addressId, direction, at, seen, size, attachments (count), sealedKey, encMeta }], more: bool }` newest first |
| `GET /api/messages/:id` **(auth)** | — | `{ message: { ...same fields, body: b64u (part 0) } }` |
| `GET /api/messages/:id/parts/:index` **(auth)** | index ≥ 1 | 200 `application/octet-stream` (the encrypted attachment) |
| `PATCH /api/messages/:id` **(auth)** | `{ seen: bool }` | 204 |
| `DELETE /api/messages/:id` **(auth)** | — | 204 |
| `POST /api/mail/send` **(auth)** | see below | 201 `{ id }` (`id` of the Sent copy, or null) |

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
- Max 20 recipients in total. Daily limit `limits.sendPerDay` per account (429 `send_limit`).
- Recipients on one of our own domains are delivered inside the server. Other recipients go to the relay
  (`config.mail.relayUrl`). If there is no relay, the message goes to the simulated outbox (`app.services.mail.outbox`).
- `copy` is the browser-encrypted Sent copy. The server stores it as a message with `direction: "out"`.
- Outgoing headers: no client IP, no user agent. `Message-ID` uses the from domain.

Incoming SMTP (`smtp-server` on `config.mail.smtpPort`; port 0 = pick a free port, expose as `app.services.mail.smtpPort`):
- Unknown recipient or disabled alias: `550 5.1.1`. Suspended mailbox: `450 4.2.1`. Too large: `552`.
- For each accepted recipient: parse with `mailparser`, build meta/body/attachments, `sealEnvelope(publicKey, …)`, store, add 1 to `received`, `events.publish(accountId, 'mail', { mailboxId })`.
- The plain message is never written to disk and never logged.

Service object: `app.services.mail = { smtpPort, outbox: [], deliverLocal({ from, to: [], raw: Buffer }) → Promise<{ accepted: [], rejected: [] }> }`.

Dev routes (register only if `config.dev`):
- `POST /api/dev/inbound-mail` **(auth)** `{ to, from?, fromName?, subject?, text?, html?, attachments?: [{filename, contentType, content}] }` → 204. Injects a message as if it came from the internet. `to` must be an address of this account.
- `GET /api/dev/outbox` **(auth)** → `{ mail: [{ from, to: [], subject, at }] }` from the simulated outbox, own messages only.

Renewal: register a renewable of kind `mailbox` with `app.renewables.register(...)` (see `server/core/renew.js`). A suspended mailbox is readable but receives no mail and cannot send. There is no `expire` for mailboxes.

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
