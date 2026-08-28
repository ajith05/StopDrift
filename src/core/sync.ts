/**
 * Cross-process propagation decisions.
 *
 * Under `"incognito": "split"` Chrome runs two independent service workers.
 * chrome.storage.local is shared between them, but everything *derived* from it
 * is not: the dynamic DNR ruleset and open-tab enforcement are per-process, and
 * chrome.runtime.onMessage is delivered only to the process that owns the
 * sending page. So a mutation made from a normal window updates the normal
 * ruleset and normal tabs, and the incognito side never learns anything
 * changed - it keeps serving stale rules until something else revives it.
 *
 * chrome.storage.onChanged is the bridge: it fires in BOTH processes when
 * either one writes. Each process then rebuilds its own derived state from the
 * shared authority, with no cross-process messaging.
 *
 * This module holds only the decision - whether a given change event should
 * trigger a rebuild - so it can be tested without a browser.
 */

/** The shape of one entry in a chrome.storage.onChanged `changes` object. */
export interface StorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

/**
 * Decide whether a storage change event should trigger a rebuild of derived
 * state in this process.
 *
 * `lastWritten` is the serialized value this process most recently wrote, used
 * to suppress the self-echo: the writing process also receives its own event,
 * and it has already rebuilt everything synchronously as part of the write.
 * Acting on the echo would double every DNR write and tab query.
 *
 * When `lastWritten` is null - which is the case after a service-worker
 * suspension has discarded it - the event is acted on. That is the safe
 * direction: a redundant rebuild is merely wasteful, while a skipped one leaves
 * this process blocking the wrong set of sites.
 */
export function shouldRebuild(
  areaName: string,
  changes: Record<string, StorageChange>,
  storageKey: string,
  lastWritten: string | null,
): boolean {
  if (areaName !== 'local') return false;
  if (!Object.prototype.hasOwnProperty.call(changes, storageKey)) return false;

  // A removal (newValue undefined) always rebuilds: derived state must fall
  // back to defaults rather than keep enforcing a blocklist that is gone.
  const { newValue } = changes[storageKey];
  if (newValue === undefined) return true;

  if (lastWritten === null) return true;
  return serializeForCompare(newValue) !== lastWritten;
}

/**
 * Canonical serialization used to compare a change event against our own last
 * write. Both sides go through this same function, so the comparison is exact
 * for the values this extension actually writes.
 */
export function serializeForCompare(value: unknown): string {
  return JSON.stringify(value);
}
