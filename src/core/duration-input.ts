/**
 * Parsing for the options page's hours-and-minutes duration boxes.
 *
 * The stored setting is a single total in minutes (`temporaryUnblockMinutes`),
 * and that stays the unit everywhere else - protocol, storage and export are
 * unchanged. The two boxes exist only so the user does not have to multiply by
 * sixty; this module is the one place that converts between the pair the user
 * types and the total the rest of the system uses.
 *
 * Nothing here touches the DOM, so it can be tested directly. The service
 * worker still validates the total it receives - this parse produces a better
 * error message, it is not the gate.
 */
import { MIN_TEMPORARY_MINUTES, MAX_TEMPORARY_MINUTES } from './state.js';

export type DurationInputResult =
  | { ok: true; minutes: number }
  | { ok: false; message: string };

const RANGE_MESSAGE = `Enter a duration between ${String(MIN_TEMPORARY_MINUTES)} minute and 24 hours.`;
const WHOLE_MESSAGE = 'Enter whole numbers of hours and minutes.';

/**
 * Read one box as a non-negative whole number, treating blank as zero.
 *
 * Blank is zero rather than an error so "2 hours" can be typed by filling in
 * only the hours box. Both boxes blank is caught by the range check, since the
 * total is then 0.
 */
function readField(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return 0;
  // Number.parseInt would accept "5x" and "1.9"; require the whole string to be
  // digits so a typo is reported rather than silently truncated.
  if (!/^\d+$/.test(trimmed)) return null;
  // No precision guard is needed: any digit string big enough to lose integer
  // precision is far past 1440, so the range check below rejects it first.
  return Number(trimmed);
}

/**
 * Convert the two boxes into a total in minutes.
 *
 * Minutes above 59 are carried rather than rejected: "1 hour 90 minutes" is
 * unambiguous, so it becomes 150 instead of an extra error state.
 */
export function parseDurationInput(hours: string, minutes: string): DurationInputResult {
  const h = readField(hours);
  const m = readField(minutes);
  if (h === null || m === null) return { ok: false, message: WHOLE_MESSAGE };

  const total = h * 60 + m;
  if (total < MIN_TEMPORARY_MINUTES || total > MAX_TEMPORARY_MINUTES) {
    return { ok: false, message: RANGE_MESSAGE };
  }
  return { ok: true, minutes: total };
}

/** Split a stored total back into the pair of box values. */
export function splitDuration(total: number): { hours: number; minutes: number } {
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

/**
 * Phrase a stored total as hours and minutes: "45 minutes", "1 hour",
 * "2 hours 30 minutes".
 *
 * Used both by the options page's confirm button and by the service worker's
 * reply after the setting is saved, so the duration is described the same way
 * wherever it appears. This is the plain quantity; `formatRemaining` in
 * exceptions.ts phrases a countdown ("2 hours 30 min more") and stays separate.
 */
export function describeDuration(total: number): string {
  const { hours, minutes } = splitDuration(total);
  const minutePart = `${String(minutes)} minute${minutes === 1 ? '' : 's'}`;
  if (hours === 0) return minutePart;
  const hourPart = `${String(hours)} hour${hours === 1 ? '' : 's'}`;
  return minutes === 0 ? hourPart : `${hourPart} ${minutePart}`;
}
