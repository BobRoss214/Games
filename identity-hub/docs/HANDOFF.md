# Hand-over notes

Read this file first in a new session. It is the working memory of the build.

## State (updated in the third work period)
- `npm test`: 263 pass. `npm run test:e2e`: 29 files, 296 checks pass (agents' full runs; the lead ran the new files one by one).
- DONE and verified: core, login, mail, phone, payments; web app; random identifiers generator (was "made-up details"); identity groups; plug-in points; `docs/UI-GUIDE.md`; Help pages; tutorial; "Test my recovery key"; export screens + viewer (`/open-export`); voicemail screens; "My stats" (`/stats`); "Who leaked me" (`/leaks`).
- IN WORK when this note was written:
  - Web app owner (a26c8a8a4e94020bb): "why?" buttons, home warnings, code helper in screens, "possibly leaked" hint, own-domain warning, one-shot option, refused number, username/password on the generator card, colour dot, timeline, door look, Settings list; plus requests from the other agents (data fields in lib/data.js, welcome link hook, top-bar slot, vaultChange cost, exported openers, tab title, #anchors).
  - Mail agent (acdfaf31207927c39): blocked senders, automatic deletion, newsletter panel, Burn (features/blocks.js, autodelete.js, unsubscribe.js, burn.js; e2e 22-25).
  - Phone agent (a11580da0ffdd9d37): quick jump (features/quickjump.js; e2e 26).
- THEN: one final pass by the documents agent (a170f5620ffc15bb8): add every new feature to Help text, "why?" texts, tutorial where it fits, SECURITY.md (also: the tutorial vault entry changes are visible to the server as timing), SETUP-GUIDE where the operator is concerned, a word-list test over all screens; README refresh by the lead.
- LAST: the "own phone" provider (see the second half of this file).
- Never tested: real Twilio, real BTCPay, Docker build, a real phone.
- RENAME by the user (later than the notes below): the feature "made-up details" is now called "Random identifiers generator"; its values are "random identifiers". Internal names (`persona`, key `made-up-details`) stay. Where the notes below say "made-up details", read the new name.
- NAMING RULE by the user: names of things must be very simple and self-explanatory; longer explanation goes to the tutorial, Help and "why?" links. Names that the user chose stay exact (Random identifiers generator, Identity, Who leaked me, Possibly leaked, Test my recovery key, Download my data, My stats, Burn).
- Decisions told to the user: recovery key opens the export file; no web-link unsubscribe (only "turn off" and unsubscribe by email); refused counter = one number per alias; per-account domains NOT built (MAIL_DOMAINS is enough for one person); UI name "made-up details"; "identity" = group only.
- Storage contracts in encrypted extras: alias `senders`, item/identity `username`, identity `colour`, `events`, `burned`.

# Feature queue (user instructions, in order)

ORDER: (1) website working + integration test  ->  (2) made-up details generator + identity groups  ->  (3) "own phone" provider LAST (see ownphone-notes.md)

## A. Random identity generator (user words: "random identity generator")
- Fake full name + made-up address (REAL city/state/ZIP, INVENTED street). Browser only. No new libraries.
- Attach one to any alias or number. Shows as a small card with copy buttons.
- Save encrypted like labels. Country picker (start with US). Regenerate button.
- My design: UI name "Made-up details" (code: persona). Stored inside the item's existing `enc` JSON: { label, note, persona: { country, firstName, lastName, street, city, region, postalCode }, identityId }.
  No server change. Data module web/js/lib/persona/us.js with interface so more countries can be added. Random picks with crypto.getRandomValues (no bias).
  Also allow on an identity group. Add one honest line: do not use made-up details where the law requires real identity.

## B. "Identities" = named groups (user words)
- Named group like "Facebook" + optional purpose note. Holds any email aliases and numbers.
- Clicking an identity shows its addresses and numbers, plus ALL their mail and texts in one place.
- Show clearly if anything inside forwards to the real phone.
- Group name + note encrypted like labels. Home screen shows identities first, ungrouped items below.
- My design: group definitions in the encrypted vault key `identities` = { v:1, identities: [{ id, name, note, persona?, createdAt }] }.
  Membership = `identityId` inside each item's own `enc` (one identity per item). Server learns nothing about groups.
  Server change needed: GET /api/messages?addressId=<id> (or addressIds=a,b,c) filter. Texts/calls per number already exist.
  Route: /identities/:id . Unified feed: mail to the group's aliases + texts (+calls) of its numbers, newest first.

## Other pending integration items
- Web app must show text `status` (queued/sent/delivered/failed) and the phone-link `method: text|call` choice, `bad_destination`, `no_voice`.
- Reply to HTML-only mail: derive the quote from HTML (body.text is '').
- e2e Playwright suite in e2e/run.mjs (package.json script test:e2e exists).
- Final report must list: tested with simulated Twilio/BTCPay only; Docker image never built; own phone tested with fake gateway only.

# UPDATED ORDER (user): website works -> made-up details + identities -> HELP -> own phone LAST

## C. Help and hand-holding (after A and B, before own phone)
1. "Help" item in the main menu. Everything below lives there.
2. "Why this exists" page, plain words: problem (sites leak and sell your email and number) and how Postern fixes it (one throwaway per site, delete it when it goes bad).
3. Privacy tips: short cards, each "do this" + "here's why". Facts from docs/SECURITY.md, nothing overpromised. Limits stated honestly (texts and email not secret on the way in; a linked real phone is known to the server; a lost recovery key cannot be reset). General advice, not legal advice. NEVER say it makes the user invisible.
4. Small "why?" links next to important things, opening a short explanation IN PLACE: recovery key, passkeys, inbox vs alias, identities, made-up details, linking a real phone, forwarding, payments, turning an alias off, deleting things.
5. Guided tutorial: one step at a time, Next/Back, progress bar. Each step: what the thing is, why it exists, then do it for real.
   - Offer right after sign-up. Can skip, leave halfway, resume where stopped, replay from Help or Settings.
   - Before any step that costs credit: show the price, allow skip. Must make sense with zero balance.
   - Skip or grey out steps for switched-off things (phones, payments), one line saying why.
   - Must work in test mode with simulated providers.
Rules: do not track what the user reads. Tutorial progress saved ENCRYPTED like labels (vault), NOT in browser storage. Same plain words, same names everywhere. Works on a phone screen and keyboard only. No new libraries. Add a browser test that clicks through the whole tutorial. Tell the user at the end what was tested.
My design: vault key `tutorial` = { v:1, step, done, skipped:[...] } encrypted (aad vault:tutorial). Help content is static text in web/js (no server calls per article => nothing to track). "why?" = <button aria-expanded> + inline disclosure region.

# UPDATED ORDER (user): website works -> A made-up details + B identities -> C help/tutorial -> D four extras -> own phone LAST

## D. Four extras (after help/tutorial, before own phone). Same plain words, no new libraries, add tests, tell user what was tested.
1. "Test my recovery key" in Settings: user types it, app says if it is right. NOTHING sent to the server.
   Design: parseRecoveryKey -> deriveFromRecoveryKey -> accountId must equal account.id AND unwrap recoveryWrap must succeed (already-loaded account data). No fetch at all (test asserts zero network requests).
2. Home warnings: balance will not cover the next renewal; an inbox or number is about to be suspended or released.
   Design: client-side from paidUntil/status/prices/balance. Needs `graceDays` in GET /api/config (core, mine). Windows: renewals due within 7 days vs balance; suspended numbers: release date = paidUntil + graceDays.
3. Code helper: if a text or email contains a sign-up code, show it with a copy button. Browser only.
   Design: pure function extractCode(text) in web/js/lib (regex: 4-8 digit codes near words code/verification/OTP/PIN etc., also "G-123456", "123-456"); node tests with many samples + negatives (years, phone numbers, prices).
4. "Possibly leaked" hint on an alias when it gets mail from a sender that does not match its usual senders.
   Design: client-side; registrable-domain heuristic (small multi-part TLD list, no PSL library); known sender domains per alias stored encrypted in alias `enc` (e.g. senders: [..]); first sender(s) define "usual"; actions "This is expected" (add) / "Turn off alias". Pure function + node tests.

# UPDATED ORDER (user): website works -> A + B -> C help/tutorial -> D four extras -> E five features (in the order below) -> own phone LAST
# User rule for E: "If one turns out to be a big job, tell me before you start it." (I told the user up front: E3 and E4 are big; E5 per-account domains = big, recommended NOT to build, do the simple way.)

## E. Five features (after D, before own phone), build in this order
E1. Block one sender on an alias.
  - From a message or from the alias screen: block one address or a whole domain. Mail from it to THAT alias is refused; everything else keeps working.
  - See the block list per alias; unblock.
  - Privacy: do not store the blocked address in plain. Hash for matching + encrypted copy only the user can read (sealed/enc).
  - Check BOTH the envelope sender and the "From" line.
E2. Auto-delete.
  - Per inbox (and per number, for texts): "delete messages older than X days". Off by default.
  - Per alias: optional end date ("this alias stops working in 7 days"); after that it refuses mail like an alias that is off.
  - The SERVER deletes (browser is not always open).
  - Before turning on: say plainly deleted messages cannot be brought back. Show which inboxes and aliases have it on.
E3. Encrypted export. (BIG)
  - "Download my data" in Settings. Browser builds ONE encrypted file. Server never sees plain contents.
  - Include: labels, notes, identities, made-up details, mail, texts, call history. Say clearly what is NOT in it (the phone numbers themselves and the balance cannot be moved).
  - Must be able to open the file again later, IN THE APP, without the server needing the data. Tell which key or passphrase opens it.
  - Tell size limits honestly (huge inbox may be too big for the browser).
E4. Voicemail. (BIG)
  - Call not forwarded or nobody answers: caller hears a short neutral greeting, can leave a message. No name in greeting by default.
  - Recording encrypted for the user like mail, shown in Calls tab with a play button, deleted from the phone company's side as soon as the server has it.
  - Show price before turning on. Max length.
  - Only for providers that can do calls. Hide with one line where calls are not possible (own phone).
  - Tell what the phone company can hear and keep.
E5. Own domain for aliases.
  - FIRST tell the user if the simple way works: domain in MAIL_DOMAINS. If the service is only for them, maybe all they need -> then just add clear steps to the setup guide.
  - If per-account domains are worth building: add domain in Settings, prove ownership with a DNS record, show exact DNS records, "check again" button.
  - In-app warning: a domain only one person uses ties all its aliases together; fixes "this site blocks alias domains" but is worse for privacy than a shared domain.
Rules for E: same plain words/names; keep privacy rules; if the server must know something new say exactly what and why; no new libraries without telling why first; phone screen + keyboard only; add the new features to Help pages, "why?" links, and the security doc; add tests; tell at the end what was tested and what was only tested with simulated providers.

# UPDATED ORDER (user): website works -> A + B -> C help/tutorial -> D four extras -> E five features -> F eleven fun extras (in order) -> own phone LAST
# Rule for F: tell before starting a big job (I told the user: none is big; F1 burn is medium).

## F. Eleven fun extras (after E, before own phone), build in this order
F1. Burn button. On an identity: ONE action turns off its aliases, releases its numbers, deletes its mail, texts, call history. Also on a single alias or number. Ask TWICE. Show exactly what will be destroyed. Say plainly it cannot be undone.
    Design: needs server bulk delete of messages by address (e.g. DELETE /api/addresses/:id/messages) so a closed browser cannot leave half; numbers via DELETE /api/numbers/:id. Identity marked burned (encrypted) + timeline event.
F2. One-shot alias. Option at alias creation: stops working after the FIRST mail arrives. Server must do it. Show as "used up" afterwards. Can switch back on.
    Server stores: one flag per alias (one_shot) + used-up state.
F3. "Who leaked me" page: list of aliases with a "possibly leaked" hint and which sender triggered it. Browser only.
F4. Door look: each identity as a small door: open = on, shut = off, bricked up = burned. Subtle. Plain words always next to it (picture never the only signal).
F5. Username and password maker on the made-up details card (one card fills a whole sign-up form). Generate only. Do NOT store passwords; say so in the app. Username can be saved with the card, encrypted.
F6. Identity timeline: made, first mail, turned off, burned. Saved encrypted like labels.
F7. Colour dot per identity. Saved encrypted. Never colour as the only signal.
F8. Quick jump: press one key, type "face", land on the Facebook identity. Also on a phone screen (search button).
F9. "Unsubscribe and turn off" on newsletter mail. User: "Tell me first how the unsubscribe part works and what it reveals to the sender. If it's risky, just offer 'turn off' and explain why."
    My answer given to user: link/one-click unsubscribe reveals IP + proves the address is read (from browser) or needs the server to fetch arbitrary URLs (unsafe) -> NOT built. Turning the alias off already stops the mail. Plan: button "Turn off this alias" with the explanation; plus "Unsubscribe by email" (mailto target from List-Unsubscribe, sent from the alias through our mail server) for when the user wants to KEEP the alias. Server must save listUnsubscribe header value inside the encrypted body JSON at delivery.
F10. My stats: which alias gets the most mail, who mails me most. Counted in the browser only. Server keeps no stats.
    Note told to user: server ALREADY keeps one counter per alias (`received`). Disclosed; stats page counts in the browser from stored mail.
F11. Refused-mail counter ("this alias refused 42 mails"). User: tell exactly what the server would store before building; skip if a bad trade.
    Told user: one whole number per alias (count of refused deliveries). No sender, no time, no content. Deleted with the alias. My judgement: acceptable trade -> build unless user objects.
Rules for F: same plain words/names; keep privacy rules; say exactly what new thing the server must know and why; no new libraries without telling why; phone screen + keyboard only; add to Help pages, "why?" links, tutorial where it fits, security doc; add tests; tell at the end what was tested.

# SPEED-UP RULE (user): when server agents run out of server work they build website screens too, in parallel.
- ONE owner of shared files (home, menu, rows, styles) = the web app agent a26c8a8a4e94020bb. Other agents get their OWN NEW files per feature.
- Keep feature order for anything that depends on something else. Same look, same words. Tell the user where it is not worth it.
- Mechanism requested from the web app agent: web/js/lib/registry.js extension points (routes, nav items, row actions/badges, message actions/panels, settings sections, home sections, call addons, global keys), web/js/features/index.js (one import line per feature), docs/UI-GUIDE.md (toolkit, look, words glossary, security rules, testing).
- Worth parallel (own files): help pages + content (docs agent writes content), export (lib + screens), "who leaked me" page, stats page, quick jump, burn dialog, block list dialog, auto-delete dialogs, voicemail player (phone agent), recovery key test section, tutorial (own files, last of help).
- NOT worth parallel (stay with owner; tiny edits inside shared screens): door look, colour dot, one-shot option + "used up" badge, refused counter display, placing "why?" links, home warnings placement, own-domain warning, username/password on the details card, identity timeline.

# Agents: FE owner a26c8a8a4e94020bb | mail acdfaf31207927c39 | phone a11580da0ffdd9d37 | docs/ops a170f5620ffc15bb8
# State at this note: website verified (journey passes); A+B+e2e in work (FE); voicemail server in work (phone); modules batch (codes, leak, credentials, stats, one-shot, refused, unsubscribe data, burn delete) in work (mail); guide refresh in work (docs).
# Screenshots were sent to the user (28 files from scratchpad/fe/shots).

# Progress log
- Voicemail server part DONE + committed (173 tests). Phone agent now builds web/js/lib/exportfile.js (pure export library). DECISION told to user: the RECOVERY KEY opens the export file (file key derived from account key; header carries recoveryWrap); also opens with the account key of an unlocked session. Viewer route must work signed out.
- Mail agent batch in work: web/js/lib/{codes,leak,credentials,stats}.js + server one-shot, refused counter, unsubscribe data (meta.bulk, body.unsubscribe), DELETE /api/addresses/:id/messages.
- Docs agent: refreshing SETUP-GUIDE to match code; next = help CONTENT text module (why page, privacy tips, why? texts) once FE registry/UI guide exist.
- FE owner: A (made-up details UI) + B (identities) + e2e suite + registry + docs/UI-GUIDE.md in work.
- Core settings added by me: PRICE_VOICEMAIL, VOICEMAIL_MAX_SECONDS, MAIL_PERSONAL_DOMAINS, LIMIT_ADDRESS_BLOCKS, PHONE_ALLOWED/BLOCKED_PREFIXES, TWILIO_MESSAGING_SERVICE_SID/BUNDLE/ADDRESS/BASE_URL; /api/config has graceDays, renewDays, personalDomains, voicemailMaxSeconds; CSP media-src blob.
- README must be refreshed at the end (features list, tests count, guide parts, what was tested).
- SECURITY.md must get: sender blocks, auto-delete (server knows days/end date; backups keep older data), export, voicemail (provider hears it), own domain warning, one-shot flag, refused counter + received counter, unsubscribe decision, identities/made-up details stored encrypted.


---

# "Own phone" provider — verified facts (read from upstream source on 2026-11-11)

Build this LAST (user instruction). Sources cloned (read-only, untrusted) under scratchpad/ext/:
- capcom6_android-sms-gateway/repo  (Android app, Apache-2.0, v1.78.0 2026-10-27, minSdk 21 = Android 5.0)
- android-sms-gateway_server/repo   (Go server, needs MySQL 8.0.13+/MariaDB 10.2.7+; image ghcr.io/android-sms-gateway/server, also capcom6/sms-gateway)
- docs site docs.sms-gate.app is NOT reachable from here; docs repo clone failed (private/renamed). Swagger: app repo docs/api/swagger.json.

## Decision
Pick: "SMS Gateway for Android" (SMSGate, capcom6). Integration = its official PRIVATE SERVER + documented 3rd-party API + device webhooks.
Do NOT re-implement the device ("mobile") API inside Postern: it is large and changes often (v1.78 changed sign-in).
- Phone -> private server: outbound only (HTTPS + SSE foreground service `SSEForegroundService`, optional FCM push via upstream relay GATEWAY__UPSTREAM_URL).
- Device registration secret: GATEWAY__MODE=private + GATEWAY__PRIVATE_TOKEN (`Authorization: Bearer <token>` on POST /mobile/v1/device).
- App then shows login + password of its user. 3rd-party API auth = HTTP Basic login:password.
- Private server compose: backend + worker (`/app/app worker`) + mariadb:lts. HTTP__LISTEN=0.0.0.0:3000, API path /api  => 3rd-party base = http://host:3000/api/3rdparty/v1 , mobile base = https://host/api/mobile/v1
- Other candidates: httpSMS (AGPL, needs Firebase for self-host), textbee (MIT, NestJS+MongoDB+Firebase), SmsForwarder (inbound to phone or FRP tunnel), SMSSync/EnvayaSMS (dead). Verify licence/Firebase claims before stating them as fact.

## 3rd-party API (base .../3rdparty/v1, Basic auth)
- POST /messages?skipPhoneValidation=&deviceActiveWithin=  body smsgateway.Message:
  { id? (<=36), deviceId? (21 chars), phoneNumbers: [..1-100], textMessage: { text }, simNumber? (1-3), ttl? (>=5 s) | validUntil?, withDeliveryReport?, priority?, isEncrypted? }
  -> 202 { id, state, recipients:[{phoneNumber,state,error?}], ... } ; 409 same id exists ; 503 queue limits exceeded
- GET /messages/{id} -> MessageState { id, deviceId, state: Pending|Cancelling|Cancelled|Processed|Sent|Delivered|Failed, recipients:[{phoneNumber,state,error}], states:{}, isHashed }
- GET /devices -> [{ id, name, createdAt, updatedAt, lastSeen, simCards:[{ simNumber (1-based), slotIndex, phoneNumber, carrierName, iccid }] }]
- GET/POST /webhooks  { id?, url, event, deviceId? } ; DELETE /webhooks/{id}
- GET/PATCH/PUT /settings: { webhooks: { signing_key, retry_count, internet_required }, ping: { interval_seconds }, messages: { limit_period, limit_value, send_interval_min/max, sim_selection_mode: OSDefault|RoundRobin|Random, ... }, encryption: { passphrase } }
- GET /health

## Webhooks (sent by the PHONE itself, directly to our URL; https required, or http://127.0.0.1)
Body: { id, webhookId, deviceId, event, payload }
Events: sms:received, sms:data-received, sms:sent, sms:delivered, sms:failed, sms:cancelled, system:ping, mms:received, mms:downloaded, app:started, sms:batch:* ...
- sms:received payload: { messageId, phoneNumber (sender), sender, recipient (SIM number, may be null), simNumber (may be null), message, receivedAt }
- sms:sent: { messageId, phoneNumber (recipient), simNumber, partsCount, sentAt } ; sms:delivered: {.., deliveredAt}; sms:failed: { .., failedAt, reason }
- system:ping: { health: { status: pass|warn|fail, version, releaseId, checks } }
Signature (PayloadSingingPlugin.kt): headers X-Signature = hex(HMAC-SHA256(key = signing key UTF-8, message = rawBody + X-Timestamp)), X-Timestamp = unix seconds string.

## Calls
The app does SMS/MMS only. No live calls through Postern. Plain carrier call forwarding on the SIM (GSM code **21*NUMBER# ; cancel ##21#) set by hand on the phone.

## Design sketch for Postern
- PHONE_PROVIDER=ownphone ; OWNPHONE_API_URL (default http://smsgate:3000/api/3rdparty/v1)
- Pool table in accounts.db: devices (label, login/password srvEncrypt, deviceId, hook token hash, signing key srvEncrypt, last_seen) and sims (device, simNumber, number_hmac, number_srv srvEncrypt). No plain numbers.
- CLI tool to add/list/remove phones and SIMs; it registers webhooks + signing key + ping interval through the API.
- provider.search = free pool numbers; buy = assign; release = back to pool. voice = false.
- Online/offline from system:ping (+ GET /devices lastSeen). Dashboard badge + warning.
- Outgoing texts are asynchronous: need a delivery status on text rows (queued/sent/delivered/failed) and refund on failure.
- Tests: fake gateway (node:http emulating the 3rd-party API + a fake phone that posts signed webhooks). If Docker works here, also try the real upstream server with a fake device.

## App menu labels (strings.xml, v1.78.0) — for the setup guide
- Home screen: switches "Local Server" and "Cloud Server"; button "Start Service" at the bottom. First start in cloud mode asks: "Sign Up" (new account, no email), "Sign In" (login+password), "By Code".
- Settings -> "Cloud server" ("API URL, private token, credentials, etc."): fields "API URL" (server address), "Private Token"; "Credentials" with "Unregister device".
- After registration the Cloud Server section on the home screen shows Username and Password (basic auth for the 3rd-party API). Also "Device ID".
- Settings -> Webhooks ("Retries, signing, etc."): "Signing Key". Settings -> "Ping". Settings has a "Battery optimization" item (disable it).
- Changelog v1.77.5: receivers declared in manifest; gateway starts automatically after an app update if the autostart setting is on.
- When connected to a cloud/private server, received messages are ALSO uploaded to the server inbox (POST /mobile/v1/inbox) — privacy note: the private relay stores incoming texts too (check hashing/cleanup settings; tasks.messages_cleanup max_age 720h default).

## Environment facts
- Docker daemon is NOT running in this build container -> cannot run the upstream server here. Tests = fake gateway only. Say so plainly.
- Ops agent gaps list handled so far: TWILIO_MESSAGING_SERVICE_SID / BUNDLE / ADDRESS settings added to config.js (adapter must still use them), start warning for pay off + prices.
- Ops agent idea: reverse phone verification (user texts a code TO the VoIP number) avoids outgoing SMS; consider.
