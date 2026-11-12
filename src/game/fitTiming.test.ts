import { describe, expect, it } from 'vitest';
import { TIMING } from './config';
import { fitMomentAt, planFit, REFIT_SETTLE_SEC } from './fitTiming';

describe('reach fit timing', () => {
  it('lets the players walk back first when the camera runs and no hand began the fit', () => {
    const plan = planFit('not-by-hand', true);
    expect(plan).toEqual({ walkSec: TIMING.walkBackSec, settleSec: 0, drawSec: TIMING.fitSec });
    expect(fitMomentAt(plan, 0)).toEqual({ stage: 'walk', secondsLeft: TIMING.walkBackSec, handsCount: false });
    expect(fitMomentAt(plan, TIMING.walkBackSec - 0.5)).toEqual({ stage: 'walk', secondsLeft: 1, handsCount: false });
  });

  it('counts hands from the start of the circles, and counts the circles down', () => {
    const plan = planFit('not-by-hand', true);
    const circlesStart = TIMING.walkBackSec;
    expect(fitMomentAt(plan, circlesStart)).toEqual({ stage: 'draw', secondsLeft: TIMING.fitSec, handsCount: true });
    expect(fitMomentAt(plan, circlesStart + TIMING.fitSec - 0.1).secondsLeft).toBe(1);
    expect(fitMomentAt(plan, circlesStart + TIMING.fitSec).stage).toBe('done');
  });

  it('skips the walk for players who chose Start by hand, and for the test inputs', () => {
    expect(planFit('start-by-hand', true).walkSec).toBe(0);
    expect(planFit('not-by-hand', false).walkSec).toBe(0);
    expect(fitMomentAt(planFit('start-by-hand', true), 0)).toEqual({
      stage: 'draw',
      secondsLeft: TIMING.fitSec,
      handsCount: true,
    });
  });

  it('ignores hands for a moment after a recalibration by hand, and adds that moment to the circles', () => {
    const plan = planFit('recalibrate-by-hand', true);
    expect(plan).toEqual({ walkSec: 0, settleSec: REFIT_SETTLE_SEC, drawSec: TIMING.fitSec });
    const fullSec = REFIT_SETTLE_SEC + TIMING.fitSec;
    // The number on screen covers the whole time left, the settle time with it.
    expect(fitMomentAt(plan, 0)).toEqual({ stage: 'draw', secondsLeft: fullSec, handsCount: false });
    expect(fitMomentAt(plan, REFIT_SETTLE_SEC - 0.01).handsCount).toBe(false);
    expect(fitMomentAt(plan, REFIT_SETTLE_SEC)).toEqual({ stage: 'draw', secondsLeft: TIMING.fitSec, handsCount: true });
    expect(fitMomentAt(plan, fullSec - 0.1).secondsLeft).toBe(1);
    expect(fitMomentAt(plan, fullSec).stage).toBe('done');
  });
});
