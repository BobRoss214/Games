// Theme: system, light or dark. This is the only value the app keeps in localStorage.
import { store } from './store.js';

const KEY = 'postern.theme';
const COLORS = { light: '#F6F3EC', dark: '#0F1412' };

function apply(theme) {
  const rootEl = document.documentElement;
  if (theme === 'light' || theme === 'dark') rootEl.setAttribute('data-theme', theme);
  else rootEl.removeAttribute('data-theme');
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? COLORS.dark : COLORS.light);
}

export function initTheme() {
  let theme = 'system';
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') theme = saved;
  } catch { /* storage is blocked */ }
  store.set({ theme });
  apply(theme);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => apply(store.get('theme')));
}

export function setTheme(theme) {
  const value = theme === 'light' || theme === 'dark' ? theme : 'system';
  store.set({ theme: value });
  try {
    if (value === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, value);
  } catch { /* the choice lasts for this visit only */ }
  apply(value);
}
