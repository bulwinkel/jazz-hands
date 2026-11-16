import { describe, expect, it } from 'vitest';
import { seededRandom } from './chart';
import { CHART, MOVES } from './config';
import { synthetic } from './fixtures';
import { FORM_INTERVALS, MOVE_NAMES, moveForm, moveSteps, noMoves, phraseBeats, planPhrases } from './moves';
import type { LayoutRolls, MoveForm } from './moves';

const FORMS: MoveForm[] = ['taps', 'shortTaps'];
/** Rolls that reach every start and both directions of every move. */
const LAYOUTS: LayoutRolls[] = [0, 0.3, 0.6, 0.9].flatMap((origin) => [0, 0.9].map((direction) => ({ origin, direction })));

describe('the point', () => {
  it('goes bottom-left to top-right and back, twice, then the same on the other diagonal', () => {
    const rolls = { origin: 0.2, direction: 0 };
    expect(moveSteps('point', 'taps', rolls)).toEqual([6, 2, 6, 2, 8, 0, 8, 0]);
    expect(moveSteps('point', 'shortTaps', rolls)).toEqual([6, 2, 8, 0]);
  });

  it('starts on the other diagonal, bottom-right to top-left, for the other half of the rolls', () => {
    const rolls = { origin: 0.7, direction: 0 };
    expect(moveSteps('point', 'taps', rolls)).toEqual([8, 0, 8, 0, 6, 2, 6, 2]);
    expect(moveSteps('point', 'shortTaps', rolls)).toEqual([8, 0, 6, 2]);
  });
});

describe('the circle', () => {
  it('touches every outer cell clockwise from a corner, or the corners alone', () => {
    const rolls = { origin: 0, direction: 0 };
    expect(moveSteps('circle', 'taps', rolls)).toEqual([0, 1, 2, 5, 8, 7, 6, 3]);
    expect(moveSteps('circle', 'shortTaps', rolls)).toEqual([0, 2, 8, 6]);
  });

  it('turns the other way from another corner', () => {
    const rolls = { origin: 0.5, direction: 0.9 };
    expect(moveSteps('circle', 'taps', rolls)).toEqual([8, 5, 2, 1, 0, 3, 6, 7]);
    expect(moveSteps('circle', 'shortTaps', rolls)).toEqual([8, 2, 0, 6]);
  });

  it('starts on each of the 4 corners', () => {
    const starts = LAYOUTS.map((rolls) => moveSteps('circle', 'taps', rolls)[0]);
    expect(new Set(starts)).toEqual(new Set([0, 2, 8, 6]));
  });
});

describe('every move', () => {
  it('takes 8 intervals as taps and 4 as short taps, one tap for each interval, in every layout', () => {
    for (const name of MOVE_NAMES) {
      for (const rolls of LAYOUTS) {
        for (const form of FORMS) expect(moveSteps(name, form, rolls)).toHaveLength(FORM_INTERVALS[form]);
      }
    }
    expect(FORM_INTERVALS).toEqual({ taps: 8, shortTaps: 4 });
  });

  it('touches only outer cells, never the centre', () => {
    for (const name of MOVE_NAMES) {
      for (const rolls of LAYOUTS) {
        for (const form of FORMS) expect(moveSteps(name, form, rolls)).not.toContain(4);
      }
    }
  });

  it('counts from 0', () => {
    expect(noMoves()).toEqual({ point: 0, circle: 0 });
  });
});

describe('the form of a move', () => {
  it('is the taps where the phrase has room for 8 intervals, the short taps where it has room for 4, and none below', () => {
    expect(moveForm(16)).toBe('taps');
    expect(moveForm(8)).toBe('taps');
    expect(moveForm(7.5)).toBe('shortTaps');
    expect(moveForm(4)).toBe('shortTaps');
    expect(moveForm(3)).toBeNull();
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
    const rollsOf = (share: number) => plan(share).map(({ layout }) => layout);
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
