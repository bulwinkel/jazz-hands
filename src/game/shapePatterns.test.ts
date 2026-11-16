import { describe, expect, it } from 'vitest';
import { seededRandom } from './chart';
import { CHART } from './config';
import { synthetic } from './fixtures';
import { leadInEndSec } from './manifest';
import {
  cuesPerStep,
  phraseIntensity,
  rollPattern,
  shapeAtStep,
  shapePattern,
  shufflePhrases,
  shuffleShape,
  shuffleThreshold,
} from './shapePatterns';
import type { PatternRolls, RoundSpan, Shuffle } from './shapePatterns';
import type { Manifest } from './types';

/** Rolls for a pattern: a pair when `kind` is below the pair share, else a triple. */
const rolls = (kind: number, first = 0, second = 0, third = 0): PatternRolls => ({ kind, first, second, third });

describe('a pattern of hand shapes', () => {
  it('is a pair below the pair share and a triple above it', () => {
    expect(shapePattern(rolls(CHART.patternPairShare - 0.01))).toHaveLength(2);
    expect(shapePattern(rolls(CHART.patternPairShare))).toHaveLength(3);
  });

  it('takes each shape from the shapes that are left, so no shape comes twice', () => {
    // The pool is fist, open, point, peace. Each roll of 0 takes the first shape left.
    expect(shapePattern(rolls(0.9, 0, 0, 0))).toEqual(['fist', 'open', 'point']);
    expect(shapePattern(rolls(0.9, 0.99, 0.99, 0.99))).toEqual(['peace', 'point', 'open']);
    expect(shapePattern(rolls(0, 0.3, 0.5))).toEqual(['open', 'point']);
  });

  it('is a pair about as often as the pair share says, and every shape can start it', () => {
    const random = seededRandom(5);
    const patterns = Array.from({ length: 4000 }, () => shapePattern(rollPattern(random)));
    const pairs = patterns.filter((pattern) => pattern.length === 2).length;
    expect(pairs / patterns.length).toBeCloseTo(CHART.patternPairShare, 1);
    expect(new Set(patterns.map((pattern) => pattern[0]))).toEqual(new Set(CHART.gesturePool));
    for (const pattern of patterns) expect(new Set(pattern).size).toBe(pattern.length);
  });

  it('repeats from its first shape after its last one', () => {
    const pair = ['fist', 'peace'] as const;
    const triple = ['open', 'point', 'fist'] as const;
    expect([0, 1, 2, 3].map((step) => shapeAtStep(pair, step))).toEqual(['fist', 'peace', 'fist', 'peace']);
    expect([0, 1, 2, 3, 4].map((step) => shapeAtStep(triple, step))).toEqual(['open', 'point', 'fist', 'open', 'point']);
  });

  it('takes four rolls whether it is a pair or a triple', () => {
    const random = seededRandom(9);
    rollPattern(random);
    const next = random();
    const again = seededRandom(9);
    for (let roll = 0; roll < 4; roll++) again();
    expect(again()).toBe(next);
  });
});

describe('the steps of a shuffle', () => {
  const pair: Shuffle = { pattern: ['fist', 'peace'], cuesPerStep: 1 };

  it('step at every cue when the cues are at least 0.7 s apart, else at every second cue', () => {
    expect(CHART.patternStepSec).toBe(0.7);
    expect(cuesPerStep(0.7)).toBe(1);
    expect(cuesPerStep(0.92)).toBe(1);
    expect(cuesPerStep(0.69)).toBe(2);
    expect(cuesPerStep(0.55)).toBe(2);
  });

  it('go through the pattern one cue at a time, or two', () => {
    const shapes = (shuffle: Shuffle): string[] => [0, 1, 2, 3, 4].map((cues) => shuffleShape(shuffle, cues));
    expect(shapes(pair)).toEqual(['fist', 'peace', 'fist', 'peace', 'fist']);
    expect(shapes({ ...pair, cuesPerStep: 2 })).toEqual(['fist', 'fist', 'peace', 'peace', 'fist']);
    expect(shapes({ pattern: ['open', 'point', 'fist'], cuesPerStep: 1 })).toEqual(['open', 'point', 'fist', 'open', 'point']);
  });

  it('give the second hand of a tap for two hands the next shape of the pattern', () => {
    expect(shuffleShape(pair, 0, 1)).toBe('peace');
    expect(shuffleShape(pair, 1, 1)).toBe('fist');
    expect(shuffleShape({ ...pair, cuesPerStep: 2 }, 1, 1)).toBe('peace');
  });
});

describe('shuffle phrases', () => {
  /**
   * A song at 120 BPM with one intensity for each phrase of 4 bars: 16 beats, 8 seconds. The
   * round's first cue comes at 4 s, inside the first phrase.
   */
  function song(phraseIntensities: number[]): Manifest {
    const manifest = synthetic(120, phraseIntensities.length * 8);
    manifest.intensity = manifest.beats.map((_, beat) => phraseIntensities[Math.floor(beat / 16)]);
    return manifest;
  }
  /** The whole song as one round. */
  const wholeRound = (manifest: Manifest): RoundSpan => ({ firstCueSec: leadInEndSec(manifest), endSec: manifest.durationSec });
  /** The phrases that are shuffles. */
  const shuffled = (manifest: Manifest, round = wholeRound(manifest)): number[] =>
    shufflePhrases(manifest, round).flatMap((isShuffle, phrase) => (isShuffle ? [phrase] : []));

  it('never come in the first two phrases of the round, and never two in a row', () => {
    const loud = song(Array(12).fill(1));
    expect(leadInEndSec(loud)).toBe(4);
    // The last phrase holds the bar with no cues at the end of the round, and no other.
    expect(shuffled(loud)).toEqual([2, 4, 6, 8, 10]);
  });

  it('come only in busy music, even at the end of the round', () => {
    const calm = song(Array(12).fill(CHART.busyIntensity - 0.01));
    expect(shuffled(calm)).toEqual([]);
    expect(shuffleThreshold(Infinity, wholeRound(calm))).toBeGreaterThanOrEqual(CHART.busyIntensity);
    // Calm and loud phrases in turn: only the loud ones can shuffle.
    const turns = song([1, 1, 0.3, 1, 0.3, 1, 0.3, 1, 0.3, 1, 0.3, 1]);
    expect(shuffled(turns)).toEqual([3, 5, 7, 9, 11]);
  });

  it('need the most intense music early in the round, and less later', () => {
    const steady = song(Array(12).fill(0.75));
    const round = wholeRound(steady);
    // The threshold falls from 0.98 to 0.5: it reaches 0.75 about halfway through the round.
    const first = shuffled(steady)[0];
    expect(steady.beats[first * 16]).toBeGreaterThan(round.firstCueSec + 0.4 * (round.endSec - round.firstCueSec));
    expect(shuffled(steady).length).toBeGreaterThan(1);
  });

  it('fall in a straight line from the round\'s first cue to its end', () => {
    const round: RoundSpan = { firstCueSec: 10, endSec: 110 };
    expect(shuffleThreshold(10, round)).toBeCloseTo(CHART.shuffleIntensityFrom);
    expect(shuffleThreshold(60, round)).toBeCloseTo((CHART.shuffleIntensityFrom + CHART.shuffleIntensityTo) / 2);
    expect(shuffleThreshold(110, round)).toBeCloseTo(CHART.shuffleIntensityTo);
    expect(shuffleThreshold(0, round)).toBeCloseTo(CHART.shuffleIntensityFrom);
    expect(shuffleThreshold(200, round)).toBeCloseTo(CHART.shuffleIntensityTo);
  });

  it('count the phrases of a round that starts inside the song from its own first cue', () => {
    const loud = song(Array(12).fill(1));
    // A Short round that starts at 36 s: its first cue comes at 40 s, in phrase 5. Phrases 5
    // and 6 are its first two phrases.
    const round: RoundSpan = { firstCueSec: 40, endSec: 96 };
    expect(shuffled(loud, round)).toEqual([7, 9, 11]);
  });

  it('take the mean intensity of the beats of a phrase', () => {
    const manifest = song([0.2, 1]);
    expect(phraseIntensity(manifest, 0, 16)).toBeCloseTo(0.2);
    expect(phraseIntensity(manifest, 8, 24)).toBeCloseTo(0.6);
  });
});
