/**
 * Synchronizes the dynamic DNR ruleset with stored state.
 *
 * The ruleset is always replaced wholesale, which keeps the operation
 * idempotent and lets us recover from any partial/stale rule state.
 */
import { buildRules } from '../core/rules.js';
import type { StoredState } from '../core/state.js';

export async function syncRules(state: StoredState, now: number = Date.now()): Promise<void> {
  const desired = buildRules(state.blockedSites, now);
  const existing = await chrome.declarativeNetRequest.getDynamicRules();

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map((rule) => rule.id),
      addRules: desired as unknown as chrome.declarativeNetRequest.Rule[],
    });
  } catch (error) {
    // Surface the failure rather than letting storage and rules drift apart
    // silently. Storage is unchanged, so a later sync can still repair things.
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not update blocking rules: ${detail}`);
  }
}
