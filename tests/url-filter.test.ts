/**
 * Exact-host DNR filter semantics.
 *
 * Chrome's matcher is native code, so these tests compile the regexFilter we
 * generate with JavaScript's own RegExp. JS regex is a superset of RE2 for the
 * constructs used here, so a pattern that behaves correctly under RegExp
 * expresses the intended matching - but that alone does NOT prove Chrome's RE2
 * implementation agrees, nor that it accepts the pattern at all.
 *
 * The current pattern was checked manually in Chrome: isRegexSupported
 * reported true, and the userinfo, port, fragment and subdomain cases below
 * behaved as asserted. Any change to the pattern's SHAPE invalidates that and
 * needs the manual pass repeated - these tests cannot catch an RE2 rejection.
 *
 * Every URL below is annotated by its REAL host as the URL parser sees it,
 * which is the property the rules are ultimately meant to track.
 */
import { describe, it, expect } from 'vitest';
import { buildRules, exactHostnameRegex } from '../src/core/rules.js';
import type { BlockedSite } from '../src/core/state.js';

/** Compile a generated regexFilter the way Chrome is asked to: case-insensitive. */
function matchesRegexFilter(filter: string, url: string): boolean {
  return new RegExp(filter, 'i').test(url);
}

function filtersFor(hostname: string): string[] {
  const site: BlockedSite = { hostname, kind: 'subdomain', temporarilyUnblockedUntil: null };
  return buildRules([site], Date.now()).map((r) => r.condition.regexFilter as string);
}

function blocks(hostname: string, url: string): boolean {
  return filtersFor(hostname).some((filter) => matchesRegexFilter(filter, url));
}

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
    'https://WWW.EXAMPLE.COM/',
    // Straight from host into query or fragment, with no path separator.
    'https://www.example.com?q=1',
    'https://www.example.com#x',
    'https://www.example.com:8443',
    // Empty port is valid and does not change the host.
    'https://www.example.com:/',
  ])('blocks %s', (url) => {
    expect(blocks(host, url)).toBe(true);
  });

  it.each([
    'https://example.com/',
    'https://foo.example.com/',
    'https://foo.www.example.com/',
    'https://www.example.com.evil.com/',
    'https://www.example.com..evil.com/',
    'https://wwwexample.com/',
    'https://evil.com/https://www.example.com',
    'https://notwww.example.com/',
  ])('does not block %s', (url) => {
    expect(blocks(host, url)).toBe(false);
  });

  it('emits a single rule covering both schemes', () => {
    expect(filtersFor(host)).toEqual([exactHostnameRegex(host)]);
  });

  it('does not match a different scheme', () => {
    expect(blocks(host, 'ftp://www.example.com/')).toBe(false);
  });

  it('anchors at the start so the host cannot appear mid-URL', () => {
    expect(blocks(host, 'https://other.com/?next=https://www.example.com/')).toBe(false);
  });
});

describe('userinfo is not mistaken for the host', () => {
  const host = 'www.example.com';

  // The bug this shape exists to prevent: `@` is a urlFilter `^` separator, so
  // an anchored `|https://www.example.com^` filter matched these even though
  // the host the browser actually connects to is evil.com.
  it.each([
    'https://www.example.com@evil.com/',
    'https://www.example.com:pass@evil.com/',
    'https://user:www.example.com@evil.com/',
    'https://www.example.com%40evil.com/',
  ])('does not block %s, whose real host is evil.com', (url) => {
    expect(blocks(host, url)).toBe(false);
  });

  // The inverse mistake: excluding userinfo outright would let anyone reach a
  // blocked site just by typing a username in front of it.
  it.each([
    'https://user@www.example.com/',
    'https://user:pw@www.example.com/',
    'https://evil.com@www.example.com/',
  ])('still blocks %s, whose real host is www.example.com', (url) => {
    expect(blocks(host, url)).toBe(true);
  });

  it('blocks when ? or # ends the host before an @ can begin userinfo', () => {
    // The real host here is www.example.com: the query/fragment starts first.
    expect(blocks(host, 'https://www.example.com?@evil.com/')).toBe(true);
    expect(blocks(host, 'https://www.example.com#@evil.com/')).toBe(true);
  });
});

describe('the trailing DNS root dot', () => {
  // parseHostnameInput and normalizeHostForMatching both strip it, so the rule
  // has to treat `example.com.` as the same host or DNR and the tab enforcer
  // would disagree.
  const host = 'www.example.com';

  it.each([
    'https://www.example.com./',
    'https://www.example.com.',
    'https://www.example.com.:8443/',
    'https://user@www.example.com.:8443/x',
  ])('blocks %s', (url) => {
    expect(blocks(host, url)).toBe(true);
  });

  it('does not let the optional dot swallow a further label', () => {
    expect(blocks(host, 'https://www.example.com.evil.com/')).toBe(false);
  });
});

describe('deep exact-subdomain hosts', () => {
  it('matches only the exact deep host', () => {
    expect(blocks('bar.foo.example.com', 'https://bar.foo.example.com/x')).toBe(true);
    expect(blocks('bar.foo.example.com', 'https://foo.example.com/x')).toBe(false);
    expect(blocks('bar.foo.example.com', 'https://baz.bar.foo.example.com/x')).toBe(false);
  });
});

describe('the generated pattern is a safe literal', () => {
  it('escapes dots so they cannot act as a wildcard', () => {
    // Without escaping, `www.example.com` would match `wwwXexampleXcom`.
    expect(blocks('www.example.com', 'https://wwwXexampleXcom/')).toBe(false);
  });

  it('escapes regex metacharacters rather than trusting the hostname parser', () => {
    // parseHostnameInput would never produce this, but the escaping must not
    // depend on that: the pattern has to stay a literal, and stay compilable.
    const pattern = exactHostnameRegex('a+b(c).com');
    expect(() => new RegExp(pattern)).not.toThrow();
    expect(new RegExp(pattern, 'i').test('https://a+b(c).com/')).toBe(true);
    expect(new RegExp(pattern, 'i').test('https://aab c.com/')).toBe(false);
  });

  it('does not escape the forward slash, which RE2 has no escape for', () => {
    expect(exactHostnameRegex('www.example.com')).not.toContain('\\/');
  });
});
