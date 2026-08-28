/**
 * THE canonical block-matching logic.
 *
 * Both the DNR rule generator and the open-tab enforcer derive their behavior
 * from this file. If matching semantics ever need to change, this is the only
 * place that should change.
 */
import { parseHostnameInput, type HostnameKind } from './hostname.js';

export interface BlockEntry {
  hostname: string;
  kind: HostnameKind;
}

/**
 * Does `host` fall under `entry`?
 *
 * apex      -> the domain itself and every descendant subdomain
 * subdomain -> that exact hostname only (no descendants, no parent)
 */
export function hostMatchesEntry(host: string, entry: BlockEntry): boolean {
  const target = normalizeHostForMatching(host);
  if (target === null) return false;
  const source = entry.hostname.toLowerCase().replace(/\.+$/, '');

  if (entry.kind === 'apex') {
    return target === source || target.endsWith(`.${source}`);
  }
  return target === source;
}

/** First entry in `entries` that blocks `host`, or null. */
export function findMatchingEntry<T extends BlockEntry>(host: string, entries: T[]): T | null {
  for (const entry of entries) {
    if (hostMatchesEntry(host, entry)) return entry;
  }
  return null;
}

/**
 * Extract the hostname from a full page URL for enforcement purposes.
 * Returns null for anything that is not an http(s) page, so extension pages,
 * chrome:// pages and file:// pages are never touched.
 */
export function hostnameFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return normalizeHostForMatching(parsed.hostname);
  } catch {
    return null;
  }
}

function normalizeHostForMatching(host: string): string | null {
  if (typeof host !== 'string') return null;
  const trimmed = host.trim().toLowerCase().replace(/\.+$/, '');
  return trimmed === '' ? null : trimmed;
}

/**
 * Classify an already-stored hostname string. Persisted/imported state is
 * treated as untrusted, so kind is always re-derived rather than trusted.
 */
export function deriveKind(hostname: string): HostnameKind | null {
  const parsed = parseHostnameInput(hostname);
  return parsed.ok ? parsed.kind : null;
}
