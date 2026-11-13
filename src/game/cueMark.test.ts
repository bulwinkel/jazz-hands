import { describe, expect, it } from 'vitest';
import { GROW_START_SCALE } from './config';
import { markScale } from './cueMark';

describe('timing mark', () => {
  it('is exactly the size of the cell on the beat', () => {
    expect(markScale(0)).toBe(1);
  });

  it('stays the size of the cell after the beat', () => {
    expect(markScale(-0.4)).toBe(1);
  });

  it('starts small inside the cell and never leaves it', () => {
    expect(markScale(1)).toBe(GROW_START_SCALE);
    expect(markScale(0.5)).toBeCloseTo(0.575);
    expect(markScale(3)).toBe(GROW_START_SCALE);
    for (let remaining = 1; remaining >= -0.5; remaining -= 0.05) {
      expect(markScale(remaining)).toBeLessThanOrEqual(1);
    }
  });

  it('makes a later cue smaller than an earlier one, so they nest', () => {
    // Two cues for one cell, 0.4 of the approach time apart.
    expect(markScale(0.7)).toBeLessThan(markScale(0.3));
  });
});
