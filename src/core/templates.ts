/**
 * Typing-challenge wording.
 *
 * Both templates live here so the user can reword them without touching any
 * logic. Changing the text changes the challenge immediately - nothing else
 * depends on the exact wording.
 */

/** Temporary unblock: short, exact, hostname interpolated. */
export const TEMPORARY_UNBLOCK_TEMPLATE = 'I want to unblock {hostname}. I am really sure. This is not an impulsive decision. I am not being forced.';

/**
 * Permanent unblock challenge (138 words). Deliberately long: permanent removal is
 * the one action that weakens protection, so it should take real effort.
 */
export const PERMANENT_UNBLOCK_TEMPLATE =
  'I am permanently removing {hostname} from my blocklist. ' +
  'I understand that this is not a temporary pause and that the block will not come back on its own. ' +
  'I added this block on purpose, at a moment when I was thinking clearly about how I wanted to spend my attention. ' +
  'That earlier decision was made calmly, without the pull of the moment, and it deserves more weight than the impulse I am feeling right now. ' +
  'I am choosing to override it anyway, and I accept that the consequences of that choice are mine. ' +
  'If I later decide that this was a mistake, I will have to add the block again myself, deliberately and by hand. ' +
  'I have taken the time to type this out in full, and I am confident that removing {hostname} is what I genuinely want.';

/** Substitute the hostname into a template. All occurrences are replaced. */
export function renderTemplate(template: string, hostname: string): string {
  return template.split('{hostname}').join(hostname);
}

export function temporaryChallengeText(hostname: string): string {
  return renderTemplate(TEMPORARY_UNBLOCK_TEMPLATE, hostname);
}

export function permanentChallengeText(hostname: string): string {
  return renderTemplate(PERMANENT_UNBLOCK_TEMPLATE, hostname);
}
