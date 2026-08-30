import { describe, it, expect } from 'vitest';
import { hostMatchesEntry, findMatchingEntry, hostnameFromUrl, deriveKind } from '../src/core/matching.js';
import { buildRules, blockedPagePath, exactHostnameRegex } from '../src/core/rules.js';
import type { BlockedSite } from '../src/core/state.js';

const apex = { hostname: 'example.com', kind: 'apex' as const };
const sub = { hostname: 'www.example.com', kind: 'subdomain' as const };

describe('apex blocks cover the domain and every subdomain', () => {
  it.each(['example.com', 'www.example.com', 'foo.example.com', 'a.b.example.com', 'deep.a.b.example.com'])(
    'blocks %s',
    (host) => {
      expect(hostMatchesEntry(host, apex)).toBe(true);
    },
  );

  it.each(['example.org', 'notexample.com', 'example.com.evil.com', 'myexample.com', 'example.co'])(
    'does not block %s',
    (host) => {
      expect(hostMatchesEntry(host, apex)).toBe(false);
    },
  );

  it('handles multi-part public suffixes', () => {
    const coUk = { hostname: 'example.co.uk', kind: 'apex' as const };
    expect(hostMatchesEntry('example.co.uk', coUk)).toBe(true);
    expect(hostMatchesEntry('www.example.co.uk', coUk)).toBe(true);
    expect(hostMatchesEntry('other.co.uk', coUk)).toBe(false);
  });
});

describe('subdomain blocks match the exact hostname only', () => {
  it('blocks the exact hostname', () => {
    expect(hostMatchesEntry('www.example.com', sub)).toBe(true);
  });

  it.each([
    'example.com',
    'foo.example.com',
    'foo.www.example.com',
    'www.example.com.evil.com',
    'wwwexample.com',
    'xwww.example.com',
  ])('does not block %s', (host) => {
    expect(hostMatchesEntry(host, sub)).toBe(false);
  });

  it('gives www no special treatment', () => {
    const news = { hostname: 'news.example.com', kind: 'subdomain' as const };
    expect(hostMatchesEntry('news.example.com', news)).toBe(true);
    expect(hostMatchesEntry('example.com', news)).toBe(false);
    expect(hostMatchesEntry('foo.news.example.com', news)).toBe(false);
  });
});

describe('host normalization during matching', () => {
  it('is case-insensitive and ignores a trailing dot', () => {
    expect(hostMatchesEntry('WWW.EXAMPLE.COM', sub)).toBe(true);
    expect(hostMatchesEntry('www.example.com.', sub)).toBe(true);
    expect(hostMatchesEntry('FOO.Example.Com', apex)).toBe(true);
  });

  it('rejects empty or non-string hosts', () => {
    expect(hostMatchesEntry('', apex)).toBe(false);
    expect(hostMatchesEntry('   ', apex)).toBe(false);
  });
});

describe('hostnameFromUrl', () => {
  it.each([
    ['https://www.example.com/path?q=1', 'www.example.com'],
    ['http://example.com', 'example.com'],
    ['https://example.com:8443/x', 'example.com'],
    ['http://example.com:8080/', 'example.com'],
    ['https://EXAMPLE.com/', 'example.com'],
  ])('extracts the host from %s', (url, expected) => {
    expect(hostnameFromUrl(url)).toBe(expected);
  });

  it.each([
    'chrome://settings',
    'chrome-extension://abc/blocked.html',
    'file:///tmp/x.html',
    'about:blank',
    'not a url',
  ])('ignores non-http(s) URL %s', (url) => {
    expect(hostnameFromUrl(url)).toBeNull();
  });

  it('matches both HTTP and HTTPS pages against the same entry', () => {
    for (const url of ['http://foo.example.com/a', 'https://foo.example.com/a']) {
      expect(hostMatchesEntry(hostnameFromUrl(url) as string, apex)).toBe(true);
    }
  });

  it('matches non-default ports', () => {
    expect(hostMatchesEntry(hostnameFromUrl('https://www.example.com:8443/x') as string, sub)).toBe(
      true,
    );
  });
});

describe('findMatchingEntry', () => {
  const entries = [
    { hostname: 'reddit.com', kind: 'apex' as const },
    { hostname: 'news.example.com', kind: 'subdomain' as const },
  ];

  it('finds the entry responsible for a block', () => {
    expect(findMatchingEntry('old.reddit.com', entries)?.hostname).toBe('reddit.com');
    expect(findMatchingEntry('news.example.com', entries)?.hostname).toBe('news.example.com');
  });

  it('returns null when nothing matches', () => {
    expect(findMatchingEntry('example.com', entries)).toBeNull();
    expect(findMatchingEntry('other.com', entries)).toBeNull();
  });
});

describe('deriveKind re-derives kind from the hostname', () => {
  it('classifies correctly regardless of any stored value', () => {
    expect(deriveKind('example.com')).toBe('apex');
    expect(deriveKind('www.example.com')).toBe('subdomain');
    expect(deriveKind('example.co.uk')).toBe('apex');
    expect(deriveKind('not a host')).toBeNull();
  });
});

describe('DNR rule generation', () => {
  const site = (hostname: string, kind: 'apex' | 'subdomain'): BlockedSite => ({
    hostname,
    kind,
    temporarilyUnblockedUntil: null,
  });

  it('uses requestDomains for apex entries', () => {
    const rules = buildRules([site('example.com', 'apex')], Date.now());
    expect(rules).toHaveLength(1);
    expect(rules[0].condition.requestDomains).toEqual(['example.com']);
    expect(rules[0].condition.resourceTypes).toEqual(['main_frame']);
  });

  it('uses a single anchored regex filter for subdomain entries', () => {
    const rules = buildRules([site('www.example.com', 'subdomain')], Date.now());
    expect(rules).toHaveLength(1);
    expect(rules[0].condition.regexFilter).toBe(exactHostnameRegex('www.example.com'));
    expect(rules.every((r) => r.condition.requestDomains === undefined)).toBe(true);
  });

  it('restricts every rule to main_frame', () => {
    const rules = buildRules(
      [site('example.com', 'apex'), site('www.other.com', 'subdomain')],
      Date.now(),
    );
    expect(rules.every((r) => r.condition.resourceTypes.join() === 'main_frame')).toBe(true);
  });

  it('redirects to the block page carrying only the blocklist entry', () => {
    const rules = buildRules([site('www.example.com', 'subdomain')], Date.now());
    for (const rule of rules) {
      expect(rule.action.type).toBe('redirect');
      expect(rule.action.redirect.extensionPath).toBe('/blocked.html?domain=www.example.com');
    }
  });

  it('produces a path whose domain survives a query-string round trip', () => {
    const path = blockedPagePath('xn--bcher-kva.example.com');
    const parsed = new URL(path, 'chrome-extension://fake-id');
    expect(parsed.pathname).toBe('/blocked.html');
    expect(parsed.searchParams.get('domain')).toBe('xn--bcher-kva.example.com');
  });

  it('encodes the domain in the redirect path', () => {
    expect(blockedPagePath('xn--bcher-kva.example.com')).toBe(
      '/blocked.html?domain=xn--bcher-kva.example.com',
    );
  });

  it('assigns unique positive rule ids', () => {
    const rules = buildRules(
      [site('a.com', 'apex'), site('www.b.com', 'subdomain'), site('c.com', 'apex')],
      Date.now(),
    );
    const ids = rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => Number.isInteger(id) && id > 0)).toBe(true);
  });

  it('is deterministic and idempotent for the same input', () => {
    const sites = [site('a.com', 'apex'), site('www.b.com', 'subdomain')];
    expect(buildRules(sites, 1000)).toEqual(buildRules(sites, 1000));
  });

  it('omits rules for temporarily unblocked entries', () => {
    const now = 1_000_000;
    const sites: BlockedSite[] = [
      { hostname: 'example.com', kind: 'apex', temporarilyUnblockedUntil: now + 60_000 },
      { hostname: 'other.com', kind: 'apex', temporarilyUnblockedUntil: null },
    ];
    const rules = buildRules(sites, now);
    expect(rules).toHaveLength(1);
    expect(rules[0].condition.requestDomains).toEqual(['other.com']);
  });

  it('restores a rule once the exception has expired', () => {
    const now = 1_000_000;
    const sites: BlockedSite[] = [
      { hostname: 'example.com', kind: 'apex', temporarilyUnblockedUntil: now - 1 },
    ];
    expect(buildRules(sites, now)).toHaveLength(1);
  });
});
