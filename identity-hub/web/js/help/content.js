// The words of the in-app Help: the "Why this exists" page, the privacy tips, the short
// "why?" explanations (with their groups for the Help page), the tutorial steps, and the word list.
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
//   the rest of the app: inbox, alias, number, identity, random identifiers, recovery key,
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
    doThis: 'Keep your recovery key in a safe place, and test your copy with "Test my recovery key" in "Settings".',
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
    title: 'Use random identifiers only where the law permits it',
    doThis: 'Use random identifiers only on forms that have no legal need for your real name and address.',
    why: 'Random identifiers keep your real name and address out of one more database. The street and the person do not exist.',
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
    why: 'Data that does not exist cannot leak. The server writes over deleted data. {app} can also delete old mail and old texts for you.',
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
    id: 'block-before-you-turn-off',
    title: 'Block one sender before you turn off an alias',
    doThis: 'Select "Block this sender" when one sender is the problem and you still need the alias.',
    why: 'A block refuses the mail of one sender only. The website that you gave the alias to can still reach you.',
    limit: 'A sender can write again from a different address. Then turn off the alias.',
  },
  {
    id: 'one-mail-for-a-code',
    title: 'For one sign-up code, stop after the first mail',
    doThis: 'Select "Stop after the first mail" when a website must send you one code only.',
    why: 'The alias turns itself off after that mail. If the website sells the address later, {app} refuses the unwanted mail.',
    limit: 'A second mail from the website is refused too. You can turn the alias on again for one more mail.',
  },
  {
    id: 'burn-when-you-are-finished',
    title: 'Burn an identity when you are finished with a website',
    doThis: 'Select "Burn" on an identity that you do not need any more.',
    why: 'Burn turns off its aliases, deletes their mail, and releases its numbers. Then no data of that website stays in your account.',
    limit: 'You cannot undo a burn. An earlier backup of the server can still hold the deleted data for some time.',
  },
  {
    id: 'download-your-data',
    title: 'Keep your own copy of your data',
    doThis: 'Select "Download my data" from time to time, and keep the file apart from your recovery key.',
    why: 'The file is a copy that you can read with your recovery key. If the server stops, you still have your mail and your texts.',
    limit: 'A person who has the file and your recovery key can read everything in it.',
  },
  {
    id: 'before-you-release-a-number',
    title: 'Take a number out of your accounts before you release it',
    doThis: 'Before you release a number, remove it from each website account that uses it.',
    why: 'A released number goes to a different person later. That person then gets the sign-in codes that a website sends to the number.',
    limit: 'This is true for each phone number. On a server that uses its own phone, the next person can get the number soon.',
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
    title: 'Why random identifiers?',
    paragraphs: [
      'Random identifiers are a random name and address for sign-up forms. The city, the state and the ZIP code are real. The street and the person are not.',
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
      'Your browser makes secret values. The payment system signs them but cannot see them. Then your browser gives them to your account, and they become credit.',
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
  'mail-colours': {
    title: 'Why do the colours of an email look different?',
    paragraphs: [
      'Most senders make their emails for a white page. In the dark theme, {app} changes the colours of an email. White paper becomes dark, and dark text becomes light.',
      'A red button stays red and a blue link stays blue, but lighter or darker. Pictures can look a little dull.',
      'Select "Original colours" above the email to see it as the sender made it, on white paper. "Plain text" shows only the words.',
      'You can change the theme in Settings. The app starts in the dark theme.',
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
  'block-sender': {
    title: 'What does a block do?',
    paragraphs: [
      '{app} refuses mail from a blocked sender to this one address. Your other addresses still get mail from that sender.',
      'You can block one address, or all addresses of a domain. A block of a domain also covers its subdomains.',
      'The server does not store a blocked sender in plain form. Only your browser can show the list.',
      'A sender can still write from a different address. To take a block away, open "Blocked senders" and select "Unblock".',
    ],
  },
  'auto-delete': {
    title: 'What does automatic deletion do?',
    paragraphs: [
      'The server deletes old mail of an inbox, or old texts of a number, by itself. It does this one time each hour, also when {app} is closed.',
      'It is off until you turn it on. For an inbox, select "Delete old mail automatically". For a number, use "Old texts".',
      'A deleted message cannot be brought back. The copies of mail that you sent are deleted too.',
      'The person who runs the server can keep backups. An earlier backup can still hold a deleted message for some time.',
    ],
  },
  'end-date': {
    title: 'What is an end date?',
    paragraphs: [
      'An alias with an end date stops by itself. After that date it refuses mail, like an alias that is off.',
      'The mail that you have stays. To make the alias work again, set a later date or select "Remove the end date".',
      'Use an end date for a thing that ends, for example a trial or a trip.',
      'The server does the refusing, so the server knows the date.',
    ],
  },
  'first-mail-only': {
    title: 'Why stop after the first mail?',
    paragraphs: [
      'With "Stop after the first mail", an alias gets one mail and then turns itself off. The app then shows "Used up".',
      'Use it for one sign-up code. If the website sells the address later, the unwanted mail is refused.',
      'If a website sends two mails, the second one is refused. Select "Turn on again" to get one more mail.',
      'Select "Make it a normal alias" when you want all its mail.',
    ],
  },
  'refused-mail': {
    title: 'What does the refused count mean?',
    paragraphs: [
      'The count shows how many mails an address refused. An address refuses mail when it is off, used up or past its end date, or when it blocks the sender.',
      'The server keeps only this number. It does not keep the sender, the time or the content of a refused mail.',
      'A count that grows on an alias that is off tells you that senders still use the address.',
      'The count does not go back to zero. It goes away when you delete the address.',
    ],
  },
  'possibly-leaked': {
    title: 'What does possibly leaked mean?',
    paragraphs: [
      'An alias normally gets mail from one sender: the website that you gave it to. The app saves that first sender with the alias, encrypted.',
      'When mail comes from a different sender, the app shows "Possibly leaked". The address was possibly passed on, sold or stolen.',
      'It is only a hint. A company can use several sender names, and the From line of a mail can be forged.',
      'Your browser works this out. Select "This sender is expected" or "Turn off this alias".',
    ],
  },
  'who-leaked-me': {
    title: 'How does "Who leaked me" work?',
    paragraphs: [
      'The page lists each alias that got mail from a sender that it does not know. It names that sender.',
      'Your browser reads your newest 1,000 mails and compares the senders. The server cannot do this work, because it cannot read who wrote a mail.',
      'A hint is not proof. A company can use several sender names, and the From line of a mail can be forged.',
      'When you select "This sender is expected", the app saves that sender with the alias, encrypted.',
    ],
  },
  'my-stats': {
    title: 'How are my stats counted?',
    paragraphs: [
      'Your browser reads your newest 1,000 mails and counts them. It counts again each time you open the page.',
      'Nothing is saved, in your browser or on the server. The server cannot count senders, because it cannot read who wrote a mail.',
      'A sender name can be forged, so this is a count of what the mails say.',
      'The server keeps two plain numbers for each address: the mails that it got and the mails that it refused.',
    ],
  },
  'code-helper': {
    title: 'How does the app find a code?',
    paragraphs: [
      'When a mail or a text has a sign-up code, the app shows the code with a "Copy" button.',
      'Your browser finds the code in the message after it decrypted the message. The code is sent nowhere.',
      'The helper is careful. It shows a number only when a word such as code or verification is near it. So it can miss a code.',
      'A code in a text passed through the phone company. Use codes, but do not use texts for secrets.',
    ],
  },
  newsletter: {
    title: 'Why does {app} not open unsubscribe links?',
    paragraphs: [
      'An unsubscribe link comes from a stranger. A visit to it tells the sender that a person reads the address.',
      'So {app} never opens such a link. "Unsubscribe by email" sends a real mail from your alias to the address that the newsletter names.',
      'The sender then learns that this alias is in use. {app} keeps a copy of that mail in "Sent".',
      'If the newsletter keeps coming, turn off the alias or select "Block this sender".',
    ],
  },
  burn: {
    title: 'What does a burn do?',
    paragraphs: [
      '"Burn" ends an identity for good. It turns off its aliases and deletes all mail that they got and sent.',
      'It releases its numbers and deletes their texts, their calls and their voicemail. You cannot get a released number back.',
      'A burn cannot be undone. The app shows the exact list first, and you must type the word "BURN".',
      'The identity stays, with the mark "Burned". An earlier backup of the server can still hold the deleted data for some time.',
    ],
  },
  export: {
    title: 'What is in my data file?',
    paragraphs: [
      '"Download my data" makes one encrypted file with a copy of your data. Your browser builds it. The server never sees the plain contents.',
      'Your recovery key opens the file, on the page "Open an export file". Keep the key and the file in two different places.',
      'Not in the file: working numbers, your credit, and your passkeys. You cannot load the file back into an account.',
      'A person who has two files can see that they are from one account. Without the key, that person cannot read them.',
    ],
  },
  voicemail: {
    title: 'How private is voicemail?',
    paragraphs: [
      'Voicemail is off until you turn on "Take voicemail". Then a caller who does not reach you can leave a message.',
      'The phone company plays the greeting and records the message. So the phone company hears the whole message.',
      '{app} stores an encrypted copy that only your browser can play. Then {app} deletes the recording at the phone company.',
      'The phone company can keep its call records, and its own backups for some time. {app} cannot delete those.',
    ],
  },
  'own-domain': {
    title: 'Why is my own domain worse for privacy?',
    paragraphs: [
      'Each website sees the domain of the alias that you give it. If only you use that domain, all addresses on it belong together.',
      'Websites that compare their lists can then tell that the aliases are from one person. A domain that many people share does not show this.',
      'Your own domain helps when a website refuses alias addresses. Use it for those websites only.',
    ],
  },
  'quick-jump': {
    title: 'How does the search work?',
    paragraphs: [
      'Press "/" or Ctrl+K, type a few letters, and press Enter. On a phone, select "Search" in the top bar.',
      'The search finds your identities, aliases, numbers, inboxes and pages. It looks at names, labels, addresses, numbers and notes.',
      'Your browser searches in the data that it has open already. It asks the server for nothing, and it keeps no history.',
    ],
  },
  'username-password': {
    title: 'Why make a username and a password here?',
    paragraphs: [
      'Many websites want a username and a password too. Your browser can make both at random, so that no two websites get the same ones.',
      'The username is saved with the random identifiers, encrypted. Only you can read it.',
      '{app} never saves the password. Copy it into your password manager at once. When you close the card, the password is gone.',
    ],
  },
  'identity-look': {
    title: 'What do the door, the colour and the history show?',
    paragraphs: [
      'The door shows the state of an identity: "On", "Off" or "Burned". The word is always next to the picture.',
      'An identity is on when one of its aliases is on, or one of its numbers works.',
      'The colour is a dot next to the name, to find the identity fast. The history is a short list of days, for example the day of the first mail.',
      'Your browser saves all of this with the identity, encrypted. The server cannot read it.',
    ],
  },
  'home-warnings': {
    title: 'Why does Home show a warning?',
    paragraphs: [
      'Home warns you in two cases. One: the renewals of the next 7 days cost more than your credit. Two: an inbox or a number is paused.',
      'A paused inbox gets no mail. A paused number gets no texts and no calls, and {app} releases it after some days.',
      'Add funds to stop this. Your browser works the warning out from data that it has already.',
    ],
  },
  'recovery-test': {
    title: 'Why test my recovery key?',
    paragraphs: [
      'Your recovery key is the way back into your account when your passkeys are gone. Nobody can reset it.',
      'A copy with one wrong character opens nothing. "Test my recovery key" tells you now if your copy is right.',
      'The test runs in this browser. The key is not sent to the server, and it is not saved.',
      'If your copy is wrong, do not sign out of this browser. Find a correct copy first.',
    ],
  },
  'own-phone': {
    title: 'Where do the numbers of this server come from?',
    paragraphs: [
      'Here, each number is a SIM card in a phone of the person who runs the server. An app on that phone sends and gets your texts.',
      'These numbers do texts only, no calls.',
      'When that phone is off, {app} shows "Phone offline", and a text that you send shows "Waiting for the phone". After one hour it fails, and you get the credit back.',
      'The phone company of the SIM card sees each text. Other people had the number before you, so it can get texts for them.',
    ],
  },
  'own-phone-calls': {
    title: 'Why can this number not make or get calls?',
    paragraphs: [
      'This number is a SIM card in a phone of the person who runs the server. The app on that phone handles texts only.',
      'So a call to this number rings on that phone, and {app} does not see it. This number has no call list and no voicemail.',
      'The person who runs the server can set call forwarding on the SIM card. The phone network then sends each call to one other number.',
      'The phone company then knows that other number. {app} keeps no record of these calls.',
    ],
  },
};

// ---- The groups of the "why?" explanations on the Help page ----
// Each key of WHY is in one group. The Help page shows the groups in this order.
export const WHY_GROUPS = [
  { title: 'Basics', keys: ['recovery-key', 'passkey', 'inbox-vs-alias', 'balance', 'payments', 'test-mode', 'quick-jump'] },
  { title: 'Mail', keys: ['alias-off', 'end-date', 'first-mail-only', 'block-sender', 'refused-mail', 'newsletter', 'remote-images', 'mail-colours', 'code-helper', 'own-domain', 'my-stats'] },
  { title: 'Numbers', keys: ['link-phone', 'phone-by-call', 'forwarding', 'delivery-status', 'voicemail', 'own-phone', 'own-phone-calls'] },
  { title: 'Identities', keys: ['identity', 'identity-look', 'made-up-details', 'username-password', 'burn'] },
  { title: 'Safety', keys: ['recovery-test', 'possibly-leaked', 'who-leaked-me', 'deleting', 'auto-delete', 'export', 'home-warnings'] },
];

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
//   list      optional: [{ name, line }]. The step only shows this list: there is nothing to do
//             and nothing to prove. name is the real name of the thing in the app.
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
    title: 'Make random identifiers',
    what: 'Random identifiers are a random name and address for sign-up forms. The street and the person do not exist.',
    why: 'Some websites ask for a name and an address that they do not need. Do not use random identifiers where the law requires your real ones.',
    doIt: 'Open the menu of your alias, select "Random identifiers generator", then select "Make random identifiers".',
    done: 'Your alias has random identifiers.',
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
    id: 'more',
    title: 'More things you can do',
    what: 'Here are more things that {app} can do. Each one has a simple name.',
    why: 'You do not need them on the first day. Read the list now, so that you know where to look later.',
    doIt: 'Try them later, when you need them.',
    done: 'You read the list.',
    needs: null,
    costKey: null,
    skipNote: null,
    offNote: null,
    list: [
      { name: 'Block this sender', line: 'In an open mail, under "More actions". The mail of that sender is then refused.' },
      { name: 'Delete old mail automatically', line: 'In the menu of an inbox. Deleted mail cannot come back.' },
      { name: 'Set an end date', line: 'In the menu of an alias. After that date the alias refuses mail.' },
      { name: 'Stop after the first mail', line: 'A choice when you make an alias. Good for one sign-up code.' },
      { name: 'Burn', line: 'Ends an identity for good: its mail, its texts and its numbers go. You cannot undo it.' },
      { name: 'Download my data', line: 'In "Settings". One encrypted file that your recovery key opens.' },
      { name: 'Voicemail', line: 'In the settings of a number. The phone company hears each message.' },
      { name: 'My stats', line: 'A link on "Home". It shows which alias gets the most mail.' },
      { name: 'Who leaked me', line: 'A link on "Home". It shows aliases with mail from a sender that they do not know.' },
      { name: 'Search', line: 'Press "/" or Ctrl+K and type a few letters to go to an alias, a number or a page.' },
      { name: 'Test my recovery key', line: 'In "Settings". It tells you if your copy of the key is right.' },
    ],
  },
  {
    id: 'finish',
    title: 'You are done',
    what: 'You know the main parts of {app} now: inboxes, aliases, identities, numbers and credit.',
    why: 'Each part has a small "Why?" button. "Help" has the privacy tips and the limits.',
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
  { word: 'random identifiers', meaning: 'A random name and address for sign-up forms. The "Random identifiers generator" makes them.' },
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
  { word: 'block', meaning: 'Refuse the mail of one sender on one address.' },
  { word: 'end date', meaning: 'The day after which an alias refuses mail.' },
  { word: 'used up', meaning: 'An alias that turned itself off after its one mail.' },
  { word: 'possibly leaked', meaning: 'An alias that got mail from a sender that it does not know. This is a hint only.' },
  { word: 'burn', meaning: 'End an identity for good. Its aliases go off, their mail is deleted, and its numbers are released.' },
  { word: 'code', meaning: 'A sign-up or sign-in code that a website sends you in a mail or a text.' },
  { word: 'phone online, phone offline', meaning: 'On some servers a number is a SIM card in a phone. Offline means that this phone cannot send or get texts now.' },
];
