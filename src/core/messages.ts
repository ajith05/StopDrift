/**
 * Local, unattributed focus statements shown on the block page.
 * Bundled at build time - never fetched, never attributed, never tracked.
 */
export const MOTIVATIONAL_MESSAGES: readonly string[] = [
  'The distraction can wait. Your priority cannot.',
  'Return to the task you chose deliberately.',
  'A few focused minutes are worth more than another scroll.',
  'You already decided this. Trust the version of you that did.',
  'The urge passes faster than you expect.',
  'Nothing on the other side of this page needs you right now.',
  'Attention is the one budget you cannot top up.',
  'This impulse is loud, but it is not important.',
  'The work you avoid grows heavier the longer you wait.',
  'Small deliberate choices compound into large ones.',
  'You are two minutes from being glad you turned back.',
  'Boredom is often the doorway to good work.',
  'The next useful thing is more important than the next distracting thing.',
  'Finish the thought you were having before this.',
  'Momentum is fragile. Protect the run you are on.',
  'Curiosity is fine. This particular curiosity can wait.',
  'You came here on autopilot. This is the manual override.',
  'What you do repeatedly becomes what you are.',
  'Nothing here will matter to you tomorrow.',
  'The feed is infinite. Your afternoon is not.',
  'Rest is worth choosing on purpose, not drifting into.',
  'The hard part is usually only hard for five minutes.',
  'You do not need more information. You need to begin.',
  'Depth beats novelty almost every time.',
  'Turn back now and the day is still yours.',
  'Discomfort is often the sign you are doing the real thing.',
  'The task is smaller than the dread around it.',
  'One honest hour outweighs a whole distracted day.',
  'Your future self is watching this decision.',
  'The scroll never ends, so you have to.',
  'Choose the thing that is quietly worth doing.',
  'Focus is a practice, not a personality trait.',
  'You are allowed to be unreachable for a while.',
  'Whatever you were putting off is still waiting.',
  'Interesting is not the same as important.',
  'Do the work first. The reward means more afterwards.',
  'This is exactly the moment the block was made for.',
  'A clear mind is built from refusals like this one.',
  'You will not remember what you would have seen here.',
  'Progress is mostly just returning to the task again.',
  'The shortcut you want leads nowhere you want to go.',
  'Give the difficult thing ten honest minutes.',
  'You set this boundary while thinking clearly.',
  'Restlessness is not a reason. It is just weather.',
  'The best time to stop drifting is right now.',
  'Every no to this is a yes to something better.',
  'Your concentration took a while to build. Keep it.',
  'There is no emergency behind this page.',
  'Let the silence be productive instead of filled.',
  'You are closer to finishing than you feel.',
  'Consistency is quieter than motivation, and it lasts longer.',
  'Close the loop you left open earlier.',
  'The point was never to be entertained all day.',
  'Come back to what you actually care about.',
  'Doing one thing fully is rarer than it sounds.',
  'The block held. That was the whole idea.',
];

/** Pick a message at random. Nothing about the choice is recorded. */
export function randomMessage(random: () => number = Math.random): string {
  const index = Math.floor(random() * MOTIVATIONAL_MESSAGES.length);
  const safe = Math.min(MOTIVATIONAL_MESSAGES.length - 1, Math.max(0, index));
  return MOTIVATIONAL_MESSAGES[safe];
}
