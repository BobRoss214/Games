// The five screens of Help. All the long text comes from web/js/help/content.js.
//
// Rules for this file ("do not track what I read"):
// - No call to the server. No storage. No cookie. No counter.
// - The address shows the name of the screen and nothing more. A link inside a screen
//   moves the view, and does not change the address.
import { h } from '../../lib/dom.js';
import { store } from '../../lib/store.js';
import { icon } from '../../ui/icons.js';
import { pageHeader, section, callout, linkButton } from '../../ui/components.js';
import { WHY_PAGE, TIPS, TIPS_NOTE, WHY, WORDS } from '../../help/content.js';

const appName = () => { const c = store.get('config'); return (c && c.appName) || 'this app'; };
// Puts the name of the product in the place of {app}.
const fill = (text) => String(text).split('{app}').join(appName());

// The parts of Help, in reading sequence.
const parts = () => [
  { path: '/help/why', icon: 'shield', title: fill(WHY_PAGE.title), text: fill('The problem, how {app} helps, and what {app} does not do.') },
  { path: '/help/tips', icon: 'check', title: 'Privacy tips', text: `${TIPS.length} short tips. Each tip says what to do, and why.` },
  { path: '/help/answers', icon: 'info', title: 'Questions and answers', text: 'The answers behind the small “Why?” buttons, all in one place.' },
  { path: '/help/words', icon: 'file', title: 'Words', text: fill('The words that {app} uses, and what they mean.') },
];

// A list of link cards: one card for each part.
function partLinks(list) {
  return h('ul', { class: 'grid-2' }, list.map((p) => h('li', null,
    h('a', { class: 'f-help-link', href: p.path, 'data-link': true },
      icon(p.icon, { size: 20, cls: 'f-help-link-icon' }),
      h('span', { class: 'f-help-link-main' },
        h('span', { class: 'f-help-link-title' }, p.title),
        h('span', { class: 'small muted' }, p.text),
      ),
      icon('chevronRight', { size: 18, cls: 'f-help-link-go' }),
    ))));
}

// The other parts of Help, at the end of a screen.
const more = (path) => section({ title: 'More in Help' }, partLinks(parts().filter((p) => p.path !== path)));

const tutorialButton = () => linkButton('Start the tutorial', '/tutorial', { kind: 'primary' });

// The app moves the keyboard focus to the main area when a new screen opens. A help screen
// then moves it on to its heading, so that a screen reader says the heading first.
function focusTitle(head) {
  queueMicrotask(() => {
    const title = head.querySelector('h1');
    const main = document.getElementById('main');
    if (title && main && main.contains(title) && document.activeElement === main) title.focus({ preventScroll: true });
  });
}

// The frame of a help screen. back: false = the first screen of Help.
function helpPage({ title, lede = '', back = true, wide = false }, ...children) {
  const head = pageHeader({ title, lede, back: back ? { href: '/help', label: 'Help' } : null });
  focusTitle(head);
  return h('div', { class: wide ? 'page' : 'page page-narrow' }, head, ...children);
}

// ---- /help ----
export function overviewScreen() {
  return helpPage({ title: 'Help', lede: fill('What {app} is for, how to use it with care, and where its limits are.'), back: false },
    h('section', { class: 'sheet sheet-pad stack stack-3', 'aria-labelledby': 'help-tutorial-title' },
      h('div', { class: 'stack stack-1' },
        h('h2', { class: 'section-title', id: 'help-tutorial-title' }, 'Tutorial'),
        h('p', { class: 'muted read' }, fill('The tutorial shows you the main parts of {app}, one step at a time.')),
      ),
      h('div', null, tutorialButton()),
    ),
    section({ title: 'Topics' }, partLinks(parts())),
    h('div', { class: 'section' },
      callout('info', 'The app does not record what you read',
        h('p', null, 'The help text is a part of the app. When you open a help page from the menu or from a link in the app, your browser sends nothing to the server.'),
        h('p', null, 'If you load a help page again, the server sees the address of that page. This is true for each page of the app.'),
      ),
    ),
  );
}

// ---- /help/why ----
export function whyScreen() {
  return helpPage({ title: fill(WHY_PAGE.title), lede: fill(WHY_PAGE.intro) },
    h('div', { class: 'prose' }, WHY_PAGE.sections.map((s) => [
      h('h2', null, fill(s.heading)),
      (s.paragraphs || []).map((p) => h('p', null, fill(p))),
      s.bullets && s.bullets.length ? h('ul', null, s.bullets.map((b) => h('li', null, fill(b)))) : null,
    ])),
    h('div', { class: 'section' }, tutorialButton()),
    more('/help/why'),
  );
}

// ---- /help/tips ----
function tipPart(label, text, cls) {
  return h('div', { class: cls }, h('dt', { class: 'label' }, label), h('dd', null, fill(text)));
}
function tipCard(tip) {
  const id = `help-tip-${tip.id}`;
  return h('li', null, h('article', { class: 'sheet sheet-pad f-help-tip', 'aria-labelledby': id },
    h('h2', { class: 'section-title', id }, fill(tip.title)),
    h('dl', { class: 'f-help-tip-parts' },
      tipPart('Do this', tip.doThis, 'f-help-do'),
      tipPart('Here is why', tip.why, 'f-help-why'),
      tip.limit ? tipPart('The limit', tip.limit, 'f-help-limit') : null,
    ),
  ));
}
export function tipsScreen() {
  return helpPage({ title: 'Privacy tips', lede: 'Each tip says what to do, and why. Some tips also have a limit.', wide: true },
    h('ul', { class: 'cards' }, TIPS.map(tipCard)),
    h('p', { class: 'f-help-note small muted' }, fill(TIPS_NOTE)),
    more('/help/tips'),
  );
}

// ---- /help/answers ----
// Each answer has the key of its "Why?" text as its id. Another screen can link to one answer:
// /help/answers#balance. This screen reads that part of the address, and never writes it.
export function answersScreen({ scope }) {
  const entries = Object.entries(WHY);
  const headings = new Map();
  const show = (key) => {
    const heading = headings.get(key);
    if (!heading || !heading.isConnected) return;
    heading.scrollIntoView({ block: 'start' });
    heading.focus({ preventScroll: true });
  };
  // A plain click or Enter moves the view only. The address stays as it is.
  const onJump = (key) => (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    show(key);
  };
  const answers = entries.map(([key, entry]) => {
    const heading = h('h2', { class: 'section-title f-help-answer', id: key, tabIndex: -1 }, fill(entry.title));
    headings.set(key, heading);
    return [heading, entry.paragraphs.map((p) => h('p', null, fill(p)))];
  });
  const wanted = location.hash.slice(1);
  if (headings.has(wanted)) requestAnimationFrame(() => { if (!scope.disposed) show(wanted); });
  return helpPage({ title: 'Questions and answers', lede: fill('The small “Why?” buttons in {app} open these answers. Here you can read them all in one place.') },
    h('nav', { class: 'sheet sheet-pad stack stack-2', 'aria-labelledby': 'help-questions-title' },
      h('h2', { class: 'section-title', id: 'help-questions-title' }, 'Questions'),
      h('ul', { class: 'f-help-questions' }, entries.map(([key, entry]) => h('li', null,
        h('a', { href: `#${key}`, onClick: onJump(key) }, fill(entry.title))))),
    ),
    h('div', { class: 'prose f-help-answers' }, answers),
    more('/help/answers'),
  );
}

// ---- /help/words ----
export function wordsScreen() {
  return helpPage({ title: 'Words', lede: fill('The words that {app} uses, and what they mean.') },
    h('dl', { class: 'sheet f-help-words' }, WORDS.map((w) => h('div', null,
      h('dt', null, fill(w.word)),
      h('dd', null, fill(w.meaning)),
    ))),
    more('/help/words'),
  );
}
