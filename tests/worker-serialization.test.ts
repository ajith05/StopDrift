/**
 * Concurrency of state mutations inside ONE service worker.
 *
 * Every mutation is a read-modify-write with awaits in between, and saveState
 * overwrites storage wholesale with no compare-and-swap. Without serialization
 * two overlapping mutations both read the same state and the second write
 * silently discards the first.
 *
 * These tests drive the real worker through the fake Chrome APIs, so they cover
 * the wiring - that the entry points actually share one chain - not just the
 * serializer primitive, which tests/serialize.test.ts covers directly.
 *
 * They do NOT prove Chrome dispatches its real events this way. That was checked
 * manually instead: concurrent addBlock commands sent from the options page kept
 * every block, and an expiry alarm fired mid-command queued behind it rather
 * than clobbering it. Changing which entry points share the serializer
 * invalidates that and needs the manual pass repeated.
 *
 * They say nothing about the cross-process (split-incognito) clobber, which this
 * change does not fix. See the note on saveState in src/background/storage.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installFakeChrome } from './helpers/fake-chrome.js';
import { STORAGE_KEY, type StoredState } from '../src/core/state.js';
import { EXPIRY_ALARM } from '../src/background/alarms.js';

function stored(env: ReturnType<typeof installFakeChrome>): StoredState {
  return env.store[STORAGE_KEY] as StoredState;
}

function hostnames(env: ReturnType<typeof installFakeChrome>): string[] {
  return (stored(env)?.blockedSites ?? []).map((s) => s.hostname).sort();
}

describe('concurrent mutations in one worker', () => {
  let env: ReturnType<typeof installFakeChrome>;

  beforeEach(async () => {
    vi.resetModules();
    env = installFakeChrome();
    await import('../src/background/service-worker.js');
    // Let the activation repair() settle so it cannot be mistaken for a result.
    await vi.waitFor(() => expect(env.fake.storage.local.get).toHaveBeenCalled());
  });

  it('keeps both blocks when two addBlock commands overlap', async () => {
    // The core bug: unserialized, both commands read the same empty blocklist
    // and the second write discards the first, losing a block the user asked
    // for. Fired without awaiting the first, which is how Chrome delivers them.
    const first = env.sendMessage({ type: 'addBlock', input: 'reddit.com' });
    const second = env.sendMessage({ type: 'addBlock', input: 'twitter.com' });

    await Promise.all([first, second]);

    expect(hostnames(env)).toEqual(['reddit.com', 'twitter.com']);
  });

  it('keeps every block when many commands overlap', async () => {
    const inputs = ['a.com', 'b.com', 'c.com', 'd.com', 'e.com'];

    await Promise.all(inputs.map((input) => env.sendMessage({ type: 'addBlock', input })));

    expect(hostnames(env)).toEqual([...inputs].sort());
  });

  it('does not lose a block when a removal overlaps an addition', async () => {
    await env.sendMessage({ type: 'addBlock', input: 'reddit.com' });

    const add = env.sendMessage({ type: 'addBlock', input: 'twitter.com' });
    const setDuration = env.sendMessage({ type: 'setDuration', minutes: 45 });

    await Promise.all([add, setDuration]);

    // Neither mutation clobbered the other: both effects survive.
    expect(hostnames(env)).toEqual(['reddit.com', 'twitter.com']);
    expect(stored(env).settings.temporaryUnblockMinutes).toBe(45);
  });

  it('does not let an alarm-driven repair clobber an in-flight command', async () => {
    // repair() is a read-modify-write too, and reaches state through the alarm,
    // storage.onChanged and activation - never through handle(). A second chain
    // for commands alone would leave this interleaving open.
    const add = env.sendMessage({ type: 'addBlock', input: 'reddit.com' });
    env.emitAlarm(EXPIRY_ALARM);

    await add;
    await vi.waitFor(() => expect(hostnames(env)).toEqual(['reddit.com']));
  });

  it('reports each command its own result', async () => {
    // Serialization must not merge outcomes: the duplicate has to be rejected
    // while the distinct one succeeds.
    const [first, second] = (await Promise.all([
      env.sendMessage({ type: 'addBlock', input: 'reddit.com' }),
      env.sendMessage({ type: 'addBlock', input: 'reddit.com' }),
    ])) as { ok: boolean }[];

    expect([first.ok, second.ok].sort()).toEqual([false, true]);
    expect(hostnames(env)).toEqual(['reddit.com']);
  });

  it('keeps handling commands after one fails', async () => {
    // A rejected mutation must not wedge the chain for every later one.
    const bad = (await env.sendMessage({ type: 'addBlock', input: 'not a hostname' })) as {
      ok: boolean;
    };
    expect(bad.ok).toBe(false);

    const good = (await env.sendMessage({ type: 'addBlock', input: 'reddit.com' })) as {
      ok: boolean;
    };
    expect(good.ok).toBe(true);
    expect(hostnames(env)).toEqual(['reddit.com']);
  });
});
