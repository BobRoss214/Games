// Help: the "Help" place in the menu and its five screens.
//
// "Do not track what I read": the screens and their words load together with the app,
// not when a person opens Help. So a look at a help screen asks the server for nothing.
// For that reason the screens are a normal import here (the usual feature screen loads on first use).
// The words are in web/js/help/content.js. The screens are in ./help/screens.js.
import { registerRoute, registerNavItem } from '../lib/registry.js';
import { overviewScreen, whyScreen, tipsScreen, answersScreen, wordsScreen } from './help/screens.js';

registerNavItem({ id: 'help', label: 'Help', icon: 'info', path: '/help', order: 80 });

// signedOut: true = a person can read Help before they make an account.
const open = { signedOut: true, nav: 'help' };
registerRoute('/help', () => overviewScreen, { ...open, title: 'Help' });
registerRoute('/help/why', () => whyScreen, { ...open, title: 'Why this exists' });
registerRoute('/help/tips', () => tipsScreen, { ...open, title: 'Privacy tips' });
registerRoute('/help/answers', () => answersScreen, { ...open, title: 'Questions and answers' });
registerRoute('/help/words', () => wordsScreen, { ...open, title: 'Words' });
