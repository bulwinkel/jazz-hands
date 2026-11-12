import { describe, expect, it } from 'vitest';
import { expressionsFromBlendshapes, faceCentre, pixelsToCrop, regionToRawPixels } from './faces';
import type { BlendshapeScore } from './faces';
import type { Point } from './types';

const FRAME_WIDTH = 1920;
const FRAME_HEIGHT = 1080;

describe('expressions from blendshapes', () => {
  const blendshape = (categoryName: string, score: number): BlendshapeScore => ({ categoryName, score });

  it('reads a smile as the mean of both mouth corners', () => {
    const expressions = expressionsFromBlendshapes([
      blendshape('mouthSmileLeft', 0.9),
      blendshape('mouthSmileRight', 0.5),
    ]);
    expect(expressions.smile).toBeCloseTo(0.7);
  });

  it('reads an open mouth from the jaw and a pucker from the lips', () => {
    const expressions = expressionsFromBlendshapes([
      blendshape('_neutral', 0.01),
      blendshape('jawOpen', 0.62),
      blendshape('mouthPucker', 0.81),
      blendshape('mouthSmileLeft', 0.1),
      blendshape('mouthSmileRight', 0.1),
    ]);
    expect(expressions).toEqual({ smile: 0.1, openMouth: 0.62, pucker: 0.81 });
  });

  it('gives 0 for a blendshape the model does not report', () => {
    expect(expressionsFromBlendshapes([])).toEqual({ smile: 0, openMouth: 0, pucker: 0 });
    expect(expressionsFromBlendshapes([blendshape('mouthSmileLeft', 1)]).smile).toBe(0.5);
  });

  it('keeps every strength between 0 and 1', () => {
    const expressions = expressionsFromBlendshapes([blendshape('jawOpen', 1.4), blendshape('mouthPucker', -0.2)]);
    expect(expressions.openMouth).toBe(1);
    expect(expressions.pucker).toBe(0);
  });
});

describe('mirrored region to raw crop', () => {
  it('flips the region left to right, because the display is a mirror image', () => {
    // Player 0 is on the left of the display, which is the right of the raw camera frame.
    const region = { x: 0.1, y: 0.2, width: 0.3, height: 0.5 };
    expect(regionToRawPixels(region, FRAME_WIDTH, FRAME_HEIGHT)).toEqual({
      x: 0.6 * FRAME_WIDTH,
      y: 0.2 * FRAME_HEIGHT,
      width: 0.3 * FRAME_WIDTH,
      height: 0.5 * FRAME_HEIGHT,
    });
  });

  it('keeps a centred region centred', () => {
    const pixels = regionToRawPixels({ x: 0.4, y: 0, width: 0.2, height: 1 }, 1000, 500);
    expect(pixels).toEqual({ x: 400, y: 0, width: 200, height: 500 });
  });

  it('rounds to whole pixels', () => {
    const pixels = regionToRawPixels({ x: 0.3333, y: 0.1111, width: 0.25, height: 0.3333 }, 1921, 1081);
    expect(pixels).not.toBeNull();
    for (const value of Object.values(pixels ?? {})) expect(Number.isInteger(value)).toBe(true);
  });

  it('cuts a region that leaves the frame down to the part inside it', () => {
    const pixels = regionToRawPixels({ x: -0.1, y: 0.9, width: 0.3, height: 0.4 }, 1000, 1000);
    expect(pixels).toEqual({ x: 800, y: 900, width: 200, height: 100 });
  });

  it('gives null for a region with no pixel inside the frame', () => {
    expect(regionToRawPixels({ x: 1.2, y: 0.2, width: 0.3, height: 0.3 }, 1000, 1000)).toBeNull();
    expect(regionToRawPixels({ x: 0.2, y: 0.2, width: 0, height: 0.3 }, 1000, 1000)).toBeNull();
    expect(regionToRawPixels({ x: NaN, y: 0.2, width: 0.3, height: 0.3 }, 1000, 1000)).toBeNull();
  });
});

describe('face position', () => {
  /** A box of landmarks around a point, as the face model would report them inside its crop. */
  const landmarksAround = (centre: Point): Point[] => [
    { x: centre.x - 0.1, y: centre.y - 0.15 },
    { x: centre.x + 0.1, y: centre.y + 0.15 },
    { x: centre.x + 0.02, y: centre.y - 0.05 },
  ];

  it('is the middle of the box around the landmarks', () => {
    const wholeFrame = { x: 0, y: 0, width: 1, height: 1 };
    const centre = faceCentre(landmarksAround({ x: 0.5, y: 0.4 }), wholeFrame);
    expect(centre.x).toBeCloseTo(0.5);
    expect(centre.y).toBeCloseTo(0.4);
  });

  it('maps a face in a crop back to where it is in the full mirrored frame', () => {
    // A face at this point of the display, inside the region the game asked for.
    const faceOnDisplay = { x: 0.2, y: 0.35 };
    const region = { x: 0.1, y: 0.1, width: 0.28, height: 0.48 };
    const pixels = regionToRawPixels(region, FRAME_WIDTH, FRAME_HEIGHT);
    if (!pixels) throw new Error('The region is inside the frame.');

    // Where the face model sees that face: in the raw frame, as fractions of the crop.
    const rawX = (1 - faceOnDisplay.x) * FRAME_WIDTH;
    const rawY = faceOnDisplay.y * FRAME_HEIGHT;
    const inCrop = { x: (rawX - pixels.x) / pixels.width, y: (rawY - pixels.y) / pixels.height };

    const crop = pixelsToCrop(pixels, FRAME_WIDTH, FRAME_HEIGHT);
    const centre = faceCentre(landmarksAround(inCrop), crop);
    expect(centre.x).toBeCloseTo(faceOnDisplay.x);
    expect(centre.y).toBeCloseTo(faceOnDisplay.y);
  });

  it('refuses a face with no landmarks', () => {
    expect(() => faceCentre([], { x: 0, y: 0, width: 1, height: 1 })).toThrow('no landmarks');
  });
});
