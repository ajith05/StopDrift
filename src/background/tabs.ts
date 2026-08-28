/**
 * Open-tab enforcement.
 *
 * Tab URLs are read only to decide whether a tab must be redirected, and are
 * never stored, logged or transmitted. Uses the same canonical matcher as DNR
 * rule generation so open tabs and future navigations behave identically.
 */
import { findMatchingEntry, hostnameFromUrl } from '../core/matching.js';
import { activeBlocks } from '../core/exceptions.js';
import { blockedPagePath } from '../core/rules.js';
import type { StoredState } from '../core/state.js';

/**
 * Redirect every open http(s) tab currently sitting on an actively blocked
 * host. Requires host permissions to read tab URLs (no "tabs" permission).
 */
export async function enforceOpenTabs(
  state: StoredState,
  now: number = Date.now(),
): Promise<void> {
  const entries = activeBlocks(state.blockedSites, now);
  if (entries.length === 0) return;

  let tabs: chrome.tabs.Tab[];
  try {
    tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  } catch {
    return;
  }

  for (const tab of tabs) {
    if (tab.id === undefined || !tab.url) continue;
    const host = hostnameFromUrl(tab.url);
    if (host === null) continue;

    const match = findMatchingEntry(host, entries);
    if (!match) continue;

    try {
      await chrome.tabs.update(tab.id, {
        url: chrome.runtime.getURL(blockedPagePath(match.hostname)),
      });
    } catch {
      // Tab closed or is otherwise not updatable; nothing to recover.
    }
  }
}
