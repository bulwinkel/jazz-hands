import type { FaceExpression, GestureName, TrackedFace, TrackedHand } from '../tracking/types';
import { FACES, LEVELS } from './config';
import { showsExpression } from './faceJudgment';
import { cellRect, insideCell } from './geometry';
import { roundTo } from './numbers';
import { isInsideWindow } from './judgment';
import type { CueState } from './judgment';
import type { MoveName } from './moves';
import { shapeChangeShare } from './player';
import type { PlayerRun } from './player';
import { playedSec, startPlay } from './playTime';
import type { PlayTime } from './playTime';
import type { Cue, FaceCue, Level, Rating, Rect } from './types';

/**
 * Diagnostics answer questions the score cannot: did the tracker really read the hand shape,
 * or did a cue pass by luck? How early or late do hands arrive? How steady was tracking?
 * The game records what the tracker showed around every cue and builds one report per run.
 */

/** What the tracker showed in one cell of a cue while that cell could be hit. */
export interface CellObservation {
  /** Tracking frames with a hand in the cell, inside the cue's Good window. */
  framesInCell: number;
  /** Of those, frames where the hand also made the asked-for shape. All of them when no shape is asked. */
  framesMatching: number;
  /** When a hand was first seen in the cell, in ms from the cue's due time. Negative is early. */
  firstInCellMs: number | null;
  /** When a hand in the cell first made the asked-for shape, in ms from the due time. */
  firstMatchMs: number | null;
  /**
   * Shape cues only: how often the tracker read each shape on a hand in the cell. Each cell
   * keeps its own, because the two cells of a cue can ask for two shapes.
   */
  shapesRead: Partial<Record<GestureName, number>>;
}

export interface CueObservation {
  /** Tracking frames judged while the cue's Good window was open. */
  frames: number;
  cells: CellObservation[];
}

export function newObservation(cue: Cue): CueObservation {
  return {
    frames: 0,
    cells: cue.cells.map(() => ({
      framesInCell: 0,
      framesMatching: 0,
      firstInCellMs: null,
      firstMatchMs: null,
      shapesRead: {},
    })),
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
  const deltaMs = (timeSec - cue.timeSec) * 1000;
  if (!isInsideWindow(deltaMs, LEVELS[level].goodMs)) return;
  observation.frames++;

  cue.cells.forEach((cell, k) => {
    const rect = cellRect(grid, cell);
    const handsInCell = hands.filter((hand) => insideCell(hand, rect));
    if (handsInCell.length === 0) return;

    const seen = observation.cells[k];
    const shape = cue.shapes?.[k];
    seen.framesInCell++;
    seen.firstInCellMs ??= Math.round(deltaMs);
    for (const hand of handsInCell) {
      if (shape) seen.shapesRead[hand.gesture] = (seen.shapesRead[hand.gesture] ?? 0) + 1;
    }
    const matches = handsInCell.some((hand) => !shape || hand.gesture === shape);
    if (matches) {
      seen.framesMatching++;
      seen.firstMatchMs ??= Math.round(deltaMs);
    }
  });
}

/** What the tracker showed of a player's face while one face cue could be hit. */
export interface FaceObservation {
  /** Tracking frames judged inside the cue's Good window. */
  frames: number;
  /** Of those, frames in which the tracker found the player's face. */
  framesWithFace: number;
  /** Of those, frames in which the asked-for expression was at or above its threshold. */
  framesShowing: number;
  /** The highest strength of the asked-for expression, 0..1. Null when no face was found. */
  peak: number | null;
  /** The highest strength of each other expression. A high one means the tracker read another face. */
  otherPeaks: Partial<Record<FaceExpression, number>>;
  /** When the asked-for expression first showed, in ms from the due time. Negative is early. */
  firstShownMs: number | null;
}

export function newFaceObservation(): FaceObservation {
  return { frames: 0, framesWithFace: 0, framesShowing: 0, peak: null, otherPeaks: {}, firstShownMs: null };
}

/**
 * Adds one tracking frame to a face cue's observation, in place. Like `observeFrame`, it
 * keeps counting after the cue is final, to the end of the Good window.
 */
export function observeFaceFrame(
  observation: FaceObservation,
  cue: FaceCue,
  level: Level,
  face: TrackedFace | undefined,
  timeSec: number,
): void {
  const deltaMs = (timeSec - cue.timeSec) * 1000;
  if (!isInsideWindow(deltaMs, LEVELS[level].goodMs)) return;
  observation.frames++;
  if (!face) return;

  observation.framesWithFace++;
  for (const [name, value] of Object.entries(face.expressions)) {
    const expression = name as FaceExpression;
    const strength = roundTo(value, 3);
    if (expression === cue.expression) {
      observation.peak = Math.max(observation.peak ?? 0, strength);
    } else {
      observation.otherPeaks[expression] = Math.max(observation.otherPeaks[expression] ?? 0, strength);
    }
  }
  if (showsExpression(face, cue.expression)) {
    observation.framesShowing++;
    observation.firstShownMs ??= Math.round(deltaMs);
  }
}

/** Running totals about tracking during play, and about the drawing it competes with. */
export interface TrackingStats {
  frames: number;
  inferenceMs: number[];
  /** Per player slot: frames with 0, 1 and 2 hands. */
  handCounts: [number[], number[]];
  /** Frames the game drew on the canvas. Tracking on the main thread takes time from these. */
  drawnFrames: number;
  /** How long the round has been played. The frames above are counted only during play. */
  play: PlayTime;
}

export function newTrackingStats(nowMs: number): TrackingStats {
  return { frames: 0, inferenceMs: [], handCounts: [[0, 0, 0], [0, 0, 0]], drawnFrames: 0, play: startPlay(nowMs) };
}

const share = (count: number, total: number): number => (total ? Math.round((count / total) * 1000) / 1000 : 0);

function mean(values: readonly number[]): number | null {
  return values.length ? roundTo(values.reduce((sum, value) => sum + value, 0) / values.length, 1) : null;
}

function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return roundTo(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))], 1);
}

/** The middle value. With an even count, the mean of the two middle values. */
function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return roundTo(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2, 3);
}

const isHit = (result: Rating | undefined): boolean => result === 'perfect' || result === 'good';

/** A hand that was already in the cell when its window opened tells nothing about arrival time. */
const HELD_EARLY_MARGIN_MS = 40;

/** How each asked-for shape was read: for `fist`, the frames read as fist, as open, and so on. */
type ShapeReadings = Partial<Record<GestureName, Partial<Record<GestureName, number>>>>;

/**
 * How strongly the tracker read one expression, over the cues that asked for it.
 * Each cue gives one number: the highest strength inside its Good window.
 */
export interface ExpressionReport {
  asked: number;
  hit: number;
  /** The strength the expression needs to count. Compare it with the two numbers below. */
  threshold: number;
  /** The median of the cues' highest strengths. Null when no face was found in any of the cues. */
  medianPeak: number | null;
  /** The highest strength in any of the cues. */
  highestPeak: number | null;
}

export interface PlayerReport {
  index: number;
  level: Level;
  shapes: boolean;
  faces: boolean;
  grid: Rect;
  /**
   * True when the grid came from a calibration: in this round, or kept from an earlier round.
   * False for the standard grid.
   */
  calibrated: boolean;
  score: PlayerRun['score'];
  /** Share of play frames in which the tracker saw 0, 1 and 2 of this player's hands. */
  handsSeen: { none: number; one: number; two: number };
  /** When hands arrived in their cells, in ms from the due time. Negative is early. Hints at the input delay setting. */
  arrivalMs: { mean: number | null; median: number | null; cells: number };
  /** How many moves of each name the round's chart held. */
  moves: Record<MoveName, number>;
  /**
   * The share of the round's cues whose shapes differ from the shapes of the cue before them.
   * See `shapeChangeShare` in player.ts.
   */
  shapeChanges: number;
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
  faceCues: {
    /** The face cues that the round played. 0 when it dropped them before play. */
    asked: number;
    hit: number;
    /**
     * True when the round dropped this player's face cues before play: the tracker had not found
     * the face in enough frames before play. False with faces off.
     */
    droppedBeforePlay: boolean;
    /** The face cues of the chart that the round dropped before play: all of them when `droppedBeforePlay`, else 0. */
    droppedCount: number;
    /** The face cues that gave no result, because no tracking frame in their window had the face. */
    unseen: number;
    /** One entry for each expression the cues asked for. Read these to set `FACES.thresholds`. */
    expressions: Partial<Record<FaceExpression, ExpressionReport>>;
    /** `unseen` is true for a cue that gave no result because the camera did not see the face. Its `result` is then unset. */
    cues: Array<FaceCue & { result?: string; unseen: boolean; observation: FaceObservation }>;
  };
}

export interface RunReport {
  schemaVersion: 1;
  savedAt: string;
  song: { id: string; title: string; length: string; startSec: number; endSec: number };
  settings: {
    playerCount: number;
    input: string;
    seed: number;
    /** The cue set the seed came from. Null when the URL gave the seed. */
    cueSet: number | null;
    /** True when the game picked the set at random. False for a set the players chose, and with no set. */
    cueSetRandom: boolean;
    /** The share of phrases in busy music that hold a move: from the cue set, or from the URL. */
    moveShare: number;
    inputLatencyMs: number;
    avOffsetMs: number;
    audioOutputLatencyMs: number;
    /** True when the round was recorded as video, which costs some speed. */
    recording: boolean;
  };
  tracking: {
    mode: string;
    delegate: string;
    /** What the face models run on. Null when no face model was loaded. */
    faceDelegate: string | null;
    /** Where the trackers ran: 'worker' or 'main'. Null for a test input, which does no tracking. */
    thread: string | null;
    frames: number;
    framesPerSec: number;
    inferenceMs: { mean: number | null; p95: number | null };
    /** Frames the game drew per second during play. The display's rate when nothing holds the page up. */
    drawnPerSec: number;
  };
  players: PlayerReport[];
}

function faceCuesReport(player: PlayerRun): PlayerReport['faceCues'] {
  const { faceCues, faceStates, faceObservations } = player;
  const expressions: Partial<Record<FaceExpression, ExpressionReport>> = {};

  for (const expression of new Set(faceCues.map((cue) => cue.expression))) {
    const asked = faceCues.flatMap((cue, i) => (cue.expression === expression ? [i] : []));
    const peaks = asked.flatMap((i) => faceObservations[i].peak ?? []);
    expressions[expression] = {
      asked: asked.length,
      hit: asked.filter((i) => isHit(faceStates[i]?.result)).length,
      threshold: FACES.thresholds[expression],
      medianPeak: median(peaks),
      highestPeak: peaks.length ? Math.max(...peaks) : null,
    };
  }

  return {
    asked: faceCues.length,
    hit: faceStates.filter((state) => isHit(state.result)).length,
    droppedBeforePlay: player.faceCuesDropped,
    droppedCount: player.faceCuesDropped ? player.chartFaceCues.length : 0,
    unseen: faceStates.filter((state) => state.unseen === true).length,
    expressions,
    cues: faceCues.map((cue, i) => ({
      ...cue,
      result: faceStates[i]?.result,
      unseen: faceStates[i]?.unseen === true,
      observation: faceObservations[i],
    })),
  };
}

/** Adds how the tracker read the hands in one cell to the readings of the shape that the cell asked for. */
function addReadings(readings: ShapeReadings, asked: GestureName, read: CellObservation['shapesRead']): void {
  const forAsked = (readings[asked] ??= {});
  for (const [name, frames] of Object.entries(read)) {
    const shape = name as GestureName;
    forAsked[shape] = (forAsked[shape] ?? 0) + frames;
  }
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
    const { shapes } = cue;
    if (!shapes) return;

    asked++;
    const wasHit = player.states[i]?.result === 'perfect' || player.states[i]?.result === 'good';
    if (wasHit) hit++;
    // A shape cue may have two cells: both hands of a double.
    for (const cell of observation.cells) {
      shapeFramesInCell += cell.framesInCell;
      shapeFramesMatching += cell.framesMatching;
    }
    const onFewFrames = observation.cells.some((cell) => cell.framesMatching < cell.framesInCell / 4);
    if (wasHit && onFewFrames) hitOnFewFrames++;

    // Each cell adds its readings to the shape that it asked for.
    observation.cells.forEach((cell, k) => addReadings(readings, shapes[k], cell.shapesRead));
  });

  const [none, one, two] = stats.handCounts[player.index];
  return {
    index: player.index,
    level: player.level,
    shapes: player.shapes,
    faces: player.faces,
    grid: {
      x: roundTo(player.grid.x, 4),
      y: roundTo(player.grid.y, 4),
      width: roundTo(player.grid.width, 4),
      height: roundTo(player.grid.height, 4),
    },
    calibrated: player.calibrated,
    score: player.score,
    handsSeen: { none: share(none, stats.frames), one: share(one, stats.frames), two: share(two, stats.frames) },
    arrivalMs: { mean: mean(arrivals), median: percentile(arrivals, 0.5), cells: arrivals.length },
    moves: { ...player.moves },
    shapeChanges: roundTo(shapeChangeShare(player.cues), 3),
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
    faceCues: faceCuesReport(player),
  };
}

export interface RunContext {
  song: RunReport['song'];
  settings: RunReport['settings'];
  trackerMode: string;
  trackerDelegate: string;
  /** Null when no face model was loaded. */
  trackerFaceDelegate: string | null;
  /** Null for a test input. */
  trackerThread: string | null;
  players: readonly PlayerRun[];
  stats: TrackingStats;
  nowMs: number;
}

/** Everything about one finished run, as plain data that can be saved as JSON. */
export function buildRunReport(context: RunContext): RunReport {
  const { stats } = context;
  const playSec = playedSec(stats.play, context.nowMs);
  return {
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    song: context.song,
    settings: context.settings,
    tracking: {
      mode: context.trackerMode,
      delegate: context.trackerDelegate,
      faceDelegate: context.trackerFaceDelegate,
      thread: context.trackerThread,
      frames: stats.frames,
      framesPerSec: playSec > 0 ? roundTo(stats.frames / playSec, 1) : 0,
      inferenceMs: { mean: mean(stats.inferenceMs), p95: percentile(stats.inferenceMs, 0.95) },
      drawnPerSec: playSec > 0 ? roundTo(stats.drawnFrames / playSec, 1) : 0,
    },
    players: context.players.map((player) => playerReport(player, stats)),
  };
}
