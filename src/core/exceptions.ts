/**
 * Temporary-unblock expiration logic.
 *
 * The stored absolute timestamp is authoritative; alarms are only a wake-up
 * hint. Everything here is pure so expiry can be tested without fake timers.
 */
import type { BlockedSite } from './state.js';

/** Is this entry currently exempt from blocking at time `now`? */
export function isTemporarilyUnblocked(site: BlockedSite, now: number): boolean {
  return site.temporarilyUnblockedUntil !== null && site.temporarilyUnblockedUntil > now;
}

/** Entries whose blocking rules should currently exist. */
export function activeBlocks(sites: BlockedSite[], now: number): BlockedSite[] {
  return sites.filter((s) => !isTemporarilyUnblocked(s, now));
}

export interface ExpirationSweep {
  sites: BlockedSite[];
  /** Hostnames whose exception just lapsed - these need tab enforcement. */
  expired: string[];
  changed: boolean;
}

/**
 * Clear every exception at or past its timestamp. Correct regardless of how
 * late it runs, so a machine that slept through an expiry still restores the
 * block on wake without extending the exception.
 */
export function sweepExpired(sites: BlockedSite[], now: number): ExpirationSweep {
  const expired: string[] = [];
  const next = sites.map((site) => {
    if (site.temporarilyUnblockedUntil !== null && site.temporarilyUnblockedUntil <= now) {
      expired.push(site.hostname);
      return { ...site, temporarilyUnblockedUntil: null };
    }
    return site;
  });
  return { sites: next, expired, changed: expired.length > 0 };
}

/**
 * Earliest still-future expiration, or null when no exception is active.
 * A single alarm for this timestamp replaces per-hostname alarms.
 */
export function nextExpiration(sites: BlockedSite[], now: number): number | null {
  let earliest: number | null = null;
  for (const site of sites) {
    const until = site.temporarilyUnblockedUntil;
    if (until !== null && until > now && (earliest === null || until < earliest)) {
      earliest = until;
    }
  }
  return earliest;
}

/** Whole minutes remaining, rounded up, for display only. */
export function minutesRemaining(site: BlockedSite, now: number): number {
  if (!isTemporarilyUnblocked(site, now)) return 0;
  return Math.max(1, Math.ceil(((site.temporarilyUnblockedUntil as number) - now) / 60000));
}

export function formatRemaining(site: BlockedSite, now: number): string {
  const total = minutesRemaining(site, now);
  if (total < 60) return `${total} more minute${total === 1 ? '' : 's'}`;
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  const hourPart = `${hours} hour${hours === 1 ? '' : 's'}`;
  return mins === 0 ? `${hourPart} more` : `${hourPart} ${mins} min more`;
}
