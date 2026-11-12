import { describe, expect, it } from 'vitest';
import { doubleCells, generateChart, masterCells, selectStride, slideTargets } from './chart';
import { CHART, LEVELS } from './config';
import { synthetic } from './fixtures';
import { medianBeatInterval, playLengthSec, tailStartSec } from './manifest';
import type { Cue, Level, Manifest } from './types';

const ALL_LEVELS: Level[] = [1, 2, 3];
const column = (cell: number): number => cell % 3;
const isDouble = (cue: Cue): boolean => cue.kind === 'tap' && cue.cells.length === 2;
const isSlide = (cue: Cue): boolean => cue.kind === 'slide';

function chart(
  manifest: Manifest,
  level: Level,
  seed: number,
  extra: { shapes?: boolean; endSec?: number } = {},
): Cue[] {
  return generateChart(manifest, {
    level,
    seed,
    shapes: extra.shapes ?? false,
    endSec: extra.endSec ?? manifest.durationSec,
  });
}

describe('master cells', () => {
  it('gives the same cells for the same seed and other cells for another seed', () => {
    const song = synthetic();
    expect(masterCells(song, 4)).toEqual(masterCells(song, 4));
    expect(masterCells(song, 4)).not.toEqual(masterCells(song, 5));
  });

  it('never repeats a cell within four beats', () => {
    const cells = masterCells(synthetic(), 4);
    cells.forEach((cell, beat) => {
      expect(cells.slice(Math.max(0, beat - CHART.recentCells), beat)).not.toContain(cell);
    });
  });
});

describe('chart for every level', () => {
  it('is the same for the same options', () => {
    const song = synthetic();
    for (const level of ALL_LEVELS) {
      expect(chart(song, level, 4, { shapes: true })).toEqual(chart(song, level, 4, { shapes: true }));
    }
  });

  it('puts every single tap on the master cell of its beat, so levels move together', () => {
    const song = synthetic();
    const master = masterCells(song, 7);
    for (const level of ALL_LEVELS) {
      const singles = chart(song, level, 7).filter((cue) => cue.kind === 'tap' && cue.cells.length === 1);
      expect(singles.length).toBeGreaterThan(10);
      for (const cue of singles) expect(cue.cells[0]).toBe(master[cue.beatIndex]);
    }
  });

  it('gives every cell a due time, in time order', () => {
    const song = synthetic(100, 600);
    for (const level of ALL_LEVELS) {
      const cues = chart(song, level, 11, { shapes: true });
      cues.forEach((cue, i) => {
        expect(cue.times).toHaveLength(cue.cells.length);
        expect(cue.times[0]).toBe(cue.timeSec);
        if (i > 0) expect(cue.timeSec).toBeGreaterThan(cues[i - 1].timeSec);
      });
    }
  });

  it.each([
    [60, 2, 1],
    [100, 2, 1],
    [128, 4, 2],
    [180, 4, 2],
  ])('at %i BPM uses a stride of %i for slow cues and %i for fast cues', (bpm, slow, fast) => {
    const interval = medianBeatInterval(synthetic(bpm));
    expect(selectStride(interval, CHART.slowIntervalSec)).toBe(slow);
    expect(selectStride(interval, CHART.fastIntervalSec)).toBe(fast);
  });

  it('keeps the lead-in and the last bar free of cues, for both song lengths', () => {
    const song = synthetic();
    song.firstDownbeat = 3;
    const twoBarsIn = song.beats[3 + 2 * 4];
    for (const endSec of [song.durationSec, playLengthSec(song, 'short')]) {
      const cues = chart(song, 2, 22, { endSec });
      expect(cues.length).toBeGreaterThan(10);
      for (const cue of cues) {
        expect(cue.timeSec).toBeGreaterThanOrEqual(Math.max(CHART.leadSec, twoBarsIn));
        expect(cue.timeSec).toBeLessThan(tailStartSec(song, endSec));
      }
    }
  });
});

describe('level 1', () => {
  it('has single taps only', () => {
    const cues = chart(synthetic(100, 600), 1, 42);
    expect(cues.every((cue) => cue.kind === 'tap' && cue.cells.length === 1)).toBe(true);
  });

  it('thins out to every fourth beat in quiet music, counted from the first bar start', () => {
    const quiet = synthetic(100, 120, 0.1);
    quiet.firstDownbeat = 3;
    const cues = chart(quiet, 1, 22);
    expect(cues.length).toBeGreaterThan(5);
    for (const cue of cues) expect((cue.beatIndex - 3) % 4).toBe(0);
  });
});

describe('level 2', () => {
  it('makes doubles only on busy bar starts, one hand per side, and no slides', () => {
    const cues = chart(synthetic(100, 600), 2, 42);
    const doubles = cues.filter(isDouble);
    expect(doubles.length).toBeGreaterThan(30);
    for (const cue of doubles) {
      expect(cue.beatIndex % 4).toBe(0);
      expect(cue.cells.map(column).sort()).toEqual([0, 2]);
    }
    expect(cues.some(isSlide)).toBe(false);
  });

  it('keeps to every second beat until the music is busy', () => {
    const cues = chart(synthetic(100, 120, 0.4), 2, 5);
    cues.slice(1).forEach((cue, i) => expect(cue.beatIndex - cues[i].beatIndex).toBe(2));
  });
});

describe('level 3', () => {
  const song = synthetic(100, 600);
  const cues = chart(song, 3, 42);

  it('has a cue on every beat once the music picks up, before doubles and slides begin', () => {
    const warm = chart(synthetic(100, 120, 0.4), 3, 5);
    expect(warm.length).toBeGreaterThan(50);
    warm.slice(1).forEach((cue, i) => expect(cue.beatIndex - warm[i].beatIndex).toBe(1));
    expect(warm.every((cue) => cue.kind === 'tap' && cue.cells.length === 1)).toBe(true);
  });

  it('makes doubles on any beat, one hand per side', () => {
    const doubles = cues.filter(isDouble);
    expect(doubles.length).toBeGreaterThan(100);
    expect(doubles.some((cue) => cue.beatIndex % 4 !== 0)).toBe(true);
    for (const cue of doubles) expect(cue.cells.map(column).sort()).toEqual([0, 2]);
  });

  it('runs each slide across the grid from one beat to the next', () => {
    const slides = cues.filter(isSlide);
    expect(slides.length).toBeGreaterThan(50);
    for (const cue of slides) {
      const [from, to] = cue.cells;
      expect(slideTargets(from)).toContain(to);
      expect(cue.times).toEqual([song.beats[cue.beatIndex], song.beats[cue.beatIndex + 1]]);
    }
  });

  it('makes slides and doubles in the shares the level rules give', () => {
    // A long song, so the shares settle close to the chances. Each slide and each double is one cue.
    const many = chart(synthetic(100, 1800), 3, 42);
    const share = (matches: (cue: Cue) => boolean): number => many.filter(matches).length / many.length;
    expect(share(isSlide)).toBeCloseTo(LEVELS[3].slideChance, 1);
    expect(share(isDouble)).toBeCloseTo(LEVELS[3].doubleChance, 1);
  });

  it('runs each slide to the next cue beat in a song too fast for a cue on every beat', () => {
    // At 128 BPM a beat is 0.47 s, so cues sit on every second beat and a slide spans two beats.
    const fastSong = synthetic(128, 600);
    const fast = chart(fastSong, 3, 42);
    const slides = fast.filter(isSlide);
    expect(slides.length).toBeGreaterThan(30);
    for (const cue of slides) {
      expect(cue.times).toEqual([fastSong.beats[cue.beatIndex], fastSong.beats[cue.beatIndex + 2]]);
    }
    fast.forEach((cue, i) => {
      if (isSlide(cue) && i < fast.length - 1) expect(fast[i + 1].beatIndex).toBeGreaterThanOrEqual(cue.beatIndex + 4);
    });
  });

  it('leaves the beat a slide ends on free, so no slide starts where another ends', () => {
    cues.forEach((cue, i) => {
      if (!isSlide(cue) || i === cues.length - 1) return;
      expect(cues[i + 1].beatIndex).toBeGreaterThanOrEqual(cue.beatIndex + 2);
    });
  });
});

describe('slide and double geometry', () => {
  it('lets a slide end two steps away along a row, column or diagonal', () => {
    expect(slideTargets(0)).toEqual([2, 6, 8]);
    expect(slideTargets(8)).toEqual([0, 2, 6]);
    expect(slideTargets(1)).toEqual([7]);
    expect(slideTargets(3)).toEqual([5]);
  });

  it('lets a slide from the centre end on any other cell', () => {
    expect(slideTargets(4)).toEqual([0, 1, 2, 3, 5, 6, 7, 8]);
  });

  it('moves a centre-column double to a side and puts the partner on the other side', () => {
    expect(doubleCells(4, 0.2, 0)).toEqual([3, 2]);
    expect(doubleCells(4, 0.8, 0.99)).toEqual([5, 6]);
    expect(doubleCells(6, 0.8, 0.5)).toEqual([6, 5]);
  });
});

describe('hand shapes', () => {
  it('appear at no level when switched off', () => {
    for (const level of ALL_LEVELS) {
      expect(chart(synthetic(100, 600), level, 7).some((cue) => cue.gesture)).toBe(false);
    }
  });

  it('appear at every level when switched on, only on single taps, from the pool', () => {
    for (const level of ALL_LEVELS) {
      const shaped = chart(synthetic(100, 600), level, 7, { shapes: true }).filter((cue) => cue.gesture);
      expect(shaped.length).toBeGreaterThan(20);
      for (const cue of shaped) {
        expect(cue.kind).toBe('tap');
        expect(cue.cells).toHaveLength(1);
        expect(CHART.gesturePool).toContain(cue.gesture);
      }
    }
  });

  it.each([60, 100, 109, 128, 180])(
    'at %i BPM, never follow the previous cue faster than a hand can change shape',
    (bpm) => {
      // The gap counts from the end of the previous cue, so it also covers a tap after a slide.
      const cues = chart(synthetic(bpm, 600), 3, 7, { shapes: true });
      expect(cues.some((cue) => cue.gesture)).toBe(true);
      cues.forEach((cue, i) => {
        if (!cue.gesture || i === 0) return;
        const previousEnd = cues[i - 1].times[cues[i - 1].times.length - 1];
        expect(cue.timeSec - previousEnd).toBeGreaterThanOrEqual(CHART.gestureGapSec - 1e-8);
      });
    },
  );

  it('can come straight after a slide when the beat leaves enough time', () => {
    // At 100 BPM a beat is 0.6 s, longer than the gap a hand needs. This also proves that
    // the gap test above sees taps that follow slides.
    const cues = chart(synthetic(100, 600), 3, 7, { shapes: true });
    const afterSlides = cues.filter((cue, i) => i > 0 && cue.gesture && cues[i - 1].kind === 'slide');
    expect(afterSlides.length).toBeGreaterThan(0);
  });
});
