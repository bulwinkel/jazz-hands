import { cropToFrame } from './geometry';
import type { Crop } from './geometry';
import type { Point, TrackedHand } from './types';

/**
 * Where the zones lie, for players who stand side by side.
 *
 * The mirrored frame is cut into equal vertical zones, one for each player. Zone 0 is the
 * leftmost on screen. Positions are fractions of the mirrored frame, unless a name says pixels.
 */

export const MAX_ZONES = 4;

/** A player has two hands, so a zone never reports more. */
export const HANDS_PER_ZONE = 2;

/**
 * How far the crop of a zone reaches into each neighbour, as a share of the zone width.
 * A hand on a border is then whole in at least one crop, where the model can find it.
 */
export const CROP_OVERLAP = 0.1;

/** A rectangle in camera pixels. The camera frame is not mirrored. */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The zone a position across the mirrored frame is in.
 * A landmark can lie just outside the picture, so a position outside the frame counts to the
 * zone at that edge.
 */
export function zoneOfX(x: number, zones: number): number {
  const zone = Math.floor(x * zones);
  return Math.max(0, Math.min(zones - 1, zone));
}

/**
 * The part of the camera frame that the model of one zone looks at: the zone itself plus the
 * overlap into its neighbours, cut off at the edges of the frame.
 *
 * The camera frame is not mirrored, so zone 0, the leftmost on screen, is the rightmost crop.
 */
export function zoneCrop(
  zone: number,
  zones: number,
  frameWidth: number,
  frameHeight: number,
  overlap: number = CROP_OVERLAP,
): PixelRect {
  const zoneWidth = 1 / zones;
  const mirroredLeft = Math.max(0, (zone - overlap) * zoneWidth);
  const mirroredRight = Math.min(1, (zone + 1 + overlap) * zoneWidth);

  // Whole pixels: the crop is drawn to a canvas, and a canvas has no half pixels.
  const left = Math.round((1 - mirroredRight) * frameWidth);
  const right = Math.round((1 - mirroredLeft) * frameWidth);
  return { x: left, y: 0, width: right - left, height: frameHeight };
}

/** A pixel rectangle as fractions of the camera frame. */
function asFractions(rect: PixelRect, frameWidth: number, frameHeight: number): Crop {
  return {
    x: rect.x / frameWidth,
    y: rect.y / frameHeight,
    width: rect.width / frameWidth,
    height: rect.height / frameHeight,
  };
}

/**
 * Maps the landmarks a model found in a crop into the full mirrored frame.
 * A model gives each landmark as a fraction of the picture it was shown, here the crop.
 */
export function cropLandmarksToFrame(
  landmarks: readonly Point[],
  crop: PixelRect,
  frameWidth: number,
  frameHeight: number,
): Point[] {
  const cropInFrame = asFractions(crop, frameWidth, frameHeight);
  return landmarks.map((landmark) => cropToFrame(landmark, cropInFrame));
}

/**
 * The hands of one zone: those with the palm centre in the zone, the largest first, at most two.
 *
 * The largest hands are the nearest to the camera, so they are the player's own and not
 * those of someone who walks past behind.
 *
 * With one model for each zone, give this the hands from the crop of that zone only. A hand in
 * the overlap is seen in two crops, and this keeps it in the one zone that holds its palm centre.
 */
export function handsInZone<Hand extends TrackedHand>(
  hands: readonly Hand[],
  zone: number,
  zones: number,
): Hand[] {
  return hands
    .filter((hand) => zoneOfX(hand.x, zones) === zone)
    .sort((a, b) => b.size - a.size)
    .slice(0, HANDS_PER_ZONE);
}
