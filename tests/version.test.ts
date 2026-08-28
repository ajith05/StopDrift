import { describe, it, expect } from 'vitest';
import { EXTENSION_VERSION, isCompatible, parseVersion } from '../src/core/version.js';

describe('EXTENSION_VERSION', () => {
  it('is injected at build time as a semver string', () => {
    expect(parseVersion(EXTENSION_VERSION)).not.toBeNull();
  });
});

describe('parseVersion', () => {
  it.each([
    ['1.0.0', { major: 1, minor: 0, patch: 0 }],
    ['0.0.1', { major: 0, minor: 0, patch: 1 }],
    ['12.34.56', { major: 12, minor: 34, patch: 56 }],
    ['  1.2.3  ', { major: 1, minor: 2, patch: 3 }],
  ])('parses %s', (input, expected) => {
    expect(parseVersion(input)).toEqual(expected);
  });

  it.each([
    // Pre-release suffixes are rejected: Chrome's manifest cannot express them,
    // so a released build can never legitimately produce one.
    '1.2.0-beta.1',
    '1.0.0+build',
    'v1.0.0',
    '1.0',
    '1',
    '1.0.0.0',
    '1.0.x',
    'one.two.three',
    '',
    '   ',
    '-1.0.0',
    '1.-0.0',
  ])('rejects %s', (input) => {
    expect(parseVersion(input)).toBeNull();
  });

  it.each([null, undefined, 1, {}, [], true])('rejects non-string %s', (input) => {
    expect(parseVersion(input)).toBeNull();
  });
});

describe('isCompatible compares the major version only', () => {
  const v = (s: string) => parseVersion(s)!;

  it('accepts any minor or patch difference, in both directions', () => {
    expect(isCompatible(v('1.0.0'), v('1.4.2'))).toBe(true);
    expect(isCompatible(v('1.4.2'), v('1.0.0'))).toBe(true);
    expect(isCompatible(v('1.99.99'), v('1.0.0'))).toBe(true);
  });

  it('accepts an identical version', () => {
    expect(isCompatible(v('2.3.4'), v('2.3.4'))).toBe(true);
  });

  it('rejects a differing major, in both directions', () => {
    expect(isCompatible(v('1.0.0'), v('2.0.0'))).toBe(false);
    expect(isCompatible(v('2.0.0'), v('1.0.0'))).toBe(false);
  });

  it('treats 0.x as its own major line', () => {
    expect(isCompatible(v('0.9.0'), v('1.0.0'))).toBe(false);
    expect(isCompatible(v('0.1.0'), v('0.9.9'))).toBe(true);
  });
});
