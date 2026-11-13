import { describe, expect, it } from 'vitest';
import { GROW_START_SCALE, SHRINK_START_SCALE } from './config';
import { CUE_STYLES, isCueStyle, markScale, nextCueStyle } from './cueStyle';

describe('cue styles', () => {
  it('step from one to the next and round again', () => {
    expect(nextCueStyle('shrink')).toBe('grow');
    expect(nextCueStyle('grow')).toBe('shrink');
  });

  it('are told from other values', () => {
    expect(isCueStyle('grow')).toBe(true);
    expect(isCueStyle('big')).toBe(false);
    expect(isCueStyle(undefined)).toBe(false);
  });
});

describe('timing mark', () => {
  it.each(CUE_STYLES)('is exactly the size of the cell on the beat, in the %s style', (style) => {
    expect(markScale(style, 0)).toBe(1);
  });

  it.each(CUE_STYLES)('stays the size of the cell after the beat, in the %s style', (style) => {
    expect(markScale(style, -0.4)).toBe(1);
  });

  it('starts outside the cell and comes in, in the shrink style', () => {
    expect(markScale('shrink', 1)).toBe(SHRINK_START_SCALE);
    expect(markScale('shrink', 0.5)).toBeCloseTo(1.6);
    expect(markScale('shrink', 3)).toBe(SHRINK_START_SCALE);
  });

  it('starts small inside the cell and never leaves it, in the grow style', () => {
    expect(markScale('grow', 1)).toBe(GROW_START_SCALE);
    expect(markScale('grow', 0.5)).toBeCloseTo(0.575);
    expect(markScale('grow', 3)).toBe(GROW_START_SCALE);
    for (let remaining = 1; remaining >= -0.5; remaining -= 0.05) {
      expect(markScale('grow', remaining)).toBeLessThanOrEqual(1);
    }
  });

  it('makes a later cue smaller than an earlier one in the grow style, so they nest', () => {
    // Two cues for one cell, 0.4 of the approach time apart.
    expect(markScale('grow', 0.7)).toBeLessThan(markScale('grow', 0.3));
  });
});
