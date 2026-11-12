import { GRID } from './config';
import type { PlayerCount, PlayerIndex, Point, Rect } from './types';

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(value, high));

/**
 * The horizontal span a player's grid may use, in frame fractions.
 * One player has the whole frame. Two players have a half each.
 */
export function playSpan(player: PlayerIndex, playerCount: PlayerCount): { left: number; right: number } {
  const margin = GRID.edgeMargin;
  if (playerCount === 1) return { left: margin, right: 1 - margin };
  return { left: player * 0.5 + margin, right: (player + 1) * 0.5 - margin };
}

/** The grid before the reach fit, and when the fit has too few hand positions. */
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

/** Linear-interpolated percentile, with `p` from 0 to 1. */
export function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

/**
 * Fits a player's grid to their reach: the box around the hand positions seen while they
 * draw big circles. A child then gets a smaller, lower grid than an adult.
 */
export function fitGrid(samples: readonly Point[], player: PlayerIndex, playerCount: PlayerCount): Rect {
  const points = samples.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (points.length < GRID.fitMinSamples) return defaultGrid(player, playerCount);

  const [lowP, highP] = GRID.fitPercentiles;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const left = percentile(xs, lowP);
  const right = percentile(xs, highP);
  const top = percentile(ys, lowP);
  const bottom = percentile(ys, highP);

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
