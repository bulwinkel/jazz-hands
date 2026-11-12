import { CHART, LEVELS } from './config';
import { isBarStart, leadInEndSec, medianBeatInterval, tailStartSec } from './manifest';
import type { Cue, Level, Manifest, SlideSpeed } from './types';

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

/**
 * The cell a slow slide passes through: halfway between two cells that are two steps apart.
 * In a 3x3 grid numbered row by row, that cell's number is the mean of the two ends.
 */
export function middleCell(from: number, to: number): number {
  return (from + to) / 2;
}

/** Splits one roll by the level's speed shares. A slow slide needs a middle cell; without one it is normal. */
function pickSlideSpeed(shares: Record<SlideSpeed, number>, roll: number, slowPossible: boolean): SlideSpeed {
  if (roll < shares.fast) return 'fast';
  if (roll < shares.fast + shares.slow && slowPossible) return 'slow';
  return 'normal';
}

/** How many cue intervals after its start a slide ends on a cue beat. A fast slide ends between two. */
const SLIDE_END_STRIDES: Record<SlideSpeed, number> = { fast: 0, normal: 1, slow: 2 };

/** The cue list for one player. The same manifest and options always give the same list. */
export function generateChart(manifest: Manifest, options: ChartOptions): Cue[] {
  const rules = LEVELS[options.level];
  const { beats, intensity } = manifest;
  const master = masterCells(manifest, options.seed);
  const random = seededRandom(options.seed ^ 0xa519);
  const beatIntervalSec = medianBeatInterval(manifest);
  const firstCueSec = leadInEndSec(manifest);
  const tailSec = tailStartSec(manifest, options.endSec);

  /** Beats from one cue to the next around this beat: 1 where cues come on every beat. */
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
  /** The last beat the previous cue occupies, and when that cue ends. */
  let previousEndBeat = -Infinity;
  let previousEndSec = -Infinity;

  // A player has two hands, and a hand needs time to travel. The chart keeps a budget:
  // when each hand finished its last move. A cue takes one hand, a double takes both,
  // and a slide keeps its hand until the slide ends.
  const lastMoveSec = [-Infinity, -Infinity];
  const freeHandsAt = (timeSec: number): number =>
    lastMoveSec.filter((last) => timeSec - last >= CHART.handRestSec - EPSILON).length;
  /** Gives a move that ends at `untilSec` to the hand that has rested longest. */
  const useHand = (untilSec: number): void => {
    lastMoveSec[lastMoveSec[0] <= lastMoveSec[1] ? 0 : 1] = untilSec;
  };

  for (let beat = 0; beat < beats.length; beat++) {
    // Every beat takes the same rolls, used or not. One beat's choices then never shift
    // another beat's, and all levels read the same sequence.
    const roll = {
      kind: random(),
      slideSpeed: random(),
      slideTarget: random(),
      side: random(),
      partnerRow: random(),
      gesture: random(),
      shape: random(),
      offbeat: random(),
      offbeatCell: random(),
    };
    const stride = strideAt(beat);
    // Skip beats that hold no cue, beats a slide still occupies, and a beat that would come
    // too soon after the previous cue where the music changes intensity.
    if (!isCueBeat(beat) || beat - previousEndBeat < stride) continue;

    const timeSec = beats[beat];
    const nextCueBeat = beat + stride;
    const hasNextCue = isCueBeat(nextCueBeat);
    const busy = intensity[beat] >= CHART.busyIntensity;
    const freeHands = freeHandsAt(timeSec);
    if (freeHands === 0) continue; // Both hands are still travelling: no cue fits on this beat.

    // One roll picks the kind of cue: the first share is a slide, the next share a double,
    // the rest a single tap. Each share is then exactly the chance in the level rules.
    // Every slide needs a next cue beat: it sets how long the slide takes.
    const slideShare = busy && hasNextCue ? rules.slideChance : 0;
    const doubleAllowed =
      busy && freeHands === 2 && (!rules.doublesOnBarStartsOnly || isBarStart(manifest, beat));
    const doubleShare = doubleAllowed ? rules.doubleChance : 0;
    let cue: Cue;

    if (roll.kind < slideShare) {
      const from = master[beat];
      const targets = slideTargets(from);
      const to = targets[Math.floor(roll.slideTarget * targets.length)];
      const slowPossible = from !== CENTRE && isCueBeat(beat + 2 * stride);
      const speed = pickSlideSpeed(rules.slideSpeeds, roll.slideSpeed, slowPossible);
      const nextCueSec = beats[nextCueBeat];
      cue = { kind: 'slide', speed, timeSec, beatIndex: beat, cells: [from, to], times: [timeSec, nextCueSec] };
      if (speed === 'fast') {
        cue.times = [timeSec, (timeSec + nextCueSec) / 2];
      } else if (speed === 'slow') {
        cue.cells = [from, middleCell(from, to), to];
        cue.times = [timeSec, nextCueSec, beats[beat + 2 * stride]];
      }
    } else if (roll.kind < slideShare + doubleShare) {
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
    const stridesToEnd = cue.kind === 'slide' && cue.speed ? SLIDE_END_STRIDES[cue.speed] : 0;
    previousEndBeat = beat + stridesToEnd * stride;
    previousEndSec = cue.times[cue.times.length - 1];
    // A slide is one hand's move from its first cell to its last. A tap uses one hand per cell.
    if (cue.kind === 'slide') useHand(previousEndSec);
    else cue.cells.forEach(() => useHand(timeSec));

    // An off-beat tap: one extra cell halfway to the next cue beat. It follows taps only,
    // it needs a hand that is free by then, and it avoids the cells just used and the cell
    // that is likely to come next.
    const offbeatSec = hasNextCue ? (timeSec + beats[nextCueBeat]) / 2 : Infinity;
    const offbeatFits = cue.kind === 'tap' && busy && hasNextCue && freeHandsAt(offbeatSec) > 0;
    if (offbeatFits && roll.offbeat < rules.offbeatChance) {
      const taken = [...cue.cells, master[nextCueBeat]];
      const cell = pickWeighted(CHART.cellWeights, roll.offbeatCell, (c) => !taken.includes(c));
      cues.push({ kind: 'tap', timeSec: offbeatSec, beatIndex: beat + stride / 2, cells: [cell], times: [offbeatSec] });
      previousEndSec = offbeatSec;
      useHand(offbeatSec);
    }
  }
  return cues;
}
