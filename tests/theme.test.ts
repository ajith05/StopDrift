/**
 * @vitest-environment jsdom
 *
 * Theme application. Verifies that only an explicit choice writes an attribute,
 * so `auto` is left to the stylesheet's prefers-color-scheme rules.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyTheme, applyStoredTheme } from '../src/shared/theme.js';
import { STORAGE_KEY, THEMES } from '../src/core/state.js';
import { readFileSync } from 'fs';

function installStorage(stored: unknown, shouldThrow = false) {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn(async () => {
          if (shouldThrow) throw new Error('storage unavailable');
          return { [STORAGE_KEY]: stored };
        }),
      },
      onChanged: { addListener: vi.fn() },
    },
  };
}

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.style.colorScheme = '';
});

describe('applyTheme', () => {
  it('sets the attribute for an explicit dark choice', () => {
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('sets the attribute for an explicit light choice', () => {
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('removes the attribute for auto so the media query decides', () => {
    applyTheme('dark');
    applyTheme('auto');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    // Both schemes offered, letting the device setting pick.
    expect(document.documentElement.style.colorScheme).toBe('light dark');
  });

  it('switches cleanly between explicit themes', () => {
    applyTheme('dark');
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});

describe('applyStoredTheme', () => {
  it('applies the stored theme', async () => {
    installStorage({
      schemaVersion: 1,
      blockedSites: [],
      settings: { temporaryUnblockMinutes: 60, theme: 'dark' },
    });

    await expect(applyStoredTheme()).resolves.toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('falls back to auto when nothing is stored', async () => {
    installStorage(undefined);
    await expect(applyStoredTheme()).resolves.toBe('auto');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('falls back to auto when the stored theme is invalid', async () => {
    installStorage({
      schemaVersion: 1,
      blockedSites: [],
      settings: { temporaryUnblockMinutes: 60, theme: 'neon' },
    });
    await expect(applyStoredTheme()).resolves.toBe('auto');
  });

  it('falls back to auto when storage throws', async () => {
    installStorage(null, true);
    await expect(applyStoredTheme()).resolves.toBe('auto');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});

describe('stylesheet palette', () => {
  // Read from disk so the assertions apply to the file Chrome actually loads.
  const css = readFileSync('public/styles.css', 'utf8');

  /** Custom-property declarations in the :root block, as [name, value]. */
  function rootTokens(): [string, string][] {
    const open = css.indexOf('{', css.indexOf(':root {'));
    const body = css.slice(open + 1, css.indexOf('\n}', open));
    const out: [string, string][] = [];
    for (const line of body.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('--')) continue;
      const i = t.indexOf(':');
      out.push([t.slice(0, i).trim(), t.slice(i + 1).replace(/;$/, '').trim()]);
    }
    return out;
  }

  // Duplication is now impossible by construction: one declaration per token,
  // carrying both halves. These tests keep it that way.
  it('declares every color once via light-dark()', () => {
    const tokens = rootTokens();
    expect(tokens.length).toBeGreaterThan(0);
    // --radius is a length, not a color, so it is legitimately plain.
    const colors = tokens.filter(([name]) => name !== '--radius');
    const plain = colors.filter(([, value]) => !value.startsWith('light-dark('));
    expect(plain).toEqual([]);
  });

  it('gives every light-dark() both a light and a dark half', () => {
    for (const [name, value] of rootTokens()) {
      if (!value.startsWith('light-dark(')) continue;
      const inner = value.slice('light-dark('.length, value.lastIndexOf(')'));
      // Split on the top-level comma only - rgba(...) contains commas too.
      let depth = 0;
      let split = -1;
      for (let i = 0; i < inner.length; i++) {
        if (inner[i] === '(') depth++;
        else if (inner[i] === ')') depth--;
        else if (inner[i] === ',' && depth === 0) {
          split = i;
          break;
        }
      }
      expect(split, `${name} needs two halves`).toBeGreaterThan(-1);
      expect(inner.slice(0, split).trim().length).toBeGreaterThan(0);
      expect(inner.slice(split + 1).trim().length).toBeGreaterThan(0);
    }
  });

  it('sets color-scheme so light-dark() has something to resolve against', () => {
    expect(css).toContain('color-scheme: light dark;');
  });

  it('no longer carries a duplicated dark palette', () => {
    // The old mechanism repeated all 15 tokens; if either construct comes back,
    // the duplication risk comes back with it. Comments are stripped first so
    // prose explaining the old approach does not trip this.
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toContain('@media (prefers-color-scheme: dark)');
    expect(rules).not.toContain("[data-theme=");
  });

  it('covers every theme the app can store', () => {
    // light/dark resolve through color-scheme; auto sets no attribute.
    expect(THEMES).toContain('auto');
    expect(THEMES).toContain('light');
    expect(THEMES).toContain('dark');
  });
});
