import { describe, it, expect } from 'vitest';
import {
  evaluateChallenge,
  isComplete,
  isValidPrefix,
  isDisallowedInputType,
} from '../src/core/challenge.js';
import {
  temporaryChallengeText,
  permanentChallengeText,
  renderTemplate,
  PERMANENT_UNBLOCK_TEMPLATE,
  TEMPORARY_UNBLOCK_TEMPLATE,
} from '../src/core/templates.js';

const expected = temporaryChallengeText('reddit.com');

describe('challenge text generation', () => {
  it('inserts the hostname into the temporary template', () => {
    expect(temporaryChallengeText('reddit.com')).toBe(
      TEMPORARY_UNBLOCK_TEMPLATE.replace('{hostname}', 'reddit.com'),
    );
    expect(temporaryChallengeText('reddit.com')).toContain('reddit.com');
    expect(temporaryChallengeText('reddit.com')).not.toContain('{hostname}');
  });

  it('works for subdomains too', () => {
    expect(temporaryChallengeText('www.reddit.com')).toBe(
      TEMPORARY_UNBLOCK_TEMPLATE.replace('{hostname}', 'www.reddit.com'),
    );
    expect(temporaryChallengeText('www.reddit.com')).toContain('www.reddit.com');
    expect(temporaryChallengeText('www.reddit.com')).not.toContain('{hostname}');
  });

  it('inserts the hostname everywhere it appears in the permanent template', () => {
    const text = permanentChallengeText('example.com');
    expect(text).not.toContain('{hostname}');
    expect(text.split('example.com').length - 1).toBe(
      PERMANENT_UNBLOCK_TEMPLATE.split('{hostname}').length - 1,
    );
  });

  it('uses a permanent paragraph in the 120-180 word range', () => {
    const words = permanentChallengeText('example.com').trim().split(/\s+/).length;
    expect(words).toBeGreaterThanOrEqual(120);
    expect(words).toBeLessThanOrEqual(180);
  });

  it('keeps both templates parameterised by hostname', () => {
    expect(TEMPORARY_UNBLOCK_TEMPLATE).toContain('{hostname}');
    expect(PERMANENT_UNBLOCK_TEMPLATE).toContain('{hostname}');
  });

  it('renders arbitrary templates', () => {
    expect(renderTemplate('block {hostname} now', 'a.com')).toBe('block a.com now');
  });
});

describe('prefix invariant', () => {
  it('treats an empty field as a valid starting prefix', () => {
    const result = evaluateChallenge('', expected);
    expect(result.status).toBe('empty');
    expect(result.valid).toBe(true);
    expect(result.complete).toBe(false);
  });

  it('accepts every correct partial prefix', () => {
    for (let i = 1; i < expected.length; i++) {
      const partial = expected.slice(0, i);
      expect(isValidPrefix(partial, expected)).toBe(true);
      expect(isComplete(partial, expected)).toBe(false);
    }
  });

  it('accepts the full exact string and marks it complete', () => {
    const result = evaluateChallenge(expected, expected);
    expect(result.status).toBe('complete');
    expect(result.complete).toBe(true);
  });

  it('rejects a wrong character', () => {
    expect(isValidPrefix('I want to unbloxk', expected)).toBe(false);
  });

  it('rejects wrong capitalization', () => {
    expect(isValidPrefix('i want to unblock', expected)).toBe(false);
    expect(isValidPrefix(expected.toLowerCase(), expected)).toBe(false);
    expect(isValidPrefix(expected.toUpperCase(), expected)).toBe(false);
  });

  it('rejects missing punctuation', () => {
    // Drop the sentence-ending period rather than hardcoding the sentence, so
    // this keeps testing punctuation if the template is reworded. Anchored on
    // '. ' to avoid matching the dot inside the hostname.
    expect(isValidPrefix(expected.replace('. ', ' '), expected)).toBe(false);
  });

  it('rejects a missing trailing period', () => {
    expect(isComplete(expected.slice(0, -1), expected)).toBe(false);
  });

  it('rejects extra spaces', () => {
    expect(isValidPrefix('I  want to unblock', expected)).toBe(false);
    expect(isValidPrefix('I want to unblock  reddit.com', expected)).toBe(false);
  });

  it('rejects an extra character typed after a full match', () => {
    const result = evaluateChallenge(`${expected}!`, expected);
    expect(result.valid).toBe(false);
    expect(result.complete).toBe(false);
  });

  it('rejects trailing whitespace after a full match', () => {
    expect(isValidPrefix(`${expected} `, expected)).toBe(false);
  });

  it('does not trim the value before comparing', () => {
    expect(isValidPrefix(' I want', expected)).toBe(false);
    expect(isComplete(` ${expected} `, expected)).toBe(false);
  });

  it('accepts a value that becomes a valid prefix again after backspacing', () => {
    const tooFar = expected.slice(0, 20);
    const backspaced = tooFar.slice(0, 10);
    expect(isValidPrefix(backspaced, expected)).toBe(true);
  });

  it('handles the wrong hostname being typed', () => {
    expect(isValidPrefix('I want to unblock twitter.com', expected)).toBe(false);
  });

  it('validates the long permanent challenge with the same mechanism', () => {
    const permanent = permanentChallengeText('example.com');
    expect(isValidPrefix(permanent.slice(0, 60), permanent)).toBe(true);
    expect(isComplete(permanent, permanent)).toBe(true);
    expect(isValidPrefix(`${permanent.slice(0, 60)}X`, permanent)).toBe(false);
  });

  it('is defensive about non-string input', () => {
    expect(evaluateChallenge(undefined as unknown as string, expected).valid).toBe(false);
  });
});

describe('non-typed insertion is rejected', () => {
  it.each([
    'insertFromPaste',
    'insertFromPasteAsQuotation',
    'insertFromDrop',
    'insertReplacementText',
    'insertFromYank',
  ])('blocks input type %s', (type) => {
    expect(isDisallowedInputType(type)).toBe(true);
  });

  it.each(['insertText', 'deleteContentBackward', 'deleteContentForward', 'insertLineBreak'])(
    'allows normal typing input type %s',
    (type) => {
      expect(isDisallowedInputType(type)).toBe(false);
    },
  );
});
