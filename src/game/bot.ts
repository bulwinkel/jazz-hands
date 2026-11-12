import type { GestureName, PlayerTracking, TrackedHand } from '../tracking/types';
import { seededRandom } from './chart';
import { BOT, HANDS_UP_CELL } from './config';
import { cellCentre } from './geometry';
import type { Cue, Phase, Rect } from './types';

function handAt(grid: Rect, cell: number, gesture: GestureName = 'open'): TrackedHand {
  return { ...cellCentre(grid, cell), size: 0.05, gesture, gestureScore: 1 };
}

/** Whether the bot plays this cue. With accuracy below 1 it skips the same cues every run. */
export function botHits(cue: Cue, accuracy: number, seed: number): boolean {
  const roll = seededRandom(seed ^ Math.imul(cue.beatIndex + 1, 0x45d9f3b))();
  return roll < accuracy;
}

/** The bot's hands during play: one in every cue cell around that cell's due time. */
export function botHands(
  timeSec: number,
  cues: readonly Cue[],
  grid: Rect,
  accuracy: number,
  seed: number,
): TrackedHand[] {
  const hands: TrackedHand[] = [];
  for (const cue of cues) {
    if (cue.timeSec - BOT.leadSec > timeSec) break; // Cues are in time order: the rest are later.
    if (!botHits(cue, accuracy, seed)) continue;
    cue.cells.forEach((cell, k) => {
      const dueSec = cue.times[k];
      if (timeSec >= dueSec - BOT.leadSec && timeSec <= dueSec + BOT.holdSec) {
        hands.push(handAt(grid, cell, cue.gesture));
      }
    });
  }
  return hands;
}

/** A simulated player for automated checks. It raises a hand to start, then plays the chart. */
export function botPlayer(
  phase: Phase,
  timeSec: number,
  cues: readonly Cue[],
  grid: Rect,
  accuracy: number,
  seed: number,
): PlayerTracking {
  if (phase === 'ready' || phase === 'results') return { hands: [handAt(grid, HANDS_UP_CELL)] };
  if (phase === 'play') return { hands: botHands(timeSec, cues, grid, accuracy, seed) };
  return { hands: [] };
}
