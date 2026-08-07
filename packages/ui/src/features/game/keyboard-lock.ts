/**
 * Keeping the game's keys out of the browser's hands.
 *
 * A page cannot stop Ctrl+W with `preventDefault`: browser shortcuts are the
 * browser's, and closing the tab mid-duel is exactly the kind of thing they are
 * reserved for. The Keyboard Lock API is the one exception, and it comes with a
 * condition that is not a detail — **it only works in fullscreen**, which is the
 * bargain browsers strike: a page may hold every key only while it visibly holds
 * the whole screen.
 *
 * It is also Chromium-only today. Everywhere else, and everywhere outside
 * fullscreen, Ctrl+W closes the tab and nothing can be done about it, so the
 * settings panel says so rather than implying a promise this cannot keep.
 */

/**
 * The subset of the Keyboard API this uses.
 *
 * Declared here because `lib.dom` does not carry it: it is not on a standards
 * track every engine has followed, which is the same reason every call below is
 * written to survive its absence.
 */
interface KeyboardLock {
  lock?: (codes?: readonly string[]) => Promise<void>;
  unlock?: () => void;
}

declare global {
  interface Navigator {
    readonly keyboard?: KeyboardLock;
  }
}

function keyboard(): KeyboardLock | undefined {
  return navigator.keyboard;
}

/** Whether this browser can hold the keys at all. */
export function canLockKeyboard(): boolean {
  return typeof keyboard()?.lock === 'function';
}

/**
 * Takes the keys, if the browser allows it.
 *
 * Every code the game binds is asked for, plus the ones a player reaches for by
 * accident mid-match: Escape stays with the browser deliberately, because it is
 * how a player gets out and taking it would be taking the exit away.
 */
export async function lockKeyboard(codes: readonly string[]): Promise<void> {
  const api = keyboard();
  if (api?.lock === undefined) {
    return;
  }
  try {
    await api.lock(codes);
  } catch {
    // Refused — not in fullscreen, or not permitted. The game plays either way.
  }
}

export function unlockKeyboard(): void {
  try {
    keyboard()?.unlock?.();
  } catch {
    // Nothing held it in the first place.
  }
}
