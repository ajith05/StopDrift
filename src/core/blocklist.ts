/**
 * Blocklist mutation rules: duplicates, apex/subdomain redundancy and
 * consolidation. Pure functions over plain arrays - no storage, no Chrome APIs.
 */
import type { BlockedSite } from './state.js';
import { hostMatchesEntry } from './matching.js';
import type { HostnameKind } from './hostname.js';

export type AddOutcome =
  | { status: 'added'; sites: BlockedSite[]; hostname: string; consolidated: string[] }
  | { status: 'duplicate'; hostname: string; message: string }
  | { status: 'covered'; hostname: string; coveredBy: string; message: string };

/**
 * Insert a validated hostname into the blocklist.
 *
 * - exact duplicate            -> rejected, nothing changes
 * - already covered by an apex -> rejected as redundant
 * - apex covering existing subdomain entries -> added, those entries removed
 *   (protection broadens, so this needs no permanent-deletion challenge)
 */
export function addToBlocklist(
  sites: BlockedSite[],
  hostname: string,
  kind: HostnameKind,
): AddOutcome {
  const existingExact = sites.find((s) => s.hostname === hostname);
  if (existingExact) {
    return {
      status: 'duplicate',
      hostname,
      message: `${hostname} is already on your blocklist.`,
    };
  }

  // Any apex entry that already covers this hostname makes it redundant.
  const coveringApex = sites.find(
    (s) => s.kind === 'apex' && s.hostname !== hostname && hostMatchesEntry(hostname, s),
  );
  if (coveringApex) {
    return {
      status: 'covered',
      hostname,
      coveredBy: coveringApex.hostname,
      message: `${hostname} is already blocked by the rule for ${coveringApex.hostname}.`,
    };
  }

  const newEntry: BlockedSite = { hostname, kind, temporarilyUnblockedUntil: null };

  // Adding an apex makes existing exact-subdomain entries beneath it redundant.
  const consolidated = sites
    .filter((s) => hostMatchesEntry(s.hostname, newEntry) && s.hostname !== hostname)
    .map((s) => s.hostname);

  const remaining = sites.filter((s) => !consolidated.includes(s.hostname));

  return {
    status: 'added',
    sites: sortSites([...remaining, newEntry]),
    hostname,
    consolidated,
  };
}

/** Remove an entry outright. Callers must have completed the typing challenge. */
export function removeFromBlocklist(sites: BlockedSite[], hostname: string): BlockedSite[] {
  return sites.filter((s) => s.hostname !== hostname);
}

/** Alphabetical order, used for both storage and display. */
export function sortSites(sites: BlockedSite[]): BlockedSite[] {
  return [...sites].sort((a, b) => a.hostname.localeCompare(b.hostname));
}
