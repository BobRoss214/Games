# Providers: research reference

Date of the research: 2026-11-11.

This document is the fact base for [SETUP-GUIDE.md](SETUP-GUIDE.md). It answers one question:
which outside companies and programs can an operator of Postern use, and what do they demand?

## How to read this document

- Each fact has a source key in brackets, for example `[T3]`. The list of sources is at the end.
- **UNCONFIRMED** means: the research did not see this fact in a primary source (the provider's own page). Check it yourself before you depend on it.
- **Important limit of this research:** the research tool could not open web pages directly. The network rules of the work session blocked `www.twilio.com` and `docs.btcpayserver.org`. Every fact comes from search-result extracts of the pages in the source list. No page was read from start to end.
- Prices and policies change. Check the provider's page before you pay.

## 1. Telephone providers

The question: is there a provider that does all three of these things?

1. It has an API to buy numbers, to send and receive texts, and to control calls.
2. It takes crypto from the operator.
3. It does not verify the identity of the operator.

**Answer: no.** The research found no such provider. Telnyx is the nearest: it takes Bitcoin, but only after identity verification (KYC).

| Provider | Takes crypto? | Verification of the operator | API (numbers / texts / calls) | US local number each month; one text |
|---|---|---|---|---|
| Twilio | No. Card, PayPal; bank transfer on invoice `[T1]` | A 10DLC brand is necessary to send texts `[T2]` | Complete | 1.15 USD; 0.0083 USD + carrier fees `[T3]` |
| Telnyx | Bitcoin, but only at the "Verified" (KYC) level `[X1][X2]` | "Paid" level: card, mobile phone, service address. "Verified" level: KYC `[X2]` | Complete | Text 0.004 USD + fees (third-party figure) `[X3]`. Number price UNCONFIRMED |
| SignalWire | UNCONFIRMED (none found) | A card and 5 USD remove the trial mode `[S1]` | Twilio-compatible (UNCONFIRMED) | "From" 0.25 USD; 0.0065 USD `[S2]` |
| Plivo, Vonage, Bandwidth | UNCONFIRMED (none found) | Business details. Documents are different for each country `[P1]` | Complete | Plivo 0.50 USD; 0.0077 USD (third-party figures) `[X3]` |
| VoIP.ms | No. Card, PayPal, bank transfer `[V1]` | UNCONFIRMED | Yes. Text callback URL. API texts have a limit of 100 each day `[V2][V3]` | 1.10 USD; 0.0075 USD `[V4]` |
| Zadarma | No. The official pages list cards, PayPal, bank transfer `[Z1]` | Passport or ID card for numbers with texts `[Z2]` | Yes | Not checked |
| DIDWW | No. Card, PayPal, bank transfer `[D1]` | Identity procedure that is different for each country `[D2]` | Yes | Not checked |
| DIDLogic | No. Card, PayPal, bank transfer `[D3]` | Not checked | Text API. Number purchase by API is UNCONFIRMED | Not checked |
| Callwithus | Bitcoin: yes `[C1]` | Not checked | It does not sell numbers now `[C1]` | Not applicable |
| Anveo | UNCONFIRMED | Not checked | Number orders, texts over HTTP, call flows `[A1]` | Not checked |
| JMP.chat | Bitcoin. Monero and Ether with the top-up command `[J1][J2]` | Reported: no personal data (community report) `[J4]` | XMPP only. An HTTP API for resellers is UNCONFIRMED | 4.99 USD flat `[J1]` |
| Crypton.sh | Yes, Monero included (third-party report) `[K1]` | None reported | An API is reported. Users report "does not work" `[K1][K2]` | About 5 USD `[K2]` |
| MoneroSMS | Monero | None reported | Texts only. Unofficial command-line tool `[M1]` | About 3.60 to 4.99 USD `[M1]` |
| SMSPool | Crypto. Monero was removed (report) `[M2]` | None reported | Rental API. Calls are not supported (report) `[M3]` | Different for each number |
| Silent.link | Bitcoin, Lightning, Monero | None | eSIM. "No API" (report of a competitor) `[L1]` | Not applicable |

More findings:

- sms4sats: Lightning payment, API, numbers for a maximum of 4 hours `[L2]`.
- LNVPN / nadanada.me: Lightning payment, API, numbers for 3 to 9 months that can receive texts only `[L3]`.
- DTMF.io: takes Monero; calls and texts in the browser; the research found no API; mixed user reviews `[O1][O2]`.
- Freezvon: takes crypto; the research found no API `[O3]`.
- FlyNumber: crypto and an API are UNCONFIRMED `[O4]`.
- The software of JMP.chat is open source. `sgx-bwmsgsv2` connects XMPP to the Bandwidth message API `[J3]`. If you run it yourself, you need your own Bandwidth account.

## 2. Rules for texts in the United States

- **10DLC registration is mandatory to send.** Twilio blocks all texts from unregistered US 10-digit numbers to US recipients. The block is complete since 1 September 2023. The error code is 30034 `[R1][R2]`. Telnyx blocks unregistered traffic since 3 February 2025 `[R3]`.
- **Twilio charges for blocked texts too** `[R2]`.
- **A text from person to person through an app is "A2P" for the carriers.** Twilio says: US carriers treat each message that comes from Twilio as application-to-person. The volume does not matter. Test messages are included `[R4]`.
- **Registration for each user needs a real identity.** A "sole proprietor" brand uses the real name of the person. An OTP code confirms the person. The brand gets one campaign and one number `[R2][R5][R6]`. This does not fit anonymous users (conclusion of the research).
- **Receiving is not affected.** Twilio says: inbound traffic on unregistered numbers is not affected. Outbound texts to Canada are also not affected `[R7]`.
- **Toll-free numbers:** an unverified toll-free number cannot send. The block is complete since 31 January 2024 (error 30032) `[R8]`.
- **Regulatory bundles (identity documents for a number):**
  - United Kingdom: a person must give proof of identity and proof of address. A business must give a UK address `[R9]`.
  - Germany and France need bundles `[R10]`.
  - United States and Canada: "no bundle is necessary" is UNCONFIRMED. The Regulations API of Twilio gives the rule for each country `[R10]`.
- Costs of 10DLC registration (Telnyx figures; Twilio figures are UNCONFIRMED): brand 4.50 USD one time; campaign about 10 USD each month, or 2 USD each month for a sole proprietor `[R6]`.

## 3. Twilio details that the Postern code uses

### (a) REST endpoints

- **Search:** `GET /2010-04-01/Accounts/{AccountSid}/AvailablePhoneNumbers/{CountryCode}/Local.json`.
  Parameters: `AreaCode` (United States and Canada only), `Contains`, `SmsEnabled`, `MmsEnabled`, `VoiceEnabled`, `PageSize` `[W1][W2]`. `Mobile.json` was not verified.
- **Buy:** `POST` to `IncomingPhoneNumbers` with `PhoneNumber` or `AreaCode` (one of them is necessary), `SmsUrl`, `SmsMethod`, `VoiceUrl`, `VoiceMethod`, `StatusCallback`, `StatusCallbackMethod` `[W3]`.
- **Release:** `DELETE .../IncomingPhoneNumbers/{Sid}.json`. The key is the SID, not the number `[W4]`. The reply code 204 is from a third-party copy only (UNCONFIRMED).
- **Messages:** `To`; `From` or `MessagingServiceSid`; `Body`, `MediaUrl` or `ContentSid`; `StatusCallback`. States: queued, sending, sent, delivered, undelivered, failed `[W5][W6]`.
  - One extract said that `StatusCallback` is obsolete. That was an error of the extract. The obsolete parameter is `MaxPrice` `[W7]`.
- **Calls:** `To`; `From` (a Twilio number or a verified caller ID); `Url` or `Twiml`. If the request has both, Twilio ignores `Twiml` `[W8]`.
  - `StatusCallbackEvent`: initiated, ringing, answered, completed. The default is completed. The documents do not agree on the format for more than one value. Send the parameter one time for each value `[W8]`.

### (b) Webhook signature

- Start with the full URL (scheme, port, query string). Add the POST fields in the order of their names. For each field, add the name and then the value. Calculate HMAC-SHA1 with the Auth Token as the key. Encode the result as Base64. Compare it with the header `X-Twilio-Signature` `[W9][W10]`.
- The extract was cut before the words "no delimiter". This detail is from older knowledge of the same document.
- JSON bodies use a different method: a `bodySHA256` query parameter `[W10]`.

### (c) `<Dial>`

- `timeout` has a default of 30 seconds (range 5 to 600) `[W11]`.
- The `action` callback gets `DialCallStatus` (completed, answered, busy, no-answer, failed, canceled), `DialCallSid`, `DialCallDuration` and `DialBridged` `[W11]`.

### (d) Caller ID when a call is forwarded

- Yes, the number of the original caller can be the caller ID. It is the default `callerId`. Permitted values: the To or From number of the request, a Twilio number that you own, or a verified number `[W11]`.
- Exceptions: inbound SIP calls and trial accounts `[W11][W12]`.

### (e) Redaction and storage time

- "Message Redaction" for the full account must be enabled by Twilio. It needs POST webhooks `[W13]`.
- For one message: `ContentRetention=discard` and `AddressRetention=obfuscate` `[W13]`.
- A POST with an empty `Body` removes the text of a stored message. DELETE removes the record. The text can stay in Twilio backups for 30 days `[W14]`.
- The message log shows about 400 days by default. Older records are not deleted automatically `[W14]`.

## 4. BTCPay Server 2.x

### (a) Invoices

- Create: `POST /api/v1/stores/{storeId}/invoices`. Read: `GET .../invoices/{invoiceId}` `[B1][B2]`.
- Body: `amount`, `currency`, `metadata`, and `checkout` with `paymentMethods`, `expirationMinutes`, `redirectURL`, `redirectAutomatically`, `speedPolicy` `[B2]`.
- Reply: `id`, `checkoutLink`, `status`, `additionalStatus`, `expirationTime` `[B2][B3]`.
- States: New, Processing, Settled, Expired, Invalid `[B2]`.
- The field names come from third-party copies of the specification, not from the official page.

### (b) Authorization

- Header: `Authorization: token <key>` `[B4]`.
- The permission names `btcpay.store.cancreateinvoice` and `btcpay.store.canviewinvoices` exist `[B5]`. "These two are sufficient" is UNCONFIRMED.

### (c) Webhooks

- Header: `BTCPay-Sig: sha256=HMAC256(UTF8(secret), body)`. The calculation uses the raw body `[B6][B7]`.
- Event types: InvoiceCreated, InvoiceReceivedPayment, InvoiceProcessing, InvoiceExpired, InvoiceSettled, InvoiceInvalid, InvoicePaymentSettled `[B8]`.
- The fields `deliveryId`, `webhookId` and `storeId` were seen. `type` and `invoiceId` are UNCONFIRMED from a primary source `[B2]`.

### (d) Monero and the names of payment methods

- Monero is a community plugin: `btcpay-monero/btcpayserver-monero-plugin` `[B9]`.
- Docker installation: set `BTCPAYGEN_CRYPTO2="xmr"` (or a different free number). Then install the plugin from "Manage Plugins" `[B9][B10]`.
- The plugin uses one Monero wallet for all stores of the server. Do not share the server with other people `[B10]`.
- Names: `BTC-CHAIN`, `BTC-LN`, `BTC-LNURL` `[B6][B11]`. BTCPay accepts the old names as input. Replies use the new names `[B11]`.
- `XMR-CHAIN` is UNCONFIRMED. The research saw it only in the error text of a community guide `[B9]`. Confirm it with `GET /api/v1/stores/{storeId}/payment-methods`.

### (e) How to get a server

- Self-host with Docker: minimum 2 GB RAM and 80 GB of disk with pruning `[B12]`.
- Third-party hosts: the official directory, Clovyr, and the one-click installation of LunaNode (UNCONFIRMED) `[B13][B14][B15]`. Their identity rules are UNCONFIRMED.
- A third-party host can see how you use the server. Lightning payments go to the wallet of the host `[B13]`.

## 5. Outgoing mail and server hosts

- **Recommended:** your own Postfix with DKIM, SPF, DMARC and a PTR record, on your own server. This is the only method that needs no identity data.
- **Server hosts that take Monero or Bitcoin.** All of them block the outgoing mail ports by default. "Incoming port 25 is open" was not confirmed for any of them.

| Host | Crypto | Mail ports | Source |
|---|---|---|---|
| FlokiNET | Monero and other coins, 0 % fee | Ports 25, 465, 587 outgoing are blocked on a new VPS. To open them: set SPF, DKIM and DMARC, then send a ticket with the title "SMTP Unblock and PTR request" | `[E1][E2]` |
| IncogNET | Monero, Bitcoin, Litecoin | Port 25 is off by default. The procedure to open it is UNCONFIRMED | `[E3]` |
| BuyVM (Frantech) | Yes (the list of coins can be old) | Mail ports are blocked by default. A ticket opens them. One report from 2024 of a slow answer | `[E4][E5]` |
| 1984 Hosting | Bitcoin, Monero | UNCONFIRMED | `[E6]` |
| Servers.guru | UNCONFIRMED | Ports 25, 465, 587 outgoing are blocked by default. The host opens them on request and asks questions first | `[E10]` |
| Njalla | Not checked | Not checked | — |

- **Relay companies:**
  - Maileroo takes Bitcoin, Ether and stablecoins. It does not take Monero `[E7]`.
  - KingSMTP says that it takes Bitcoin and Monero and asks for no identity. This is the company's own statement. It is not verified `[E8]`.
  - MXroute: a report says that it does not take crypto now `[E9]`.

## 6. Notes on the deployment software

These facts were found later, for the files in `deploy/`. The same limit applies: search extracts only.

- **Postfix relay image `boky/postfix`:**
  - `ALLOWED_SENDER_DOMAINS` is mandatory. The image listens on port 587. `POSTFIX_<setting>` sets a Postfix setting `[N1][N2]`.
  - Since version 6.0.0 the DKIM signature comes from rspamd. OpenDKIM is deprecated. `DKIM_BACKEND` selects the program `[N1]`.
  - rspamd keeps the DKIM keys in `/var/lib/rspamd/dkim`. Keys in `/etc/opendkim/keys` are copied at the first start `[N1]`.
  - `DKIM_AUTOGENERATE` makes the keys. The default selector is `mail`. `DKIM_SELECTOR` changes it `[N1]`.
  - The default list of networks that can send (`MYNETWORKS`) and the TLS behaviour on port 587 are UNCONFIRMED.
- **Caddy:**
  - Access logs are off unless the site has a `log` directive `[N5]`. The global `log` option configures all other messages and can exclude groups `[N4]`.
  - By default Caddy ignores an `X-Forwarded-For` value from the visitor and sets its own `[N3]`.
  - Caddy sends `text/event-stream` replies immediately. `flush_interval -1` does the same for other replies `[N3]`.
  - Version 2.11.6 had a fault that stopped some event streams after 60 seconds. Version 2.11.7 corrects it (third-party copy of the release notes) `[N6]`.

## 7. Summary for the operator

1. No telephone provider gives you numbers, texts and calls by API, takes crypto, and does not verify you.
2. Expect to verify yourself at Twilio or Telnyx. Telnyx takes Bitcoin only after KYC.
3. US local numbers can receive texts without registration. Anonymous users cannot send texts from them.
4. BTCPay Server works as planned. Run your own server, most of all for Monero.
5. Run your own mail server at FlokiNET or IncogNET. Ask them to open port 25.
6. A second way to get numbers is your own Android phone with a SIM card. It gives texts only, and it was tested with a simulated gateway only. See section 8.

## 8. Your own phone as the phone provider

The question: which open-source Android app can turn a phone with a SIM card into a gateway for texts, with a server that the operator runs?

**The pick: "SMS Gateway for Android" (SMSGate) with its own private server** `[O1][O2]`.
Reason: it is the only one of the five that the research could read in source form, and it has all the parts that Postern needs.
Its licence is Apache-2.0, and the app and the server had new versions in October and November 2026 `[O1][O2]`.

The parts that Postern needs, and that the sources show:

- A private server with a documented API for other programs.
- Events with a signature for incoming texts and for delivery reports.
- Phones with more than one SIM card.
- A mode in which the phone holds its own connection to the server, with no push company.

**How the research was done.** The two repositories were read from local copies on 2026-11-11: the app at version 1.78.3 and the server at version 1.52.6.
The documentation website of the project (`docs.sms-gate.app`) was not reachable. The four other candidates were **not** read in source form: each line about them is UNCONFIRMED.

| Candidate | What the research has | Why it is not the pick |
|---|---|---|
| httpSMS | UNCONFIRMED: an open-source app with a server. The licence is reported as AGPL-3.0. Your own server is reported to need a Firebase project of Google. | A Google account and Google push for each text are a cost for privacy. Not verified. |
| textbee | UNCONFIRMED: an open-source app with a server. The licence is reported as MIT. The server is reported to use MongoDB and Firebase. | The same Firebase point. Not verified. |
| SmsForwarder | UNCONFIRMED: an open-source app that forwards incoming texts to many targets (webhook, mail, chat). To send a text from a server, the server must reach the phone, or a tunnel is necessary. | No server part for a pool of phones. Sending needs a path into the phone. Not verified. |
| SMSSync and EnvayaSMS | UNCONFIRMED: two early apps of this kind. The research found no sign of current work on them. | Old software on new Android versions is a risk. Not verified. |

Facts about the pick that the setup guide uses (Part I). All are from the two repositories:

- **Android version:** 5.0 or later. The README names a note about Android 15 on the documentation website; the research could not read it `[O1]`. UNCONFIRMED for Android 15 and later.
- **Where to get the app:** the README names the release page of the project on GitHub. It names two builds: a secure one for normal use and an "insecure" one for development `[O1]`. The names of the files are UNCONFIRMED.
- **Texts only.** The app sends and receives SMS and MMS. It has no function for calls `[O1]`.
- **The private server:** a backend, a worker and a MariaDB or MySQL database. In private mode a phone can register only with a token (`GATEWAY__MODE=private`, `GATEWAY__PRIVATE_TOKEN`). The API for other programs is at `/api/3rdparty/v1`, the part for the phone at `/api/mobile/v1` `[O2]`.
- **Images:** the README names `ghcr.io/android-sms-gateway/server:latest`. The release settings of the project give each image the tag of its version. The setup files of Postern use `v1.52.6`. That this tag exists at the registry is UNCONFIRMED `[O2]`.
- **How the phone learns that a text waits.** Two ways `[O1][O2]`:
  - The app has a setting "Notification channel" with the values "Auto" and "SSE Only". With "SSE Only" the app does not get a push address from Google. The server then has no push address for the phone, and sends each command through a connection that the phone holds open.
  - With "Auto", the phone has a push address. A private server then sends a wake-up signal to the server of the project (`GATEWAY__UPSTREAM_URL`, by default `https://api.sms-gate.app/upstream/v1`). That server passes it to Google. For a new text, the signal has the push address and the kind of event, and no other data.
- **What the server stores** `[O2]`:
  - A text that waits for the phone is in the database in plain form. After the phone has processed it, the server changes the text and the phone numbers to a hash (`MESSAGES__HASHING_INTERVAL_SECONDS`, by default 60 seconds). A worker deletes old rows (`TASKS__MESSAGES_CLEANUP__MAX_AGE`, by default 720 hours).
  - When a phone is connected to a server, the app also uploads incoming texts to it ("inbox"). The change list of the server calls this upload encrypted. Who can open it is UNCONFIRMED. A worker deletes these rows too (`TASKS__INBOX_CLEANUP__MAX_AGE`, by default 720 hours).
  - The setup files of Postern set the two times to 24 hours. That a time this short causes no problem is UNCONFIRMED.
- **Events to Postern:** the phone itself sends each event to an `https://` address, with a signature (HMAC-SHA256 with a signing key) `[O1]`.
- **Limits that the project names:** the README says that the app is not recommended for batch sending, because of possible restrictions of mobile operators. The app has a limit for the number of texts in a period `[O1]`.

Three subjects of Part I are not from the sources, and are UNCONFIRMED: the battery settings of each phone brand, the codes for call forwarding at each carrier, and the rules for the sale of SIM cards.

## Sources

Telephone providers:

- [T1] https://support.twilio.com/hc/en-us/articles/49507358452635-About-Payment-Types
- [T2] https://www.twilio.com/docs/messaging/compliance/a2p-10dlc
- [T3] https://www.twilio.com/en-us/sms/pricing
- [X1] https://support.telnyx.com/en/articles/8379618-bitcoin-payment-method
- [X2] https://developers.telnyx.com/docs/account-setup/account-upgrade
- [X3] https://www.courier.com/integrations/compare/plivo-vs-telnyx
- [S1] https://signalwire.com/docs/platform/trial-mode
- [S2] https://signalwire.com/pricing
- [P1] https://plivo.com/docs/numbers
- [V1] https://wiki.voip.ms/article/Service_Cost
- [V2] https://wiki.voip.ms/article/API_Overview
- [V3] https://wiki.voip.ms/article/SMS
- [V4] https://voip.ms/products/messaging-suite
- [Z1] https://zadarma.com/en/support/faq/zadarma/how-to-top-up-account/
- [Z2] https://zadarma.com/en/support/faq/virtual-numbers/documents-to-connect-number/
- [D1] https://doc.didww.com/billing/billing-and-prices/index.html
- [D2] https://doc.didww.com/api3/examples/buy-dids-with-verification.html
- [D3] https://didlogic.com/setup/customer-service/payments/
- [C1] https://www.callwithus.com/faq
- [A1] https://www.anveo.com/api.asp?api_type=direct
- [J1] https://jmp.chat/faq
- [J2] https://blog.jmp.chat/tag/payments
- [J3] https://git.secluded.site/sgx-bwmsgsv2
- [J4] https://discuss.privacyguides.net/t/smspool-or-jmp-chat-or-what-should-i-now-use-for-long-term-phone-numbers/32675
- [K1] https://alternativeto.net/software/crypton-sh/about
- [K2] https://www.xpay.sh/agent-ready-index/cryptonsh/
- [M1] https://awesome.ecosyste.ms/projects/github.com%2Fgnomegl%2Fmonerosms
- [M2] https://discuss.privacyguides.net/t/looking-for-an-sms-pool-alternative-since-theyve-now-removed-xmr/40101
- [M3] https://discuss.privacyguides.net/t/how-do-i-bypass-phone-number-verification-via-calls-not-sms-text/30141
- [L1] https://nadanada.me/blog/no-kyc-esim-providers-compared
- [L2] https://uk.trustpilot.com/review/sms4sats.com
- [L3] https://nadanada.me/blog/ai-agents-lightning-network-vpn-esim-phone-numbers
- [O1] https://forum.getmonero.org/3/merchants-and-marketplace/87541/dtmf-io-accepts-monero-anonymous-phone-numbers-in-your-browser
- [O2] https://www.trustpilot.com/review/dtmf.io
- [O3] https://freezvon.com/blog/guides/how-to-manage-your-balance-and-top-up-your-user-account-short-video-guide
- [O4] https://www.flynumber.com/docs/legacy/payments-billing/overview

Rules for texts:

- [R1] https://www.twilio.com/en-us/changelog/-u-s--a2p-10dlc--full-blocking-of-traffic-sent-from-unregistered
- [R2] https://www.twilio.com/docs/api/errors/30034
- [R3] https://support.telnyx.com/en/articles/3679260-frequently-asked-questions-about-10dlc
- [R4] https://www.twilio.com/en-us/blog/a2p-10dlc-individuals-twilio-messaging
- [R5] https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv
- [R6] https://developers.telnyx.com/docs/messaging/10dlc/sole-proprietor
- [R7] https://support.twilio.com/hc/en-us/articles/14910496447771-Shutdown-of-Unregistered-10DLC-Messaging
- [R8] https://www.twilio.com/docs/api/errors/30032
- [R9] https://www.twilio.com/en-us/guidelines/gb/regulatory
- [R10] https://www.twilio.com/docs/phone-numbers/regulatory/api/regulations

Twilio details:

- [W1] https://www.twilio.com/docs/phone-numbers/api/availablephonenumberlocal-resource
- [W2] https://support.twilio.com/hc/en-us/articles/223182728-Using-the-REST-API-to-Search-for-and-Buy-Twilio-Phone-Numbers
- [W3] https://www.twilio.com/docs/phone-numbers/api/incomingphonenumber-resource
- [W4] https://support.twilio.com/hc/en-us/articles/223183028-Cancel-or-release-a-Twilio-number
- [W5] https://www.twilio.com/docs/messaging/api/message-resource
- [W6] https://www.twilio.com/docs/messaging/guides/track-outbound-message-status
- [W7] https://www.twilio.com/en-us/changelog/end-of-life--eol--of-twilio-messaging-maxprice-api-parameter
- [W8] https://www.twilio.com/docs/voice/api/call-resource
- [W9] https://www.twilio.com/docs/usage/security
- [W10] https://www.twilio.com/docs/usage/webhooks/webhooks-security
- [W11] https://www.twilio.com/docs/voice/twiml/dial
- [W12] https://community.twilio.com/community/discussion/747/is-it-possible-to-forward-a-users-number-to-outgoing
- [W13] https://www.twilio.com/docs/messaging/guides/privacy-message-redaction
- [W14] https://support.twilio.com/hc/en-us/articles/223133687-Deleting-messages-message-media-or-message-bodies

BTCPay Server:

- [B1] https://apis.io/apis/btcpay/btcpay-invoices-api/
- [B2] https://www.withone.ai/knowledge/btcpay-server/md
- [B3] https://docs.btcpayserver.org/Development/ecommerce-integration-guide/
- [B4] https://docs.btcpayserver.org/Development/GreenFieldExample
- [B5] https://docs.btcpayserver.org/BTCPayServer/greenfield-authorization
- [B6] https://docs.btcpayserver.org/API/Greenfield/v1/
- [B7] https://github.com/btcpayserver/btcpayserver/issues/2300
- [B8] https://docs.rs/crate/btcpay-client/latest/source/docs/WebhookEvent.md
- [B9] https://sethforprivacy.com/guides/accepting-monero-via-btcpay-server/
- [B10] https://awesome.ecosyste.ms/projects/github.com%2Fbtcpay-monero%2Fbtcpayserver-monero-plugin
- [B11] https://github.com/btcpayserver/btcpayserver/issues/5964
- [B12] https://docs.btcpayserver.org/FAQ/Deployment/
- [B13] https://docs.btcpayserver.org/Deployment/ThirdPartyHosting/
- [B14] https://docs.btcpayserver.org/Deployment/webdeployment
- [B15] https://cryptopayhub-net.pages.dev/crypto-payment-gateway-without-kyc

Mail and server hosts:

- [E1] https://billing.flokinet.is/index.php?rp=%2Fknowledgebase%2F126%2FPTR-records-and-E-mail-origination-policy.html
- [E2] https://flokinet.is/payment-methods/
- [E3] https://portal.incognet.io/knowledgebase/20/What-payment-methods-do-you-accept.html
- [E4] https://wiki.buyvm.net/doku.php/faq
- [E5] https://lowendtalk.com/discussion/197605/buyvm-support-not-responding
- [E6] https://1984.hosting/faq/
- [E7] https://maileroo.com/buy-smtp-with-cryptocurrency
- [E8] https://kingsmtp.com/
- [E9] https://lowendtalk.com/discussion/comment/4107308/
- [E10] https://support.servers.guru/article/sending-emails-from-your-vps

Own phone (read from local copies of the repositories on 2026-11-11, not from the websites):

- [O1] https://github.com/capcom6/android-sms-gateway (README.md, CHANGELOG.md, the text and settings files of the app, version 1.78.3)
- [O2] https://github.com/android-sms-gateway/server (README.md, .env.example, configs/config.example.yml, the files in deployments/, version 1.52.6)

Deployment software:

- [N1] https://github.com/bokysan/docker-postfix
- [N2] https://hub.docker.com/r/boky/postfix
- [N3] https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
- [N4] https://caddyserver.com/docs/caddyfile/options
- [N5] https://caddyserver.com/docs/caddyfile/directives/log
- [N6] https://newreleases.io/project/github/caddyserver/caddy/release/v2.11.7
