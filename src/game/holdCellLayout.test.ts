import { describe, expect, it } from 'vitest';
import { holdCellLayout, wordSizeFor } from './holdCellLayout';
import type { Rect } from './types';

/** "Calibrate" in the heavy canvas font is about 5.4 times as wide as its font size. */
const CALIBRATE_WIDTH_PER_SIZE = 5.4;
const calibrateWidth = (size: number): number => size * CALIBRATE_WIDTH_PER_SIZE;

/** A cell of the given size, with its top-left corner at (x, 100). */
const cell = (x: number, width: number, height: number): Rect => ({ x, y: 100, width, height });

describe('the size of a word in a cell', () => {
  it('is the base size when the word fits the cell', () => {
    expect(wordSizeFor(42, calibrateWidth(42), 300)).toBe(42);
  });

  it.each([
    ['the smallest grid on a 1920 px screen', 42, 115],
    ['the smallest grid on a 1024 px screen', 25.6, 61],
  ])('is smaller on %s, and the word then fits the cell', (_, baseSize, cellWidth) => {
    const size = wordSizeFor(baseSize, calibrateWidth(baseSize), cellWidth);
    expect(size).toBeLessThan(baseSize);
    expect(calibrateWidth(size)).toBeLessThanOrEqual(cellWidth * 0.9 + 1e-9);
  });
});

describe('the layout of a Start or Calibrate cell', () => {
  it('puts the word at the bottom of the cell, inside it, and the ring above the word', () => {
    const layout = holdCellLayout(cell(500, 115, 216), 42, calibrateWidth(42), 1920);
    expect(layout.word).not.toBeNull();
    const word = layout.word as NonNullable<typeof layout.word>;
    const halfWidth = calibrateWidth(word.size) / 2;
    expect(word.x - halfWidth).toBeGreaterThanOrEqual(500);
    expect(word.x + halfWidth).toBeLessThanOrEqual(615);
    expect(word.y + word.size / 2).toBeLessThanOrEqual(316);
    expect(layout.centre.y + layout.radius).toBeLessThan(word.y - word.size / 2);
  });

  it('keeps the word inside the screen when the cell is at its edge', () => {
    const atLeftEdge = holdCellLayout(cell(-20, 115, 216), 42, calibrateWidth(42), 1920);
    const word = atLeftEdge.word as NonNullable<typeof atLeftEdge.word>;
    expect(word.x - calibrateWidth(word.size) / 2).toBeGreaterThanOrEqual(0);
    const atRightEdge = holdCellLayout(cell(1825, 115, 216), 42, calibrateWidth(42), 1920);
    const rightWord = atRightEdge.word as NonNullable<typeof atRightEdge.word>;
    expect(rightWord.x + calibrateWidth(rightWord.size) / 2).toBeLessThanOrEqual(1920);
  });

  it('centres the sign and its ring in a cell with no word', () => {
    const layout = holdCellLayout(cell(500, 200, 300), 42, null, 1920);
    expect(layout.word).toBeNull();
    expect(layout.centre).toEqual({ x: 600, y: 250 });
    expect(layout.radius).toBeCloseTo(64);
  });
});
