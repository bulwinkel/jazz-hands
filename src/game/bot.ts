import type { GestureName, PlayerTracking, TrackedFace, TrackedHand } from '../tracking/types';
import { seededRandom } from './chart';
import { BOT, HANDS_UP_CELL } from './config';
import { cellCentre, faceRegion } from './geometry';
import type { Cue, FaceCue, Phase, Rect } from './types';

function handAt(grid: Rect, cell: number, gesture: GestureName = 'open'): TrackedHand {
  return { ...cellCentre(grid, cell), size: 0.05, gesture, gestureScore: 1 };
}

/** Whether the bot plays this cue. With accuracy below 1 it skips the same cues every run. */
export function botHits(cue: Pick<Cue, 'beatIndex'>, accuracy: number, seed: number): boolean {
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

/**
 * The bot's face during play: around each face cue's due time it shows that cue's expression
 * at full strength, in the middle of the box where the tracker would look for it.
 */
export function botFace(
  timeSec: number,
  faceCues: readonly FaceCue[],
  grid: Rect,
  accuracy: number,
  seed: number,
): TrackedFace | undefined {
  const cue = faceCues.find(
    (candidate) => timeSec >= candidate.timeSec - BOT.leadSec && timeSec <= candidate.timeSec + BOT.holdSec,
  );
  if (!cue || !botHits(cue, accuracy, seed)) return undefined;

  const region = faceRegion(grid);
  return {
    x: region.x + region.width / 2,
    y: region.y + region.height / 2,
    expressions: { smile: 0, openMouth: 0, pucker: 0, [cue.expression]: 1 },
  };
}

/**
 * A simulated player for automated checks. It raises a hand to start, then plays the chart.
 * With face cues, it also pulls each face.
 */
export function botPlayer(
  phase: Phase,
  timeSec: number,
  cues: readonly Cue[],
  grid: Rect,
  accuracy: number,
  seed: number,
  faceCues: readonly FaceCue[] = [],
): PlayerTracking {
  if (phase === 'ready' || phase === 'results') return { hands: [handAt(grid, HANDS_UP_CELL)] };
  if (phase !== 'play') return { hands: [] };

  const tracked: PlayerTracking = { hands: botHands(timeSec, cues, grid, accuracy, seed) };
  const face = botFace(timeSec, faceCues, grid, accuracy, seed);
  if (face) tracked.face = face;
  return tracked;
}
