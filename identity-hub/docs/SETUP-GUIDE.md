# Postern setup guide

This guide is for a person who operates a Postern server for the first time.
You do not need server experience. You need patience and you must do the steps in sequence.

The result is a working service on your own server:

- email aliases and real inboxes on your domain,
- phone numbers with texts and calls (optional),
- payments with Bitcoin Lightning and Monero (optional).

The facts about outside companies come from [PROVIDERS.md](PROVIDERS.md). A source key such as `[R2]` points to the source list in that document.
The security design is in [SECURITY.md](SECURITY.md).

## How to use this guide

**Do the parts in sequence: A, B, C, D, E, F, G, H, I.** Parts E, F and H are optional.

| Section or part | Subject |
|---|---|
| Section 1 | What you need |
| Section 2 | Plain facts before you start |
| Part A | Rent a server |
| Part B | Buy a domain and set the DNS records |
| Part C | Install Docker and start Postern |
| Part D | Outgoing mail |
| Part E | Payments with BTCPay Server (optional) |
| Part F | Phone numbers with Twilio (optional) |
| Part G | First sign-up and tests |
| Part H | Use your own domain for aliases (optional) |
| Part I | Backups and updates |
| Part J | Troubleshooting |

**A grey box is a command.** Type it exactly, or copy it. Then press Enter.

```
echo "this is a command"
```

**"Check"** tells you how to make sure that a step was successful. Do not continue if a check fails. Look in Part J.

**"Check this"** marks a fact that the authors could not confirm. Confirm it yourself before you depend on it.

**Example values.** Replace them with your values each time:

| Example | Meaning |
|---|---|
| `example.com` | Your domain. User addresses look like `name@example.com`. |
| `mail.example.com` | The name of your server. It is the web address and the mail server name. |
| `203.0.113.10` | The IPv4 address of your server. |
| `/opt/postern` | The folder of the Postern project on the server. |

**Words:**

| Word | Meaning |
|---|---|
| server | A computer that you rent in a data center. It runs all day. |
| terminal | The program in which you type commands. |
| `.env` file | The file that contains all settings of Postern. |
| DNS record | One line in the public address book of your domain. |
| port | A numbered door of the server. Mail uses port 25. The web uses ports 80 and 443. |
| relay | A program that delivers outgoing mail to other mail servers. |
| text | A short message to or from a phone number (SMS). |
| provider | A company that sells you a service. |

**How to change a setting.** Many steps tell you to change settings and apply the change. This is the procedure:

1. Go to the settings folder:
   ```
   cd /opt/postern/deploy
   ```
2. Open the `.env` file:
   ```
   nano .env
   ```
3. Find the line with the name of the setting. Use the arrow keys.
4. Change the value after the `=` sign. Do not add spaces. Do this for each setting in the step.
5. Save the file: press Ctrl+O, then press Enter.
6. Close the editor: press Ctrl+X.
7. Apply the change:
   ```
   docker compose up -d
   ```

**Test status of the files.** The authors checked the files in `deploy/` with `docker compose config` and with a manual start of the program.
The authors did not test a complete start with Docker (image build, Caddy, relay).

---

## 1. What you need

Costs are estimates from November 2026. Check the price of each provider before you pay.

### Accounts and services

| Item | What it is for | Cost (estimate) | Does it ask for identity data? | Does it take crypto? |
|---|---|---|---|---|
| Domain name | The web address and the email addresses | 10 to 20 USD each year | Usually yes. Most sellers ask for a name and an address. Some sellers register the domain in their own name. **Check this** for the seller that you select. | Some sellers do. IncogNET sells domains for crypto `[E3]`. |
| Second domain name (optional) | Aliases on a domain that websites do not refuse (Part H) | 10 to 20 USD each year | Same as the first domain name | Same as the first domain name |
| Server for Postern (VPS) | Runs Postern and receives mail on port 25 | 5 to 15 USD each month | FlokiNET and IncogNET: reported no. **Check this.** | Yes: Monero and Bitcoin at the hosts in Part A. |
| Second server for BTCPay Server (optional) | Runs your payment system | 10 to 40 USD each month. Minimum 2 GB memory and 80 GB disk for Bitcoin `[B12]`. Monero needs more disk. **Check this.** | Same as above | Same as above |
| BTCPay Server (optional) | Makes payment requests. Receives Lightning and Monero. | The software is free. | No. You install it yourself. | Not applicable |
| Lightning capacity (optional) | A new Lightning node cannot receive money before it has a channel with incoming capacity. | Different for each seller. **Check this.** | Usually no | Yes |
| Twilio account (optional) | Phone numbers, texts, calls | US local number: 1.15 USD each month. One text: 0.0083 USD plus carrier fees `[T3]`. 10DLC registration has more fees. **Check this.** | **Yes.** Email address, phone number and a payment card. 10DLC registration needs your business identity or your personal identity. | **No.** Twilio takes a card or PayPal `[T1]`. The research found no crypto option. |
| Mail relay company (optional) | Sends outgoing mail if other servers do not trust your server address | Different for each company | Different for each company | Maileroo takes Bitcoin `[E7]`. KingSMTP says that it takes Monero. This is not verified `[E8]`. |

### Keys and secrets that you collect

You put each of these values in the `.env` file. Each row says which part of this guide gives you the value.

| Value | Name in the `.env` file | Where it comes from | Secret? |
|---|---|---|---|
| Server secret | `SECRET_KEY` | You make it (Part C) | **Yes. Keep a copy offline.** |
| Web address | `PUBLIC_URL` | Your domain (Part B) | No |
| Mail domains | `MAIL_DOMAINS` | Your domain (Part B) | No |
| Mail server name | `MAIL_HOSTNAME` | Your domain (Part B) | No |
| BTCPay address | `BTCPAY_URL` | Your BTCPay Server (Part E) | No |
| BTCPay store ID | `BTCPAY_STORE_ID` | BTCPay Server, store settings (Part E) | No |
| BTCPay API key | `BTCPAY_API_KEY` | BTCPay Server, account settings (Part E) | Yes |
| BTCPay webhook secret | `BTCPAY_WEBHOOK_SECRET` | BTCPay Server, webhook page (Part E) | Yes |
| Twilio Account SID | `TWILIO_ACCOUNT_SID` | Twilio Console (Part F) | No |
| Twilio Auth Token | `TWILIO_AUTH_TOKEN` | Twilio Console (Part F) | Yes |
| Twilio Messaging Service ID (optional) | `TWILIO_MESSAGING_SERVICE_SID` | Twilio Console, after the 10DLC registration (Part F3) | No |
| Twilio regulatory bundle ID (optional) | `TWILIO_BUNDLE_SID` | Twilio Console (Part F5) | No |
| Twilio address ID (optional) | `TWILIO_ADDRESS_SID` | Twilio Console (Part F5) | No |

---

## 2. Plain facts before you start

Read this section completely. It tells you what Postern cannot do for you.

### Phone numbers

1. **No telephone provider gives you all three: an API, payment with crypto, and no verification of the operator.** The research found none. See [PROVIDERS.md](PROVIDERS.md), section 1.
2. **Postern uses Twilio.** Twilio takes a card or PayPal `[T1]`. The research found no crypto option. Twilio knows who you are.
3. **Your users are anonymous to you. You are not anonymous to Twilio.** All numbers of all users are in your Twilio account.
4. **Twilio sees everything on its side:** the numbers, the text of each message, and the record of each call. Postern cannot hide this.
5. **Twilio keeps the message records.** The log shows about 400 days. Twilio does not delete older records automatically `[W14]`.
6. **You can reduce what Twilio keeps, but only in part.**
   - You can delete message records in the Twilio Console or with the Twilio API `[W14]`.
   - "Message Redaction" removes message text from the records. Twilio must enable it for your account `[W13]`.
   - **Check this:** Postern does not ask Twilio to discard the text of each message.
7. **US local numbers cannot send texts to US phones without "A2P 10DLC" registration.** Twilio blocks each such text with error 30034. Twilio charges you for the blocked text too `[R1][R2]`.
8. **10DLC registration needs your identity:** a business with a tax number, or your real name, address and phone `[R5][R6]`.
9. **The carriers treat all texts from Twilio as business texts.** A text from one person to one person through Postern is not an exception `[R4]`.
10. **To receive texts works without registration** `[R7]`. Texts to Canadian phones are also not blocked `[R7]`.
11. **The 10DLC rule is about texts.** The research found no such block for calls. **Check this.**
12. **A user links a real phone with a code.** Postern sends the code from the number of the user: by text, or by a call in which a voice says the code.
    The call is important: a US number without 10DLC registration cannot send the text to a US phone, but it can make the call. **Check this** with one test.
13. **Some countries need identity documents at Twilio.** The United Kingdom is an example `[R9]`. Twilio keeps the documents as a "regulatory bundle" and an "address".
    Put their IDs in `TWILIO_BUNDLE_SID` and `TWILIO_ADDRESS_SID` (Part F5). Postern then sends the two IDs with each purchase.
    The authors tested this with a simulated Twilio only. **Check this.** Without the IDs, keep such countries out of `PHONE_COUNTRIES`.
14. **You pay Twilio each month for each number, in normal money.** Your users pay you with credit. Set `PRICE_NUMBER_MONTH` higher than your cost.
15. **You can operate Postern without phone numbers.** Set `PHONE_PROVIDER=off`. Then Postern gives email and payments only, and you do not need Twilio. No provider in this guide then needs your identity, if you pay the server and the domain with crypto.
16. **By default, users can text and call only numbers in the United States and Canada.** Postern also refuses premium numbers and some expensive area codes. You pay Twilio for each text and call, so this limit protects your money. Part F6 tells you how to change it.
17. **The phone provider makes the recording of each voicemail.** Thus the provider hears the complete message. Part F7 tells you more.

### Email

18. **Email arrives at your server without end-to-end encryption.** Postern encrypts each message for the user when it arrives. See [SECURITY.md](SECURITY.md), section 6.
19. **Outgoing email is visible to the relay and to the provider of the recipient.** This is how email works.
20. **A new server address has no reputation.** Large mail providers can put your first messages in the spam folder. Correct DNS records help. Time helps. No setting removes this problem fully.
21. **Most server hosts in Part A block outgoing mail ports on a new server.** You must ask the host to open them `[E1][E3][E4]`.
22. **A domain that only one person uses ties the aliases on it together.** Each website can see that the addresses are on the same private domain. On a server for one person, this is true for each domain. See Part H.

### Payments

23. **A third-party BTCPay host can see your payment data. Lightning payments go to the wallet of the host** `[B13]`. Use your own BTCPay Server.
24. **The Monero plugin uses one wallet for all stores of a BTCPay Server** `[B10]`. This is one more reason to use your own BTCPay Server.
25. **The name of the Monero payment method (`XMR-CHAIN`) is not confirmed** `[B9]`. Part E tells you how to confirm it.
26. **If payments are off, users cannot add credit.** Then you must set the five `PRICE_` settings to `0`, or nobody can make an inbox.
27. **If prices are 0 and sign-up is open, each visitor can buy phone numbers with your Twilio money.** Close the sign-up (Part G).

### Your responsibility

28. **You cannot make the server secret (`SECRET_KEY`) a second time.** If you lose it, Postern cannot find the addresses and numbers of your users.
29. **A user who loses the recovery key and all passkeys loses the account.** You cannot reset it.
30. **A backup keeps deleted data.** This is true for data that a user deletes, and for data that the automatic deletion removes.
    The data stays in each older backup until you delete that backup. Part I7 tells you how long `backup.sh` keeps backups.
31. **You are the operator of a communication service.** The laws of your country can apply to you. This guide gives no legal advice.

---

## Part A. Rent a server

### What the server must have

| Property | Value | Why |
|---|---|---|
| Operating system | Debian 12 or later, 64-bit | The commands in this guide are for Debian. |
| Memory | 2 GB (1 GB is the minimum) | Three programs run at the same time. |
| Disk | 20 GB or more | One inbox can use 1 GB (`LIMIT_MAILBOX_BYTES`). |
| IPv4 address | One address that only your server uses | Other mail servers judge your mail by this address. |
| Port 25, incoming | Open | To receive mail |
| Port 25, outgoing | Open, or the host opens it on request | To send mail |
| Reverse DNS (PTR record) | You can set it, or the host sets it on request | Other mail servers refuse mail from an address without it. |
| Payment | Crypto, with no identity data | Privacy |

### Server hosts from the research

| Host | Crypto | Mail ports | Source |
|---|---|---|---|
| FlokiNET | Monero and other coins | Outgoing ports 25, 465 and 587 are blocked on a new server. The host opens them after a ticket. You must set SPF, DKIM and DMARC records first. | `[E1][E2]` |
| IncogNET | Monero, Bitcoin, Litecoin | Port 25 is off by default. **Check this:** ask the host how to open it. | `[E3]` |
| BuyVM | Yes. **Check this:** the list of coins can be old. | Mail ports are blocked by default. A ticket opens them. One report from 2024 says that the answer was slow. | `[E4][E5]` |
| 1984 Hosting | Bitcoin, Monero | **Check this:** not confirmed. Ask before you pay. | `[E6]` |
| Servers.guru | **Check this.** | Outgoing ports 25, 465 and 587 are blocked by default. The host opens them on request and asks questions first. | `[E10]` |

**Check this for each host:** the research did not confirm that incoming port 25 is open. Ask the host before you pay.

### Steps

1. Select a host from the table.
2. Ask the host these two questions before you pay: "Is incoming port 25 open?" and "Do you open outgoing port 25 and set a PTR record?"
3. Order a server with the properties in the first table.
4. Write down the IPv4 address of the server.
5. Write down the password of the user `root`.
6. If the host has a firewall page, permit TCP ports 22, 25, 80 and 443, and UDP port 443.
7. Open the terminal on your own computer. On Windows, use "Terminal" or "PowerShell". On macOS, use "Terminal".
8. Connect to the server:
   ```
   ssh root@203.0.113.10
   ```
9. If the terminal asks about a "fingerprint", type `yes`.
10. Type the password of `root`. The terminal does not show the characters.
11. Install the newest system updates:
    ```
    apt update && apt -y upgrade
    ```
12. Install the tools that this guide uses:
    ```
    apt -y install curl git dnsutils openssl nano cron iproute2
    ```
13. Test the outgoing mail port:
    ```
    timeout 5 bash -c '</dev/tcp/gmail-smtp-in.l.google.com/25' && echo OPEN || echo BLOCKED
    ```

**Check:** the last command shows `OPEN` or `BLOCKED`. `BLOCKED` is normal on a new server. You ask the host to open the port in Part D.

Note: the password of `root` protects all data on the server. Use a long password that you use in no other place.

---

## Part B. Buy a domain and set the DNS records

### Steps

1. Buy a domain from a domain seller. Use a name that you can keep for years.
2. Open the DNS page of the domain seller.
3. Add record 1 from the table below (type A).
4. Add record 3 (type MX).
5. Add record 4 (type TXT, SPF for the domain).
6. Add record 5 (type TXT, SPF for the server name).
7. Add record 7 (type TXT, DMARC).
8. Do not add record 6 now. You get its value in Part D.
9. Do not add record 2 unless you read the IPv6 note below.
10. Open the control page of your **server host** (not the domain seller).
11. Set the reverse DNS (PTR record) of your IPv4 address to `mail.example.com`. If there is no such field, ask the host in Part D.
12. Wait 15 minutes. DNS changes are not immediate. Some changes take some hours.

### The DNS records

Some DNS pages want the short name (`mail`). Other DNS pages want the full name (`mail.example.com`). The table shows the two forms.

| No. | Type | Name (short / full) | Value | Purpose |
|---|---|---|---|---|
| 1 | A | `mail` / `mail.example.com` | `203.0.113.10` | The address of your server |
| 2 | AAAA | `mail` / `mail.example.com` | `2001:db8::10` | Optional. The IPv6 address of your server. See the note. |
| 3 | MX | `@` / `example.com` | `mail.example.com` with priority `10` | Mail for `name@example.com` goes to your server. |
| 4 | TXT | `@` / `example.com` | `v=spf1 mx -all` | SPF: only your mail server sends mail for this domain. |
| 5 | TXT | `mail` / `mail.example.com` | `v=spf1 a -all` | SPF for the name that your server gives to other servers |
| 6 | TXT | `mail._domainkey` / `mail._domainkey.example.com` | `v=DKIM1; k=rsa; p=MIIBIjANBgkq...` (long) | DKIM: the public key that proves your signature. From Part D. |
| 7 | TXT | `_dmarc` / `_dmarc.example.com` | `v=DMARC1; p=none` | DMARC: tells other servers that you use SPF and DKIM. |
| 8 | PTR | `203.0.113.10` (at the server host) | `mail.example.com` | Reverse DNS: the address points back to the name. |

Notes:

- **Record 4 with a relay company.** If a relay company sends your mail, the company gives you a different value for record 4.
- **Record 6 is long.** Some DNS pages want the value in parts of 255 characters or less. Read the help of your DNS page.
- **Record 7 later.** After the mail test in Part G is successful, change the value to `v=DMARC1; p=quarantine`.
- **IPv6 note.** With the default Docker network, Postern sees all IPv6 visitors as one address. All IPv6 visitors then share one rate limit.
  Postern also permits only 10 mail connections from one address at the same time. All mail servers that use IPv6 then share this limit.
  Add record 2 only if you also enable IPv6 in `docker-compose.yml`. The last lines of that file tell you how. **Check this:** the authors did not test the IPv6 option.

**Check:** run these commands on the server. Replace the example names.

```
dig +short A mail.example.com
dig +short MX example.com
dig +short TXT example.com
dig +short TXT _dmarc.example.com
dig +short -x 203.0.113.10
```

The results must be, in sequence: your IPv4 address; `10 mail.example.com.`; `"v=spf1 mx -all"`; `"v=DMARC1; p=none"`; `mail.example.com.`
An empty result means that the record is not active. Wait, then try again.
The last result can stay empty until the server host sets the PTR record (Part D).

---

## Part C. Install Docker and start Postern

Docker is a program that runs other programs in closed boxes ("containers"). Postern uses three containers: `app`, `caddy`, and (optional) `relay`.

### Steps

1. Connect to the server, as in Part A, steps 8 to 10.
2. Download the Docker installation program:
   ```
   curl -fsSL https://get.docker.com -o get-docker.sh
   ```
3. Run the Docker installation program:
   ```
   sh get-docker.sh
   ```
4. Make sure that no other program uses ports 25, 80 and 443:
   ```
   ss -ltn | grep -E ':(25|80|443) '; echo done
   ```
   The result must show only the word `done`. If it shows more lines, see Part J, "address already in use".
5. Put the Postern project folder on the server at `/opt/postern`. If you have a Git address for the project:
   ```
   git clone YOUR-GIT-ADDRESS /opt/postern
   ```
6. Make sure that the folder is correct:
   ```
   ls /opt/postern
   ```
   The list must contain `package.json`, `deploy`, `server`, `shared` and `web`.
   If these names are one level lower, use that lower folder in place of `/opt/postern` in all commands.
7. Go to the settings folder:
   ```
   cd /opt/postern/deploy
   ```
8. Make your settings file from the example:
   ```
   cp .env.example .env
   ```
9. Make the settings file private:
   ```
   chmod 600 .env
   ```
10. Make the server secret:
    ```
    openssl rand -hex 32
    ```
11. Write the 64 characters on paper, or save them on a USB drive that you keep disconnected. This is your offline copy.
12. Open the `.env` file:
    ```
    nano .env
    ```
13. Set `PUBLIC_URL` to `https://` and your server name. Example: `PUBLIC_URL=https://mail.example.com`. Do not put a `/` at the end.
14. Set `SECRET_KEY` to the 64 characters from step 10.
15. Set `MAIL_DOMAINS` to your domain. Example: `MAIL_DOMAINS=example.com`
16. Set `MAIL_HOSTNAME` to your server name. Example: `MAIL_HOSTNAME=mail.example.com`
17. Save the file: press Ctrl+O, then press Enter.
18. Close the editor: press Ctrl+X.
19. Build and start Postern:
    ```
    docker compose up -d --build
    ```
20. Wait one minute.

**Check 1:** this command shows the containers.

```
docker compose ps
```

The line for `app` must contain `healthy`. The line for `caddy` must contain `Up`.

**Check 2:** this command asks your server for its public settings.

```
curl -s https://mail.example.com/api/config
```

The result must start with `{"appName":"Postern","dev":false`. (The name is different if you changed `APP_NAME`.)

**Check 3:** open `https://mail.example.com` in the browser of your computer. The browser must show the Postern page with no certificate warning.

**Check 4:** make sure that Caddy is new enough. The version must be 2.11.7 or later `[N6]`.

```
docker compose exec caddy caddy version
```

Notes:

- `PUBLIC_URL` is permanent. The passkeys of your users work only with this name. Do not change it after users sign up.
- Do not use the value `mock` for `PHONE_PROVIDER` or `PAY_PROVIDER` on a real server. It is a simulation.
- Section 8 of the `.env` file lists settings that Docker controls. Do not change them.
- At this time Postern cannot send mail. Part D adds outgoing mail.
- If you have no Git address, copy the project folder from your computer to `/opt/postern` with the `scp` command.

---

## Part D. Outgoing mail

Postern does not deliver outgoing mail itself. It gives each message to a relay. You have two options:

- **Option 1 (recommended): the built-in relay.** It runs on your server. No other company sees your mail. It makes the DKIM key automatically.
- **Option 2: a relay company.** Use it if other mail servers do not accept mail from your server address.

### D1. Option 1: start the built-in relay

1. Change these two settings and apply the change (see "How to change a setting"):
   ```
   COMPOSE_PROFILES=relay
   SMTP_RELAY_URL=smtp://relay:587/?tls.rejectUnauthorized=false
   ```
   If you have more than one mail domain, set `RELAY_DOMAINS` in the same edit. Use spaces and double quotes.
   Example: `RELAY_DOMAINS="example.com example.org"`
2. Wait one minute. The relay makes the DKIM key at its first start.
3. Show the DKIM record:
   ```
   docker compose exec relay sh -c 'cat /var/lib/rspamd/dkim/*.txt /etc/opendkim/keys/*.txt 2>/dev/null'
   ```
4. Find the text that starts with `v=DKIM1` in the result. Some results show it in two or more parts in quotation marks.
5. Join the parts into one line with no quotation marks. The line looks like this: `v=DKIM1; k=rsa; p=MIIBIjANBgkq...`
6. Add DNS record 6 from Part B with this line as the value.
7. Ask your server host to open the outgoing mail ports. Give the address of your server.
   At FlokiNET, send a ticket with the title "SMTP Unblock and PTR request" `[E1]`.
8. In the same ticket, ask for the PTR record `mail.example.com` if you could not set it yourself.

**Check this:** step 3 shows nothing if the relay image keeps the key in a different folder. The documents of the image are source `[N1]` in [PROVIDERS.md](PROVIDERS.md).

**Check 1:** the relay runs.

```
docker compose ps relay
```

**Check 2:** Postern knows the relay. The result of this command must contain `"mockMail":false`.

```
curl -s https://mail.example.com/api/config
```

**Check 3:** the DKIM record is active. The result must start with `"v=DKIM1`.

```
dig +short TXT mail._domainkey.example.com
```

**Check 4:** the outgoing port is open. Do this after the host answers your ticket. The result must be `OPEN`.

```
timeout 5 bash -c '</dev/tcp/gmail-smtp-in.l.google.com/25' && echo OPEN || echo BLOCKED
```

You test a real message in Part G.

Notes:

- The address `smtp://relay:587/?tls.rejectUnauthorized=false` is safe only for the built-in relay. The connection stays inside your server.
- Keep `DKIM_SELECTOR` and `DKIM_KEY_FILE` empty with the built-in relay. The built-in relay signs the mail.
- The relay log is off, because the log shows the sender and the recipient of each message. Part J tells you how to enable it for a short time.
- **Check this:** the authors did not test the relay together with Postern.

### D2. Option 2: use a relay company

1. Open an account at the relay company.
2. Get the SMTP server name, the port, the user name and the password from the company.
3. Add the DNS records that the company gives you. They replace record 4 and record 6.
4. Change these two settings and apply the change (see "How to change a setting"). Use your values.
   ```
   COMPOSE_PROFILES=
   SMTP_RELAY_URL=smtps://USER:PASSWORD@smtp.relay-company.example:465
   ```

5. If the built-in relay ran before, stop it:
   ```
   docker compose --profile relay stop relay
   ```

**Check:** the result of `curl -s https://mail.example.com/api/config` must contain `"mockMail":false`.

Notes:

- If the password contains `$` or `#`, put the full value in single quotes.
- Most relay companies sign the mail with their own DKIM key. Then leave `DKIM_SELECTOR` and `DKIM_KEY_FILE` empty.
- If the relay company does not sign the mail, Postern can sign it. Run these commands in `/opt/postern/deploy` to make a key:
  ```
  mkdir -p keys
  openssl genrsa -out keys/dkim.key 2048
  chown 10001:10001 keys/dkim.key
  chmod 600 keys/dkim.key
  openssl rsa -in keys/dkim.key -pubout -outform DER | openssl base64 -A; echo
  ```
  The last command shows the public key. Add a TXT record with the name `postern._domainkey` and the value `v=DKIM1; k=rsa; p=` plus the public key.
  Add this record in each of your mail domains. Then set `DKIM_SELECTOR=postern` and `DKIM_KEY_FILE=/keys/dkim.key`.
  **Check this:** the authors did not test this signature with a real mail server. Do the mail test in Part G3.

### D3. Optional: a certificate for incoming mail

Other mail servers encrypt the connection to your server if your server offers encryption (STARTTLS).
Without this part, Postern makes its own certificate on the first start and keeps it in the data folder.
This is sufficient for most mail servers, because they do not examine the certificate.
This part gives Postern the certificate that Caddy got for `mail.example.com`. Some strict mail servers prefer such a certificate.
Postern reads changed certificate files again without a restart. This takes a maximum of 10 minutes.

**Check this:** the authors did not test this part. It works only if `MAIL_HOSTNAME` is the same name as in `PUBLIC_URL`.

1. Make a small program file:
   ```
   nano /usr/local/sbin/postern-smtp-cert
   ```
2. Put this text in the file. Replace `mail.example.com` in the line `NAME=`.
   ```
   #!/bin/sh
   # Copies the certificate from Caddy to Postern.
   # Postern reads the new files in 10 minutes or less. A restart is not necessary.
   set -eu
   NAME=mail.example.com
   cd /opt/postern/deploy
   mkdir -p keys
   umask 077
   docker compose exec -T caddy sh -c "cat /data/caddy/certificates/*/$NAME/$NAME.crt" > keys/smtp.crt.new
   docker compose exec -T caddy sh -c "cat /data/caddy/certificates/*/$NAME/$NAME.key" > keys/smtp.key.new
   grep -q "BEGIN CERTIFICATE" keys/smtp.crt.new
   grep -q "PRIVATE KEY" keys/smtp.key.new
   chown 10001:10001 keys/smtp.crt.new keys/smtp.key.new
   if cmp -s keys/smtp.crt.new keys/smtp.crt; then
     rm keys/smtp.crt.new keys/smtp.key.new
     exit 0
   fi
   mv keys/smtp.key.new keys/smtp.key
   mv keys/smtp.crt.new keys/smtp.crt
   ```
3. Save the file: press Ctrl+O, then press Enter.
4. Close the editor: press Ctrl+X.
5. Permit the system to run the file:
   ```
   chmod +x /usr/local/sbin/postern-smtp-cert
   ```
6. Run the file one time:
   ```
   /usr/local/sbin/postern-smtp-cert
   ```
7. Change these two settings and apply the change (see "How to change a setting"):
   ```
   SMTP_TLS_KEY=/keys/smtp.key
   SMTP_TLS_CERT=/keys/smtp.crt
   ```
8. Tell the server to run the file each night. Caddy gets a new certificate at regular intervals.
   ```
   echo '20 4 * * * root /usr/local/sbin/postern-smtp-cert' > /etc/cron.d/postern-smtp-cert
   ```

Notes:

- Postern looks at the two files one time each 10 minutes. It reads changed files without a restart.
- Set the two settings together. If only one of them has a value, Postern uses its own certificate and writes a warning in its log.
- If Postern cannot read the two files at a start, it does not start. See Part J, "The line for `app` shows `Restarting`".

**Check:** this command shows the certificate that your mail port offers. The result must contain `mail.example.com` and `Verify return code: 0 (ok)`.

```
openssl s_client -starttls smtp -connect mail.example.com:25 -servername mail.example.com </dev/null 2>/dev/null | grep -E "subject=|Verify return code"
```

---

## Part E. Payments with BTCPay Server (optional)

Without this part, set `PAY_PROVIDER=off` and set the five `PRICE_` settings to `0`. Then continue with Part F.
The five settings are `PRICE_MAILBOX_MONTH`, `PRICE_NUMBER_MONTH`, `PRICE_TEXT_OUT`, `PRICE_CALL_MINUTE` and `PRICE_VOICEMAIL`.
Postern writes a warning in its log if payments are off and a price is not `0`.

### E1. Select where BTCPay Server runs

| Option | Good | Bad |
|---|---|---|
| Your own BTCPay Server on a second server (recommended) | Only you see the payment data. Only you hold the money. Monero is possible. | More cost. More work. The Bitcoin data needs one day or more to load. |
| A third-party host | Fast start | The host sees your payment data. Lightning money goes to the wallet of the host `[B13]`. Do not use Monero there `[B10]`. |

Do not install BTCPay Server on the same server as Postern with this guide. The two programs want the same ports (80 and 443).

### E2. Install your own BTCPay Server

**Check this:** the commands in step 5 are from the BTCPay Server documents as the authors remember them. Compare them with https://docs.btcpayserver.org/Docker/ before you run them.

1. Rent a second server. See Part A. It needs 2 GB memory and 80 GB disk for Bitcoin `[B12]`. It does not need port 25.
2. Add an A record in your DNS page: name `btcpay`, value: the IPv4 address of the second server.
3. Connect to the second server with `ssh`.
4. Install the tools:
   ```
   apt update && apt -y upgrade && apt -y install git curl
   ```
5. Install BTCPay Server. Replace `btcpay.example.com`. Remove the line with `xmr` if you do not want Monero.
   ```
   mkdir -p /opt/btcpay && cd /opt/btcpay
   git clone https://github.com/btcpayserver/btcpayserver-docker
   cd btcpayserver-docker
   export BTCPAY_HOST="btcpay.example.com"
   export NBITCOIN_NETWORK="mainnet"
   export BTCPAYGEN_CRYPTO1="btc"
   export BTCPAYGEN_CRYPTO2="xmr"
   export BTCPAYGEN_LIGHTNING="clightning"
   export BTCPAYGEN_REVERSEPROXY="nginx"
   export BTCPAYGEN_ADDITIONAL_FRAGMENTS="opt-save-storage-s"
   export BTCPAY_ENABLE_SSH=true
   . ./btcpay-setup.sh -i
   ```
6. Open `https://btcpay.example.com` in your browser.
7. Make the first account. The first account is the administrator.
8. In the server settings of BTCPay Server, make sure that the registration of new users is off.
9. Wait until BTCPay Server shows that the Bitcoin data is complete. This can take one day or more.

**Check:** the page `https://btcpay.example.com` opens, and you can log in.

### E3. Make a store and connect the payment methods

**Check this:** the names of menus and buttons in BTCPay Server can be different in your version.

1. In BTCPay Server, select "Create your store".
2. Give the store a name. Do not use your real name: payers see the store name.
3. Set the default currency to `USD`. Postern makes all payment requests in USD.
4. In the store menu, open "Lightning".
5. Select "Use internal node".
6. Select "Save".
7. Give the Lightning node incoming capacity. A new node cannot receive payments without it. The BTCPay Server documents tell you how.
8. For Monero: open the server settings, then open "Plugins".
9. For Monero: install the Monero plugin `[B9]`.
10. For Monero: restart BTCPay Server when it asks.
11. For Monero: open the Monero settings of the store.
12. For Monero: connect a wallet. The instructions of the plugin tell you how `[B9]`.
13. For Bitcoin on-chain (optional): in the store menu, open "Bitcoin".
14. For Bitcoin on-chain (optional): make a wallet, or connect a wallet that you have.

**Check:** in BTCPay Server, make a test invoice by hand ("Invoices", then "Create invoice"). The payment page must show each method that you connected.

### E4. Make the API key

1. In BTCPay Server, open your account menu. Select "API Keys".
2. Select "Generate Key".
3. Type the label `postern`.
4. Select only these two permissions: "View invoices" (`btcpay.store.canviewinvoices`) and "Create an invoice" (`btcpay.store.cancreateinvoice`).
5. For each of the two permissions, select your store only.
6. Select "Generate API Key".
7. Copy the key. This is `BTCPAY_API_KEY`.

**Check this:** the research did not confirm that these two permissions are sufficient `[B5]`. If payments fail with a permission error, see Part J.

### E5. Make the webhook

A webhook is a message that BTCPay Server sends to Postern when the state of an invoice changes.

1. In the store menu, open "Settings", then "Webhooks".
2. Select "Create Webhook".
3. Set "Payload URL" to `https://mail.example.com/api/hooks/btcpay`. Use your server name.
4. Show the "Secret" field.
5. Copy the secret. This is `BTCPAY_WEBHOOK_SECRET`.
6. Keep "Automatic redelivery" on.
7. Select "Send specific events".
8. Select these three events: "An invoice has been settled" (`InvoiceSettled`), "An invoice has expired" (`InvoiceExpired`), "An invoice became invalid" (`InvoiceInvalid`).
9. Select "Add webhook".
10. Open "Settings", then "General".
11. Copy the "Store ID". This is `BTCPAY_STORE_ID`.

**Check:** the list of webhooks shows your new webhook with the address of your Postern server.

### E6. Confirm the names of the payment methods

Postern must use the same names for payment methods as your BTCPay Server.

1. In BTCPay Server, make a second API key with the label `temporary`.
2. Give this key only the permission "View your stores" (`btcpay.store.canviewstoresettings`). **Check this:** the name of the permission.
3. On the Postern server, run this command. Replace the three example values.
   ```
   curl -s -H "Authorization: token TEMPORARY-KEY" https://btcpay.example.com/api/v1/stores/STORE-ID/payment-methods
   ```
4. Find each `"paymentMethodId"` in the result. Expected values: `BTC-LN` (Lightning), `BTC-CHAIN` (Bitcoin), `XMR-CHAIN` (Monero) `[B6][B11]`.
5. Write down the names exactly as the result shows them.
6. In BTCPay Server, delete the API key `temporary`.

**Check:** you have one name for each method that you connected in E3.

### E7. Connect Postern to BTCPay Server

1. On the Postern server, change these settings and apply the change (see "How to change a setting"). Use your values.
   ```
   PAY_PROVIDER=btcpay
   BTCPAY_URL=https://btcpay.example.com
   BTCPAY_STORE_ID=YOUR-STORE-ID
   BTCPAY_API_KEY=YOUR-API-KEY
   BTCPAY_WEBHOOK_SECRET=YOUR-WEBHOOK-SECRET
   BTCPAY_METHODS=BTC-LN,XMR-CHAIN
   ```
   In `BTCPAY_METHODS`, put only the names from E6, with commas between them.
   Do not list a method that your store does not have.

**Check 1:** the app runs. The line for `app` must contain `healthy` after one minute.

```
docker compose ps
```

**Check 2:** the result of this command must contain `"enabled":true` and your payment methods.

```
curl -s https://mail.example.com/api/pay/info
```

You test a real payment in Part G.

Note: Postern also asks BTCPay Server for the state of each open payment one time each minute. Thus a lost webhook only makes the payment slower.

---

## Part F. Phone numbers with Twilio (optional)

Read section 2, "Phone numbers", before you do this part. If you do not want Twilio, keep `PHONE_PROVIDER=off` and continue with Part G.

### F1. Make the Twilio account

1. Open https://www.twilio.com and make an account. Twilio asks for an email address and a phone number. **Check this.**
2. Add money to the account with a card or PayPal `[T1]`. This changes the account from "trial" to "paid".
3. Open the first page of the Twilio Console.
4. Find the box "Account Info".
5. Copy the "Account SID". It starts with `AC`. This is `TWILIO_ACCOUNT_SID`.
6. Show the "Auth Token".
7. Copy the "Auth Token". This is `TWILIO_AUTH_TOKEN`.

A trial account is not sufficient. It has limits for calls and texts `[W12]`.

### F2. Connect Postern to Twilio

1. On the Postern server, change these settings and apply the change (see "How to change a setting"). Use your values.
   ```
   PHONE_PROVIDER=twilio
   PHONE_COUNTRIES=US,CA
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=YOUR-AUTH-TOKEN
   ```

**Check:** the result of this command must contain `"phone":true`.

```
curl -s https://mail.example.com/api/config
```

**You do not set webhook addresses in the Twilio Console.** When a user buys a number, Postern buys it at Twilio and sets the addresses for texts, calls and call status on that number automatically.
The addresses start with your `PUBLIC_URL`. Twilio must be able to reach `https://mail.example.com` from the internet.

Notes:

- Postern shows only numbers that it bought itself. A number that you buy by hand in the Twilio Console does not appear in Postern.
- Postern releases a number at Twilio when the user deletes it, or when the user does not pay and `GRACE_DAYS` are over.
- If someone gets your Auth Token, make a new one in the Twilio Console and change `TWILIO_AUTH_TOKEN`.

### F3. Optional: registration to send texts to US phones (A2P 10DLC)

Without this registration, US numbers in Postern can receive texts but cannot send texts to US phones (section 2, facts 7 to 12).
A user can then link a real phone only with the call that says the code.

**Check this:** the menu names in the Twilio Console can change. Twilio describes the procedure in source `[T2]`.

1. In the Twilio Console, open "Messaging", then "Regulatory Compliance".
2. Register a "Brand". Twilio asks for your business data, or for your personal data as a "sole proprietor".
3. Register a "Campaign". Describe honestly what your service does.
4. Wait for the approval. This can take from one week to some weeks `[R7]`. **Check this.**
5. Twilio connects the campaign to a "Messaging Service". Copy the ID of the Messaging Service. It starts with `MG`.
6. Put the ID in `.env` as `TWILIO_MESSAGING_SERVICE_SID`. Then start Postern again.

Postern then adds each new number to this Messaging Service automatically. Numbers that users bought before this setting are not added: add those numbers by hand in the Twilio console.

**Check this:** A "sole proprietor" brand can have only one number `[R2]`. The authors tested this automatic step with a simulated Twilio only.

**Check:** send a text from a Postern number to a US phone. The text arrives.

### F4. Reduce what Twilio keeps

1. In the Twilio Console, open the general settings for "Messaging".
2. Find the setting for message records. Select the shortest period that Twilio offers `[W14]`. **Check this:** the name of the setting.
3. To remove message text from all records, ask Twilio support to enable "Message Redaction" `[W13]`.

### F5. Optional: countries that need identity documents

Twilio does not sell numbers of some countries before it has your identity documents `[R9][R10]`. The United Kingdom is an example.
Twilio keeps the documents as a "regulatory bundle" and an "address". Postern can send their IDs with each purchase.

**Check this:** the authors tested this part with a simulated Twilio only. The menu names in the Twilio Console can change.

1. In the Twilio Console, open "Phone Numbers", then "Regulatory Compliance".
2. Make a bundle for the country and for the type of number. Twilio asks for your documents.
3. Make an address if Twilio asks for one.
4. Wait until Twilio approves the bundle.
5. Copy the ID of the bundle. It starts with `BU`.
6. Copy the ID of the address. It starts with `AD`.
7. Change these settings and apply the change (see "How to change a setting"). Use your values.
   ```
   TWILIO_BUNDLE_SID=BUxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_ADDRESS_SID=ADxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   PHONE_COUNTRIES=US,CA,GB
   ```

**Check:** in Postern, search for a number of the new country and buy it. The purchase is successful.

Notes:

- Postern sends the same two IDs with each purchase, in each country of `PHONE_COUNTRIES`.
- **Check this:** a bundle at Twilio is for one country. The authors did not test a server with a bundle and with numbers of a second country.

### F6. Limit the numbers that users can text and call

You pay Twilio for each text and for each call of your users. Some destinations cost much more than others.
Thus Postern permits only some destinations. Postern examines these three things:

- the destination of each text that a user sends,
- the destination of each call that a user starts,
- the number of each real phone that a user links.

Postern does not limit incoming texts and incoming calls.

| Setting | Default | Meaning |
|---|---|---|
| `PHONE_ALLOWED_PREFIXES` | `+1` | A destination must start with one of these prefixes. `+1` is the United States and Canada. |
| `PHONE_BLOCKED_PREFIXES` | The built-in list | A destination must not start with one of these prefixes. |

The built-in list has the premium numbers `+1900` and `+1976`. It also has 21 area codes that start with `+1` but are not in the United States or Canada. Most of them are in the Caribbean.

To change the limits:

1. Open the `.env` file (see "How to change a setting").
2. To permit one more country, add its prefix to `PHONE_ALLOWED_PREFIXES`. Example for the United Kingdom: `PHONE_ALLOWED_PREFIXES=+1,+44`
3. To block more numbers, write your complete list in `PHONE_BLOCKED_PREFIXES`. Your list replaces the built-in list. Start with this line and add your prefixes:
   ```
   PHONE_BLOCKED_PREFIXES=+1900,+1976,+1242,+1246,+1264,+1268,+1284,+1345,+1441,+1473,+1649,+1658,+1664,+1721,+1758,+1767,+1784,+1809,+1829,+1849,+1868,+1869,+1876
   ```
4. Save the file and apply the change.
5. In the Twilio Console, find the settings with the name "Geo permissions". There is one page for calls and one page for texts.
6. Permit only the countries that you permit in Postern.

**Check:** in Postern, try to send a text to a number that is not permitted. Postern must show "You cannot text or call this number from here."

Notes:

- An empty value means the default. You cannot make a list empty.
- `PHONE_ALLOWED_PREFIXES=+` permits all countries. Do this only if you know the prices of Twilio for each country.
- The geo permissions at Twilio are a second protection. Twilio then refuses a destination also if a setting of Postern is wrong.
- **Check this:** the names of the pages in the Twilio Console.

### F7. Voicemail

A caller who does not get an answer can leave a voicemail. Each user decides if a number has voicemail.

**Check this:** the voicemail function was not complete when the authors wrote this part. The API document did not describe it. Test it before you tell your users about it.

| Setting | Default | Meaning |
|---|---|---|
| `PRICE_VOICEMAIL` | `5` | The price of each recorded voicemail, in credits. `5` is 0.05 USD. The user pays it. `0` = free. |
| `VOICEMAIL_MAX_SECONDS` | `120` | The longest voicemail, in seconds. |

What the phone provider hears and keeps:

- The phone provider makes the recording. Thus the provider hears the complete message. Postern cannot prevent this.
- **Check this:** by design, Postern copies each recording, encrypts it for the user, and then deletes it at the provider. The authors did not test this.
- **Check this:** Twilio can charge you for recordings. Set `PRICE_VOICEMAIL` higher than your cost.

**Check:** call a number that has voicemail on and leave a message. The message must appear in Postern.
Some minutes later, look at the list of call recordings in the Twilio Console. The recording must not be there.

---

## Part G. First sign-up and tests

### G1. Make your account

1. Open `https://mail.example.com` in your browser.
2. Make an account. Postern shows a recovery key.
3. Write the recovery key on paper. Without it you can lose the account.
4. Add a passkey if your device has one.

### G2. Test payments (if Part E is done)

1. In Postern, open the page "Funds".
2. Select the smallest amount and one payment method.
3. Pay the payment request from your own wallet. The money goes to your own BTCPay Server.
4. Wait until Postern shows the new balance.

**Check:** the balance in Postern is higher. In BTCPay Server, the invoice has the state "Settled".

If you did not do Part E, make sure that the five `PRICE_` settings are `0`.

### G3. Test mail

1. In Postern, make an inbox: open the page "Mail" and select "New inbox". Write down its address.
2. From a different email account that you have, send a message to the new address.
3. Make sure that the message appears in Postern. This tests incoming mail.
4. In Postern, send a message from the new address to your different email account.
5. Open the message in the different email account. Look in the inbox and in the spam folder.
6. Show the "original message" or the "headers" of the message. Each mail program has a menu item for this.
7. Find the words `spf=`, `dkim=` and `dmarc=` in the headers.

**Check:** the headers show `spf=pass`, `dkim=pass` and `dmarc=pass`.

After a successful check, change DNS record 7 to `v=DMARC1; p=quarantine`.

### G4. Test phone numbers (if Part F is done)

1. In Postern, open the page "Numbers" and select "Get a number". Search for a number and buy it.
2. From your own phone, send a text to the new number.
3. Make sure that the text appears in Postern.
4. From your own phone, call the new number. Postern must show the call.

**Check:** the Twilio Console lists the number under "Phone Numbers", and the three webhook addresses on it start with your `PUBLIC_URL`.

### G5. Close the sign-up (for a private service)

If the service is for one person or for a fixed group, close the sign-up after all persons have accounts.

1. Change this setting and apply the change (see "How to change a setting"):
   ```
   SIGNUP=closed
   ```

**Check:** the result of this command must contain `"signup":"closed"`.

```
curl -s https://mail.example.com/api/config
```

To let a new person in later, set `SIGNUP=open`, let the person sign up, then close it again.

### G6. What users can set themselves

You do not operate these functions. Each user sets them in the app. This table tells you what the server does and what you can change.

| Function of the user | What the server does | What you can change |
|---|---|---|
| Automatic deletion for an inbox (1 to 3650 days) | One time each hour, Postern deletes the mail of that inbox that is older. This includes sent mail and attachments. | Nothing. The user decides. |
| Automatic deletion of texts for a number (1 to 3650 days) | One time each hour, Postern deletes the texts of that number that are older. The list of calls stays. | Nothing. The user decides. |
| End date for an alias | After the date, the alias gets no mail and cannot send mail. The alias stays in the list. | Nothing. The user decides. |
| Blocked senders for an address | Postern refuses mail from a blocked sender to that address. Other addresses still get mail from the sender. | `LIMIT_ADDRESS_BLOCKS`: the largest number of blocked senders for one address. The default is `200`. |
| A real phone for a number | Postern sends calls and texts on to the real phone. The server can read the number of the real phone. | `LIMIT_PHONES` and the destination limits (Part F6). |

Facts for you as the operator:

- The automatic deletion works when the app of the user is closed. It also works for a paused inbox and for a paused number.
- The deletion is final. The database writes zeros over deleted data. You cannot bring the data back from the server.
- A backup that you made before the deletion still contains the data. Part I7 tells you how long backups stay.
- Postern keeps a blocked sender only in encrypted form. You cannot read the block lists of your users.
- Postern does not write a refused sender to its log.

---

## Part H. Use your own domain for aliases (optional)

You can do this part at a later time. Do Part G first.

### H1. When to do this

Some websites refuse email addresses on alias domains that are well known.
A domain that only you use is not on the lists of those websites. The websites do not refuse it.

The simple method works: put the new domain in the setting `MAIL_DOMAINS`.
Each account on the server can then make aliases on each domain in that setting.
For a server that only you use, this is all that is necessary.
Postern cannot give a domain to one account only.

> **Warning: a domain that only you use ties its aliases together.**
>
> Each website can see that your addresses are on the same private domain.
> Thus the websites can tell that the addresses belong to one person.
>
> - A domain of your own is **better** against "this website blocks alias domains".
> - A domain of your own is **worse** for privacy than a domain that many people share.
>
> Use an alias on your own domain only for a website that refuses your other addresses.

If you are the only user of your server, the warning is also true for your first domain.
You can then put your first domain in `MAIL_PERSONAL_DOMAINS` too (H3).

Example values in this part:

| Example | Meaning |
|---|---|
| `my-own-domain.example` | The new domain. Only you use it. |
| `example.com` | Your first domain, from Part B. It stays the default domain. |
| `mail.example.com` | The name of your server. It does not change. |

### H2. Add the DNS records for the new domain

1. Buy the new domain from a domain seller.
2. Open the DNS page of the new domain.
3. Add record a from the table below (type MX).
4. Add record b (type TXT, SPF).
5. Add record d (type TXT, DMARC).
6. Do not add record c now. You get its value in H4.
7. Wait 15 minutes. DNS changes are not immediate.

The table has the same form as the table in Part B. The records have letters, so that you do not confuse them with the records of Part B.

| No. | Type | Name (short / full) | Value | Purpose |
|---|---|---|---|---|
| a | MX | `@` / `my-own-domain.example` | `mail.example.com` with priority `10` | Mail for the new domain goes to your server. |
| b | TXT | `@` / `my-own-domain.example` | `v=spf1 mx -all` | SPF: only your mail server sends mail for the new domain. |
| c | TXT | `mail._domainkey` / `mail._domainkey.my-own-domain.example` | `v=DKIM1; k=rsa; p=MIIBIjANBgkq...` (long) | DKIM: the public key that proves your signature. From H4. |
| d | TXT | `_dmarc` / `_dmarc.my-own-domain.example` | `v=DMARC1; p=none` | DMARC: tells other servers that you use SPF and DKIM. |

Notes:

- **No other records.** The new domain does not need an A record, an AAAA record or a PTR record. Your server keeps its name and its address.
- **Record a** points to the server name in your first domain. This is correct.
- **With a relay company,** the company gives you the values for record b and record c.

**Check:** run these commands on the server. Replace the example name.

```
dig +short MX my-own-domain.example
dig +short TXT my-own-domain.example
dig +short TXT _dmarc.my-own-domain.example
```

The results must be, in sequence: `10 mail.example.com.`; `"v=spf1 mx -all"`; `"v=DMARC1; p=none"`.
An empty result means that the record is not active. Wait, then try again.

### H3. Add the domain to Postern

1. Change these two settings and apply the change (see "How to change a setting"):
   ```
   MAIL_DOMAINS=example.com,my-own-domain.example
   MAIL_PERSONAL_DOMAINS=my-own-domain.example
   ```
   Keep your first domain at the start of `MAIL_DOMAINS`. Put a comma between the domains. Do not add spaces.
   If you use the built-in relay (Part D1), set this third setting in the same edit:
   ```
   RELAY_DOMAINS="example.com my-own-domain.example"
   ```

The last command of the procedure is `docker compose up -d`. It starts Postern and the relay again with the new settings.

What the three settings do:

| Setting | Effect |
|---|---|
| `MAIL_DOMAINS` | The domains for new addresses. Postern uses the first domain when you do not select a domain. |
| `MAIL_PERSONAL_DOMAINS` | The app shows the warning from H1 for each domain in this list. Each domain must also be in `MAIL_DOMAINS`. |
| `RELAY_DOMAINS` | The built-in relay sends mail only for the domains in this list. This list uses spaces, not commas. |

If `RELAY_DOMAINS` is empty and `MAIL_DOMAINS` has two domains, the built-in relay can refuse all outgoing mail.

**Check:** the result of this command must contain `"mailDomains":["example.com","my-own-domain.example"]` and `"personalDomains":["my-own-domain.example"]`.

```
curl -s https://mail.example.com/api/config
```

### H4. Add the DKIM record

The DKIM record of the new domain uses the same selector as the record of your first domain.
The value depends on the program that signs your outgoing mail.

| Who signs your outgoing mail? | Name of record c | Value of record c |
|---|---|---|
| The built-in relay (Part D1) | `mail._domainkey` | The relay makes a key for the new domain. Do procedure 1. |
| Postern (`DKIM_SELECTOR` and `DKIM_KEY_FILE` have values, Part D2) | Your selector and `._domainkey`. Example: `postern._domainkey` | The same value as for your first domain. Postern uses one key for all domains. Do procedure 2. |
| A relay company (Part D2) | The company gives you the name. | Add the new domain in your account at the company. The company gives you the value. |

**Procedure 1: the built-in relay signs.**

1. Show the DKIM records of the relay:
   ```
   docker compose exec relay sh -c 'for f in /var/lib/rspamd/dkim/*.txt /etc/opendkim/keys/*.txt; do [ -f "$f" ] && echo "== $f" && cat "$f"; done; true'
   ```
2. Find the line that starts with `==` and contains the name of the new domain.
3. Find the text that starts with `v=DKIM1` below that line.
4. Join the parts of this text into one line with no quotation marks.
5. Add record c with this line as the value.

**Check this:** the authors did not test the built-in relay with two domains. If the result has no entry for the new domain, wait one minute. Then do step 1 again.

**Procedure 2: Postern signs.**

1. Show the DKIM record of your first domain. Use your selector in place of `postern`.
   ```
   dig +short TXT postern._domainkey.example.com
   ```
2. Join the parts of the result into one line with no quotation marks.
3. Add record c with the name `postern._domainkey` and with this line as the value.

**Check:** the DKIM record of the new domain is active. The result of this command must start with `"v=DKIM1`. Use your selector in place of `mail`.

```
dig +short TXT mail._domainkey.my-own-domain.example
```

### H5. Make an alias on the new domain

**Check this:** the names of buttons in the app can be different in your version.

1. Open `https://mail.example.com` in your browser.
2. Sign in.
3. If the app was open before the change, load the page again.
4. Open the page "Aliases".
5. Select "New alias".
6. Select "Choose the name myself".
7. In the list "Domain", select `@my-own-domain.example`.
8. Type a name in the field "Name". For a random name, keep the field empty.
9. Select "Make alias".

**Check:** the app shows the new alias. The address ends with `@my-own-domain.example`.

Notes:

- The list "Domain" shows each domain in `MAIL_DOMAINS`. The list appears only if the server has two domains or more.
- If you do not select "Choose the name myself", Postern makes the alias on your first domain.
- The dialog "New inbox" has the same list.
- **Check this:** the app must show the warning from H1 for a domain in `MAIL_PERSONAL_DOMAINS`. The authors did not see this warning in the app when they wrote this part.
- Do not remove a domain from `MAIL_DOMAINS` while you use addresses on it. Postern sends mail only from domains in this list.

### H6. Test mail on the new domain

1. From a different email account that you have, send a message to the new alias.
2. Make sure that the message appears in Postern. This tests incoming mail.
3. In Postern, open the page "Mail".
4. Select "Write".
5. In the field "From", select the new alias.
6. Type the address of your different email account in the field for the recipient.
7. Send the message.
8. Open the message in the different email account. Look in the inbox and in the spam folder.
9. Show the "original message" or the "headers" of the message.
10. Find the words `spf=`, `dkim=` and `dmarc=` in the headers.

**Check:** the headers show `spf=pass`, `dkim=pass` and `dmarc=pass`. The lines with `spf=` and `dkim=` must contain `my-own-domain.example`.

After a successful check, change record d to `v=DMARC1; p=quarantine`.

If a result is not `pass`, see Part J, "Mail from an address on the new domain".

### H7. If your server has other users

All users of the server can use each domain in `MAIL_DOMAINS`. Postern has no domains for one account only.
Thus other users can also make aliases on `my-own-domain.example`.
If you want a domain for yourself only, operate the server for yourself only: set `SIGNUP=closed` (Part G5).

---

## Part I. Backups and updates

### I1. What you must keep

| Thing | Where it is | How you keep it |
|---|---|---|
| The two databases (`accounts.db`, `payments.db`) | Docker volume `postern_data` | `backup.sh` (below) |
| The server secret | `SECRET_KEY` in the `.env` file | Offline copy from Part C, step 11. **Not** together with the database backups. |
| The `.env` file | `/opt/postern/deploy/.env` | Offline copy. It contains your provider keys. |
| The DKIM key of the built-in relay | Docker volumes `postern_relay_rspamd` and `postern_relay_opendkim` | Optional. If you lose it, do Part D1 steps 3 to 6 again. |
| The certificates of the web address | Docker volume `postern_caddy_data` | Not necessary. Caddy gets new certificates. |
| The certificate that Postern makes for incoming mail (`smtp-selfsigned.key`, `smtp-selfsigned.crt`) | Docker volume `postern_data` | Not necessary. `backup.sh` does not copy the two files. Postern makes them again at the next start. |

If `SECRET_KEY` is empty in your `.env` file, the server secret is the file `secret.key` in the data volume. This command shows it:

```
docker compose exec app cat /data/secret.key
```

### I2. Make a backup

1. Go to the settings folder:
   ```
   cd /opt/postern/deploy
   ```
2. Run the backup program:
   ```
   sh backup.sh
   ```

**Check:** the last lines show `Backup complete` and the name of a new folder in `/opt/postern/deploy/backups`.

The backup program copies the databases safely while Postern runs. It keeps the 7 newest backups.

### I3. Make a backup each night

1. Tell the server to run the backup program each night at 03:30:
   ```
   echo '30 3 * * * root sh /opt/postern/deploy/backup.sh > /var/log/postern-backup.log 2>&1' > /etc/cron.d/postern-backup
   ```

**Check:** on the next day, this command shows `Backup complete`.

```
tail -n 3 /var/log/postern-backup.log
```

### I4. Copy the backups to a second place

If you lose the server, you also lose each backup that is on the server.

1. Open the terminal on your own computer (not on the server).
2. Copy the backups to your computer:
   ```
   scp -r root@203.0.113.10:/opt/postern/deploy/backups ./postern-backups
   ```
3. Keep the copy on an encrypted disk. The backup contains data of all users. Most of it is encrypted, but balances and sizes are not.

Do this at regular intervals, for example each week.

### I5. Put a backup back (restore)

Do this only if the data is lost or damaged. You lose all changes that users made after the backup.
A credit token that a user spent after the backup can be spent a second time.

1. Go to the settings folder:
   ```
   cd /opt/postern/deploy
   ```
2. Stop Postern:
   ```
   docker compose stop app
   ```
3. Copy the backup into the data volume. Replace `20261111-033000` with the name of your backup folder.
   ```
   docker run --rm --user 0 -v postern_data:/data -v /opt/postern/deploy/backups/20261111-033000:/backup:ro postern:local sh -c 'cp /backup/accounts.db /backup/payments.db /data/ && rm -f /data/*.db-wal /data/*.db-shm && chown 10001:10001 /data/*.db && chmod 600 /data/*.db'
   ```
4. Make sure that `SECRET_KEY` in the `.env` file is the same value as at the time of the backup.
5. Start Postern:
   ```
   docker compose start app
   ```

**Check:** `docker compose ps` shows `healthy` for `app`, and you can log in to your account.

**Check this:** the authors did not test the restore command.

### I6. Updates

Do these steps one time each month.

1. Make a backup (I2).
2. Update the operating system:
   ```
   apt update && apt -y upgrade
   ```
3. Get the new version of Postern. If you used Git:
   ```
   cd /opt/postern && git pull
   ```
4. Go to the settings folder:
   ```
   cd /opt/postern/deploy
   ```
5. Get the new versions of Caddy and of the relay:
   ```
   docker compose pull --ignore-buildable
   ```
6. Build and start all containers again:
   ```
   docker compose up -d --build
   ```
7. Restart the server if the update in step 2 tells you to:
   ```
   reboot
   ```

**Check:** `docker compose ps` shows `healthy` for `app`. The page `https://mail.example.com` opens.

Notes:

- All containers start automatically after a restart of the server.
- Compare the new `.env.example` with your `.env` file after an update. A new version can have new settings.
- BTCPay Server has its own update program on its server. The BTCPay Server documents tell you how to use it.

### I7. How long deleted data stays in backups

A user can delete data. The automatic deletion can delete data (Part G6). After that, the server has no copy.
But each backup that you made before the deletion still contains the data.

- `backup.sh` keeps the 7 newest backups. It deletes older backups.
- With one backup each night (I3), deleted data stays in the backups on the server for 7 days.
- Each copy on your own computer (I4) contains the data until you delete that copy.

To keep fewer backups on the server:

1. Write the cron line again with a `KEEP` value. This example keeps 3 backups:
   ```
   echo '30 3 * * * root KEEP=3 sh /opt/postern/deploy/backup.sh > /var/log/postern-backup.log 2>&1' > /etc/cron.d/postern-backup
   ```
2. Delete old copies on your own computer at regular intervals.
3. Tell your users how long you keep backups.

**Check:** after the next backup, this command shows 3 folders or fewer.

```
ls /opt/postern/deploy/backups
```

Fewer backups also give you fewer days to repair a fault. Select a number that is correct for your service.

---

## Part J. Troubleshooting

First look at the state and at the log of Postern. The log contains no user data.

```
cd /opt/postern/deploy
docker compose ps
docker compose logs --tail 50 app
```

| Problem | Possible causes | What to do |
|---|---|---|
| **The web page does not open, or the browser shows a certificate warning.** | DNS record 1 is wrong or not active. Ports 80 and 443 are closed. `PUBLIC_URL` is wrong. | Run `dig +short A mail.example.com`. Permit ports 80 and 443 in the firewall page of the host. Run `docker compose logs --tail 50 caddy` and look for the word `error`. Correct the cause. Then run `docker compose restart caddy`. |
| **`docker compose up` shows `address already in use`.** | A different program on the server uses port 25, 80 or 443. Some Debian systems have the mail program `exim4` on port 25. | Run `ss -ltnp \| grep -E ':(25\|80\|443) '`. The end of each line shows the name of the program. Stop the program and disable it. Example for `exim4`: run `systemctl disable --now exim4`. Then run `docker compose up -d` again. |
| **The line for `app` shows `Restarting`.** | A setting is wrong. | Run `docker compose logs --tail 20 app`. The last lines name the setting. Examples: `PUBLIC_URL must start with https://`, `SECRET_KEY must be 64 hex characters`, `BTCPAY_URL, BTCPAY_API_KEY, BTCPAY_STORE_ID and BTCPAY_WEBHOOK_SECRET must be set`, `TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set`. If you did Part D3: make sure that the two files of `SMTP_TLS_KEY` and `SMTP_TLS_CERT` are in `/opt/postern/deploy/keys`. Run `/usr/local/sbin/postern-smtp-cert` again. |
| **Mail from outside does not arrive.** | DNS record 3 (MX) is wrong. Incoming port 25 is closed at the host. The address does not exist. The alias is off, or its end date is past. The user blocked the sender. The inbox is paused or full. The message is too large. | Run `dig +short MX example.com`. Ask the host if incoming port 25 is open. Read the error message that the sender got. `550 5.1.1`: no such address, alias off, or alias after its end date. `550 5.7.1`: the user blocked this sender. `450`: the inbox is paused. `452`: the inbox is full. `552`: the message is too large. `421`: too many connections from one address. |
| **Mail from Postern does not arrive.** | `SMTP_RELAY_URL` is empty. Outgoing port 25 is blocked. The PTR record is missing. The sender domain is not in `RELAY_DOMAINS`. The other server refused the message. | Make sure that `/api/config` shows `"mockMail":false`. Do Check 4 of Part D1. Run `dig +short -x 203.0.113.10`. Then enable the relay log: set `RELAY_LOG_DRIVER=local`, run `docker compose up -d`, send one test message, and run `docker compose logs --tail 50 relay`. Look for `status=` and the reason after it. Set `RELAY_LOG_DRIVER=none` again after the test. |
| **Mail from Postern goes to the spam folder.** | Your server address is new. SPF, DKIM or DMARC is not `pass`. The PTR record is not the same as `MAIL_HOSTNAME`. Your server address is on a block list. | Do Part G3, steps 5 to 7. Correct each result that is not `pass`. Search the web for "IP blocklist check" and test your address. Ask recipients to mark the message as "not spam". Send normal mail for some weeks. If nothing helps, use a relay company (Part D2) or a different server address. |
| **A website refuses my alias address.** | The website has a list of alias domains that are well known. Your domain is on that list. | Do Part H: add a domain that only you use, and make the alias on that domain. Read the warning in Part H1 first. Use this alias only for that website. |
| **Mail from an address on the new domain (Part H) does not arrive or is not `pass`. Mail from the first domain is good.** | The new domain is not in `RELAY_DOMAINS`. Record b (SPF) or record c (DKIM) of the new domain is missing or wrong. The relay company does not know the new domain. | Do the check of Part H3. With the built-in relay, make sure that `RELAY_DOMAINS` contains the two domains with a space between them. Do the checks of Part H2 and Part H4. With a relay company, add the new domain in your account at the company. |
| **The list "Domain" does not show the new domain.** | The new domain is not in `MAIL_DOMAINS`. You did not apply the change. The browser shows an old page. | Do the check of Part H3. Run `docker compose up -d`. Load the page again in the browser. |
| **A payment stays "waiting".** | The payment is not confirmed. On-chain Bitcoin and Monero need many minutes. The Lightning node has no incoming capacity. BTCPay Server is not ready. A BTCPay setting in the `.env` file is wrong. | Open the invoice in BTCPay Server. If the state is not "Settled", wait, or look at the wallet of the payer. If the state is "Settled" and Postern still waits after two minutes: look at the `app` log, then compare `BTCPAY_URL`, `BTCPAY_STORE_ID` and `BTCPAY_API_KEY` with BTCPay Server. In BTCPay Server, open the webhook and look at the list of deliveries. |
| **Postern cannot make a payment request.** | A name in `BTCPAY_METHODS` is not a method of your store. The API key has the wrong permissions or the wrong store. | Do Part E6 again. Make a new API key as in Part E4. |
| **A number purchase fails.** | The Twilio account is a trial account or has no money. The country needs identity documents (example: `GB`). A different customer bought the number. The user searched more than 30 minutes ago, or Postern started again after the search. The Account SID or the Auth Token is wrong. | Tell the user to search again. In the Twilio Console, open "Monitor", then "Logs", then "Errors". Add money. For a country with identity documents, do Part F5 or remove the country from `PHONE_COUNTRIES`. Compare the two Twilio values in the `.env` file with the Twilio Console. Postern gives the credit back to the user after a failed purchase. |
| **A user cannot text or call a number. The app shows "You cannot text or call this number from here."** | The destination is not permitted. By default, Postern permits only `+1` numbers and blocks premium numbers. | This is the protection of Part F6. Change `PHONE_ALLOWED_PREFIXES` only if you accept the cost of that destination. |
| **A user cannot link a real phone.** | The number of the user is a US number without 10DLC registration, so the text with the code does not arrive. The real phone is not a permitted destination. | Tell the user to select "Call me with the code". For a phone outside `+1`, see Part F6. |
| **Texts fail with error 30034.** | The number is a US local number that is not registered for A2P 10DLC `[R2]`. `TWILIO_MESSAGING_SERVICE_SID` is empty. A user bought the number before you set `TWILIO_MESSAGING_SERVICE_SID`. | Do Part F3. Make sure that `TWILIO_MESSAGING_SERVICE_SID` has a value. In the Twilio Console, add each older number to the Messaging Service by hand. Without registration, a number can only receive texts. Tell your users. |
| **Incoming texts or calls do not appear in Postern.** | Twilio cannot reach your server. `PUBLIC_URL` is not the address that Twilio uses, so the signature check fails. | In the Twilio Console, open "Monitor", then "Logs", then "Errors". An error with the status `403` means: `PUBLIC_URL` is wrong. A connection error means: the web page or the certificate has a problem. |
| **The page does not update itself. You must load it again to see new mail.** | Caddy is older than version 2.11.7 `[N6]`, or a different proxy is in front of Caddy. | Run `docker compose exec caddy caddy version`. Run `docker compose pull --ignore-buildable`, then `docker compose up -d`. |
| **`backup.sh` shows `BACKUP FAILED`.** | The `.env` file is missing. Docker does not run. The disk is full. | Read the lines above the message. Run `df -h` to see the free disk space. |

---

## Quick reference

All commands run in `/opt/postern/deploy`.

| Task | Command |
|---|---|
| See the state | `docker compose ps` |
| See the log of Postern | `docker compose logs --tail 50 app` |
| Apply a change of the `.env` file | `docker compose up -d` |
| Restart Postern | `docker compose restart app` |
| Stop all | `docker compose down` |
| Start all | `docker compose up -d` |
| Make a backup | `sh backup.sh` |
| Update Postern | `git -C /opt/postern pull && docker compose up -d --build` |

`docker compose down` does not delete data. Never add `-v` to this command: `docker compose down -v` deletes all data of Postern.
