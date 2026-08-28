/**
 * Tests for the popup's "block the current tab" decision logic.
 *
 * Pure logic only. Whether chrome.tabs.query actually returns the active tab's
 * URL in a popup - and whether it does so in an incognito window - is a browser
 * behavior these tests cannot exercise; see the manual checklist in the README.
 */
import { describe, expect, it } from 'vitest';
import { evaluateCurrentTab } from '../src/core/current-tab.js';
import type { BlockedSite } from '../src/core/state.js';

function site(hostname: string, kind: 'apex' | 'subdomain' = 'apex'): BlockedSite {
  return { hostname, kind, temporarilyUnblockedUntil: null };
}

describe('evaluateCurrentTab', () => {
  it('offers an apex domain with apex scope', () => {
    const result = evaluateCurrentTab('https://reddit.com/r/all', []);
    expect(result).toEqual({
      status: 'blockable',
      hostname: 'reddit.com',
      kind: 'apex',
      apex: 'reddit.com',
      scope: 'This will block reddit.com and all of its subdomains.',
    });
  });

  it('offers the exact hostname for a subdomain, not its apex', () => {
    // The shortcut must match what typing the same URL would produce; silently
    // widening news.ycombinator.com to ycombinator.com would block more than
    // the user asked for.
    const result = evaluateCurrentTab('https://news.ycombinator.com/item?id=1', []);
    expect(result).toMatchObject({
      status: 'blockable',
      hostname: 'news.ycombinator.com',
      kind: 'subdomain',
      apex: 'ycombinator.com',
      scope: 'This will block only this exact hostname.',
    });
  });

  it('ignores path, port, query and fragment', () => {
    const result = evaluateCurrentTab('http://EXAMPLE.com:8080/a/b?c=d#e', []);
    expect(result).toMatchObject({ status: 'blockable', hostname: 'example.com' });
  });

  it('reports an exact entry as already blocked', () => {
    const result = evaluateCurrentTab('https://reddit.com/', [site('reddit.com')]);
    expect(result).toEqual({
      status: 'already-blocked',
      hostname: 'reddit.com',
      coveredBy: 'reddit.com',
    });
  });

  it('reports a subdomain covered by an apex entry as already blocked', () => {
    const result = evaluateCurrentTab('https://old.reddit.com/', [site('reddit.com')]);
    expect(result).toEqual({
      status: 'already-blocked',
      hostname: 'old.reddit.com',
      coveredBy: 'reddit.com',
    });
  });

  it('still offers a sibling subdomain when only one exact subdomain is blocked', () => {
    const result = evaluateCurrentTab('https://new.reddit.com/', [
      site('old.reddit.com', 'subdomain'),
    ]);
    expect(result).toMatchObject({ status: 'blockable', hostname: 'new.reddit.com' });
  });

  it('offers the apex when only a subdomain beneath it is blocked', () => {
    const result = evaluateCurrentTab('https://reddit.com/', [
      site('old.reddit.com', 'subdomain'),
    ]);
    expect(result).toMatchObject({ status: 'blockable', hostname: 'reddit.com' });
  });

  it('treats a temporarily unblocked site as already blocked', () => {
    // It is still on the blocklist; ending the exception is the options page's
    // "Block Now" action, not a second add.
    const result = evaluateCurrentTab('https://reddit.com/', [
      { hostname: 'reddit.com', kind: 'apex', temporarilyUnblockedUntil: Date.now() + 60000 },
    ]);
    expect(result).toMatchObject({ status: 'already-blocked', coveredBy: 'reddit.com' });
  });

  it.each([
    ['chrome://extensions/', 'chrome scheme'],
    ['chrome-extension://abc/blocked.html?domain=reddit.com', 'our own blocked page'],
    ['file:///C:/notes.txt', 'file scheme'],
    ['about:blank', 'about scheme'],
    ['view-source:https://example.com', 'view-source'],
  ])('marks %s unavailable (%s)', (url) => {
    expect(evaluateCurrentTab(url, [])).toEqual({
      status: 'unavailable',
      reason: 'This page cannot be blocked.',
    });
  });

  it.each([undefined, null, '', '   ', 'not a url'])(
    'marks a missing or unparseable url unavailable (%s)',
    (url) => {
      expect(evaluateCurrentTab(url as string | undefined, [])).toMatchObject({
        status: 'unavailable',
      });
    },
  );

  it('rejects an IP-address host with the parser reason', () => {
    const result = evaluateCurrentTab('http://192.168.1.1/admin', []);
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.reason).toContain('IP addresses');
  });

  it('rejects a localhost host with the parser reason', () => {
    const result = evaluateCurrentTab('http://localhost:3000/', []);
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.reason).toContain('special-use');
  });

  it('rejects a single-label intranet host', () => {
    const result = evaluateCurrentTab('http://intranet/home', []);
    expect(result.status).toBe('rejected');
  });
});
