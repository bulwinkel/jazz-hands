import { GAME_CONFIG as C } from './config';
import type { Point, Rect } from './types';
export function defaultGrid(player: number): Rect {
  return { x: player * 0.5 + (0.5 - C.defaultGridWidth) / 2, y: C.defaultGridTop, width: C.defaultGridWidth, height: C.defaultGridHeight };
}
export function cellRect(grid: Rect, cell: number): Rect {
  return { x: grid.x + cell % 3 * grid.width / 3, y: grid.y + Math.floor(cell / 3) * grid.height / 3, width: grid.width / 3, height: grid.height / 3 };
}
export function insideCell(point: Point, rect: Rect, margin = C.cellMargin): boolean {
  const epsilon = 1e-10;
  return point.x >= rect.x - margin * rect.width - epsilon && point.x <= rect.x + rect.width * (1 + margin) + epsilon && point.y >= rect.y - margin * rect.height - epsilon && point.y <= rect.y + rect.height * (1 + margin) + epsilon;
}
export function cellCentre(grid: Rect, cell: number): Point {
  const r = cellRect(grid, cell); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}
export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b); const index = (sorted.length - 1) * p;
  const low = Math.floor(index); return sorted[low] + (sorted[Math.ceil(index)] - sorted[low]) * (index - low);
}
export function fitGrid(samples: Point[], player: number): Rect {
  const points = samples.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (points.length < C.fitMinSamples) return defaultGrid(player);
  const xs = points.map(p => p.x); const ys = points.map(p => p.y);
  const left = percentile(xs, C.fitPercentiles[0]); const right = percentile(xs, C.fitPercentiles[1]);
  const top = percentile(ys, C.fitPercentiles[0]); const bottom = percentile(ys, C.fitPercentiles[1]);
  const width = Math.min(0.5 - 2 * C.halfMargin, Math.max(C.minGridWidth, right - left));
  const height = Math.min(1 - 2 * C.halfMargin, Math.max(C.minGridHeight, bottom - top));
  return { x: Math.max(player * 0.5 + C.halfMargin, Math.min((left + right - width) / 2, (player + 1) * 0.5 - C.halfMargin - width)),
    y: Math.max(C.halfMargin, Math.min((top + bottom - height) / 2, 1 - C.halfMargin - height)), width, height };
}
export function containRect(width: number, height: number, aspect: number): Rect {
  const w = Math.min(width, height * aspect); const h = w / aspect;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}
