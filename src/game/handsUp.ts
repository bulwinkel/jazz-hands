import type { TrackingFrame } from '../tracking/types';
import { CALIBRATE_CELL, START_CELL, TIMING } from './config';
import { cellRect, insideCell } from './geometry';
import type { PlayerRun } from './player';
import type { PlayerIndex } from './types';

/** What the holds read and change of a player. */
export type HoldingPlayer = Pick<
  PlayerRun,
  'index' | 'grid' | 'holdStartMs' | 'hold' | 'calibrateHoldStartMs' | 'calibrateHold'
>;

/** A hold of a hand in one cell. */
interface Hold {
  /** When the hold began, in tracking-frame time. Null while no hand holds the cell. */
  startMs: number | null;
  /** How far the hold has come, 0..1. */
  progress: number;
}

/**
 * One tracking frame of a hold. A hold begins when a hand comes into the cell, and goes on
 * while a hand stays there. A hand that leaves ends it. A stalled frame starts it again.
 */
function stepHold(startMs: number | null, inCell: boolean, stalled: boolean, timeMs: number, holdSec: number): Hold {
  let start = inCell && !stalled ? startMs : null;
  if (inCell && start === null) start = timeMs;
  const progress = start === null ? 0 : Math.min(1, (timeMs - start) / (holdSec * 1000));
  return { startMs: start, progress };
}

/** True when one of the player's hands is in the cell. */
function handInCell(player: HoldingPlayer, frame: TrackingFrame, cell: number): boolean {
  const target = cellRect(player.grid, cell);
  return frame.players[player.index].hands.some((hand) => insideCell(hand, target));
}

/** True when the gap between `previous` and `frame` is longer than a stale frame. Such a gap breaks every hold. */
function isStalled(frame: TrackingFrame, previous: TrackingFrame | undefined): boolean {
  return previous !== undefined && frame.timeMs - previous.timeMs > TIMING.staleFrameMs;
}

/**
 * Ready screen and results: each player holds a hand in their Start cell, without a break, for
 * `holdSec`. Updates every player's Start hold from one tracking frame, and returns true when
 * every player holds. A hand in the Calibrate cell does not count here.
 */
export function stepHandsUp(
  players: readonly HoldingPlayer[],
  frame: TrackingFrame,
  previous: TrackingFrame | undefined,
  holdSec: number,
): boolean {
  const stalled = isStalled(frame, previous);
  for (const player of players) {
    const inCell = handInCell(player, frame, START_CELL);
    const hold = stepHold(player.holdStartMs, inCell, stalled, frame.timeMs, holdSec);
    player.holdStartMs = hold.startMs;
    player.hold = hold.progress;
  }
  return players.every((player) => player.hold >= 1);
}

/**
 * Ready screen: a player holds a hand in their Calibrate cell, without a break, for `holdSec`.
 * Updates the Calibrate hold of each player in `players` from one tracking frame, and returns
 * the players whose hold is complete, in slot order. A hand in the Start cell does not count here.
 */
export function stepCalibrateHolds(
  players: readonly HoldingPlayer[],
  frame: TrackingFrame,
  previous: TrackingFrame | undefined,
  holdSec: number,
): HoldingPlayer[] {
  const stalled = isStalled(frame, previous);
  for (const player of players) {
    const inCell = handInCell(player, frame, CALIBRATE_CELL);
    const hold = stepHold(player.calibrateHoldStartMs, inCell, stalled, frame.timeMs, holdSec);
    player.calibrateHoldStartMs = hold.startMs;
    player.calibrateHold = hold.progress;
  }
  return players.filter((player) => player.calibrateHold >= 1);
}

/**
 * During the calibration of one player: the Calibrate hold of another player goes on, when it
 * began on the ready screen and the player does not wait yet. Two players who hold at nearly
 * the same time then both calibrate: the first hold that completes goes first, and the other
 * player waits. A hold that has ended does not start again, because the Calibrate cell is a
 * choice of the ready screen. Returns the players whose hold completed: they wait now.
 */
export function stepWaitingHolds(
  players: readonly HoldingPlayer[],
  calibrating: readonly PlayerIndex[],
  waiting: readonly PlayerIndex[],
  frame: TrackingFrame,
  previous: TrackingFrame | undefined,
  holdSec: number,
): HoldingPlayer[] {
  const holding = players.filter((player) => {
    const isBusy = calibrating.includes(player.index) || waiting.includes(player.index);
    return !isBusy && player.calibrateHoldStartMs !== null;
  });
  return stepCalibrateHolds(holding, frame, previous, holdSec);
}

/** Forgets every player's Start hold. */
export function clearHolds(players: readonly HoldingPlayer[]): void {
  for (const player of players) {
    player.holdStartMs = null;
    player.hold = 0;
  }
}

/** Forgets every player's Calibrate hold. */
export function clearCalibrateHolds(players: readonly HoldingPlayer[]): void {
  for (const player of players) {
    player.calibrateHoldStartMs = null;
    player.calibrateHold = 0;
  }
}
