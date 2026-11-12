import type { FaceExpression, TrackedFace } from '../tracking/types';
import { FACES, LEVELS } from './config';
import { EPSILON_MS, within } from './judgment';
import type { CellMark } from './judgment';
import type { FaceCue, Level, Rating } from './types';

export interface FaceCueState {
  cue: FaceCue;
  /** Best mark so far. */
  mark: CellMark;
  /** Set once the cue is final. A final cue never changes. */
  result?: Rating;
}

export function newFaceCueState(cue: FaceCue): FaceCueState {
  return { cue, mark: null };
}

/** No face found counts as a face that does not show the expression. */
function showsExpression(face: TrackedFace | undefined, expression: FaceExpression): boolean {
  return face !== undefined && face.expressions[expression] >= FACES.thresholds[expression];
}

/**
 * Applies one tracking frame to one face cue and returns the new state. Never mutates `state`.
 *
 * The rule is the one for a one-cell tap, with the expression in place of the hand in the cell.
 * The cue is Perfect when the face shows the expression during any frame inside the Perfect
 * window, so pulling the face early and holding it is correct play. Otherwise it becomes final
 * when the Good window closes: Good if the expression showed inside that window, else Miss.
 */
export function judgeFaceFrame(
  state: FaceCueState,
  level: Level,
  face: TrackedFace | undefined,
  timeSec: number,
): FaceCueState {
  if (state.result) return state;
  const { perfectMs, goodMs } = LEVELS[level];
  const { cue } = state;
  const deltaMs = (timeSec - cue.timeSec) * 1000;

  let mark = state.mark;
  if (within(deltaMs, goodMs) && showsExpression(face, cue.expression)) {
    // A Good mark is provisional: an expression held into the Perfect window upgrades it.
    mark = within(deltaMs, perfectMs) ? 'perfect' : 'good';
  }

  if (mark === 'perfect') return { cue, mark, result: 'perfect' };
  const windowClosed = deltaMs > goodMs[1] + EPSILON_MS;
  if (windowClosed) return { cue, mark, result: mark ?? 'miss' };
  return { cue, mark };
}

/**
 * The face cue a player sees now: the first one that is on screen and not yet final.
 * The game reads a player's face only while this gives a cue, so hand tracking keeps its
 * full speed for the rest of the song.
 */
export function openFaceCue(
  states: readonly FaceCueState[],
  level: Level,
  timeSec: number,
): FaceCueState | undefined {
  const { approachSec } = LEVELS[level];
  return states.find((state) => !state.result && timeSec >= state.cue.timeSec - approachSec);
}
