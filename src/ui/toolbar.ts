// Page-level actions in the sidebar header: copy a link to the current
// scenario, reset to the defaults, and choose the theme.

import { DEFAULTS } from '../physics/physics';
import type { Store } from '../state';

type Theme = 'auto' | 'light' | 'dark';

const THEME_KEY = 'rain-sim-theme';
const THEMES: { id: Theme; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

function savedTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : 'auto';
  } catch {
    return 'auto';
  }
}

/** Auto follows the OS setting; light and dark override it through data-theme. */
function applyTheme(theme: Theme): void {
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts for this visit.
  }
}

function button(text: string): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'button button-small';
  node.textContent = text;
  return node;
}

export function mountToolbar(host: HTMLElement, store: Store): void {
  const copy = button('Copy link');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      copy.textContent = 'Link copied';
    } catch {
      copy.textContent = 'Copy it from the address bar';
    }
    setTimeout(() => (copy.textContent = 'Copy link'), 1800);
  });

  const reset = button('Reset');
  reset.title = 'Reset every parameter to its default';
  reset.addEventListener('click', () => store.set({ ...DEFAULTS }));

  const themes = document.createElement('div');
  themes.className = 'segmented';
  themes.setAttribute('role', 'group');
  themes.setAttribute('aria-label', 'Theme');
  const themeButtons = THEMES.map(({ id, label }) => {
    const node = button(label);
    node.addEventListener('click', () => select(id));
    themes.append(node);
    return { id, node };
  });
  const select = (theme: Theme) => {
    applyTheme(theme);
    for (const { id, node } of themeButtons) node.setAttribute('aria-pressed', String(id === theme));
  };
  select(savedTheme());

  host.append(copy, reset, themes);
}
