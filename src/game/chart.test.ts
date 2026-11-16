import { describe, expect, it } from 'vitest';
import {
  chartEntries,
  countMoves,
  cuesFrom,
  doubleCells,
  entriesFrom,
  generateChart,
  masterCells,
  middleCell,
  phraseShapes,
  selectStride,
  slideTargets,
} from './chart';
import type { ChartEntry } from './chart';
import { CHART, LEVELS } from './config';
import { cuesBeyondTwoHands, synthetic } from './fixtures';
import { medianBeatInterval, playEndSec, tailStartSec } from './manifest';
import { phraseBeats } from './moves';
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

/** Checks that every tap for the other hand is one cell on its slide's middle beat, off the slide. */
function expectCompanionsBesideTheirSlides(cues: Cue[]): void {
  cues.forEach((cue, i) => {
    if (!isCompanion(cue, i, cues)) return;
    const slide = cues[i - 1];
    expect(cue.kind).toBe('tap');
    expect(cue.cells).toHaveLength(1);
    expect(cue.timeSec).toBe(slide.times[1]);
    expect(slide.cells).not.toContain(cue.cells[0]);
  });
}

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

describe('the role of each cue', () => {
  it('is the same chart as generateChart, with a role for every cue', () => {
    const song = synthetic(100, 600);
    for (const level of ALL_LEVELS) {
      const options = { level, shapes: true, seed: 7, endSec: song.durationSec };
      expect(chartEntries(song, options).map((entry) => entry.cue)).toEqual(generateChart(song, options));
    }
  });

  it.each([100, 128])('at %i BPM, names the off-beat taps and the taps for the other hand', (bpm) => {
    const entries = chartEntries(synthetic(bpm, 600), { level: 4, shapes: false, seed: 42, endSec: 600 });
    const cues = entries.map((entry) => entry.cue);
    const withRole = (role: string): Cue[] => entries.filter((entry) => entry.role === role).map((entry) => entry.cue);
    expect(withRole('offbeat').length).toBeGreaterThan(20);
    expect(withRole('companion')).toEqual(cues.filter((cue, i) => isCompanion(cue, i, cues)));
    // With a cue on every second beat, an off-beat tap sits on a whole beat: its index cannot tell.
    if (bpm === 128) expect(withRole('offbeat').every((cue) => Number.isInteger(cue.beatIndex))).toBe(true);
    else expect(withRole('offbeat')).toEqual(cues.filter(isOffbeat));
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
    // A long song, so the shares settle close to the chances. Each slide and each double is one
    // cue. A tap for the other hand during a slow slide sits on no cue beat of its own.
    const all = chart(synthetic(100, 1800), 3, 42);
    const many = all.filter((cue, i) => !isCompanion(cue, i, all));
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
    // The tap for the other hand during a slow slide is not such a cue: it belongs to the slide.
    const all = chart(synthetic(bpm, 600), 3, 42);
    const apart = all.filter((cue, i) => !isCompanion(cue, i, all));
    apart.forEach((cue, i) => {
      if (isSlide(cue) && i < apart.length - 1) expect(apart[i + 1].timeSec).toBeGreaterThan(lastTime(cue));
    });
  });

  it('gives the other hand a tap during about half of the slow slides, on the middle beat, off the slide', () => {
    const many = chart(synthetic(100, 1800), 3, 42);
    const slow = many.filter((cue) => cue.speed === 'slow');
    const companions = many.filter((cue, i) => isCompanion(cue, i, many));
    expect(companions.length / slow.length).toBeCloseTo(LEVELS[3].companionTapChance, 1);
    expectCompanionsBesideTheirSlides(many);
  });

  it.each([100, 128])('at %i BPM, keeps every other cue as it was before the level had taps for the other hand', (bpm) => {
    // The taps roll on a stream of their own. Without them, the chart is the one from before
    // level 3 had them: the chart with a tap chance of 0.
    const song = synthetic(bpm, 600);
    const withTaps = chart(song, 3, 42, { shapes: true });
    const rules = LEVELS[3];
    const chance = rules.companionTapChance;
    rules.companionTapChance = 0;
    let withoutTaps: Cue[];
    try {
      withoutTaps = chart(song, 3, 42, { shapes: true });
    } finally {
      rules.companionTapChance = chance;
    }
    const taps = withTaps.filter((cue, i) => isCompanion(cue, i, withTaps));
    expect(taps.length).toBeGreaterThan(5);
    expect(withTaps.filter((cue, i) => !isCompanion(cue, i, withTaps))).toEqual(withoutTaps);
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
    expectCompanionsBesideTheirSlides(many);
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

describe('two hands', () => {
  it.each([95, 100, 109, 130, 180])('are enough for every level at %i BPM', (bpm) => {
    for (const level of ALL_LEVELS) {
      const cues = chart(synthetic(bpm, 600), level, 42, { shapes: true });
      expect(cuesBeyondTwoHands(cues)).toEqual([]);
    }
  });

  it.each([95, 100, 109, 130, 180])('are enough at level 3 with its taps for the other hand, at %i BPM', (bpm) => {
    // The test above covers level 3 too. This one makes sure that its charts hold such taps.
    for (const seed of [42, 7, 2026]) {
      const cues = chart(synthetic(bpm, 600), 3, seed);
      expect(cues.some((cue, i) => isCompanion(cue, i, cues))).toBe(true);
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

describe('moves', () => {
  /** A song that is busy for 4 phrases, then calm for 2, then busy at a level between, in turn. */
  function changing(bpm: number): Manifest {
    const song = synthetic(bpm, 600);
    const pattern = [0.8, 0.8, 0.8, 0.8, 0.3, 0.3, 0.6, 0.6];
    song.intensity = song.beats.map((_, beat) => pattern[Math.floor(beat / 16) % pattern.length]);
    return song;
  }
  const SONGS_FOR_MOVES = [synthetic(95, 600), synthetic(100, 600), synthetic(128, 600), synthetic(180, 600), changing(100), changing(128)];

  function withMoves(
    manifest: Manifest,
    level: Level,
    moves: number,
    extra: { seed?: number; shapes?: boolean; endSec?: number; movesFromSec?: number } = {},
  ): ChartEntry[] {
    return chartEntries(manifest, {
      level,
      seed: extra.seed ?? 42,
      shapes: extra.shapes ?? false,
      endSec: extra.endSec ?? manifest.durationSec,
      moves,
      movesFromSec: extra.movesFromSec,
    });
  }

  /** The entries of each move, by the phrase it plays in. */
  function byPhrase(entries: ChartEntry[]): Map<number, ChartEntry[]> {
    const phrases = new Map<number, ChartEntry[]>();
    for (const entry of entries) {
      if (!entry.move) continue;
      const cues = phrases.get(entry.move.phrase) ?? [];
      cues.push(entry);
      phrases.set(entry.move.phrase, cues);
    }
    return phrases;
  }

  /** Each move as its phrase, its name and its first cell: the same move laid out the same way. */
  const moveKeys = (entries: ChartEntry[]): string[] =>
    [...byPhrase(entries)].map(([phrase, cues]) => `${phrase} ${cues[0].move?.name} ${cues[0].cue.cells[0]}`);

  it('leave a chart as it was with a share of 0: the same chart as with moves unset', () => {
    for (const song of [synthetic(100, 600), changing(128)]) {
      for (const level of ALL_LEVELS) {
        const unset = chartEntries(song, { level, shapes: true, seed: 7, endSec: song.durationSec });
        expect(withMoves(song, level, 0, { seed: 7, shapes: true, movesFromSec: 0 })).toEqual(unset);
        expect(unset.some((entry) => entry.role === 'move')).toBe(false);
      }
    }
  });

  it('give the same chart for the same options', () => {
    for (const level of ALL_LEVELS) {
      expect(withMoves(changing(100), level, 0.7, { shapes: true })).toEqual(withMoves(changing(100), level, 0.7, { shapes: true }));
    }
  });

  it('put the same move, laid out the same way, in the same phrases at all 5 levels', () => {
    for (const song of SONGS_FOR_MOVES) {
      for (const share of [0.35, 0.7, 1]) {
        const keys = ALL_LEVELS.map((level) => moveKeys(withMoves(song, level, share)));
        expect(keys[0].length).toBeGreaterThan(5);
        for (const levelKeys of keys) expect(levelKeys).toEqual(keys[0]);
      }
    }
  });

  it('hold a move in about the share of phrases in busy music, and never the same move twice in a row', () => {
    const song = synthetic(100, 1800);
    const cueing = song.beats.filter((_, beat) => beat % phraseBeats(song) === 0 && song.beats[beat] < tailStartSec(song, song.durationSec));
    for (const share of [0.35, 0.7]) {
      const phrases = [...byPhrase(withMoves(song, 3, share))];
      expect(phrases.length / cueing.length).toBeCloseTo(share, 1);
      phrases.slice(1).forEach(([phrase, cues], i) => {
        if (phrases[i][0] === phrase - 1) expect(cues[0].move?.name).not.toBe(phrases[i][1][0].move?.name);
      });
    }
  });

  it('start on the first beat of a phrase, in busy music, and end inside the phrase, clear of the last bar', () => {
    for (const song of SONGS_FOR_MOVES) {
      for (const endSec of [song.durationSec, playEndSec(song, 'short')]) {
        for (const level of ALL_LEVELS) {
          for (const [phrase, cues] of byPhrase(withMoves(song, level, 1, { endSec }))) {
            const firstBeat = song.firstDownbeat + phrase * phraseBeats(song);
            const nextPhraseSec = song.beats[firstBeat + phraseBeats(song)] ?? Infinity;
            expect(cues[0].cue.beatIndex).toBe(firstBeat);
            expect(song.intensity[firstBeat]).toBeGreaterThanOrEqual(CHART.busyIntensity);
            for (const { cue } of cues) {
              expect(lastTime(cue)).toBeLessThan(nextPhraseSec);
              expect(lastTime(cue)).toBeLessThan(tailStartSec(song, endSec));
            }
          }
        }
      }
    }
  });

  it('play 8 taps, or 4 taps where the phrase has room for 4 only, each at the pace of the level', () => {
    // At 128 BPM a phrase has 16 beats. Level 1 has a cue on every 4th beat: room for 4.
    // The other levels have a cue on every 2nd beat: room for 8.
    const song = synthetic(128, 600);
    const tailSec = tailStartSec(song, song.durationSec);
    for (const level of ALL_LEVELS) {
      for (const cues of byPhrase(withMoves(song, level, 1)).values()) {
        // A move in the phrase before the last bar ends there: the last bar has no cues.
        if ((song.beats[cues[0].cue.beatIndex + phraseBeats(song)] ?? Infinity) > tailSec) continue;
        const gaps = cues.slice(1).map((entry, i) => entry.cue.beatIndex - cues[i].cue.beatIndex);
        if (level === 1) expect(gaps).toEqual([4, 4, 4]);
        else expect(gaps).toEqual([2, 2, 2, 2, 2, 2, 2]);
      }
    }
  });

  it('are made of taps of one cell at every level', () => {
    for (const song of SONGS_FOR_MOVES) {
      for (const level of ALL_LEVELS) {
        const moveCues = withMoves(song, level, 1).filter((entry) => entry.role === 'move');
        expect(moveCues.length).toBeGreaterThan(10);
        for (const { cue } of moveCues) {
          expect(cue.cells).toHaveLength(1);
          expect(cue.times).toEqual([song.beats[cue.beatIndex]]);
        }
      }
    }
  });

  it.each([95, 100, 109, 130, 180])('need no more than two hands at any level at %i BPM', (bpm) => {
    for (const level of ALL_LEVELS) {
      for (const share of [0.35, 1]) {
        const cues = withMoves(synthetic(bpm, 600), level, share, { shapes: true }).map((entry) => entry.cue);
        expect(cuesBeyondTwoHands(cues)).toEqual([]);
      }
    }
  });

  it('take the place of the other cues: no off-beat taps, no taps for the other hand and no switch shapes inside a move', () => {
    for (const level of ALL_LEVELS) {
      const entries = withMoves(synthetic(100, 600), level, 1, { shapes: true });
      for (const cues of byPhrase(entries).values()) {
        const startSec = cues[0].cue.timeSec;
        const endSec = lastTime(cues[cues.length - 1].cue);
        const inside = entries.filter((entry) => entry.cue.timeSec >= startSec && entry.cue.timeSec <= endSec);
        expect(inside.every((entry) => entry.role === 'move')).toBe(true);
        if (level < 5) expect(cues.every((entry) => entry.cue.gesture === undefined)).toBe(true);
      }
    }
  });

  it('keep the phrase shape at a level with a shape on every cue', () => {
    const song = synthetic(100, 600);
    const shapes = phraseShapes(song, 42);
    const moveCues = withMoves(song, 5, 1).filter((entry) => entry.role === 'move');
    expect(moveCues.length).toBeGreaterThan(100);
    for (const { cue } of moveCues) expect(cue.gesture).toBe(shapes[cue.beatIndex]);
  });

  it('get a clear moment before them: no slide runs into a move, and no off-beat tap comes just before it', () => {
    // At 100 BPM a beat is 0.6 s: the cue before a move ends at least a beat before it.
    for (const level of ALL_LEVELS) {
      const entries = withMoves(synthetic(100, 600), level, 0.7);
      entries.forEach((entry, i) => {
        if (entry.role !== 'move' || i === 0 || entries[i - 1].role === 'move') return;
        expect(entries[i - 1].role).not.toBe('offbeat');
        expect(entry.cue.timeSec - lastTime(entries[i - 1].cue)).toBeGreaterThan(0.55);
      });
    }
  });

  it('start no move before the time the options give, and keep the later ones', () => {
    const song = synthetic(100, 600);
    const fromSec = 200;
    for (const level of ALL_LEVELS) {
      const all = withMoves(song, level, 0.7);
      const late = withMoves(song, level, 0.7, { movesFromSec: fromSec });
      const lateMoves = late.filter((entry) => entry.role === 'move');
      expect(lateMoves.every((entry) => entry.cue.timeSec >= fromSec)).toBe(true);
      expect(moveKeys(late)).toEqual(moveKeys(all).filter((key) => song.beats[Number(key.split(' ')[0]) * 16] >= fromSec));
    }
  });

  it('leave a round that starts inside the song without the rest of a move', () => {
    // The round passes its start plus the lead seconds, where its first cue may come.
    const song = synthetic(100, 600);
    const startSec = 100;
    for (const level of ALL_LEVELS) {
      const played = entriesFrom(withMoves(song, level, 1, { movesFromSec: startSec + CHART.leadSec }), startSec);
      for (const cues of byPhrase(played).values()) expect(cues[0].cue.beatIndex % phraseBeats(song)).toBe(0);
      expect(played[0].cue.timeSec).toBeGreaterThanOrEqual(startSec + CHART.leadSec);
    }
  });

  it('are counted by name, once each, however many cues they have', () => {
    const entries = withMoves(synthetic(100, 600), 3, 0.7);
    const phrases = [...byPhrase(entries).values()];
    const counts = countMoves(entries);
    expect(counts.point + counts.circle).toBe(phrases.length);
    expect(counts.point).toBe(phrases.filter((cues) => cues[0].move?.name === 'point').length);
    expect(counts.point).toBeGreaterThan(5);
    expect(counts.circle).toBeGreaterThan(5);
    expect(countMoves(withMoves(synthetic(100, 600), 3, 0))).toEqual({ point: 0, circle: 0 });
  });
});
