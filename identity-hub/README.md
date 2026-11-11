# Postern — private identity hub

One person. Many email addresses and phone numbers. One clean screen. Paid with crypto.

Postern gives you:

- **Email aliases.** Make and delete throwaway addresses when you want.
- **Real inboxes.** Mail stays in the app. It is not forwarded to a different mail provider.
- **Phone numbers.** Get and release numbers. Send and receive texts. Receive and make calls.
- **Real phone link.** Forward texts and calls from a number to your own phone, if you want.
- **Crypto payments.** Bitcoin Lightning, Monero, and Bitcoin on-chain through BTCPay Server.
- **One dashboard.** Each alias, inbox, and number is on one screen.

"Postern" is a working name. Change it with the `APP_NAME` setting.

## Privacy in short

- Sign-up needs **no name, no email, no phone number**.
- Login is a **passkey** or a long random **recovery key**. There are no SMS codes and no passwords.
- The server **cannot read** your stored mail, texts, labels, or the list of your addresses.
- Payment records and account records have **no link** between them.
- The server writes **no request logs** and stores **no IP addresses**.

Read [docs/SECURITY.md](docs/SECURITY.md) for the design and for the honest limits.

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
The app shows a "Test tools" panel. Use it to simulate incoming mail, texts, calls, and payments.

Try this:

1. Select "Create account". Save the recovery key that the app shows.
2. Open "Funds". Add funds. Select "Simulate payment".
3. Make an inbox. Then make an alias.
4. Open "Test tools". Send a test mail to your alias. Read it in "Mail".
5. Get a phone number. Simulate an incoming text.

The data is in the folder `data/`. Delete this folder to start again.

## Run the tests

```bash
npm test
```

The tests use simulated providers. They do not use the internet.

Browser tests (they need Playwright and Chromium):

```bash
npm run test:e2e
```

## Put it on the internet

Follow [docs/SETUP-GUIDE.md](docs/SETUP-GUIDE.md). It gives each step in simple words:
the server, the domain and DNS records, Docker, outgoing mail, BTCPay Server, the phone provider, backups.

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

| Item | Why | Identity data? | Crypto? |
|---|---|---|---|
| Domain name | Web address and mail addresses | Depends on the seller | Some sellers |
| Server (VPS) with mail port 25 open | Runs Postern | Some hosts ask for none | Some hosts |
| BTCPay Server (your own) | Receives Lightning and Monero | No | It is the crypto system |
| Phone provider account (optional) | Phone numbers, texts, calls | **Yes, for the operator** (see below) | No (see below) |
| Mail relay (optional) | Better delivery of outgoing mail | Depends | Some |

The full table with names, prices, and sources is in the setup guide and in [docs/PROVIDERS.md](docs/PROVIDERS.md).

### Settings and keys

All settings are in `deploy/.env.example`, with one comment line each. The important ones:

| Setting | What it is |
|---|---|
| `PUBLIC_URL` | The https address of your Postern |
| `MAIL_DOMAINS` | The domains for mail addresses |
| `SMTP_RELAY_URL` | Where outgoing mail goes |
| `PAY_PROVIDER`, `BTCPAY_URL`, `BTCPAY_API_KEY`, `BTCPAY_STORE_ID`, `BTCPAY_WEBHOOK_SECRET` | Payments |
| `PHONE_PROVIDER`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Phone numbers |
| `SIGNUP` | `open` or `closed`. Set `closed` when your account exists and the service is only for you. |
| `PRICE_*` | Prices in credits. 100 credits = 1.00 USD. 0 = free. |

Postern makes its own secret key on the first start (`data/secret.key`). **Make a safe copy of this file.**
Without it, linked phone numbers and the payment signing key cannot be read.

## Plain facts (read before you depend on it)

1. **Phone providers want to know the operator.** I found no provider that has an API for numbers, texts, and calls, accepts crypto, and does not verify the operator. Your users stay anonymous. You, the operator, do not, if you use a phone company API.
2. **US numbers cannot send texts without registration.** US carriers block texts from unregistered local numbers ("10DLC"). Receiving works. Calls work.
3. **Mail and phone networks are not end-to-end encrypted.** Postern encrypts a message when it arrives. It cannot protect the message on its way to the server.
4. **A lost recovery key cannot be reset.** If you lose the recovery key and all passkeys, the data is gone.
5. **Outgoing mail from a new server can go to spam.** The setup guide tells you how to lower this risk (SPF, DKIM, DMARC, reverse DNS).

## What was tested, and what was not

| Part | Tested how |
|---|---|
| Encryption, keys, private payment tokens | Automatic tests |
| Sign-up, passkeys, recovery key login | Automatic tests with a software passkey; browser tests with a virtual passkey |
| Mail in and out | Automatic tests with real SMTP connections on the local computer |
| Phone numbers, texts, calls | Automatic tests with a simulated provider |
| Twilio adapter | Automatic tests against a **simulated** Twilio. Never run against the real Twilio. |
| BTCPay adapter | Automatic tests against a **simulated** BTCPay. Never run against a real BTCPay Server. |
| Web app | Browser tests in Chromium |
| Docker files | Checked by `docker compose config` and by hand. **The image was never built** (no Docker in the build environment). |
| Delivery to Gmail, Outlook, and others | Not tested. It needs a real server and domain. |

The first time you connect a real provider, do the "Check" step of that part in the setup guide.

## How it is built

```
identity-hub/
  shared/     encryption code used by the browser AND the server
  server/
    core/     settings, database, HTTP layer, accounts, sessions, renewals, token signer
    auth/     sign-up, login, passkeys, vault
    mail/     inboxes, aliases, incoming SMTP, sending
    phone/    numbers, texts, calls, real phones, provider adapters
    pay/      invoices, private credit tokens, BTCPay adapter
  web/        the web app (plain HTML, CSS, JavaScript; no build step)
  test/       automatic tests (node:test)
  e2e/        browser tests (Playwright)
  deploy/     Dockerfile, docker-compose.yml, Caddyfile, .env.example, backup.sh
  docs/       API.md, SECURITY.md, SETUP-GUIDE.md, PROVIDERS.md
```

- **Server:** Node.js 22, the SQLite database that is built into Node.js, no web framework.
- **Packages (4):** `@simplewebauthn/server` (passkey checks), `smtp-server` (receive mail), `mailparser` (read mail), `nodemailer` (send mail).
- **Web app:** no framework, no third-party script, no web font, no tracking.
- **Two database files:** `accounts.db` and `payments.db`. The payment file has no account identifiers.

[docs/API.md](docs/API.md) is the contract between the server and the web app.

## Licence

No licence is set yet. Until you add one, the code is "all rights reserved" by default.
For a privacy tool, an open-source licence (for example AGPL-3.0) lets other people examine the code.
