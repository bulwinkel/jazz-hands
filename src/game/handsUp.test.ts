import { describe, expect, it } from 'vitest';
import type { TrackedHand, TrackingFrame } from '../tracking/types';
import { CALIBRATE_CELL, START_CELL, TIMING } from './config';
import { cellRect } from './geometry';
import { clearCalibrateHolds, clearHolds, stepCalibrateHolds, stepHandsUp, stepWaitingHolds } from './handsUp';
import type { HoldingPlayer } from './handsUp';
import { createPlayers } from './player';
import { parseSettings } from './settings';

function players(count: 1 | 2): HoldingPlayer[] {
  return createPlayers(parseSettings(null, `?players=${count}`).settings);
}

/** A hand in the middle of one of a player's cells. */
function handIn(player: HoldingPlayer, cell: number): TrackedHand {
  const rect = cellRect(player.grid, cell);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, size: 0.05, gesture: 'open', gestureScore: 1 };
}

/** A tracking frame at `timeMs`, with a hand in `cell` for each player in `raised`. */
function frame(
  timeMs: number,
  all: readonly HoldingPlayer[],
  raised: readonly HoldingPlayer[],
  cell: number = START_CELL,
): TrackingFrame {
  const hands = (index: number): TrackedHand[] =>
    raised.filter((p) => p.index === index).map((player) => handIn(player, cell));
  return { timeMs, inferenceMs: 0, players: [{ hands: hands(0) }, { hands: hands(all.length > 1 ? 1 : -1) }] };
}

describe('the Start cell and the Calibrate cell', () => {
  it('are the top-right cell and the top-left cell', () => {
    expect(START_CELL).toBe(2);
    expect(CALIBRATE_CELL).toBe(0);
  });
});

describe('the hold in the Start cell', () => {
  it('fills while a hand stays in the Start cell, and is done after the hold time', () => {
    const solo = players(1);
    expect(stepHandsUp(solo, frame(1000, solo, solo), undefined, 1)).toBe(false);
    expect(stepHandsUp(solo, frame(1500, solo, solo), frame(1000, solo, solo), 1)).toBe(false);
    expect(solo[0].hold).toBeCloseTo(0.5);
    expect(stepHandsUp(solo, frame(2000, solo, solo), frame(1500, solo, solo), 1)).toBe(true);
    expect(solo[0].hold).toBe(1);
  });

  it('starts again from nothing when the hand leaves the cell', () => {
    const solo = players(1);
    stepHandsUp(solo, frame(1000, solo, solo), undefined, 1);
    stepHandsUp(solo, frame(1500, solo, []), frame(1000, solo, solo), 1);
    expect(solo[0].hold).toBe(0);
    stepHandsUp(solo, frame(1600, solo, solo), frame(1500, solo, []), 1);
    expect(solo[0].holdStartMs).toBe(1600);
  });

  it('starts again when the tracking frames had a gap longer than a stale frame', () => {
    const solo = players(1);
    stepHandsUp(solo, frame(1000, solo, solo), undefined, 1);
    const late = 1000 + TIMING.staleFrameMs + 1;
    stepHandsUp(solo, frame(late, solo, solo), frame(1000, solo, solo), 1);
    expect(solo[0].holdStartMs).toBe(late);
    expect(solo[0].hold).toBe(0);
  });

  it('waits until every player holds', () => {
    const duo = players(2);
    const onlyLeft = [duo[0]];
    expect(stepHandsUp(duo, frame(1000, duo, onlyLeft), undefined, 0.2)).toBe(false);
    expect(stepHandsUp(duo, frame(1100, duo, onlyLeft), frame(1000, duo, onlyLeft), 0.2)).toBe(false);
    expect(stepHandsUp(duo, frame(1200, duo, onlyLeft), frame(1100, duo, onlyLeft), 0.2)).toBe(false);
    expect(duo[0].hold).toBe(1);
    expect(duo[1].hold).toBe(0);
    expect(stepHandsUp(duo, frame(1300, duo, duo), frame(1200, duo, onlyLeft), 0.2)).toBe(false);
    expect(stepHandsUp(duo, frame(1400, duo, duo), frame(1300, duo, duo), 0.2)).toBe(false);
    expect(stepHandsUp(duo, frame(1500, duo, duo), frame(1400, duo, duo), 0.2)).toBe(true);
  });

  it('does not count a hand in the Calibrate cell', () => {
    const solo = players(1);
    stepHandsUp(solo, frame(1000, solo, solo, CALIBRATE_CELL), undefined, 0.4);
    const done = stepHandsUp(solo, frame(1400, solo, solo, CALIBRATE_CELL), frame(1000, solo, solo, CALIBRATE_CELL), 0.4);
    expect(done).toBe(false);
    expect(solo[0].holdStartMs).toBeNull();
    expect(solo[0].hold).toBe(0);
  });

  it('forgets every hold when cleared', () => {
    const duo = players(2);
    stepHandsUp(duo, frame(1000, duo, duo), undefined, 1);
    stepHandsUp(duo, frame(1500, duo, duo), frame(1000, duo, duo), 1);
    clearHolds(duo);
    expect(duo.map((p) => [p.holdStartMs, p.hold])).toEqual([
      [null, 0],
      [null, 0],
    ]);
  });
});

describe('the hold in the Calibrate cell', () => {
  const HOLD_SEC = TIMING.calibrateHoldSec;

  it('fills while a hand stays in the Calibrate cell, and is complete after the hold time', () => {
    const solo = players(1);
    const at = (timeMs: number): TrackingFrame => frame(timeMs, solo, solo, CALIBRATE_CELL);
    const halfMs = HOLD_SEC * 500;
    expect(stepCalibrateHolds(solo, at(1000), undefined, HOLD_SEC)).toEqual([]);
    expect(stepCalibrateHolds(solo, at(1000 + halfMs), at(1000 + halfMs - 100), HOLD_SEC)).toEqual([]);
    expect(solo[0].calibrateHold).toBeCloseTo(0.5);
    const completed = stepCalibrateHolds(solo, at(1000 + 2 * halfMs), at(1000 + 2 * halfMs - 100), HOLD_SEC);
    expect(completed).toEqual([solo[0]]);
    expect(solo[0].calibrateHold).toBe(1);
  });

  it('does not count a hand in the Start cell', () => {
    const solo = players(1);
    stepCalibrateHolds(solo, frame(1000, solo, solo, START_CELL), undefined, 0.4);
    const completed = stepCalibrateHolds(solo, frame(1400, solo, solo, START_CELL), frame(1000, solo, solo), 0.4);
    expect(completed).toEqual([]);
    expect(solo[0].calibrateHoldStartMs).toBeNull();
    expect(solo[0].calibrateHold).toBe(0);
  });

  it('keeps apart from the Start hold: each fills only from its own cell', () => {
    const solo = players(1);
    stepHandsUp(solo, frame(1000, solo, solo, START_CELL), undefined, 1);
    stepCalibrateHolds(solo, frame(1000, solo, solo, START_CELL), undefined, HOLD_SEC);
    stepHandsUp(solo, frame(1500, solo, solo, CALIBRATE_CELL), frame(1000, solo, solo), 1);
    stepCalibrateHolds(solo, frame(1500, solo, solo, CALIBRATE_CELL), frame(1000, solo, solo), HOLD_SEC);
    // The hand moved from the Start cell to the Calibrate cell: the Start hold ended, and the
    // Calibrate hold began only now.
    expect(solo[0].hold).toBe(0);
    expect(solo[0].calibrateHoldStartMs).toBe(1500);
  });

  it('is complete only for the player who held', () => {
    const duo = players(2);
    const right = [duo[1]];
    stepCalibrateHolds(duo, frame(1000, duo, right, CALIBRATE_CELL), undefined, HOLD_SEC);
    const completed = stepCalibrateHolds(duo, frame(2500, duo, right, CALIBRATE_CELL), frame(2400, duo, right, CALIBRATE_CELL), HOLD_SEC);
    expect(completed.map((player) => player.index)).toEqual([1]);
    expect(duo[0].calibrateHold).toBe(0);
  });

  it('forgets every hold when cleared', () => {
    const duo = players(2);
    stepCalibrateHolds(duo, frame(1000, duo, duo, CALIBRATE_CELL), undefined, HOLD_SEC);
    stepCalibrateHolds(duo, frame(1500, duo, duo, CALIBRATE_CELL), frame(1000, duo, duo, CALIBRATE_CELL), HOLD_SEC);
    clearCalibrateHolds(duo);
    expect(duo.map((p) => [p.calibrateHoldStartMs, p.calibrateHold])).toEqual([
      [null, 0],
      [null, 0],
    ]);
  });
});

describe('two players who hold their Calibrate cells at nearly the same time', () => {
  const HOLD_SEC = 1;
  const at = (timeMs: number, all: HoldingPlayer[], raised: HoldingPlayer[]): TrackingFrame =>
    frame(timeMs, all, raised, CALIBRATE_CELL);

  /**
   * The left player holds from 1000 ms, the right player from 1200 ms, in frames 100 ms apart.
   * The left hold completes at 2000 ms.
   */
  function firstHoldCompletes(): HoldingPlayer[] {
    const duo = players(2);
    stepCalibrateHolds(duo, at(1000, duo, [duo[0]]), undefined, HOLD_SEC);
    stepCalibrateHolds(duo, at(1100, duo, [duo[0]]), at(1000, duo, [duo[0]]), HOLD_SEC);
    for (let timeMs = 1200; timeMs < 2000; timeMs += 100) {
      expect(stepCalibrateHolds(duo, at(timeMs, duo, duo), at(timeMs - 100, duo, duo), HOLD_SEC)).toEqual([]);
    }
    const completed = stepCalibrateHolds(duo, at(2000, duo, duo), at(1900, duo, duo), HOLD_SEC);
    expect(completed.map((player) => player.index)).toEqual([0]);
    expect(duo[1].calibrateHold).toBeCloseTo(0.8);
    return duo;
  }

  it('give the first hold that completes the calibration, and the other player calibrates after', () => {
    const duo = firstHoldCompletes();
    // The left player calibrates now. The right player's hold goes on and completes.
    const calibrating = [0 as const];
    expect(stepWaitingHolds(duo, calibrating, [], at(2100, duo, duo), at(2000, duo, duo), HOLD_SEC)).toEqual([]);
    const completed = stepWaitingHolds(duo, calibrating, [], at(2200, duo, duo), at(2100, duo, duo), HOLD_SEC);
    expect(completed.map((player) => player.index)).toEqual([1]);
  });

  it('never step the hold of the player who calibrates: circles through the cell do not count', () => {
    const duo = firstHoldCompletes();
    duo[0].calibrateHold = 0.5;
    const completed = stepWaitingHolds(duo, [0], [], at(2100, duo, duo), at(2000, duo, duo), HOLD_SEC);
    expect(completed.map((player) => player.index)).not.toContain(0);
    expect(duo[0].calibrateHold).toBe(0.5);
  });

  it('do not start a new hold during a calibration: the Calibrate cell is a choice of the ready screen', () => {
    const duo = firstHoldCompletes();
    // The right player's hand leaves the cell, and then comes back.
    stepWaitingHolds(duo, [0], [], at(2100, duo, [duo[0]]), at(2000, duo, duo), HOLD_SEC);
    expect(duo[1].calibrateHold).toBe(0);
    stepWaitingHolds(duo, [0], [], at(2200, duo, duo), at(2100, duo, [duo[0]]), HOLD_SEC);
    const completed = stepWaitingHolds(duo, [0], [], at(3300, duo, duo), at(3200, duo, duo), HOLD_SEC);
    expect(completed).toEqual([]);
    expect(duo[1].calibrateHoldStartMs).toBeNull();
  });

  it('do not step the hold of a player who waits already', () => {
    const duo = firstHoldCompletes();
    duo[1].calibrateHold = 1;
    const completed = stepWaitingHolds(duo, [0], [1], at(2100, duo, []), at(2000, duo, duo), HOLD_SEC);
    expect(completed).toEqual([]);
    expect(duo[1].calibrateHold).toBe(1);
  });
});
