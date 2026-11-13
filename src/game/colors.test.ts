import { describe, expect, it } from 'vitest';
import { CUE_START_COLOR, cueColor, mixColors, withAlpha } from './colors';
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

/** How far apart two colours are: the sum of the differences in red, green and blue. */
function distance(a: string, b: string): number {
  let sum = 0;
  for (const start of [1, 3, 5]) {
    const channelA = parseInt(a.slice(start, start + 2), 16);
    const channelB = parseInt(b.slice(start, start + 2), 16);
    sum += Math.abs(channelA - channelB);
  }
  return sum;
}

describe('cue colour', () => {
  it('starts as white', () => {
    expect(CUE_START_COLOR).toBe('#ffffff');
  });

  it.each(PLAYER_COLORS)('is white when the cue appears, for player colour %s', (playerColor) => {
    expect(cueColor(playerColor, 1)).toBe(CUE_START_COLOR);
  });

  it.each(PLAYER_COLORS)('is the player colour %s on the beat', (playerColor) => {
    expect(cueColor(playerColor, 0)).toBe(playerColor);
  });

  it('is half-way between the two in the middle of the approach', () => {
    expect(cueColor('#22d3ee', 0.5)).toBe(mixColors(CUE_START_COLOR, '#22d3ee', 0.5));
  });

  it('stays white before the cue appears, and the player colour after the beat', () => {
    expect(cueColor('#22d3ee', 1.8)).toBe(CUE_START_COLOR);
    expect(cueColor('#22d3ee', -0.3)).toBe('#22d3ee');
  });

  it('moves toward the player colour all the way, so a nearer cue never looks later', () => {
    for (const playerColor of PLAYER_COLORS) {
      let previous = distance(cueColor(playerColor, 1), playerColor);
      for (let remaining = 0.9; remaining >= 0; remaining -= 0.1) {
        const now = distance(cueColor(playerColor, remaining), playerColor);
        expect(now).toBeLessThan(previous);
        previous = now;
      }
    }
  });
});
