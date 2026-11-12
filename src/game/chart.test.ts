import { describe, expect, it } from 'vitest';
import { generateChart, masterCells, selectStride } from './chart';
import { GAME_CONFIG as C } from './config';
import { medianInterval, playLength, tailStart } from './manifest';
import { synthetic } from './fixtures';
import type { Level } from './types';
describe('chart', () => {
  it('is deterministic and excludes the previous four master cells', () => {
    const m = synthetic(); expect(generateChart(m, 3, 4)).toEqual(generateChart(m, 3, 4));
    expect(masterCells(m, 4)).not.toEqual(masterCells(m, 5));
    const master = masterCells(m, 4); master.forEach((c, i) => expect(master.slice(Math.max(0, i - 4), i)).not.toContain(c));
  });
  it('shares master positions across levels and shares doubles between 2 and 3', () => {
    const m = synthetic(); const master = masterCells(m, 7);
    const charts = ([1, 2, 3] as Level[]).map(l => generateChart(m, l, 7));
    charts.forEach(chart => chart.filter(c => c.cells.length === 1).forEach(c => expect(c.cells[0]).toBe(master[c.beatIndex])));
    expect(charts[1].map(c => c.cells)).toEqual(charts[2].map(c => c.cells));
  });
  it.each([[60, 2, 1], [100, 2, 1], [128, 4, 2], [180, 4, 2]])('selects strides at %i BPM', (bpm, slow, fast) => {
    const gap = medianInterval(synthetic(bpm)); expect(selectStride(gap, C.slowInterval)).toBe(slow); expect(selectStride(gap, C.fastInterval)).toBe(fast);
  });
  it('honors lead-in, offset downbeat, low energy stride and the final bar of either length', () => {
    const m = synthetic(); m.firstDownbeat = 3; m.intensity.fill(0.1);
    for (const end of [m.durationSec, playLength(m, 'short')]) {
      for (const c of generateChart(m, 1, 22, end)) {
        expect(c.timeSec).toBeGreaterThanOrEqual(Math.max(4, m.beats[11])); expect(c.timeSec).toBeLessThan(tailStart(m, end)); expect((c.beatIndex - 3) % 4).toBe(0);
      }
    }
  });
  it('makes doubles on hot bar starts, in opposite columns', () => {
    const m = synthetic(100, 600); const doubles = generateChart(m, 2, 42).filter(c => c.cells.length === 2);
    expect(doubles.length).toBeGreaterThan(30);
    doubles.forEach(c => { expect(c.beatIndex % 4).toBe(0); expect(c.cells.map(v => v % 3).sort()).toEqual([0, 2]); });
    expect(generateChart(m, 1, 42).every(c => c.cells.length === 1 && !c.gesture)).toBe(true);
  });
  it('spaces gestures at least one second from the previous cue', () => {
    const chart = generateChart(synthetic(60, 600), 3, 7); expect(chart.some(c => c.gesture)).toBe(true);
    chart.forEach((c, i) => { if (c.gesture) { expect(c.cells).toHaveLength(1); if (i) expect(c.timeSec - chart[i - 1].timeSec).toBeGreaterThanOrEqual(1); } });
    expect(generateChart(synthetic(100), 3, 7).filter(c => c.gesture).every(c => C.gesturePool.includes(c.gesture!))).toBe(true);
  });
});
