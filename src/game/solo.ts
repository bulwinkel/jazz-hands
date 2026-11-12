import type { TrackingFrame } from '../tracking/types';

const MAX_HANDS = 2;

/**
 * One-player mode: every tracked hand belongs to player 0, whichever half of the frame it is in.
 * Keeps the largest hands, which are the ones nearest the camera.
 */
export function mergeForSolo(frame: TrackingFrame): TrackingFrame {
  const hands = [...frame.players[0].hands, ...frame.players[1].hands]
    .sort((a, b) => b.size - a.size)
    .slice(0, MAX_HANDS);
  return { ...frame, players: [{ hands }, { hands: [] }] };
}
