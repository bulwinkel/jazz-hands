import { describe, expect, it } from 'vitest';
import { PLAYER_COLORS } from './config';
import { createPlayers } from './player';
import { addRound, recordingStatus, resultLines } from './roundRecordings';
import { accuracy, stars } from './scoring';
import { parseSettings } from './settings';

describe('list of recorded rounds', () => {
  it('puts a new round first', () => {
    expect(addRound(['b', 'c'], 'a', 3).kept).toEqual(['a', 'b', 'c']);
  });

  it('drops nothing while there is room', () => {
    expect(addRound(['b'], 'a', 3).dropped).toEqual([]);
  });

  it('keeps the newest rounds and hands back the ones it dropped', () => {
    expect(addRound(['b', 'c', 'd'], 'a', 3)).toEqual({ kept: ['a', 'b', 'c'], dropped: ['d'] });
    expect(addRound(['b', 'c', 'd', 'e'], 'a', 2)).toEqual({ kept: ['a', 'b'], dropped: ['c', 'd', 'e'] });
  });

  it('leaves the list it was given as it was', () => {
    const rounds = ['b', 'c', 'd'];
    addRound(rounds, 'a', 3);
    expect(rounds).toEqual(['b', 'c', 'd']);
  });
});

describe('recording status', () => {
  it('says that the last seconds are recorded while a recording runs', () => {
    expect(recordingStatus(true, 0)).toBe('Recording the last seconds…');
    expect(recordingStatus(true, 1)).toBe('Recording the last seconds…');
  });

  it('says that a video is finishing after its recording ended', () => {
    expect(recordingStatus(false, 1)).toBe('Finishing the video…');
  });

  it('says nothing when no recording is on its way', () => {
    expect(recordingStatus(false, 0)).toBe('');
  });
});

describe('result lines of the end card', () => {
  it('give each player their heading, colour, stars, score and accuracy', () => {
    const [left, right] = createPlayers(parseSettings(null, '?players=2&p0=3&p1=5').settings);
    left.score = { ...left.score, score: 1234.6, perfect: 8, good: 2, miss: 0, total: 10 };
    const lines = resultLines([left, right]);
    expect(lines[0]).toEqual({
      title: 'Player 1 · Level 3',
      color: PLAYER_COLORS[0],
      stars: stars(left.score),
      score: 1235,
      accuracyPercent: Math.round(accuracy(left.score) * 100),
    });
    expect(lines[1].title).toBe('Player 2 · Level 5');
    expect(lines[1].color).toBe(PLAYER_COLORS[1]);
  });
});
