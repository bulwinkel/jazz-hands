/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chartEntries, entriesFrom } from './chart';
import type { ChartEntry, CueRole } from './chart';
import { CHART, CUE_SETS, DEFAULT_SEED, LEVELS, SONGS } from './config';
import {
  candidateSeeds,
  chartMix,
  closestCandidate,
  CUE_SET_COUNT,
  cueSetMoveShare,
  cueSetSeed,
  CueSetPicker,
  isCueSet,
  isCueSetChoice,
  measurePool,
  mixDistance,
  nextCueSetChoice,
  pickCueSet,
  playedChart,
  playedMix,
  poolDistance,
  poolSeeds,
  typicalMix,
} from './cueSet';
import type { ChartFor, CueSetChoice, PoolMeasure, RoundCharts } from './cueSet';
import { synthetic } from './fixtures';
import { playEndSec, playStartSec, validateManifest } from './manifest';
import type { Cue, Level, Manifest, SlideStep, SongLength } from './types';

const ALL_SETS = [1, 2, 3, 4, 5, 6];

function realSong(index: number): Manifest {
  return validateManifest(JSON.parse(readFileSync(`public${SONGS[index].manifest}`, 'utf8')));
}

function round(manifest: Manifest, players: ChartFor[], length: SongLength = 'short'): RoundCharts {
  return { manifest, players, startSec: playStartSec(manifest, length), endSec: playEndSec(manifest, length) };
}

const solo = (level: Level): ChartFor[] => [{ level, shapes: false }];

/** A cue on beat `beatIndex` of a test song with one beat a second. */
function entry(kind: 'single' | 'double', beatIndex: number, role: CueRole = 'beat'): ChartEntry {
  const cells = kind === 'double' ? [0, 2] : [1];
  const cue: Cue = { timeSec: beatIndex, beatIndex, cells };
  return { cue, role };
}

const SLIDE_STEPS: SlideStep[] = [1, 2, 3];

/**
 * A slide along the top row from beat `first`, one cell a beat, as the chart makes it: a roll
 * of its first beat chose its first cell, and the slide chose the other two.
 */
function slide(first: number): ChartEntry[] {
  return SLIDE_STEPS.map((slideStep, k) => {
    const beatIndex = first + k;
    const cue: Cue = { timeSec: beatIndex, beatIndex, cells: [k], slideStep };
    return { cue, role: k === 0 ? 'beat' : 'slide' };
  });
}

/** `count` cue-beat entries of one kind, from beat `first` on. */
const entries = (kind: 'single' | 'double', count: number, first: number): ChartEntry[] =>
  Array.from({ length: count }, (_, i) => entry(kind, first + i));

/** `count` slides in a row, from beat `first` on. Each takes three beats. */
const slides = (count: number, first: number): ChartEntry[] =>
  Array.from({ length: count }, (_, i) => slide(first + 3 * i)).flat();

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
});

describe('the set switch', () => {
  it("holds a set or 'random', and nothing else", () => {
    expect(['random', 1, 6].map(isCueSetChoice)).toEqual([true, true, true]);
    expect(['Random', 'random ', 0, 7, 2.5, '2', null].map(isCueSetChoice)).toEqual(Array(7).fill(false));
  });

  it('steps from random through every set in turn, then back to random', () => {
    const order: CueSetChoice[] = ['random'];
    while (order.length < 8) {
      order.push(nextCueSetChoice(order[order.length - 1]));
    }
    expect(order).toEqual(['random', 1, 2, 3, 4, 5, 6, 'random']);
  });
});

describe('picking a set at random', () => {
  /** The sets that rolls spread evenly over 0 to 1 give. */
  const pickedSets = (count: number, avoid: number | null): number[] => {
    const rolls = Array.from({ length: 100 }, (_, i) => i / 100);
    return rolls.map((roll) => pickCueSet(count, avoid, roll));
  };
  /** How often each set comes. */
  const countEach = (sets: number[]): Map<number, number> => {
    const counts = new Map<number, number>();
    for (const set of sets) {
      counts.set(set, (counts.get(set) ?? 0) + 1);
    }
    return counts;
  };

  it('gives every set, each as often, when there is none to avoid', () => {
    const counts = countEach(pickedSets(6, null));
    expect([...counts.keys()].sort((a, b) => a - b)).toEqual(ALL_SETS);
    expect(Math.max(...counts.values()) - Math.min(...counts.values())).toBeLessThanOrEqual(1);
  });

  it('never gives the set to avoid, and every other set as often', () => {
    for (const avoid of ALL_SETS) {
      const counts = countEach(pickedSets(6, avoid));
      expect([...counts.keys()].sort((a, b) => a - b)).toEqual(ALL_SETS.filter((set) => set !== avoid));
      expect(Math.max(...counts.values()) - Math.min(...counts.values())).toBeLessThanOrEqual(1);
    }
  });

  it('gives the lowest set for a roll of 0 and the highest left for a roll of 1', () => {
    expect(pickCueSet(6, null, 0)).toBe(1);
    expect(pickCueSet(6, null, 1)).toBe(6);
    expect(pickCueSet(6, 1, 0)).toBe(2);
    expect(pickCueSet(6, 6, 1)).toBe(5);
  });

  it('gives the only set of a count of 1, even when it is the set to avoid', () => {
    expect(pickCueSet(1, null, 0.5)).toBe(1);
    expect(pickCueSet(1, 1, 0.5)).toBe(1);
  });
});

describe('the set of a round', () => {
  /** A random source that gives these rolls in turn. */
  const rolls = (...values: number[]) => () => values.shift() ?? 0;

  it("plays the set of the switch, and remembers it as the song's last set", () => {
    const picker = new CueSetPicker(rolls(0));
    expect(picker.setForRound('song-a', 3)).toBe(3);
    // A roll of 0 gives the lowest set that is not set 3.
    expect(picker.setForRound('song-a', 'random')).toBe(1);
  });

  it('never picks the last set of the same song, so two rounds in a row differ', () => {
    const picker = new CueSetPicker(rolls(0, 0, 0, 0.99, 0.99));
    const sets = Array.from({ length: 5 }, () => picker.setForRound('song-a', 'random'));
    expect(sets).toEqual([1, 2, 1, 6, 5]);
  });

  it('keeps the last set of each song apart', () => {
    const picker = new CueSetPicker(rolls(0, 0, 0));
    expect(picker.setForRound('song-a', 'random')).toBe(1);
    expect(picker.setForRound('song-b', 'random')).toBe(1);
    expect(picker.setForRound('song-a', 'random')).toBe(2);
  });

  it('takes its rolls from Math.random unless a test gives its own', () => {
    const picker = new CueSetPicker();
    const sets = Array.from({ length: 50 }, () => picker.setForRound('song-a', 'random'));
    expect(sets.every(isCueSet)).toBe(true);
    const repeats = sets.filter((set, i) => i > 0 && set === sets[i - 1]);
    expect(repeats).toEqual([]);
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
  /** 22 slides, 45 doubles and 33 single taps: 100 cues that a roll chose, and 144 cues in all. */
  const mixed = (): ChartEntry[] => [...slides(22, 0), ...entries('double', 45, 66), ...entries('single', 33, 111)];
  const song = synthetic(60, 200);

  it('is its shares of slides and of doubles, and its number of cues', () => {
    expect(chartMix(song, mixed(), 3)).toEqual({ slides: 0.22, doubles: 0.45, offbeats: 0, cues: 144 });
  });

  it('counts a slide once in its shares, by its first cell, and all three cells in its number of cues', () => {
    expect(chartMix(song, slides(10, 0), 3)).toEqual({ slides: 1, doubles: 0, offbeats: 0, cues: 30 });
    const half = [...slides(10, 0), ...entries('single', 10, 30)];
    expect(chartMix(song, half, 3)).toEqual({ slides: 0.5, doubles: 0, offbeats: 0, cues: 40 });
  });

  it('has its off-beat taps per cue on a cue beat', () => {
    const offbeats = Array.from({ length: 20 }, (_, i) => entry('single', 150 + i, 'offbeat'));
    expect(chartMix(song, [...mixed(), ...offbeats], 4)).toEqual({ slides: 0.22, doubles: 0.45, offbeats: 0.2, cues: 164 });
  });

  it('counts only cues on cue beats in its shares: no off-beat taps', () => {
    const extras = [entry('single', 150, 'offbeat'), entry('single', 151, 'offbeat')];
    expect(chartMix(song, [...mixed(), ...extras], 3)).toMatchObject({ slides: 0.22, doubles: 0.45, cues: 146 });
  });

  it('leaves the cues of a move out of its shares, and counts them in its number of cues', () => {
    const moveCues = entries('single', 10, 150).map((tap): ChartEntry => ({ ...tap, role: 'move', move: { name: 'point', phrase: 6 } }));
    expect(chartMix(song, [...mixed(), ...moveCues], 3)).toMatchObject({ slides: 0.22, doubles: 0.45, cues: 154 });
  });

  it('counts only cues in busy music in its shares, where the rules allow slides and doubles', () => {
    const changing = synthetic(60, 300);
    changing.intensity = changing.beats.map((_, beat) => (beat < 150 ? 0.8 : 0.2));
    const quiet = [...entries('single', 50, 150), ...slides(10, 200)];
    expect(chartMix(changing, [...mixed(), ...quiet], 3)).toMatchObject({ slides: 0.22, doubles: 0.45, cues: 224 });
  });

  it('counts the doubles of level 2 on bar starts only, where the rules allow them', () => {
    // 6 doubles on 20 bar starts, and 60 single taps between them. Bars have 4 beats.
    const barStarts = Array.from({ length: 20 }, (_, bar) => entry(bar < 6 ? 'double' : 'single', bar * 4));
    const between = Array.from({ length: 60 }, (_, i) => entry('single', Math.floor(i / 3) * 4 + 1 + (i % 3)));
    expect(chartMix(synthetic(60, 120), [...barStarts, ...between], 2)).toMatchObject({ slides: 0, doubles: 0.3 });
  });

  it('has no slides, doubles or off-beat taps at level 1', () => {
    const mix = playedMix(round(realSong(1), solo(1)), solo(1)[0], 123);
    expect(mix).toMatchObject({ slides: 0, doubles: 0, offbeats: 0 });
    expect(mix.cues).toBeGreaterThan(30);
  });

  it('counts only the part of the song that the round plays', () => {
    const late = { ...synthetic(100, 600), shortStartSec: 300 };
    const whole = playedMix(round(late, solo(3), 'full'), solo(3)[0], 7);
    const part = playedMix(round(late, solo(3), 'short'), solo(3)[0], 7);
    expect(part.cues).toBeLessThan(whole.cues);
  });

  it('is as far from a target as its parts are, each by its weight', () => {
    const target = { slides: 0.22, doubles: 0.45, offbeats: 0.3, cues: 100 };
    // 12 points of slides, 5 of doubles, 4 of off-beat taps, and 10% more cues.
    const mix = { slides: 0.1, doubles: 0.4, offbeats: 0.26, cues: 110 };
    const { weights } = CUE_SETS;
    const expected = 0.12 * weights.slides + 0.05 * weights.doubles + 0.04 * weights.offbeats + 0.1 * weights.cues;
    expect(mixDistance(mix, target)).toBeCloseTo(expected, 10);
    expect(mixDistance(target, target)).toBe(0);
  });
});

describe('the chart that the choice of a set measures', () => {
  it('is the chart that the round plays, with the shuffle phrases of a round that starts inside the song', () => {
    // Todo Bueno, From the Garden to the Cross and Return to the Lord start their Short round late.
    for (const index of [1, 2, 5]) {
      const song = realSong(index);
      const short = round(song, [{ level: 5, shapes: true }]);
      expect(short.startSec).toBeGreaterThan(60);
      const options = { level: 5 as Level, shapes: true, seed: DEFAULT_SEED, endSec: short.endSec };
      const roundChart = chartEntries(song, { ...options, roundFromSec: short.startSec + CHART.leadSec });
      const played = playedChart(short, short.players[0], DEFAULT_SEED);
      expect(played).toEqual(entriesFrom(roundChart, short.startSec));
      expect(played.some((entry) => entry.cue.shuffle)).toBe(true);
    }
  });
});

describe('the typical mix', () => {
  it('is the median of each part', () => {
    const mixes = [
      { slides: 0.3, doubles: 0.2, offbeats: 0.3, cues: 120 },
      { slides: 0.1, doubles: 0.5, offbeats: 0.2, cues: 100 },
      { slides: 0.2, doubles: 0.4, offbeats: 0.25, cues: 110 },
    ];
    expect(typicalMix(mixes)).toEqual({ slides: 0.2, doubles: 0.4, offbeats: 0.25, cues: 110 });
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

  it('is close to the rules at level 3, a little under them in slides', () => {
    // A slide needs three cue beats in a row, and none starts in the centre cell. Today the
    // typical share of slides is 0.84 to 0.94 of the chance, and the doubles are at most 1 point off.
    for (const [index] of SONGS.entries()) {
      const { slides, doubles } = songPool(index, 3).targets[0];
      expect(slides / LEVELS[3].slideChance).toBeGreaterThan(0.8);
      expect(slides).toBeLessThanOrEqual(LEVELS[3].slideChance);
      expect(Math.abs(doubles - LEVELS[3].doubleChance)).toBeLessThan(0.02);
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
    // A seed of the pool is a median of 8 points from the typical mix at level 3, and 14 at
    // level 4. The chosen sets are at most 5.3 points off in each share today: the doubles of
    // set 4 of Blessed on the Hillside at level 4.
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

  it('keeps the sets of a song close in off-beat taps and number of cues', () => {
    // Chosen by slides and doubles alone, the sets of a song at level 4 were once up to 14.7
    // points apart in off-beat taps and 13% in cues. Today: 8.7 points, at level 4 of All Eyes
    // on Us, and 5.2%, at level 4 of Build Your House Upon the Rock.
    const spread = (values: number[]): number => Math.max(...values) - Math.min(...values);
    for (const [index] of SONGS.entries()) {
      for (const level of [3, 4] as Level[]) {
        const pool = songPool(index, level);
        const mixes = ALL_SETS.map((set) => pool.mixes[0][pool.seeds.indexOf(closestCandidate(set, pool))]);
        expect(spread(mixes.map((mix) => mix.offbeats))).toBeLessThan(0.1);
        expect(spread(mixes.map((mix) => mix.cues)) / pool.targets[0].cues).toBeLessThan(0.07);
      }
    }
  });
});
