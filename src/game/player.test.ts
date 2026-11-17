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
  /** A tap due at `timeSec` on these cells, with these shapes, one for each cell. */
  const tap = (timeSec: number, cells: number[], shapes?: Cue['shapes']): Cue => ({
    timeSec,
    beatIndex: timeSec,
    cells,
    shapes,
  });
  // Cells 0 and 3 are in the left column, 2 and 5 in the right column, 1 and 4 in the centre.

  it('counts a cue at which a hand must make another shape than it made before', () => {
    const cues = [tap(1, [0], ['fist']), tap(2, [3], ['open']), tap(3, [0], ['fist']), tap(4, [3], ['fist'])];
    // The left hand makes a fist, then an open hand, then a fist: two changes in four cues.
    expect(shapeChangeShare(cues)).toBe(0.5);
  });

  it('lets each hand keep its own shape', () => {
    // The left hand makes fists, the right hand open hands: neither hand changes.
    const cues = [tap(1, [0], ['fist']), tap(2, [2], ['open']), tap(3, [3], ['fist']), tap(4, [5], ['open'])];
    expect(shapeChangeShare(cues)).toBe(0);
  });

  it('counts two shapes that swap hands, with one hand staying in its cell', () => {
    expect(shapeChangeShare([tap(1, [0, 2], ['peace', 'point']), tap(2, [0, 5], ['point', 'peace'])])).toBe(0.5);
  });

  it('counts no change for an off-beat tap with the shape of its own side', () => {
    const offbeatOnRight = tap(1.5, [5], ['point']);
    expect(shapeChangeShare([tap(1, [0, 2], ['peace', 'point']), offbeatOnRight])).toBe(0);
    const offbeatOnLeft = tap(1.5, [3], ['point']);
    expect(shapeChangeShare([tap(1, [0, 2], ['peace', 'point']), offbeatOnLeft])).toBe(0.5);
  });

  it('gives a centre cell to a hand that already makes its shape', () => {
    expect(shapeChangeShare([tap(1, [0, 2], ['fist', 'peace']), tap(2, [4], ['peace']), tap(3, [1], ['fist'])])).toBe(0);
    expect(shapeChangeShare([tap(1, [0, 2], ['fist', 'peace']), tap(2, [4], ['open'])])).toBe(0.5);
  });

  it('counts no change for one shape on two hands and then on one, nor for a cue with no shape', () => {
    expect(shapeChangeShare([tap(1, [0, 2], ['fist', 'fist']), tap(2, [4], ['fist']), tap(3, [1])])).toBe(0);
    // The first shape of a hand is no change, and a hand keeps its shape through a cue with none.
    expect(shapeChangeShare([tap(1, [0], ['fist']), tap(2, [3]), tap(3, [3], ['fist']), tap(4, [5], ['open'])])).toBe(0);
  });

  it('is 0 for a chart with no cues, or with no shapes', () => {
    expect(shapeChangeShare([])).toBe(0);
    expect(shapeChangeShare([tap(1, [0]), tap(2, [2])])).toBe(0);
  });

  it('is higher at level 5 in a chart with shuffle phrases than in its steady phrases', () => {
    const song = synthetic(130, 600);
    const cues = generateChart(song, { level: 5, shapes: true, seed: 42, endSec: song.durationSec });
    const shuffles = cues.filter((cue) => cue.shuffle);
    const steady = cues.filter((cue) => !cue.shuffle);
    expect(shuffles.length).toBeGreaterThan(50);
    expect(shapeChangeShare(shuffles)).toBeGreaterThan(1.5 * shapeChangeShare(steady));
  });
});
