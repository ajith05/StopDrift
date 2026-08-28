/**
 * Service worker: the single coordinator for all state changes.
 *
 * Every mutation follows the same shape - mutate state, persist it, rebuild DNR
 * rules, reschedule the alarm, enforce open tabs. That order keeps storage
 * authoritative and makes each operation idempotent and safe to repeat after an
 * MV3 service-worker suspension.
 */
import { lastWrittenValue, loadState, saveState } from './storage.js';
import { syncRules } from './dnr.js';
import { EXPIRY_ALARM, scheduleNextExpiry } from './alarms.js';
import { enforceOpenTabs } from './tabs.js';
import { parseHostnameInput } from '../core/hostname.js';
import { addToBlocklist, removeFromBlocklist, sortSites } from '../core/blocklist.js';
import { sweepExpired } from '../core/exceptions.js';
import { importFromJson } from '../core/transfer.js';
import { isComplete } from '../core/challenge.js';
import { permanentChallengeText, temporaryChallengeText } from '../core/templates.js';
import {
  clampDuration,
  isValidDuration,
  isValidTheme,
  STORAGE_KEY,
  type StoredState,
} from '../core/state.js';
import { shouldRebuild } from '../core/sync.js';
import type { Command, CommandResponse } from '../core/protocol.js';

/** Persist + rebuild all derived state (DNR rules, alarm) from storage. */
async function commit(state: StoredState, now: number, enforceTabs: boolean): Promise<void> {
  await saveState(state);
  await syncRules(state, now);
  await scheduleNextExpiry(state, now);
  if (enforceTabs) await enforceOpenTabs(state, now);
}

/**
 * Load state, clear anything that expired while we were suspended, and repair
 * derived state. Safe to call on every wake.
 */
async function reconcile(now: number = Date.now()): Promise<StoredState> {
  const loaded = await loadState();
  const sweep = sweepExpired(loaded.blockedSites, now);
  if (!sweep.changed) return loaded;

  // Something lapsed while we were away: persist the sweep, rebuild rules and
  // immediately re-enforce the restored blocks against open tabs.
  const state: StoredState = { ...loaded, blockedSites: sweep.sites };
  await commit(state, now, true);
  return state;
}

/**
 * Full repair of derived state, used on startup/install and when an alarm
 * fires. Unlike `reconcile` this rewrites DNR rules and the alarm even when
 * nothing expired, which is what recovers from a lost alarm or a ruleset that
 * drifted out of sync with storage.
 */
async function repair(now: number = Date.now()): Promise<void> {
  const loaded = await loadState();
  const sweep = sweepExpired(loaded.blockedSites, now);
  const state: StoredState = { ...loaded, blockedSites: sweep.sites };

  // Rebuild derived state, but only write storage when the sweep actually
  // changed something. repair() is triggered by storage.onChanged, so an
  // unconditional write here would emit another change event and repair
  // itself forever. The echo guard in core/sync.ts is the second line of
  // defense; this is the first, and unlike the guard it does not depend on
  // module state that a service-worker suspension discards.
  if (sweep.changed) {
    await commit(state, now, true);
    return;
  }

  await syncRules(state, now);
  await scheduleNextExpiry(state, now);
  await enforceOpenTabs(state, now);
}

function pluralize(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

async function handle(command: Command): Promise<CommandResponse> {
  const now = Date.now();

  switch (command.type) {
    case 'getState': {
      const state = await reconcile(now);
      return { ok: true, snapshot: { state, now: Date.now() } };
    }

    case 'addBlock': {
      const parsed = parseHostnameInput(command.input);
      if (!parsed.ok) return { ok: false, error: parsed.message };

      const state = await reconcile(now);
      const outcome = addToBlocklist(state.blockedSites, parsed.hostname, parsed.kind);
      if (outcome.status !== 'added') return { ok: false, error: outcome.message };

      const next: StoredState = { ...state, blockedSites: outcome.sites };
      await commit(next, now, true);

      const count = outcome.consolidated.length;
      const extra =
        count > 0
          ? ` Removed ${count} now-redundant ${pluralize(count, 'entry', 'entries')}: ${outcome.consolidated.join(', ')}.`
          : '';
      return {
        ok: true,
        snapshot: { state: next, now: Date.now() },
        message: `${parsed.hostname} is now blocked.${extra}`,
      };
    }

    case 'temporaryUnblock': {
      const state = await reconcile(now);
      const site = state.blockedSites.find((s) => s.hostname === command.hostname);
      if (!site) return { ok: false, error: 'That hostname is not on your blocklist.' };

      // Re-validate here so the challenge cannot be bypassed by a page that
      // simply enables its own confirm button.
      if (!isComplete(command.challenge, temporaryChallengeText(site.hostname))) {
        return { ok: false, error: 'The typed confirmation did not match exactly.' };
      }

      const minutes = state.settings.temporaryUnblockMinutes;
      const until = now + minutes * 60000;
      const next: StoredState = {
        ...state,
        blockedSites: state.blockedSites.map((s) =>
          s.hostname === site.hostname ? { ...s, temporarilyUnblockedUntil: until } : s,
        ),
      };
      await commit(next, now, false);
      return {
        ok: true,
        snapshot: { state: next, now: Date.now() },
        message: `${site.hostname} is unblocked for ${minutes} ${pluralize(minutes, 'minute', 'minutes')}.`,
      };
    }

    case 'endTemporaryUnblock': {
      const state = await reconcile(now);
      const next: StoredState = {
        ...state,
        blockedSites: state.blockedSites.map((s) =>
          s.hostname === command.hostname ? { ...s, temporarilyUnblockedUntil: null } : s,
        ),
      };
      // Blocking again is always easy: no challenge, immediate tab enforcement.
      await commit(next, now, true);
      return {
        ok: true,
        snapshot: { state: next, now: Date.now() },
        message: `${command.hostname} is blocked again.`,
      };
    }

    case 'removeBlock': {
      const state = await reconcile(now);
      const site = state.blockedSites.find((s) => s.hostname === command.hostname);
      if (!site) return { ok: false, error: 'That hostname is not on your blocklist.' };

      if (!isComplete(command.challenge, permanentChallengeText(site.hostname))) {
        return { ok: false, error: 'The typed confirmation did not match exactly.' };
      }

      const next: StoredState = {
        ...state,
        blockedSites: removeFromBlocklist(state.blockedSites, site.hostname),
      };
      await commit(next, now, false);
      return {
        ok: true,
        snapshot: { state: next, now: Date.now() },
        message: `${site.hostname} was permanently removed from your blocklist.`,
      };
    }

    case 'setDuration': {
      if (!isValidDuration(command.minutes)) {
        return { ok: false, error: 'Enter a whole number of minutes between 1 and 1440.' };
      }
      const state = await reconcile(now);
      // Active exceptions keep their original absolute timestamp.
      const next: StoredState = {
        ...state,
        settings: { ...state.settings, temporaryUnblockMinutes: clampDuration(command.minutes) },
      };
      await commit(next, now, false);
      return {
        ok: true,
        snapshot: { state: next, now: Date.now() },
        message: `Temporary unblocks will now last ${
          next.settings.temporaryUnblockMinutes
        } ${pluralize(next.settings.temporaryUnblockMinutes, 'minute', 'minutes')}.`,
      };
    }

    case 'setTheme': {
      if (!isValidTheme(command.theme)) {
        return { ok: false, error: 'Unknown theme.' };
      }
      const state = await reconcile(now);
      // Presentation only: no DNR rules or alarms depend on this, but it is
      // routed through the worker so storage has a single writer.
      const next: StoredState = {
        ...state,
        settings: { ...state.settings, theme: command.theme },
      };
      await saveState(next);
      return { ok: true, snapshot: { state: next, now: Date.now() } };
    }

    case 'importJson': {
      const state = await reconcile(now);
      const result = importFromJson(command.text, state);
      if (!result.ok) return { ok: false, error: result.error };

      const next: StoredState = {
        ...result.state,
        blockedSites: sortSites(result.state.blockedSites),
      };
      await commit(next, now, true);
      return { ok: true, snapshot: { state: next, now: Date.now() }, summary: result.summary };
    }

    case 'getIncognitoStatus': {
      const incognitoEnabled = await chrome.extension.isAllowedIncognitoAccess();
      return { ok: true, incognitoEnabled };
    }

    default:
      return { ok: false, error: 'Unknown command.' };
  }
}

chrome.runtime.onMessage.addListener((command: Command, _sender, sendResponse) => {
  handle(command)
    .then(sendResponse)
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Unexpected error.',
      });
    });
  // Keep the message channel open for the async response.
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== EXPIRY_ALARM) return;
  // repair() clears everything already expired, restores the DNR rules,
  // re-enforces open tabs and schedules the next expiration.
  void repair();
});

/**
 * Cross-process propagation.
 *
 * Under `"incognito": "split"` there are two service workers with two separate
 * DNR rulesets and two separate views of open tabs, but one shared storage
 * area. A command handled in one process therefore leaves the other enforcing
 * a stale blocklist. storage.onChanged fires in BOTH processes, so each side
 * rebuilds its own derived state from the shared authority.
 *
 * shouldRebuild() skips this process's own echo of the write it just made -
 * commit() already rebuilt everything synchronously, and acting again would
 * double every DNR write and tab query. See core/sync.ts.
 */
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (!shouldRebuild(areaName, changes, STORAGE_KEY, lastWrittenValue())) return;
  void repair();
});

chrome.runtime.onStartup.addListener(() => void repair());
chrome.runtime.onInstalled.addListener(() => void repair());

// A fresh service-worker activation also repairs derived state, covering the
// case where the worker was revived by an event after an alarm was lost or
// delayed, or after the machine woke from sleep.
void repair();
