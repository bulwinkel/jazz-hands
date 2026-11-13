import type { TrackingFrame } from '../tracking/types';
import { HANDS_UP_CELL, TIMING } from './config';
import { cellRect, insideCell } from './geometry';
import type { PlayerRun } from './player';

/** What the hands-up hold reads and changes of a player. */
export type HoldingPlayer = Pick<PlayerRun, 'index' | 'grid' | 'holdStartMs' | 'hold'>;

/**
 * Ready check and replay: each player holds a hand in the hands-up cell, without a break, for
 * `holdSec`. Updates every player's hold from one tracking frame, and returns true when every
 * player holds. A gap between `previous` and `frame` longer than a stale frame breaks the holds.
 */
export function stepHandsUp(
  players: readonly HoldingPlayer[],
  frame: TrackingFrame,
  previous: TrackingFrame | undefined,
  holdSec: number,
): boolean {
  const stalled = previous !== undefined && frame.timeMs - previous.timeMs > TIMING.staleFrameMs;
  for (const player of players) {
    const target = cellRect(player.grid, HANDS_UP_CELL);
    const raised = frame.players[player.index].hands.some((hand) => insideCell(hand, target));
    if (!raised || stalled) player.holdStartMs = null;
    if (raised && player.holdStartMs === null) player.holdStartMs = frame.timeMs;
    player.hold = player.holdStartMs === null ? 0 : Math.min(1, (frame.timeMs - player.holdStartMs) / (holdSec * 1000));
  }
  return players.every((player) => player.hold >= 1);
}

/** Forgets every player's hands-up hold. */
export function clearHolds(players: readonly HoldingPlayer[]): void {
  for (const player of players) {
    player.holdStartMs = null;
    player.hold = 0;
  }
}
