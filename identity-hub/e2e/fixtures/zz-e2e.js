// A test-only feature file. It is not part of the app.
// e2e/tests/14-registry.test.mjs serves it at /js/features/zz-e2e.js and adds one import
// line for it to /js/features/index.js, the same way a real feature file is added.
import { h, region } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { navigate } from '../lib/router.js';
import { tag, button } from '../ui/components.js';
import { toast } from '../ui/toast.js';
import { setItemExtra } from '../lib/data.js';
import { setIdentityExtra } from '../lib/identities.js';
import {
  registerRoute, registerNavItem, registerRowAction, registerRowBadge, registerMessageAction, registerMessagePanel,
  registerTextAddon, registerCallAddon, registerSettingsSection, registerHomeSection, registerNumberTab,
  registerNumberSetting, registerGlobalKey,
} from '../lib/registry.js';

// screens: one that needs an account (with a part that changes), one that everybody may open
registerRoute('/e2e', () => import('./zz-e2e-screen.js'), { title: 'Test place' });
registerRoute('/e2e/:word', () => import('./zz-e2e-screen.js'), { title: 'Test place' });
registerRoute('/e2e-open', () => import('./zz-e2e-screen.js'), { signedOut: true, title: 'Open test place' });
registerRoute('/e2e-broken', () => import('./zz-e2e-missing.js'), { title: 'Broken' });
registerNavItem({ id: 'e2e', label: 'Test place', icon: 'tools', path: '/e2e', order: 60 });

// rows: an action that saves a field of its own, and a mark that reads it
registerRowAction('alias', (item) => (item.extra.e2eMark ? null : { label: 'Test mark', icon: 'check', run: () => setItemExtra('alias', item.id, { e2eMark: 'yes' }).then(() => toast('Test mark saved')) }));
registerRowAction('alias', () => ({ label: 'Test danger', icon: 'trash', danger: true, run: (item) => toast(`Test danger: ${item.label}`) }));
registerRowBadge('alias', (item) => (item.extra.e2eMark ? tag('E2E marked', 'ok') : null));
registerRowBadge('number', () => tag('E2E number'));
registerRowBadge('inbox', () => { throw new Error('e2e broken badge'); });
registerRowAction('identity', (item) => ({ label: 'Test colour', icon: 'dot', run: () => setIdentityExtra(item.id, { e2eColour: 'green' }) }));
registerRowBadge('identity', (item) => (item.extra.e2eColour ? tag(`E2E ${item.extra.e2eColour}`) : null));

// mail, texts, calls
registerMessageAction((message, alias) => ({ label: 'Test message action', icon: 'check', run: () => toast(`Test message: ${message.meta.subject} / ${alias ? alias.label : 'no alias'}`) }));
registerMessagePanel((message) => h('p', { class: 'small muted e2e-panel' }, `E2E panel for ${message.meta.subject}`));
registerTextAddon((text, number) => tag(`E2E text ${text.direction} ${number ? number.label : ''}`));
registerCallAddon((call) => button('E2E call', { size: 'sm', onClick: () => toast(`Test call ${call.direction}`) }));

// sections
registerSettingsSection({ id: 'e2e', title: 'Test section', lede: 'From the test feature.', order: 35, render: () => h('p', { class: 'e2e-settings' }, 'E2E settings part') });
registerHomeSection({ id: 'e2e-top', order: 15, render: ({ scope }) => region(scope, store, ['aliases'], (s) => (s.aliases && s.aliases.length ? h('p', { class: 'small muted e2e-home' }, `E2E home: ${s.aliases.length} aliases`) : null)) });
registerHomeSection({ id: 'e2e-end', order: 60, render: () => h('p', { class: 'small muted e2e-home-end' }, 'E2E home end') });
registerNumberTab({ id: 'e2e', label: 'Test tab', order: 30, render: ({ number }) => h('p', { class: 'e2e-tab' }, `E2E tab for ${number.label}`) });
registerNumberSetting({ id: 'e2e', title: 'Test setting', lede: 'From the test feature.', render: ({ number }) => h('p', { class: 'e2e-number-setting' }, `E2E setting for ${number.label}`) });

// a key
registerGlobalKey('j', () => navigate('/e2e/key'));
