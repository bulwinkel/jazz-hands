import { describe, expect, it } from 'vitest';
import {
  cellRect,
  containRect,
  defaultGrid,
  faceRegion,
  fitGrid,
  insideCell,
  percentile,
  playSpan,
} from './geometry';
import type { Point } from './types';

const repeat = (count: number, point: (i: number) => Point): Point[] => Array.from({ length: count }, (_, i) => point(i));

describe('cells', () => {
  it('counts a hand as inside up to the margin around the cell', () => {
    const cell = { x: 0.2, y: 0.3, width: 0.1, height: 0.2 };
    expect(insideCell({ x: 0.188, y: 0.276 }, cell)).toBe(true);
    expect(insideCell({ x: 0.312, y: 0.524 }, cell)).toBe(true);
    expect(insideCell({ x: 0.1879, y: 0.3 }, cell)).toBe(false);
  });

  it('lays cells out row by row from the top-left', () => {
    const grid = { x: 0.1, y: 0.2, width: 0.3, height: 0.6 };
    expect(cellRect(grid, 0)).toEqual({ x: 0.1, y: 0.2, width: 0.3 / 3, height: 0.6 / 3 });
    expect(cellRect(grid, 8).x).toBeCloseTo(0.3);
    expect(cellRect(grid, 8).y).toBeCloseTo(0.6);
  });
});

describe('default grid', () => {
  it('sits in the middle of each half with two players', () => {
    expect(defaultGrid(0, 2).x).toBeCloseTo(0.04);
    expect(defaultGrid(1, 2).x).toBeCloseTo(0.54);
    expect(defaultGrid(0, 2).width).toBe(0.42);
  });

  it('sits in the middle of the frame with one player', () => {
    const grid = defaultGrid(0, 1);
    expect(grid.x + grid.width / 2).toBeCloseTo(0.5);
    expect(grid.width).toBe(0.56);
  });
});

describe('reach fit', () => {
  it('interpolates percentiles', () => {
    expect(percentile([0, 1, 2, 3, 4], 0.02)).toBeCloseTo(0.08);
  });

  it('keeps the default grid with fewer than 20 hand positions', () => {
    expect(fitGrid(repeat(19, () => ({ x: 0, y: 0 })), 1, 2)).toEqual(defaultGrid(1, 2));
    expect(fitGrid([], 0, 1)).toEqual(defaultGrid(0, 1));
  });

  it('boxes the hand positions, without the outermost 2% on each side', () => {
    const points = repeat(101, (i) => ({ x: 0.05 + i * 0.004, y: 0.1 + i * 0.008 }));
    const grid = fitGrid(points, 0, 2);
    expect(grid.x).toBeCloseTo(0.058);
    expect(grid.y).toBeCloseTo(0.116);
    expect(grid.width).toBeCloseTo(0.384);
    expect(grid.height).toBeCloseTo(0.768);
  });

  it('grows a tiny reach to the minimum size around its centre', () => {
    const grid = fitGrid(repeat(30, () => ({ x: 0.25, y: 0.5 })), 0, 2);
    expect(grid.x).toBeCloseTo(0.16);
    expect(grid.y).toBeCloseTo(0.35);
    expect(grid.width).toBe(0.18);
    expect(grid.height).toBe(0.3);
  });

  const hugeReach = repeat(100, (i) => (i % 2 ? { x: -1, y: -3 } : { x: 2, y: 4 }));

  it.each([0, 1] as const)('cuts a huge reach to the half of player %i with two players', (player) => {
    const grid = fitGrid(hugeReach, player, 2);
    expect(grid.x).toBeCloseTo(player * 0.5 + 0.01);
    expect(grid.width).toBeCloseTo(0.48);
    expect(grid.y).toBeCloseTo(0.01);
    expect(grid.height).toBeCloseTo(0.98);
  });

  it('cuts a huge reach to the whole frame with one player', () => {
    const grid = fitGrid(hugeReach, 0, 1);
    expect(grid.x).toBeCloseTo(0.01);
    expect(grid.width).toBeCloseTo(0.98);
  });

  it('lets one player reach across the centre line', () => {
    const points = repeat(101, (i) => ({ x: 0.2 + i * 0.006, y: 0.2 + i * 0.006 }));
    const grid = fitGrid(points, 0, 1);
    expect(grid.x).toBeLessThan(0.5);
    expect(grid.x + grid.width).toBeGreaterThan(0.5);
    expect(playSpan(0, 1)).toEqual({ left: 0.01, right: 0.99 });
  });
});

describe('containRect', () => {
  it('letterboxes a wide frame in a square box', () => {
    expect(containRect(1000, 1000, 2)).toEqual({ x: 0, y: 250, width: 1000, height: 500 });
  });
});

describe('face region', () => {
  it('is two cells wide and centred on the grid', () => {
    const region = faceRegion({ x: 0.1, y: 0.2, width: 0.3, height: 0.6 });
    expect(region.x).toBeCloseTo(0.15);
    expect(region.width).toBeCloseTo(0.2);
  });

  it('runs from half a cell above the grid top down to 60% of the grid height', () => {
    // A cell of this grid is 0.2 high.
    const region = faceRegion({ x: 0.1, y: 0.2, width: 0.3, height: 0.6 });
    expect(region.y).toBeCloseTo(0.1);
    expect(region.y + region.height).toBeCloseTo(0.56);
  });

  it('covers the upper middle of every default grid, up to the frame top', () => {
    for (const grid of [defaultGrid(0, 2), defaultGrid(1, 2), defaultGrid(0, 1)]) {
      const region = faceRegion(grid);
      expect(region.x + region.width / 2).toBeCloseTo(grid.x + grid.width / 2);
      expect(region.x).toBeGreaterThan(grid.x);
      // Half a cell above these grids is outside the frame.
      expect(region.y).toBe(0);
      expect(region.y + region.height).toBeCloseTo(grid.y + grid.height * 0.6);
    }
  });

  it('is cut to the frame', () => {
    const offLeftAndTop = faceRegion({ x: -0.2, y: -0.1, width: 0.6, height: 0.5 });
    expect(offLeftAndTop.x).toBe(0);
    expect(offLeftAndTop.y).toBe(0);
    expect(offLeftAndTop.width).toBeCloseTo(0.3);
    expect(offLeftAndTop.height).toBeCloseTo(0.2);

    const offRightAndBottom = faceRegion({ x: 0.7, y: 0.6, width: 0.6, height: 1 });
    expect(offRightAndBottom.x).toBeCloseTo(0.8);
    expect(offRightAndBottom.x + offRightAndBottom.width).toBe(1);
    expect(offRightAndBottom.y).toBeCloseTo(0.6 - 1 / 6);
    expect(offRightAndBottom.y + offRightAndBottom.height).toBe(1);
  });
});
