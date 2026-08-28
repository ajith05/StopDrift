/**
 * A single alarm for the earliest upcoming expiration.
 *
 * The alarm is only a wake-up hint - the stored timestamp is authoritative, so
 * a delayed or lost alarm is corrected by reconciliation on the next wake.
 */
import { nextExpiration } from '../core/exceptions.js';
import type { StoredState } from '../core/state.js';

export const EXPIRY_ALARM = 'stopdrift.expiry';

export async function scheduleNextExpiry(
  state: StoredState,
  now: number = Date.now(),
): Promise<void> {
  await chrome.alarms.clear(EXPIRY_ALARM);
  const next = nextExpiration(state.blockedSites, now);
  if (next === null) return;
  // Chrome clamps very short alarm delays; a minimum of ~1s keeps it valid.
  await chrome.alarms.create(EXPIRY_ALARM, { when: Math.max(next, now + 1000) });
}
