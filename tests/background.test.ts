/**
 * Orchestration tests for the Chrome-facing adapters (DNR sync, alarm
 * scheduling, open-tab enforcement) against an in-memory fake of the APIs.
 *
 * These verify OUR logic drives the APIs correctly. They do not verify Chrome's
 * own matching or alarm behavior - see the manual checklist in the README.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { installFakeChrome, type FakeTab } from './helpers/fake-chrome.js';
import type { BlockedSite, StoredState } from '../src/core/state.js';
import { defaultState } from '../src/core/state.js';

const NOW = 1_700_000_000_000;
const MIN = 60_000;

function site(hostname: string, kind: 'apex' | 'subdomain', until: number | null = null): BlockedSite {
  return { hostname, kind, temporarilyUnblockedUntil: until };
}

function stateWith(sites: BlockedSite[]): StoredState {
  return { ...defaultState(), blockedSites: sites };
}

describe('DNR rule synchronization', () => {
  let env: ReturnType<typeof installFakeChrome>;

  beforeEach(() => {
    env = installFakeChrome();
  });

  it('replaces the whole ruleset so repeated syncs are idempotent', async () => {
    const { syncRules } = await import('../src/background/dnr.js');
    const state = stateWith([site('example.com', 'apex')]);

    await syncRules(state, NOW);
    const afterFirst = env.rules.length;

    await syncRules(state, NOW);
    expect(env.rules.length).toBe(afterFirst);
  });

  it('removes rules for entries that are temporarily unblocked', async () => {
    const { syncRules } = await import('../src/background/dnr.js');

    await syncRules(stateWith([site('example.com', 'apex')]), NOW);
    expect(env.rules).toHaveLength(1);

    await syncRules(stateWith([site('example.com', 'apex', NOW + MIN)]), NOW);
    expect(env.rules).toHaveLength(0);
  });

  it('restores rules once an exception has expired', async () => {
    const { syncRules } = await import('../src/background/dnr.js');
    await syncRules(stateWith([site('example.com', 'apex', NOW - 1)]), NOW);
    expect(env.rules).toHaveLength(1);
  });

  it('surfaces a useful error when Chrome rejects the ruleset', async () => {
    const { syncRules } = await import('../src/background/dnr.js');
    env.fake.declarativeNetRequest.updateDynamicRules.mockRejectedValueOnce(
      new Error('rule quota exceeded'),
    );

    await expect(syncRules(stateWith([site('a.com', 'apex')]), NOW)).rejects.toThrow(
      /Could not update blocking rules.*rule quota exceeded/,
    );
  });
});

describe('alarm scheduling', () => {
  let env: ReturnType<typeof installFakeChrome>;

  beforeEach(() => {
    env = installFakeChrome();
  });

  it('schedules a single alarm for the earliest expiration', async () => {
    const { scheduleNextExpiry, EXPIRY_ALARM } = await import('../src/background/alarms.js');

    await scheduleNextExpiry(
      stateWith([site('a.com', 'apex', NOW + 5 * MIN), site('b.com', 'apex', NOW + 2 * MIN)]),
      NOW,
    );

    expect(env.alarms.size).toBe(1);
    expect(env.alarms.get(EXPIRY_ALARM)?.when).toBe(NOW + 2 * MIN);
  });

  it('clears the alarm when no exception is active', async () => {
    const { scheduleNextExpiry } = await import('../src/background/alarms.js');
    await scheduleNextExpiry(stateWith([site('a.com', 'apex')]), NOW);
    expect(env.alarms.size).toBe(0);
  });

  it('never schedules an alarm in the past', async () => {
    const { scheduleNextExpiry, EXPIRY_ALARM } = await import('../src/background/alarms.js');
    await scheduleNextExpiry(stateWith([site('a.com', 'apex', NOW - 10 * MIN)]), NOW);
    // Already expired: nothing to wait for.
    expect(env.alarms.get(EXPIRY_ALARM)).toBeUndefined();
  });
});

describe('open-tab enforcement', () => {
  async function enforce(sites: BlockedSite[], tabs: FakeTab[], now = NOW) {
    const env = installFakeChrome({ tabs });
    const { enforceOpenTabs } = await import('../src/background/tabs.js');
    await enforceOpenTabs(stateWith(sites), now);
    return env;
  }

  it('redirects an open tab on a blocked apex domain', async () => {
    const env = await enforce(
      [site('example.com', 'apex')],
      [{ id: 1, url: 'https://example.com/page' }],
    );
    expect(env.tabs[0].url).toBe('chrome-extension://fake-id/blocked.html?domain=example.com');
  });

  it('redirects subdomain tabs under a blocked apex', async () => {
    const env = await enforce(
      [site('example.com', 'apex')],
      [{ id: 1, url: 'https://deep.sub.example.com/x' }],
    );
    expect(env.tabs[0].url).toContain('blocked.html?domain=example.com');
  });

  it('redirects only the exact host for a subdomain block', async () => {
    const env = await enforce(
      [site('www.example.com', 'subdomain')],
      [
        { id: 1, url: 'https://www.example.com/' },
        { id: 2, url: 'https://example.com/' },
        { id: 3, url: 'https://foo.example.com/' },
      ],
    );

    expect(env.tabs[0].url).toContain('blocked.html');
    expect(env.tabs[1].url).toBe('https://example.com/');
    expect(env.tabs[2].url).toBe('https://foo.example.com/');
  });

  it('names the blocklist entry, not the attempted URL, in the redirect', async () => {
    const env = await enforce(
      [site('example.com', 'apex')],
      [{ id: 1, url: 'https://secret.example.com/private/path?token=abc' }],
    );
    expect(env.tabs[0].url).toBe('chrome-extension://fake-id/blocked.html?domain=example.com');
    expect(env.tabs[0].url).not.toContain('private');
    expect(env.tabs[0].url).not.toContain('token');
  });

  it('leaves tabs on temporarily unblocked sites alone', async () => {
    const env = await enforce(
      [site('example.com', 'apex', NOW + MIN)],
      [{ id: 1, url: 'https://example.com/' }],
    );
    expect(env.tabs[0].url).toBe('https://example.com/');
  });

  it('redirects again once the exception has expired', async () => {
    const env = await enforce(
      [site('example.com', 'apex', NOW - 1)],
      [{ id: 1, url: 'https://example.com/' }],
    );
    expect(env.tabs[0].url).toContain('blocked.html');
  });

  it('enforces both HTTP and HTTPS tabs', async () => {
    const env = await enforce(
      [site('example.com', 'apex')],
      [
        { id: 1, url: 'http://example.com/' },
        { id: 2, url: 'https://example.com/' },
      ],
    );
    expect(env.tabs.every((t) => t.url.includes('blocked.html'))).toBe(true);
  });

  it('never touches chrome://, extension or file:// tabs', async () => {
    const env = await enforce(
      [site('example.com', 'apex')],
      [
        { id: 1, url: 'chrome://settings' },
        { id: 2, url: 'chrome-extension://abc/blocked.html?domain=example.com' },
        { id: 3, url: 'file:///tmp/example.com.html' },
        { id: 4, url: 'https://example.com/' },
      ],
    );
    // Two independent layers keep these safe: the tabs.query url filter (modeled
    // in the fake) and hostnameFromUrl's protocol check. This pins the combined
    // guarantee - in particular that the block page is never redirected onto
    // itself. The protocol check itself is covered directly in matching.test.ts.
    expect(env.tabs[0].url).toBe('chrome://settings');
    expect(env.tabs[1].url).toBe('chrome-extension://abc/blocked.html?domain=example.com');
    expect(env.tabs[2].url).toBe('file:///tmp/example.com.html');
    expect(env.tabs[3].url).toContain('blocked.html?domain=example.com');
  });

  it('does nothing when there are no active blocks', async () => {
    const env = await enforce([], [{ id: 1, url: 'https://example.com/' }]);
    expect(env.fake.tabs.update).not.toHaveBeenCalled();
  });
});
