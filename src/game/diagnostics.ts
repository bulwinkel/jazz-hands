import type { GestureName, TrackedHand } from '../tracking/types';
import { LEVELS } from './config';
import { cellRect, insideCell } from './geometry';
import { isInsideWindow } from './judgment';
import type { CueState } from './judgment';
import type { PlayerRun } from './player';
import type { Cue, Level, Rect } from './types';

/**
 * Diagnostics answer questions the score cannot: did the tracker really read the hand shape,
 * or did a cue pass by luck? How early or late do hands arrive? How steady was tracking?
 * The game records what the tracker showed around every cue and builds one report per run.
 */

/** What the tracker showed in one cell of a cue while that cell could be hit. */
export interface CellObservation {
  /** Tracking frames with a hand in the cell, inside the cell's Good window. */
  framesInCell: number;
  /** Of those, frames where the hand also made the asked-for shape. All of them when no shape is asked. */
  framesMatching: number;
  /** When a hand was first seen in the cell, in ms from the cell's due time. Negative is early. */
  firstInCellMs: number | null;
  /** When a hand in the cell first made the asked-for shape, in ms from the due time. */
  firstMatchMs: number | null;
}

export interface CueObservation {
  /** Tracking frames judged while the Good window of any cell was open. */
  frames: number;
  cells: CellObservation[];
  /** Shape cues only: how often the tracker read each shape on a hand in the cell. */
  shapesRead: Partial<Record<GestureName, number>>;
}

export function newObservation(cue: Cue): CueObservation {
  return {
    frames: 0,
    cells: cue.cells.map(() => ({ framesInCell: 0, framesMatching: 0, firstInCellMs: null, firstMatchMs: null })),
    shapesRead: {},
  };
}

/**
 * Adds one tracking frame to a cue's observation, in place. It keeps counting after the cue
 * is final, to the end of the Good window, so a report shows the whole window and not only
 * the frames up to the first hit.
 */
export function observeFrame(
  observation: CueObservation,
  cue: Cue,
  level: Level,
  grid: Rect,
  hands: readonly TrackedHand[],
  timeSec: number,
): void {
  const { goodMs } = LEVELS[level];
  let anyWindowOpen = false;

  cue.cells.forEach((cell, k) => {
    const deltaMs = (timeSec - cue.times[k]) * 1000;
    if (!isInsideWindow(deltaMs, goodMs)) return;
    anyWindowOpen = true;

    const rect = cellRect(grid, cell);
    const handsInCell = hands.filter((hand) => insideCell(hand, rect));
    if (handsInCell.length === 0) return;

    const seen = observation.cells[k];
    seen.framesInCell++;
    seen.firstInCellMs ??= Math.round(deltaMs);
    for (const hand of handsInCell) {
      if (cue.gesture) observation.shapesRead[hand.gesture] = (observation.shapesRead[hand.gesture] ?? 0) + 1;
    }
    const matches = handsInCell.some((hand) => !cue.gesture || hand.gesture === cue.gesture);
    if (matches) {
      seen.framesMatching++;
      seen.firstMatchMs ??= Math.round(deltaMs);
    }
  });
  if (anyWindowOpen) observation.frames++;
}

/** Running totals about tracking during play. */
export interface TrackingStats {
  frames: number;
  inferenceMs: number[];
  /** Per player slot: frames with 0, 1 and 2 hands. */
  handCounts: [number[], number[]];
  playStartedMs: number;
}

export function newTrackingStats(nowMs: number): TrackingStats {
  return { frames: 0, inferenceMs: [], handCounts: [[0, 0, 0], [0, 0, 0]], playStartedMs: nowMs };
}

const round1 = (value: number): number => Math.round(value * 10) / 10;
const round4 = (value: number): number => Math.round(value * 10000) / 10000;
const share = (count: number, total: number): number => (total ? Math.round((count / total) * 1000) / 1000 : 0);

function mean(values: readonly number[]): number | null {
  return values.length ? round1(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return round1(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]);
}

/** A hand that was already in the cell when its window opened tells nothing about arrival time. */
const HELD_EARLY_MARGIN_MS = 40;

/** How each asked-for shape was read: for `fist`, the frames read as fist, as open, and so on. */
type ShapeReadings = Partial<Record<GestureName, Partial<Record<GestureName, number>>>>;

export interface PlayerReport {
  index: number;
  level: Level;
  shapes: boolean;
  grid: Rect;
  score: PlayerRun['score'];
  /** Share of play frames in which the tracker saw 0, 1 and 2 of this player's hands. */
  handsSeen: { none: number; one: number; two: number };
  /** When hands arrived in their cells, in ms from the due time. Negative is early. Hints at the input delay setting. */
  arrivalMs: { mean: number | null; median: number | null; cells: number };
  shapeCues: {
    asked: number;
    hit: number;
    /** Over all frames with a hand in a shape cue's cell: the share read as the asked-for shape. */
    readAsAsked: number;
    /** A hit where, in one of its cells, under a quarter of the in-cell frames showed the right shape: it may have passed by luck. */
    hitOnFewFrames: number;
    readings: ShapeReadings;
  };
  cues: Array<Cue & { result?: string; marks: CueState['marks']; observation: CueObservation }>;
}

export interface RunReport {
  schemaVersion: 1;
  savedAt: string;
  song: { id: string; title: string; length: string; startSec: number; endSec: number };
  settings: {
    playerCount: number;
    input: string;
    seed: number;
    inputLatencyMs: number;
    avOffsetMs: number;
    audioOutputLatencyMs: number;
  };
  tracking: {
    mode: string;
    delegate: string;
    frames: number;
    framesPerSec: number;
    inferenceMs: { mean: number | null; p95: number | null };
  };
  players: PlayerReport[];
}

function playerReport(player: PlayerRun, stats: TrackingStats): PlayerReport {
  const { goodMs } = LEVELS[player.level];
  const { observations } = player;
  const arrivals: number[] = [];
  const readings: ShapeReadings = {};
  let asked = 0;
  let hit = 0;
  let shapeFramesInCell = 0;
  let shapeFramesMatching = 0;
  let hitOnFewFrames = 0;

  player.cues.forEach((cue, i) => {
    const observation = observations[i];
    for (const cell of observation.cells) {
      const arrived = cell.firstInCellMs !== null && cell.firstInCellMs > goodMs[0] + HELD_EARLY_MARGIN_MS;
      if (arrived) arrivals.push(cell.firstInCellMs as number);
    }
    if (!cue.gesture) return;

    asked++;
    const wasHit = player.states[i]?.result === 'perfect' || player.states[i]?.result === 'good';
    if (wasHit) hit++;
    // A shape cue may have several cells: both hands of a double, or the cells of a slide.
    for (const cell of observation.cells) {
      shapeFramesInCell += cell.framesInCell;
      shapeFramesMatching += cell.framesMatching;
    }
    const onFewFrames = observation.cells.some((cell) => cell.framesMatching < cell.framesInCell / 4);
    if (wasHit && onFewFrames) hitOnFewFrames++;

    const forAsked = (readings[cue.gesture] ??= {});
    for (const [read, frames] of Object.entries(observation.shapesRead)) {
      const shape = read as GestureName;
      forAsked[shape] = (forAsked[shape] ?? 0) + frames;
    }
  });

  const [none, one, two] = stats.handCounts[player.index];
  return {
    index: player.index,
    level: player.level,
    shapes: player.shapes,
    grid: {
      x: round4(player.grid.x),
      y: round4(player.grid.y),
      width: round4(player.grid.width),
      height: round4(player.grid.height),
    },
    score: player.score,
    handsSeen: { none: share(none, stats.frames), one: share(one, stats.frames), two: share(two, stats.frames) },
    arrivalMs: { mean: mean(arrivals), median: percentile(arrivals, 0.5), cells: arrivals.length },
    shapeCues: {
      asked,
      hit,
      readAsAsked: share(shapeFramesMatching, shapeFramesInCell),
      hitOnFewFrames,
      readings,
    },
    cues: player.cues.map((cue, i) => ({
      ...cue,
      result: player.states[i]?.result,
      marks: player.states[i]?.marks ?? [],
      observation: observations[i],
    })),
  };
}

export interface RunContext {
  song: RunReport['song'];
  settings: RunReport['settings'];
  trackerMode: string;
  trackerDelegate: string;
  players: readonly PlayerRun[];
  stats: TrackingStats;
  nowMs: number;
}

/** Everything about one finished run, as plain data that can be saved as JSON. */
export function buildRunReport(context: RunContext): RunReport {
  const { stats } = context;
  const playSec = (context.nowMs - stats.playStartedMs) / 1000;
  return {
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    song: context.song,
    settings: context.settings,
    tracking: {
      mode: context.trackerMode,
      delegate: context.trackerDelegate,
      frames: stats.frames,
      framesPerSec: playSec > 0 ? round1(stats.frames / playSec) : 0,
      inferenceMs: { mean: mean(stats.inferenceMs), p95: percentile(stats.inferenceMs, 0.95) },
    },
    players: context.players.map((player) => playerReport(player, stats)),
  };
}
