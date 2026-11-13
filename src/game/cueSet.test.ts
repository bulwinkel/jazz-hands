/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chartEntries, entriesFrom } from './chart';
import type { ChartEntry, CueRole } from './chart';
import { CUE_SETS, DEFAULT_SEED, LEVELS, SONGS } from './config';
import {
  candidateSeeds,
  chartMix,
  closestCandidate,
  CUE_SET_COUNT,
  cueSetMoveShare,
  cueSetSeed,
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

const ALL_SETS = [1, 2, 3, 4, 5, 6];

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
  it('run from 1 to the number of move shares in the config: 6', () => {
    expect(CUE_SET_COUNT).toBe(6);
    expect([0, 1, 3, 6, 7, 2.5, '2', null].map(isCueSet)).toEqual([false, true, true, true, false, false, false, false]);
  });

  it('step to the next set, and from the last back to the first', () => {
    expect(ALL_SETS.map(nextCueSet)).toEqual([2, 3, 4, 5, 6, 1]);
  });
});

describe('the share of moves of a set', () => {
  it('is none for sets 1 and 2, 0.35 for sets 3 and 4, and 0.7 for sets 5 and 6', () => {
    expect(CUE_SETS.moveShares).toEqual([0, 0, 0.35, 0.35, 0.7, 0.7]);
    expect(ALL_SETS.map(cueSetMoveShare)).toEqual([0, 0, 0.35, 0.35, 0.7, 0.7]);
  });
});

describe('candidate seeds', () => {
  it('are a fixed list for each set, set 1 too, from DEFAULT_SEED + set × the spacing', () => {
    expect(candidateSeeds(3)).toHaveLength(CUE_SETS.candidates);
    expect(candidateSeeds(3)[0]).toBe(DEFAULT_SEED + 3 * CUE_SETS.candidateSpacing);
    expect(candidateSeeds(3)[CUE_SETS.candidates - 1]).toBe(DEFAULT_SEED + 3000 + CUE_SETS.candidates - 1);
    expect(candidateSeeds(1)[0]).toBe(DEFAULT_SEED + CUE_SETS.candidateSpacing);
  });

  it('differ between all sets', () => {
    const all = ALL_SETS.flatMap(candidateSeeds);
    expect(new Set(all).size).toBe(all.length);
  });

  it('of all sets together are the pool of the typical mix, so every set aims at one mix', () => {
    expect(poolSeeds()).toEqual(ALL_SETS.flatMap(candidateSeeds));
    expect(poolSeeds()).toHaveLength(6 * CUE_SETS.candidates);
  });
});

describe('the mix of a chart', () => {
  const mixed = (): ChartEntry[] => [...entries('slide', 22, 0), ...entries('double', 45, 22), ...entries('single', 33, 67)];

  it('is its shares of slides and of doubles, and its number of cues', () => {
    expect(chartMix(synthetic(60, 120), mixed(), 3)).toEqual({ slides: 0.22, doubles: 0.45, fastSlides: 0, offbeats: 0, cues: 100 });
  });

  it('has its share of fast slides and its off-beat taps per cue on a cue beat', () => {
    const chart = mixed();
    for (const fast of chart.slice(0, 5)) fast.cue.speed = 'fast';
    const offbeats = Array.from({ length: 20 }, (_, i) => entry('single', 100 + i, 'offbeat'));
    expect(chartMix(synthetic(60, 200), [...chart, ...offbeats], 4)).toEqual({
      slides: 0.22,
      doubles: 0.45,
      fastSlides: 0.05,
      offbeats: 0.2,
      cues: 120,
    });
  });

  it('counts only cues on cue beats in its shares: no off-beat taps and no taps for the other hand', () => {
    const extras = [entry('single', 100, 'offbeat'), entry('single', 101, 'companion')];
    expect(chartMix(synthetic(60, 120), [...mixed(), ...extras], 3)).toMatchObject({ slides: 0.22, doubles: 0.45, cues: 102 });
  });

  it('leaves the cues of a move out of its shares, and counts them in its number of cues', () => {
    const moveCues = entries('slide', 10, 100).map((slide): ChartEntry => ({ ...slide, role: 'move', move: { name: 'point', phrase: 6 } }));
    expect(chartMix(synthetic(60, 120), [...mixed(), ...moveCues], 3)).toMatchObject({ slides: 0.22, doubles: 0.45, cues: 110 });
  });

  it('counts only cues in busy music in its shares, where the rules allow slides and doubles', () => {
    const song = synthetic(60, 200);
    song.intensity = song.beats.map((_, beat) => (beat < 100 ? 0.8 : 0.2));
    const quiet = entries('single', 100, 100);
    expect(chartMix(song, [...mixed(), ...quiet], 3)).toMatchObject({ slides: 0.22, doubles: 0.45, cues: 200 });
  });

  it('counts the doubles of level 2 on bar starts only, where the rules allow them', () => {
    // 6 doubles on 20 bar starts, and 60 single taps between them. Bars have 4 beats.
    const barStarts = Array.from({ length: 20 }, (_, bar) => entry(bar < 6 ? 'double' : 'single', bar * 4));
    const between = Array.from({ length: 60 }, (_, i) => entry('single', Math.floor(i / 3) * 4 + 1 + (i % 3)));
    expect(chartMix(synthetic(60, 120), [...barStarts, ...between], 2)).toMatchObject({ slides: 0, doubles: 0.3 });
  });

  it('has no slides, doubles or off-beat taps at level 1', () => {
    const mix = playedMix(round(realSong(1), solo(1)), solo(1)[0], 123);
    expect(mix).toMatchObject({ slides: 0, doubles: 0, fastSlides: 0, offbeats: 0 });
    expect(mix.cues).toBeGreaterThan(30);
  });

  it('counts only the part of the song that the round plays', () => {
    const late = { ...synthetic(100, 600), shortStartSec: 300 };
    const whole = playedMix(round(late, solo(3), 'full'), solo(3)[0], 7);
    const part = playedMix(round(late, solo(3), 'short'), solo(3)[0], 7);
    expect(part.cues).toBeLessThan(whole.cues);
  });

  it('is as far from a target as its parts are, each by its weight', () => {
    const target = { slides: 0.22, doubles: 0.45, fastSlides: 0.06, offbeats: 0.3, cues: 100 };
    // 12 points of slides, 5 of doubles, 2 of fast slides, 4 of off-beat taps, and 10% more cues.
    const mix = { slides: 0.1, doubles: 0.4, fastSlides: 0.08, offbeats: 0.26, cues: 110 };
    const { weights } = CUE_SETS;
    const expected = 0.12 * weights.slides + 0.05 * weights.doubles + 0.02 * weights.fastSlides + 0.04 * weights.offbeats + 0.1 * weights.cues;
    expect(mixDistance(mix, target)).toBeCloseTo(expected, 10);
    expect(mixDistance(target, target)).toBe(0);
  });
});

describe('the typical mix', () => {
  it('is the median of each part', () => {
    const mixes = [
      { slides: 0.3, doubles: 0.2, fastSlides: 0.1, offbeats: 0.3, cues: 120 },
      { slides: 0.1, doubles: 0.5, fastSlides: 0.05, offbeats: 0.2, cues: 100 },
      { slides: 0.2, doubles: 0.4, fastSlides: 0, offbeats: 0.25, cues: 110 },
    ];
    expect(typicalMix(mixes)).toEqual({ slides: 0.2, doubles: 0.4, fastSlides: 0.05, offbeats: 0.25, cues: 110 });
  });

  it('comes from charts without moves: the rest of a chart is what makes it easy or hard', () => {
    const song = realSong(2);
    const charts = round(song, solo(4));
    const seed = candidateSeeds(5)[0];
    const options = { level: 4 as Level, shapes: false, seed, endSec: charts.endSec };
    const withoutMoves = entriesFrom(chartEntries(song, options), charts.startSec);
    expect(playedMix(charts, solo(4)[0], seed)).toEqual(chartMix(song, withoutMoves, 4));
    const withMoves = entriesFrom(chartEntries(song, { ...options, moves: cueSetMoveShare(5) }), charts.startSec);
    expect(withMoves.some((entry) => entry.role === 'move')).toBe(true);
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
    for (const [index] of SONGS.entries()) {
      const { slides, doubles } = songPool(index, 3).targets[0];
      expect(Math.abs(slides - LEVELS[3].slideChance) + Math.abs(doubles - LEVELS[3].doubleChance)).toBeLessThan(0.04);
    }
  });

  it('has fewer slides than the rules at level 4, where a slide never follows an off-beat tap', () => {
    for (const [index] of SONGS.entries()) {
      expect(songPool(index, 4).targets[0].slides).toBeLessThan(LEVELS[4].slideChance - 0.05);
    }
  });
});

describe('the seed of a set', () => {
  const song = realSong(2);

  it('is the candidate closest to the typical mix, the earlier one on a tie, for every set: set 1 too', () => {
    for (const level of [2, 3, 4] as Level[]) {
      const charts = round(song, solo(level));
      const pool = measurePool(charts);
      for (const set of ALL_SETS) {
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

  it('plays like the level usually does, on every song: close to the typical shares of slides and doubles', () => {
    // A seed of the pool is a median of 8 points from the typical mix at level 3, and 9 at
    // level 4. The chosen sets are at most 8 points off in each share today: set 5 of Hey-Ho,
    // Jonah at level 4. With 4 sets and a pool of 96 seeds, the most was 5.1 points.
    for (const [index] of SONGS.entries()) {
      for (const level of [3, 4] as Level[]) {
        const pool = songPool(index, level);
        const target = pool.targets[0];
        for (const set of ALL_SETS) {
          const mix = pool.mixes[0][pool.seeds.indexOf(closestCandidate(set, pool))];
          expect(Math.abs(mix.slides - target.slides)).toBeLessThan(0.09);
          expect(Math.abs(mix.doubles - target.doubles)).toBeLessThan(0.09);
        }
      }
    }
  });

  it('keeps the sets of a song close in fast slides, off-beat taps and number of cues', () => {
    // Chosen by slides and doubles alone, the sets of a song at level 4 were up to 9.5 points
    // apart in fast slides, 14.7 in off-beat taps and 13% in cues. With 4 sets: 6.6, 8.9 and
    // 6.3%. Today, with 6 sets: 6.6, 9.0 and 8.8%, the last at level 3 of Peace, Be Still.
    const spread = (values: number[]): number => Math.max(...values) - Math.min(...values);
    for (const [index] of SONGS.entries()) {
      for (const level of [3, 4] as Level[]) {
        const pool = songPool(index, level);
        const mixes = ALL_SETS.map((set) => pool.mixes[0][pool.seeds.indexOf(closestCandidate(set, pool))]);
        expect(spread(mixes.map((mix) => mix.fastSlides))).toBeLessThan(0.08);
        expect(spread(mixes.map((mix) => mix.offbeats))).toBeLessThan(0.11);
        expect(spread(mixes.map((mix) => mix.cues)) / pool.targets[0].cues).toBeLessThan(0.09);
      }
    }
  });
});
