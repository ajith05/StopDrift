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
    urlFilter?: string;
    isUrlFilterCaseSensitive?: boolean;
  };
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
 * subdomain. Exact-subdomain entries instead use anchored URL filters, one per
 * scheme: `|https://www.example.com^`. The leading `|` anchors to the start of
 * the URL and `^` is a separator that matches `/`, `:`, `?` or end-of-URL, so
 * paths and ports still match while `foo.www.example.com` and
 * `www.example.com.evil.com` do not.
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
      for (const scheme of ['http', 'https'] as const) {
        rules.push({
          id: id++,
          priority: 1,
          action: { type: 'redirect', redirect },
          condition: {
            resourceTypes: ['main_frame'],
            urlFilter: `|${scheme}://${site.hostname}^`,
            // Explicit: hostnames are case-insensitive, and the MV3 default for
            // this field has not been stable across Chrome versions.
            isUrlFilterCaseSensitive: false,
          },
        });
      }
    }
  }

  return rules;
}
