/**
 * Theme application, shared by every extension page.
 *
 * The stored setting is one of `auto` / `light` / `dark`. Only an explicit
 * choice is written to the document; `auto` deliberately sets no attribute so
 * the stylesheet's `prefers-color-scheme` rules follow the device setting.
 */
// Deliberately imports only the theme constants, never `normalizeState`:
// that pulls in the hostname validator and with it the whole Public Suffix
// List, which would bloat the block page bundle for no reason.
import { DEFAULT_THEME, STORAGE_KEY, isValidTheme, type Theme } from '../core/state.js';

/** Read just the theme out of a raw stored object, without full normalization. */
function themeFromStored(raw: unknown): Theme {
  if (!raw || typeof raw !== 'object') return DEFAULT_THEME;
  const settings = (raw as { settings?: { theme?: unknown } }).settings;
  return isValidTheme(settings?.theme) ? settings.theme : DEFAULT_THEME;
}

/** Apply a theme to the current document. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'auto') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', theme);
  }
  // Lets form controls and scrollbars match the resolved theme.
  root.style.colorScheme = theme === 'auto' ? 'light dark' : theme;
}

/**
 * Read the stored theme straight from storage and apply it.
 *
 * Pages call this as early as possible so the correct colors are painted
 * before the rest of the UI loads. It reads storage directly rather than
 * messaging the service worker, because this is a read of presentation state
 * only - all *mutations* still go through the worker.
 */
export async function applyStoredTheme(): Promise<Theme> {
  try {
    const raw = await chrome.storage.local.get(STORAGE_KEY);
    const theme = themeFromStored(raw?.[STORAGE_KEY]);
    applyTheme(theme);
    return theme;
  } catch {
    applyTheme(DEFAULT_THEME);
    return DEFAULT_THEME;
  }
}
