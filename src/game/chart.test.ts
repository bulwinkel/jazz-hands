import { describe, expect, it } from 'vitest';
import {
  cuesFrom,
  doubleCells,
  generateChart,
  masterCells,
  middleCell,
  phraseShapes,
  selectStride,
  slideTargets,
} from './chart';
import { CHART, LEVELS } from './config';
import { synthetic } from './fixtures';
import { medianBeatInterval, playEndSec, tailStartSec } from './manifest';
import type { Cue, Level, Manifest } from './types';

const ALL_LEVELS: Level[] = [1, 2, 3, 4, 5];
/** Levels where hand shapes come from the player's switch, not from the level itself. */
const SWITCH_LEVELS: Level[] = [1, 2, 3, 4];
const column = (cell: number): number => cell % 3;
const isDouble = (cue: Cue): boolean => cue.kind === 'tap' && cue.cells.length === 2;
const isSlide = (cue: Cue): boolean => cue.kind === 'slide';
/** An extra tap between two cue beats. Its beat index is fractional. */
const isOffbeat = (cue: Cue): boolean => !Number.isInteger(cue.beatIndex);
const lastTime = (cue: Cue): number => cue.times[cue.times.length - 1];
/** A tap for the other hand during a slow slide: it is due before the slide before it ends. */
const isCompanion = (cue: Cue, i: number, cues: Cue[]): boolean =>
  i > 0 && cues[i - 1].speed === 'slow' && cue.timeSec < lastTime(cues[i - 1]);

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
      const singles = chart(song, level, 7).filter(
        (cue, i, cues) => cue.kind === 'tap' && cue.cells.length === 1 && !isOffbeat(cue) && !isCompanion(cue, i, cues),
      );
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
    for (const endSec of [song.durationSec, playEndSec(song, 'short')]) {
      const cues = chart(song, 2, 22, { endSec });
      expect(cues.length).toBeGreaterThan(10);
      for (const cue of cues) {
        expect(cue.timeSec).toBeGreaterThanOrEqual(Math.max(CHART.leadSec, twoBarsIn));
        expect(cue.timeSec).toBeLessThan(tailStartSec(song, endSec));
      }
    }
  });
});

describe('a round that starts inside the song', () => {
  const cues = chart(synthetic(100, 300), 3, 9);

  it('keeps every cue when it starts at the song start', () => {
    expect(cuesFrom(cues, 0)).toBe(cues);
  });

  it('leaves out the cues of the first seconds, so players can find the beat', () => {
    const late = cuesFrom(cues, 120);
    expect(late.length).toBeGreaterThan(50);
    expect(late[0].timeSec).toBeGreaterThanOrEqual(120 + CHART.leadSec);
    // The rest of the song is unchanged: the same cues as in a round from the start.
    expect(late).toEqual(cues.filter((cue) => cue.timeSec >= 120 + CHART.leadSec));
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

  it('has normal and slow slides, and no fast ones', () => {
    const speeds = new Set(cues.filter(isSlide).map((cue) => cue.speed));
    expect(speeds).toEqual(new Set(['normal', 'slow']));
  });

  it('runs a normal slide across the grid from one beat to the next', () => {
    const slides = cues.filter((cue) => cue.speed === 'normal');
    expect(slides.length).toBeGreaterThan(50);
    for (const cue of slides) {
      const [from, to] = cue.cells;
      expect(cue.cells).toHaveLength(2);
      expect(slideTargets(from)).toContain(to);
      expect(cue.times).toEqual([song.beats[cue.beatIndex], song.beats[cue.beatIndex + 1]]);
    }
  });

  it('runs a slow slide through the middle cell, one cell per beat', () => {
    const slides = cues.filter((cue) => cue.speed === 'slow');
    expect(slides.length).toBeGreaterThan(20);
    for (const cue of slides) {
      const [from, middle, to] = cue.cells;
      expect(cue.cells).toHaveLength(3);
      expect(slideTargets(from)).toContain(to);
      expect(middle).toBe(middleCell(from, to));
      expect(cue.times).toEqual([0, 1, 2].map((step) => song.beats[cue.beatIndex + step]));
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
    // At 128 BPM a beat is 0.47 s, so cues sit on every second beat and a normal slide spans two beats.
    const fastSong = synthetic(128, 600);
    const slides = chart(fastSong, 3, 42).filter(isSlide);
    expect(slides.length).toBeGreaterThan(30);
    for (const cue of slides) {
      const steps = cue.speed === 'slow' ? [0, 2, 4] : [0, 2];
      expect(cue.times).toEqual(steps.map((step) => fastSong.beats[cue.beatIndex + step]));
    }
  });

  it.each([100, 128])('at %i BPM, starts the next cue only after a slide has ended', (bpm) => {
    const all = chart(synthetic(bpm, 600), 3, 42);
    all.forEach((cue, i) => {
      if (isSlide(cue) && i < all.length - 1) expect(all[i + 1].timeSec).toBeGreaterThan(lastTime(cue));
    });
  });
});

describe('level 4', () => {
  const song = synthetic(100, 600);
  const cues = chart(song, 4, 42);
  const beatSec = 0.6;

  it('has slides at all three speeds', () => {
    const speeds = new Set(cues.filter(isSlide).map((cue) => cue.speed));
    expect(speeds).toEqual(new Set(['fast', 'normal', 'slow']));
  });

  it('runs a fast slide in half a beat, then leaves the rest of that beat and the next one free', () => {
    const fast = cues.filter((cue) => cue.speed === 'fast');
    expect(fast.length).toBeGreaterThan(30);
    for (const cue of fast) {
      expect(cue.cells).toHaveLength(2);
      expect(cue.times[1] - cue.times[0]).toBeCloseTo(beatSec / 2);
    }
    cues.forEach((cue, i) => {
      if (cue.speed !== 'fast' || i === cues.length - 1) return;
      expect(cues[i + 1].timeSec - lastTime(cue)).toBeGreaterThan(1.4 * beatSec);
    });
  });

  it('adds off-beat taps halfway between two cue beats, after taps only', () => {
    const offbeats = cues.filter(isOffbeat);
    expect(offbeats.length).toBeGreaterThan(50);
    cues.forEach((cue, i) => {
      if (!isOffbeat(cue)) return;
      const before = cues[i - 1];
      expect(cue.kind).toBe('tap');
      expect(cue.cells).toHaveLength(1);
      expect(cue.gesture).toBeUndefined();
      expect(before.kind).toBe('tap');
      expect(cue.timeSec - before.timeSec).toBeCloseTo(beatSec / 2);
      expect(before.cells).not.toContain(cue.cells[0]);
    });
  });

  it('gives every slide a clear moment: no cue within a cue interval before it or after it', () => {
    // A real round showed that a tap 0.3 s after a fast slide, or an off-beat tap 0.3 s before
    // a slide, cannot be played. The tap for the other hand during a slow slide is not such a
    // cue: it sits on the slide's own middle beat.
    const apart = cues.filter((cue, i) => !isCompanion(cue, i, cues));
    apart.forEach((cue, i) => {
      if (!isSlide(cue)) return;
      if (i > 0) expect(cue.timeSec - lastTime(apart[i - 1])).toBeGreaterThan(0.9 * beatSec);
      if (i < apart.length - 1) expect(apart[i + 1].timeSec - lastTime(cue)).toBeGreaterThan(0.9 * beatSec);
    });
  });

  it('gives the other hand a tap during most slow slides, on the middle beat, off the slide', () => {
    const many = chart(synthetic(100, 1800), 4, 42);
    const slow = many.filter((cue) => cue.speed === 'slow');
    const companions = many.filter((cue, i) => isCompanion(cue, i, many));
    expect(companions.length / slow.length).toBeCloseTo(LEVELS[4].companionTapChance, 1);
    many.forEach((cue, i) => {
      if (!isCompanion(cue, i, many)) return;
      const slide = many[i - 1];
      expect(cue.kind).toBe('tap');
      expect(cue.cells).toHaveLength(1);
      expect(cue.timeSec).toBe(slide.times[1]);
      expect(slide.cells).not.toContain(cue.cells[0]);
    });
  });

  it('leaves level 3 without taps during slides', () => {
    const level3 = chart(synthetic(100, 600), 3, 42);
    expect(level3.some((cue, i) => isCompanion(cue, i, level3))).toBe(false);
  });

  it('follows its single taps with an off-beat tap as often as the level rules say', () => {
    // Only a single tap leaves a hand free for an off-beat tap: a double uses both hands.
    const many = chart(synthetic(100, 1800), 4, 42);
    const singles = many.filter(
      (cue, i) => cue.kind === 'tap' && cue.cells.length === 1 && !isOffbeat(cue) && !isCompanion(cue, i, many),
    );
    expect(many.filter(isOffbeat).length / singles.length).toBeCloseTo(LEVELS[4].offbeatChance, 1);
  });

  it('keeps cues in time order', () => {
    cues.slice(1).forEach((cue, i) => expect(cue.timeSec).toBeGreaterThan(cues[i].timeSec));
  });
});

/**
 * Checks a chart against two hands, with its own bookkeeping: every cue cell must find a hand
 * that has had `CHART.handRestSec` since its last target. A slide is one hand's move.
 * Returns the cues that do not fit.
 */
function cuesBeyondTwoHands(cues: Cue[]): Cue[] {
  const lastTargetSec = [-Infinity, -Infinity];
  const takeFreeHand = (atSec: number, untilSec: number): boolean => {
    const hand = lastTargetSec.findIndex((last) => atSec - last >= CHART.handRestSec - 1e-8);
    if (hand === -1) return false;
    lastTargetSec[hand] = untilSec;
    return true;
  };
  return cues.filter((cue) => {
    if (cue.kind === 'slide') return !takeFreeHand(cue.timeSec, lastTime(cue));
    const fits = cue.cells.map(() => takeFreeHand(cue.timeSec, cue.timeSec));
    return fits.includes(false);
  });
}

describe('two hands', () => {
  it.each([95, 100, 109, 130, 180])('are enough for every level at %i BPM', (bpm) => {
    for (const level of ALL_LEVELS) {
      const cues = chart(synthetic(bpm, 600), level, 42, { shapes: true });
      expect(cuesBeyondTwoHands(cues)).toEqual([]);
    }
  });

  it('are not asked for an off-beat tap straight after a double, or a double after an off-beat tap', () => {
    const cues = chart(synthetic(100, 1800), 4, 42);
    cues.forEach((cue, i) => {
      if (!isOffbeat(cue)) return;
      expect(isDouble(cues[i - 1])).toBe(false);
      if (i < cues.length - 1) expect(isDouble(cues[i + 1])).toBe(false);
    });
  });
});

describe('level 5', () => {
  const song = synthetic(100, 600);
  const cues = chart(song, 5, 42);

  it('asks for a hand shape on every cue, whatever the switch says', () => {
    expect(cues.length).toBeGreaterThan(500);
    for (const cue of cues) expect(CHART.gesturePool).toContain(cue.gesture);
    expect(chart(song, 5, 42, { shapes: true })).toEqual(cues);
  });

  it('has the same cues as level 4, plus the shapes', () => {
    const withoutShapes = cues.map(({ gesture: _shape, ...cue }) => cue);
    expect(withoutShapes).toEqual(chart(song, 4, 42));
  });

  it('keeps one shape for at least 4 seconds, changes it on a bar start, and never repeats it', () => {
    const shapes = phraseShapes(song, 42);
    const changes = shapes.flatMap((shape, beat) => (beat > 0 && shape !== shapes[beat - 1] ? [beat] : []));
    expect(changes.length).toBeGreaterThan(50);
    changes.forEach((beat, i) => {
      expect(beat % song.beatsPerBar).toBe(0);
      const previousChange = i > 0 ? changes[i - 1] : 0;
      expect(song.beats[beat] - song.beats[previousChange]).toBeGreaterThanOrEqual(CHART.shapePhraseSec - 1e-8);
    });
  });

  it('uses every shape of the pool', () => {
    expect(new Set(cues.map((cue) => cue.gesture))).toEqual(new Set(CHART.gesturePool));
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

  it('finds the cell a slow slide passes through', () => {
    expect(middleCell(0, 2)).toBe(1);
    expect(middleCell(0, 8)).toBe(4);
    expect(middleCell(1, 7)).toBe(4);
    expect(middleCell(6, 8)).toBe(7);
  });

  it('moves a centre-column double to a side and puts the partner on the other side', () => {
    expect(doubleCells(4, 0.2, 0)).toEqual([3, 2]);
    expect(doubleCells(4, 0.8, 0.99)).toEqual([5, 6]);
    expect(doubleCells(6, 0.8, 0.5)).toEqual([6, 5]);
  });
});

describe('hand shapes', () => {
  it('appear at no level with a switch when it is off', () => {
    for (const level of SWITCH_LEVELS) {
      expect(chart(synthetic(100, 600), level, 7).some((cue) => cue.gesture)).toBe(false);
    }
  });

  it('appear at every level with a switch when it is on, only on single taps, from the pool', () => {
    for (const level of SWITCH_LEVELS) {
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
