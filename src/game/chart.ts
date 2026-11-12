import { CHART, LEVELS } from './config';
import { isBarStart, leadInEndSec, medianBeatInterval, tailStartSec } from './manifest';
import type { Cue, Level, Manifest } from './types';

export interface ChartOptions {
  level: Level;
  /** Ask for a hand shape on some single-cell taps. */
  shapes: boolean;
  seed: number;
  /** Where play ends, in song seconds. The last bar before it has no cues. */
  endSec: number;
}

const EPSILON = 1e-8;
const CENTRE = 4;
const row = (cell: number): number => Math.floor(cell / 3);
const column = (cell: number): number => cell % 3;

/** Mulberry32: a tiny seeded generator. One seed always gives the same sequence. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(weights: readonly number[], roll: number, allowed: (index: number) => boolean): number {
  const options = weights.map((weight, index) => ({ weight, index })).filter((o) => allowed(o.index));
  let remaining = roll * options.reduce((sum, o) => sum + o.weight, 0);
  for (const option of options) {
    remaining -= option.weight;
    if (remaining < 0) return option.index;
  }
  return options[options.length - 1].index;
}

/**
 * One cell for every beat of the song. Every level takes its cells from this sequence,
 * so two players on different levels make the same move when both have a cue on a beat.
 */
export function masterCells(manifest: Manifest, seed: number): number[] {
  const random = seededRandom(seed);
  const cells: number[] = [];
  for (let beat = 0; beat < manifest.beats.length; beat++) {
    const recent = cells.slice(-CHART.recentCells);
    cells.push(pickWeighted(CHART.cellWeights, random(), (cell) => !recent.includes(cell)));
  }
  return cells;
}

/**
 * The smallest stride, in beats, that keeps cues at least `minimumSec` apart.
 * This also guards against a manifest whose tempo is double the tempo people feel.
 */
export function selectStride(beatIntervalSec: number, minimumSec: number): number {
  const fits = CHART.strides.find((stride) => beatIntervalSec * stride >= minimumSec - EPSILON);
  return fits ?? CHART.strides[CHART.strides.length - 1];
}

/**
 * Two cells for two hands: one in the left column and one in the right, so the arms never cross.
 * A master cell in the centre column moves to a side.
 */
export function doubleCells(masterCell: number, sideRoll: number, partnerRowRoll: number): [number, number] {
  const side = column(masterCell) === 1 ? (sideRoll < 0.5 ? 0 : 2) : column(masterCell);
  const partnerRow = Math.floor(partnerRowRoll * 3);
  return [row(masterCell) * 3 + side, partnerRow * 3 + (2 - side)];
}

/**
 * Cells a slide may end on: two steps from `from` along a row, column or diagonal,
 * so every slide crosses the grid. The centre has no such cell, so it reaches any other cell.
 */
export function slideTargets(from: number): number[] {
  const others = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((cell) => cell !== from);
  if (from === CENTRE) return others;
  return others.filter((cell) => {
    const rows = Math.abs(row(cell) - row(from));
    const columns = Math.abs(column(cell) - column(from));
    const onOneLine = rows === 0 || columns === 0 || rows === columns;
    return onOneLine && Math.max(rows, columns) === 2;
  });
}

/** The cue list for one player. The same manifest and options always give the same list. */
export function generateChart(manifest: Manifest, options: ChartOptions): Cue[] {
  const rules = LEVELS[options.level];
  const { beats, intensity } = manifest;
  const master = masterCells(manifest, options.seed);
  const random = seededRandom(options.seed ^ 0xa519);
  const beatIntervalSec = medianBeatInterval(manifest);
  const firstCueSec = leadInEndSec(manifest);
  const tailSec = tailStartSec(manifest, options.endSec);

  const strideAt = (beat: number): number => {
    const fast = intensity[beat] >= rules.fastFromIntensity;
    const stride = selectStride(beatIntervalSec, fast ? CHART.fastIntervalSec : CHART.slowIntervalSec);
    return intensity[beat] < rules.sparseBelowIntensity ? stride * 2 : stride;
  };
  const isCueBeat = (beat: number): boolean =>
    beat < beats.length &&
    beats[beat] >= firstCueSec &&
    beats[beat] < tailSec &&
    (beat - manifest.firstDownbeat) % strideAt(beat) === 0;

  const cues: Cue[] = [];
  let previousEndBeat = -Infinity;
  let previousEndSec = -Infinity;

  for (let beat = 0; beat < beats.length; beat++) {
    // Every beat takes the same rolls, used or not. One beat's choices then never shift
    // another beat's, and all levels read the same sequence.
    const roll = {
      slide: random(),
      slideTarget: random(),
      double: random(),
      side: random(),
      partnerRow: random(),
      gesture: random(),
      shape: random(),
    };
    // The second test also skips the beat on which a slide ends, and keeps the spacing
    // when the music changes intensity between two cues.
    if (!isCueBeat(beat) || beat - previousEndBeat < strideAt(beat)) continue;

    const timeSec = beats[beat];
    const busy = intensity[beat] >= CHART.busyIntensity;
    const doubleAllowed = !rules.doublesOnBarStartsOnly || isBarStart(manifest, beat);
    let cue: Cue;

    if (busy && roll.slide < rules.slideChance && isCueBeat(beat + 1)) {
      const targets = slideTargets(master[beat]);
      const to = targets[Math.floor(roll.slideTarget * targets.length)];
      cue = {
        kind: 'slide',
        timeSec,
        beatIndex: beat,
        cells: [master[beat], to],
        times: [timeSec, beats[beat + 1]],
      };
    } else if (busy && doubleAllowed && roll.double < rules.doubleChance) {
      cue = {
        kind: 'tap',
        timeSec,
        beatIndex: beat,
        cells: doubleCells(master[beat], roll.side, roll.partnerRow),
        times: [timeSec, timeSec],
      };
    } else {
      cue = { kind: 'tap', timeSec, beatIndex: beat, cells: [master[beat]], times: [timeSec] };
      const rested = timeSec - previousEndSec >= CHART.gestureGapSec - EPSILON;
      if (options.shapes && rested && roll.gesture < CHART.gestureChance) {
        cue.gesture = CHART.gesturePool[Math.floor(roll.shape * CHART.gesturePool.length)];
      }
    }

    cues.push(cue);
    previousEndBeat = cue.kind === 'slide' ? beat + 1 : beat;
    previousEndSec = cue.times[cue.times.length - 1];
  }
  return cues;
}
