import { describe, expect, it } from 'vitest';
import { seededRandom, slideTargets } from './chart';
import { CHART, MOVES } from './config';
import { synthetic } from './fixtures';
import {
  FORM_INTERVALS,
  MOVE_NAMES,
  moveForm,
  moveSteps,
  noMoves,
  phraseBeats,
  planPhrases,
  stepIntervals,
} from './moves';
import type { LayoutRolls, MoveForm, MoveStep } from './moves';

const FORMS: MoveForm[] = ['taps', 'shortTaps', 'slides'];
/** Rolls that reach every start and both directions of every move. */
const LAYOUTS: LayoutRolls[] = [0, 0.3, 0.6, 0.9].flatMap((origin) => [0, 0.9].map((direction) => ({ origin, direction })));
const cellsOf = (steps: MoveStep[]): number[][] => steps.map((step) => [...step]);
const intervalsOf = (steps: MoveStep[]): number => steps.reduce((sum, step) => sum + stepIntervals(step), 0);

describe('the point', () => {
  it('goes bottom-left to top-right and back, twice, then the same on the other diagonal', () => {
    const rolls = { origin: 0.2, direction: 0 };
    expect(cellsOf(moveSteps('point', 'taps', rolls))).toEqual([[6], [2], [6], [2], [8], [0], [8], [0]]);
    expect(cellsOf(moveSteps('point', 'shortTaps', rolls))).toEqual([[6], [2], [8], [0]]);
    expect(cellsOf(moveSteps('point', 'slides', rolls))).toEqual([
      [6, 2],
      [2, 6],
      [8, 0],
      [0, 8],
    ]);
  });

  it('starts on the other diagonal, bottom-right to top-left, for the other half of the rolls', () => {
    const rolls = { origin: 0.7, direction: 0 };
    expect(cellsOf(moveSteps('point', 'taps', rolls))).toEqual([[8], [0], [8], [0], [6], [2], [6], [2]]);
    expect(cellsOf(moveSteps('point', 'shortTaps', rolls))).toEqual([[8], [0], [6], [2]]);
    expect(cellsOf(moveSteps('point', 'slides', rolls))).toEqual([
      [8, 0],
      [0, 8],
      [6, 2],
      [2, 6],
    ]);
  });
});

describe('the circle', () => {
  it('touches every outer cell clockwise from a corner, or the corners alone', () => {
    const rolls = { origin: 0, direction: 0 };
    expect(cellsOf(moveSteps('circle', 'taps', rolls))).toEqual([[0], [1], [2], [5], [8], [7], [6], [3]]);
    expect(cellsOf(moveSteps('circle', 'shortTaps', rolls))).toEqual([[0], [2], [8], [6]]);
    expect(cellsOf(moveSteps('circle', 'slides', rolls))).toEqual([
      [0, 2],
      [2, 8],
      [8, 6],
      [6, 0],
    ]);
  });

  it('turns the other way from another corner', () => {
    const rolls = { origin: 0.5, direction: 0.9 };
    expect(cellsOf(moveSteps('circle', 'taps', rolls))).toEqual([[8], [5], [2], [1], [0], [3], [6], [7]]);
    expect(cellsOf(moveSteps('circle', 'shortTaps', rolls))).toEqual([[8], [2], [0], [6]]);
    expect(cellsOf(moveSteps('circle', 'slides', rolls))).toEqual([
      [8, 2],
      [2, 0],
      [0, 6],
      [6, 8],
    ]);
  });

  it('starts on each of the 4 corners', () => {
    const starts = LAYOUTS.map((rolls) => moveSteps('circle', 'taps', rolls)[0][0]);
    expect(new Set(starts)).toEqual(new Set([0, 2, 8, 6]));
  });
});

describe('every move', () => {
  it('takes 8 intervals as taps or as slides, and 4 as short taps, in every layout', () => {
    for (const name of MOVE_NAMES) {
      for (const rolls of LAYOUTS) {
        for (const form of FORMS) expect(intervalsOf(moveSteps(name, form, rolls))).toBe(FORM_INTERVALS[form]);
      }
    }
    expect(FORM_INTERVALS).toEqual({ taps: 8, shortTaps: 4, slides: 8 });
  });

  it('has taps of one cell in its taps forms, and slides that cross the grid legally in its slides form', () => {
    for (const name of MOVE_NAMES) {
      for (const rolls of LAYOUTS) {
        for (const step of [...moveSteps(name, 'taps', rolls), ...moveSteps(name, 'shortTaps', rolls)]) {
          expect(step).toHaveLength(1);
        }
        for (const [from, to] of moveSteps(name, 'slides', rolls)) expect(slideTargets(from)).toContain(to);
      }
    }
  });

  it('touches only outer cells, never the centre', () => {
    for (const name of MOVE_NAMES) {
      for (const rolls of LAYOUTS) {
        for (const form of FORMS) expect(moveSteps(name, form, rolls).flat()).not.toContain(4);
      }
    }
  });

  it('counts from 0', () => {
    expect(noMoves()).toEqual({ point: 0, circle: 0 });
  });
});

describe('the form of a move', () => {
  it('has 8 intervals where the phrase has room for 8, the short taps where it has room for 4, and none below', () => {
    expect(moveForm(16, false, 0.1)).toBe('taps');
    expect(moveForm(8, false, 0.1)).toBe('taps');
    expect(moveForm(7.5, true, 0.1)).toBe('shortTaps');
    expect(moveForm(4, true, 0.1)).toBe('shortTaps');
    expect(moveForm(3, true, 0.1)).toBeNull();
  });

  it('is slides at a level with slides when the form roll is under the slides share', () => {
    expect(moveForm(8, true, MOVES.slideFormShare - 0.01)).toBe('slides');
    expect(moveForm(16, true, MOVES.slideFormShare)).toBe('taps');
    expect(moveForm(16, false, 0)).toBe('taps');
  });
});

describe('the plan of the phrases', () => {
  const song = synthetic(100, 1800);
  const plan = (share: number, seed = 5, fromSec = -Infinity) => planPhrases(song, seededRandom(seed), { share, fromSec });

  it('has a phrase every 4 bars from the first bar start', () => {
    const late = { ...synthetic(100, 120), firstDownbeat: 3 };
    const plans = planPhrases(late, seededRandom(5), { share: 1, fromSec: 0 });
    expect(phraseBeats(late)).toBe(MOVES.phraseBars * 4);
    expect(plans.map((p) => p.firstBeat)).toEqual(plans.map((_, k) => 3 + 16 * k));
    expect(plans.every((p) => p.endBeat === p.firstBeat + 16)).toBe(true);
    expect(plans.at(-1)?.firstBeat).toBeLessThan(late.beats.length);
  });

  it('takes the same rolls for every phrase whatever the share, so a share changes which phrases hold a move and nothing else', () => {
    const rollsOf = (share: number) => plan(share).map(({ formRoll, layout }) => ({ formRoll, layout }));
    expect(rollsOf(0.35)).toEqual(rollsOf(0));
    expect(rollsOf(0.7)).toEqual(rollsOf(0));
    // A phrase that holds a move at a share holds the same move at a higher share, unless
    // the move before it changed.
    const low = plan(0.35);
    const high = plan(0.7);
    const kept = low.filter((p, k) => p.move && (k === 0 || low[k - 1].move === high[k - 1].move));
    expect(kept.length).toBeGreaterThan(20);
    for (const p of kept) expect(high[p.index].move).toBe(p.move);
  });

  it('holds a move in about the share of phrases', () => {
    for (const share of [0.35, 0.7]) {
      const plans = plan(share);
      expect(plans.filter((p) => p.move).length / plans.length).toBeCloseTo(share, 1);
    }
    expect(plan(0).some((p) => p.move)).toBe(false);
    expect(plan(1).every((p) => p.move)).toBe(true);
  });

  it('never gives a phrase the move of the phrase before it', () => {
    for (const share of [0.35, 0.7, 1]) {
      const plans = plan(share);
      plans.slice(1).forEach((p, k) => {
        if (p.move && plans[k].move) expect(p.move).not.toBe(plans[k].move);
      });
    }
  });

  it('uses every move', () => {
    expect(new Set(plan(0.7).map((p) => p.move))).toEqual(new Set([null, ...MOVE_NAMES]));
  });

  it('starts no move where the music is quiet on the first beat of the phrase', () => {
    const quiet = synthetic(100, 600);
    quiet.intensity = quiet.beats.map((_, beat) => (Math.floor(beat / 64) % 2 === 0 ? 0.8 : CHART.busyIntensity - 0.01));
    const plans = planPhrases(quiet, seededRandom(5), { share: 1, fromSec: -Infinity });
    for (const p of plans) expect(p.move !== null).toBe(quiet.intensity[p.firstBeat] >= CHART.busyIntensity);
  });

  it('starts no move before its start time, and keeps the moves after it', () => {
    const all = plan(0.7);
    const fromSec = 300;
    const late = plan(0.7, 5, fromSec);
    late.forEach((p, k) => expect(p.move).toBe(song.beats[p.firstBeat] >= fromSec ? all[k].move : null));
    expect(late.filter((p) => p.move).length).toBeGreaterThan(20);
  });
});
