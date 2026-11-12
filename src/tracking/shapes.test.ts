import { describe, expect, it } from 'vitest';
import { shapeFromLandmarks } from './shapes';
import type { Point } from './types';

type FingerState = 'straight' | 'curled';
interface HandPose {
  index: FingerState;
  middle: FingerState;
  ring: FingerState;
  pinky: FingerState;
}

const ASPECT = 16 / 9;

/**
 * Builds the 21 landmarks of a hand. The wrist is at the centre of the frame and the palm
 * points along `angleDeg` (0 = fingers to the right, 90 = fingers down the screen).
 * Lengths are in frame heights. A curled finger folds back over its own knuckle.
 */
function hand(pose: HandPose, angleDeg: number, size = 0.1): Point[] {
  const angle = (angleDeg * Math.PI) / 180;
  /** A point `along` the palm direction and `across` it, turned to the hand's angle. */
  const place = (along: number, across: number): Point => {
    const x = along * Math.cos(angle) - across * Math.sin(angle);
    const y = along * Math.sin(angle) + across * Math.cos(angle);
    // x is a fraction of the frame width, so a length across the screen shrinks by the aspect.
    return { x: 0.5 + (x * size) / ASPECT, y: 0.5 + y * size };
  };

  const finger = (across: number, state: FingerState): Point[] => {
    const knuckle = place(1, across);
    if (state === 'straight') return [knuckle, place(1.4, across), place(1.7, across), place(1.95, across)];
    return [knuckle, place(1.35, across), place(1.25, across * 0.9), place(1.05, across * 0.9)];
  };

  const wrist = place(0, 0);
  const thumb = [place(0.3, -0.45), place(0.55, -0.7), place(0.75, -0.85), place(0.9, -0.95)];
  return [
    wrist,
    ...thumb,
    ...finger(-0.3, pose.index),
    ...finger(0, pose.middle),
    ...finger(0.25, pose.ring),
    ...finger(0.5, pose.pinky),
  ];
}

const FIST: HandPose = { index: 'curled', middle: 'curled', ring: 'curled', pinky: 'curled' };
const OPEN: HandPose = { index: 'straight', middle: 'straight', ring: 'straight', pinky: 'straight' };
const POINT: HandPose = { ...FIST, index: 'straight' };
const PEACE: HandPose = { ...FIST, index: 'straight', middle: 'straight' };

/** Fingers up, to the right, down, to the left, and the diagonals between. */
const ANGLES = [270, 315, 0, 45, 90, 135, 180, 225];

describe('shape from hand landmarks', () => {
  it.each(ANGLES)('reads all four shapes with the fingers at %i degrees', (angle) => {
    expect(shapeFromLandmarks(hand(FIST, angle), ASPECT)).toBe('fist');
    expect(shapeFromLandmarks(hand(OPEN, angle), ASPECT)).toBe('open');
    expect(shapeFromLandmarks(hand(POINT, angle), ASPECT)).toBe('point');
    expect(shapeFromLandmarks(hand(PEACE, angle), ASPECT)).toBe('peace');
  });

  it.each([0.03, 0.08, 0.25])('reads shapes for a hand %f of the frame height in size', (size) => {
    expect(shapeFromLandmarks(hand(OPEN, 200, size), ASPECT)).toBe('open');
    expect(shapeFromLandmarks(hand(PEACE, 200, size), ASPECT)).toBe('peace');
  });

  it('reads no shape for other finger combinations', () => {
    const threeFingers: HandPose = { ...OPEN, pinky: 'curled' };
    const pinkyOnly: HandPose = { ...FIST, pinky: 'straight' };
    expect(shapeFromLandmarks(hand(threeFingers, 0), ASPECT)).toBeNull();
    expect(shapeFromLandmarks(hand(pinkyOnly, 0), ASPECT)).toBeNull();
  });

  it('ignores the thumb', () => {
    const tuckedThumb = hand(OPEN, 270);
    for (const thumbJoint of [1, 2, 3, 4]) tuckedThumb[thumbJoint] = tuckedThumb[0];
    expect(shapeFromLandmarks(tuckedThumb, ASPECT)).toBe('open');
  });

  it('reads no shape without the full set of landmarks', () => {
    expect(shapeFromLandmarks(hand(OPEN, 0).slice(0, 4), ASPECT)).toBeNull();
    expect(shapeFromLandmarks([], ASPECT)).toBeNull();
  });
});
