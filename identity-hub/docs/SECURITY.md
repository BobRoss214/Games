# Security and privacy design

This document tells you what Postern protects, how it does it, and where the limits are.
It is written in plain words. Read the "Limits" section before you trust the service with important data.

## 1. What the server can and cannot see

| Data | Can the server read it? | Notes |
|---|---|---|
| Your name, email, real identity | No. It never asks. | Sign-up needs no personal data. |
| Recovery key | No. | It never leaves your browser. |
| Account key and private key | No. | The server stores encrypted copies only. |
| Labels and notes on aliases, inboxes, numbers | No. | Encrypted in the browser. |
| Stored email (text, subject, sender, attachments) | No. | Encrypted for you when it arrives. See Limits 1. |
| Stored texts and call history | No. | Encrypted for you when they arrive. See Limits 1. |
| Your alias addresses and VoIP numbers | Not from the database. | The database has keyed hashes only. See Limits 2. |
| A linked real phone number | **Yes.** | The server must know it to forward calls and texts. The link is optional. |
| Which items belong to one account | Yes. | The server must route mail and texts to the correct account. |
| Sizes and times of messages | Yes. | Necessary to sort and to apply limits. |
| Your credit balance | Yes. | Necessary to charge for items. |
| Which payment added credit to which account | **No.** | See section 4. |
| Your IP address | In memory only. | Used for rate limits. Never written to disk or to logs. |

## 2. Keys

```
recovery key (20 random bytes, shown one time)
  ├─ account number   (public identifier of the account)
  ├─ login secret     (the server stores only its SHA-256 hash)
  └─ recovery wrap key ──encrypts──► account key

account key (32 random bytes, made in the browser)
  └─ vault key ──encrypts──► labels, notes, and the private key

passkey (optional, one or more)
  └─ PRF value ──► passkey wrap key ──encrypts──► account key

ECDH P-256 key pair
  public key:  on the server. The server uses it to seal incoming mail and texts.
  private key: only in the browser (the server has an encrypted copy).
```

- Algorithms: AES-256-GCM, ECDH P-256, HKDF-SHA-256, HMAC-SHA-256. All from the WebCrypto API that is built into browsers and Node.js. There is no home-made cipher.
- The code is in `shared/crypto.js`. The browser and the server use the same file.
- The recovery key has 160 bits of randomness. A person cannot guess it and a computer cannot search it.

## 3. Login

- **Passkeys** (WebAuthn) are the main login method. A passkey cannot be phished and is never sent to the server.
- **Recovery key** is the second method. It is a long random secret, not a password that a person chooses.
- There are **no SMS codes**, no email codes, and no passwords.
- Sessions use one cookie: `HttpOnly`, `SameSite=Strict`, and `Secure` on HTTPS. The server stores only a hash of the session token.
- Sign-up uses a small proof-of-work puzzle in the browser. This slows down robots without a CAPTCHA and without tracking.

## 4. Private payments

Goal: the payment records and the account records must have no link between them.

How it works:

1. Your browser makes random credit tokens. One token is worth 1.00 USD.
2. Your browser hides ("blinds") each token and sends the blinded values with the invoice request. This request does not carry your login cookie.
3. You pay the invoice with Lightning or Monero.
4. The payment system signs the blinded values. It cannot see the tokens inside.
5. Your browser removes the blinding. Now it has valid signed tokens that the payment system has never seen.
6. Your browser gives the tokens to your account. The server checks the signature and adds credit.

Result: the payment database knows "invoice X was paid". The account database knows "this account received credit". No stored value connects the two. The two databases are separate files (`payments.db`, `accounts.db`).

The method is an RSA blind signature (Chaum, 1982) with a full-domain hash. The code is in `shared/blind.js` and `server/core/blindsign.js`.

## 5. Other protections

- **No request logs.** The application log has operational messages and errors only. It has no addresses, no numbers, no message text, and no IP addresses.
- **Deleted means deleted.** The database runs with `secure_delete`, which writes zeros over deleted rows.
- **Day precision.** Creation dates are stored as a day, not as an exact time, where the service does not need the exact time.
- **Strict browser policy.** The web app loads no third-party script, font, or image. A Content-Security-Policy blocks inline scripts.
- **Email HTML is isolated.** The app shows email HTML in a sandboxed frame that cannot run scripts. Remote images are blocked, so senders cannot track when you open a message.
- **Cross-site request protection.** `SameSite=Strict` cookie, an Origin check, and JSON-only request bodies.
- **Rate limits** on login, sign-up, and sending. Counters are in memory only.
- **A deleted address is never reused.** A new user cannot get the old mail of a deleted alias.
- **Real phone links are verified** with a code, so nobody can forward calls to the phone of a different person.

## 6. Limits (read this)

1. **Mail and texts arrive unencrypted.** Email (SMTP) and the telephone network are not end-to-end encrypted. The server sees an incoming message for a moment, encrypts it for you, and forgets the plain form. A server that an attacker controls *at that moment* can read new messages as they arrive. It cannot read messages that are stored already. This is the same model as Proton Mail and Tuta for mail from other providers.
2. **A seized server can test guesses.** The database stores keyed hashes of addresses and numbers. An attacker who has the database *and* the server secret key can test "does address X exist here?". The attacker cannot list the addresses of an account.
3. **The telephone provider sees everything on its side.** The provider (for example Twilio) sees the numbers, the texts, and the call records. It keeps logs under its own policy. Postern cannot change that. Use phone numbers for convenience, not for secrets.
4. **Outgoing mail is visible to the relay and to the recipient's provider.** This is how email works.
5. **You must trust the web app code that the server sends.** This is true for every web app with browser encryption. If you run your own server, you control that code. A future improvement is a signed browser extension or a packaged app.
6. **Timing can link things.** The server stores no link between a payment and an account. But a modified server could log the time of both events and compare them. Postern does not do this. You can lower the risk more: pay first, and add the credit to your account later.
7. **If you lose the recovery key and all passkeys, the data is lost.** Nobody can reset it. This is the price of "the server cannot read it".
8. **Passkeys without PRF support** cannot unlock the encryption alone. The app then asks for the recovery key one time in each new browser session.

## 7. What an attacker gets

| Attacker | Gets | Does not get |
|---|---|---|
| Steals a database backup | Encrypted blobs, hashes, balances, real phone numbers in encrypted form | Mail, texts, labels, addresses, numbers, real phone numbers (they need the server secret key) |
| Steals the database and the server secret key | Linked real phone numbers; can test guesses of addresses | Stored mail and texts, labels, lists of addresses |
| Controls the running server for some time | New incoming mail and texts during that time; can send bad web app code | Old stored messages (unless you sign in during that time) |
| Watches the network | Nothing useful with HTTPS; SMTP between mail servers uses opportunistic TLS | — |
| Gets a payment processor record | That an invoice was paid | Which account got the credit |

## 8. Report a problem

If you find a security problem, tell the operator of the server in private before you publish it.
