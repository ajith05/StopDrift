/**
 * Block page.
 *
 * Deliberately minimal: which block fired, one local message, and Go back.
 * No unblock controls, no settings links, no counters.
 */
import { randomMessage } from '../core/messages.js';
import { applyStoredTheme } from '../shared/theme.js';

// Paint the stored theme first so the page never flashes the wrong colors.
void applyStoredTheme();

const params = new URLSearchParams(location.search);
const domain = params.get('domain') ?? '';

const headline = document.getElementById('headline') as HTMLParagraphElement;
const message = document.getElementById('message') as HTMLParagraphElement;
const backButton = document.getElementById('back') as HTMLButtonElement;

// textContent only - the domain comes from a query string and must never be
// interpolated as HTML.
headline.textContent = domain ? `${domain} is blocked` : 'This site is blocked';
message.textContent = randomMessage();

/**
 * Go back without bouncing straight into another redirect.
 *
 * history.back() would often land on the blocked site again, which immediately
 * re-redirects here and can feel like a loop.
 *
 * Stepping back normally returns to whatever preceded the blocked navigation,
 * which may well be the new tab page. about:blank is used only when there is no
 * history entry to return to - an extension page cannot navigate the tab to
 * chrome://newtab/ itself, so it is the neutral landing spot in that case.
 */
backButton.addEventListener('click', () => {
  void goBack();
});

async function goBack(): Promise<void> {
  // The blocked page replaced the blocked navigation in this tab's history, so
  // stepping back one entry usually lands on whatever preceded it. When there
  // is no such entry, history.length is 1 and there is nothing to go back to.
  if (history.length > 1) {
    const before = location.href;
    history.back();

    // If the back navigation did not actually move us (or landed on another
    // blocked page that redirected straight back), fall back to a blank page.
    window.setTimeout(() => {
      if (location.href === before) {
        location.replace('about:blank');
      }
    }, 350);
    return;
  }

  location.replace('about:blank');
}

backButton.focus();
