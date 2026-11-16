import { describe, expect, it } from 'vitest';
import { canvasFont, inkCentre, signOffset } from './signInk';

const SIDE = 10;

/** A square picture with the given alpha in the pixels of a box, and no paint elsewhere. */
function picture(box: { left: number; top: number; right: number; bottom: number }, alpha = 255): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(SIDE * SIDE * 4);
  for (let y = box.top; y <= box.bottom; y++) {
    for (let x = box.left; x <= box.right; x++) rgba[(y * SIDE + x) * 4 + 3] = alpha;
  }
  return rgba;
}

describe('inkCentre', () => {
  it('is zero for paint around the middle of the picture', () => {
    expect(inkCentre(picture({ left: 3, top: 2, right: 6, bottom: 7 }), SIDE)).toEqual({ x: 0, y: 0 });
  });

  it('gives how far the paint is to the right of and below the middle', () => {
    // The box covers x 6 to 10 and y 0 to 4: its middle is at (8, 2), and the picture's at (5, 5).
    expect(inkCentre(picture({ left: 6, top: 0, right: 9, bottom: 3 }), SIDE)).toEqual({ x: 3, y: -3 });
  });

  it('takes one painted pixel as a box of one pixel', () => {
    expect(inkCentre(picture({ left: 0, top: 9, right: 0, bottom: 9 }), SIDE)).toEqual({ x: -4.5, y: 4.5 });
  });

  it('leaves out the soft edge of a sign', () => {
    const rgba = picture({ left: 4, top: 4, right: 5, bottom: 5 });
    rgba[(0 * SIDE + 9) * 4 + 3] = 32; // A faint pixel in the top right corner.
    expect(inkCentre(rgba, SIDE)).toEqual({ x: 0, y: 0 });
    rgba[(0 * SIDE + 9) * 4 + 3] = 33;
    expect(inkCentre(rgba, SIDE)).toEqual({ x: 2, y: -2 });
  });

  it('is null for a picture with no paint', () => {
    expect(inkCentre(new Uint8ClampedArray(SIDE * SIDE * 4), SIDE)).toBeNull();
  });
});

describe('signOffset', () => {
  it('is zero where there is no page to measure on', () => {
    expect(signOffset('☝️')).toEqual({ dx: 0, dy: 0 });
  });
});

describe('canvasFont', () => {
  it('names the size in pixels', () => {
    expect(canvasFont(48)).toBe('800 48px system-ui, sans-serif');
  });
});
