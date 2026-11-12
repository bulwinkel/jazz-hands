import { describe, expect, it } from 'vitest';
import { playerHeading } from './resultText';

describe('player heading', () => {
  it('names the player from 1 and their level', () => {
    expect(playerHeading({ index: 0, level: 3 })).toBe('Player 1 · Level 3');
    expect(playerHeading({ index: 1, level: 5 })).toBe('Player 2 · Level 5');
  });
});
