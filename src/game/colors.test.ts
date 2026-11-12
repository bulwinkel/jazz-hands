import { describe, expect, it } from 'vitest';
import { cueColor, DUE_COLOR, mixColors, withAlpha } from './colors';
import { PLAYER_COLORS } from './config';

describe('withAlpha', () => {
  it('adds the alpha as two hex digits', () => {
    expect(withAlpha('#22d3ee', 1)).toBe('#22d3eeff');
    expect(withAlpha('#22d3ee', 0.5)).toBe('#22d3ee80');
    expect(withAlpha('#22d3ee', 0)).toBe('#22d3ee00');
  });

  it('keeps the alpha between 0 and 1', () => {
    expect(withAlpha('#22d3ee', 3)).toBe('#22d3eeff');
    expect(withAlpha('#22d3ee', -1)).toBe('#22d3ee00');
  });
});

describe('mixColors', () => {
  it('gives each end colour at 0 and at 1', () => {
    expect(mixColors('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixColors('#000000', '#ffffff', 1)).toBe('#ffffff');
  });

  it('mixes red, green and blue each on its own', () => {
    expect(mixColors('#000000', '#ff8000', 0.5)).toBe('#804000');
    expect(mixColors('#102030', '#302010', 0.5)).toBe('#202020');
  });

  it('writes a small value with a leading zero', () => {
    expect(mixColors('#000000', '#100a05', 0.5)).toBe('#080503');
  });
});

describe('cue colour', () => {
  it.each(PLAYER_COLORS)('is the player colour %s when the cue appears', (playerColor) => {
    expect(cueColor(playerColor, 1)).toBe(playerColor);
  });

  it.each(PLAYER_COLORS)('is the due colour on the beat, for player colour %s', (playerColor) => {
    expect(cueColor(playerColor, 0)).toBe(DUE_COLOR);
  });

  it('is half-way between the two in the middle of the approach', () => {
    expect(cueColor('#22d3ee', 0.5)).toBe(mixColors('#22d3ee', DUE_COLOR, 0.5));
  });

  it('stays the player colour before the cue appears, and the due colour after the beat', () => {
    expect(cueColor('#22d3ee', 1.8)).toBe('#22d3ee');
    expect(cueColor('#22d3ee', -0.3)).toBe(DUE_COLOR);
  });

  it('moves toward the due colour all the way, so a nearer cue never looks later', () => {
    const blueOf = (color: string): number => parseInt(color.slice(5, 7), 16);
    for (const playerColor of PLAYER_COLORS) {
      // Both player colours have more blue than the due colour: blue must fall step by step.
      let previous = blueOf(cueColor(playerColor, 1));
      for (let remaining = 0.9; remaining >= 0; remaining -= 0.1) {
        const blue = blueOf(cueColor(playerColor, remaining));
        expect(blue).toBeLessThan(previous);
        previous = blue;
      }
    }
  });
});
