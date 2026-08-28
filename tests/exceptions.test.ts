import { describe, it, expect } from 'vitest';
import {
  activeBlocks,
  isTemporarilyUnblocked,
  minutesRemaining,
  formatRemaining,
  nextExpiration,
  sweepExpired,
} from '../src/core/exceptions.js';
import {
  normalizeState,
  defaultState,
  isValidDuration,
  clampDuration,
  isValidTheme,
  DEFAULT_THEME,
} from '../src/core/state.js';
import type { BlockedSite } from '../src/core/state.js';

const NOW = 1_700_000_000_000;
const MIN = 60_000;

function site(hostname: string, until: number | null): BlockedSite {
  return { hostname, kind: 'apex', temporarilyUnblockedUntil: until };
}

describe('active vs expired exceptions', () => {
  it('treats a future timestamp as an active exception', () => {
    expect(isTemporarilyUnblocked(site('a.com', NOW + MIN), NOW)).toBe(true);
  });

  it('treats a past timestamp as expired', () => {
    expect(isTemporarilyUnblocked(site('a.com', NOW - 1), NOW)).toBe(false);
  });

  it('treats the exact expiry moment as expired', () => {
    expect(isTemporarilyUnblocked(site('a.com', NOW), NOW)).toBe(false);
  });

  it('treats a null timestamp as actively blocked', () => {
    expect(isTemporarilyUnblocked(site('a.com', null), NOW)).toBe(false);
  });

  it('lists only the entries that should currently be blocked', () => {
    const sites = [site('a.com', NOW + MIN), site('b.com', null), site('c.com', NOW - MIN)];
    expect(activeBlocks(sites, NOW).map((s) => s.hostname)).toEqual(['b.com', 'c.com']);
  });
});

describe('sweeping expired exceptions', () => {
  // The boundary must agree with isTemporarilyUnblocked: at `until === now` the
  // site already counts as blocked, so the sweep must also clear it. If these
  // two disagree, an entry reads as blocked while its exception is never
  // cleared, leaving a stale timestamp behind forever.
  it('clears an exception at the exact expiry instant', () => {
    const result = sweepExpired([site('a.com', NOW)], NOW);
    expect(result.changed).toBe(true);
    expect(result.expired).toEqual(['a.com']);
    expect(result.sites[0].temporarilyUnblockedUntil).toBeNull();
  });

  it('agrees with isTemporarilyUnblocked on every boundary offset', () => {
    for (const offset of [-1, 0, 1]) {
      const s = site('a.com', NOW + offset);
      const stillUnblocked = isTemporarilyUnblocked(s, NOW);
      const swept = sweepExpired([s], NOW).expired.includes('a.com');
      // Exactly one must be true: either it is still exempt, or it was swept.
      expect(swept).toBe(!stillUnblocked);
    }
  });

  it('clears expired exceptions and reports them', () => {
    const sites = [site('a.com', NOW - MIN), site('b.com', NOW + MIN)];
    const result = sweepExpired(sites, NOW);

    expect(result.changed).toBe(true);
    expect(result.expired).toEqual(['a.com']);
    expect(result.sites[0].temporarilyUnblockedUntil).toBeNull();
    expect(result.sites[1].temporarilyUnblockedUntil).toBe(NOW + MIN);
  });

  it('reports no change when nothing has expired', () => {
    const result = sweepExpired([site('a.com', NOW + MIN), site('b.com', null)], NOW);
    expect(result.changed).toBe(false);
    expect(result.expired).toEqual([]);
  });

  it('clears multiple simultaneous expirations', () => {
    const sites = [site('a.com', NOW - MIN), site('b.com', NOW - 2 * MIN), site('c.com', null)];
    const result = sweepExpired(sites, NOW);
    expect(result.expired.sort()).toEqual(['a.com', 'b.com']);
  });

  it('expires an exception that lapsed long ago without extending it', () => {
    // Simulates the machine sleeping through an expiry: the stored timestamp is
    // authoritative, so it is simply expired on wake.
    const sites = [site('a.com', NOW - 6 * 60 * MIN)];
    const result = sweepExpired(sites, NOW);
    expect(result.expired).toEqual(['a.com']);
    expect(result.sites[0].temporarilyUnblockedUntil).toBeNull();
  });

  it('does not mutate the input array', () => {
    const sites = [site('a.com', NOW - MIN)];
    sweepExpired(sites, NOW);
    expect(sites[0].temporarilyUnblockedUntil).toBe(NOW - MIN);
  });
});

describe('choosing the single next alarm', () => {
  it('selects the earliest future expiration', () => {
    const sites = [site('a.com', NOW + 5 * MIN), site('b.com', NOW + 2 * MIN), site('c.com', null)];
    expect(nextExpiration(sites, NOW)).toBe(NOW + 2 * MIN);
  });

  it('ignores already-expired timestamps', () => {
    const sites = [site('a.com', NOW - MIN), site('b.com', NOW + 3 * MIN)];
    expect(nextExpiration(sites, NOW)).toBe(NOW + 3 * MIN);
  });

  it('returns null when no exception is active', () => {
    expect(nextExpiration([site('a.com', null), site('b.com', NOW - MIN)], NOW)).toBeNull();
    expect(nextExpiration([], NOW)).toBeNull();
  });

  it('picks the next expiration after the earliest one is swept', () => {
    const sites = [site('a.com', NOW - 1), site('b.com', NOW + 10 * MIN)];
    const swept = sweepExpired(sites, NOW);
    expect(nextExpiration(swept.sites, NOW)).toBe(NOW + 10 * MIN);
  });
});

describe('remaining-time display', () => {
  it('rounds partial minutes up', () => {
    expect(minutesRemaining(site('a.com', NOW + 90_000), NOW)).toBe(2);
    expect(minutesRemaining(site('a.com', NOW + 1_000), NOW)).toBe(1);
  });

  it('reports zero for an inactive entry', () => {
    expect(minutesRemaining(site('a.com', null), NOW)).toBe(0);
  });

  it.each([
    [37 * MIN, '37 more minutes'],
    [1 * MIN, '1 more minute'],
    [60 * MIN, '1 hour more'],
    [150 * MIN, '2 hours 30 min more'],
  ])('formats a remaining duration', (offset, expected) => {
    expect(formatRemaining(site('a.com', NOW + offset), NOW)).toBe(expected);
  });
});

describe('changing the duration setting does not touch active exceptions', () => {
  it('keeps the original absolute timestamp when the setting changes', () => {
    const state = { ...defaultState(), blockedSites: [site('reddit.com', NOW + 60 * MIN)] };

    // 20 minutes later the user raises the default to 4 hours.
    const later = NOW + 20 * MIN;
    const updated = {
      ...state,
      settings: { temporaryUnblockMinutes: 240 },
    };

    // The stored expiry is unchanged, so it still lapses at the original time.
    expect(updated.blockedSites[0].temporarilyUnblockedUntil).toBe(NOW + 60 * MIN);
    expect(nextExpiration(updated.blockedSites, later)).toBe(NOW + 60 * MIN);
    expect(isTemporarilyUnblocked(updated.blockedSites[0], NOW + 61 * MIN)).toBe(false);
  });
});

describe('duration validation', () => {
  it.each([1, 60, 1440])('accepts %s minutes', (value) => {
    expect(isValidDuration(value)).toBe(true);
  });

  it.each([0, -5, 1441, 2880, 1.5, NaN, Infinity, '60', null, undefined])(
    'rejects %s',
    (value) => {
      expect(isValidDuration(value)).toBe(false);
    },
  );

  it('clamps out-of-range values into the supported window', () => {
    expect(clampDuration(0)).toBe(1);
    expect(clampDuration(99_999)).toBe(1440);
    expect(clampDuration(60.4)).toBe(60);
  });
});

describe('theme validation', () => {
  it.each(['auto', 'light', 'dark'])('accepts %s', (value) => {
    expect(isValidTheme(value)).toBe(true);
  });

  it.each(['neon', 'Dark', 'AUTO', '', 42, null, undefined, {}])('rejects %s', (value) => {
    expect(isValidTheme(value)).toBe(false);
  });

  it('defaults to auto', () => {
    expect(DEFAULT_THEME).toBe('auto');
    expect(defaultState().settings.theme).toBe('auto');
  });
});

describe('state normalization of untrusted stored data', () => {
  it('falls back to the default theme when the stored value is invalid', () => {
    const state = normalizeState({
      schemaVersion: 1,
      blockedSites: [],
      settings: { temporaryUnblockMinutes: 60, theme: 'neon' },
    });
    expect(state.settings.theme).toBe('auto');
  });

  it('keeps a valid stored theme', () => {
    const state = normalizeState({
      schemaVersion: 1,
      blockedSites: [],
      settings: { temporaryUnblockMinutes: 60, theme: 'dark' },
    });
    expect(state.settings.theme).toBe('dark');
  });

  it('defaults the theme when settings omit it entirely', () => {
    const state = normalizeState({
      schemaVersion: 1,
      blockedSites: [],
      settings: { temporaryUnblockMinutes: 30 },
    });
    expect(state.settings.theme).toBe('auto');
    expect(state.settings.temporaryUnblockMinutes).toBe(30);
  });

  it('falls back to defaults for junk input', () => {
    for (const junk of [null, undefined, 42, 'nope', []]) {
      const state = normalizeState(junk);
      expect(state.blockedSites).toEqual([]);
      expect(state.settings.temporaryUnblockMinutes).toBe(60);
    }
  });

  it('re-derives kind rather than trusting the stored value', () => {
    const state = normalizeState({
      schemaVersion: 1,
      // Storage claims www.example.com is an apex; it is not.
      blockedSites: [{ hostname: 'www.example.com', kind: 'apex', temporarilyUnblockedUntil: null }],
      settings: { temporaryUnblockMinutes: 60 },
    });
    expect(state.blockedSites[0].kind).toBe('subdomain');
  });

  it('drops entries that no longer parse', () => {
    const state = normalizeState({
      schemaVersion: 1,
      blockedSites: [
        { hostname: 'good.com', temporarilyUnblockedUntil: null },
        { hostname: 'localhost', temporarilyUnblockedUntil: null },
        { hostname: '', temporarilyUnblockedUntil: null },
        { nothostname: true },
        null,
      ],
      settings: {},
    });
    expect(state.blockedSites.map((s) => s.hostname)).toEqual(['good.com']);
  });

  it('removes duplicate stored hostnames', () => {
    const state = normalizeState({
      schemaVersion: 1,
      blockedSites: [
        { hostname: 'a.com', temporarilyUnblockedUntil: null },
        { hostname: 'A.com.', temporarilyUnblockedUntil: null },
      ],
      settings: {},
    });
    expect(state.blockedSites).toHaveLength(1);
  });

  it('discards an out-of-range stored duration', () => {
    const state = normalizeState({
      schemaVersion: 1,
      blockedSites: [],
      settings: { temporaryUnblockMinutes: 99_999 },
    });
    expect(state.settings.temporaryUnblockMinutes).toBe(60);
  });

  it('discards an invalid stored timestamp', () => {
    const state = normalizeState({
      schemaVersion: 1,
      blockedSites: [{ hostname: 'a.com', temporarilyUnblockedUntil: 'soon' }],
      settings: {},
    });
    expect(state.blockedSites[0].temporarilyUnblockedUntil).toBeNull();
  });

  it('keeps a valid stored exception', () => {
    const state = normalizeState({
      schemaVersion: 1,
      blockedSites: [{ hostname: 'a.com', temporarilyUnblockedUntil: NOW + MIN }],
      settings: { temporaryUnblockMinutes: 30 },
    });
    expect(state.blockedSites[0].temporarilyUnblockedUntil).toBe(NOW + MIN);
    expect(state.settings.temporaryUnblockMinutes).toBe(30);
  });
});
