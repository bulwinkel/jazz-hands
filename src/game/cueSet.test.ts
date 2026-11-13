/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateChart } from './chart';
import type { ChartEntry, CueRole } from './chart';
import { CUE_SETS, DEFAULT_SEED, LEVELS, SONGS } from './config';
import {
  candidateSeeds,
  chartMix,
  closestCandidate,
  cueSetSeed,
  FIRST_CUE_SET,
  isCueSet,
  measurePool,
  mixDistance,
  nextCueSet,
  playedMix,
  poolDistance,
  poolSeeds,
  typicalMix,
} from './cueSet';
import type { ChartFor, PoolMeasure, RoundCharts } from './cueSet';
import { synthetic } from './fixtures';
import { playEndSec, playStartSec, validateManifest } from './manifest';
import type { Cue, Level, Manifest, SongLength } from './types';

const ALL_LEVELS: Level[] = [1, 2, 3, 4, 5];
const LATER_SETS = [2, 3, 4, 5];

function realSong(index: number): Manifest {
  return validateManifest(JSON.parse(readFileSync(`public${SONGS[index].manifest}`, 'utf8')));
}

function round(manifest: Manifest, players: ChartFor[], length: SongLength = 'short'): RoundCharts {
  return { manifest, players, startSec: playStartSec(manifest, length), endSec: playEndSec(manifest, length) };
}

const solo = (level: Level): ChartFor[] => [{ level, shapes: false }];

/** A cue on beat `beatIndex` of a test song with one beat a second. */
function entry(kind: 'single' | 'double' | 'slide', beatIndex: number, role: CueRole = 'beat'): ChartEntry {
  const cells = kind === 'double' ? [0, 2] : kind === 'slide' ? [0, 8] : [1];
  const cue: Cue = { kind: kind === 'slide' ? 'slide' : 'tap', timeSec: beatIndex, beatIndex, cells, times: cells.map(() => beatIndex) };
  return { cue, role };
}

/** `count` cue-beat entries of one kind, from beat `first` on. */
const entries = (kind: 'single' | 'double' | 'slide', count: number, first: number): ChartEntry[] =>
  Array.from({ length: count }, (_, i) => entry(kind, first + i));

/** The pool of each real song at one level, alone, short length. Each pool takes a while: make it once. */
const pools = new Map<string, PoolMeasure>();
function songPool(index: number, level: Level): PoolMeasure {
  const key = `${index}:${level}`;
  if (!pools.has(key)) pools.set(key, measurePool(round(realSong(index), solo(level))));
  return pools.get(key) as PoolMeasure;
}

describe('cue set numbers', () => {
  it('run from 1 to the count in the config', () => {
    expect(CUE_SETS.count).toBe(5);
    expect([0, 1, 3, 5, 6, 2.5, '2', null].map(isCueSet)).toEqual([false, true, true, true, false, false, false, false]);
  });

  it('step to the next set, and from the last back to the first', () => {
    expect([1, 2, 3, 4, 5].map(nextCueSet)).toEqual([2, 3, 4, 5, 1]);
  });
});

describe('set 1', () => {
  it("gives today's charts: the charts from DEFAULT_SEED, at every level, alone and in pairs", () => {
    const song = realSong(0);
    for (const level of ALL_LEVELS) {
      for (const players of [solo(level), [{ level, shapes: true }, { level: 4 as Level, shapes: false }]]) {
        for (const length of ['short', 'full'] as const) {
          const charts = round(song, players, length);
          const seed = cueSetSeed(FIRST_CUE_SET, charts);
          expect(seed).toBe(DEFAULT_SEED);
          const chart = generateChart(song, { level, shapes: false, seed, endSec: charts.endSec });
          expect(chart).toEqual(generateChart(song, { level, shapes: false, seed: DEFAULT_SEED, endSec: charts.endSec }));
        }
      }
    }
  });
});

describe('candidate seeds', () => {
  it('are a fixed list for each later set, from DEFAULT_SEED + set × the spacing', () => {
    expect(candidateSeeds(3)).toHaveLength(CUE_SETS.candidates);
    expect(candidateSeeds(3)[0]).toBe(DEFAULT_SEED + 3 * CUE_SETS.candidateSpacing);
    expect(candidateSeeds(3)[CUE_SETS.candidates - 1]).toBe(DEFAULT_SEED + 3000 + CUE_SETS.candidates - 1);
  });

  it('differ between all sets, and never are the seed of set 1', () => {
    const all = LATER_SETS.flatMap(candidateSeeds);
    expect(new Set(all).size).toBe(all.length);
    expect(all).not.toContain(DEFAULT_SEED);
  });

  it('of all later sets together are the pool of the typical mix, so every set aims at one mix', () => {
    expect(poolSeeds()).toEqual(LATER_SETS.flatMap(candidateSeeds));
    expect(poolSeeds()).toHaveLength(4 * CUE_SETS.candidates);
  });
});

describe('the mix of a chart', () => {
  it('is its share of slides and its share of doubles', () => {
    const chart = [...entries('slide', 22, 0), ...entries('double', 45, 22), ...entries('single', 33, 67)];
    expect(chartMix(synthetic(60, 120), chart, 3)).toEqual({ slides: 0.22, doubles: 0.45 });
  });

  it('counts only cues on cue beats: no off-beat taps and no taps for the other hand', () => {
    const chart = [...entries('slide', 22, 0), ...entries('double', 45, 22), ...entries('single', 33, 67)];
    const extras = [entry('single', 100, 'offbeat'), entry('single', 101, 'companion')];
    expect(chartMix(synthetic(60, 120), [...chart, ...extras], 3)).toEqual({ slides: 0.22, doubles: 0.45 });
  });

  it('counts only cues in busy music, where the rules allow slides and doubles', () => {
    const song = synthetic(60, 200);
    song.intensity = song.beats.map((_, beat) => (beat < 100 ? 0.8 : 0.2));
    const busy = [...entries('slide', 22, 0), ...entries('double', 45, 22), ...entries('single', 33, 67)];
    const quiet = entries('single', 100, 100);
    expect(chartMix(song, [...busy, ...quiet], 3)).toEqual({ slides: 0.22, doubles: 0.45 });
  });

  it('counts the doubles of level 2 on bar starts only, where the rules allow them', () => {
    // 6 doubles on 20 bar starts, and 60 single taps between them. Bars have 4 beats.
    const barStarts = Array.from({ length: 20 }, (_, bar) => entry(bar < 6 ? 'double' : 'single', bar * 4));
    const between = Array.from({ length: 60 }, (_, i) => entry('single', Math.floor(i / 3) * 4 + 1 + (i % 3)));
    expect(chartMix(synthetic(60, 120), [...barStarts, ...between], 2)).toEqual({ slides: 0, doubles: 0.3 });
  });

  it('is no slides and no doubles at level 1', () => {
    expect(playedMix(round(realSong(1), solo(1)), solo(1)[0], 123)).toEqual({ slides: 0, doubles: 0 });
  });

  it('counts only the part of the song that the round plays', () => {
    const late = { ...synthetic(100, 600), shortStartSec: 300 };
    const whole = playedMix(round(late, solo(3), 'full'), solo(3)[0], 7);
    const part = playedMix(round(late, solo(3), 'short'), solo(3)[0], 7);
    expect(part).not.toEqual(whole);
  });

  it('is as far from a target as its two shares are, added', () => {
    // 12 points of slides and 5 points of doubles.
    expect(mixDistance({ slides: 0.1, doubles: 0.4 }, { slides: 0.22, doubles: 0.45 })).toBeCloseTo(0.17, 10);
  });
});

describe('the typical mix', () => {
  it('is the median share of slides and the median share of doubles', () => {
    const mixes = [
      { slides: 0.3, doubles: 0.2 },
      { slides: 0.1, doubles: 0.5 },
      { slides: 0.2, doubles: 0.4 },
    ];
    expect(typicalMix(mixes)).toEqual({ slides: 0.2, doubles: 0.4 });
  });

  it('comes from the charts of the pool, one for each player', () => {
    const song = realSong(2);
    const charts = round(song, [{ level: 3, shapes: false }, { level: 4, shapes: true }]);
    const pool = measurePool(charts);
    expect(pool.seeds).toEqual(poolSeeds());
    pool.seeds.forEach((seed, i) => expect(pool.mixes[1][i]).toEqual(playedMix(charts, charts.players[1], seed)));
    expect(pool.targets).toEqual(pool.mixes.map(typicalMix));
  });

  it('is close to the rules at level 3, where the rules can be reached', () => {
    const rules = { slides: LEVELS[3].slideChance, doubles: LEVELS[3].doubleChance };
    for (const [index] of SONGS.entries()) {
      expect(mixDistance(songPool(index, 3).targets[0], rules)).toBeLessThan(0.04);
    }
  });

  it('has fewer slides than the rules at level 4, where a slide never follows an off-beat tap', () => {
    for (const [index] of SONGS.entries()) {
      expect(songPool(index, 4).targets[0].slides).toBeLessThan(LEVELS[4].slideChance - 0.05);
    }
  });
});

describe('the seed of a later set', () => {
  const song = realSong(2);

  it('is the candidate closest to the typical mix, the earlier one on a tie', () => {
    for (const level of [2, 3, 4] as Level[]) {
      const charts = round(song, solo(level));
      const pool = measurePool(charts);
      for (const set of LATER_SETS) {
        const distances = candidateSeeds(set).map((seed) => poolDistance(pool, seed));
        const closest = candidateSeeds(set)[distances.indexOf(Math.min(...distances))];
        expect(closestCandidate(set, pool)).toBe(closest);
        expect(cueSetSeed(set, charts)).toBe(closest);
      }
    }
  });

  it('is the first candidate when all are equally close, as at level 1', () => {
    expect(cueSetSeed(4, round(song, solo(1)))).toBe(candidateSeeds(4)[0]);
  });

  it('is the same on every run', () => {
    const charts = round(song, [{ level: 3, shapes: false }, { level: 4, shapes: true }]);
    expect(cueSetSeed(3, charts)).toBe(cueSetSeed(3, charts));
  });

  it('for two players is the candidate with the smallest sum of both distances', () => {
    const players: ChartFor[] = [{ level: 3, shapes: false }, { level: 4, shapes: false }];
    const alone = players.map((player) => measurePool(round(song, [player])));
    const sums = candidateSeeds(2).map((seed) => poolDistance(alone[0], seed) + poolDistance(alone[1], seed));
    expect(cueSetSeed(2, round(song, players))).toBe(candidateSeeds(2)[sums.indexOf(Math.min(...sums))]);
  });

  it('plays like the level usually does, on every song: close to the typical mix', () => {
    // A seed of the pool is a median of 8 points from the typical mix at level 3, and 9 at
    // level 4. The chosen sets are at most 3.9 and 5.6 points from it today.
    const bounds: Partial<Record<Level, number>> = { 3: 0.06, 4: 0.08 };
    for (const [index] of SONGS.entries()) {
      for (const level of [3, 4] as Level[]) {
        const pool = songPool(index, level);
        for (const set of LATER_SETS) {
          expect(poolDistance(pool, closestCandidate(set, pool))).toBeLessThan(bounds[level] as number);
        }
      }
    }
  });
});
