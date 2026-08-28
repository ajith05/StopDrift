/**
 * Tests for the options page's hours-and-minutes duration parsing.
 *
 * Pure logic only. Whether the two boxes are wired up correctly, repopulate
 * after a reload, and reject via the service worker's own validation are DOM
 * and browser behaviors these tests cannot exercise; see the manual checklist
 * in the README.
 */
import { describe, expect, it } from 'vitest';
import {
  describeDuration,
  parseDurationInput,
  splitDuration,
} from '../src/core/duration-input.js';
import { MAX_TEMPORARY_MINUTES, MIN_TEMPORARY_MINUTES } from '../src/core/state.js';

describe('parseDurationInput', () => {
  it('combines hours and minutes into a total', () => {
    expect(parseDurationInput('2', '30')).toEqual({ ok: true, minutes: 150 });
  });

  it('accepts hours alone, treating a blank minutes box as zero', () => {
    expect(parseDurationInput('3', '')).toEqual({ ok: true, minutes: 180 });
  });

  it('accepts minutes alone, treating a blank hours box as zero', () => {
    expect(parseDurationInput('', '45')).toEqual({ ok: true, minutes: 45 });
  });

  it('treats an explicit zero in one box like a blank one', () => {
    expect(parseDurationInput('0', '45')).toEqual({ ok: true, minutes: 45 });
    expect(parseDurationInput('3', '0')).toEqual({ ok: true, minutes: 180 });
  });

  it('ignores surrounding whitespace', () => {
    expect(parseDurationInput('  2 ', ' 30 ')).toEqual({ ok: true, minutes: 150 });
  });

  it('carries minutes above 59 rather than rejecting them', () => {
    // "1 hour 90 minutes" is unambiguous, so it is accepted as 150 instead of
    // becoming an extra error state the user has to decode.
    expect(parseDurationInput('1', '90')).toEqual({ ok: true, minutes: 150 });
  });

  it('accepts a minutes-only value larger than an hour', () => {
    expect(parseDurationInput('', '120')).toEqual({ ok: true, minutes: 120 });
  });

  it('accepts the minimum', () => {
    expect(parseDurationInput('', '1')).toEqual({ ok: true, minutes: MIN_TEMPORARY_MINUTES });
  });

  it('accepts the maximum expressed as hours', () => {
    expect(parseDurationInput('24', '')).toEqual({ ok: true, minutes: MAX_TEMPORARY_MINUTES });
  });

  it('accepts the maximum expressed as a carry', () => {
    expect(parseDurationInput('23', '60')).toEqual({ ok: true, minutes: MAX_TEMPORARY_MINUTES });
  });

  it('rejects one minute past the maximum', () => {
    const result = parseDurationInput('24', '1');
    expect(result.ok).toBe(false);
  });

  it('rejects hours beyond the maximum', () => {
    expect(parseDurationInput('25', '').ok).toBe(false);
  });

  it('rejects a zero total', () => {
    expect(parseDurationInput('0', '0').ok).toBe(false);
  });

  it('rejects both boxes blank', () => {
    expect(parseDurationInput('', '').ok).toBe(false);
  });

  it('reports the range in the message for an out-of-range total', () => {
    const result = parseDurationInput('99', '');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/24 hours/);
  });

  it.each([
    ['decimal hours', '1.5', ''],
    ['decimal minutes', '', '30.5'],
    ['negative hours', '-1', '30'],
    ['negative minutes', '1', '-30'],
    ['trailing junk', '5x', ''],
    ['non-numeric', 'two', ''],
    ['a lone sign', '+', '30'],
    ['scientific notation', '1e2', ''],
  ])('rejects %s', (_label, hours, minutes) => {
    const result = parseDurationInput(hours, minutes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/whole numbers/);
  });

  it('rejects an absurdly large value on range rather than overflowing', () => {
    expect(parseDurationInput('999999999999999999999', '').ok).toBe(false);
  });
});

describe('splitDuration', () => {
  it('splits a whole number of hours', () => {
    expect(splitDuration(180)).toEqual({ hours: 3, minutes: 0 });
  });

  it('splits an hours-and-minutes total', () => {
    expect(splitDuration(150)).toEqual({ hours: 2, minutes: 30 });
  });

  it('splits a sub-hour total', () => {
    expect(splitDuration(45)).toEqual({ hours: 0, minutes: 45 });
  });

  it('splits the default without loss', () => {
    // An existing 1.1.0 install stores 60; it must render as "1 hour 0 minutes"
    // rather than needing a migration.
    expect(splitDuration(60)).toEqual({ hours: 1, minutes: 0 });
  });

  it('round-trips every value in the valid range', () => {
    for (let total = MIN_TEMPORARY_MINUTES; total <= MAX_TEMPORARY_MINUTES; total += 1) {
      const { hours, minutes } = splitDuration(total);
      expect(parseDurationInput(String(hours), String(minutes))).toEqual({ ok: true, minutes: total });
    }
  });
});

describe('describeDuration', () => {
  it.each([
    [1, '1 minute'],
    [45, '45 minutes'],
    [59, '59 minutes'],
    [60, '1 hour'],
    [61, '1 hour 1 minute'],
    [90, '1 hour 30 minutes'],
    [120, '2 hours'],
    [150, '2 hours 30 minutes'],
    [1440, '24 hours'],
  ])('describes %i minutes as "%s"', (total, expected) => {
    expect(describeDuration(total)).toBe(expected);
  });

  it('never reports a bare minute count above an hour', () => {
    // The defect this replaced: a 150-minute setting was announced as
    // "150 minutes", making the user do the division the boxes just avoided.
    for (let total = 60; total <= MAX_TEMPORARY_MINUTES; total += 1) {
      expect(describeDuration(total)).toMatch(/hour/);
    }
  });
});
