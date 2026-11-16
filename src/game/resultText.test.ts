import { describe, expect, it } from 'vitest';
import { cueSetLine, movesLine, playerHeading, REPLAY_PROMPT } from './resultText';

describe('the replay prompt', () => {
  it('says where to hold: the Start cell, high to the right on the mirrored screen', () => {
    expect(REPLAY_PROMPT).toBe('Hold a hand high to your right to play again 🙌');
  });
});

describe('player heading', () => {
  it('names the player from 1 and their level', () => {
    expect(playerHeading({ index: 0, level: 3 })).toBe('Player 1 · Level 3');
    expect(playerHeading({ index: 1, level: 5 })).toBe('Player 2 · Level 5');
  });
});

describe('cue set line', () => {
  it('names the set that the round played', () => {
    expect(cueSetLine(1)).toBe('🎲 Set 1');
    expect(cueSetLine(6)).toBe('🎲 Set 6');
  });

  it('is left out for a round with no set: a seed from the URL', () => {
    expect(cueSetLine(null)).toBeNull();
  });
});

describe('moves line', () => {
  it('counts each move in the plural', () => {
    expect(movesLine({ point: 3, circle: 2 })).toBe('3 points · 2 circles');
  });

  it('names a single move in the singular', () => {
    expect(movesLine({ point: 1, circle: 1 })).toBe('1 point · 1 circle');
    expect(movesLine({ point: 1, circle: 4 })).toBe('1 point · 4 circles');
  });

  it('leaves out a move that the chart does not hold', () => {
    expect(movesLine({ point: 0, circle: 2 })).toBe('2 circles');
    expect(movesLine({ point: 5, circle: 0 })).toBe('5 points');
  });

  it('is left out for a chart with no moves', () => {
    expect(movesLine({ point: 0, circle: 0 })).toBeNull();
  });
});
