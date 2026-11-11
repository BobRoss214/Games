// Tests for the code helper (web/js/lib/codes.js). It runs here in Node.js exactly as in the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findCode } from '../web/js/lib/codes.js';

// [text, code to copy, code as written (if different)]
const POSITIVE = [
  // Texts from typical services
  ['Your verification code is 482913', '482913'],
  ['482913 is your Facebook confirmation code', '482913'],
  ['G-482913 is your Google verification code.', '482913', 'G-482913'],
  ["Your Apple ID Code is: 123456. Don't share it with anyone.", '123456'],
  ['Use 123 456 to verify your Instagram account.', '123456', '123 456'],
  ["Your WhatsApp code: 123-456\nYou can also tap on this link to verify your phone: v.whatsapp.com/123456\nDon't share this code with others", '123456', '123-456'],
  ["Amazon: Use 482913 to reset your password. Don't give this code to anyone.", '482913'],
  ['Your Uber code is 4829. Never share this code.', '4829'],
  ['Microsoft account security code: 1234567', '1234567'],
  ['PayPal: Your security code is 482913. Your code expires in 10 minutes. Please do not reply.', '482913'],
  ['[TikTok] 482913 is your verification code, valid for 5 minutes. To keep your account safe, never forward this code.', '482913'],
  ['Your Discord security code is: 482913', '482913'],
  ['LinkedIn: Your verification code is 482913.', '482913'],
  ['Telegram code: 48291', '48291'],
  ['Signal: Your code is: 482-913\nDo not share this code', '482913', '482-913'],
  ['Your X confirmation code is 482913.', '482913'],
  ['Snapchat code: 482913. Do not share it or use it elsewhere!', '482913'],
  ['Steam Guard code: R7K2M', 'R7K2M'],
  ['Your Stripe verification code is: 482-913. Do not share this code with anyone.', '482913', '482-913'],
  ['Coinbase: 4829137 is your verification code. Do not share it.', '4829137'],
  ['Your Lyft code is 4829', '4829'],
  ['Airbnb: Your verification code is 4829.', '4829'],
  ['Netflix: Your verification code is 482913', '482913'],
  ['Use 482913 as your login code for Slack.', '482913'],
  ['Twitch: 482913 is your verification code', '482913'],
  ['Dropbox security code: 482913', '482913'],
  ['GitHub: 482913 is your authentication code', '482913'],
  ['Zoom: 482913 is your one-time code', '482913'],
  ['Your one-time passcode (OTP) is 482913. It expires in 10 minutes.', '482913'],
  ['Your OTP is 482913', '482913'],
  ['Your PIN is 4829', '4829'],
  ['2FA code 482913', '482913'],
  ['Code: 4829', '4829'],
  ['Code:4829', '4829'],
  ['Use code AB12CD to sign in to Example.', 'AB12CD'],
  ['Your Postern sign-in code: 482913', '482913'],
  ['Your login code is 48291375', '48291375'],
  ['Hello,\n\nHere is your login code: 4829-1375\n\nIt works for 15 minutes.', '48291375', '4829-1375'],
  ['FB-48291 is your Facebook confirmation code', '48291', 'FB-48291'],
  ['Your code is 2024', '2024'],
  ['Enter this code to verify your email address:\n\n482913\n\nThis code expires in 15 minutes.', '482913'],
  ['Hi Dana,\n\nSomeone tried to sign in to your account. If this was you, use the following code to finish signing in.\n\n482913\n\nThanks,\nThe team', '482913'],
  ['Your verification code:\r\n\r\n    482 913\r\n\r\nIf you did not ask for this code, ignore this message.', '482913', '482 913'],
  ['To finish, enter the security code 482913. The code is valid for 30 minutes.', '482913'],
  // Other languages
  ['Tu código de verificación de Tinder es 482913', '482913'],
  ['Su código de seguridad es 482913. No lo comparta.', '482913'],
  ['482913 es tu código de Instagram', '482913'],
  ['Votre code de vérification est 482913', '482913'],
  ['Votre code de sécurité : 482913', '482913'],
  ['Ihr Bestätigungscode lautet 482913', '482913'],
  ['Dein WhatsApp-Code lautet: 123-456', '123456', '123-456'],
  ['Bitte bestätigen Sie mit dem Code 482913.', '482913'],
  ['Ihr Sicherheitscode: 482913', '482913'],
  ['Il tuo codice di verifica è 482913', '482913'],
  ['Seu código de verificação é 482913', '482913'],
];

const NEGATIVE = [
  // order, invoice, tracking, account numbers
  'Your order #482913 has shipped.',
  'Your order 482913 has shipped and will arrive on Friday.',
  'Invoice 20240915 is ready for you.',
  'Tracking number 48291375 - your parcel is on its way.',
  'Your account number is 48291375.',
  'Ref: 482913',
  'Reference: G-482913',
  'Confirm your order 482913 by replying YES',
  'Sign in to view invoice 482913',
  'Your OTP has been sent. Ticket ID 482913.',
  'Your code is on its way. Order 48291.',
  'Booking code XK42PL for your trip is saved.',
  'Ihre Bestellung 482913 wurde versandt.',
  'Su pedido 482913 ha sido enviado.',
  // phone numbers
  'Call us at 415 555 0123',
  'Questions? +1 (415) 555-0123',
  'Call 800-555-0199 to verify your identity.',
  'Your verification code was sent to +1 415 555 0123.',
  'Enter the code we sent to the number ending in 0123.',
  'Call 5550123 to confirm your appointment.',
  'Tel. 0161 496 0123 for login problems',
  // money
  'Total: $4829.00',
  'You paid 4829 USD for your order.',
  'Amount due: €1250',
  'We received your payment of 482913 JPY.',
  'Your security deposit of $482913 was refunded.',
  'Your card ending in 4829 was charged $12.00.',
  'Your balance is 482913 points.',
  'Use promo code SAVE20 for 20% off',
  'Use code 482913 to get 20% off your next order',
  'Use coupon code 482913 at checkout',
  // dates, years, times
  '© 2025 Example Inc. All rights reserved.',
  'The code of conduct was updated in 2024.',
  'Meeting at 10:30 on 12/05/2024',
  'Your appointment is on March 5, 2025 at 1430',
  'New login from Chrome on Windows, 12 March 2025, 14:05',
  'Your password was changed on 2025-03-12.',
  'Security update 2024.1.482913 is installed.',
  'Your login code expires in 3600 seconds.',
  // places
  'Springfield, IL 62701',
  'Zip code 90210',
  'Postcode: 2000',
  '1234 Quiet Meadow Ln, Apt 5678',
  'Room 4829, Building 5',
  // web addresses
  'Visit https://example.com/reset/482913 to continue',
  'Verify your email: https://example.com/verify?code=482913',
  'Open www.example.com/login/482913 on your phone',
  'Write to support+482913@example.com about your login',
  // other numbers and words
  'Error code 500123 occurred. Try again.',
  'Your verification code expired. Request a new one.',
  'Your package 482913 will arrive on 12 Mar',
  'Flight UA4829 leaves from gate B12',
  'Model AB12CD user manual',
  'Verification for COVID19 travel rules',
  'ISBN 9781234567897',
  'Authentication failed 3 times from 203.0.113.77',
  'Thanks for signing up. We sent 12 tips and 3 guides.',
  'Hello, this is a reminder for you.',
  '',
];

test('codes: finds the code in messages of typical services', () => {
  assert.ok(POSITIVE.length >= 40);
  for (const [text, code, display = code] of POSITIVE) {
    assert.deepEqual(findCode(text), { code, display }, text.slice(0, 80));
  }
});

test('codes: gives nothing for numbers that are no codes', () => {
  assert.ok(NEGATIVE.length >= 40);
  for (const text of NEGATIVE) {
    assert.equal(findCode(text), null, text.slice(0, 80));
  }
});

test('codes: the subject of an email is read first', () => {
  // A code in the subject.
  assert.deepEqual(findCode('Hi,\n\nSee the subject for your code.\n', { subject: '482913 is your verification code' }), { code: '482913', display: '482913' });
  assert.deepEqual(findCode('Welcome back. Order 111222 is on its way.', { subject: 'Your login code: 583024' }), { code: '583024', display: '583024' });
  // The subject says "code" and the text has the number alone on a line.
  assert.deepEqual(findCode('Hello,\n\n  482913\n\nBye', { subject: 'Your verification code' }), { code: '482913', display: '482913' });
  assert.deepEqual(findCode('482 913', { subject: 'Confirm your email' }), { code: '482913', display: '482 913' });
  // A subject without a code word does not make a lone number a code.
  assert.equal(findCode('Hello,\n\n  482913\n\nBye', { subject: 'Hello from us' }), null);
  assert.equal(findCode('Hello,\n\n  482913\n\nBye', { subject: 'Your order confirmation' }), null);
  assert.equal(findCode('Hello,\n\n  2025\n\nBye', { subject: 'Your verification code' }), null, 'a year');
  // The text is used when the subject has nothing.
  assert.deepEqual(findCode('Your code is 4829', { subject: 'Hello' }), { code: '4829', display: '4829' });
  assert.deepEqual(findCode('Your code is 4829', { subject: null }), { code: '4829', display: '4829' });
  assert.deepEqual(findCode('Your code is 4829', {}), { code: '4829', display: '4829' });
});

test('codes: the nearest number after the keyword wins', () => {
  assert.equal(findCode('Order 111222 confirmed. Your verification code is 482913.').code, '482913');
  assert.equal(findCode('Your verification code is 482913. It expires at 14:05 on 03/12/2025. Call 800-555-0199 for help.').code, '482913');
  assert.equal(findCode('Use code 482913 to sign in. Your old code 111222 no longer works.').code, '482913');
  assert.equal(findCode('Since 2019 we protect your account. Your security code: 583024').code, '583024');
  assert.equal(findCode('Ticket 99887 closed. 482913 is your login code.').code, '482913');
});

test('codes: input that is not text gives nothing; long input is fast', () => {
  for (const bad of [null, undefined, 5, {}, [], true]) assert.equal(findCode(bad), null);
  assert.equal(findCode('Your code is 4829', undefined).code, '4829');

  // Only the first 2,000 characters of the text are read.
  const far = `${'Lorem ipsum dolor sit amet. '.repeat(100)}Your code is 482913`;
  assert.ok(far.length > 2000);
  assert.equal(findCode(far), null);
  assert.equal(findCode(`Your code is 482913. ${far}`).code, '482913');

  // 200 KB of text, also text that is hard for a careless pattern.
  const samples = [
    'Your code is 482913 '.repeat(10000),
    '1'.repeat(200000),
    'code '.repeat(40000),
    `${'A1'.repeat(100000)}`,
    `${'12 34 56 78 '.repeat(17000)}`,
    `${'code-'.repeat(40000)}`,
    `${' '.repeat(200000)}`,
    `${'https://example.com/a/b/c/1234/'.repeat(7000)}`,
  ];
  const started = Date.now();
  for (const text of samples) {
    assert.ok(text.length >= 199000);
    findCode(text, { subject: text });
  }
  assert.ok(Date.now() - started < 500, `took ${Date.now() - started} ms`);
});

test('codes: the source uses no page, no network, and no storage', () => {
  const source = readFileSync(new URL('../web/js/lib/codes.js', import.meta.url), 'utf8');
  for (const word of ['document', 'window', 'fetch', 'localStorage', 'sessionStorage', 'XMLHttpRequest', 'navigator', 'import', 'require', 'eval']) {
    assert.equal(new RegExp(`\\b${word}\\b`).test(source), false, `codes.js must not use "${word}"`);
  }
  assert.equal(/https?:\/\//.test(source), false);
  // No pattern with a look-behind: older browsers cannot load a file that has one.
  assert.equal(/\(\?<[=!]/.test(source), false);
});
