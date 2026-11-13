import { describe, expect, it } from 'vitest';
import { createPlayers } from './player';
import { endCard } from './recordingScene';
import { parseSettings } from './settings';

describe('the end card', () => {
  const players = () => createPlayers(parseSettings(null, '?players=2&p0=3&p1=5').settings);

  it('gives each player their heading, colour, stars, score, accuracy and moves', () => {
    const [left, right] = players();
    // 8 Perfect and 2 Good of 10 cues: 90% accuracy, which gives 5 stars.
    left.score = { ...left.score, score: 1234.6, perfect: 8, good: 2, miss: 0, total: 10 };
    left.moves = { point: 1, circle: 2 };
    expect(endCard([left, right], 4).players).toEqual([
      { title: 'Player 1 · Level 3', color: '#22d3ee', stars: 5, score: 1235, accuracyPercent: 90, moves: '1 point · 2 circles' },
      { title: 'Player 2 · Level 5', color: '#e879f9', stars: 1, score: 0, accuracyPercent: 0, moves: null },
    ]);
  });

  it('names the round\'s cue set as the results screen does, and no set for a seed from the URL', () => {
    expect(endCard(players(), 4).cueSet).toBe('🎲 Set 4');
    expect(endCard(players(), null).cueSet).toBeNull();
  });
});
