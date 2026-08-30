/**
 * A promise chain that runs tasks one at a time, in call order.
 *
 * Used wherever a read-modify-write straddles an await and two overlapping
 * callers would otherwise both act on the same stale read. The chain is
 * ordinary module/closure state, so it serializes within ONE process only -
 * under `"incognito": "split"` each service worker holds its own.
 */

/** Runs the tasks handed to it strictly one after another. */
export type Serializer = <T>(task: () => Promise<T>) => Promise<T>;

/**
 * Create an independent serializer.
 *
 * A rejected task must not wedge the chain: every later task would otherwise
 * inherit the rejection and never run. So the tail swallows failures while the
 * promise handed back to the caller does not - each caller still sees its own
 * outcome, success or failure.
 *
 * Tasks are enqueued at call time, so ordering follows the order calls are
 * made, not the order they happen to resolve.
 */
export function createSerializer(): Serializer {
  let tail: Promise<unknown> = Promise.resolve();

  return <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task, task);
    tail = result.catch(() => undefined);
    return result;
  };
}
