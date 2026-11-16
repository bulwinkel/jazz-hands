/// <reference types="node" />
import { readFileSync } from 'node:fs';
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
import { CHART, DEFAULT_SEED, LEVELS, SONGS } from './config';
import { candidateSeeds, cueSetMoveShare } from './cueSet';
import { cuesBeyondTwoHands, synthetic } from './fixtures';
import { leadInEndSec, medianBeatInterval, playEndSec, playStartSec, tailStartSec, validateManifest } from './manifest';
import { phraseBeats } from './moves';
import type { Cue, Level, Manifest } from './types';

const ALL_LEVELS: Level[] = [1, 2, 3, 4, 5];
/** The manifests of every song in `SONGS`, in order. */
const SONG_MANIFESTS = SONGS.map((song) => validateManifest(JSON.parse(readFileSync(`public${song.manifest}`, 'utf8'))));
/** Levels where hand shapes come from the player's switch, not from the level itself. */
const SWITCH_LEVELS: Level[] = [1, 2, 3, 4];
const column = (cell: number): number => cell % 3;
const row = (cell: number): number => Math.floor(cell / 3);
const isDouble = (cue: Cue): boolean => cue.cells.length === 2;
const startsSlide = (cue: Cue): boolean => cue.slideStep === 1;
const inSlide = (cue: Cue): boolean => cue.slideStep !== undefined;
/** A cue that a roll of its cue beat chose: not the second or third cell of a slide. */
const rolled = (cue: Cue): boolean => (cue.slideStep ?? 1) === 1;
/** An extra tap between two cue beats. Its beat index is fractional. */
const isOffbeat = (cue: Cue): boolean => !Number.isInteger(cue.beatIndex);

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

  it('puts every single tap and the first cell of every slide on the master cell of its beat, so levels move together', () => {
    const song = synthetic();
    const master = masterCells(song, 7);
    for (const level of ALL_LEVELS) {
      const singles = chart(song, level, 7).filter((cue) => cue.cells.length === 1 && !isOffbeat(cue) && rolled(cue));
      expect(singles.length).toBeGreaterThan(10);
      for (const cue of singles) expect(cue.cells[0]).toBe(master[cue.beatIndex]);
    }
  });

  it('gives every cue a due time, in time order', () => {
    const song = synthetic(100, 600);
    for (const level of ALL_LEVELS) {
      const cues = chart(song, level, 11, { shapes: true });
      cues.forEach((cue, i) => {
        expect(Number.isFinite(cue.timeSec)).toBe(true);
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

  it.each([100, 128])('at %i BPM, names the off-beat taps', (bpm) => {
    const entries = chartEntries(synthetic(bpm, 600), { level: 4, shapes: false, seed: 42, endSec: 600 });
    const cues = entries.map((entry) => entry.cue);
    const withRole = (role: string): Cue[] => entries.filter((entry) => entry.role === role).map((entry) => entry.cue);
    expect(withRole('offbeat').length).toBeGreaterThan(20);
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
    // The rest of the song is unchanged: the same cues as in a round from the start. Here the
    // cut falls inside a slide, and its end cell at 124.2 s goes with the rest of it.
    const firstSec = 120 + CHART.leadSec;
    /** When the slide of a cue starts, or the cue itself when it is no part of a slide. */
    const slideStartSec = (i: number): number => {
      const stepsBack = (cues[i].slideStep ?? 1) - 1;
      return cues[i - stepsBack].timeSec;
    };
    const expected = cues.filter((cue, i) => cue.timeSec >= firstSec && slideStartSec(i) >= firstSec);
    expect(cues.some((cue) => cue.timeSec === 124.2 && cue.slideStep === 3)).toBe(true);
    expect(late).toEqual(expected);
  });

  /** Checks that every cue of a slide has the other two cues of its slide next to it, in order. */
  function expectWholeSlides(cues: readonly Cue[]): void {
    cues.forEach((cue, i) => {
      const before = cues[i - 1]?.slideStep;
      const after = [cues[i + 1]?.slideStep, cues[i + 2]?.slideStep];
      if (cue.slideStep === 1) expect(after).toEqual([2, 3]);
      if (cue.slideStep === 2) expect(before).toBe(1);
      if (cue.slideStep === 3) expect(before).toBe(2);
    });
  }

  /** The cues that a Short round of one player plays, with the moves of a cue set. */
  function shortRound(song: Manifest, level: Level, seed: number, set: number): { all: Cue[]; played: Cue[] } {
    const startSec = playStartSec(song, 'short');
    const options = {
      level,
      shapes: false,
      seed,
      endSec: playEndSec(song, 'short'),
      moves: cueSetMoveShare(set),
      movesFromSec: startSec + CHART.leadSec,
    };
    const entries = chartEntries(song, options);
    const played = entriesFrom(entries, startSec);
    return { all: entries.map((entry) => entry.cue), played: played.map((entry) => entry.cue) };
  }

  it('keeps or drops a slide as a whole: the Short round of Todo Bueno at level 3, set 4', () => {
    // The cut at 136.802 s once fell inside a slide, and kept only its end cell, at 136.920 s.
    const song = SONG_MANIFESTS[SONGS.findIndex((entry) => entry.manifest === '/songs/todo-bueno.json')];
    const { all, played } = shortRound(song, 3, 20265329, 4);
    const cutSec = playStartSec(song, 'short') + CHART.leadSec;
    expect(cutSec).toBeCloseTo(136.802, 3);
    const start = all.findIndex((cue) => cue.slideStep === 1 && cue.timeSec >= cutSec - 2);
    const cutSlide = all.slice(start, start + 3);
    expect(cutSlide[0].timeSec).toBeLessThan(cutSec);
    expect(cutSlide[2].timeSec).toBeCloseTo(136.9204, 4);
    expect(played.filter((cue) => cutSlide.includes(cue))).toEqual([]);
    expect(played[0].slideStep).toBe(1);
    expectWholeSlides(played);
  });

  it('never starts with the rest of a slide, in the Short round of every song at levels 3 to 5', () => {
    let cutSlides = 0;
    for (const song of SONG_MANIFESTS) {
      const cutSec = playStartSec(song, 'short') + CHART.leadSec;
      for (const level of [3, 4, 5] as Level[]) {
        for (const seed of candidateSeeds(4)) {
          const { all, played } = shortRound(song, level, seed, 4);
          expectWholeSlides(played);
          const cutInside = (cue: Cue, i: number): boolean => {
            if (cue.slideStep !== 1) return false;
            return cue.timeSec < cutSec && all[i + 2].timeSec >= cutSec;
          };
          const roundStartsInside = cutSec > CHART.leadSec;
          if (roundStartsInside && all.some(cutInside)) cutSlides++;
        }
      }
    }
    // The cut falls inside a slide in some of these charts, so the test sees the case.
    expect(cutSlides).toBeGreaterThan(20);
  });
});

describe('level 1', () => {
  it('has single taps only', () => {
    const cues = chart(synthetic(100, 600), 1, 42);
    expect(cues.every((cue) => cue.cells.length === 1 && !inSlide(cue))).toBe(true);
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
    expect(cues.some(inSlide)).toBe(false);
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
    expect(warm.every((cue) => cue.cells.length === 1 && !inSlide(cue))).toBe(true);
  });

  it('makes doubles on any beat, one hand per side', () => {
    const doubles = cues.filter(isDouble);
    expect(doubles.length).toBeGreaterThan(100);
    expect(doubles.some((cue) => cue.beatIndex % 4 !== 0)).toBe(true);
    for (const cue of doubles) expect(cue.cells.map(column).sort()).toEqual([0, 2]);
  });

  it('makes a slide three taps in a line, from the master cell of its beat, one cell on each of three beats in a row', () => {
    const slides = cues.filter(startsSlide);
    expect(slides.length).toBeGreaterThan(50);
    for (const first of slides) {
      const i = cues.indexOf(first);
      const [, middle, end] = cues.slice(i, i + 3);
      const [from, to] = [first.cells[0], end.cells[0]];
      expect([middle.slideStep, end.slideStep]).toEqual([2, 3]);
      expect(slideTargets(from)).toContain(to);
      expect(middle.cells).toEqual([middleCell(from, to)]);
      expect([middle.beatIndex, end.beatIndex]).toEqual([first.beatIndex + 1, first.beatIndex + 2]);
      for (const cue of [first, middle, end]) expect(cue.timeSec).toBe(song.beats[cue.beatIndex]);
    }
  });

  it('makes slides and doubles in the shares the level rules give, a little under them in slides', () => {
    // A long song, so the shares settle close to the chances. The shares count the cues that a
    // roll chose: a slide counts once, by its first cell. No slide starts in the centre cell.
    const many = chart(synthetic(100, 1800), 3, 42).filter(rolled);
    const share = (matches: (cue: Cue) => boolean): number => many.filter(matches).length / many.length;
    expect(share(startsSlide)).toBeLessThan(LEVELS[3].slideChance);
    expect(share(startsSlide)).toBeCloseTo(LEVELS[3].slideChance, 1);
    expect(share(isDouble)).toBeCloseTo(LEVELS[3].doubleChance, 1);
  });

  it('puts the cells of a slide on every second beat in a song too fast for a cue on every beat', () => {
    // At 128 BPM a beat is 0.47 s, so cues sit on every second beat.
    const fastSong = synthetic(128, 600);
    const all = chart(fastSong, 3, 42);
    const slides = all.filter(startsSlide);
    expect(slides.length).toBeGreaterThan(30);
    for (const first of slides) {
      const i = all.indexOf(first);
      expect(all.slice(i, i + 3).map((cue) => cue.beatIndex - first.beatIndex)).toEqual([0, 2, 4]);
    }
  });

  it.each([
    [100, 1],
    [128, 2],
  ])('at %i BPM, puts no other cue inside a slide: the next one comes %i beats after its end at the earliest', (bpm, stride) => {
    const all = chart(synthetic(bpm, 600), 3, 42);
    all.forEach((cue, i) => {
      if (cue.slideStep !== 3 || i === all.length - 1) return;
      expect(all[i - 1].slideStep).toBe(2);
      expect(all[i - 2].slideStep).toBe(1);
      expect(all[i + 1].beatIndex - cue.beatIndex).toBeGreaterThanOrEqual(stride);
    });
  });
});

describe('level 4', () => {
  const song = synthetic(100, 600);
  const cues = chart(song, 4, 42);
  const beatSec = 0.6;

  it('adds off-beat taps halfway between two cue beats, after taps only, never after a cell of a slide', () => {
    const offbeats = cues.filter(isOffbeat);
    expect(offbeats.length).toBeGreaterThan(50);
    cues.forEach((cue, i) => {
      if (!isOffbeat(cue)) return;
      const before = cues[i - 1];
      expect(cue.cells).toHaveLength(1);
      expect(cue.shapes).toBeUndefined();
      expect(inSlide(before)).toBe(false);
      expect(cue.timeSec - before.timeSec).toBeCloseTo(beatSec / 2);
      expect(before.cells).not.toContain(cue.cells[0]);
    });
  });

  it('gives every slide a clear moment: no cue within a cue interval before it or after it', () => {
    // A real round showed that an off-beat tap 0.3 s before a slide cannot be played.
    expect(cues.filter(startsSlide).length).toBeGreaterThan(50);
    cues.forEach((cue, i) => {
      const before = cues[i - 1];
      const after = cues[i + 1];
      if (startsSlide(cue) && before) {
        const gapBeforeSec = cue.timeSec - before.timeSec;
        expect(gapBeforeSec).toBeGreaterThan(0.9 * beatSec);
      }
      if (cue.slideStep === 3 && after) {
        const gapAfterSec = after.timeSec - cue.timeSec;
        expect(gapAfterSec).toBeGreaterThan(0.9 * beatSec);
      }
    });
  });

  it('follows its single taps with an off-beat tap as often as the level rules say', () => {
    // Only a single tap leaves a hand free for an off-beat tap: a double uses both hands.
    const many = chart(synthetic(100, 1800), 4, 42);
    const singles = many.filter((cue) => cue.cells.length === 1 && !isOffbeat(cue) && !inSlide(cue));
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

  it('are enough for each tap of a slide where the beats come unevenly', () => {
    // Beats 8, 9 and 10 are due at 4.8 s, 5.0 s and 5.2 s. A slide on them would ask one hand
    // for its first and third taps 0.4 s apart: less than the rest that a hand needs.
    const song = synthetic(100, 120);
    song.beats[9] = 5;
    song.beats[10] = 5.2;
    const cues = chart(song, 3, 42);
    expect(cuesBeyondTwoHands(cues)).toEqual([]);
    const early = cues.filter((cue) => cue.timeSec < 6);
    expect(early.map((cue) => cue.timeSec)).not.toEqual([4.8, 5, 5.2]);
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
    for (const cue of cues) {
      expect(cue.shapes).toHaveLength(cue.cells.length);
      for (const shape of cue.shapes ?? []) expect(CHART.gesturePool).toContain(shape);
    }
    expect(chart(song, 5, 42, { shapes: true })).toEqual(cues);
  });

  it('has the same cues as level 4, plus the shapes', () => {
    const withoutShapes = cues.map(({ shapes: _shapes, ...cue }) => cue);
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
    expect(new Set(cues.flatMap((cue) => cue.shapes ?? []))).toEqual(new Set(CHART.gesturePool));
  });
});

describe('slide and double geometry', () => {
  it('lets a slide end two steps away along a row, column or diagonal', () => {
    expect(slideTargets(0)).toEqual([2, 6, 8]);
    expect(slideTargets(8)).toEqual([0, 2, 6]);
    expect(slideTargets(1)).toEqual([7]);
    expect(slideTargets(3)).toEqual([5]);
  });

  it('lets no slide start in the centre: no line of three cells starts there', () => {
    expect(slideTargets(4)).toEqual([]);
  });

  it('finds the middle cell of a slide', () => {
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
      expect(chart(synthetic(100, 600), level, 7).some((cue) => cue.shapes)).toBe(false);
    }
  });

  it('appear at every level with a switch when it is on, only on single taps outside slides, from the pool', () => {
    for (const level of SWITCH_LEVELS) {
      const shaped = chart(synthetic(100, 600), level, 7, { shapes: true }).filter((cue) => cue.shapes);
      expect(shaped.length).toBeGreaterThan(20);
      for (const cue of shaped) {
        expect(inSlide(cue)).toBe(false);
        expect(cue.cells).toHaveLength(1);
        expect(CHART.gesturePool).toContain(cue.shapes?.[0]);
      }
    }
  });

  it.each([60, 100, 109, 128, 180])(
    'at %i BPM, never follow the previous cue faster than a hand can change shape',
    (bpm) => {
      // The gap counts from the previous cue, so it also covers a tap after the end of a slide.
      const cues = chart(synthetic(bpm, 600), 3, 7, { shapes: true });
      expect(cues.some((cue) => cue.shapes)).toBe(true);
      cues.forEach((cue, i) => {
        if (!cue.shapes || i === 0) return;
        expect(cue.timeSec - cues[i - 1].timeSec).toBeGreaterThanOrEqual(CHART.gestureGapSec - 1e-8);
      });
    },
  );

  it('can come straight after a slide when the beat leaves enough time', () => {
    // At 100 BPM a beat is 0.6 s, longer than the gap a hand needs. This also proves that
    // the gap test above sees taps that follow slides.
    const cues = chart(synthetic(100, 600), 3, 7, { shapes: true });
    const afterSlides = cues.filter((cue, i) => i > 0 && cue.shapes && cues[i - 1].slideStep === 3);
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
              expect(cue.timeSec).toBeLessThan(nextPhraseSec);
              expect(cue.timeSec).toBeLessThan(tailStartSec(song, endSec));
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
          expect(cue.timeSec).toBe(song.beats[cue.beatIndex]);
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

  it('take the place of the other cues: no off-beat taps and no switch shapes inside a move', () => {
    for (const level of ALL_LEVELS) {
      const entries = withMoves(synthetic(100, 600), level, 1, { shapes: true });
      for (const cues of byPhrase(entries).values()) {
        const startSec = cues[0].cue.timeSec;
        const endSec = cues[cues.length - 1].cue.timeSec;
        const inside = entries.filter((entry) => entry.cue.timeSec >= startSec && entry.cue.timeSec <= endSec);
        expect(inside.every((entry) => entry.role === 'move')).toBe(true);
        if (level < 5) expect(cues.every((entry) => entry.cue.shapes === undefined)).toBe(true);
      }
    }
  });

  it('keep the phrase shape at a level with a shape on every cue', () => {
    const song = synthetic(100, 600);
    const shapes = phraseShapes(song, 42);
    const moveCues = withMoves(song, 5, 1).filter((entry) => entry.role === 'move');
    expect(moveCues.length).toBeGreaterThan(100);
    for (const { cue } of moveCues) expect(cue.shapes).toEqual([shapes[cue.beatIndex]]);
  });

  it('get a clear moment before them: no slide runs into a move, and no off-beat tap comes just before it', () => {
    // At 100 BPM a beat is 0.6 s: the cue before a move ends at least a beat before it.
    for (const level of ALL_LEVELS) {
      const entries = withMoves(synthetic(100, 600), level, 0.7);
      entries.forEach((entry, i) => {
        if (entry.role !== 'move' || i === 0 || entries[i - 1].role === 'move') return;
        expect(entries[i - 1].role).not.toBe('offbeat');
        expect(entry.cue.timeSec - entries[i - 1].cue.timeSec).toBeGreaterThan(0.55);
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

describe('slides on every song', () => {
  const SEEDS = [DEFAULT_SEED, 7, 2026];
  /** Without moves, and with the moves of sets 5 and 6. */
  const MOVE_SHARES = [0, 0.7];

  interface SongChart {
    song: Manifest;
    seed: number;
    entries: ChartEntry[];
  }

  /** Every chart of one level: each song at its full length, each seed, without and with moves. Made once. */
  const charts = new Map<Level, SongChart[]>();
  function chartsAt(level: Level): SongChart[] {
    const made = charts.get(level);
    if (made) return made;
    const list = SONG_MANIFESTS.flatMap((song) =>
      SEEDS.flatMap((seed) =>
        MOVE_SHARES.map((moves) => ({
          song,
          seed,
          entries: chartEntries(song, { level, shapes: true, seed, endSec: song.durationSec, moves }),
        })),
      ),
    );
    charts.set(level, list);
    return list;
  }

  /** The beats from one cue to the next around `beat`, by the level rules: the pace of the music there. */
  function strideOf(song: Manifest, level: Level, beat: number): number {
    const rules = LEVELS[level];
    const fast = song.intensity[beat] >= rules.fastFromIntensity;
    const stride = selectStride(medianBeatInterval(song), fast ? CHART.fastIntervalSec : CHART.slowIntervalSec);
    return song.intensity[beat] < rules.sparseBelowIntensity ? stride * 2 : stride;
  }

  /** The first entry of each slide in a chart, by its index. */
  const slideStarts = (entries: ChartEntry[]): number[] =>
    entries.flatMap((entry, i) => (entry.cue.slideStep === 1 ? [i] : []));

  /** The first beat of each move in a chart. */
  function moveStartBeats(entries: ChartEntry[]): number[] {
    const firstBeatOfPhrase = new Map<number, number>();
    for (const { cue, move } of entries) {
      if (!move || firstBeatOfPhrase.has(move.phrase)) continue;
      firstBeatOfPhrase.set(move.phrase, cue.beatIndex);
    }
    return [...firstBeatOfPhrase.values()];
  }

  /** Checks that three cells lie on one line, the ends two steps apart and the middle between them. */
  function expectOneLine([from, middle, to]: number[]): void {
    const firstStep = [row(middle) - row(from), column(middle) - column(from)];
    const secondStep = [row(to) - row(middle), column(to) - column(middle)];
    expect(secondStep).toEqual(firstStep);
    expect(firstStep.every((step) => Math.abs(step) <= 1)).toBe(true);
    expect(firstStep.some((step) => step !== 0)).toBe(true);
  }

  it.each([3, 4, 5] as Level[])('at level %i, are three taps in a line, steps 1, 2 and 3, on three cue beats in a row', (level) => {
    let slides = 0;
    for (const { song, entries } of chartsAt(level)) {
      for (const i of slideStarts(entries)) {
        slides++;
        const slide = entries.slice(i, i + 3);
        const cues = slide.map((entry) => entry.cue);
        const [first] = cues;
        expect(cues.map((cue) => cue.slideStep)).toEqual([1, 2, 3]);
        expect(slide.map((entry) => entry.role)).toEqual(['beat', 'slide', 'slide']);
        expect(cues.every((cue) => cue.cells.length === 1)).toBe(true);
        expectOneLine(cues.map((cue) => cue.cells[0]));

        const stride = strideOf(song, level, first.beatIndex);
        const expectedBeats = [0, 1, 2].map((k) => first.beatIndex + k * stride);
        expect(cues.map((cue) => cue.beatIndex)).toEqual(expectedBeats);
        for (const cue of cues) {
          const beatsFromBarStart = cue.beatIndex - song.firstDownbeat;
          expect(beatsFromBarStart % strideOf(song, level, cue.beatIndex)).toBe(0);
          expect(cue.timeSec).toBe(song.beats[cue.beatIndex]);
          // Every cell is clear of the lead-in and of the last bar, not the first cell only.
          expect(cue.timeSec).toBeGreaterThanOrEqual(leadInEndSec(song));
          expect(cue.timeSec).toBeLessThan(tailStartSec(song, song.durationSec));
        }
        expect(song.intensity[first.beatIndex]).toBeGreaterThanOrEqual(CHART.busyIntensity);
      }
    }
    expect(slides).toBeGreaterThan(1000);
  });

  it.each([3, 4, 5] as Level[])('at level %i, start a slide on no centre cell and on no beat straight after an off-beat tap', (level) => {
    for (const { entries } of chartsAt(level)) {
      for (const i of slideStarts(entries)) {
        expect(entries[i].cue.cells[0]).not.toBe(4);
        if (i > 0) expect(entries[i - 1].role).not.toBe('offbeat');
      }
    }
  });

  it.each([3, 4, 5] as Level[])('at level %i, let no other cue come from the first cell of a slide to its last, or before the next cue beat', (level) => {
    for (const { song, entries } of chartsAt(level)) {
      for (const i of slideStarts(entries)) {
        // Find the end cell by its step, not by its place, so that a cue between the cells shows.
        const endIndex = entries.findIndex((entry, k) => k > i && entry.cue.slideStep === 3);
        expect(endIndex).toBe(i + 2);
        expect(entries[i + 1].cue.slideStep).toBe(2);
        const firstSec = entries[i].cue.timeSec;
        const end = entries[endIndex].cue;
        const isOwnCell = (k: number): boolean => k >= i && k <= endIndex;
        const dueInside = (entry: ChartEntry): boolean => entry.cue.timeSec >= firstSec && entry.cue.timeSec <= end.timeSec;
        const inside = entries.filter((entry, k) => !isOwnCell(k) && dueInside(entry));
        expect(inside).toEqual([]);
        const next = entries[endIndex + 1];
        if (!next) continue;
        expect(next.role).not.toBe('offbeat');
        expect(next.cue.beatIndex - end.beatIndex).toBeGreaterThanOrEqual(strideOf(song, level, next.cue.beatIndex));
      }
    }
  });

  it.each([3, 4, 5] as Level[])('at level %i, end every slide before the first beat of the next planned move, and leave that beat to the move', (level) => {
    // The plan of the moves is the same at every level. Level 2 has no slides, so its moves
    // show every planned move that has room at the pace of busy music.
    const plannedCharts = chartsAt(2);
    let slidesBeforeMoves = 0;
    chartsAt(level).forEach(({ entries }, c) => {
      const planned = moveStartBeats(plannedCharts[c].entries);
      const played = moveStartBeats(entries);
      for (const i of slideStarts(entries)) {
        const start = planned.find((beat) => beat > entries[i].cue.beatIndex);
        if (start === undefined) continue;
        slidesBeforeMoves++;
        expect(entries[i + 2].cue.beatIndex).toBeLessThan(start);
        expect(played).toContain(start);
      }
    });
    expect(slidesBeforeMoves).toBeGreaterThan(100);
  });

  it.each([3, 4, 5] as Level[])('at level %i, need no more than two hands', (level) => {
    for (const { entries } of chartsAt(level)) expect(cuesBeyondTwoHands(entries.map((entry) => entry.cue))).toEqual([]);
  });

  it.each([3, 4] as Level[])('at level %i, ask for no shape from the shapes switch on a cell of a slide', (level) => {
    for (const { entries } of chartsAt(level)) {
      const slideCells = entries.map((entry) => entry.cue).filter(inSlide);
      for (const cue of slideCells) expect(cue.shapes).toBeUndefined();
    }
  });

  it('give each cell of a slide the phrase shape of its own beat at level 5', () => {
    for (const { song, seed, entries } of chartsAt(5)) {
      const shapes = phraseShapes(song, seed);
      const slideCells = entries.map((entry) => entry.cue).filter(inSlide);
      for (const cue of slideCells) expect(cue.shapes).toEqual([shapes[cue.beatIndex]]);
    }
  });

  it.each([1, 2] as Level[])('are in no chart at level %i', (level) => {
    for (const { entries } of chartsAt(level)) {
      expect(entries.some((entry) => inSlide(entry.cue) || entry.role === 'slide')).toBe(false);
    }
  });
});
