import { describe, expect, it } from 'vitest';
import { generateChart } from './chart';
import { synthetic } from './fixtures';
import { shapeChangeShare, summariseChart } from './player';
import type { Cue } from './types';

describe('the chart summary', () => {
  it('counts a slide once, not its three cells, and counts every other cue once', () => {
    const song = synthetic(100, 600);
    const cues = generateChart(song, { level: 4, shapes: true, seed: 42, endSec: song.durationSec });
    const summary = summariseChart(cues, []);
    expect(summary.slides).toBe(cues.filter((cue) => cue.slideStep === 1).length);
    expect(summary.slides).toBeGreaterThan(20);
    expect(summary.taps + summary.doubles + 3 * summary.slides).toBe(cues.length);
    expect(summary.gestures).toBe(cues.filter((cue) => cue.shapes).length);
  });
});

describe('the share of shape changes', () => {
  /** A tap due at `timeSec` with these shapes, one for each of its cells. */
  const tap = (timeSec: number, shapes?: Cue['shapes']): Cue => ({
    timeSec,
    beatIndex: timeSec,
    cells: shapes?.length === 2 ? [0, 2] : [4],
    shapes,
  });

  it('counts each cue whose shapes differ from the cue before it', () => {
    expect(shapeChangeShare([tap(1, ['fist']), tap(2, ['open']), tap(3, ['fist']), tap(4, ['fist'])])).toBe(0.5);
  });

  it('counts a shape after a cue with none, and not a cue with none', () => {
    expect(shapeChangeShare([tap(1, ['fist']), tap(2), tap(3, ['fist']), tap(4)])).toBe(0.25);
  });

  it('compares the set of shapes that each cue asks for', () => {
    // A fist in both cells of a tap for two hands, then a fist in one cell: no change.
    expect(shapeChangeShare([tap(1, ['fist', 'fist']), tap(2, ['fist'])])).toBe(0);
    expect(shapeChangeShare([tap(1, ['fist', 'peace']), tap(2, ['peace', 'fist'])])).toBe(0);
    expect(shapeChangeShare([tap(1, ['fist']), tap(2, ['fist', 'peace'])])).toBe(0.5);
  });

  it('is 0 for a chart with no cues, or with no shapes', () => {
    expect(shapeChangeShare([])).toBe(0);
    expect(shapeChangeShare([tap(1), tap(2)])).toBe(0);
  });

  it('is higher at level 5 in a chart with shuffle phrases than in its steady phrases', () => {
    const song = synthetic(130, 600);
    const cues = generateChart(song, { level: 5, shapes: true, seed: 42, endSec: song.durationSec });
    const shuffles = cues.filter((cue) => cue.shuffle);
    const steady = cues.filter((cue) => !cue.shuffle);
    expect(shuffles.length).toBeGreaterThan(50);
    expect(shapeChangeShare(shuffles)).toBeGreaterThan(0.5);
    expect(shapeChangeShare(steady)).toBeLessThan(0.2);
  });
});
