import type { FaceExpression, TrackedFace } from '../tracking/types';
import { FACES, LEVELS } from './config';
import { isInsideWindow } from './judgment';
import type { CellMark } from './judgment';
import type { FaceCue, Level, Rating } from './types';

export interface FaceCueState {
  cue: FaceCue;
  /** Best mark so far. */
  mark: CellMark;
  /** True once a tracking frame inside the Good window had the player's face. */
  faceFound: boolean;
  /** Set once the cue is final with a result. A final cue never changes. */
  result?: Rating;
  /**
   * True once the cue is final with no result: its Good window closed with no hit, and no
   * frame in that window had the player's face. The game does not punish a player for what
   * the camera cannot see, so such a cue does not count at all.
   */
  unseen?: boolean;
}

export function newFaceCueState(cue: FaceCue): FaceCueState {
  return { cue, mark: null, faceFound: false };
}

/** True once a face cue is final: with a result, or with none because the camera did not see the face. */
export function isFinalFaceCue(state: FaceCueState): boolean {
  return state.result !== undefined || state.unseen === true;
}

/** No face found counts as a face that does not show the expression. */
export function showsExpression(face: TrackedFace | undefined, expression: FaceExpression): boolean {
  return face !== undefined && face.expressions[expression] >= FACES.thresholds[expression];
}

/**
 * Applies one tracking frame to one face cue and returns the new state. Never mutates `state`.
 * With no frame, `face` is undefined: the call only closes a cue whose time has passed.
 *
 * The rule is the one for a one-cell tap, with the expression in place of the hand in the cell.
 * The cue is Perfect when the face shows the expression during any frame inside the Perfect
 * window, so pulling the face early and holding it is correct play. Otherwise it becomes final
 * when the Good window closes: Good if the expression showed inside that window. Else it is a
 * Miss when a frame in that window had the face, and no result when none had it.
 */
export function judgeFaceFrame(
  state: FaceCueState,
  level: Level,
  face: TrackedFace | undefined,
  timeSec: number,
): FaceCueState {
  if (isFinalFaceCue(state)) return state;
  const { perfectMs, goodMs } = LEVELS[level];
  const { cue } = state;
  const deltaMs = (timeSec - cue.timeSec) * 1000;
  const insideGood = isInsideWindow(deltaMs, goodMs);
  const faceFound = state.faceFound || (insideGood && face !== undefined);

  let mark = state.mark;
  if (insideGood && showsExpression(face, cue.expression)) {
    // A Good mark is provisional: an expression held into the Perfect window upgrades it.
    mark = isInsideWindow(deltaMs, perfectMs) ? 'perfect' : 'good';
  }

  if (mark === 'perfect') return { cue, mark, faceFound, result: 'perfect' };
  // After the due time, a frame outside the Good window is past its late edge.
  const windowClosed = deltaMs > 0 && !insideGood;
  if (!windowClosed) return { cue, mark, faceFound };
  if (mark) return { cue, mark, faceFound, result: mark };
  if (faceFound) return { cue, mark, faceFound, result: 'miss' };
  return { cue, mark, faceFound, unseen: true };
}

/** The face cue a player sees now: the first one that is on screen and not yet final. */
export function openFaceCue(
  states: readonly FaceCueState[],
  level: Level,
  timeSec: number,
): FaceCueState | undefined {
  const { approachSec } = LEVELS[level];
  return states.find((state) => !isFinalFaceCue(state) && timeSec >= state.cue.timeSec - approachSec);
}

/**
 * True while the game needs a player's face from the tracker: from the moment a face cue
 * comes on screen until its Good window has closed. At all other times the tracker reads
 * no face, so hand tracking keeps its full speed for the rest of the song.
 *
 * The tracker reads on after a hit, to the end of the window. The run report then shows how
 * strong the expression became, and not only the first frame that passed the threshold.
 *
 * `songTimeSec` is the song time now. A frame taken now is judged `inputLatencySec` earlier.
 */
export function needsFace(
  faceCues: readonly FaceCue[],
  level: Level,
  songTimeSec: number,
  inputLatencySec: number,
): boolean {
  const { approachSec, goodMs } = LEVELS[level];
  const frameTimeSec = songTimeSec - inputLatencySec;
  return faceCues.some((cue) => {
    const isOnScreen = songTimeSec >= cue.timeSec - approachSec;
    const windowHasClosed = frameTimeSec > cue.timeSec + goodMs[1] / 1000;
    return isOnScreen && !windowHasClosed;
  });
}
