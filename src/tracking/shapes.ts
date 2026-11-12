import type { GestureName, Point } from './types';

/**
 * Reads a hand shape from the 21 hand landmarks, whichever way the hand points.
 *
 * MediaPipe's own gesture model was trained on upright hands. In play, a hand that reaches to
 * the side or down points sideways or down, and the model then reads "none": measured in real
 * rounds, it read an open palm in 0% of frames in the bottom row of the grid.
 * Looking at which fingers are straight does not depend on the hand's direction.
 *
 * The reader measures in the flat picture, with no depth. A finger that points toward the
 * camera therefore looks short and reads as curled, which makes pointing low in the grid
 * harder (19% of frames in real rounds). That is left as it is on purpose: the owner wants the
 * bottom row to be the hard one, and a player who bends down a little gets it right.
 */

/** Landmark indices of one finger, from the knuckle at the palm to the tip. */
interface Finger {
  knuckle: number;
  middleJoint: number;
  endJoint: number;
  tip: number;
}

const WRIST = 0;
const INDEX: Finger = { knuckle: 5, middleJoint: 6, endJoint: 7, tip: 8 };
const MIDDLE: Finger = { knuckle: 9, middleJoint: 10, endJoint: 11, tip: 12 };
const RING: Finger = { knuckle: 13, middleJoint: 14, endJoint: 15, tip: 16 };
const PINKY: Finger = { knuckle: 17, middleJoint: 18, endJoint: 19, tip: 20 };
const LANDMARK_COUNT = 21;

/**
 * A straight finger: the line from knuckle to tip is nearly as long as the finger's three
 * bones laid end to end. A curled finger folds back on itself, so that line is much shorter.
 */
const MIN_STRAIGHTNESS = 0.8;
/**
 * A straight finger must also be long, measured against the palm (wrist to middle knuckle).
 * This rejects a finger that only looks straight because its landmarks are bunched together.
 */
const MIN_LENGTH_OF_PALM = 0.5;

/** Which of index, middle, ring and pinky are straight, for each shape the game asks for. */
const SHAPES: { name: GestureName; index: boolean; middle: boolean; ring: boolean; pinky: boolean }[] = [
  { name: 'fist', index: false, middle: false, ring: false, pinky: false },
  { name: 'open', index: true, middle: true, ring: true, pinky: true },
  { name: 'point', index: true, middle: false, ring: false, pinky: false },
  { name: 'peace', index: true, middle: true, ring: false, pinky: false },
];

/**
 * The shape of a hand, or null when the fingers match none of fist, open, point and peace.
 * The thumb is ignored: people hold it in many ways with each of these shapes.
 *
 * `landmarks` are fractions of the frame, so `frameAspect` (width / height) is needed to
 * compare distances across and down the picture.
 */
export function shapeFromLandmarks(landmarks: readonly Point[], frameAspect: number): GestureName | null {
  if (landmarks.length < LANDMARK_COUNT) return null;
  const distance = (a: number, b: number): number =>
    Math.hypot((landmarks[a].x - landmarks[b].x) * frameAspect, landmarks[a].y - landmarks[b].y);

  const palm = distance(WRIST, MIDDLE.knuckle);
  if (palm === 0) return null;

  const isStraight = (finger: Finger): boolean => {
    const reach = distance(finger.knuckle, finger.tip);
    const bones =
      distance(finger.knuckle, finger.middleJoint) +
      distance(finger.middleJoint, finger.endJoint) +
      distance(finger.endJoint, finger.tip);
    return bones > 0 && reach / bones >= MIN_STRAIGHTNESS && reach / palm >= MIN_LENGTH_OF_PALM;
  };

  const straight = {
    index: isStraight(INDEX),
    middle: isStraight(MIDDLE),
    ring: isStraight(RING),
    pinky: isStraight(PINKY),
  };
  const match = SHAPES.find(
    (shape) =>
      shape.index === straight.index &&
      shape.middle === straight.middle &&
      shape.ring === straight.ring &&
      shape.pinky === straight.pinky,
  );
  return match?.name ?? null;
}
