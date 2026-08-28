/**
 * "Block the site I'm looking at" decision logic.
 *
 * The popup offers a one-click shortcut for the tab the user is currently on.
 * This module decides what that button should say and do for a given tab URL,
 * with no Chrome APIs involved so it can be tested directly.
 *
 * It is a shortcut over the existing add path, not a second one: the hostname
 * offered here is exactly what typing the same URL into the popup's text box
 * would produce, because both go through `parseHostnameInput`. Likewise the
 * already-blocked check delegates to the canonical matcher, so an apex entry
 * correctly suppresses the button on all of its subdomains.
 */
import { describeScope, parseHostnameInput, type HostnameKind } from './hostname.js';
import { findMatchingEntry } from './matching.js';
import type { BlockedSite } from './state.js';

export type CurrentTabState =
  /** A real public hostname that is not blocked yet: offer the button. */
  | {
      status: 'blockable';
      hostname: string;
      kind: HostnameKind;
      apex: string;
      /** Same wording as the manual add preview. */
      scope: string;
    }
  /** Not a page we could ever block (extension pages, chrome://, file://). */
  | { status: 'unavailable'; reason: string }
  /** An http(s) page whose host is not blockable (IP address, localhost). */
  | { status: 'rejected'; reason: string }
  /** Already covered, either exactly or by an apex entry above it. */
  | { status: 'already-blocked'; hostname: string; coveredBy: string };

const UNAVAILABLE = 'This page cannot be blocked.';

/**
 * Classify the active tab's URL against the current blocklist.
 *
 * `url` is whatever chrome.tabs reported, which may be undefined when the tab
 * is still loading or when the page is one we have no host access to.
 */
export function evaluateCurrentTab(
  url: string | undefined | null,
  blockedSites: BlockedSite[],
): CurrentTabState {
  if (typeof url !== 'string' || url.trim() === '') {
    return { status: 'unavailable', reason: UNAVAILABLE };
  }

  // Only http(s) pages are candidates. Anything else - chrome://, file://,
  // about:, and our own chrome-extension:// blocked page - is not a website the
  // blocker can act on, and parseHostnameInput would otherwise report a
  // confusing scheme error for it.
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { status: 'unavailable', reason: UNAVAILABLE };
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return { status: 'unavailable', reason: UNAVAILABLE };
  }

  const parsed = parseHostnameInput(parsedUrl.hostname);
  if (!parsed.ok) {
    // A real site that simply is not blockable (an IP address, an intranet
    // name). The parser's own message is more specific than anything we could
    // write here.
    return { status: 'rejected', reason: parsed.message };
  }

  // Covers both the exact-duplicate case and the covering-apex case; the
  // service worker would reject either one, so the button must not offer them.
  const covering = findMatchingEntry(parsed.hostname, blockedSites);
  if (covering) {
    return {
      status: 'already-blocked',
      hostname: parsed.hostname,
      coveredBy: covering.hostname,
    };
  }

  return {
    status: 'blockable',
    hostname: parsed.hostname,
    kind: parsed.kind,
    apex: parsed.apex,
    scope: describeScope(parsed.kind, parsed.hostname),
  };
}
