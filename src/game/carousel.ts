/**
 * The song carousel shows the songs as a ring: after the last song comes the first again.
 * This module is the arithmetic of that ring. It knows nothing about the page.
 */

/**
 * How far a card sits from the chosen card, counted the short way round the ring.
 * 0 is the chosen card, -1 the card to its left, 1 the card to its right.
 * With an even number of cards, the card straight across the ring counts as on the left.
 */
export function carouselOffset(index: number, chosen: number, count: number): number {
  const half = Math.floor(count / 2);
  return wrap(index - chosen + half, count) - half;
}

/** The index a number of steps along the ring. Negative steps go left. */
export function stepRing(index: number, steps: number, count: number): number {
  return wrap(index + steps, count);
}

/** `value` modulo `count`, never negative. */
function wrap(value: number, count: number): number {
  return ((value % count) + count) % count;
}
