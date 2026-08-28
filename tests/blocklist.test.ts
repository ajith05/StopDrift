import { describe, it, expect } from 'vitest';
import { addToBlocklist, removeFromBlocklist, sortSites } from '../src/core/blocklist.js';
import { parseHostnameInput } from '../src/core/hostname.js';
import type { BlockedSite } from '../src/core/state.js';

/** Build a blocklist from hostnames, deriving each kind the way the app does. */
function listOf(...hostnames: string[]): BlockedSite[] {
  return hostnames.map((hostname) => {
    const parsed = parseHostnameInput(hostname);
    if (!parsed.ok) throw new Error(`bad fixture: ${hostname}`);
    return { hostname: parsed.hostname, kind: parsed.kind, temporarilyUnblockedUntil: null };
  });
}

function add(sites: BlockedSite[], hostname: string) {
  const parsed = parseHostnameInput(hostname);
  if (!parsed.ok) throw new Error(`bad fixture: ${hostname}`);
  return addToBlocklist(sites, parsed.hostname, parsed.kind);
}

describe('exact duplicates', () => {
  it('rejects an exact duplicate without changing the list', () => {
    const sites = listOf('www.example.com');
    const outcome = add(sites, 'www.example.com');
    expect(outcome.status).toBe('duplicate');
    if (outcome.status === 'duplicate') {
      expect(outcome.message).toContain('already');
    }
    expect(sites).toHaveLength(1);
  });

  it('recognizes a duplicate entered in a different format', () => {
    const sites = listOf('example.com');
    expect(add(sites, 'https://EXAMPLE.com/some/path').status).toBe('duplicate');
  });
});

describe('apex already covers the requested subdomain', () => {
  it('rejects a subdomain beneath an existing apex block as redundant', () => {
    const sites = listOf('example.com');
    const outcome = add(sites, 'www.example.com');
    expect(outcome.status).toBe('covered');
    if (outcome.status === 'covered') {
      expect(outcome.coveredBy).toBe('example.com');
      expect(outcome.message).toContain('example.com');
    }
  });

  it('rejects a deep subdomain beneath an existing apex block', () => {
    expect(add(listOf('example.com'), 'a.b.example.com').status).toBe('covered');
  });

  it('still allows an unrelated domain', () => {
    expect(add(listOf('example.com'), 'example.org').status).toBe('added');
  });
});

describe('adding an apex consolidates existing subdomains', () => {
  it('adds the apex and removes now-redundant subdomain entries', () => {
    const sites = listOf('www.example.com', 'news.example.com');
    const outcome = add(sites, 'example.com');

    expect(outcome.status).toBe('added');
    if (outcome.status !== 'added') return;

    expect(outcome.consolidated.sort()).toEqual(['news.example.com', 'www.example.com']);
    expect(outcome.sites.map((s) => s.hostname)).toEqual(['example.com']);
  });

  it('leaves unrelated entries untouched when consolidating', () => {
    const sites = listOf('www.example.com', 'other.org');
    const outcome = add(sites, 'example.com');
    if (outcome.status !== 'added') throw new Error('expected added');

    expect(outcome.sites.map((s) => s.hostname).sort()).toEqual(['example.com', 'other.org']);
    expect(outcome.consolidated).toEqual(['www.example.com']);
  });

  it('reports no consolidation when there is nothing to absorb', () => {
    const outcome = add(listOf('other.org'), 'example.com');
    if (outcome.status !== 'added') throw new Error('expected added');
    expect(outcome.consolidated).toEqual([]);
  });
});

describe('a parent subdomain does not cover child subdomains', () => {
  it('allows a child subdomain alongside its parent subdomain', () => {
    const sites = listOf('foo.example.com');
    const outcome = add(sites, 'bar.foo.example.com');

    expect(outcome.status).toBe('added');
    if (outcome.status !== 'added') return;
    // Both coexist: exact-host rules never absorb one another.
    expect(outcome.sites.map((s) => s.hostname).sort()).toEqual([
      'bar.foo.example.com',
      'foo.example.com',
    ]);
    expect(outcome.consolidated).toEqual([]);
  });

  it('does not consolidate children when adding a parent subdomain', () => {
    const sites = listOf('bar.foo.example.com');
    const outcome = add(sites, 'foo.example.com');
    if (outcome.status !== 'added') throw new Error('expected added');
    expect(outcome.consolidated).toEqual([]);
    expect(outcome.sites).toHaveLength(2);
  });
});

describe('removal and ordering', () => {
  it('removes only the named entry', () => {
    const sites = listOf('a.com', 'b.com');
    expect(removeFromBlocklist(sites, 'a.com').map((s) => s.hostname)).toEqual(['b.com']);
  });

  it('is a no-op for a hostname that is not present', () => {
    const sites = listOf('a.com');
    expect(removeFromBlocklist(sites, 'zzz.com')).toHaveLength(1);
  });

  it('keeps the list alphabetically sorted', () => {
    const sorted = sortSites(listOf('zebra.com', 'apple.com', 'mango.com'));
    expect(sorted.map((s) => s.hostname)).toEqual(['apple.com', 'mango.com', 'zebra.com']);
  });

  it('returns a sorted list after adding', () => {
    const outcome = add(listOf('zebra.com'), 'apple.com');
    if (outcome.status !== 'added') throw new Error('expected added');
    expect(outcome.sites.map((s) => s.hostname)).toEqual(['apple.com', 'zebra.com']);
  });
});

describe('temporary exception state is preserved across additions', () => {
  it('keeps an existing active exception when an unrelated site is added', () => {
    const sites = listOf('reddit.com', 'other.com');
    sites[0].temporarilyUnblockedUntil = 999_999;

    const outcome = add(sites, 'example.com');
    if (outcome.status !== 'added') throw new Error('expected added');

    const reddit = outcome.sites.find((s) => s.hostname === 'reddit.com');
    expect(reddit?.temporarilyUnblockedUntil).toBe(999_999);
  });

  it('starts a newly added entry actively blocked', () => {
    const outcome = add([], 'example.com');
    if (outcome.status !== 'added') throw new Error('expected added');
    expect(outcome.sites[0].temporarilyUnblockedUntil).toBeNull();
  });
});
