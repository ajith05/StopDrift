/**
 * Reusable typing-challenge widget, shared by the temporary and permanent
 * challenges. Correctness comes entirely from core/challenge.ts - this file
 * only wires DOM events to it and prevents non-typed insertion.
 */
import {
  CHALLENGE_RESET_MESSAGE,
  evaluateChallenge,
  isDisallowedInputType,
} from '../core/challenge.js';

export interface ChallengeWidgetOptions {
  input: HTMLTextAreaElement | HTMLInputElement;
  /** Element that displays the text to type. */
  promptEl: HTMLElement;
  /** aria-live region for reset messages. */
  statusEl: HTMLElement;
  confirmButton: HTMLButtonElement;
}

export interface ChallengeWidget {
  /** Point the widget at a new expected string and reset the field. */
  setExpected(expected: string): void;
  value(): string;
  reset(): void;
  focus(): void;
}

export function createChallengeWidget(options: ChallengeWidgetOptions): ChallengeWidget {
  const { input, promptEl, statusEl, confirmButton } = options;
  let expected = '';

  // Typing is the point of the exercise, so autofill/correction helpers are off.
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('spellcheck', 'false');

  function setStatus(text: string): void {
    statusEl.textContent = text;
  }

  function refresh(): void {
    const result = evaluateChallenge(input.value, expected);

    if (!result.valid) {
      // A single wrong character clears the whole field.
      input.value = '';
      setStatus(CHALLENGE_RESET_MESSAGE);
      confirmButton.disabled = true;
      return;
    }

    if (result.status !== 'empty') setStatus('');
    confirmButton.disabled = !result.complete;
  }

  input.addEventListener('input', refresh);

  // beforeinput carries the insertion type, so paste/drop/replacement can be
  // rejected before they ever reach the field value.
  input.addEventListener('beforeinput', (event) => {
    const inputEvent = event as InputEvent;
    if (inputEvent.inputType && isDisallowedInputType(inputEvent.inputType)) {
      event.preventDefault();
      setStatus('Please type the text yourself.');
    }
  });

  // Defensive fallbacks for browsers/paths that do not fire a useful beforeinput.
  for (const eventName of ['paste', 'drop', 'dragover'] as const) {
    input.addEventListener(eventName, (event) => {
      event.preventDefault();
      // dragover is here for a different reason than paste and drop: preventing
      // its default is what stops the field being a valid drop target at all,
      // so the drop never happens. It also fires continuously while a pointer
      // moves over the field, so it stays silent - announcing on every move
      // would thrash the aria-live region during a drag the user may abandon.
      // The message belongs on the events that are an actual insertion attempt.
      if (eventName !== 'dragover') setStatus('Please type the text yourself.');
    });
  }

  function reset(): void {
    input.value = '';
    setStatus('');
    confirmButton.disabled = true;
  }

  return {
    setExpected(next: string): void {
      expected = next;
      // textContent, never innerHTML - the hostname is user-controlled.
      promptEl.textContent = next;
      reset();
    },
    value: () => input.value,
    reset,
    focus: () => input.focus(),
  };
}
