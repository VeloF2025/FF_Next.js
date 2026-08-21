/**
 * Keyboard movement for the purchase-order listbox.
 *
 * Pure so the navigation rules can be tested without a DOM.
 *
 * Options that cannot be selected (fully-received POs) are deliberately still
 * reachable: a keyboard or screen-reader user needs to be able to land on one
 * to discover it exists and why it is unavailable. Selection is refused at the
 * point of choosing, not by hiding the row from navigation.
 */

export type NavKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End';

export const NAV_KEYS: readonly NavKey[] = ['ArrowDown', 'ArrowUp', 'Home', 'End'];

export function isNavKey(key: string): key is NavKey {
  return (NAV_KEYS as readonly string[]).includes(key);
}

/**
 * Next active index, wrapping at both ends.
 *
 * `current` of -1 means nothing is active yet: ArrowDown starts at the first
 * option and ArrowUp at the last, which is what a user expects when they open
 * a list and immediately press an arrow.
 *
 * Returns -1 for an empty list so the caller renders no active descendant.
 */
export function nextActiveIndex(current: number, key: NavKey, count: number): number {
  if (count <= 0) return -1;

  switch (key) {
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    case 'ArrowDown':
      return current < 0 ? 0 : (current + 1) % count;
    case 'ArrowUp':
      return current < 0 ? count - 1 : (current - 1 + count) % count;
  }
}
