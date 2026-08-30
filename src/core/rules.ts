/**
 * Deterministic DNR rule generation.
 *
 * The entire dynamic ruleset is rebuilt from storage whenever block state
 * changes, so rule IDs are ephemeral implementation details assigned by
 * position. They are never persisted or exported.
 */
import type { BlockedSite } from './state.js';
import { activeBlocks } from './exceptions.js';

/** Rule IDs start at 1; Chrome requires positive integers. */
export const FIRST_RULE_ID = 1;

export const BLOCKED_PAGE_PATH = 'blocked.html';

export interface GeneratedRule {
  id: number;
  priority: number;
  action: {
    type: 'redirect';
    redirect: { extensionPath: string };
  };
  condition: {
    resourceTypes: ['main_frame'];
    requestDomains?: string[];
    regexFilter?: string;
    isUrlFilterCaseSensitive?: boolean;
  };
}

/**
 * Escape a string for literal use inside a regular expression.
 *
 * `/` is deliberately NOT escaped: RE2 has no delimiter, so `\/` is not a
 * defined escape sequence. Stored hostnames are already restricted to
 * [a-z0-9-.] by parseHostnameInput, so in practice only `.` is ever escaped -
 * but escaping defensively means this does not silently depend on that.
 */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Regex matching http(s) URLs whose host is exactly `hostname`.
 *
 *   ^https?://          both schemes, anchored at the start of the URL
 *   (?:[^/@]*@)?        optional userinfo. Excluding `/` and `@` is what stops
 *                       `https://www.example.com@evil.com/` from matching,
 *                       while still blocking `https://user@www.example.com/`,
 *                       where the real host IS the blocked one.
 *   <hostname>\.?       the host, allowing the optional trailing DNS root dot
 *                       that parseHostnameInput and normalizeHostForMatching
 *                       both strip, so all three agree on `example.com.`
 *   (?::[0-9]*)?        optional port, possibly empty (`https://host:/`)
 *   (?:[/?#]|$)         a real host boundary: a URL may run straight from the
 *                       host into `?` or `#` with no slash.
 *
 * A host boundary is deliberately expressed here rather than with a urlFilter
 * `^` separator: that class also contains `@`, which made userinfo look like
 * the end of the host.
 */
export function exactHostnameRegex(hostname: string): string {
  return `^https?://(?:[^/@]*@)?${escapeRegex(hostname)}\\.?(?::[0-9]*)?(?:[/?#]|$)`;
}

/**
 * Redirect target for an entry. Only the blocklist entry travels in the query
 * string - never the URL the user actually attempted.
 */
export function blockedPagePath(hostname: string): string {
  return `/${BLOCKED_PAGE_PATH}?domain=${encodeURIComponent(hostname)}`;
}

/**
 * Build the complete ruleset for the currently active blocks.
 *
 * apex entries use `requestDomains`, whose matching already includes every
 * subdomain. Exact-subdomain entries use a single anchored `regexFilter`
 * covering both schemes - see exactHostnameRegex for the shape and why a
 * urlFilter separator is not good enough for a host boundary.
 *
 * regexFilter rules draw on their own quota, separate from the dynamic rule
 * limit: MAX_NUMBER_OF_REGEX_RULES, measured at 1000 in Chrome. Only
 * exact-subdomain entries consume it, one rule each, so the ceiling is 1000
 * such entries - far beyond a personal blocklist, but not unbounded.
 */
export function buildRules(sites: BlockedSite[], now: number): GeneratedRule[] {
  const rules: GeneratedRule[] = [];
  let id = FIRST_RULE_ID;

  for (const site of activeBlocks(sites, now)) {
    const redirect = { extensionPath: blockedPagePath(site.hostname) };

    if (site.kind === 'apex') {
      rules.push({
        id: id++,
        priority: 1,
        action: { type: 'redirect', redirect },
        condition: {
          resourceTypes: ['main_frame'],
          requestDomains: [site.hostname],
        },
      });
    } else {
      rules.push({
        id: id++,
        priority: 1,
        action: { type: 'redirect', redirect },
        condition: {
          resourceTypes: ['main_frame'],
          regexFilter: exactHostnameRegex(site.hostname),
          // Explicit: hostnames are case-insensitive, and the MV3 default for
          // this field has not been stable across Chrome versions. It governs
          // regexFilter as well as urlFilter.
          isUrlFilterCaseSensitive: false,
        },
      });
    }
  }

  return rules;
}
