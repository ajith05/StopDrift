/**
 * Exact-host DNR filter semantics.
 *
 * Chrome's URL-filter matcher is native code, so these tests exercise a local
 * model of the documented syntax (`|` anchors the start of the URL, `^` is a
 * separator matching any character that is not a letter, digit, `_`, `-`, `.`
 * or `%`, and also matches the end of the URL).
 *
 * This proves the filter STRING we generate expresses exact-host matching. It
 * does NOT prove Chrome's implementation agrees - that requires the manual
 * browser checks listed in the README.
 */
import { describe, it, expect } from 'vitest';
import { buildRules } from '../src/core/rules.js';
import type { BlockedSite } from '../src/core/state.js';

/** Local model of Chrome's `|...^` urlFilter semantics. */
function matchesUrlFilter(filter: string, url: string): boolean {
  let pattern = filter;
  let anchoredStart = false;

  if (pattern.startsWith('|')) {
    anchoredStart = true;
    pattern = pattern.slice(1);
  }

  const separator = '[^a-zA-Z0-9_\\-.%]';
  let regex = '';
  for (const char of pattern) {
    if (char === '^') {
      // A separator character, or the end of the URL.
      regex += `(?:${separator}|$)`;
    } else if (char === '*') {
      regex += '.*';
    } else {
      regex += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }

  return new RegExp(`${anchoredStart ? '^' : ''}${regex}`).test(url);
}

function filtersFor(hostname: string): string[] {
  const site: BlockedSite = { hostname, kind: 'subdomain', temporarilyUnblockedUntil: null };
  return buildRules([site], Date.now()).map((r) => r.condition.urlFilter as string);
}

function blocks(hostname: string, url: string): boolean {
  return filtersFor(hostname).some((filter) => matchesUrlFilter(filter, url));
}

describe('the exact-host filter model behaves as documented', () => {
  it('matches a bare hostname URL', () => {
    expect(matchesUrlFilter('|https://www.example.com^', 'https://www.example.com/')).toBe(true);
  });

  it('treats end-of-URL as a separator', () => {
    expect(matchesUrlFilter('|https://www.example.com^', 'https://www.example.com')).toBe(true);
  });

  it('does not treat a dot as a separator', () => {
    // This is the property that stops foo.www.example.com from matching.
    expect(matchesUrlFilter('|https://www.example.com^', 'https://www.example.com.evil.com/')).toBe(
      false,
    );
  });
});

describe('exact-subdomain rules match only that hostname', () => {
  const host = 'www.example.com';

  it.each([
    'https://www.example.com/',
    'http://www.example.com/',
    'https://www.example.com',
    'https://www.example.com/some/path',
    'https://www.example.com/?q=1',
    'https://www.example.com:8443/',
    'http://www.example.com:8080/path',
    'https://www.example.com#frag',
  ])('blocks %s', (url) => {
    expect(blocks(host, url)).toBe(true);
  });

  it.each([
    'https://example.com/',
    'https://foo.example.com/',
    'https://foo.www.example.com/',
    'https://www.example.com.evil.com/',
    'https://wwwexample.com/',
    'https://evil.com/https://www.example.com',
    'https://notwww.example.com/',
  ])('does not block %s', (url) => {
    expect(blocks(host, url)).toBe(false);
  });

  it('covers both HTTP and HTTPS with separate anchored filters', () => {
    expect(filtersFor(host)).toEqual([
      '|http://www.example.com^',
      '|https://www.example.com^',
    ]);
  });

  it('does not match a different scheme', () => {
    expect(blocks(host, 'ftp://www.example.com/')).toBe(false);
  });

  it('anchors at the start so the host cannot appear mid-URL', () => {
    expect(blocks(host, 'https://other.com/?next=https://www.example.com/')).toBe(false);
  });
});

describe('deep exact-subdomain hosts', () => {
  it('matches only the exact deep host', () => {
    expect(blocks('bar.foo.example.com', 'https://bar.foo.example.com/x')).toBe(true);
    expect(blocks('bar.foo.example.com', 'https://foo.example.com/x')).toBe(false);
    expect(blocks('bar.foo.example.com', 'https://baz.bar.foo.example.com/x')).toBe(false);
  });
});
