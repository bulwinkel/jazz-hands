/**
 * Hand shapes that mix. A pattern is a short row of different shapes that repeats: a pair
 * (A B A B …) or a triple (A B C A B C …). A pattern reads as one idea to follow, where shapes
 * by chance would read as noise.
 *
 * At level 4 with the hand shapes switch on, a tap for two hands takes the first two shapes of
 * a pattern, and a slide steps through a pattern over its three cells. chart.ts chooses where.
 *
 * At level 5 every cue asks for a shape. Most phrases are steady: one shape lasts a few seconds
 * (see `phraseShapes` in chart.ts). A shuffle phrase changes the shape from cue to cue instead,
 * by a pattern. Which phrases are shuffles comes from the music, not from the seed: every cue
 * set and every seed of a song has the same shuffle phrases, so the sets of one song stay
 * equally hard. The seed chooses only the pattern of each shuffle.
 */
import type { GestureName } from '../tracking/types';
import { CHART } from './config';
import { tailStartSec } from './manifest';
import { phraseBeats } from './moves';
import { clamp01 } from './numbers';
import type { Manifest } from './types';

const EPSILON = 1e-8;

/** The rolls that choose a pattern, each from 0 to 1. */
export interface PatternRolls {
  /** A pair or a triple. */
  kind: number;
  /** The shapes of the pattern, in order. A pair uses the first two only. */
  first: number;
  second: number;
  third: number;
}

/**
 * Takes the rolls of one pattern in a fixed order. Every pattern takes all four rolls, used or
 * not, so one pattern's choice never shifts the next one's.
 */
export function rollPattern(random: () => number): PatternRolls {
  return { kind: random(), first: random(), second: random(), third: random() };
}

/**
 * The pattern that the rolls choose: a pair with the chance `CHART.patternPairShare`, else a
 * triple. Its shapes all differ, so every step of the pattern changes the shape.
 */
export function shapePattern(rolls: PatternRolls): GestureName[] {
  const length = rolls.kind < CHART.patternPairShare ? 2 : 3;
  const shapeRolls = [rolls.first, rolls.second, rolls.third].slice(0, length);
  const left: GestureName[] = [...CHART.gesturePool];
  const pattern: GestureName[] = [];
  for (const roll of shapeRolls) {
    const index = Math.floor(roll * left.length);
    pattern.push(left[index]);
    left.splice(index, 1);
  }
  return pattern;
}

/** The shape of the pattern at a step, counted from 0. After its last shape the pattern starts again. */
export function shapeAtStep(pattern: readonly GestureName[], step: number): GestureName {
  return pattern[step % pattern.length];
}

/** A shuffle phrase: the pattern that its cues step through, and how many cues each step lasts. */
export interface Shuffle {
  pattern: GestureName[];
  /** 1: the shape changes at every cue. 2: it changes at every second cue. See `cuesPerStep`. */
  cuesPerStep: number;
}

/**
 * How many cues each step of a pattern lasts. A hand needs time to change shape: in kb's run
 * reports, the first cue after a change of shape was Perfect less often when it came under
 * `CHART.patternStepSec` after the cue before it. So where two cue beats of a phrase come closer
 * than that, each shape lasts two cues. `shortestGapSec` is the shortest time between two cue
 * beats of the phrase that follow each other.
 */
export function cuesPerStep(shortestGapSec: number): number {
  return shortestGapSec >= CHART.patternStepSec - EPSILON ? 1 : 2;
}

/**
 * The shuffle of every phrase of the song, by its index: null for a steady phrase. The music
 * and the round choose the shuffle phrases (see `shufflePhrases`), the seed only their patterns.
 * Every phrase takes the rolls of a pattern, used or not: one phrase's pattern never shifts
 * another's, so a phrase that shuffles in two rounds has the same pattern in both.
 * `shortestGapSec` gives the shortest time between two cue beats that follow each other, from
 * a phrase's first beat up to its end beat.
 */
export function planShuffles(
  manifest: Manifest,
  round: RoundSpan,
  random: () => number,
  shortestGapSec: (firstBeat: number, endBeat: number) => number,
): (Shuffle | null)[] {
  const beatsPerPhrase = phraseBeats(manifest);
  return shufflePhrases(manifest, round).map((isShuffle, phrase) => {
    const pattern = shapePattern(rollPattern(random));
    if (!isShuffle) return null;
    const firstBeat = manifest.firstDownbeat + phrase * beatsPerPhrase;
    const endBeat = Math.min(firstBeat + beatsPerPhrase, manifest.beats.length);
    return { pattern, cuesPerStep: cuesPerStep(shortestGapSec(firstBeat, endBeat)) };
  });
}

/**
 * The shape for a cue of a shuffle phrase, after `cuesBefore` cues of the phrase on cue beats.
 * `ahead` is 1 for the second cell of a tap for two hands: it takes the next shape of the
 * pattern, so the two hands make two different shapes.
 */
export function shuffleShape(shuffle: Shuffle, cuesBefore: number, ahead = 0): GestureName {
  const step = Math.floor(cuesBefore / shuffle.cuesPerStep) + ahead;
  return shapeAtStep(shuffle.pattern, step);
}

/** The part of the song in which a round can have cues. */
export interface RoundSpan {
  /** The earliest time of the round's first cue, in song seconds. */
  firstCueSec: number;
  /** Where play ends, in song seconds. */
  endSec: number;
}

/**
 * For every phrase of the song, from the first bar start: true when it is a shuffle phrase.
 * The phrases are those of `planPhrases` in moves.ts. Only the music and the round decide:
 *
 * - Only a phrase in busy music can be one: the mean intensity of its beats must reach
 *   `CHART.busyIntensity` and the threshold of `shuffleThreshold`.
 * - The threshold falls through the round, so early only the most intense phrases shuffle and
 *   late any busy phrase can.
 * - The round opens steady: players first find the beat. Its first
 *   `CHART.steadyOpeningPhrases` whole phrases never shuffle, and no phrase that starts less
 *   than `CHART.firstShuffleAfterSec` after the round's first cue. A part of a phrase before
 *   the round's first cue does not count as one of its whole phrases.
 * - After a shuffle phrase, at least `CHART.steadyPhrasesAfterShuffle` steady phrases follow:
 *   a rest between two shuffles.
 */
export function shufflePhrases(manifest: Manifest, round: RoundSpan): boolean[] {
  const beatsPerPhrase = phraseBeats(manifest);
  const cueEndSec = tailStartSec(manifest, round.endSec);
  const shuffles: boolean[] = [];
  let wholePhrases = 0;
  let steadySinceShuffle = Infinity;

  for (let firstBeat = manifest.firstDownbeat; firstBeat < manifest.beats.length; firstBeat += beatsPerPhrase) {
    const endBeat = Math.min(firstBeat + beatsPerPhrase, manifest.beats.length);
    const firstSec = manifest.beats[firstBeat];
    const lastSec = manifest.beats[endBeat - 1];
    // A whole phrase lies between the round's first cue and its last bar, which has no cues.
    const whole = firstSec >= round.firstCueSec - EPSILON && lastSec < cueEndSec;
    const opening = inOpening(wholePhrases, firstSec, round);
    const rested = steadySinceShuffle >= CHART.steadyPhrasesAfterShuffle;
    const threshold = shuffleThreshold(firstSec, round);
    const intense = phraseIntensity(manifest, firstBeat, endBeat) >= threshold - EPSILON;
    const inRound = firstSec < cueEndSec;
    const isShuffle = inRound && !opening && rested && intense;
    if (whole) wholePhrases++;
    shuffles.push(isShuffle);
    steadySinceShuffle = isShuffle ? 0 : steadySinceShuffle + 1;
  }
  return shuffles;
}

/**
 * True for a phrase in the steady opening of the round: one of its first whole phrases, or a
 * phrase that starts too soon after the round's first cue. `wholeBefore` is the count of whole
 * phrases of the round before this one.
 */
function inOpening(wholeBefore: number, firstSec: number, round: RoundSpan): boolean {
  if (wholeBefore < CHART.steadyOpeningPhrases) return true;
  return firstSec < round.firstCueSec + CHART.firstShuffleAfterSec - EPSILON;
}

/** The mean intensity of the beats from `firstBeat` up to `endBeat`. */
export function phraseIntensity(manifest: Manifest, firstBeat: number, endBeat: number): number {
  let sum = 0;
  for (let beat = firstBeat; beat < endBeat; beat++) {
    sum += manifest.intensity[beat];
  }
  return sum / (endBeat - firstBeat);
}

/**
 * The mean intensity that a phrase starting at `timeSec` needs to be a shuffle phrase. It falls
 * in a straight line from `CHART.shuffleIntensityFrom` at the round's first cue to
 * `CHART.shuffleIntensityTo` at its end, and never below busy music.
 */
export function shuffleThreshold(timeSec: number, round: RoundSpan): number {
  const progress = clamp01((timeSec - round.firstCueSec) / (round.endSec - round.firstCueSec));
  const { shuffleIntensityFrom: from, shuffleIntensityTo: to } = CHART;
  return Math.max(CHART.busyIntensity, from + (to - from) * progress);
}
