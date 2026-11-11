// The words of the in-app Help: the "Why this exists" page, the privacy tips, the short
// "why?" explanations, the tutorial steps, and the word list.
//
// Rules for this file:
// - Plain data only: strings, arrays, objects, and null. No HTML and no markdown.
//   The screens put each string into the page with textContent.
// - Two tokens. The screen replaces them before it shows a string:
//     {app}    the name of the product (never write the name itself in this file)
//     {price}  the real price from the server, written like $1.00 (tutorial steps only)
// - Every privacy fact comes from docs/SECURITY.md. No text here promises more than that file.
//   Where a fact has a limit, the limit is in the next sentence.
// - Simple words. Short sentences (25 words at most). The same word for the same thing as
//   the rest of the app: inbox, alias, number, identity, made-up details, recovery key,
//   passkey, funds (the page), credit (what you have), turn on, turn off, delete, release,
//   paused, sign in, sign out, lock, test mode.
// - A name in "quotation marks" is the exact text of a button, a page, or a label in the app.
//   If the app changes that text, change it here too.
// - test/web-help.test.js checks these rules.

// ---- "Why this exists" page ----
export const WHY_PAGE = {
  title: 'Why {app} exists',
  intro: 'Websites ask for your email address and your phone number. Many of them do not keep this data safe.',
  sections: [
    {
      heading: 'The problem',
      paragraphs: [
        'Websites lose your data in leaks. Some websites sell it. Then your address and your number go from one company to the next.',
        'You get spam and calls that you did not ask for. You cannot easily change your real address or your real number.',
        'There is a second problem. If you give the same address to ten websites, that address connects your ten accounts.',
      ],
      bullets: [],
    },
    {
      heading: 'How {app} helps',
      paragraphs: [
        'Give each website its own throwaway address. Keep your real address for the people that you trust.',
      ],
      bullets: [
        'Make one alias for each website. Mail to the alias lands in your inbox in {app}.',
        'When an alias gets unwanted mail, turn it off or delete it. Your other aliases keep working.',
        'Each message shows the alias that it came to. So you know which website leaked or sold your address.',
        'Get a number for texts and calls. Release the number when you do not need it.',
        'You sign up with no name, no email address and no phone number.',
        'You sign in with a passkey or with your recovery key. {app} has no passwords.',
        'You pay with Bitcoin or Monero. The server stores no link between a payment and your account.',
        '{app} keeps your stored mail and texts encrypted. Encrypted means: locked so that only you can read it.',
      ],
    },
    {
      heading: 'What {app} does not do',
      paragraphs: [
        '{app} lowers the damage of a leak. It does not hide you from everyone. Know these limits.',
      ],
      bullets: [
        'Mail and texts are not secret on the way to the server. The server sees each new message for a moment.',
        'The phone company sees the texts and the calls of your numbers.',
        'If you link a real phone, the server knows that phone number.',
        'If you lose your recovery key and all your passkeys, nobody can reset them. Your data is then lost.',
        'A website can still know you by other data that you give it, for example a payment card.',
      ],
    },
    {
      heading: 'Where to start',
      paragraphs: [
        'Do these steps in sequence. The tutorial shows you each step.',
      ],
      bullets: [
        'Keep your recovery key in a safe place.',
        'Add a passkey.',
        'Add funds, then make an inbox.',
        'Make one alias for the next website that asks for your email address.',
        'Read the privacy tips. Each tip tells you what to do, and why.',
      ],
    },
  ],
};

// ---- Privacy tips ----
// doThis: one short instruction. why: 1 to 3 short sentences. limit (optional): an honest limit.
export const TIPS = [
  {
    id: 'one-alias-each-website',
    title: 'One alias for each website',
    doThis: 'Make a new alias for each website.',
    why: 'If a website leaks or sells the address, only that alias gets the unwanted mail. You also see which website it was.',
    limit: 'An alias hides only your real address. A website can still know you by other data that you give it.',
  },
  {
    id: 'turn-alias-off',
    title: 'Turn off an alias that gets unwanted mail',
    doThis: 'Turn off the alias when unwanted mail arrives at it.',
    why: '{app} then refuses all mail to that alias. Your inbox and your other aliases keep working. You can turn the alias on again later.',
  },
  {
    id: 'keep-recovery-key',
    title: 'Keep the recovery key safe, and test it',
    doThis: 'Keep your recovery key in a safe place, and sign in with it one time as a test.',
    why: 'The recovery key opens your account on a new device. {app} shows it one time only. A test tells you that your copy is correct.',
    limit: 'Each person who has your recovery key can open your account. Keep it where other people cannot read it.',
  },
  {
    id: 'no-reset',
    title: 'Nobody can reset a lost recovery key',
    doThis: 'Keep a second copy of your recovery key in a different safe place.',
    why: 'The server never gets your recovery key, so the server cannot give it back. This is the price of data that the server cannot read.',
    limit: 'If you lose the recovery key and all passkeys that can unlock your data, your data is lost. Nobody can reset it.',
  },
  {
    id: 'add-passkey',
    title: 'Add a passkey',
    doThis: 'Add a passkey in "Settings".',
    why: 'A passkey signs you in with your fingerprint, your face or your device PIN. It works only on the real website of {app}, not on a copy.',
    limit: 'Some passkeys cannot unlock your data alone. With such a passkey, you still need your recovery key to read your data.',
  },
  {
    id: 'not-secret-on-the-way-in',
    title: 'Mail and texts are not secret on the way in',
    doThis: 'Do not use mail or texts for secrets.',
    why: 'Email and the phone network do not protect a message from end to end. The server sees each new message for a moment, then encrypts it for you.',
    limit: 'The server cannot read a stored message later. But a person who controls the server at that moment can read new messages.',
  },
  {
    id: 'think-before-you-link',
    title: 'A linked real phone is known to the server',
    doThis: 'Think before you link a real phone.',
    why: 'To forward calls and texts, the server must know your real phone number. The phone company sees it too. The link is optional.',
    limit: 'Without a linked real phone, your texts and calls stay in {app}. Then the server does not have your real number.',
  },
  {
    id: 'numbers-for-convenience',
    title: 'Numbers are for convenience, not for secrets',
    doThis: 'Use a number from {app} for sign-up codes and daily contact, not for secrets.',
    why: 'The phone company sees the numbers, the texts and the call records on its side. It keeps records under its own rules. {app} cannot change that.',
  },
  {
    id: 'made-up-details-and-the-law',
    title: 'Use made-up details only where the law permits it',
    doThis: 'Use made-up details only on forms that have no legal need for your real name and address.',
    why: 'Made-up details keep your real name and address out of one more database. The street and the person do not exist.',
    limit: 'Do not use them where the law requires your real name and address, for example at a bank or on a government form.',
  },
  {
    id: 'pay-first',
    title: 'Pay first, add the credit later',
    doThis: 'If you want less link by time, pay the invoice, close {app}, and open it again later.',
    why: 'The server keeps no link between a payment and an account. A changed server could compare the time of a payment with the time of new credit. {app} adds the credit the next time you open it.',
    limit: 'A wait lowers this risk. It does not remove the risk.',
  },
  {
    id: 'remote-images',
    title: 'Remote images are blocked',
    doThis: 'Read your mail in {app}, where remote images are blocked.',
    why: 'A picture in an email can sit on the server of the sender. When a mail program loads the picture, the sender learns that you opened the message, and when.',
    limit: 'Some messages look incomplete without their pictures. A link in a message can still tell the sender that you selected it.',
  },
  {
    id: 'delete-what-you-do-not-need',
    title: 'Delete what you do not need',
    doThis: 'Delete old mail, old texts, and aliases that you do not use.',
    why: 'Data that does not exist cannot leak. The server writes over deleted data. {app} can also delete the old texts of a number for you.',
    limit: 'The person who runs the server can keep backups. An older backup can still contain deleted data for some time.',
  },
  {
    id: 'lock-on-a-shared-computer',
    title: 'Lock the app on a shared computer',
    doThis: 'Select "Lock" when you leave the computer, and sign out when you are done.',
    why: 'Lock makes this browser tab forget your key. Nobody can read your mail in that tab until you unlock it.',
    limit: 'After a lock, you are still signed in. On a computer that other people use, sign out when you are done.',
  },
  {
    id: 'sent-mail-is-visible',
    title: 'Mail that you send is visible on the way out',
    doThis: 'Write only what the recipient and their mail company can read.',
    why: 'When you send mail, the server, the mail relay and the mail company of the recipient can read it. This is how email works. The recipient sees the address that you send from.',
  },
  {
    id: 'trust-the-server',
    title: 'Use a server that you trust',
    doThis: 'Use {app} on a server that you operate, or that a person you trust operates.',
    why: 'The encryption runs in code that the server sends to your browser. A dishonest server could send changed code. This is true for each web app of this type.',
  },
];

export const TIPS_NOTE = 'These tips are general advice. They are not legal advice. The law is different in each country.';

// ---- The small "why?" explanations ----
// Each one has 40 to 90 words in its paragraphs.
export const WHY = {
  'recovery-key': {
    title: 'Why a recovery key?',
    paragraphs: [
      'The recovery key is a long random secret. Your browser makes it when you make your account. It opens your account and unlocks your data on each device.',
      '{app} shows it one time. The server never gets it, so nobody can send it to you again. If you lose it and all your passkeys, your data is lost.',
      'Keep it on paper or in a password manager. There is no password that you choose, so nobody can guess one.',
    ],
  },
  passkey: {
    title: 'Why passkeys?',
    paragraphs: [
      'A passkey signs you in with your fingerprint, your face or your device PIN. Your device or your password manager keeps it. The server never gets it.',
      'A passkey works only on the real website of {app}. A copy of the website cannot use it.',
      'Some passkeys cannot unlock your data alone. Then {app} asks for your recovery key one time in each new browser session. Without the recovery key, such a passkey cannot open your data.',
    ],
  },
  'inbox-vs-alias': {
    title: 'Inbox or alias?',
    paragraphs: [
      'An inbox has its own address and keeps your mail. You read and write mail there. An inbox costs credit.',
      'An alias is one more address. Mail to an alias lands in one of your inboxes. An alias is free.',
      'Give each website its own alias. When an alias gets unwanted mail, turn it off or delete it. Your inbox stays as it is.',
    ],
  },
  identity: {
    title: 'Why identities?',
    paragraphs: [
      'An identity is a named group of aliases and numbers, for example "Facebook". It shows everything that you use for one website in one place.',
      'Only you see the names and the groups. Your browser encrypts them before they go to the server.',
      'An identity does not hide a link from the server. The server still knows that all your aliases and numbers belong to one account.',
    ],
  },
  'made-up-details': {
    title: 'Why made-up details?',
    paragraphs: [
      'Made-up details are a random name and address for sign-up forms. The city, the state and the ZIP code are real. The street and the person are not.',
      'Your browser makes them. Use them when a website asks for a name and an address that it does not need.',
      'Do not use them where the law requires your real name and address, for example at a bank or on a government form.',
    ],
  },
  'link-phone': {
    title: 'Why link a real phone?',
    paragraphs: [
      'A linked real phone can get the calls and the texts of your numbers. The link is optional.',
      'To send calls and texts on, the server must know your real phone number. The phone company sees it too.',
      '{app} sends a code to the phone before the link works. So nobody can link the phone of a different person.',
      'Without a linked real phone, your texts and calls stay in {app}.',
    ],
  },
  forwarding: {
    title: 'What is forwarding?',
    paragraphs: [
      'Forwarding sends the texts and the calls of a number on to your linked real phone. Without forwarding, they stay in {app}.',
      'Each forwarded text costs credit. A forwarded call costs credit for each minute. The app shows the prices next to the switches.',
      'The phone company sees forwarded texts and calls. When {app} forwards a call, your phone shows the number of the caller.',
    ],
  },
  payments: {
    title: 'Why are payments private?',
    paragraphs: [
      'You pay an invoice with Bitcoin or Monero. The invoice has no link to your account.',
      'Your browser makes secret credit tokens. The payment system signs them but cannot see them. Then your browser adds them to your account as credit.',
      'So the server stores no link between a payment and an account. A changed server could still compare the times. To lower this risk, pay first and add the credit later.',
    ],
  },
  'alias-off': {
    title: 'What happens when I turn off an alias?',
    paragraphs: [
      '{app} refuses all mail to an alias that is off. The sender gets an error message. The alias also cannot send mail.',
      'The mail that you have stays in your inbox. You can turn the alias on again at any time.',
      'Turn off first, delete later. A deleted alias is gone. Nobody can make the same address again, and you cannot make it again.',
    ],
  },
  deleting: {
    title: 'What happens when I delete?',
    paragraphs: [
      'Delete removes the data from the server. The server writes over it. You cannot get it back.',
      'A deleted alias leaves its mail in your inbox. A deleted inbox takes its mail and its aliases with it. A released number takes its texts and calls with it.',
      'You get no credit back. The person who runs the server can keep backups. An older backup can still contain deleted data for some time.',
    ],
  },
  'test-mode': {
    title: 'What is test mode?',
    paragraphs: [
      'Test mode is for trying {app}. The mail, phone and payment companies are simulated. No real money moves, and no message leaves the server.',
      'Use the "Test tools" to simulate incoming mail, texts, calls and payments.',
      'Do not keep real data on a server in test mode. A server in test mode is not made for real use.',
    ],
  },
  balance: {
    title: 'What is credit?',
    paragraphs: [
      'Credit is the money that you have in {app}. You add it on the page "Funds". The app shows it in US dollars, for example $1.00.',
      'Credit pays for inboxes, numbers, texts and calls. An inbox and a number cost credit again each 30 days.',
      'When your credit is too low to renew, the inbox or the number is paused. {app} keeps a paused inbox. {app} releases a paused number after some days.',
      'The server can see your credit. It cannot see which payment added it.',
    ],
  },
  'remote-images': {
    title: 'Why are remote images blocked?',
    paragraphs: [
      'A picture in an email can sit on the server of the sender. When a mail program loads the picture, the sender learns that you opened the message, and when.',
      '{app} does not load these remote images. {app} also shows each email in a closed frame that cannot run scripts.',
      'A link in a message can still tell the sender that you selected it.',
    ],
  },
  'delivery-status': {
    title: 'What do the words under a sent text mean?',
    paragraphs: [
      '"Sending": the phone company has the text and tries to deliver it.',
      '"Sent": the phone company passed the text on to the network of the other phone.',
      '"Delivered": the phone company reports that the text arrived. It does not tell you that the person read it.',
      '"Not delivered": the phone company reports that the text did not arrive. You get the credit for this text back.',
    ],
  },
  'phone-by-call': {
    title: 'Why can the code come by a call?',
    paragraphs: [
      'To link a real phone, {app} sends a code with 6 numbers from one of your numbers.',
      'Some numbers cannot send texts to all phones. In the United States, phone companies block texts from numbers that are not registered for this.',
      'A call still works. A voice says the code two times. The call costs the price of one minute of a call.',
    ],
  },
};

// ---- Tutorial ----
// One entry for each step, in this order.
//   what      what the thing is (1 or 2 sentences)
//   why       why it exists (1 or 2 sentences)
//   doIt      one instruction that names the real button
//   doItTest  optional: the instruction for test mode. Show it in place of doIt when the
//             server runs in test mode (GET /api/config gives dev: true).
//   done      one sentence for the completed step
//   needs     null | 'pay' | 'phone'. When that part of the server is off, grey the step out
//             and show offNote.
//   costKey   null | 'mailboxMonth' | 'numberMonth' | 'textOut': the name of the price in
//             GET /api/config. The step then has the token {price} and a skipNote for
//             "Skip this step".
//   skipNote  what a skip means, or null. Some free steps have one too.
//   offNote   one line for a step that is off, or null.
export const TUTORIAL = [
  {
    id: 'welcome',
    title: 'Welcome to {app}',
    what: 'This tutorial shows you the main parts of {app}, one step at a time. In each step you do the real thing.',
    why: 'You learn a thing faster when you do it one time. You can skip a step, and you can stop at any time.',
    doIt: 'Go to the next step when you are ready.',
    done: 'You started the tutorial.',
    needs: null,
    costKey: null,
    skipNote: null,
    offNote: null,
  },
  {
    id: 'recovery-key',
    title: 'Your recovery key',
    what: 'The recovery key is the long secret that {app} showed you when you made your account. It opens your account on each device.',
    why: 'The server never gets this key, so nobody can reset it. If you lose it and all your passkeys, your data is lost.',
    doIt: 'Find your copy of the recovery key now, and make sure that you can read it.',
    done: 'Your recovery key is in a safe place.',
    needs: null,
    costKey: null,
    skipNote: null,
    offNote: null,
  },
  {
    id: 'passkey',
    title: 'Add a passkey',
    what: 'A passkey signs you in with your fingerprint, your face or your device PIN.',
    why: 'A passkey is fast, and a copy of the website cannot use it. Keep your recovery key too.',
    doIt: 'Open "Settings" and select "Add a passkey".',
    done: 'You have a passkey.',
    needs: null,
    costKey: null,
    skipNote: 'You can skip this step if your device has no passkeys. You can still sign in with your recovery key.',
    offNote: null,
  },
  {
    id: 'funds',
    title: 'Add funds',
    what: '"Funds" is the page where you add credit. Credit pays for inboxes, numbers, texts and calls.',
    why: 'You pay with Bitcoin or Monero, and the payment has no stored link to your account. With no credit, you can still do each step that is free.',
    doIt: 'Open "Funds" and select "Add funds".',
    doItTest: 'Test mode uses pretend money: select "Add funds", then select "Simulate payment (test mode)".',
    done: 'You have credit.',
    needs: 'pay',
    costKey: null,
    skipNote: 'You can skip this step. With no credit, skip each step that shows a price.',
    offNote: 'Payments are turned off on this server, so you cannot add credit yourself.',
  },
  {
    id: 'inbox',
    title: 'Make an inbox',
    what: 'An inbox has its own address and keeps your mail. An inbox costs {price} for each 30 days.',
    why: 'You need one inbox before you can make an alias. Your mail stays in {app} and does not go to a different mail company.',
    doIt: 'Open "Mail" and select "New inbox".',
    done: 'You have an inbox.',
    needs: null,
    costKey: 'mailboxMonth',
    skipNote: 'You can skip this step if your credit is too low. The steps about aliases and mail then cannot work.',
    offNote: null,
  },
  {
    id: 'alias',
    title: 'Make an alias',
    what: 'An alias is one more address that delivers its mail to your inbox. An alias is free.',
    why: 'Give each website its own alias. Then one leak touches one alias only.',
    doIt: 'Open "Aliases" and select "New alias".',
    done: 'You have an alias.',
    needs: null,
    costKey: null,
    skipNote: null,
    offNote: null,
  },
  {
    id: 'first-mail',
    title: 'Get your first mail',
    what: 'Mail to your alias arrives in your inbox. The message shows which alias it came to.',
    why: 'This test shows you that the alias works before you give it to a website.',
    doIt: 'Send a message to your alias from a different mail account, then open "Mail".',
    doItTest: 'Select "Test tools", then select "Simulate incoming mail".',
    done: 'Your first message arrived.',
    needs: null,
    costKey: null,
    skipNote: null,
    offNote: null,
  },
  {
    id: 'alias-off',
    title: 'Turn an alias off',
    what: 'An alias that is off gets no mail. {app} refuses the mail, and the sender gets an error message.',
    why: 'This stops unwanted mail in one step. Your inbox and your other aliases keep working.',
    doIt: 'Open "Aliases" and turn off the switch next to your alias.',
    done: 'The alias is off, and you can turn it on again at any time.',
    needs: null,
    costKey: null,
    skipNote: null,
    offNote: null,
  },
  {
    id: 'identity',
    title: 'Make an identity',
    what: 'An identity is a named group of aliases and numbers, for example "Facebook".',
    why: 'It keeps everything that you use for one website in one place. Only you can read its name.',
    doIt: 'Open "Home" and select "New identity".',
    done: 'You have an identity.',
    needs: null,
    costKey: null,
    skipNote: null,
    offNote: null,
  },
  {
    id: 'made-up-details',
    title: 'Make made-up details',
    what: 'Made-up details are a random name and address for sign-up forms. The street and the person do not exist.',
    why: 'Some websites ask for a name and an address that they do not need. Do not use made-up details where the law requires your real ones.',
    doIt: 'Open the menu of your alias, select "Made-up details", then select "Make made-up details".',
    done: 'Your alias has made-up details.',
    needs: null,
    costKey: null,
    skipNote: null,
    offNote: null,
  },
  {
    id: 'number',
    title: 'Get a number',
    what: 'A number gets texts and calls in {app}. A number costs {price} for each 30 days.',
    why: 'Give this number to a website, and keep your real number for yourself. The phone company sees the texts and calls of this number.',
    doIt: 'Open "Numbers" and select "Get a number".',
    done: 'You have a number.',
    needs: 'phone',
    costKey: 'numberMonth',
    skipNote: 'You can skip this step. The next two steps need a number, so skip them too.',
    offNote: 'Numbers are turned off on this server, because it has no phone company.',
  },
  {
    id: 'first-text',
    title: 'Send your first text',
    what: 'You can send a text from your number. Each sent text costs {price}.',
    why: 'The other person then sees your number from {app}, not your real number.',
    doIt: 'Open your number, select "New text", and send a text to a phone that you have.',
    doItTest: 'Open your number, select "New text", and send a text to any number: in test mode it goes to the "Test tools".',
    done: 'You sent a text.',
    needs: 'phone',
    costKey: 'textOut',
    skipNote: 'You can skip this step. Your number gets texts also if you send none.',
    offNote: 'Numbers are turned off on this server, so you cannot send texts.',
  },
  {
    id: 'link-phone',
    title: 'Link a real phone (optional)',
    what: 'A linked real phone can get the calls and texts of your number. This step is optional.',
    why: 'To send them on, the server must know your real phone number, and the phone company sees it too. The text with the code costs {price}.',
    doIt: 'Open "Numbers" and select "Link a phone".',
    done: 'Your real phone is linked.',
    needs: 'phone',
    costKey: 'textOut',
    skipNote: 'Skip this step if the server must not know your real phone number. Your texts and calls then stay in {app}.',
    offNote: 'Numbers are turned off on this server, so you cannot link a real phone.',
  },
  {
    id: 'finish',
    title: 'You are done',
    what: 'You know the main parts of {app} now: inboxes, aliases, identities, numbers and credit.',
    why: 'Each part has a small "why?" link. "Help" has the privacy tips and the limits.',
    doIt: 'Open "Help" when you want to read more.',
    done: 'You can play this tutorial again from "Help" or from "Settings".',
    needs: null,
    costKey: null,
    skipNote: null,
    offNote: null,
  },
];

// ---- Word list for the Help page ----
export const WORDS = [
  { word: 'inbox', meaning: 'A place with its own address that keeps your mail.' },
  { word: 'alias', meaning: 'One more address. Its mail lands in one of your inboxes.' },
  { word: 'number', meaning: 'A phone number in {app} for texts and calls.' },
  { word: 'identity', meaning: 'A named group of aliases and numbers, for example "Facebook".' },
  { word: 'made-up details', meaning: 'A made-up name and address for sign-up forms.' },
  { word: 'recovery key', meaning: 'The long secret that opens your account. {app} shows it one time.' },
  { word: 'passkey', meaning: 'A way to sign in with your fingerprint, your face or your device PIN.' },
  { word: 'funds', meaning: 'The page where you add credit.' },
  { word: 'credit', meaning: 'The money that you have in {app}. It pays for inboxes, numbers, texts and calls.' },
  { word: 'turn on, turn off', meaning: 'An alias that is off gets no mail. You can turn it on again.' },
  { word: 'delete', meaning: 'Remove a thing from the server. You cannot get it back.' },
  { word: 'release', meaning: 'Give a number back. {app} then deletes its texts and calls.' },
  { word: 'paused', meaning: 'An inbox or a number that was not renewed, because the credit was too low.' },
  { word: 'sign in, sign out', meaning: 'Sign in opens your account in this browser. Sign out closes it.' },
  { word: 'lock', meaning: 'Make this browser tab forget your key. You stay signed in.' },
  { word: 'test mode', meaning: 'A mode for trying {app} with simulated companies and pretend money.' },
  { word: 'encrypted', meaning: 'Locked so that only you can read it.' },
];
