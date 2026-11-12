import { cropToFrame } from './geometry';
import type { Crop } from './geometry';
import type { FaceExpression, Point, Region } from './types';

/** One blendshape score from the face model. MediaPipe's `Category` has this shape. */
export interface BlendshapeScore {
  categoryName: string;
  score: number;
}

/** A rectangle of whole pixels in the raw camera frame. */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * The three expressions the game asks for, from the face model's 52 blendshapes.
 * The names are the labels inside `face_landmarker.task`. A blendshape the model
 * does not report counts as 0.
 */
export function expressionsFromBlendshapes(
  blendshapes: readonly BlendshapeScore[],
): Record<FaceExpression, number> {
  const strength = (name: string): number => {
    const blendshape = blendshapes.find((candidate) => candidate.categoryName === name);
    return clamp01(blendshape?.score ?? 0);
  };
  return {
    // A smile lifts both mouth corners. The mean keeps a one-sided smirk from passing.
    smile: (strength('mouthSmileLeft') + strength('mouthSmileRight')) / 2,
    openMouth: strength('jawOpen'),
    pucker: strength('mouthPucker'),
  };
}

/**
 * The pixels of the raw camera frame that a region of the mirrored display covers.
 * The display is a mirror image, so the region's right edge is the crop's left edge.
 * Returns null when the region has no pixel inside the frame.
 */
export function regionToRawPixels(region: Region, frameWidth: number, frameHeight: number): PixelRect | null {
  const rawLeft = 1 - (region.x + region.width);
  const left = Math.round(clamp01(rawLeft) * frameWidth);
  const right = Math.round(clamp01(rawLeft + region.width) * frameWidth);
  const top = Math.round(clamp01(region.y) * frameHeight);
  const bottom = Math.round(clamp01(region.y + region.height) * frameHeight);

  const hasPixels = right > left && bottom > top;
  if (!hasPixels) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** A pixel rectangle as fractions of the frame it was cut from. */
export function pixelsToCrop(pixels: PixelRect, frameWidth: number, frameHeight: number): Crop {
  return {
    x: pixels.x / frameWidth,
    y: pixels.y / frameHeight,
    width: pixels.width / frameWidth,
    height: pixels.height / frameHeight,
  };
}

/**
 * The middle of a face in the full mirrored frame: the centre of the box around its landmarks.
 * The face model gives `landmarks` as fractions of the crop it ran on.
 */
export function faceCentre(landmarks: readonly Point[], crop: Crop): Point {
  if (!landmarks.length) throw new Error('Cannot find the centre of a face with no landmarks.');
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const landmark of landmarks) {
    left = Math.min(left, landmark.x);
    right = Math.max(right, landmark.x);
    top = Math.min(top, landmark.y);
    bottom = Math.max(bottom, landmark.y);
  }
  return cropToFrame({ x: (left + right) / 2, y: (top + bottom) / 2 }, crop);
}
