import type { GestureName, PlayerTracking, Point, TrackedHand } from './types';

export interface Crop { x: number; y: number; width: number; height: number }
export const FULL_FRAME: Crop = { x: 0, y: 0, width: 1, height: 1 };

export function mirror(point: Point): Point {
  return { x: 1 - point.x, y: point.y };
}

/** Map a raw crop landmark into the full, mirrored display frame. */
export function cropToFrame(point: Point, crop: Crop = FULL_FRAME): Point {
  return mirror({ x: crop.x + point.x * crop.width, y: crop.y + point.y * crop.height });
}

export function playerForX(mirroredX: number): 0 | 1 {
  return mirroredX < 0.5 ? 0 : 1;
}

export function meanPoint(points: readonly Point[]): Point {
  if (!points.length) throw new Error('Cannot find the centre of zero landmarks.');
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

export function palmCentre(landmarks: readonly Point[]): Point {
  return meanPoint([0, 5, 9, 13, 17].map((index) => landmarks[index]));
}

/** Account for frame aspect ratio: x distances are fractions of frame width. */
export function handSize(points: readonly Point[], frameAspect: number): number {
  if (!points.length) return 0;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return Math.hypot((Math.max(...xs) - Math.min(...xs)) * frameAspect,
    Math.max(...ys) - Math.min(...ys));
}

// Verified against GestureRecognizerOptions in tasks-vision 1.2.3 vision.d.ts.
const GESTURES: Record<string, GestureName> = {
  Closed_Fist: 'fist', Open_Palm: 'open', Pointing_Up: 'point', Victory: 'peace',
  Thumb_Up: 'thumbsUp', Thumb_Down: 'thumbsDown', ILoveYou: 'rock', None: 'none',
};

export function gestureName(category?: string): GestureName {
  return category && Object.hasOwn(GESTURES, category) ? GESTURES[category] : 'none';
}

/** Keep the largest two hands per player. Gesture certainty is not detection certainty. */
export function assignHands(hands: readonly TrackedHand[]): [PlayerTracking, PlayerTracking] {
  return [0, 1].map((player) => ({
    hands: hands.filter((hand) => playerForX(hand.x) === player)
      .sort((a, b) => b.size - a.size).slice(0, 2),
  })) as [PlayerTracking, PlayerTracking];
}

export interface VisiblePoint extends Point { visibility?: number }

/** Keep each pose's hands with its torso, even when a wrist crosses the divider. */
export function posePlayers(
  poses: readonly (readonly VisiblePoint[])[], frameAspect: number, minVisibility: number,
): [PlayerTracking, PlayerTracking] {
  const players: [PlayerTracking, PlayerTracking] = [{ hands: [] }, { hands: [] }];
  const best = [-1, -1];
  for (const pose of poses) {
    const torso = [11, 12, 23, 24].map((index) => pose[index])
      .filter((point) => point && (point.visibility ?? 0) >= minVisibility);
    if (torso.length < 2) continue;
    const player = playerForX(mirror(meanPoint(torso)).x);
    const confidence = torso.reduce((sum, point) => sum + (point.visibility ?? 0), 0) / torso.length;
    if (confidence <= best[player]) continue;
    best[player] = confidence;
    const hands: TrackedHand[] = [];
    for (const indices of [[15, 17, 19, 21], [16, 18, 20, 22]]) {
      const raw = indices.map((index) => pose[index]);
      if (raw.some((point) => !point || (point.visibility ?? 0) < minVisibility)) continue;
      const landmarks = raw.map(mirror);
      const centre = meanPoint(landmarks.slice(0, 3)); // wrist, pinky, index
      hands.push({ ...centre, size: handSize(landmarks, frameAspect),
        gesture: 'unknown', gestureScore: 0, landmarks });
    }
    players[player] = { hands };
  }
  return players;
}
