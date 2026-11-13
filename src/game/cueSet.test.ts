/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateChart } from './chart';
import type { ChartEntry, CueRole } from './chart';
import { CUE_SETS, DEFAULT_SEED, SONGS } from './config';
import {
  candidateSeeds,
  cueSetSeed,
  FIRST_CUE_SET,
  isCueSet,
  nextCueSet,
  roundDistance,
  ruleDistance,
} from './cueSet';
import type { ChartFor, RoundCharts } from './cueSet';
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
});

describe('the distance from the level rules', () => {
  it('is 0 for a chart with exactly the shares of slides and doubles that the rules give', () => {
    // Level 3 asks for 22% slides and 45% doubles.
    const chart = [...entries('slide', 22, 0), ...entries('double', 45, 22), ...entries('single', 33, 67)];
    expect(ruleDistance(synthetic(60, 120), chart, 3)).toBeCloseTo(0, 10);
  });

  it('adds up how far each share is off', () => {
    // 10% slides and 40% doubles: 12 points and 5 points off.
    const chart = [...entries('slide', 10, 0), ...entries('double', 40, 10), ...entries('single', 50, 50)];
    expect(ruleDistance(synthetic(60, 120), chart, 3)).toBeCloseTo(0.17, 10);
  });

  it('counts only cues on cue beats: no off-beat taps and no taps for the other hand', () => {
    const chart = [...entries('slide', 22, 0), ...entries('double', 45, 22), ...entries('single', 33, 67)];
    const extras = [entry('single', 100, 'offbeat'), entry('single', 101, 'companion')];
    expect(ruleDistance(synthetic(60, 120), [...chart, ...extras], 3)).toBeCloseTo(0, 10);
  });

  it('counts only cues in busy music, where the rules allow slides and doubles', () => {
    const song = synthetic(60, 200);
    song.intensity = song.beats.map((_, beat) => (beat < 100 ? 0.8 : 0.2));
    const busy = [...entries('slide', 22, 0), ...entries('double', 45, 22), ...entries('single', 33, 67)];
    const quiet = entries('single', 100, 100);
    expect(ruleDistance(song, [...busy, ...quiet], 3)).toBeCloseTo(0, 10);
  });

  it('counts the doubles of level 2 on bar starts only, where the rules allow them', () => {
    // Level 2 asks for doubles on 30% of the busy bar starts. Bars have 4 beats.
    const barStarts = Array.from({ length: 20 }, (_, bar) => entry(bar < 6 ? 'double' : 'single', bar * 4));
    const between = Array.from({ length: 60 }, (_, i) => entry('single', Math.floor(i / 3) * 4 + 1 + (i % 3)));
    expect(ruleDistance(synthetic(60, 120), [...barStarts, ...between], 2)).toBeCloseTo(0, 10);
  });

  it('is 0 at level 1, which has no slides or doubles', () => {
    const song = realSong(1);
    expect(roundDistance(round(song, solo(1)), 123)).toBe(0);
  });
});

describe('the seed of a later set', () => {
  const song = realSong(2);

  it('is the candidate closest to the level rules, the earlier one on a tie', () => {
    for (const level of [2, 3, 4] as Level[]) {
      const charts = round(song, solo(level));
      for (const set of LATER_SETS) {
        const distances = candidateSeeds(set).map((seed) => roundDistance(charts, seed));
        const closest = distances.indexOf(Math.min(...distances));
        expect(cueSetSeed(set, charts)).toBe(candidateSeeds(set)[closest]);
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
    const pair = round(song, players);
    const sums = candidateSeeds(2).map(
      (seed) => roundDistance(round(song, [players[0]]), seed) + roundDistance(round(song, [players[1]]), seed),
    );
    expect(cueSetSeed(2, pair)).toBe(candidateSeeds(2)[sums.indexOf(Math.min(...sums))]);
  });

  it('measures only the part of the song that the round plays', () => {
    const late = { ...synthetic(100, 600), shortStartSec: 300 };
    const whole = round(late, solo(3), 'full');
    const part = round(late, solo(3), 'short');
    expect(roundDistance(part, 7)).not.toBe(roundDistance(whole, 7));
  });

  it('keeps every later set of every song close to the level rules', () => {
    // Random seeds on these songs are a median of 8 points off at level 3, and 21 at level 4.
    // Level 4 cannot reach its rules: a slide never follows an off-beat tap, and a double needs
    // both hands free, so its charts average 19 points under them.
    const bounds: Partial<Record<Level, number>> = { 3: 0.06, 4: 0.16 };
    for (const [index] of SONGS.entries()) {
      const manifest = realSong(index);
      for (const level of [3, 4] as Level[]) {
        const charts = round(manifest, solo(level));
        for (const set of LATER_SETS) {
          expect(roundDistance(charts, cueSetSeed(set, charts))).toBeLessThan(bounds[level] as number);
        }
      }
    }
  });
});
