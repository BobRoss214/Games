// Settings: the "Test tools" section. It shows only when the server runs in test mode.
import { h } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { registerSettingsSection } from '../lib/registry.js';
import { button } from '../ui/components.js';
import { openTestTools } from '../screens/testtools.js';

registerSettingsSection({
  id: 'test-tools',
  title: 'Test tools',
  lede: 'This server runs in test mode. Simulate incoming mail, texts and calls, and look at what the app sent.',
  order: 80,
  render: () => (store.get('config').dev ? h('div', null, button('Open test tools', { iconName: 'tools', onClick: () => openTestTools() })) : null),
});
