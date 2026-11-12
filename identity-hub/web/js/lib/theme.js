// Theme: dark (the default), light, or system. This is the only value the app keeps in localStorage.
// The default is not saved: with the dark theme, localStorage is empty.
import { store } from './store.js';

const KEY = 'postern.theme';
const COLORS = { light: '#F6F3EC', dark: '#0F1412' };
const CHOICES = ['dark', 'light', 'system'];
const systemLight = () => window.matchMedia('(prefers-color-scheme: light)').matches;

// true when the screen shows dark colours now
export function isDark(theme = store.get('theme')) {
  return theme === 'dark' || (theme === 'system' && !systemLight());
}

function apply(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', isDark(theme) ? COLORS.dark : COLORS.light);
  // Parts that draw their own colours (the frame of an email) listen for this.
  window.dispatchEvent(new Event('postern:theme'));
}

export function initTheme() {
  let theme = 'dark';
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'system') theme = saved;
  } catch { /* storage is blocked: the dark theme */ }
  store.set({ theme });
  apply(theme);
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => apply(store.get('theme')));
}

export function setTheme(theme) {
  const value = CHOICES.includes(theme) ? theme : 'dark';
  store.set({ theme: value });
  try {
    if (value === 'dark') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, value);
  } catch { /* the choice lasts for this visit only */ }
  apply(value);
}
