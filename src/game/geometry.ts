import { FACES, GRID } from './config';
import { clamp } from './numbers';
import type { PlayerCount, PlayerIndex, Point, Rect } from './types';


/**
 * The horizontal span a player's grid may use, in frame fractions.
 * One player has the whole frame. Two players have a half each.
 */
export function playSpan(player: PlayerIndex, playerCount: PlayerCount): { left: number; right: number } {
  const margin = GRID.edgeMargin;
  if (playerCount === 1) return { left: margin, right: 1 - margin };
  return { left: player * 0.5 + margin, right: (player + 1) * 0.5 - margin };
}

/** The standard grid: before a calibration, and after a calibration that saw too few hand positions. */
export function defaultGrid(player: PlayerIndex, playerCount: PlayerCount): Rect {
  const span = playSpan(player, playerCount);
  const width = playerCount === 1 ? GRID.soloWidth : GRID.duoWidth;
  const centre = (span.left + span.right) / 2;
  return { x: centre - width / 2, y: GRID.defaultTop, width, height: GRID.defaultHeight };
}

export function cellRect(grid: Rect, cell: number): Rect {
  const width = grid.width / 3;
  const height = grid.height / 3;
  return {
    x: grid.x + (cell % 3) * width,
    y: grid.y + Math.floor(cell / 3) * height,
    width,
    height,
  };
}

export function cellCentre(grid: Rect, cell: number): Point {
  const rect = cellRect(grid, cell);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** True when the point is in the cell or within the margin around it. The margin forgives tracking jitter. */
export function insideCell(point: Point, cell: Rect, margin: number = GRID.cellMargin): boolean {
  const epsilon = 1e-10;
  const padX = margin * cell.width + epsilon;
  const padY = margin * cell.height + epsilon;
  return (
    point.x >= cell.x - padX &&
    point.x <= cell.x + cell.width + padX &&
    point.y >= cell.y - padY &&
    point.y <= cell.y + cell.height + padY
  );
}

/**
 * Where the tracker looks for a player's face: the upper middle of their grid, and a little
 * above it. The grid is fitted to the player's reach, so their head is inside this box.
 * A face is too small to find in the whole frame, and large enough in this part of it.
 */
export function faceRegion(grid: Rect): Rect {
  const width = (grid.width / 3) * FACES.regionCells;
  const cellHeight = grid.height / 3;
  const left = clamp(grid.x + (grid.width - width) / 2, 0, 1);
  const right = clamp(grid.x + (grid.width + width) / 2, 0, 1);
  const top = clamp(grid.y - cellHeight * FACES.regionAboveCells, 0, 1);
  const bottom = clamp(grid.y + grid.height * FACES.regionHeight, 0, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Linear-interpolated percentile, with `p` from 0 to 1. */
export function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

const isFinitePoint = (point: Point): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);

/** The edges of a reach, as frame fractions. */
interface ReachBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * The box around a player's reach: the hand positions without the outermost few on each side
 * (`GRID.fitPercentiles`). Null with fewer hand positions than `GRID.fitMinSamples`.
 */
function reachBox(samples: readonly Point[]): ReachBox | null {
  const points = samples.filter(isFinitePoint);
  if (points.length < GRID.fitMinSamples) return null;
  const [lowP, highP] = GRID.fitPercentiles;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    left: percentile(xs, lowP),
    right: percentile(xs, highP),
    top: percentile(ys, lowP),
    bottom: percentile(ys, highP),
  };
}

/**
 * True when a calibration saw enough reach to count: at least `GRID.fitMinSamples` hand
 * positions, which span at least `GRID.minWidth` by `GRID.minHeight` before `fitGrid` clamps
 * them. 20 positions come in a third of a second, so the count alone is not enough: a player
 * who stands still through a calibration would get the smallest grid.
 */
export function hasReachToFit(samples: readonly Point[]): boolean {
  const box = reachBox(samples);
  if (!box) return false;
  return box.right - box.left >= GRID.minWidth && box.bottom - box.top >= GRID.minHeight;
}

/**
 * Fits a player's grid to their reach: the box around the hand positions seen while they
 * draw big circles. A child then gets a smaller, lower grid than an adult. With too few hand
 * positions it gives the standard grid. The grid on screen follows this while the player
 * draws; `hasReachToFit` says whether the end result counts.
 */
export function fitGrid(samples: readonly Point[], player: PlayerIndex, playerCount: PlayerCount): Rect {
  const box = reachBox(samples);
  if (!box) return defaultGrid(player, playerCount);
  const { left, right, top, bottom } = box;

  // A too-small reach grows around its centre. A too-large reach is cut to the player's area.
  const span = playSpan(player, playerCount);
  const margin = GRID.edgeMargin;
  const width = clamp(right - left, GRID.minWidth, span.right - span.left);
  const height = clamp(bottom - top, GRID.minHeight, 1 - 2 * margin);
  return {
    x: clamp((left + right) / 2 - width / 2, span.left, span.right - width),
    y: clamp((top + bottom) / 2 - height / 2, margin, 1 - margin - height),
    width,
    height,
  };
}

/** The largest rectangle of the given aspect ratio that fits a box, centred (letterbox). */
export function containRect(boxWidth: number, boxHeight: number, aspect: number): Rect {
  const width = Math.min(boxWidth, boxHeight * aspect);
  const height = width / aspect;
  return { x: (boxWidth - width) / 2, y: (boxHeight - height) / 2, width, height };
}
