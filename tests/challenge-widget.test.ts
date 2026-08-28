/**
 * @vitest-environment jsdom
 *
 * DOM-level behavior of the shared challenge widget: the prefix invariant
 * enforced through real `input` events, and rejection of non-typed insertion.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createChallengeWidget } from '../src/ui/challenge-widget.js';
import { CHALLENGE_RESET_MESSAGE } from '../src/core/challenge.js';
import { temporaryChallengeText } from '../src/core/templates.js';

const expected = temporaryChallengeText('reddit.com');

let input: HTMLInputElement;
let promptEl: HTMLDivElement;
let statusEl: HTMLDivElement;
let confirm: HTMLButtonElement;
let widget: ReturnType<typeof createChallengeWidget>;

/** Simulate typing by setting the value and firing a real input event. */
function type(value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = `
    <div id="prompt"></div>
    <div id="status"></div>
    <input id="field" />
    <button id="confirm"></button>
  `;
  input = document.getElementById('field') as HTMLInputElement;
  promptEl = document.getElementById('prompt') as HTMLDivElement;
  statusEl = document.getElementById('status') as HTMLDivElement;
  confirm = document.getElementById('confirm') as HTMLButtonElement;

  widget = createChallengeWidget({ input, promptEl, statusEl, confirmButton: confirm });
  widget.setExpected(expected);
});

describe('setup', () => {
  it('shows the text to type without using innerHTML', () => {
    widget.setExpected(temporaryChallengeText('<script>x</script>.com'));
    expect(promptEl.querySelector('script')).toBeNull();
    expect(promptEl.textContent).toContain('<script>');
  });

  it('disables typing helpers on the field', () => {
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('autocorrect')).toBe('off');
    expect(input.getAttribute('autocapitalize')).toBe('off');
    expect(input.getAttribute('spellcheck')).toBe('false');
  });

  it('starts empty with the confirm button disabled', () => {
    expect(input.value).toBe('');
    expect(confirm.disabled).toBe(true);
  });
});

describe('typing a correct prefix', () => {
  it('keeps the value while it stays a valid prefix', () => {
    for (let i = 1; i <= 20; i++) {
      type(expected.slice(0, i));
      expect(input.value).toBe(expected.slice(0, i));
      expect(confirm.disabled).toBe(true);
    }
  });

  it('enables the confirm button only on an exact full match', () => {
    type(expected.slice(0, expected.length - 1));
    expect(confirm.disabled).toBe(true);

    type(expected);
    expect(confirm.disabled).toBe(false);
  });

  it('allows backspacing to a shorter valid prefix', () => {
    type(expected.slice(0, 20));
    type(expected.slice(0, 8));
    expect(input.value).toBe(expected.slice(0, 8));
    expect(statusEl.textContent).toBe('');
  });
});

describe('typing an error', () => {
  it('clears the entire field and shows the reset message', () => {
    type(expected.slice(0, 10));
    type(`${expected.slice(0, 10)}X`);

    expect(input.value).toBe('');
    expect(statusEl.textContent).toBe(CHALLENGE_RESET_MESSAGE);
    expect(confirm.disabled).toBe(true);
  });

  it('resets on wrong capitalization', () => {
    type('i');
    expect(input.value).toBe('');
    expect(statusEl.textContent).toBe(CHALLENGE_RESET_MESSAGE);
  });

  it('re-disables the confirm button when a character is added after a full match', () => {
    type(expected);
    expect(confirm.disabled).toBe(false);

    type(`${expected}!`);
    expect(input.value).toBe('');
    expect(confirm.disabled).toBe(true);
  });

  it('lets the user start again cleanly after a reset', () => {
    type('wrong');
    expect(input.value).toBe('');

    type(expected.slice(0, 5));
    expect(input.value).toBe(expected.slice(0, 5));
    expect(statusEl.textContent).toBe('');
  });
});

describe('non-typed insertion is prevented', () => {
  it('cancels a paste event', () => {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('cancels a drop event', () => {
    const event = new Event('drop', { bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('cancels beforeinput for paste-style input types', () => {
    for (const inputType of ['insertFromPaste', 'insertFromDrop', 'insertReplacementText']) {
      const event = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType,
      });
      input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
  });

  it('allows beforeinput for ordinary typing', () => {
    const event = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: 'I',
    });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('allows deletion input types', () => {
    const event = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'deleteContentBackward',
    });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('switching targets', () => {
  it('resets the field and retargets when the hostname changes', () => {
    type(expected.slice(0, 10));

    const other = temporaryChallengeText('www.other.com');
    widget.setExpected(other);

    expect(input.value).toBe('');
    expect(confirm.disabled).toBe(true);
    expect(promptEl.textContent).toBe(other);

    // The old text is no longer accepted; the new one is.
    type(expected.slice(0, 20));
    expect(input.value).toBe('');

    type(other.slice(0, 20));
    expect(input.value).toBe(other.slice(0, 20));
  });
});
