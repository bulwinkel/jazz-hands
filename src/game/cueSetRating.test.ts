import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileNameOf, newRoundId, ratedRoundOf, RATINGS_PATH, ratingRecord, saveRating } from './cueSetRating';
import type { EndedRound, RatedRound, RatingPlayer } from './cueSetRating';

const ROUND: RatedRound = {
  id: '20261113-083015-k3j9x2',
  runReport: 'run-20261113-083015.json',
  songId: 'todo-bueno',
  length: 'short',
  playerCount: 2,
  cueSet: 5,
  seed: 20261540,
  cueSetRandom: true,
  moveShare: 0.7,
};

/** Player 2 on level 4, after a round with 80 perfect, 12 good and 8 miss. */
const PLAYER: RatingPlayer = {
  index: 1,
  level: 4,
  shapes: true,
  faces: false,
  mix: { slides: 0.212121212, doubles: 0.0833333, offbeats: 0.3, cues: 100 },
  moves: { point: 3, circle: 1 },
  score: { score: 13456.6, combo: 4, maxCombo: 31, perfect: 80, good: 12, miss: 8, total: 100 },
};

const SAVED_AT = new Date('2026-11-13T08:31:02.500Z');

describe('a rating record', () => {
  it('holds the round, the player, what their chart held, how they did and the rating', () => {
    expect(ratingRecord(ROUND, PLAYER, 4, SAVED_AT)).toEqual({
      savedAt: '2026-11-13T08:31:02.500Z',
      roundId: '20261113-083015-k3j9x2',
      runReport: 'run-20261113-083015.json',
      song: 'todo-bueno',
      length: 'short',
      playerCount: 2,
      cueSet: 5,
      seed: 20261540,
      cueSetRandom: true,
      moveShare: 0.7,
      player: 1,
      level: 4,
      shapes: true,
      faces: false,
      chart: { slides: 0.2121, doubles: 0.0833, offbeats: 0.3, cues: 100, moves: { point: 3, circle: 1 } },
      result: { score: 13457, accuracy: 0.86, perfect: 80, good: 12, miss: 8 },
      rating: 4,
    });
  });

  it('gives both players and every changed rating of the round the same round id', () => {
    const first = ratingRecord(ROUND, { ...PLAYER, index: 0 }, 2, SAVED_AT);
    const second = ratingRecord(ROUND, PLAYER, 5, SAVED_AT);
    const changed = ratingRecord(ROUND, PLAYER, 3, new Date('2026-11-13T08:31:09Z'));
    expect(new Set([first.roundId, second.roundId, changed.roundId])).toEqual(new Set([ROUND.id]));
  });

  it('names no run report while the dev server has not saved it yet', () => {
    expect(ratingRecord({ ...ROUND, runReport: null }, PLAYER, 4, SAVED_AT).runReport).toBeNull();
  });

  it('keeps its own copy of the move counts', () => {
    const player = { ...PLAYER, moves: { point: 3, circle: 1 } };
    const record = ratingRecord(ROUND, player, 4, SAVED_AT);
    player.moves.point = 9;
    expect(record.chart.moves.point).toBe(3);
  });

  it('gives an accuracy of 0 for a round with no cues', () => {
    const idle = { ...PLAYER, score: { ...PLAYER.score, score: 0, perfect: 0, good: 0, miss: 0, total: 0 } };
    expect(ratingRecord(ROUND, idle, 1, SAVED_AT).result.accuracy).toBe(0);
  });
});

describe('the round that the players rate', () => {
  const ENDED: EndedRound = {
    endedAt: new Date('2026-11-13T08:30:15Z'),
    songId: 'todo-bueno',
    length: 'full',
    playerCount: 1,
    cueSet: 2,
    seed: 20261490,
    cueSetRandom: false,
    moveShare: 0,
  };

  it('keeps what the round played, with a new id and no run report yet', () => {
    expect(ratedRoundOf(ENDED, () => 0)).toEqual({
      id: '20261113-083015-000000',
      runReport: null,
      songId: 'todo-bueno',
      length: 'full',
      playerCount: 1,
      cueSet: 2,
      seed: 20261490,
      cueSetRandom: false,
      moveShare: 0,
    });
  });

  it('is none for a round with no cue set, so its results have no rating row', () => {
    expect(ratedRoundOf({ ...ENDED, cueSet: null }, () => 0)).toBeNull();
  });
});

describe('a round id', () => {
  it('starts with the time the round ended, then 6 letters and digits', () => {
    expect(newRoundId(new Date('2026-11-13T08:30:15.123Z'), () => 0.5)).toMatch(/^20261113-083015-[0-9a-z]{6}$/);
  });

  it('differs for two rounds that end in the same second', () => {
    const endedAt = new Date('2026-11-13T08:30:15Z');
    expect(newRoundId(endedAt, () => 0.1)).not.toBe(newRoundId(endedAt, () => 0.2));
  });

  it('keeps 6 letters for the smallest roll', () => {
    expect(newRoundId(new Date('2026-11-13T08:30:15Z'), () => 0)).toBe('20261113-083015-000000');
  });
});

describe('the file name of a saved report', () => {
  it('is the last part of the path', () => {
    expect(fileNameOf('/home/dancer/game/test-results/run-20261113-083015.json')).toBe('run-20261113-083015.json');
    expect(fileNameOf('C:\\game\\test-results\\run-1.json')).toBe('run-1.json');
    expect(fileNameOf('run-1.json')).toBe('run-1.json');
  });
});

describe('saving a rating', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const record = ratingRecord(ROUND, PLAYER, 4, SAVED_AT);

  it('posts the record as JSON to the dev-server route', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    expect(await saveRating(record)).toBe(true);
    expect(fetch).toHaveBeenCalledWith(RATINGS_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
  });

  it('answers false when the server refuses the record', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    expect(await saveRating(record)).toBe(false);
  });

  it('answers false, and does not throw, when there is no server', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    expect(await saveRating(record)).toBe(false);
  });
});
