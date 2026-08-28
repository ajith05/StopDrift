import { describe, it, expect } from 'vitest';
import { parseHostnameInput, describeScope } from '../src/core/hostname.js';

function parseOk(input: string) {
  const result = parseHostnameInput(input);
  if (!result.ok) throw new Error(`expected "${input}" to parse, got: ${result.message}`);
  return result;
}

function parseErr(input: string) {
  const result = parseHostnameInput(input);
  if (result.ok) throw new Error(`expected "${input}" to be rejected, got ${result.hostname}`);
  return result;
}

describe('apex vs subdomain classification', () => {
  it.each([
    ['example.com', 'example.com'],
    ['example.co.uk', 'example.co.uk'],
    ['example.org', 'example.org'],
  ])('treats %s as an apex domain', (input, hostname) => {
    const result = parseOk(input);
    expect(result.hostname).toBe(hostname);
    expect(result.kind).toBe('apex');
    expect(result.apex).toBe(hostname);
  });

  it.each([
    ['www.example.com', 'example.com'],
    ['foo.example.com', 'example.com'],
    ['a.b.example.com', 'example.com'],
    ['foo.example.co.uk', 'example.co.uk'],
    ['www.example.co.uk', 'example.co.uk'],
  ])('treats %s as a subdomain of %s', (input, apex) => {
    const result = parseOk(input);
    expect(result.kind).toBe('subdomain');
    expect(result.apex).toBe(apex);
  });

  it('does not classify by counting dots', () => {
    // Two labels but a multi-part public suffix: this is an apex, not a subdomain.
    expect(parseOk('example.co.uk').kind).toBe('apex');
    // Three labels but a single-part suffix: this is a subdomain.
    expect(parseOk('a.example.com').kind).toBe('subdomain');
  });

  it('gives www no special treatment', () => {
    expect(parseOk('www.example.com').kind).toBe('subdomain');
  });
});

describe('URL and formatting normalization', () => {
  it.each([
    ['https://reddit.com', 'reddit.com'],
    ['http://reddit.com', 'reddit.com'],
    ['https://www.reddit.com/r/programming', 'www.reddit.com'],
    ['https://example.com/a/b?c=d#e', 'example.com'],
    ['example.com:8080/path', 'example.com'],
    ['https://example.com:8443/', 'example.com'],
    ['EXAMPLE.COM', 'example.com'],
    ['WWW.Example.Com', 'www.example.com'],
    ['example.com.', 'example.com'],
    ['www.example.com..', 'www.example.com'],
    ['  example.com  ', 'example.com'],
    ['https://user:pass@example.com/x', 'example.com'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(parseOk(input).hostname).toBe(expected);
  });

  it('normalizes IDNs to a stable punycode representation', () => {
    const result = parseOk('https://bücher.example.com');
    expect(result.hostname).toBe('xn--bcher-kva.example.com');
    expect(result.kind).toBe('subdomain');
  });

  it('treats a trailing dot as the same entry as no trailing dot', () => {
    expect(parseOk('example.com.').hostname).toBe(parseOk('example.com').hostname);
  });
});

describe('rejected input', () => {
  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['*.example.com', 'wildcard'],
    ['*', 'wildcard'],
    ['127.0.0.1', 'ip-address'],
    ['http://192.168.1.1/', 'ip-address'],
    ['[::1]', 'ip-address'],
    ['http://[2001:db8::1]/', 'ip-address'],
    ['localhost', 'special-use'],
    ['http://localhost:3000', 'special-use'],
    ['myserver.local', 'special-use'],
    ['something.test', 'special-use'],
    ['intranet', 'single-label'],
    ['com', 'public-suffix'],
    ['co.uk', 'public-suffix'],
    ['org', 'public-suffix'],
    ['chrome://settings', 'unsupported-scheme'],
    ['about:blank', 'unsupported-scheme'],
    ['file:///etc/hosts', 'unsupported-scheme'],
    ['ftp://example.com', 'unsupported-scheme'],
    ['javascript:alert(1)', 'unsupported-scheme'],
    ['chrome-extension://abcdef/page.html', 'unsupported-scheme'],
  ])('rejects %s with code %s', (input, code) => {
    expect(parseErr(input).code).toBe(code);
  });

  it.each(['exa mple.com', 'exam_ple.com', '-example.com', 'example-.com', 'a..b.com'])(
    'rejects malformed hostname %s',
    (input) => {
      expect(parseErr(input).ok).toBe(false);
    },
  );

  it('rejects hostnames with an over-long label', () => {
    expect(parseErr(`${'a'.repeat(64)}.example.com`).code).toBe('malformed');
  });

  it('rejects non-string input defensively', () => {
    expect(parseHostnameInput(undefined as unknown as string).ok).toBe(false);
    expect(parseHostnameInput(null as unknown as string).ok).toBe(false);
  });

  it('gives every rejection a non-empty message', () => {
    for (const bad of ['', '*', 'localhost', 'com', 'chrome://x']) {
      expect(parseErr(bad).message.length).toBeGreaterThan(0);
    }
  });
});

describe('scope description', () => {
  it('describes apex scope as covering subdomains', () => {
    expect(describeScope('apex', 'example.com')).toContain('all of its subdomains');
  });

  it('describes subdomain scope as exact only', () => {
    expect(describeScope('subdomain', 'www.example.com')).toContain('only this exact hostname');
  });
});
