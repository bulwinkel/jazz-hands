import { TIMING } from './config';

/**
 * The timing of the reach fit. The players may first walk from the laptop to their spots.
 * Then they draw circles with both arms, and the game grows each grid around their hands.
 */


export interface FitPlan {
  /** Time to walk from the laptop to the spot. The screen counts it down. */
  walkSec: number;
  /** Time at the start of the circles when hands do not count yet. */
  settleSec: number;
  /** Time to draw circles while hands count. */
  drawSec: number;
}

/** Where the fit is at one moment. */
export interface FitMoment {
  stage: 'walk' | 'draw' | 'done';
  /** The number on screen: the whole seconds left of this stage, rounded up. */
  secondsLeft: number;
  /** True once hand positions count toward the grids. */
  handsCount: boolean;
}

/**
 * `byHand` says that a pointing hand began the fit, with Start or Recalibrate. `usesCamera` is
 * false for the test inputs: they need no walk.
 */
export function planFit(byHand: boolean, usesCamera: boolean): FitPlan {
  return {
    // Players who chose by hand stand at their spots already.
    walkSec: usesCamera && !byHand ? TIMING.walkBackSec : 0,
    // The fist that chose Start or Recalibrate is still near the button.
    settleSec: byHand ? TIMING.handSettleSec : 0,
    drawSec: TIMING.fitSec,
  };
}

/**
 * The fit at `elapsedSec` after it began. The settle time belongs to the circles on screen: the
 * players start them at once, and the number counts down the settle time and the circles both.
 */
export function fitMomentAt(plan: FitPlan, elapsedSec: number): FitMoment {
  const handsCount = elapsedSec >= plan.walkSec + plan.settleSec;
  if (elapsedSec < plan.walkSec) {
    return { stage: 'walk', secondsLeft: Math.ceil(plan.walkSec - elapsedSec), handsCount };
  }
  const drawLeftSec = plan.walkSec + plan.settleSec + plan.drawSec - elapsedSec;
  if (drawLeftSec <= 0) return { stage: 'done', secondsLeft: 0, handsCount };
  return { stage: 'draw', secondsLeft: Math.ceil(drawLeftSec), handsCount };
}
