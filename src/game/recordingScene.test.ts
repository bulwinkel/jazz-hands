import { describe, expect, it } from 'vitest';
import { createPlayers } from './player';
import { resultLines } from './recordingScene';
import { parseSettings } from './settings';

describe('result lines of the end card', () => {
  it('give each player their heading, colour, stars, score and accuracy', () => {
    const [left, right] = createPlayers(parseSettings(null, '?players=2&p0=3&p1=5').settings);
    // 8 Perfect and 2 Good of 10 cues: 90% accuracy, which gives 5 stars.
    left.score = { ...left.score, score: 1234.6, perfect: 8, good: 2, miss: 0, total: 10 };
    expect(resultLines([left, right])).toEqual([
      { title: 'Player 1 · Level 3', color: '#22d3ee', stars: 5, score: 1235, accuracyPercent: 90 },
      { title: 'Player 2 · Level 5', color: '#e879f9', stars: 1, score: 0, accuracyPercent: 0 },
    ]);
  });
});
