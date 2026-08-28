/**
 * Synchronizes the dynamic DNR ruleset with stored state.
 *
 * The ruleset is always replaced wholesale, which keeps the operation
 * idempotent and lets us recover from any partial/stale rule state.
 */
import { buildRules } from '../core/rules.js';
import type { StoredState } from '../core/state.js';

/**
 * Tail of the in-flight sync chain, so syncs never overlap.
 *
 * A sync is read-then-write with an await in between: it reads the existing
 * ruleset, then replaces it. Two overlapping calls would both observe the same
 * "existing" list, so the second one's removeRuleIds would not mention the
 * rules the first had just added - and Chrome rejects the whole update with
 * "Rule with id 1 does not have a unique ID."
 *
 * That happens in normal use, because several triggers are fire-and-forget:
 * an alarm, a storage change from the other process, a fresh worker
 * activation and a popup command can all land within the same tick.
 *
 * Serializing here rather than at the call sites means every path is covered,
 * including `void repair()`. Rule generation is deterministic and the ruleset
 * is replaced wholesale, so a queued sync that lands after a newer one simply
 * rewrites the same rules - stale ordering cannot corrupt the result.
 */
let chain: Promise<void> = Promise.resolve();

export function syncRules(state: StoredState, now: number = Date.now()): Promise<void> {
  // Attach to the tail even if a previous sync rejected, so one failure does
  // not wedge every future sync. Each caller still sees its own outcome.
  const next = chain.catch(() => undefined).then(() => performSync(state, now));
  chain = next.catch(() => undefined);
  return next;
}

async function performSync(state: StoredState, now: number): Promise<void> {
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
