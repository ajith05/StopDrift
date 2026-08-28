/**
 * Thin chrome.storage.local adapter around the canonical schema.
 *
 * chrome.storage.local is shared between the regular and incognito processes,
 * so under `"incognito": "split"` both instances read and write the same
 * blocklist with no bridging required.
 */
import { STORAGE_KEY, normalizeState, type StoredState } from '../core/state.js';

export async function loadState(): Promise<StoredState> {
  const raw = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeState(raw?.[STORAGE_KEY]);
}

export async function saveState(state: StoredState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}
