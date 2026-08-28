/**
 * Cross-process propagation under `"incognito": "split"`.
 *
 * Two service workers share storage but not derived state, so a write in one
 * process must rebuild DNR rules and enforce tabs in the other. These tests
 * cover the decision logic and the wiring against the Chrome fake; they cannot
 * verify that Chrome actually wakes a suspended incognito worker to deliver the
 * event - see the manual checklist in the README.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { shouldRebuild, serializeForCompare } from '../src/core/sync.js';
import { installFakeChrome } from './helpers/fake-chrome.js';
import { defaultState, STORAGE_KEY, type BlockedSite, type StoredState } from '../src/core/state.js';

const KEY = STORAGE_KEY;

function site(hostname: string, kind: 'apex' | 'subdomain' = 'apex'): BlockedSite {
  return { hostname, kind, temporarilyUnblockedUntil: null };
}

function stateWith(sites: BlockedSite[]): StoredState {
  return { ...defaultState(), blockedSites: sites };
}

describe('shouldRebuild', () => {
  const value = { a: 1 };
  const serialized = serializeForCompare(value);

  it('rebuilds when another process wrote a different value', () => {
    expect(shouldRebuild('local', { [KEY]: { newValue: value } }, KEY, serializeForCompare({ a: 2 }))).toBe(true);
  });

  it('skips this process own echo of the write it just made', () => {
    expect(shouldRebuild('local', { [KEY]: { newValue: value } }, KEY, serialized)).toBe(false);
  });

  it('rebuilds when the last written value is unknown, as after a suspension', () => {
    expect(shouldRebuild('local', { [KEY]: { newValue: value } }, KEY, null)).toBe(true);
  });

  it('ignores changes in storage areas other than local', () => {
    for (const area of ['sync', 'session', 'managed']) {
      expect(shouldRebuild(area, { [KEY]: { newValue: value } }, KEY, null)).toBe(false);
    }
  });

  it('ignores writes to unrelated keys', () => {
    expect(shouldRebuild('local', { 'someone.else': { newValue: value } }, KEY, null)).toBe(false);
  });

  it('ignores an empty change set', () => {
    expect(shouldRebuild('local', {}, KEY, null)).toBe(false);
  });

  it('rebuilds when the key is removed, so derived state falls back to defaults', () => {
    expect(shouldRebuild('local', { [KEY]: { oldValue: value } }, KEY, serialized)).toBe(true);
  });

  it('does not treat a key inherited from Object.prototype as a real change', () => {
    // Guards the hasOwnProperty check: a bare `KEY in changes` would be fooled.
    expect(shouldRebuild('local', {}, 'toString', null)).toBe(false);
  });

  it('distinguishes values that differ only in blocklist contents', () => {
    const one = serializeForCompare(stateWith([site('a.com')]));
    expect(shouldRebuild('local', { [KEY]: { newValue: stateWith([site('b.com')]) } }, KEY, one)).toBe(true);
  });
});

describe('service worker propagation wiring', () => {
  let env: ReturnType<typeof installFakeChrome>;

  beforeEach(() => {
    vi.resetModules();
    env = installFakeChrome();
  });

  it('registers a storage change listener on activation', async () => {
    await import('../src/background/service-worker.js');
    expect(env.storageListenerCount()).toBe(1);
  });

  it('rebuilds this process DNR rules when another process adds a block', async () => {
    await import('../src/background/service-worker.js');
    await vi.waitFor(() => expect(env.rules).toHaveLength(0));

    env.emitForeignChange(KEY, stateWith([site('example.com')]));

    await vi.waitFor(() => expect(env.rules).toHaveLength(1));
  });

  it('drops rules when another process removes the last block', async () => {
    await import('../src/background/service-worker.js');
    env.emitForeignChange(KEY, stateWith([site('example.com')]));
    await vi.waitFor(() => expect(env.rules).toHaveLength(1));

    env.emitForeignChange(KEY, stateWith([]));
    await vi.waitFor(() => expect(env.rules).toHaveLength(0));
  });

  it('does not write storage while rebuilding, so a change event cannot feed itself', async () => {
    // repair() runs on storage.onChanged. If it wrote storage unconditionally,
    // each rebuild would emit another change event and recurse forever - a real
    // regression this test exists to catch, not a hypothetical one.
    await import('../src/background/service-worker.js');
    await vi.waitFor(() => expect(env.fake.storage.local.set).not.toHaveBeenCalled());

    env.emitForeignChange(KEY, stateWith([site('example.com')]));
    await vi.waitFor(() => expect(env.rules).toHaveLength(1));

    expect(env.fake.storage.local.set).not.toHaveBeenCalled();
  });

  it('enforces open tabs when another process adds a block', async () => {
    env = installFakeChrome({ tabs: [{ id: 1, url: 'https://example.com/feed' }] });
    await import('../src/background/service-worker.js');

    env.emitForeignChange(KEY, stateWith([site('example.com')]));

    await vi.waitFor(() => expect(env.tabs[0].url).toContain('blocked.html'));
  });

  it('does not rebuild twice for a write made in this process', async () => {
    const { saveState } = await import('../src/background/storage.js');
    await import('../src/background/service-worker.js');
    await vi.waitFor(() => expect(env.fake.declarativeNetRequest.updateDynamicRules).toHaveBeenCalled());

    const before = env.fake.declarativeNetRequest.updateDynamicRules.mock.calls.length;
    await saveState(stateWith([site('example.com')]));

    // saveState alone does not sync rules; the echo must not trigger one either.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(env.fake.declarativeNetRequest.updateDynamicRules.mock.calls.length).toBe(before);
  });
});
