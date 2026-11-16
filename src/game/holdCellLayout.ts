import { clamp } from './numbers';
import type { Point, Rect } from './types';

/**
 * Where the parts of a cell that a hand holds sit: the Start cell and the Calibrate cell. A
 * ring fills around a sign while the hand stays, and a word may sit under the sign. All
 * values are canvas pixels.
 */
export interface HoldCellLayout {
  /** The middle of the sign and of its ring. */
  centre: Point;
  radius: number;
  /** Where the word sits, and its size. Null for a cell with no word. */
  word: { x: number; y: number; size: number } | null;
}

/** A word fills at most this share of its cell's width. */
const WORD_WIDTH_SHARE = 0.9;
/** The ring is at most this share of the cell width, and of the height above the word, from side to side. */
const RING_WIDTH_SHARE = 0.32;
const RING_HEIGHT_SHARE = 0.4;

/**
 * The size of a word in a cell: the base text size, which reads from across a room, or less
 * when the word at that size would not fit the cell. On the smallest grid a cell is about
 * 115 px wide on a 1920 px screen, and "Calibrate" at the base size is wider than that.
 * `wordWidth` is the width of the word at `baseSize`.
 */
export function wordSizeFor(baseSize: number, wordWidth: number, cellWidth: number): number {
  if (wordWidth <= 0) return baseSize;
  return Math.min(baseSize, (baseSize * cellWidth * WORD_WIDTH_SHARE) / wordWidth);
}

/**
 * Lays out a cell that a hand holds. The word sits at the bottom of the cell, and the sign and
 * its ring fill the room above it. With no word, they fill the cell. `wordWidth` is the width
 * of the word at `baseSize`, or null for no word. The word stays inside the screen, which is
 * `screenWidth` wide.
 */
export function holdCellLayout(
  cell: Rect,
  baseSize: number,
  wordWidth: number | null,
  screenWidth: number,
): HoldCellLayout {
  const size = wordWidth === null ? 0 : wordSizeFor(baseSize, wordWidth, cell.width);
  const wordY = cell.y + cell.height - size * 0.75;
  const roomHeight = wordY - size * 0.6 - cell.y;
  const radius = Math.max(0, Math.min(cell.width * RING_WIDTH_SHARE, roomHeight * RING_HEIGHT_SHARE));
  const centreX = cell.x + cell.width / 2;
  const centre = { x: centreX, y: cell.y + roomHeight / 2 };
  if (wordWidth === null) return { centre, radius, word: null };

  const halfWord = (wordWidth * size) / baseSize / 2;
  const wordX = clamp(centreX, halfWord, screenWidth - halfWord);
  return { centre, radius, word: { x: wordX, y: wordY, size } };
}
