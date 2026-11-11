# Security and privacy design

This document tells you what Postern protects, how it does it, and where the limits are.
It is written in plain words. Read the "Limits" section before you trust the service with important data.

One word has one meaning here: an **identity** is a named group of aliases and numbers, for example "Facebook". It never means the person.

## 1. What the server can and cannot see

| Data | Can the server read it? | Notes |
|---|---|---|
| Who you are: your real name, your own email address, your own phone number | No. It never asks. | Sign-up needs no personal data. The exception is a phone that you link (below). |
| Recovery key | No. | It never leaves your browser. |
| Account key and private key | No. | The server stores encrypted copies only. |
| Labels and notes on aliases, inboxes, numbers | No. | Encrypted in the browser. |
| Identities: their names, their notes, and which aliases and numbers are in them | No. | Encrypted in the browser. The server sees only that an encrypted entry exists, and its size. |
| Random identifiers (a random name and address for sign-up forms) | No. | Made in the browser. Stored inside the encrypted labels and the encrypted identities. |
| Stored email (text, subject, sender, attachments) | No. | Encrypted for you when it arrives. See Limits 1. |
| Stored texts, call history, and voicemail | No. | Encrypted for you when they arrive. See Limits 1 and 10. |
| Mail and texts that you send | For a moment. | The server needs the readable form to send them. It keeps only a copy that is encrypted for you. See Limits 4. |
| Your alias addresses and VoIP numbers | Not from the database. | The database has keyed hashes only. See Limits 2. |
| The senders that you block | Not from the database. | The database has a keyed hash of each one, and a copy that only you can read. |
| A linked real phone number | **Yes.** | The server must know it to forward calls and texts. The phone company sees it too. The link is optional. |
| The numbers of the operator's own phones ("own phone" provider) | **Yes.** | The server hands these numbers out and sends from them. It stores each one encrypted with the server secret key, not in plain form. See Limits 15. |
| Which items belong to one account | Yes. | The server must route mail and texts to the correct account. |
| Sizes and times of messages | Yes. | Necessary to sort and to apply limits. |
| Your settings for each item, and two counters | Yes. | See the next table. |
| Your credit balance | Yes. | Necessary to charge for items. |
| Which payment added credit to which account | **No.** | See section 4. |
| Your IP address | In memory only. | Used for rate limits. Never written to disk or to logs. |

### What the server stores for each function

The server keeps a value in plain form only when it must use that value itself.

| Function | The server stores | The server does not store |
|---|---|---|
| Blocked senders | For each block: a keyed hash of the address or domain, and a copy that only your browser can open. | The blocked sender in plain form. A record of refused senders. |
| Automatic deletion | A number of days for each inbox and for each number. The server deletes older mail and texts one time each hour. | — |
| End date of an alias | The date. After it, the server refuses mail to the alias. | — |
| "Stop after the first mail" | Two yes/no values for the alias: "one mail only" and "used up". | — |
| Counters | For each address: one number for received mail and one number for refused mail. | Who wrote, and when. |
| Forwarding and voicemail | On or off for each number, and the linked phone. | — |
| Newsletter data ("unsubscribe") | Nothing outside the encrypted message. | — |
| Voicemail | The audio, encrypted for you in the same way as a mail message. | The plain audio. It is in memory for a moment only. |
| Identities and random identifiers | Encrypted entries that only your browser can open. | Names, notes, groups, identifiers, usernames. The colour, the history, and the "burned" mark of an identity. |
| Known senders of an alias ("Possibly leaked") | Nothing in plain form. The sender domains that an alias knows are inside the encrypted data of the alias. The app saves the first sender of an alias there. | The senders. The hints: they are in the memory of your browser only. |
| Tutorial | One encrypted entry with the name `tutorial`. It always has the same size. | The step that you are at. See Limits 14. |
| Own phone (the pool of phones and SIM cards) | For each phone: its label, its gateway login and password, and its signing key, encrypted with the server secret key. For each SIM card: a keyed hash of the number, and the number encrypted with the server secret key. Only a hash of the secret token in the report address. | A plain number. The token itself. Which account will take a number: the pool has no account in it. |
| Burn | No record of the burn. The server does three normal things: it turns the aliases off, deletes their stored mail, and releases the numbers. See section 5. | That these changes were one burn. The identity keeps an encrypted "burned" mark that only your browser can read. |
| A payment in progress | An encrypted entry in your account. Your browser needs it to finish the payment. | A link between the account and the invoice. |

When mail arrives, the server compares the envelope sender, the From line, and the Sender line with the hashes of your blocks.

A block can be for one address or for a domain. A block of a domain also refuses its subdomains. When you block "all addresses" of a sender, the app proposes the main domain of that sender: for `news@mail.shop.example` it is `shop.example`. The "possibly leaked" hint and the statistics use the same rule. The rule has a short built-in list of two-part endings such as `co.uk`. It is not the full public suffix list, so for a rare ending the main domain can be one part too short.

## 2. Keys

```
recovery key (20 random bytes, shown one time)
  ├─ account number   (public identifier of the account)
  ├─ login secret     (the server stores only its SHA-256 hash)
  └─ recovery wrap key ──encrypts──► account key

account key (32 random bytes, made in the browser)
  ├─ vault key  ──encrypts──► labels, notes, identities, and the private key
  └─ export key ──encrypts──► the export file ("Download my data")

passkey (optional, one or more)
  └─ PRF value ──► passkey wrap key ──encrypts──► account key

ECDH P-256 key pair
  public key:  on the server. The server uses it to seal incoming mail, texts, and voicemail.
  private key: only in the browser (the server has an encrypted copy).
```

- Algorithms: AES-256-GCM, ECDH P-256, HKDF-SHA-256, HMAC-SHA-256. All from the WebCrypto API that is built into browsers and Node.js. There is no home-made cipher.
- The code is in `shared/crypto.js`. The browser and the server use the same file.
- The recovery key has 160 bits of randomness. A person cannot guess it and a computer cannot search it.

## 3. Login

- **Passkeys** (WebAuthn) are the main login method. A passkey cannot be phished and is never sent to the server.
- **Recovery key** is the second method. It is a long random secret, not a password that a person chooses.
- There are **no SMS codes**, no email codes, and no passwords for login.
- Sessions use one cookie: `HttpOnly`, `SameSite=Strict`, and `Secure` on HTTPS. The server stores only a hash of the session token.
- Sign-up uses a small proof-of-work puzzle in the browser. This slows down robots without a CAPTCHA and without tracking.

## 4. Private payments

Goal: the payment records and the account records must have no link between them.

How it works:

1. Your browser makes random credit tokens. One token is worth 1.00 USD.
2. Your browser saves the secret values of the payment in your account, in encrypted form. So a closed tab does not lose the payment.
3. Your browser hides ("blinds") each token and sends the blinded values with the invoice request. This request does not carry your login cookie.
4. You pay the invoice with Bitcoin Lightning, Monero, or Bitcoin on-chain. The operator decides which of the three the server offers.
5. The payment system signs the blinded values. It cannot see the tokens inside.
6. Your browser removes the blinding. Now it has valid signed tokens that the payment system has never seen.
7. Your browser gives the tokens to your account. The server checks the signature and adds credit.

Result: the payment database knows "invoice X was paid". The account database knows "this account received credit". No stored value connects the two. The two databases are separate files (`payments.db`, `accounts.db`).

If you close the app before step 7, the payment continues the next time you open the app. See Limits 6.

The method is an RSA blind signature (Chaum, 1982) with a full-domain hash. The code is in `shared/blind.js` and `server/core/blindsign.js`.

## 5. Other protections

- **No request logs.** The application log has operational messages and errors only. It has no addresses, no numbers, no message text, and no IP addresses.
- **Deleted means deleted, on the server.** The database runs with `secure_delete`, which writes zeros over deleted rows. One time each hour the server also empties the write-ahead file of the database, where an older copy can stay for a short time. Backups are a different matter: see Limits 9.
- **Day precision.** Creation dates are stored as a day, not as an exact time, where the service does not need the exact time.
- **Strict browser policy.** The web app loads no third-party script, font, or image. A Content-Security-Policy blocks inline scripts.
- **Email HTML is isolated.** The app shows email HTML in a sandboxed frame that cannot run scripts. Remote images are blocked, so senders cannot track when you open a message.
- **No unsubscribe link is opened.** To leave a newsletter, the app sends a normal email to the address that the newsletter gives. Postern never opens an unsubscribe web link. A visit to that link tells the sender that a person reads the address, and it makes the server open an address that a stranger chose. "Unsubscribe by email" is a real mail from the address that got the newsletter. So the sender learns that this address is in use. The app keeps an encrypted copy in "Sent", as for each mail that you send.
- **Work that stays in the browser.** These helpers do their work in the browser: the code helper, the "possibly leaked" hint, "Who leaked me", and "My stats". Also the search (the "/" key), the warnings on Home, and "Test my recovery key". Also the random identifiers generator, and the username and password maker. The server gets no result of this work in plain form. Three details:
  - "My stats" and "Who leaked me" read your encrypted mail list, the newest 1,000 messages at most, as the Mail screen does. The server sees these requests. It does not see the counts or the hints.
  - Two results are saved, both encrypted: the known senders of an alias, and a username. The password maker stores no password. You copy the password into your password manager.
  - The search, the warnings on Home, and "Test my recovery key" make no request. The recovery key that you type for the test is not sent and not saved.
- **Encrypted export.** The browser makes the export file and encrypts it. The server never sees the plain file. The recovery key opens the file on the page "Open an export file". That page reads the file in the browser. After the page has loaded, it asks the server for nothing, and it also works when you are signed out. See Limits 12.
- **Burn deletes on the server.** A burn of an identity does three things on the server. It turns off the aliases of the identity. It deletes all stored mail of these aliases: incoming mail and Sent copies, with attachments. It releases the numbers of the identity, with their texts, their call records and their voicemail. After it deletes the mail, the server empties the write-ahead file. While a burn runs, the identity holds an encrypted list of what is left to do, so that a burn that stopped can be finished. Two things are out of reach: backups (Limits 9) and the records of the phone company (Limits 3).
- **Cross-site request protection.** `SameSite=Strict` cookie, an Origin check, and JSON-only request bodies.
- **Rate limits** on login, sign-up, and sending. Counters are in memory only.
- **A deleted address is never reused.** A new user cannot get the old mail of a deleted alias.
- **Real phone links are verified** with a code, by text or by a call that says the code. So nobody can forward calls to the phone of a different person.

## 6. Limits (read this)

1. **Mail and texts arrive unencrypted.** Email (SMTP) and the telephone network are not end-to-end encrypted. The server sees an incoming message for a moment, encrypts it for you, and forgets the plain form. A server that an attacker controls *at that moment* can read new messages as they arrive. It cannot read messages that are stored already. This is the same model as Proton Mail and Tuta for mail from other providers.
2. **A seized server can test guesses.** The database stores keyed hashes of addresses, numbers, and blocked senders. An attacker who has the database *and* the server secret key can test "does address X exist here?" or "does this address block sender Y?". The attacker cannot list the addresses of an account.
3. **The telephone provider sees everything on its side.** The provider (for example Twilio) sees the numbers, the texts, and the call records. It keeps logs under its own policy. Postern cannot change that. If you link a real phone, the provider also sees that phone number each time it forwards a call or a text to it. Use phone numbers for convenience, not for secrets. With the "own phone" provider, the carrier of the SIM card is in this place: see limit 15.
4. **Outgoing mail is visible to the relay and to the recipient's provider.** This is how email works. The server also sees a message or a text that you send, for the moment in which it sends it.
5. **You must trust the web app code that the server sends.** This is true for every web app with browser encryption. If you run your own server, you control that code. A future improvement is a signed browser extension or a packaged app.
6. **Timing can link things.** The server stores no link between a payment and an account. But a modified server could log times and IP addresses and compare them. Postern does not do this. There are two moments:
   - Just before the invoice request, your browser saves the encrypted payment entry in your account.
   - After the payment, your browser adds the credit to your account.

   You can lower the risk of the second moment. There is no "add credit later" button. Pay, close the app, and open it later: the app then finishes the payment. This does not change the first moment.
7. **If you lose the recovery key and all passkeys, the data is lost.** Nobody can reset it. This is the price of "the server cannot read it". The data is also lost in this case: you have no recovery key, and your only passkeys are of the type in limit 8. Then you can sign in, but nothing can decrypt your data.
8. **Passkeys without PRF support** cannot unlock the encryption alone. The app then asks for the recovery key one time in each new browser session.
9. **Backups keep deleted data.** The operator can make backups of the database. A backup from before a deletion still has the data, in the same encrypted form as on the server. This is true for data that you delete and for data that the automatic deletion removes. The data stays until the operator deletes that backup. The backup script of the setup guide keeps 7 backups. Ask the operator how long backups stay.
10. **The phone company hears each voicemail.** The company plays the greeting and records the message itself. Postern cannot encrypt a voicemail before the company has it. Postern fetches the recording, encrypts it for you, and then deletes it at the company. If the company does not delete it, Postern tries again each hour for 30 days. The company can keep call records under its own policy, and its own backups for some time. Postern cannot delete those.
11. **A mail domain that only one person uses links its aliases.** Each website sees the domain of the alias that you give it. If only you use that domain, websites that compare their lists can tell that the addresses belong to one person. A domain that many people share does not show this. On a server for one person, each domain is such a domain.
12. **Two export files of one account can be recognised.** The plain header of an export file has the app name, the day, sizes, and the encrypted account key. The encrypted account key is the same in each export of one account. A person who has two export files can tell that they come from the same account. That person cannot read them without the recovery key. A person who has one file *and* the recovery key can read everything in it.
13. **Some settings and counts are plain for the server.** The server does the deleting and the refusing, so it knows your settings for automatic deletion, end dates, "stop after the first mail", forwarding, and voicemail. It also knows how many messages each address received and refused. It does not know who wrote them.
14. **The server sees that an encrypted entry changes, and when.** It sees the name and the size of each encrypted entry of your account, not the contents. Example: the tutorial saves its progress in the entry `tutorial`, and the entry changes with each step that you take. So the server can count these changes and see their times. It cannot read which step it is, and the size tells nothing, because it is always the same. The same is true for the entry with your identities. It is also true for the encrypted data of an alias, when the app saves a known sender in it.
15. **With the "own phone" provider, three more places see your texts.** This provider uses an Android phone of the operator, an app on it, and a gateway program on the server. Texts only, no calls.
    - **The carrier of the SIM card** sees each text, in the two directions, with the two numbers. It knows who bought the SIM card, if it asked.
    - **The phone** has each text in plain form, as each phone has. A person who holds the phone can read them.
    - **The gateway program on the server** stores a text that waits for the phone in plain form. After the phone has sent it, the gateway changes it to a hash. The app also uploads a copy of each incoming text to the gateway. The gateway deletes these rows after 24 hours with the settings of the setup guide. The backup script also saves the gateway database, so each backup keeps these rows until that backup is deleted (7 days by default). Postern itself stores texts only in the form that is encrypted for you.
    - **A push company, only if the operator selects it.** With the setting "Auto" in the app, the server of the app project and Google get a wake-up signal for each text that waits. The signal has no text and no number. They learn that something waits, when, and for which phone. With "SSE Only", which the setup guide uses, no signal goes to them.
    - **A number from the pool had an earlier holder.** It can get texts that are for that person.
    - **The phone is one device.** If it is off, texts wait. A text that the phone does not send in 1 hour fails.
    - This provider was tested with a simulated gateway only, not with a real phone.

## 7. What an attacker gets

| Attacker | Gets | Does not get |
|---|---|---|
| Steals a database backup | Encrypted blobs, hashes, balances, settings and counters, real phone numbers in encrypted form. Also data that was deleted or burned after the backup. | Mail, texts, voicemail, labels, identities, random identifiers, usernames, the known senders of an alias, addresses, numbers, blocked senders, real phone numbers (they need the server secret key) |
| Steals the database and the server secret key | Linked real phone numbers; the numbers and the gateway logins of the operator's own phones; can test guesses of addresses and of blocked senders; can make false credit tokens | Stored mail, texts and voicemail, labels, identities, lists of addresses |
| Controls the running server for some time | New incoming mail, texts and voicemail during that time; can send bad web app code; can log times and IP addresses, also the times at which encrypted entries change | Old stored messages (unless you sign in during that time) |
| Watches the network | Nothing useful with HTTPS; SMTP between mail servers uses opportunistic TLS | — |
| Gets a payment processor record | That an invoice was paid | Which account got the credit |
| Gets the records of the phone company | Numbers, texts, call records; a linked real phone that got forwarded calls or texts, and which numbers forward to it; a voicemail recording until Postern deleted it | Stored mail, labels, your aliases |
| Gets the phone of the "own phone" provider, or the records of its SIM carrier | Each text of the numbers on that phone, with the two numbers. From the gateway database on the server: texts that wait, and hashes of sent texts, for 24 hours (longer in backups). | Mail, labels, your aliases, which account holds a number |
| Gets two export files, without the recovery key | That the two files come from the same account; their sizes and days | The contents |
| Websites that compare their lists | That aliases on a domain of one person belong together | Aliases on a domain that many people share |

## 8. Report a problem

If you find a security problem, tell the operator of the server in private before you publish it.
