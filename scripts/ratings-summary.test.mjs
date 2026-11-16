import { describe, expect, it } from 'vitest';
import { formatTable, groupRatings, latestRatings, readRatings, SUMMARIES, summaryText } from './ratings-summary.mjs';

/** A record as the game saves it, with only what the summary reads changed by `fields`. */
function record(fields) {
  return {
    savedAt: '2026-11-13T08:31:00.000Z',
    roundId: 'round-a',
    runReport: 'run-20261113-083015.json',
    song: 'todo-bueno',
    length: 'short',
    playerCount: 2,
    cueSet: 3,
    seed: 20261400,
    cueSetRandom: true,
    moveShare: 0.35,
    player: 0,
    level: 3,
    shapes: false,
    faces: false,
    chart: { slides: 0.2, doubles: 0.1, offbeats: 0.2, cues: 90, moves: { point: 2, circle: 1 } },
    result: { score: 9000, accuracy: 0.9, perfect: 80, good: 2, miss: 8 },
    rating: 3,
    ...fields,
  };
}

const lines = (records) => records.map((each) => JSON.stringify(each)).join('\n');
const byLevelAndSet = SUMMARIES.find((summary) => summary.title === 'By level and set');
const byLevelAndShare = SUMMARIES.find((summary) => summary.title === 'By level and share of moves');
const bySong = SUMMARIES.find((summary) => summary.title === 'By song');

describe('reading a ratings file', () => {
  it('reads one record from each line', () => {
    const text = `${lines([record({ rating: 4 }), record({ player: 1, rating: 2 })])}\n`;
    const { records, skipped } = readRatings(text);
    expect(records.map((each) => [each.player, each.rating])).toEqual([[0, 4], [1, 2]]);
    expect(skipped).toBe(0);
  });

  it('reads a record saved before 2026-11-16, whose chart also holds a share of fast slides', () => {
    const olderChart = {
      slides: 0.2,
      doubles: 0.1,
      fastSlides: 0.05,
      offbeats: 0.2,
      cues: 90,
      moves: { point: 2, circle: 1 },
    };
    const older = record({ chart: olderChart, level: 4, cueSet: 5, rating: 5 });
    const { records, skipped } = readRatings(lines([older]));
    expect(skipped).toBe(0);
    const text = summaryText(records, skipped);
    expect(text).toContain('Ratings: 1');
    expect(text).toContain('By level and set\nLevel  Set  Ratings  Mean\n-----  ---  -------  ----\n4      5    1        5.00');
  });

  it('leaves out empty lines, and does not count them', () => {
    expect(readRatings(`\n${lines([record({})])}\n\n`)).toMatchObject({ skipped: 0 });
  });

  it('leaves out and counts a line cut short, and a line that is not a rating', () => {
    const cut = JSON.stringify(record({})).slice(0, 40);
    const text = [cut, JSON.stringify({ hello: 1 }), JSON.stringify(record({ rating: 6 })), '[]', 'null'].join('\n');
    expect(readRatings(text)).toEqual({ records: [], skipped: 5 });
  });
});

describe('the last record of each round and player', () => {
  it('replaces the earlier ratings of the same round and player', () => {
    const records = [
      record({ player: 0, rating: 4, savedAt: '2026-11-13T08:31:00.000Z' }),
      record({ player: 1, rating: 2, savedAt: '2026-11-13T08:31:01.000Z' }),
      record({ player: 0, rating: 5, savedAt: '2026-11-13T08:31:02.000Z' }),
    ];
    const kept = latestRatings(records);
    expect(kept.map((each) => [each.player, each.rating])).toEqual([[0, 5], [1, 2]]);
  });

  it('keeps one rating of each round', () => {
    const records = [record({ roundId: 'round-a', rating: 1 }), record({ roundId: 'round-b', rating: 5 })];
    expect(latestRatings(records).map((each) => each.rating)).toEqual([1, 5]);
  });

  it('keeps the record saved last, also when its line comes earlier', () => {
    const records = [
      record({ rating: 5, savedAt: '2026-11-13T08:31:09.000Z' }),
      record({ rating: 2, savedAt: '2026-11-13T08:31:03.000Z' }),
    ];
    expect(latestRatings(records).map((each) => each.rating)).toEqual([5]);
  });

  it('keeps the later line of two saved at the same time', () => {
    const records = [record({ rating: 2 }), record({ rating: 4 })];
    expect(latestRatings(records).map((each) => each.rating)).toEqual([4]);
  });
});

describe('grouping the ratings', () => {
  const ratings = [
    record({ roundId: 'r1', level: 4, cueSet: 5, moveShare: 0.7, song: 'todo-bueno', rating: 5 }),
    record({ roundId: 'r2', level: 4, cueSet: 6, moveShare: 0.7, song: 'all-eyes-on-us', rating: 3 }),
    record({ roundId: 'r3', level: 3, cueSet: 1, moveShare: 0, song: 'todo-bueno', rating: 2 }),
    record({ roundId: 'r4', level: 4, cueSet: 5, moveShare: 0.7, song: 'todo-bueno', rating: 4 }),
  ];

  it('gives the count and the mean of each level and set, in order', () => {
    expect(groupRatings(ratings, byLevelAndSet.groupOf)).toEqual([
      { values: [3, 1], count: 1, mean: 2 },
      { values: [4, 5], count: 2, mean: 4.5 },
      { values: [4, 6], count: 1, mean: 3 },
    ]);
  });

  it('puts two sets with the same share of moves into one group', () => {
    expect(groupRatings(ratings, byLevelAndShare.groupOf)).toEqual([
      { values: [3, 0], count: 1, mean: 2 },
      { values: [4, 0.7], count: 3, mean: 4 },
    ]);
  });

  it('groups by song, in the order of the letters', () => {
    expect(groupRatings(ratings, bySong.groupOf)).toEqual([
      { values: ['all-eyes-on-us'], count: 1, mean: 3 },
      { values: ['todo-bueno'], count: 3, mean: 11 / 3 },
    ]);
  });
});

describe('the printed summary', () => {
  it('lays out a table with columns that line up', () => {
    expect(formatTable(['Level', 'Set', 'Ratings', 'Mean'], [['3', '1', '12', '4.25']])).toBe(
      ['Level  Set  Ratings  Mean', '-----  ---  -------  ----', '3      1    12       4.25'].join('\n'),
    );
  });

  it('counts the ratings that count, after a changed rating', () => {
    const records = [
      record({ player: 0, rating: 4, savedAt: '2026-11-13T08:31:00.000Z' }),
      record({ player: 1, rating: 2, savedAt: '2026-11-13T08:31:01.000Z' }),
      record({ player: 0, rating: 5, savedAt: '2026-11-13T08:31:02.000Z' }),
    ];
    const text = summaryText(records, 1);
    expect(text).toContain('Ratings: 2\nRecords: 3 (1 replaced by a later choice)\nLines skipped: 1');
    expect(text).toContain('By level and set\nLevel  Set  Ratings  Mean\n-----  ---  -------  ----\n3      3    2        3.50');
    expect(text).toContain('By level and share of moves\nLevel  Moves  Ratings  Mean');
    expect(text).toContain('By song\nSong        Ratings  Mean\n----------  -------  ----\ntodo-bueno  2        3.50');
  });

  it('prints only the counts when there is no rating', () => {
    expect(summaryText([], 0)).toBe('Ratings: 0\nRecords: 0 (0 replaced by a later choice)\nLines skipped: 0');
  });
});
