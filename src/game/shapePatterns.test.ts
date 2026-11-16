import { describe, expect, it } from 'vitest';
import { seededRandom } from './chart';
import { CHART } from './config';
import { rollPattern, shapeAtStep, shapePattern } from './shapePatterns';
import type { PatternRolls } from './shapePatterns';

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
