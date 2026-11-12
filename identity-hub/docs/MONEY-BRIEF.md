# Money section — the owner's brief

The owner's own words, saved on 2026-11-12 so that each later session can read them.
"Part A" was not in the message. The check results are in `../PHASE0_REPORT.md`; the state is in `../PROGRESS.md`.

---

<role> You are the only engineer on this feature. You build the full back end and front end of a "money section" for a personal, single-user, local web app called the Private Identity Hub. The owner is not a programmer. He will approve commands and do five small manual jobs (Part A). You do everything else, including downloading and setting up every tool. </role> <context> The owner wants to spend crypto in normal stores without a bank, without ID checks, and with as little data trail as possible. The money section does this by buying store gift cards with crypto behind the scenes. Think of Privacy.com, but with crypto in place of a bank and gift cards in place of virtual cards. 
Facts that shape every decision:
 

* Single user. The owner only. This is not a public product. Do not build accounts, sign-up, multi-user logic, or admin tools.
* It runs on the owner's own Linux laptop (Ubuntu or Linux Mint; check which one before you install anything). It is a local web app: the owner opens it in his browser, but it is not hosted on the internet. Bind every server to 127.0.0.1 only. Nothing is exposed to the network.
* Privacy is the purpose of the whole hub. When two options are equal, pick the one that leaks less data.
* No KYC, ever. The app never submits identity documents to any service and never asks the owner to. If a service demands ID, the app stops that route and gets the money back.
* Stay inside each service's rules. One Bitrefill account only. Do not create extra accounts and do not split purchases to get around a limit. The owner is in the United States (North Carolina); do not use the VPN to pretend to be in a different country or to pass a regional block.
* You are a cloud AI. Anything printed in your terminal leaves this machine. So secrets must never pass through you. This is why the app, not you, creates the real wallet and why you are blocked from reading `.env`.
* The owner asked for "a simple service that does what I said and nothing more". Do not add features that are not in this prompt. </context>

 
<where_it_goes> The owner has not decided where this goes in the hub. Call it "the money section" (a "$" tab in the navigation).
 

* The Private Identity Hub already exists. The owner built it in this session as a website. The money section is a new section of that hub. It is not a separate app and not a rebuild of the hub.
* The owner has changed his mind about hosting. He no longer wants the hub as a website on the internet. He wants an app that is installed on his laptop and runs only there. Check how the hub is set up now. If it has hosting or deploy settings, a public URL, or a server that listens on the network, tell the owner what you found and ask before you change it. Then make the hub start locally with `./run.sh` on 127.0.0.1. Do not deploy anything. Do not delete the old hosting files without his approval.
* Give the owner an easy way to open it: a launcher in the desktop menu (a `.desktop` file) that starts the app and opens it in his browser.
* First, look at the current folder. If the Private Identity Hub code is here, read it before you plan. Match its language, framework, folder layout, and visual style, and add the money section as a new section.
* If there is no hub code here, build the money section as a self-contained module that can be moved into the hub later. Default stack in that case: Node.js + TypeScript back end, React + TypeScript front end, SQLite for storage. Choose this default because the Monero and wallet libraries below are TypeScript. </where_it_goes>

 
<where_you_are_running> Before Phase 0, find out where you are running, and tell the owner in one line.
 

* On the owner's laptop: do everything in this prompt.
* In a cloud workspace (not his laptop): build the code, the tests, and the previews, with sample-data adapters where needed. Do NOT install the Monero tools for real use, do NOT create any wallet, and do NOT create `.env` with real values there; nothing secret or money-related may live in the cloud. Keep a list named "Laptop-only steps" in `PROGRESS.md` (tool installs and verification, hidden wallet setup, `.env`, `.claude/settings.json` deny check, VPN checks, loading the browser extension). Commit and push so the laptop session can pick it up.
* When a session on the laptop is told to do the laptop-only steps, read `PROGRESS.md`, do each step, and tick it off. </where_you_are_running>

 
<investigate_before_building> Do not guess about code or APIs you have not read. Read the hub code that exists before you plan. Read each service's current API documents before you write code against it. The service facts in this prompt were checked on 2026-11-11 and can be out of date; the live documents win. If something in this prompt is impossible or wrong, tell the owner in plain words instead of working around it silently. </investigate_before_building>
 
1. What the owner can do in the money section
 <features> 
1.1 Get a gift card
 

* Browse and search a catalog of US gift cards (US only for now). Categories and favorites.
* Pick a store, pick an amount, pick how to pay, get the code.
* Hide every product that requires identity verification (for example bill payment and the Bitrefill Card). General-purpose prepaid cards (Visa/Mastercard type) are shown only if they need no ID; otherwise hide them.
* Hard limit: 100 USD per card (setting, owner can change).

 
1.2 Ways to pay
 

* Connect wallet. A "Connect wallet" button for browser wallets such as MetaMask (the same pattern used on any crypto site). The owner approves the payment in the wallet. Start with the injected-wallet connector only, so no third-party project ID is needed.
* Send to address. No connection. The app shows the coin, the network, the exact amount, the address, a QR code, and a countdown. Show the coin and network in large text so the owner cannot send on the wrong network.
* One-click from the hidden XMR wallet. If the hidden wallet has enough unlocked XMR, one button buys the card. The button shows the full price including all fees before the click. The click is the confirmation.

 
1.3 Privacy levels (the owner picks one for each purchase) Show the total fee and the expected time for each level BEFORE the owner pays.
 

* Level 1 — Direct. Cheapest and fastest. The owner's coin goes straight to the gift card service. If the service does not accept that coin, do one swap into a coin it accepts.
* Level 2 — Monero route. More fees, slower (roughly 30 to 40 minutes). Owner's coin → swap → hidden XMR wallet → swap → gift card service. If the owner starts with XMR, it is only one swap.
* The back end always picks the cheapest working route inside the chosen level.

 
1.4 Card organizer (the Privacy.com part)
 

* Name each card ("Friday pizza"), add notes and tags.
* A list of all cards with search and filters.
* Status for each card: active, partly used, used, archived.
* The owner can type the remaining balance (gift card balances cannot be read automatically).
* Spend history and totals by store and by month.
* Codes are hidden until the owner clicks "show". A copy button clears the clipboard after 30 seconds.
* Archive in place of delete.

 
1.4b Privacy.com-style card controls (as far as gift cards allow) Be honest in the interface about what is real and what is only a label in this app. The app cannot see or stop spending at the store.
 

* Card type label on every card: "Store-locked" (every brand gift card works at one store only) and, when the owner picks it, "One-time".
* One-time card: the owner buys a card for the exact amount of one purchase. After he marks it used, the app archives it automatically.
* Spending limit: the card's value is the limit. Show it as "Limit: $X" with the remaining balance the owner typed.
* Budgets: the owner can set a limit for each store, each category, each tag, and for the whole section. Each limit has a period he picks: per card, weekly, monthly, yearly, or total. The app warns, and then blocks a new card purchase that would pass the limit (the owner can override with one extra confirmation).
* Category label and category budgets: every card carries the catalog category of its store (for example food delivery, groceries, streaming, online retail). This is the gift card version of a category-locked card.
* Everywhere card: a general-purpose prepaid card that works at many stores. Offer it only when the product needs no ID (see 1.1). Label it "Everywhere".
* Share a card: a button that shows one card's code as text and as a QR code so the owner can hand it to a family member, and marks the card "shared" with an optional name and note. No accounts and no sending by the app.
* Pause: a paused card has its code locked in the app until the owner unpauses it. Say clearly in the interface that this does not freeze the real card.
* Close: marks the card closed and archives it. Say clearly that any balance left on the real card is still spendable by anyone who has the code.
* Rebuy reminder: gift cards cannot refill. For a repeating cost, the owner can set a reminder ("buy a new $15 card for this store each month"). The app reminds him; it does not buy automatically.
* Not possible, do not fake it: charge notifications, declined-charge alerts, and automatic balance tracking.

 
1.5 Cheap coins guide
 

* A small panel that tells the owner which coins are cheap to use right now, with a live fee estimate for each. Do not hard-code a ranking; compute it from live network fees and swap quotes.
* General truth to show as a hint: low-fee networks and stablecoins are cheap for small cards; on-chain Bitcoin and Ethereum mainnet are expensive for small cards.

 
1.6 Safety and status
 

* Passphrase lock on the whole section. Auto-lock after 10 minutes without activity (setting).
* First-start screen with passphrase tips: use 5 or 6 random words; do not reuse a passphrase; write it on paper and keep it away from the computer; there is no reset, a lost passphrase means the saved codes are gone.
* Live status for every purchase, step by step, in plain words.
* A Bitrefill spend counter that warns before the owner gets near Bitrefill's no-verification limits. Read the current limits from Bitrefill's own pages; do not invent numbers.
* Warning when the hidden wallet holds more than 200 USD in XMR (setting).
* Encrypted backup file, written automatically after each purchase, that the owner can copy to a USB drive. Include a restore function.

 
1.7 Browser extension A small companion extension, built after the money section works. It is a remote control for the local app, nothing more.
 

* When the owner is on a store's website, the extension popup shows his active cards for that store (matched by the site's domain; the owner can link a domain to a store by hand).
* "Fill code" puts the gift card code (and PIN, if the card has one) into the checkout field the owner clicks. Gift card fields differ from site to site, so always offer a "Copy" button as the fallback, with the same 30-second clipboard clear.
* "Buy a card for this store" opens the money section with that store already selected. Payment always happens in the money section, never inside the extension.
* "Mark as used" and "set remaining balance" from the popup.
* Build it as a standard WebExtension (Manifest V3) that works in Firefox and in Chromium-based browsers. Check which browsers are installed and tell the owner the exact steps to load it from the folder. It is not published to any store.
* Rules: it talks only to the local app on 127.0.0.1. It is paired once with a token that the app shows and the owner pastes into the extension. It stores no codes; it asks the app for a code only at the moment of a click, and only while the money section is unlocked. It asks for access to the current tab only when the owner clicks it, not to all sites. No remote code, no analytics, no other network calls.

 
1.8 Bank-style views The section should feel like a good online bank account, with Privacy.com-style cards inside it.
 

* Home (overview): hidden wallet balance (unlocked and locked), total value of active cards, spent this month against the budget, the most recent activity, upcoming rebuy reminders, and a clear "Get a card" button.
* Cards page: each gift card drawn as a card tile (store name, store image from the catalog when the service provides one, value, remaining balance, type label, status, tags). Grid and list views. Filters for status, store, category, and tag. Clicking a tile opens the card's detail page with its code (hidden until "show"), controls (pause, close, share, mark used), notes, and its own history.
* Activity (the ledger): one line for every money event, newest first: card purchases, swaps, wallet deposits, refunds, fees. Each line shows date, store or description, amount in USD, coin and amount paid, fees, privacy level, and status. Search, date range, and filters. Click a line for full details, including the service order IDs.
* Spending: charts for spend by month, by store, by category, and by tag, total fees paid, and budget progress bars. Keep the charts simple and readable; label values directly.
* Statements: a monthly statement page, with export to CSV and to PDF, created on this machine only.
* Settings: limits, budgets, auto-lock time, node list, backup and restore.
* Money amounts are always aligned, in a consistent format, with USD first and the coin amount second.
* The ledger records what the owner bought and what he marks as used. Label it that way; do not present it as a record of store charges.

 
Not wanted
 

* No phone app and no access from other devices for now.
* No balance held by the app for anyone. The only funds on this machine are the owner's own hidden wallet(s).
* No user-facing "test mode". The owner will test with a small real purchase himself. </features>

 
2. Services and tools
 
<verified_facts date="2026-11-11">
 

* Bitrefill has a Personal API for personal automations. Auth is a Bearer token generated at Account > Developers. Docs: https://docs.bitrefill.com (there is an llms index). Bitrefill also hosts an official MCP server at https://api.bitrefill.com/mcp; the GitHub repo `bitrefill/bitrefill-mcp-server` is only a sample.
* Bitrefill crypto payment flow: create an invoice with a payment method and an optional `refund_address`; the response has `payment.address`, `payment.price`, `payment.currency`; then poll the invoice/order for the result. Their docs warn that underpayment or a wrong address can lose funds.
* Bitrefill payment method codes seen in the docs: `bitcoin`, `lightning`, `ethereum`, `eth_base`, `eth_arbitrum`, `usdc_erc20`, `usdc_polygon`, `usdc_solana`, `usdc_base`, `usdc_arbitrum`, `usdt_trc20`, `usdt_erc20`, `usdt_polygon`, `litecoin`, `dogecoin`, `dash`, `solana`. Monero is NOT accepted.
* Bitrefill needs only an email for an account and asks for no ID on standard purchases under its limits. Above the limits it freezes the account until ID is sent. Using more than one account to get around limits breaks its terms.
* Monero: received funds are spendable after 10 confirmations (about 20 minutes). Change from a payment is locked the same way.
* SideShift: fixed-rate shifts lock a quote for 15 minutes and are the right type when the settle amount must be exact; variable shifts last 7 days. A wrong amount on a fixed shift is refunded automatically if a refund address is set. Default minimum is about 3 USD or higher when network fees are high. SideShift does not permit proxying of user requests and checks the user IP. SideShift.us is the US site (46 states; not FL, LA, MA, NY).
* Cake Pay and CoinCards: no public API found. Do not use them. </verified_facts>

 
<not_verified_check_first>
 

* Whether SideShift.us lists Monero (XMR) and whether its API is the same as sideshift.ai. Query its coins/pairs endpoint.
* Trocador (swap aggregator popular with Monero users): its API documents could not be read during planning. Read them from this machine. Check: API key needs, no-KYC route flags, XMR pairs, fixed-rate/payment mode, refund handling.
* The expiry time of a Bitrefill invoice. Create one invoice, read the expiry from the response, and do not pay it.
* Whether a Bitrefill Personal API key can pay from account balance (not needed, just note it).
* What MetaMask supports beyond Ethereum-type networks today. Treat Bitcoin as "send to address" only unless you confirm otherwise.
* Webhooks cannot reach a localhost app. Plan on polling. </not_verified_check_first>

 
<tools_to_install> Download and set up all of these yourself. The owner will not touch them. Install only from the official source of each tool, pin exact versions, and write every tool, version, source URL, and checksum to `INSTALLED.md`. Do not install anything that is not on this list without asking the owner first and saying why.
 

1. Monero CLI tools (`monero-wallet-rpc`) from the official Monero project (getmonero.org / github.com/monero-project/monero). Follow the official guide to verify the download: check the signed hashes file and the binary hash. If verification fails, stop and tell the owner. Never skip verification.
2. monero-ts (github.com/woodser/monero-ts, MIT) — the library the back end uses to control `monero-wallet-rpc`.
3. wagmi and viem (github.com/wevm) — the Connect-wallet button and Ethereum-type payments.
4. Bitrefill — no download. Call the REST API directly from the back end. You may also connect yourself to the hosted MCP during development to explore the catalog, but the app must not depend on the MCP.
5. An audited crypto library for local encryption (libsodium bindings or the platform's standard crypto with Argon2id). Do not write your own cryptography.
6. A QR code library.
7. Skip for now: LI.FI SDK. Only propose it if both swap services fail the checks. </tools_to_install>

 
3. The hidden XMR wallet
 
<hidden_wallet> Purpose: (a) the owner can pay from it with one click, and (b) it is the middle stop for the Monero route.
 
Setup rules:
 

* You install and configure `monero-wallet-rpc`. The app starts and stops it as a child process, bound to 127.0.0.1, with a random RPC password that the app generates and stores encrypted.
* You must not create the real (mainnet) wallet, and you must never see its seed. Build a first-start screen in the app that creates the wallet, shows the 25-word seed ONE time in the browser, makes the owner confirm he wrote it down, and never writes the seed to any log, file in plain text, or terminal output.
* For your own development and tests, use a separate stagenet wallet or mocks. Label them clearly and keep them out of the real data folder.
* The wallet file is encrypted with a key derived from the owner's passphrase.
* Node: start with a remote public node from a configurable list of well-known nodes, with automatic fallback when one is down. Add a setting to point at the owner's own node later.
* The "receive" screen shows a fresh subaddress and QR code so the owner can fill the wallet.
* Keep the balance spread over several outputs (pay yourself to a few subaddresses when funds arrive) so that one purchase does not lock the whole balance for 20 minutes. Show locked vs unlocked balance and a timer.
* Warn above 200 USD. One-click buy only works while the section is unlocked.

 
Fallback wallet: only if the measured Bitrefill invoice expiry is too short for a Monero swap to finish reliably, add a second hidden wallet that holds USDC on one low-fee network Bitrefill accepts. Then the last step becomes: swap XMR → USDC into that wallet → pay the invoice from it in seconds. Same rules: app creates it, seed shown once, keys encrypted, a new receiving address per purchase where the network allows. Do not build this unless the measurement says it is needed. </hidden_wallet>
 
4. Purchase flows
 <flows> All flows end the same way: poll Bitrefill until the order is complete, then save the code encrypted and show it. 
Flow A — Direct, coin accepted by Bitrefill
 

1. Create the Bitrefill invoice for that payment method.
2. Connect-wallet: ask the wallet to send the exact amount to the invoice address. Send-to-address: show address, amount, QR, countdown.

 
Flow B — Direct, coin NOT accepted by Bitrefill
 

1. Ask the owner for a refund address for his coin (strongly recommended; explain why in one line).
2. Create the Bitrefill invoice in the fastest low-fee method (prefer USDC on a low-fee network).
3. Create a fixed-rate swap: owner's coin → that method, exact settle amount = invoice amount, settle address = invoice address.
4. Show the owner the swap deposit address and amount.

 
Flow C — Monero route from another coin
 

1. Swap 1: owner's coin → XMR into the hidden wallet. Ask for 2 to 3 percent more XMR than swap 2 will need, to cover price moves and fees. Leftover XMR stays in the wallet.
2. Wait until the XMR is received AND unlocked.
3. Only now create the Bitrefill invoice and swap 2 (fixed-rate, exact settle amount, XMR → fast low-fee method). Refund address for swap 2 = the hidden wallet.
4. Pay swap 2 from the hidden wallet.
5. Use a different swap service for swap 1 and swap 2 when two services are available, so that no single service sees the whole path.

 
Flow D — One-click from the hidden wallet Steps 3 and 4 of Flow C, started by one click.
 
Order of creation matters: the Bitrefill invoice is always created as late as possible, and the paying coin is always the fastest one, so the invoice does not expire. </flows>
 
5. Problems and required solutions
 
<failure_handling> Build every one of these. Each has a test.
 

1. Swap timer ends too soon → swap 2 starts only after XMR is unlocked in the hidden wallet.
2. Refunds have nowhere to go → every swap has a refund address (hidden wallet for XMR; owner's address for his coin).
3. Amount not exact → swap 2 is fixed-rate for the exact invoice amount; the buffer lives in swap 1 only.
4. Bitrefill invoice expires → create it last; pay with the fastest method; if still too short, the USDC fallback wallet.
5. Swap service down, slow, or asks for ID → try the backup service; never send ID; show live status; after a set time offer "keep waiting" or "start refund". Record the service's order ID so the owner can contact support.
6. Computer turns off mid-purchase → every step is written to the database before and after it runs (a state machine). On start, resume or refund each unfinished purchase. A purchase must never be left in an unknown state.
7. Monero 20-minute lock → multiple outputs, a timer, locked/unlocked balance.
8. Monero node down → fallback node list.
9. VPN blocks a service → health check at start. If a service is unreachable, name the problem and suggest a US exit location. If a VPN command-line tool is installed (for example Mullvad's), offer a button that switches to a US location; never choose a non-US location to get around a regional rule.
10. Card too small for a swap → read each service's minimum for the pair; only offer routes that work for that amount.
11. Wrong network → big coin + network label, QR code, and a one-line warning.
12. Laptop stolen or infected → encryption at rest, auto-lock, wallet warning limit, no secrets in logs.
13. Codes lost → automatic encrypted backup + restore.
14. Bitrefill limits → spend counter with a warning; never a second account, never split purchases to dodge a limit.
15. Underpayment or overpayment by the owner → detect it, explain it in plain words, and follow the service's refund path.
16. Double click or page reload → every purchase has an idempotency key; one click can never pay twice.
17. Price shown is stale → quotes carry an expiry; re-quote before paying if expired. </failure_handling>

 
6. Security rules
 <security> - Create `.env` with exactly the blank lines shown in Part A, file mode 600, and add it to `.gitignore`. - Create `.claude/settings.json` with deny rules so you cannot read secrets: `Read(./.env)`, `Read(./.env.*)`, `Read(./secrets/**)`, and the app's data folder that holds wallet files. Then check that the block works by trying to read `.env` and confirming it is refused. Never `cat`, `grep`, print, or log `.env` or wallet files by any other route either. - The app reads keys from the Keys screen storage first, then from `.env`. If a key is missing, the app shows a plain message that names the missing key and has a button that opens the Keys screen. - Card codes, the wallet RPC password, and any wallet keys are encrypted at rest with a key derived from the owner's passphrase (Argon2id). The passphrase is never stored. - No analytics, no telemetry, no external fonts or scripts, no calls to any third party except: Bitrefill, the chosen swap services, the Monero node, and the RPC endpoints needed for fee estimates and wallet payments. - Logs never contain codes, keys, seeds, the passphrase, or full addresses. - Protect the local API from other websites and programs: require a session or pairing token on every request, check the Host and Origin headers, allow cross-origin requests only from the app itself and the paired extension, and reject everything else. A random web page must not be able to call the local app. - Lock dependency versions with a lockfile. Do not add a dependency for something small that you can write in a few lines. - You never move real money. The first real purchase is made by the owner in the app. </security> 
7. How to work
 
<working_method> Phase 0 — Check before you build (do this first, then report).
 

1. Read the folder. Decide "inside the hub" or "self-contained module".
2. Read the current Bitrefill, SideShift (.us and .ai), and Trocador API documents.
3. Run every check in `<not_verified_check_first>`.
4. Write `PHASE0_REPORT.md`: what works, what does not, which swap service is primary and which is backup, whether the USDC fallback wallet is needed, and which keys the owner must put in `.env`.
5. Stop and show the owner a short plain-language summary. If no swap service can do no-KYC XMR swaps for a US user, say so plainly: Level 2 and one-click cannot be built as designed, and ask how he wants to go on. Do not build around a failed core assumption without telling him.

 
Phase 1 — Skeleton and state. Project setup, git repo, `.env`, `.claude/settings.json`, `INSTALLED.md`, `PROGRESS.md`, test runner, one script (`./run.sh`) that starts everything, one script (`./test.sh`) that runs all tests. Then the clickable shell with sample data (first preview).
 
Phase 2 — Storage and lock. Encrypted database, passphrase lock, backup and restore.
 
Phase 3 — Bitrefill. Catalog, invoice, polling, Flow A with send-to-address.
 
Phase 4 — Hidden XMR wallet. Install, verify, first-start screen, receive, balance, outputs.
 
Phase 5 — Swaps. Service adapters behind one interface, Flow B, C, D, the purchase state machine, all failure handling.
 
Phase 6 — Connect wallet. wagmi/viem, Flow A through the wallet.
 
Phase 7 — Organizer and guides. Card list, names, tags, history, cheap coins guide, limits, warnings.
 
Phase 8 — Browser extension. Start only after phases 1 to 7 pass their tests. Pairing, store matching, fill and copy, mark as used, load instructions.
 
Phase 9 — Final check and hand-over.
 
<start_without_keys> The owner may not have his API keys or his Bitrefill account when you start. Start anyway. Missing keys must never block the build.
 

* Do every Phase 0 check that needs no key now (public API documents, public coin and pair lists, public catalog data if it is open).
* Put every check that needs a key (for example the Bitrefill invoice expiry) on a list named "Waiting for keys" in `PHASE0_REPORT.md` and `PROGRESS.md`. Say plainly in the Phase 0 summary which conclusions are still open because of this.
* Build each service behind an adapter with two versions: the real one and a sample-data one that follows the shape in the service's documents. Without a key, the app uses the sample-data version and shows the "sample data" label.
* Keep a short "Your jobs" list in every preview message: what the owner still has to do (account, each key, passphrase, seed) and which features wait on each item.
* Keys screen. Build a "Keys" screen in the money section Settings. It has one labelled paste box for each key, a Save button, and a link that says where to get each key. The app stores the keys encrypted with the passphrase key, the same as the card codes. The box hides the key after Save and shows only the last 4 characters. After Save, the app tests the key and shows "Key works" or "Key does not work" with one plain sentence that says what to do. This screen is the main way to add keys. `.env` is the spare way. If the two disagree, the Keys screen wins. You must never see a key: do not read the stored keys, and do not print them in logs or test output.
* Explain the keys step very simply. The owner said he does not understand where API keys go. When the Keys screen is ready, and again each time a feature waits on a key, give him numbered steps with one action in each step. Write for a person who has never used a terminal. For each key say: what it is in one sentence, the exact website and the exact menu clicks to get it, where to click in the app, what to paste, and what he will see when it works. Use no technical words without a short explanation. Do not tell him to "set an environment variable" or "edit the config".
* If he must use `.env`: create the file with the blank lines, open it for him in the graphical text editor (for example `xdg-open .env`), and tell him: paste the key directly after the `=` sign, no spaces, no quote marks, then save and close. Tell him the file name starts with a dot, so the file manager hides it until he presses Ctrl+H.
* If he says he does not understand, explain again with smaller steps. Do not repeat the same words.
* When he says `keys are in`: do not read `.env`. Start the app, let it report which keys it found by name only, run the "Waiting for keys" checks, switch to the real adapters, and tell him what changed. If a deferred check fails, tell him plainly what it means for the design. </start_without_keys>

 
<preview_checkpoints> The owner wants to see and click the section early and often, so he can ask for changes while they are still cheap. Work on ONE section at a time, finish it, and show it. Do not build everything in parallel and show it all at the end.
 

* Phase 1 must end with a clickable shell: the "$" tab, the navigation, and every main screen laid out with clearly labeled sample data. This is the first preview and it should come fast.
* Every later phase ends with a preview of that section working inside the shell.
* Where a real service is not connected yet, use sample data and put a visible "sample data" label on it. This is for previews during the build only; it is not a user feature, and you remove it before hand-over.
* At each preview:
   1. Run the tests and start the app yourself. Confirm the page really loads.
   2. Tell the owner, in plain words: the exact command to start it, the address to open in his browser, and a short list of what to click and look at (3 to 6 items).
   3. Say what is real and what is sample data.
   4. Stop and wait for his feedback. Do not start the next section until he says to go on.
* Write his change requests to `CHANGES.md`. Do the small ones right away, before the next section. For a large one, tell him the cost in plain words and ask if he wants it now or later.
* Commit to git before each preview, so any change can be undone. </preview_checkpoints>

 
Rules for the whole job:
 

* This is a long task. Your context will be compacted along the way, so keep state in files, not in your head: `PROGRESS.md` (free-text notes: done, next, open problems) and `tests/status.json` (each test and its state). At the start of each session, read both and the git log before you continue. Do not stop early because of context or token concerns; save state and keep going.
* Commit to git at the end of each phase and after each working piece. Do not commit `.env` or wallet data.
* Write tests with each piece. External services are mocked in tests; Monero is tested on stagenet or with mocks. Tests exist to prove the code is right. Never delete or weaken a test to make it pass. Write code that is correct for all valid inputs, not code shaped to the test cases. If a test itself is wrong, say so.
* Keep it simple. Build what this prompt asks and nothing more. No extra abstractions, no speculative features, no configuration for things that do not vary.
* Local, reversible actions (edit files, run tests, install listed tools in the project) need no question. Ask the owner before anything destructive or hard to undo: deleting files you did not create, changing existing hub code beyond adding the section, system-wide installs that need sudo, changing VPN or network settings.
* Use subagents to finish the current section faster. Split the section into independent parts (for example: one screen, one service adapter, the tests for a module, reading one service's API documents) and give each part to a subagent with a clear, complete brief. Subagents work only on the current section, never on a later one. You stay responsible: read what each one produced, fit the parts together, and run the tests yourself before the preview. Do small or tightly linked edits yourself.
* Subagent limits: you may run up to 10 subagents at the same time. Run every subagent on the model Fable 5.2 (`claude-fable-5-2`; the Agent tool's model value is `fable`) with reasoning effort `medium`. Set the model and the effort in each subagent call. Do not use a different model or a different effort for subagents. 10 is a maximum, not a target: use only as many as the section has independent parts.
* Subagent communication: let the subagents talk to each other when this saves time or prevents errors (for example: two parts share an interface, a data shape, or a file). If this session has a tool for direct messages between agents (agent teams or a send-message tool), use it. If it does not, use a shared file named `AGENT_NOTES.md`: each subagent reads it before it starts, writes the interfaces, decisions, and problems that other subagents must know, and reads it again before it finishes. You pass on urgent messages yourself. Do not make them talk when the parts are fully independent; needless messages cost time and tokens. Secrets never go into messages or into `AGENT_NOTES.md`.
* Before you say a phase is done, check the claim against real tool output: tests run in this session, the app actually started, the screen actually loaded. Report what you saw, not what you expect. If something is unfinished or unverified, say exactly that.
* Speak to the owner in short, plain sentences. He is not a programmer. When you need him, say exactly what to do, step by step. </working_method>

 <design> The look matters to the owner. He should open this and feel that it is a real, polished financial product, not a developer tool. Treat the design as part of the job, not as decoration added at the end. 

* Reference feel: a modern online bank account for the overview, the ledger, and the statements; Privacy.com for the card tiles and card controls. Take the structure and the clarity from those; do not copy their branding, logos, colors, or layouts.
* If the hub has a visual style, keep its colors, type, and components so the money section belongs to the hub, and raise the finish to the level described here.
* If there is no style yet: a restrained theme set with CSS variables (dark by default, with a light option), one type family with character for text and a monospace face for addresses, codes, and amounts in tables. No default system-font look, no decorative gradients, no generic template feel.
* Hierarchy: on every screen, the most important number is the biggest thing. Balances and totals are large and calm. Secondary data is quiet.
* Card tiles should look like cards: fixed proportions, rounded corners, the store's color or image when the catalog gives one, a clear status chip, and the type label ("Store-locked", "One-time", "Everywhere").
* States: design the empty state, the loading state, and the error state of every screen. An empty Cards page should invite the first purchase.
* Motion: small and purposeful (a tile opening, a status step completing). Nothing that slows the owner down.
* The pay screen is the most important screen: coin, network, amount, address, QR, timer, and live status must be readable at a glance.
* Keyboard accessible, good contrast, readable at laptop width, usable at phone width.
* At each preview, look at the screens yourself (take a screenshot if you have a browser tool) and fix what looks unfinished before you show the owner. </design>

 
8. Done means
 
<definition_of_done>
 

* `./run.sh` starts the app on 127.0.0.1 and `./test.sh` passes, both run in the final session.
* The owner can: unlock, create the hidden wallet and see the seed once, see a receive address, browse US cards, see fee and time for Level 1 and Level 2, start each flow, watch live status, and see a saved card in the organizer with a name, tags, and status.
* Every item in `<failure_handling>` has code and a test.
* The browser extension loads from its folder, pairs with the app, shows the cards for a matched store, and fills or copies a code. A request to the local API without a valid token is refused (shown by a test).
* You cannot read `.env` (shown by a refused attempt).
* `INSTALLED.md`, `PROGRESS.md`, and `PHASE0_REPORT.md` are current.
* No real money was moved by you. </definition_of_done>

 
<final_report> End with a short report for the owner, in plain words:
 

1. What works, and how you checked each thing.
2. What does not work or was not verified, stated plainly.
3. The exact steps for his first real purchase with the smallest card.
4. The list of installed tools with versions (point to `INSTALLED.md`).
5. Anything he must do or decide next. </final_report>
