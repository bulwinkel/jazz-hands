import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameRenderer } from './render';
import { canvasFont, inkCentre, MEASURE_SIDE, MEASURE_SIZE, signOffset } from './signInk';

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

/**
 * The hidden canvas of a page whose browser paints every sign off-centre: its pixels cover
 * x 150 to 199 and y 100 to 139 of the 288 px square. The middle of that box is 31 px right
 * of the middle of the square, and 24 px above it.
 */
function offCentrePage(): Pick<Document, 'createElement'> {
  const rgba = new Uint8ClampedArray(MEASURE_SIDE * MEASURE_SIDE * 4);
  for (let y = 100; y <= 139; y++) {
    for (let x = 150; x <= 199; x++) rgba[(y * MEASURE_SIDE + x) * 4 + 3] = 255;
  }
  const ctx = { fillText: () => {}, getImageData: () => ({ data: rgba }) };
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  return { createElement: () => canvas } as unknown as Pick<Document, 'createElement'>;
}

/** The offset that `offCentrePage` gives, as a share of the font size. */
const OFF_CENTRE = { dx: 31 / MEASURE_SIZE, dy: -24 / MEASURE_SIZE };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('signOffset', () => {
  it('is zero where there is no page to measure on', () => {
    // A sign of its own: the offsets are kept per sign, and the renderer below measures ☝️.
    expect(signOffset('☝️ unmeasured')).toEqual({ dx: 0, dy: 0 });
  });

  it('measures how far the painted picture of a sign is from the point', () => {
    vi.stubGlobal('document', offCentrePage());
    const offset = signOffset('✌️ measured');
    expect(offset.dx).toBeCloseTo(OFF_CENTRE.dx);
    expect(offset.dy).toBeCloseTo(OFF_CENTRE.dy);
  });
});

describe('a sign drawn by the renderer', () => {
  /** A renderer on a canvas that only notes where each text is drawn. */
  function recordingRenderer(): { sign: (content: string, x: number, y: number, size: number) => void; drawn: number[][] } {
    const drawn: number[][] = [];
    const ctx = { fillText: (_: string, x: number, y: number) => drawn.push([x, y]) };
    const canvas = { getContext: () => ctx } as unknown as HTMLCanvasElement;
    const renderer = new GameRenderer(canvas);
    // `sign` is private to the renderer. The test calls it directly: it is the one place that
    // turns the measured offset into a position on the canvas.
    const { sign } = renderer as unknown as { sign: (content: string, x: number, y: number, size: number) => void };
    return { sign: sign.bind(renderer), drawn };
  }

  it.each([40, 120])('moves the sign against its offset, at %i px', (size) => {
    vi.stubGlobal('document', offCentrePage());
    const { sign, drawn } = recordingRenderer();
    sign('☝️ drawn', 500, 300, size);
    const [x, y] = drawn.at(-1) ?? [];
    expect(x).toBeCloseTo(500 - OFF_CENTRE.dx * size);
    expect(y).toBeCloseTo(300 - OFF_CENTRE.dy * size);
  });
});

describe('canvasFont', () => {
  it('names the size in pixels', () => {
    expect(canvasFont(48)).toBe('800 48px system-ui, sans-serif');
  });
});
