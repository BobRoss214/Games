# UI guide for feature files

For everybody who adds a feature to the web app (`web/`). Read it before the first line of code.

- The app is plain HTML, CSS and JavaScript modules. No framework, no build step, no npm package, no CDN.
- **One owner** has the shared files: `main.js`, `js/ui/`, `js/screens/`, all CSS, and the toolkit in `js/lib/` (dom, store, router,
  api, session, data, mail, phone, identities, registry). Do not edit them: ask the owner. A pure helper file that you wrote in `js/lib/` stays yours.
- **You** write new files in `web/js/features/` and add one import line to `web/js/features/index.js`.
  Your file hooks into the app through the extension points in `web/js/lib/registry.js` (part 3).

## 1. A feature in three steps

```js
// web/js/features/stats.js  (small; loads with the app; registers only)
import { registerRoute, registerNavItem } from '../lib/registry.js';
registerRoute('/stats', () => import('./stats/screen.js'), { title: 'My stats' });
registerNavItem({ id: 'stats', label: 'My stats', icon: 'group', path: '/stats', order: 60 });

// web/js/features/stats/screen.js  (loads when somebody opens /stats)
import { h } from '../../lib/dom.js';
import { pageHeader } from '../../ui/components.js';
export default function screen({ params, scope }) {
  return h('div', { class: 'page page-narrow' }, pageHeader({ title: 'My stats' }), h('div', { class: 'prose' }, h('p', null, 'Text.')));
}

// web/js/features/index.js: one line per feature, nothing else
import './stats.js';
```
Register at the top level of the file, not later. Keep heavy code in files that load on demand.

## 2. The toolkit

| Need | Use | From |
|---|---|---|
| Make elements | `h(tag, propsOrNull, ...children)`; props: `class`, `dataset`, `style`, `onClick`, `ref`, any attribute. Children: nodes, text, arrays, `null`. There is no `innerHTML`. | `lib/dom.js` |
| Clean-up with the screen | `scope.add(fn)`, `scope.listen(target, type, fn)`, `scope.timer(fn, ms)`, `scope.disposed` | given to your screen |
| A part that paints again | `region(scope, store, ['aliases'], (state) => node or null)` | `lib/dom.js` |
| App data | `store.get('aliases')`, `store.subscribe(keys, fn)` (returns the function that stops it). Keys: `phase`, `config`, `account`, `balance`, `mailboxes`, `aliases`, `numbers`, `phones`, `identities`, `prefs`. A list is `null` while it loads. | `lib/store.js` |
| Go to a screen | `navigate('/help')`, or `h('a', { href: '/help', 'data-link': true }, 'Help')`. With `#id` at the end the page moves to that element and puts the focus on it; a screen that paints later calls `jumpToAnchor()` itself. After a screen change the focus goes to the `h1` of the new screen. | `lib/router.js` |
| Call the server | `api.get/post/put/patch/del(path, body)`; throws `ApiError { status, code, message }` | `lib/api.js` |
| Show an error | `reportError(err)`: a toast; a 402 opens "Add funds to continue" | `ui/components.js` |
| A button that waits | `button('Save', { kind: 'primary', onClick: (e, btn) => runBusy(btn, async () => { ... }) })` | `ui/components.js` |
| Notice | `toast('Saved', { kind: 'ok' })`; kinds `info`, `ok`, `error`; `action: { label, onClick }` for Undo | `ui/toast.js` |
| Copy | `copyButton(() => value, 'Copy address', { what: 'Address copied' })`, `copyText(value, 'Copied')` | `ui/components.js`, `ui/toast.js` |
| Ask before a risk | `await confirmDialog({ title, message, confirmLabel: 'Delete' })` gives `true` or `false`. `typed: 'delete'` makes the person type the word. `danger: false` for a safe question. | `ui/dialog.js` |
| A form in a dialog | `await formDialog({ title, submitLabel, build: () => fields, onSubmit: async () => { ... } })`. An error thrown in `onSubmit` shows inside the dialog. For anything else: `openDialog({ title, content: (api) => node, size })`. | `ui/dialog.js` |
| Fields | `field({ label, hint, maxlength, rows })` gives `{ el, input, value, setError(text) }`; `selectField`, `checkbox`, `toggle`, `segmented`, `chips`, `tabs` | `ui/components.js` |
| "…" menu | `menuButton({ label, items: () => [{ label, icon, onSelect, danger }, 'separator'] })` | `ui/menu.js` |
| Page parts | `pageHeader({ title, lede, actions, back })`, `section({ title, lede, actions }, ...nodes)`, `callout('info' or 'warn' or 'danger' or 'ok', title, ...nodes)`, `tag('Off', 'warn')` | `ui/components.js` |
| Icons | `icon('mail', { size: 18, label: 'Email' })`. The names are in `ui/icons.js`. Ask the owner for a new one. | `ui/icons.js` |
| "Why?" | `why('alias-off')`: a small button that opens a short explanation in place (no request, nothing saved). The words are `WHY` in `help/content.js`. `whyParts(key)` gives `{ button, panel }` to place apart; `whyGroup([[key], [key]])` puts buttons on one line. | `ui/why.js` |
| A code with "Copy" | `codeIn(text, subject)` gives the "Code 482913 · Copy" chip or `null`; `codeChip(found)` | `ui/code.js` |
| Show an email body | `mailBody({ body: { text, html }, attachments, getAttachment, scope })`: the one viewer (cleaned HTML in a closed frame, remote images blocked). Never build a second one. | `ui/mailbody.js` |
| Words for a recovery-key error | `recoveryMessage(err)` | `screens/signin.js` |
| The product name | `appName()`, never the word "Postern" in a string: the person who runs the server can change the name | `lib/store.js` |
| Open a shared dialog or place | `openAddPasskey()` gives `{ unlocks }` or `undefined` (`ui/passkeys.js`); `openAddFunds()` goes to Funds at "Add funds" (`screens/funds.js`); `openNewAlias()`, `openNewInbox()`, `openGetNumber()` (`ui/items.js`); `openNewIdentity()` (`ui/identity.js`) | see left |
| Is a screen there? | `hasRoute('/stats')`: true for the app's own screens and for screens of feature files | `lib/registry.js` |
| Things that happened in this tab | `bus.on('passkeys', fn)` (a passkey was added or removed), `bus.on('text-sent', fn)`; `store.get('passkeyCount')` (`null` while it loads) | `lib/store.js` |
| Format | `money(credits)`, `shortTime(at)`, `fullTime(at)`, `dayText('2026-11-11')`, `phoneText(e164)`, `plural(n, 'message')`, `bytesText(n)`, `duration(seconds)` | `lib/format.js` |

**Loading, empty, error.** Every list has all three. Never an empty white box.
```js
if (list === null) return skeletonRows(4);                               // loading
if (error) return loadError(error.message, reload);                      // error + "Try again"
if (!list.length) return emptyState({ title: 'No mail yet', text: 'Mail to this address shows here.', compact: true });
```

**Live updates.** The server pushes changes. The store lists reload by themselves. For your own lists:
`scope.add(bus.on('mail', reload))` (`lib/store.js`); events: `mail`, `text`, `call`, `balance`, `mailbox`, `aliases`, `number`, `phones`.

**Your own encrypted data.** The server must never see it in plain. Three places, all encrypted in the browser:

| Where | Read | Write (reads the newest copy first, keeps every other field) |
|---|---|---|
| On one inbox, alias or number (max 2 KB together with label and details) | `alias.extra.myField` | `setItemExtra('alias', id, { myField: value })`; `null` removes (`lib/data.js`) |
| On one identity | `identity.extra.myField` | `setIdentityExtra(id, { myField: value })` (`lib/identities.js`) |
| For the account (max 256 KB for one key, 50 keys) | `await vaultGet('my-key')` | `await vaultChange('my-key', (old) => next)` (`lib/session.js`); key: small letters, digits, `-`. It costs 3 requests. If your feature is the only writer of the key: `vaultChange(key, fn, { fresh: false })` costs 1 request after the first read. |

Extra fields that exist (do not reuse a name; tell the owner before you add one):

| Field | On | Value | Written by |
|---|---|---|---|
| `senders` | alias | list of main domains that the alias knows, 50 at most: `["shop.example"]` | the "possibly leaked" watch (`lib/leakwatch.js`: `knownSenders(alias)`, `expectSender(alias, domain)`) |
| `username` | alias, number, identity | the username of the "Random identifiers generator" card | `ui/persona.js` (`cleanUsername(value)` checks it) |
| `colour` | identity | one name of `COLOURS` (`red`, `orange`, `gold`, `green`, `teal`, `blue`, `purple`, `pink`) | `setIdentityColour(id, name)` |
| `events` | identity | history, 50 at most, oldest first: `[{ day: 'YYYY-MM-DD', type }]`, types `made`, `first-mail`, `turned-off`, `turned-on`, `burned` | `addIdentityEvent(id, type)`; read with `eventsOf(identity)` |
| `burned`, `burning` | identity (`burned` also on one alias) | `burned = { day: 'YYYY-MM-DD' }` when it is burned; the door then shows "Burned" (`identityState(identity)`) | the burn feature |

The hints of "possibly leaked" are in memory only: `store.get('leaks')` = `{ [aliasId]: [{ domain, fromAddress, firstAt, lastAt, count, messageId }] }`.
Do not write to `label`, `note`, `persona`, `identityId`: they have their own functions (`updateAlias`, `setItemPersona`, `setItemIdentity`).
Writes to one item run one after the other in a tab, so two features that save different fields at the same moment both keep their change.
Check what you read (`typeof`, length): another version of the app may have written it. Small one-word preferences: `setPref(key, value)`, read `store.get('prefs')`.
Other helpers: `findAlias(id)`, `findNumber(id)`, `findMailbox(id)`, `findIdentity(id)`, `membersOf(identityId)`, `listMessages({ addressIds })`, `getMessage(id)`, `listTexts(numberId)`, `listCalls(numberId)`.
The store lists carry every field of the server lists, so do not load a list a second time: an alias has `enabled`, `oneShot`, `usedUp`, `received`, `refused`, `expiresAt`, `blocks`;
an inbox has `status`, `paidUntil`, `unread`, `refused`, `blocks`, `retentionDays`; a number has `status`, `paidUntil`, `sms`, `voice`, `voicemail`, `retentionDays`, `forwardPhoneId`, `forwardTexts`, `forwardCalls`;
a call has `voicemail`. Change them with `updateAlias(id, { enabled, oneShot, mailboxId, label })` and `updateNumber(id, { voicemail, retentionDays, … })`.

## 3. Extension points (`lib/registry.js`)

A function that returns `null` adds nothing. A part that throws is left out; the error shows in the console.
`item` of a row: `{ kind, id, value, display, label, off, identityId, identityName, persona, extra, raw }` (`raw` = the store object).
For the kind `identity`: `{ kind, id, name, note, persona, extra, raw }`.

```js
// A screen. The file loads on first use. signedOut: true = also without an account (then on a plain page).
// Options: signedOut, title (browser tab), nav (id of the menu item to mark; found from the path when left out).
registerRoute('/stats/:kind', () => import('./stats/screen.js'), { title: 'My stats' });
// "Do not track what I read": a file request tells the server which page was opened. For such a page,
// import the screen at the top of your file and let the loader give the loaded function.
registerRoute('/help/:page', () => helpScreen, { signedOut: true, title: 'Help' });

// A place in the sidebar. Orders: Home 10, Mail 20, Aliases 30, Numbers 40, Funds 50, Settings 90.
// Phone: the bottom bar holds five places. With more, it shows the first four and "More"; "More" lists
// the rest (Funds, Help, …, Settings). more: true = always under "More" on a phone.
registerNavItem({ id: 'stats', label: 'My stats', icon: 'group', path: '/stats', order: 60, more: true });

// One more entry in the "…" menu of a row. kind: 'alias' | 'number' | 'inbox' | 'identity'.
// danger: true puts it under the line, next to Delete. For an identity the entry is in "More" on its screen.
registerRowAction('alias', (item) => (item.off ? null : { label: 'Block a sender', icon: 'shield', run: () => openBlockList(item) }));
// A small mark after the label of a row (for an identity: on its Home card and its screen).
// Text with an optional icon. Not a button, not a link. Never colour alone.
registerRowBadge('alias', (item) => (item.extra.leak ? tag('Possibly leaked', 'warn') : null));

// One more entry in "More actions" of an open email. alias is null for mail to the inbox address.
registerMessageAction((message, alias) => (alias ? { label: 'Block this sender', icon: 'shield', run: () => block(message, alias) } : null));
// A panel between the head and the text of an open email. message = { id, at, direction, meta: { from, to, subject, deliveredTo }, body: { text, html } }.
registerMessagePanel((message, alias) => { const code = findCode(message.body.text); return code ? codeCard(code) : null; });

// Something under the words of one text. text = { id, at, direction, peer, body, status }.
registerTextAddon((text, number) => { const code = findCode(text.body); return code ? codeChip(code) : null; });
// Something under one line of the call list. call = { id, at, direction, peer, status, seconds }.
registerCallAddon((call, number) => (call.voicemail ? playButton(call) : null));

// A section on Settings. Orders: Passkeys 10, Sessions 20, Theme 30, What the server sees 40, This browser 90, Delete account 100.
registerSettingsSection({ id: 'export', title: 'Download my data', lede: 'One encrypted file.', order: 60, render: ({ scope }) => exportPart(scope) });
// A block on Home. The counts are 20, the lists are 30: below 20 = above the counts (warnings), above 30 = at the end.
// Return a region(); when it paints nothing, the block takes no space.
registerHomeSection({ id: 'warnings', order: 15, render: ({ scope }) => region(scope, store, ['balance', 'numbers'], warnings) });
// A tab on the screen of one number (Texts 10, Calls 20, Settings 90), and a section in its Settings tab
// (Label 10, Forwarding 20, Identity 30, Random identifiers 40, Old texts 50, Renewal 80, Release 100).
registerNumberTab({ id: 'voicemail', label: 'Voicemail', order: 30, render: ({ number, scope }) => voicemailList(number, scope) });
registerNumberSetting({ id: 'voicemail', title: 'Voicemail', order: 25, render: ({ number }) => voicemailSwitch(number) });

// A link on the start page for people without an account, under the buttons (the route needs signedOut: true).
registerWelcomeLink({ id: 'open-export', label: 'Open an export file', path: '/open-export', order: 60 });
// An icon button in the top bar of the phone layout, before the gear. Room for two. Give the same action a key for wide screens.
registerTopBarAction({ id: 'jump', label: 'Search', icon: 'search', run: () => openQuickJump() });

// One key for the whole app. It does nothing in a field, with a dialog or a menu open, or with Ctrl, Alt, Command.
// Options: signedOut: true = also without an account. Each key can be taken one time: tell the owner which one you take.
registerGlobalKey('/', () => openQuickJump());
```
`render` of a number setting runs again each time the number changes: keep it cheap, and do not fetch in it.
The feature files load before the sign-in state is known. If one of them fails to load, the app starts without all of them and says so.
Working examples: `features/first-steps.js`, `features/home-warnings.js` (Home sections), `features/code-helper.js` (panel, text part),
`features/leak-hint.js` (row mark, panel), `features/test-tools.js` (Settings section), `e2e/fixtures/zz-e2e.js` (every point).

## 4. The look

Warm paper, ink, one deep green. Calm and dense. It must not look like a different app inside the app.

- **No new colours. No new font sizes. No new CSS file. No `style` attribute for looks.**
  If a feature truly needs a style that does not exist, ask the owner. The owner adds it to `web/css/features.css`
  in a block for your feature, with classes named `f-<feature id>-…`. (`style` is fine for a computed value, such as the width of a bar.)
- Tokens (`css/tokens.css`), light and dark by themselves: surfaces `--bg`, `--surface`, `--sunken`; text `--ink`, `--ink-2`, `--ink-3`;
  lines `--line`, `--line-2`; `--accent`, `--accent-wash`; states `--warn`, `--warn-wash`, `--danger`, `--danger-wash`.
- Space scale: `--s-1` 4px, `--s-2` 8, `--s-3` 12, `--s-4` 16, `--s-5` 24, `--s-6` 32, `--s-7` 48. Corners: `--r-md` 6px, `--r-lg` 8px.
- Type: headings are serif (`h1`–`h3` get it by themselves). Interface text is sans, 15px. **Addresses, numbers, amounts, codes
  and keys are mono**: class `mono`. Sizes: `small` (13px), `tiny` (12px). Tones: `muted`, `faint`, `strong`.

| Classes to reuse | For |
|---|---|
| `page`, `page-narrow` (max 46rem), `page-head` | the frame of a screen: always the outermost element |
| `section`, `section-head`, `section-title`, `section-lede` | a titled block (`section()` makes it) |
| `sheet`, `sheet-pad` | a bordered surface; `sheet-pad` adds padding |
| `stack` + `stack-1…6`, `row` + `row-2`, `row-wrap`, `row-between`, `row-end`, `row-top`, `grow` | spacing; never margins by hand |
| `cards`, `grid-2` | a grid of `sheet sheet-pad` cards; two columns that become one on a phone |
| `prose`, `read` | long text to read (lists get their marks back); a 62-character line |
| `item-list` > `li.phone-row` > `item-icon`, `item-main` (`item-value`, `item-sub`), `item-actions` | a list of things with actions (see Passkeys in `screens/settings.js`) |
| `switch-row` | a line with text on the left and a `toggle()` on the right |
| `kv` (`dl` with `dt`/`dd`) | pairs such as Price / Renews on |
| `tag` + `tag-ok`, `tag-warn`, `tag-danger`; `badge` | a state word; a count |
| `callout callout-info` and so on, `hint`, `form-error`, `danger-zone` | notes, help under a field, an error, the block for a delete action |
| `truncate`, `break`, `nowrap`, `sr-only` | long values; text only for screen readers |

- **Phone (720px and less)**: one column; no sideways scroll at 360px; every target 44px high (buttons and menu entries get this by themselves);
  long addresses use `break` or `truncate`; a dialog fills the width. Test at 390 x 844 and 360 x 640.
- **Keyboard**: everything works with Tab, Enter, Space, Escape and the arrow keys. Use real `button`, `a`, `input` (never a `div` with a click).
  Each icon-only button has a name (`iconButton(name, label)`). Each field has a label. Do not remove the focus ring.
  After a dialog closes, the focus goes back by itself. One `h1` per screen (`pageHeader`); sections use `h2`.
- **Never colour or a picture alone**: always the word next to it ("Off", "Paused", "Forwards to real phone").
  **Motion**: only the short fades that exist. The app follows "reduce motion" by itself. No new animation without the owner.

## 5. The words

Simple English for people who are not technical. Short sentences. Active voice. One word for one thing, everywhere.

**Names are very simple and say what the thing is or does.** (The owner's rule.)
- A name of a feature, a button, a page or a state is short and plain, with no jargon: "Stop after the first mail", not "one-shot";
  "Delete old messages automatically", not "retention"; "Used up", not "consumed".
- Next to a control: one line of explanation at most. A longer explanation goes behind a "why?" button, into Help, or into the tutorial.
- The names that the owner chose stay exactly as they are: "Random identifiers generator", "Identity", "Who leaked me",
  "Possibly leaked", "Test my recovery key", "Download my data", "My stats", "Burn".

| Say | Meaning | Do not say |
|---|---|---|
| inbox | a place that holds mail, with its own address | mailbox, account, folder |
| alias | an extra address that delivers to an inbox | mask, forwarder, burner address |
| number | a phone number from this service | VoIP number, line, DID |
| real phone | the person's own phone, linked for forwarding | device, mobile, verified number |
| identity | a named **group** of aliases and numbers. Nothing else. Its state: On, Off, Burned. | persona, profile, account, group (alone) |
| random identifiers | the generated name and address; the card is the "Random identifiers generator" | made-up details, identity, persona, fake identity, profile |
| label | the private name of an item | name, title, tag |
| recovery key | the long key that opens the account | password, seed, secret, backup code |
| passkey | sign-in with fingerprint, face or device PIN | security key, WebAuthn, biometric login |
| funds / Add funds | the screen and the act of paying in | top up, deposit, wallet, recharge |
| credit, balance | money on the account: "$12.40 of credit", "Balance" | credits, tokens, coins, points |
| turn on / turn off | an alias, forwarding, a setting | enable, disable, activate, toggle, mute |
| used up | an alias that stopped after its one mail ("Stop after the first mail", "One mail only") | one-shot, burned, expired, consumed |
| possibly leaked | an alias that got mail from a sender it does not know. Always with "possibly". | leaked, compromised, breached |
| code | a sign-up or login code found in a text or an email | OTP, token, 2FA code, PIN |
| paused | an inbox or a number that waits for funds | suspended, frozen, inactive, expired |
| delete | remove for good: mail, an alias, an inbox, an identity, the account | remove (for these), erase, destroy, trash |
| remove | take away a link, not data: a passkey, a real phone, random identifiers | delete (for these), unlink, revoke |
| release (a number) | give a number back to the provider, for good | delete, cancel, drop |
| sign in / sign out | start and end a session | log in, login, log out, logoff |
| lock / unlock | this tab forgets the key; the session stays | sign out, suspend, hide |
| text | an SMS | SMS, message (alone means email) |
| forward | send texts or calls on to the real phone | redirect, relay, route |

Tone:
- Say what happened and what to do next. "That did not work. Try again." Not "Oops!", not "Error 500", not "Invalid input".
- No blame, no jokes, no exclamation marks, no "please", no "simply", no "just".
- Buttons are verbs that say the result: "Delete alias", "Release number", "Make identity". Not "OK", "Yes", "Submit".
- Before anything that cannot be undone: say what is lost and that it cannot come back. The confirm button repeats the verb.
- Be honest about limits. Never promise "anonymous", "untraceable" or "secure". Say what the server or a provider can see.
- Sentence case: "Add funds", not "Add Funds". Screen names keep their capital in a sentence: Home, Mail, Settings.
- Money: always `money(credits)`: "$12.40", "$0.03". Dates: `dayText()`: "Nov 11, 2026". Counts: `plural(n, 'message')`.

Ten real strings from the app (copy the style):
1. `Alias turned off. Mail to it is refused.`
2. `Only you see this. It is encrypted.`
3. `Remote images are blocked to stop tracking.`
4. `This inbox is paused. It receives no mail.` + link `Add funds`
5. `The number goes back to the provider. Its texts and its call log are deleted. You cannot get the number back.`
6. `This identity forwards to your real phone “My mobile”: texts and calls.`
7. `These identifiers are made up. Do not use them where the law requires your real name and address, for example at a bank or on a government form.`
8. `Its aliases and numbers stay. They are then not in an identity.`
9. `This tab forgets your key. To sign in again you need a passkey or your recovery key.`
10. `Cannot reach the server. Check your connection, then try again.`

## 6. Security rules for UI code

The page policy is `script-src 'self'`: no inline script, no `onclick=` attribute, no `eval`, no remote script, image or font.

1. Text from the server or from decrypted data goes into the page with `h()` or `textContent`. Never `innerHTML`, never `insertAdjacentHTML`.
2. Decrypted data, keys, addresses and numbers never go into a URL, `localStorage`, `sessionStorage`, a cookie, `console.log` or an error report.
   URLs hold route names and random ids only. `localStorage` holds the theme and nothing else.
3. What must outlive the tab is saved **encrypted** with the helpers in part 2. The server gets only what `docs/API.md` lists.
4. No request to another site. No `fetch` to a URL that came from a message. A link to an outside site is a normal
   `<a target="_blank" rel="noopener noreferrer">`; say where it goes.
5. Email HTML shows only through the sandboxed frame of the mail screen (`lib/sanitize.js`). Do not build a second viewer.
6. Payment routes (`/api/pay/*`) go through `payApi` (no cookie). Never call them with `api`.
7. Do not track: no counters of what a person opens, no time stamps of reading. Counts for a stats screen are made in the browser from data that is already there.
8. If the server must learn something new for your feature, write exactly what and why in `docs/SECURITY.md` and tell the coordinator first.

## 7. Run and test

```sh
cd identity-hub && npm start            # http://localhost:8080 in test mode (simulated mail, phone and payment)
npm test                                # server and library tests (node:test)
npm run test:e2e                        # browser tests: own server, own data folder, one line per file
node e2e/run.mjs registry identities    # only the test files whose name has one of these words
```
The browser tests need Playwright from a global install (`npm install -g playwright`, `NODE_PATH` set to the global folder). It is not in `package.json`.

Add a test: a new file `e2e/tests/NN-name.test.mjs`. It runs by itself the next time.
```js
import { signUp, seedAccount, inApp, assert } from '../lib.mjs';
export default async function (t) {
  const s = await t.open({ width: 390, height: 844 });      // a new browser window; a width under 721 is a phone
  await signUp(s.page, t.base);                              // a new account; gives back the recovery key
  const ids = await seedAccount(s.page);                     // inboxes, aliases, mail, numbers, texts, a call
  await s.page.goto(t.base + '/stats');
  await s.page.getByRole('heading', { name: 'My numbers' }).waitFor();
  assert(await s.page.locator('.item-row').count() > 0, 'the list is empty');
  t.ok('the stats screen lists aliases');                    // one checked fact
}
```
- Helpers (`e2e/lib.mjs`): `signUp`, `signIn(page, base, key)`, `signOut`, `seedAccount`, `addCredit(page, dollars)`, `lastPhoneCode(page)`,
  `inApp(page, ({ data, phone, api, store, mail, identities, session }, arg) => ..., arg)` runs code inside the app with its own modules.
- A test fails when the page logs an error. An error that the test causes on purpose: `s.allow(/pattern/)`.
  Before a test counts requests ("this makes no request"), call `await settle(page)`: the app then finished its background work.
  Find things by role and name (`getByRole('button', { name: 'Delete alias' })`), as a person does. No screenshots in the suite.
- Other server settings for one file: `export const server = { PHONE_PROVIDER: 'off' };` gives that file its own server.
- Every feature needs: one test on a desktop size, one check at 390px (no sideways scroll, 44px targets), one path with the keyboard only.
  Pure logic (parsers, counters) gets a `node:test` file in `test/`, so it runs without a browser.
