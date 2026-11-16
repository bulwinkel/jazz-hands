import type { FaceExpression, GestureName, PlayerTracking, TrackedFace, TrackedHand } from '../tracking/types';
import { seededRandom } from './chart';
import { BOT, START_CELL } from './config';
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

/** The bot's hands during play: one in every cell of a cue, around the cue's due time. */
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
    const holding = timeSec >= cue.timeSec - BOT.leadSec && timeSec <= cue.timeSec + BOT.holdSec;
    if (!holding) continue;
    // Each hand makes the shape of its own cell.
    cue.cells.forEach((cell, k) => hands.push(handAt(grid, cell, cue.shapes?.[k])));
  }
  return hands;
}

/**
 * The bot's face in the middle of the box where the tracker would look for it. With an
 * expression, it shows that one at full strength. Without one, it is a still face.
 */
function faceAt(grid: Rect, expression?: FaceExpression): TrackedFace {
  const region = faceRegion(grid);
  const expressions = { smile: 0, openMouth: 0, pucker: 0 };
  if (expression) expressions[expression] = 1;
  return { x: region.x + region.width / 2, y: region.y + region.height / 2, expressions };
}

/**
 * The bot's face during play: around each face cue's due time it shows that cue's expression
 * at full strength, in the middle of the box where the tracker would look for it. Around a cue
 * that it skips, it shows a still face: the camera sees the face, so the cue is a Miss.
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
  if (!cue) return undefined;
  const expression = botHits(cue, accuracy, seed) ? cue.expression : undefined;
  return faceAt(grid, expression);
}

/**
 * A simulated player for automated checks. It holds a hand in its Start cell to start, then
 * plays the chart. It never calibrates. With face cues, it also pulls each face.
 *
 * Before play (the ready screen, the results and the countdown) it shows a still face, as a
 * player in front of a camera does. The face check before play then keeps its face cues. The
 * input passes the face on only where the game asked for one.
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
  if (phase === 'ready' || phase === 'results') return { hands: [handAt(grid, START_CELL)], face: faceAt(grid) };
  if (phase === 'countdown') return { hands: [], face: faceAt(grid) };
  if (phase !== 'play') return { hands: [] };

  const tracked: PlayerTracking = { hands: botHands(timeSec, cues, grid, accuracy, seed) };
  const face = botFace(timeSec, faceCues, grid, accuracy, seed);
  if (face) tracked.face = face;
  return tracked;
}
