import { describe, expect, it } from 'vitest';
import { carouselOffset, stepRing } from './carousel';

describe('carousel offset', () => {
  it('is 0 for the chosen card', () => {
    expect(carouselOffset(2, 2, 6)).toBe(0);
  });

  it('counts cards to the right as positive and to the left as negative', () => {
    expect(carouselOffset(3, 2, 6)).toBe(1);
    expect(carouselOffset(4, 2, 6)).toBe(2);
    expect(carouselOffset(1, 2, 6)).toBe(-1);
    expect(carouselOffset(0, 2, 6)).toBe(-2);
  });

  it('goes the short way round the ring', () => {
    // From the first of six songs, the last song is one step to the left.
    expect(carouselOffset(5, 0, 6)).toBe(-1);
    expect(carouselOffset(4, 0, 6)).toBe(-2);
    expect(carouselOffset(0, 5, 6)).toBe(1);
  });

  it('puts the card straight across an even ring on the left', () => {
    expect(carouselOffset(3, 0, 6)).toBe(-3);
    expect(carouselOffset(1, 0, 2)).toBe(-1);
  });

  it('gives an odd ring the same number of cards on each side', () => {
    const offsets = [0, 1, 2, 3, 4].map((index) => carouselOffset(index, 0, 5));
    expect(offsets).toEqual([0, 1, 2, -2, -1]);
  });

  it('gives every card of a ring its own offset', () => {
    for (const count of [1, 2, 3, 6, 7, 20]) {
      for (let chosen = 0; chosen < count; chosen++) {
        const offsets = Array.from({ length: count }, (_, index) => carouselOffset(index, chosen, count));
        expect(new Set(offsets).size).toBe(count);
        expect(Math.max(...offsets.map(Math.abs))).toBeLessThanOrEqual(Math.floor(count / 2));
      }
    }
  });
});

describe('a step along the ring', () => {
  it('goes to the next or the previous song', () => {
    expect(stepRing(2, 1, 6)).toBe(3);
    expect(stepRing(2, -1, 6)).toBe(1);
  });

  it('goes round at both ends', () => {
    expect(stepRing(5, 1, 6)).toBe(0);
    expect(stepRing(0, -1, 6)).toBe(5);
  });

  it('stays on the only song of a ring of one', () => {
    expect(stepRing(0, 1, 1)).toBe(0);
    expect(stepRing(0, -1, 1)).toBe(0);
  });
});
