# Money section — progress notes

Read this file, `PHASE0_REPORT.md`, `tests/status.json` (from Phase 1) and the git log at the start of each session.
The full brief from the owner is in the session of 2026-11-12 ("money section"). The short form of its rules is at the end of this file.

## Where the work runs
- 2026-11-12: the session runs in a **cloud workspace** (host `vm`, no screen, no folder of the owner's computer connected).
  Cloud rule: code, tests and previews only. No Monero tools for real use, no wallet, no `.env` with real values, no keys.
- Cloud network: environment "games" allows only docs.bitrefill.com, api.bitrefill.com, www.bitrefill.com, sideshift.ai,
  sideshift.us, docs.sideshift.ai, trocador.app (plus package registries).

## Phase state
- [x] Phase 0 — check before the build. Report: `PHASE0_REPORT.md`. **Stopped: waiting for the owner's answers** to the four decisions in section 10 of the report.
  Result in one line: Bitrefill direct payment is possible on paper; SideShift cannot be used (Monero off, sideshift.ai not for US residents, sideshift.us has no API); Trocador not read; so Level 2, one-click from XMR and Flow B have no proven swap service.
- [ ] Phase 1 — skeleton, `run.sh`, `test.sh`, clickable shell with sample data (first preview)
- [ ] Phase 2 — storage and lock, backup and restore
- [ ] Phase 3 — Bitrefill: catalog, invoice, polling, Flow A (send to address)
- [ ] Phase 4 — hidden XMR wallet
- [ ] Phase 5 — swaps, Flows B, C, D, state machine, failure handling
- [ ] Phase 6 — connect wallet
- [ ] Phase 7 — organizer and guides
- [ ] Phase 8 — browser extension
- [ ] Phase 9 — final check and hand-over

## Laptop-only steps (a session on the owner's laptop does these and ticks them off)
- [ ] Check the system: `grep -E "^(NAME|VERSION)=" /etc/os-release` (Ubuntu or Linux Mint), Node.js version (the hub needs 22.13 or newer).
- [ ] Hosting change, after the owner's approval: `./run.sh` starts the hub on 127.0.0.1 only; desktop launcher (`.desktop` file).
- [ ] Create `.env` (blank lines only, mode 600) and check that it is in `.gitignore`.
- [ ] `.claude/settings.json` deny rules, then the proof: try to read `.env` and confirm that it is refused.
- [ ] Install the Monero CLI tools from the official source. Verify the signed hashes file and the binary hash. Stop if verification fails. Write version, URL and checksum to `INSTALLED.md`.
- [ ] Hidden wallet: the OWNER makes it on the first-start screen of the app. The agent never makes the mainnet wallet and never sees the seed.
- [ ] Read the Trocador API documents (this cloud machine gets a "Checking your browser" page and cannot read them).
- [ ] SideShift: read `GET /api/v2/permissions` from the laptop's own IP (the answer depends on the IP).
- [ ] VPN checks: service health check with the VPN on; look for the Mullvad command-line tool.
- [ ] Browsers installed (for the extension load steps); load the extension from its folder.
- [ ] MetaMask: confirm what it supports beyond Ethereum-type networks.

## Waiting for keys (checks that need the owner's keys; the app runs them after "keys are in")
- [ ] Bitrefill: create ONE invoice, read its expiry from the answer, do not pay it. Decides if the USDC fallback wallet is needed.
- [ ] Bitrefill: can a Personal API key pay from account balance (note only).
- [ ] Bitrefill: the real catalog (US), the fields that mark ID-only products, the no-verification limits of the account.
- [ ] Swap services: one real quote for each pair in use (no shift is created without the owner).

## Open problems
- No swap service proven. Do NOT build Phases 4 and 5 (Monero wallet, swaps) before the owner decides (report, section 10, decision 1).
- "Part A" of the brief (five manual jobs, `.env` lines) was not in the message. Asked the owner.
- Bitrefill REST documents: no invoice expiry, no limit numbers, no "needs ID" field, no idempotency key. See report section 2.
- A subagent for the Trocador documents was refused by the permission system (the site has a browser check). One plain request was made by the lead; no further tries from the cloud.
- One automatic test of the hub failed one time in eight runs on 2026-11-12 (name not caught). Watch for it.

## Short form of the owner's rules
- Single user, local only (127.0.0.1), privacy first, no KYC ever, one Bitrefill account, no limit dodging, no VPN country tricks.
- Secrets never pass through the agent: no reading `.env`, wallet files, stored keys; the app makes the wallet.
- Build only what the brief asks. One section at a time, preview after each phase, wait for "go on".
- Match the hub: plain JavaScript modules, no framework, no build step, the hub's look (dark by default) and its simple words.
- Subagents: at most 10, model `fable`, effort `medium`, only for the current section.
- The agent never moves real money.
