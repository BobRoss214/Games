# Money section — Phase 0 report (check before the build)

Date of the checks: 2026-11-12. Made from a cloud workspace, not from the owner's laptop.
No account, invoice, quote, shift or order was made. Only public pages and public read addresses were read.
The pages that were read are not in this repository (they were temporary files of the session).

## 1. Short result

| Part of the plan | Result |
|---|---|
| Buy a US gift card from Bitrefill with a coin that Bitrefill accepts (Level 1, Flow A) | **Possible on paper.** Three points wait for the owner's key (section 7). |
| Swap a coin that Bitrefill does not accept (Level 1, Flow B) | **No usable service proven.** SideShift cannot be used (section 3). Trocador is not read yet. |
| Monero route (Level 2, Flow C) | **Cannot be built as designed now.** No swap service is proven for Monero for a US user. |
| One-click from the hidden XMR wallet (Flow D) | **Cannot be built as designed now.** Same reason: Bitrefill does not accept Monero, so this flow needs a Monero swap. |
| Card organizer, bank-style views, budgets, backup, lock, browser extension | Possible. They do not depend on a swap service. |

Primary swap service: **none proven.** Backup swap service: **none proven.**
USDC fallback wallet: **not decided.** It depends on the Bitrefill invoice expiry (needs the key) and on a working swap service.

## 2. Bitrefill (documents read: docs.bitrefill.com, 50 pages)

What works for the plan:
- A Personal API exists for personal automation. Address: `https://api.bitrefill.com/v2`. Key: "Authorization: Bearer …". The key is made at Account > Developers. The email of the account must be verified. The key is shown one time.
- Catalog: `GET /products` (filters: `country`, `category`; 50 items for each page), `GET /products/search?q=`, `GET /products/{id}`.
  A product has: id, name, country, currency, image, in_stock, fixed packages or a min/max range.
- Invoice: `POST /invoices` with the product, the value, `payment_method`, and `refund_address`. The answer has `payment.address`, `payment.price`, `payment.currency`.
- Payment methods in the documents today: balance, bitcoin, lightning, ethereum, usdc_base, eth_base, usdt_erc20, usdc_erc20, usdt_trc20, usdc_polygon, usdt_polygon, usdc_arbitrum, usdt_arbitrum, eth_arbitrum, usdc_solana, usdt_solana, solana, usdt_lightning, dogecoin, dash, litecoin, ton, usdt_ton. **Monero is not there** (no page has the word).
- Result: `GET /invoices/{id}` and `GET /orders/{id}`. The code, PIN, link and instructions are in `redemption_info` of the ORDER (not of the invoice).
- Polling is permitted and is sufficient. Limit: 60 reads of an invoice in 10 minutes. The app must poll each 10 seconds or slower.
- Refunds go to `refund_address`. Lightning payments cannot be refunded automatically.

What does not work or is not in the documents:
- **No catalog address is open without a key.** Each one answers 401. So the catalog shows sample data until the key is in.
- **The invoice expiry is not stated for this API.** A different Bitrefill interface speaks of a 15-minute price lock. Not proven for this API. Needs the key (section 7).
- **The no-ID purchase limits are not in any page that this machine could read** (the help pages refuse scripts). The API has an error `purchase_limit_reached`. The numbers must come from Bitrefill's own page; none are written here.
- **No field marks a product as "needs ID".** The app will hide the categories for payment cards and bills, and it will treat a "verification required" or "blocked" answer as a stop (refund, no retry, no ID).
  Result: the "Everywhere" card (general prepaid Visa/Mastercard) probably cannot be shown, because the app cannot prove that such a product needs no ID.
- **No idempotency key on `POST /invoices`.** The app must make sure itself that one click makes one invoice (it writes the step before and after the call, and after a crash it reads the list of invoices before it makes a new one).
- **No test products on a Personal account.** No dry run is possible. The first real test is the owner's small purchase.
- The documents disagree with themselves in places (field names, status names, product ids, two host names). The code will trust the live answers, checked after the key is in.
- Underpayment and wrong address: "may result in lost funds". Overpayment and late payment: not described.
- Note: a Personal key can pay with `payment_method: balance`. Balance is added on the Bitrefill website only.

## 3. SideShift — cannot be used

Each point was read two times (by a reader and again by the lead).
1. **Monero is switched off.** The coin list of sideshift.ai (204 coins) has no Monero. Each Monero pair answers "Deposit method is disabled" or "Settle method is disabled". The US site says "XMR is not available".
2. **sideshift.ai is not for US residents.** Its terms, 3.4: "not intended for use by individuals who are citizens or nationals of or resident in United States of America".
3. **sideshift.us has no public API.** It permits North Carolina (not FL, LA, MA, NY), but each API address on it answers 404. Its web page uses a private interface of sideshift.ai. That is not a documented way for an app, so the app will not use it.
4. Both sites forbid a VPN or proxy that hides the location.

For the record (useful only if this changes): fixed-rate quotes hold for 15 minutes; an exact settle amount is possible; a refund address is supported; minimum about 3 USD; an account needs no email or ID; `GET /v2/permissions` says if the caller's IP may make shifts (from this cloud machine: no).

## 4. Trocador — not read

The site showed this machine a "Checking your browser" page. I did not try to get past it.
All questions stay open: API key, no-KYC flags, Monero pairs, fixed-amount mode, refunds, rules for US users.
This must be read from the laptop. Until then no swap service is proven.

## 5. The hub as it is now

- The hub code is here (`identity-hub/`). The money section goes **inside the hub**, as a new section with a "$" tab.
- The hub is plain JavaScript modules, Node.js 22, the built-in SQLite, no framework, no build step, its own small screen toolkit, dark theme by default. The money section will match this. The TypeScript + React default of the brief does not apply.
- Hosting found:
  - A folder `deploy/` (Dockerfile, docker-compose.yml that opens ports 25, 80, 443, Caddyfile, backup.sh) and `docs/SETUP-GUIDE.md` for a server on the internet. **Nothing was ever deployed.**
  - In "production" mode the web server and the mail server listen on all network addresses (0.0.0.0). In the usual mode they listen on 127.0.0.1 only (web 8080, mail 2525).
  - A preview mode (`DEV_PREVIEW`) that I added for the cloud try-out.
  - No `run.sh`, no `test.sh`, no desktop launcher yet.
- **A fact the owner must know:** on a laptop with no server on the internet, the older parts of the hub cannot get real data. Mail from the internet cannot arrive (it needs a server with port 25 and a domain). Texts and calls cannot arrive (the phone companies must reach the server). These parts then work only with simulated data. The money section does not have this problem: it only calls out.
- The hub has accounts and sign-up (it was made for several users). The money section will not use them. It gets its own passphrase lock and its own local data, as the brief says.

## 6. Tools (versions seen in the package registry on 2026-11-12; nothing is installed yet)

| Tool | Version | Licence | Note |
|---|---|---|---|
| monero-ts | 0.11.22 | MIT | Only if a Monero swap service is proven. |
| libsodium-wrappers-sumo | 0.8.4 | ISC | For Argon2id. Node.js 22 has no built-in Argon2. |
| viem | 2.57.18 | MIT | See the note below. |
| wagmi / @wagmi/core | 3.7.11 / 3.6.9 | MIT | wagmi is made for React. The hub has no React and no build step. |
| QR code library | to select in Phase 3 | MIT | For example qrcode-generator 2.0.4 (no dependencies). |
| Monero CLI tools | laptop only | — | Not looked at from here. |

Note for Phase 6 (connect wallet): the hub's pages load no third-party script, and wagmi needs React and a build step.
My pick: talk to the browser wallet through its standard interface in a small file of our own, and use viem only in the tests to prove that the payment data is correct. I will show this again before Phase 6.

## 7. Waiting for keys

Keys that the owner must give: **one** — the Bitrefill API key (`BITREFILL_API_KEY`). No swap service key, because no swap service is proven.

Checks that wait for it:
1. The invoice expiry: make one invoice, read the expiry, do not pay it.
2. The real US catalog and its field names; which categories to hide.
3. The purchase limits of the account without ID (from Bitrefill's own page or from the API answer).
4. Whether the key can pay from balance (note only).

## 8. Open because it needs the laptop

- Read the Trocador API documents.
- Ask SideShift's permissions address from the laptop's own IP (for the record; it does not change points 1 to 3 of section 3).
- What MetaMask supports beyond Ethereum-type networks. Until that is confirmed: Bitcoin, Lightning, Litecoin and Solana are "send to address" only.
- VPN and Mullvad checks, browser list, the Monero tools.

## 9. Design notes that came out of the check

- Auto-lock (10 minutes) against a long purchase: a running purchase must be able to finish and save its code. Plan: the screen locks, the running purchase continues in the background, and the key is dropped from memory when the purchase is finished.
- The built-in SQLite cannot encrypt a whole file. Plan: each row's content is encrypted (codes, PINs, names, notes, addresses, order IDs); only what the state machine needs to continue stays readable (ids, step names, times).
- Store images: the hub's pages may load pictures only from the hub itself. The back end fetches each picture from Bitrefill one time and keeps a copy.
- Statements as PDF: through the browser's own "Print > Save as PDF", with a print layout. No PDF library.
- Charts: drawn by our own code. No chart library.
- "Part A" (the five manual jobs and the `.env` lines) was not in the brief that I received. From this check, `.env` needs one line: `BITREFILL_API_KEY=`.

## 10. Decisions for the owner

1. **The swap problem.** No service is proven for Monero swaps for a US user. Level 2, one-click from XMR, and swaps for other coins cannot be built as designed now. Ways to go on:
   - **A (my pick):** build now everything that needs no swap: direct payment with a coin Bitrefill accepts (send to address, then connect wallet), the organizer, the bank-style views, budgets, backup, lock, the extension. Read Trocador from the laptop. Build the Monero wallet and the swap flows only if a service passes the check.
   - **B:** stop until Trocador is read from the laptop, then decide.
   - **C:** change the design of one-click: a hidden wallet in a coin that Bitrefill accepts directly (for example USDC on a low-fee network, or Litecoin). One click works with no swap. The privacy is weaker than Monero, because these networks are public.
   - **D:** change the design of one-click: add balance on the Bitrefill website, and the app buys from that balance. Fast and simple, but the money then sits with Bitrefill.
2. **Hosting.** May I add `./run.sh` and a desktop launcher that start the hub on 127.0.0.1 only, and leave the old `deploy/` files where they are (not used, not deleted)?
3. **The older hub parts** (mail, numbers, funds): on the laptop they can show only simulated data. Keep them as they are for now?
4. **Part A** was not in the message. Send it, or tell me to use my own list of your jobs.
