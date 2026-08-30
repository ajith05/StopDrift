/**
 * Recovery when the DNR update inside commit() fails.
 *
 * commit() writes storage first, then rebuilds rules. If the rebuild throws,
 * the two disagree: the UI shows a block that nothing enforces. Storage stays
 * authoritative, so commit() queues a repair() to rebuild rules from it.
 *
 * These drive the real worker through the fake Chrome APIs. They do NOT prove
 * anything about when Chrome's own updateDynamicRules actually fails - the
 * failure is injected here. Reproducing a real one means forcing a rule quota
 * overflow in a browser, which no automated test here covers.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installFakeChrome } from './helpers/fake-chrome.js';
import { STORAGE_KEY, type StoredState } from '../src/core/state.js';

function stored(env: ReturnType<typeof installFakeChrome>): StoredState {
  return env.store[STORAGE_KEY] as StoredState;
}

function hostnames(env: ReturnType<typeof installFakeChrome>): string[] {
  return (stored(env)?.blockedSites ?? []).map((s) => s.hostname).sort();
}

describe('recovery from a failed rule sync', () => {
  let env: ReturnType<typeof installFakeChrome>;

  beforeEach(async () => {
    vi.resetModules();
    env = installFakeChrome();
    await import('../src/background/service-worker.js');
    // The activation repair() syncs rules once. Let it settle so the failure
    // injected below hits the command, not the activation.
    await vi.waitFor(() =>
      expect(env.fake.declarativeNetRequest.updateDynamicRules).toHaveBeenCalled(),
    );
  });

  it('keeps storage written and reports the failure to the caller', async () => {
    env.fake.declarativeNetRequest.updateDynamicRules.mockRejectedValueOnce(
      new Error('rule quota exceeded'),
    );

    const response = (await env.sendMessage({ type: 'addBlock', input: 'reddit.com' })) as {
      ok: boolean;
      error?: string;
    };

    // The user is told, and storage - the authority - holds the block.
    expect(response.ok).toBe(false);
    expect(response.error).toMatch(/Could not update blocking rules/);
    expect(hostnames(env)).toEqual(['reddit.com']);
  });

  it('rebuilds the ruleset from storage when the retry succeeds', async () => {
    // The transient case: one failure, then the queued repair() gets through
    // and the ruleset catches up with what storage already says.
    env.fake.declarativeNetRequest.updateDynamicRules.mockRejectedValueOnce(
      new Error('transient'),
    );

    await env.sendMessage({ type: 'addBlock', input: 'reddit.com' });

    await vi.waitFor(() => expect(env.rules).toHaveLength(1));
    expect(hostnames(env)).toEqual(['reddit.com']);
  });

  it('does not wedge the worker when the retry fails too', async () => {
    // The deterministic case - a quota overflow does not clear itself. The
    // repair() rejects, and because it is queued fire-and-forget nothing awaits
    // that rejection: the serializer's tail must swallow it so later commands
    // still run.
    env.fake.declarativeNetRequest.updateDynamicRules.mockRejectedValue(
      new Error('rule quota exceeded'),
    );
    const beforeCommand = env.fake.declarativeNetRequest.updateDynamicRules.mock.calls.length;

    const failed = (await env.sendMessage({ type: 'addBlock', input: 'reddit.com' })) as {
      ok: boolean;
    };
    expect(failed.ok).toBe(false);

    // Two attempts, not one: the command's own sync, then the queued repair()
    // retrying it. Counting from a baseline taken after the failure was armed,
    // so the command's own attempt cannot satisfy this on its own.
    await vi.waitFor(() =>
      expect(env.fake.declarativeNetRequest.updateDynamicRules.mock.calls.length).toBe(
        beforeCommand + 2,
      ),
    );

    env.fake.declarativeNetRequest.updateDynamicRules.mockReset();
    const recovered = (await env.sendMessage({ type: 'addBlock', input: 'twitter.com' })) as {
      ok: boolean;
    };
    expect(recovered.ok).toBe(true);
    expect(hostnames(env)).toEqual(['reddit.com', 'twitter.com']);
  });
});
