import { describe, it, expect } from 'vitest';
import { createSerializer } from '../src/core/serialize.js';

/** A promise plus the handles to settle it from the outside. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createSerializer', () => {
  it('does not start a task until the previous one has settled', async () => {
    const serialize = createSerializer();
    const first = deferred<void>();
    const started: string[] = [];

    const a = serialize(async () => {
      started.push('a');
      await first.promise;
    });
    const b = serialize(async () => {
      started.push('b');
    });

    // Give the microtask queue every chance to run b early if it were going to.
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(['a']);

    first.resolve();
    await Promise.all([a, b]);
    expect(started).toEqual(['a', 'b']);
  });

  it('runs tasks in the order they were enqueued, not the order they resolve', async () => {
    const serialize = createSerializer();
    const finished: number[] = [];

    // Descending delays: without serialization these would finish 3, 2, 1.
    const tasks = [30, 20, 10].map((delay, index) =>
      serialize(async () => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        finished.push(index);
      }),
    );

    await Promise.all(tasks);
    expect(finished).toEqual([0, 1, 2]);
  });

  it('interleaves nothing across a read-modify-write, the bug this exists to stop', async () => {
    // Models the storage clobber directly: read, await, write back. Unserialized,
    // both tasks read 0 and the store ends at 1 instead of 2.
    const serialize = createSerializer();
    let store = 0;

    const increment = async () => {
      const read = store;
      await new Promise((resolve) => setTimeout(resolve, 0));
      store = read + 1;
    };

    await Promise.all([serialize(increment), serialize(increment)]);
    expect(store).toBe(2);
  });

  it('reports a failure to its own caller', async () => {
    const serialize = createSerializer();
    await expect(serialize(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });

  it('keeps running later tasks after one rejects', async () => {
    // A rejected task must not wedge the chain: every later mutation would
    // otherwise inherit the rejection and silently never run.
    const serialize = createSerializer();

    await expect(serialize(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(serialize(async () => 'ok')).resolves.toBe('ok');
  });

  it('still orders the task after a rejected one, rather than racing it', async () => {
    const serialize = createSerializer();
    const order: string[] = [];
    const blocker = deferred<void>();

    const failing = serialize(async () => {
      await blocker.promise;
      order.push('failing');
      throw new Error('boom');
    });
    const after = serialize(async () => {
      order.push('after');
    });

    blocker.resolve();
    await expect(failing).rejects.toThrow('boom');
    await after;
    expect(order).toEqual(['failing', 'after']);
  });

  it('gives each serializer an independent chain', async () => {
    const a = createSerializer();
    const b = createSerializer();
    const blocker = deferred<void>();
    let bRan = false;

    const blocked = a(() => blocker.promise);
    await b(async () => {
      bRan = true;
    });

    // b completed while a was still blocked: the chains do not share a tail.
    expect(bRan).toBe(true);
    blocker.resolve();
    await blocked;
  });

  it('passes the task result through', async () => {
    const serialize = createSerializer();
    await expect(serialize(async () => 42)).resolves.toBe(42);
  });
});
