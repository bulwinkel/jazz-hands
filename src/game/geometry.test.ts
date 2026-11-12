import { describe, expect, it } from 'vitest';
import { cellRect, containRect, defaultGrid, fitGrid, insideCell, percentile } from './geometry';
describe('geometry', () => {
  it('includes the exact expanded margin, and excludes points beyond it', () => {
    const r = { x: 0.2, y: 0.3, width: 0.1, height: 0.2 };
    expect(insideCell({ x: 0.188, y: 0.276 }, r)).toBe(true); expect(insideCell({ x: 0.312, y: 0.524 }, r)).toBe(true);
    expect(insideCell({ x: 0.1879, y: 0.3 }, r)).toBe(false);
    expect(cellRect(defaultGrid(0), 8).x).toBeCloseTo(0.32);
  });
  it('fits percentiles, rejects outliers and uses the default with fewer than 20 samples', () => {
    expect(percentile([0, 1, 2, 3, 4], 0.02)).toBeCloseTo(0.08);
    expect(fitGrid(Array.from({ length: 19 }, () => ({ x: 0, y: 0 })), 1)).toEqual(defaultGrid(1));
    const points = Array.from({ length: 101 }, (_, i) => ({ x: 0.05 + i * 0.004, y: 0.1 + i * 0.008 }));
    const fit = fitGrid(points, 0); expect(fit.x).toBeCloseTo(0.058); expect(fit.y).toBeCloseTo(0.116); expect(fit.width).toBeCloseTo(0.384); expect(fit.height).toBeCloseTo(0.768);
  });
  it('grows minimum reach around its centre and clamps to each half', () => {
    const r = fitGrid(Array.from({ length: 30 }, () => ({ x: 0.25, y: 0.5 })), 0);
    expect(r).toEqual({ x: 0.16, y: 0.35, width: 0.18, height: 0.3 });
    for (const p of [0, 1]) {
      const box = fitGrid(Array.from({ length: 100 }, (_, i) => ({ x: i % 2 ? -1 : 2, y: i % 2 ? -3 : 4 })), p);
      expect(box.x).toBeCloseTo(p * 0.5 + 0.01); expect(box.width).toBe(0.48); expect(box.y).toBeCloseTo(0.01); expect(box.height).toBe(0.98);
    }
  });
  it('maps the full frame with letterboxing', () => { expect(containRect(1000, 1000, 2)).toEqual({ x: 0, y: 250, width: 1000, height: 500 }); });
});
