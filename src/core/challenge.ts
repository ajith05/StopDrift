/**
 * THE canonical typing-challenge validator, shared by both challenges.
 *
 * Correctness is defined by a single invariant: at every moment the field
 * contents must be an exact prefix of the expected text. Keystrokes are never
 * counted, and the value is never trimmed, lowercased or normalized.
 */

export type ChallengeStatus = 'empty' | 'partial' | 'complete' | 'invalid';

export interface ChallengeResult {
  status: ChallengeStatus;
  /** True while the field may keep its contents. */
  valid: boolean;
  /** True only on an exact full match - gates the confirm button. */
  complete: boolean;
}

/**
 * Evaluate the complete current field value against the expected text.
 * An empty field is a valid prefix (the starting state), not an error.
 */
export function evaluateChallenge(value: string, expected: string): ChallengeResult {
  if (typeof value !== 'string' || typeof expected !== 'string') {
    return { status: 'invalid', valid: false, complete: false };
  }
  if (value === '') return { status: 'empty', valid: true, complete: false };
  if (value === expected) return { status: 'complete', valid: true, complete: true };
  // Anything longer than the expected text, or diverging from it, is invalid -
  // including an extra character typed after an otherwise perfect match.
  if (expected.startsWith(value)) return { status: 'partial', valid: true, complete: false };
  return { status: 'invalid', valid: false, complete: false };
}

export function isValidPrefix(value: string, expected: string): boolean {
  return evaluateChallenge(value, expected).valid;
}

export function isComplete(value: string, expected: string): boolean {
  return evaluateChallenge(value, expected).complete;
}

/**
 * `beforeinput` input types that insert text the user did not type.
 * Ordinary typing (`insertText`) and deletions are deliberately not listed.
 */
const BLOCKED_INPUT_TYPES = new Set([
  'insertFromPaste',
  'insertFromPasteAsQuotation',
  'insertFromDrop',
  'insertReplacementText',
  'insertFromYank',
  'insertTranspose',
]);

export function isDisallowedInputType(inputType: string): boolean {
  return BLOCKED_INPUT_TYPES.has(inputType);
}

export const CHALLENGE_RESET_MESSAGE = 'Typing error — start again.';
