// Theme store. The preference is `light`, `dark` or `system` and lives in
// `localStorage['fireconverter.theme']`, the key `/theme.js` reads before the
// first paint. `system` follows the OS preference live.
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

export type ThemePreference = 'light' | 'dark' | 'system';

/** THEME_KEY is shared with public/theme.js. */
export const THEME_KEY = 'fireconverter.theme';

/** THEMES is the order the switcher shows. */
export const THEMES: ThemePreference[] = ['light', 'dark', 'system'];

/** isTheme guards values coming from storage. */
export function isTheme(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

function readStoredTheme(): ThemePreference | null {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    return isTheme(stored) ? stored : null;
  } catch {
    return null;
  }
}

export const useThemeStore = defineStore('theme', () => {
  const preference = ref<ThemePreference>(readStoredTheme() ?? 'system');
  const dark = ref(false);

  const resolved = computed<'light' | 'dark'>(() => (dark.value ? 'dark' : 'light'));

  function prefersDark(): boolean {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  }

  function paint(): void {
    const next = preference.value === 'system' ? prefersDark() : preference.value === 'dark';
    dark.value = next;
    document.documentElement.classList.toggle('dark', next);
    document.documentElement.style.colorScheme = next ? 'dark' : 'light';
  }

  function set(next: ThemePreference): void {
    preference.value = isTheme(next) ? next : 'system';
    try {
      window.localStorage.setItem(THEME_KEY, preference.value);
    } catch {
      // Persisting is a nicety; the theme applies either way.
    }
    paint();
  }

  function init(): void {
    paint();
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    query?.addEventListener?.('change', () => {
      if (preference.value === 'system') paint();
    });
  }

  return { preference, dark, resolved, set, init };
});
