/**
 * Thin chrome.storage.local adapter around the canonical schema.
 *
 * chrome.storage.local is shared between the regular and incognito processes,
 * so under `"incognito": "split"` both instances read and write the same
 * blocklist with no bridging required. The *derived* state (DNR rules, open
 * tabs) is not shared - see core/sync.ts and the onChanged listener in the
 * service worker for how a write in one process reaches the other.
 */
import { STORAGE_KEY, normalizeState, type StoredState } from '../core/state.js';
import { serializeForCompare } from '../core/sync.js';

/**
 * Serialization of the value this process most recently wrote, used to
 * recognize and skip our own storage.onChanged echo.
 *
 * Module-level, so it is discarded when the service worker suspends. That is
 * deliberate: a lost value means the next event is treated as foreign and
 * triggers a rebuild, which is idempotent and the safe direction to err in.
 */
let lastWritten: string | null = null;

export function lastWrittenValue(): string | null {
  return lastWritten;
}

export async function loadState(): Promise<StoredState> {
  const raw = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeState(raw?.[STORAGE_KEY]);
}

/**
 * Overwrite the stored state wholesale.
 *
 * This is a blind write: chrome.storage offers no compare-and-swap, so the
 * last writer wins. Within one process that is safe, because the service
 * worker serializes every mutation onto a single chain (see service-worker.ts).
 *
 * ACROSS processes it is not. Under `"incognito": "split"` the two service
 * workers hold two independent chains and share this storage area, so two
 * mutations made in the same read-modify-write window - one from a normal
 * window, one from an incognito window - can still end with the second write
 * discarding the first. Derived state converges afterwards (both processes
 * rebuild from storage on the change event), but the lost mutation is gone.
 *
 * This is accepted rather than fixed: a genuine fix needs cross-process
 * compare-and-swap, which the API does not provide, and the window is a few
 * milliseconds in a single-user extension. Optimistic retry would narrow it
 * without closing it, at the cost of a re-read on every write.
 */
export async function saveState(state: StoredState): Promise<void> {
  // Record before awaiting: the change event can be delivered as soon as the
  // write lands, and it must not race a stale value.
  lastWritten = serializeForCompare(state);
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}
