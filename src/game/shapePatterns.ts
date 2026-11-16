/**
 * Hand shapes that mix. A pattern is a short row of different shapes that repeats: a pair
 * (A B A B …) or a triple (A B C A B C …). A pattern reads as one idea to follow, where shapes
 * by chance would read as noise.
 *
 * At level 4 with the hand shapes switch on, a tap for two hands takes the first two shapes of
 * a pattern, and a slide steps through a pattern over its three cells. chart.ts chooses where.
 */
import type { GestureName } from '../tracking/types';
import { CHART } from './config';

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
