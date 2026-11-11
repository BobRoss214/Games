// Signed-out start screen.
import { h } from '../lib/dom.js';
import { store, appName } from '../lib/store.js';
import { registered } from '../lib/registry.js';
import { navigate } from '../lib/router.js';
import { icon, logoMark } from '../ui/icons.js';
import { button, linkButton, runBusy } from '../ui/components.js';
import { testBanner } from '../ui/shell.js';
import { passkeysSupported, passkeyAssertion } from '../lib/webauthn.js';
import { finishPasskeySignIn } from '../lib/session.js';

// The picture: a small arched door with a list of example addresses on it.
// It shows the idea of the product with its own material, not a stock drawing.
function doorFigure(domain) {
  const row = (iconName, value, note, off = false) => h('li', { class: `door-row ${off ? 'is-off' : ''}`.trim() },
    icon(iconName, { size: 16 }),
    h('span', { class: 'door-value mono' }, value),
    h('span', { class: 'door-note' }, note),
  );
  return h('figure', { class: 'door', role: 'img', 'aria-label': 'Example: two aliases and a phone number lead to one private inbox. One alias is turned off.' },
    h('div', { class: 'door-arch', 'aria-hidden': 'true' },
      h('div', { class: 'door-top' }, logoMark({ size: 34 })),
      h('ul', { class: 'door-list' },
        row('alias', `shop.maple214@${domain}`, 'to Inbox Personal'),
        row('alias', `news.harbor77@${domain}`, 'turned off', true),
        row('phone', '+1 415 555 0123', 'to My mobile'),
        row('inbox', `quiet.river482@${domain}`, 'Inbox Personal'),
      ),
    ),
    h('div', { class: 'door-step', 'aria-hidden': 'true' }),
  );
}

export function welcomeScreen({ scope }) {
  const config = store.get('config') || {};
  const closed = config.signup === 'closed';
  const domain = (config.mailDomains && config.mailDomains[0]) || 'postern.example';
  const errorBox = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const help = registered.navItems().find((n) => n.id === 'help') || null;
  const links = registered.welcomeLinks(); // links of feature files (registerWelcomeLink)

  const passkeyBtn = button('Sign in with a passkey', { iconName: 'passkey', size: 'lg', block: true, onClick: (e, btn) => runBusy(btn, async () => {
    errorBox.hidden = true;
    const result = await passkeyAssertion();
    if (scope.disposed) return;
    await finishPasskeySignIn(result);
    navigate('/', { replace: true });
  }, { onError: (err) => { errorBox.textContent = err.message; errorBox.hidden = false; return true; } }) });

  const actions = h('div', { class: 'welcome-actions' },
    closed
      ? button('Create account', { kind: 'primary', size: 'lg', block: true, disabled: true })
      : linkButton('Create account', '/create', { kind: 'primary', size: 'lg', block: true }),
    closed ? h('p', { class: 'small muted' }, 'New accounts are closed on this server.') : null,
    passkeysSupported() ? passkeyBtn : null,
    linkButton('Use my recovery key', '/sign-in', { size: 'lg', block: true, iconName: 'key' }),
    errorBox,
  );

  return h('div', { class: 'welcome' },
    testBanner(),
    h('header', { class: 'welcome-head' },
      h('span', { class: 'brand' }, logoMark({ size: 30 }), h('span', { class: 'brand-name' }, appName())),
      // Help is a feature file. Its pages are open to people without an account.
      help && !links.some((l) => l.path === help.path) ? h('a', { class: 'btn btn-quiet welcome-help', href: help.path, 'data-link': true }, icon('info', { size: 18 }), h('span', null, 'Help')) : null,
    ),
    h('main', { class: 'welcome-main', id: 'main', tabIndex: -1 },
      h('div', { class: 'welcome-copy' },
        h('h1', { class: 'welcome-title' }, 'A private door for your mail and calls.'),
        h('p', { class: 'welcome-lede' }, 'Make email aliases, inboxes and phone numbers that are not tied to who you are. Give out a different one each time. Turn one off when you are done with it.'),
        h('ul', { class: 'welcome-facts' },
          h('li', null, icon('check', { size: 18 }), 'No name.'),
          h('li', null, icon('check', { size: 18 }), 'No email address.'),
          h('li', null, icon('check', { size: 18 }), 'No phone number.'),
        ),
        actions,
        links.length ? h('nav', { class: 'welcome-links', 'aria-label': 'More' }, links.map((l) => h('a', { class: 'btn btn-quiet', href: l.path, 'data-link': true, dataset: { welcomeLink: l.id } }, l.label))) : null,
        h('p', { class: 'welcome-fine' }, 'You pay with Bitcoin or Monero. The server cannot link a payment to your account.'),
      ),
      doorFigure(domain),
    ),
  );
}
