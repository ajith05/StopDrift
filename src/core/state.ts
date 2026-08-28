/**
 * The canonical persisted schema plus defensive validation.
 *
 * chrome.storage.local holds this object and nothing else. DNR rules and the
 * expiration alarm are derived state, always rebuildable from here.
 */
import { deriveKind } from './matching.js';
import { sortSites } from './blocklist.js';
import type { HostnameKind } from './hostname.js';

/**
 * Version of the shape persisted in chrome.storage.local.
 *
 * Deliberately NOT the extension's semver version, and not the version stamped
 * into export files - see core/version.ts. Storage is only ever read by the
 * build that wrote it, so it needs migration, not compatibility gating. This
 * increments only when the stored shape itself changes, which is expected to be
 * rare: it may stay at 1 while the extension reaches 3.x.
 *
 * TODO(migrations): this value is currently written but never read.
 * normalizeState() below is structurally defensive - it validates every field on
 * its merits and re-derives what it can - which already absorbs added or removed
 * fields without needing a version at all.
 *
 * It does NOT absorb a *semantic* change, where old data stays structurally
 * valid but means something different. For example, renaming
 * `temporaryUnblockMinutes` to `temporaryUnblockSeconds`: a stored 60 is still a
 * valid integer in range, so it would be accepted silently and a 60-minute
 * exception would quietly become 60 seconds.
 *
 * When such a change is first needed, bump this constant and have
 * normalizeState() read the stored value and run ordered forward migrations
 * (1->2, 2->3, ...) so any starting version composes to current. If the stored
 * version is NEWER than this build understands (the user downgraded), still run
 * normalizeState rather than discarding: it cannot know what changed, but
 * salvaging every recognisable field beats wiping someone's blocklist.
 */
export const SCHEMA_VERSION = 1 as const;
export const STORAGE_KEY = 'stopdrift.state';

export const DEFAULT_TEMPORARY_MINUTES = 60;
export const MIN_TEMPORARY_MINUTES = 1;
export const MAX_TEMPORARY_MINUTES = 1440;

/** `auto` follows the device's light/dark setting. */
export const THEMES = ['auto', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];
export const DEFAULT_THEME: Theme = 'auto';

export function isValidTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

export interface BlockedSite {
  hostname: string;
  /** Re-derived from the hostname on load; never trusted from disk. */
  kind: HostnameKind;
  /** Absolute epoch-ms expiry, or null when actively blocked. */
  temporarilyUnblockedUntil: number | null;
}

export interface Settings {
  temporaryUnblockMinutes: number;
  theme: Theme;
}

export interface StoredState {
  schemaVersion: typeof SCHEMA_VERSION;
  blockedSites: BlockedSite[];
  settings: Settings;
}

export function defaultState(): StoredState {
  return {
    schemaVersion: SCHEMA_VERSION,
    blockedSites: [],
    settings: { temporaryUnblockMinutes: DEFAULT_TEMPORARY_MINUTES, theme: DEFAULT_THEME },
  };
}

export function isValidDuration(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_TEMPORARY_MINUTES &&
    value <= MAX_TEMPORARY_MINUTES
  );
}

export function clampDuration(value: number): number {
  return Math.min(MAX_TEMPORARY_MINUTES, Math.max(MIN_TEMPORARY_MINUTES, Math.round(value)));
}

/**
 * Coerce anything read from storage into a valid state object, discarding
 * entries that no longer parse. Never throws - a corrupt profile degrades to
 * defaults rather than bricking the extension.
 */
export function normalizeState(raw: unknown): StoredState {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;
  const candidate = raw as Partial<StoredState>;

  const settings = candidate.settings;
  if (settings && isValidDuration(settings.temporaryUnblockMinutes)) {
    base.settings.temporaryUnblockMinutes = settings.temporaryUnblockMinutes;
  }
  // An unknown or missing theme falls back to the default rather than
  // rendering the UI with an invalid value.
  if (settings && isValidTheme(settings.theme)) {
    base.settings.theme = settings.theme;
  }

  if (!Array.isArray(candidate.blockedSites)) return base;

  const seen = new Set<string>();
  const sites: BlockedSite[] = [];

  for (const entry of candidate.blockedSites) {
    if (!entry || typeof entry !== 'object') continue;
    const hostname = (entry as BlockedSite).hostname;
    if (typeof hostname !== 'string') continue;

    const normalized = hostname.trim().toLowerCase().replace(/\.+$/, '');
    if (normalized === '' || seen.has(normalized)) continue;

    // Kind is always re-derived so a hand-edited storage file cannot turn an
    // exact-subdomain block into an apex block (or vice versa).
    const kind = deriveKind(normalized);
    if (kind === null) continue;

    const until = (entry as BlockedSite).temporarilyUnblockedUntil;
    const validUntil =
      typeof until === 'number' && Number.isFinite(until) && until > 0 ? until : null;

    seen.add(normalized);
    sites.push({ hostname: normalized, kind, temporarilyUnblockedUntil: validUntil });
  }

  base.blockedSites = sortSites(sites);
  return base;
}
