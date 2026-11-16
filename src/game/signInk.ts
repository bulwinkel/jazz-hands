/**
 * Where the picture of a sign is, measured from the point that the canvas centres it on.
 *
 * A canvas centres a sign by the width and the line height that the font reports. A browser
 * engine can report other numbers than the picture has. In Safari's engine, which every
 * browser on an iPad uses, the point ☝️ and the peace ✌️ then sit beside the middle of their
 * cell. So the game draws each sign once on a hidden canvas, finds the box around its painted
 * pixels, and moves the sign by the distance from that box to the point.
 */

/** A distance right and down, as a share of the font size. */
export interface InkOffset {
  dx: number;
  dy: number;
}

const NO_OFFSET: InkOffset = Object.freeze({ dx: 0, dy: 0 });
/** The font size of the measurement, in pixels. */
export const MEASURE_SIZE = 96;
/** The side of the hidden canvas. It has room for a sign that sits far from the point. */
export const MEASURE_SIDE = MEASURE_SIZE * 3;
/** A pixel counts as painted above this alpha, of 255. The soft edge of a sign does not count. */
const PAINT_ALPHA = 32;

/** The font of the game's canvas text at `size` pixels. The signs are measured in it. */
export const canvasFont = (size: number): string => `800 ${size}px system-ui, sans-serif`;

/**
 * The middle of the box around the painted pixels of a square picture, measured from the
 * middle of the picture, in pixels. `rgba` has four bytes for each pixel, row by row.
 * Null when no pixel is painted.
 */
export function inkCentre(rgba: Uint8ClampedArray, side: number): { x: number; y: number } | null {
  let left = side;
  let right = -1;
  let top = side;
  let bottom = -1;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      if (rgba[(y * side + x) * 4 + 3] <= PAINT_ALPHA) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;
  // A pixel covers its index to its index + 1, so the box ends one past the last pixel.
  return { x: (left + right + 1) / 2 - side / 2, y: (top + bottom + 1) / 2 - side / 2 };
}

const offsets = new Map<string, InkOffset>();

/**
 * How far the picture of `sign` is from the point it is drawn on. Draw the sign this much to
 * the left and up, times the font size, and its picture is centred on the point.
 *
 * The first call for a sign draws it and reads the pixels back. Later calls are a lookup.
 * Where the sign cannot be measured, the offset is zero: the sign is drawn as before.
 */
export function signOffset(sign: string): InkOffset {
  let offset = offsets.get(sign);
  if (!offset) {
    offset = measure(sign);
    offsets.set(sign, offset);
  }
  return offset;
}

function measure(sign: string): InkOffset {
  if (typeof document === 'undefined') return NO_OFFSET;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = MEASURE_SIDE;
    canvas.height = MEASURE_SIDE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return NO_OFFSET;
    ctx.font = canvasFont(MEASURE_SIZE);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(sign, MEASURE_SIDE / 2, MEASURE_SIDE / 2);
    const centre = inkCentre(ctx.getImageData(0, 0, MEASURE_SIDE, MEASURE_SIDE).data, MEASURE_SIDE);
    return centre ? { dx: centre.x / MEASURE_SIZE, dy: centre.y / MEASURE_SIZE } : NO_OFFSET;
  } catch {
    return NO_OFFSET;
  }
}
