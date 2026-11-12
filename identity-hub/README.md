# Postern — private identity hub

One person. Many email addresses and phone numbers. One clean screen. Paid with crypto.

"Postern" is a working name. Change it with the `APP_NAME` setting. The app then shows the new name in each place.

## What it does

**Mail**
- **Inboxes.** Real inboxes in the app. Mail is not forwarded to a different mail company.
- **Aliases.** Make and delete throwaway addresses when you want. Turn one off when it gets unwanted mail.
- **Stop after the first mail.** An alias that takes one mail (for example a sign-up code) and then stops.
- **End date.** An alias that stops on a day that you select.
- **Block a sender.** One address or a whole domain, for one alias.
- **Delete old mail automatically.** For each inbox, after a number of days that you select.
- **Your own domain.** The operator can add more mail domains.

**Numbers**
- **Phone numbers.** Get and release numbers. Send and receive texts.
- **Calls and voicemail** (only with a phone company that can do calls).
- **Real phone link.** Forward texts and calls to your own phone, if you want.
- **Three phone providers:** Twilio, your own Android phone with SIM cards, or a simulated provider for tests.

**Identities**
- **Identity.** A named group, for example "Facebook", with its aliases and numbers and all their mail and texts in one list.
- **Random identifiers generator.** A random name, address, username, and password for sign-up forms. Made in the browser.
- **Burn.** One action turns off the aliases, releases the numbers, and deletes the mail, texts, and call history of an identity.
- **Colour, history, and a small door mark** for each identity.

**Help and safety**
- **Help, "Why?" buttons, and a tutorial** that you do one step at a time.
- **Possibly leaked.** A hint when an alias gets mail from a sender that it does not usually get. **Who leaked me** lists these aliases.
- **Code helper.** A sign-up code in a mail or text gets a copy button.
- **Download my data.** One encrypted file. Your recovery key opens it again, without the server.
- **Test my recovery key**, **My stats**, **Search** (press `/`), and **warnings** on Home before an item is paused.

**Payments**
- Bitcoin Lightning, Monero, and Bitcoin on-chain through BTCPay Server.

## Privacy in short

- Sign-up needs **no name, no email, no phone number**.
- You sign in with a **passkey** or a long random **recovery key**. There are no SMS codes and no passwords.
- The server **cannot read** your stored mail, texts, labels, identities, or the list of your addresses.
- Payment records and account records have **no link** between them.
- The server writes **no request logs** and stores **no IP addresses**.

Read [docs/SECURITY.md](docs/SECURITY.md) for the design and for the honest limits. It does not make you invisible.

## Try it on your computer (5 minutes)

You need Node.js 22.13 or newer.

```bash
cd identity-hub
```

```bash
npm install
```

```bash
npm start
```

Open `http://localhost:8080`.

This is **test mode**. Mail, phone, and payment providers are simulated. No real money moves.

1. Select "Create account". Save the recovery key that the app shows.
2. Select "Start the tutorial" on Home. The tutorial shows each main function, one step at a time.

"Test tools" in the app can simulate incoming mail, texts, calls, and payments.
The data is in the folder `data/`. Delete this folder to start again.

## Run the tests

Automatic tests (no internet, simulated providers):

```bash
npm test
```

Browser tests (they need Playwright and Chromium on the computer):

```bash
npm run test:e2e
```

## Put it on the internet

Follow [docs/SETUP-GUIDE.md](docs/SETUP-GUIDE.md). It gives each step in simple words:
the server, the domain and DNS records, Docker, outgoing mail, BTCPay Server, the phone provider (Twilio or your own phone), your own mail domain, backups, and a list of problems and solutions.

Short version:

```bash
cd identity-hub/deploy
```

```bash
cp .env.example .env
```

Edit `.env`. Then:

```bash
docker compose up -d --build
```

## What you must get

| Item | Why | Asks who you are? | Crypto? |
|---|---|---|---|
| Domain name | Web address and mail addresses | Depends on the seller | Some sellers |
| Server (VPS) with mail port 25 open | Runs Postern | Some hosts ask for nothing | Some hosts |
| BTCPay Server (your own) | Receives Lightning and Monero | No | It is the crypto system |
| Phone numbers, option 1: Twilio account | Numbers, texts, calls | **Yes, the operator** | No |
| Phone numbers, option 2: an Android phone with SIM cards | Numbers and texts, no calls | Depends on where you get the SIM | Depends on the SIM seller |
| Mail relay (optional) | Better delivery of outgoing mail | Depends | Some |

The full list with names, prices, and sources is in the setup guide and in [docs/PROVIDERS.md](docs/PROVIDERS.md).

### Settings and keys

All settings are in `deploy/.env.example`, with a comment for each. The important ones:

| Setting | What it is |
|---|---|
| `PUBLIC_URL` | The https address of your Postern |
| `MAIL_DOMAINS` | The domains for mail addresses |
| `SMTP_RELAY_URL` | Where outgoing mail goes |
| `PAY_PROVIDER`, `BTCPAY_*` | Payments |
| `PHONE_PROVIDER` | `twilio`, `ownphone`, or `off` |
| `TWILIO_*` or `OWNPHONE_*` | The settings of the phone provider that you use |
| `SIGNUP` | `open` or `closed`. Set `closed` when your account exists and the service is only for you. |
| `PRICE_*` | Prices in credits. 100 credits = 1.00 USD. 0 = free. |

Postern makes its own secret key on the first start (`data/secret.key`). **Make a safe copy of this file.**
Without it, linked phone numbers, the phone pool, and the payment signing key cannot be read.

## Plain facts (read before you depend on it)

1. **Phone companies want to know the operator.** No company was found that has an API for numbers, texts, and calls, accepts crypto, and does not check the operator. Your users stay unknown. You, the operator, do not, if you use such a company. The "own phone" provider is the way around this, with its own limits (texts only, one phone can fail).
2. **US numbers from a phone company cannot send texts without registration** ("10DLC"). Receiving works. Calls work.
3. **Mail and phone networks are not end-to-end encrypted.** Postern encrypts a message when it arrives. It cannot protect the message on its way to the server.
4. **A lost recovery key cannot be reset.** If you lose the recovery key and all passkeys that can unlock your data, the data is gone.
5. **Outgoing mail from a new server can go to spam.** The setup guide tells you how to lower this risk.
6. **Deleted data can stay in older backups** of the operator until those backups are deleted.

## What was tested, and what was not

| Part | Tested how |
|---|---|
| Encryption, keys, private payment tokens, export file format | Automatic tests |
| Sign-up, passkeys, recovery key | Automatic tests with a software passkey; browser tests with a virtual passkey |
| Mail in and out, blocks, automatic deletion | Automatic tests with real SMTP connections on the local computer; browser tests |
| Numbers, texts, calls, voicemail | Automatic tests and browser tests with a **simulated** provider |
| Twilio adapter | Automatic tests against a **simulated** Twilio. **Never run against the real Twilio.** |
| BTCPay adapter | Automatic tests against a **simulated** BTCPay. **Never run against a real BTCPay Server.** |
| "Own phone" provider | Automatic tests and a browser test against a **simulated** gateway. **Never tried with a real phone, a real SIM card, the real app, or the real gateway server.** |
| Web app | Browser tests in Chromium only. Not tested in Firefox or Safari, on a real phone, or with a screen reader. |
| Docker files | Checked by `docker compose config` and by hand. **The image was never built** (no Docker in the build environment). |
| Delivery to Gmail, Outlook, and others | Not tested. It needs a real server and domain. |

The first time that you connect a real provider, do the "Check" step of that part in the setup guide.

## How it is built

```
identity-hub/
  shared/     encryption code used by the browser AND the server
  server/
    core/     settings, database, HTTP layer, accounts, sessions, renewals, token signer
    auth/     sign-up, sign-in, passkeys, vault
    mail/     inboxes, aliases, incoming SMTP, sending, blocks, automatic deletion
    phone/    numbers, texts, calls, voicemail, real phones, provider adapters (mock, Twilio, own phone)
    pay/      invoices, private credit tokens, BTCPay adapter
    tools/    operator tool for the "own phone" pool
  web/        the web app (plain HTML, CSS, JavaScript; no build step)
    js/lib/       data, encryption helpers, pure logic modules
    js/screens/   the main screens
    js/ui/        shared parts (rows, dialogs, menus)
    js/features/  one file or folder for each later feature (plugged in through js/lib/registry.js)
    js/help/      the help text
  test/       automatic tests (node:test)
  e2e/        browser tests (Playwright)
  deploy/     Dockerfile, docker-compose.yml, Caddyfile, .env.example, backup.sh
  docs/       API.md, SECURITY.md, SETUP-GUIDE.md, PROVIDERS.md, UI-GUIDE.md, HANDOFF.md
```

- **Server:** Node.js 22, the SQLite database that is built into Node.js, no web framework.
- **Packages (4):** `@simplewebauthn/server` (passkey checks), `smtp-server` (receive mail), `mailparser` (read mail), `nodemailer` (send mail).
- **Web app:** no framework, no third-party script, no web font, no tracking. Dark theme by default; a light theme is in Settings.
- **Two database files:** `accounts.db` and `payments.db`. The payment file has no account identifiers.

Documents for people who change the code:
- [docs/API.md](docs/API.md): the contract between the server and the web app.
- [docs/UI-GUIDE.md](docs/UI-GUIDE.md): the building blocks, the look, and the word list of the web app. Read it before you write a screen.
- [docs/HANDOFF.md](docs/HANDOFF.md): the working notes of the build (decisions and the feature list).

## Licence

No licence is set yet. Until you add one, the code is "all rights reserved" by default.
For a privacy tool, an open-source licence (for example AGPL-3.0) lets other people examine the code.
