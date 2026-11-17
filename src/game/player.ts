import type { GestureName } from '../tracking/types';
import { LEVELS } from './config';
import type { ChartMix } from './cueSet';
import type { CueObservation, FaceObservation } from './diagnostics';
import { defaultGrid } from './geometry';
import type { FaceCueState } from './faceJudgment';
import type { CueState } from './judgment';
import { noMoves } from './moves';
import type { MoveName } from './moves';
import { freshScore } from './scoring';
import type { Settings } from './settings';
import type { Cue, FaceCue, Level, PlayerIndex, Point, Rect, Score } from './types';

/** Everything the game tracks for one active player during a session. */
export interface PlayerRun {
  /** 0 is the left player, or the only player. 1 is the right player. */
  index: PlayerIndex;
  level: Level;
  /** Whether this player gets hand-shape cues. */
  shapes: boolean;
  /** Whether this player gets face cues. */
  faces: boolean;
  grid: Rect;
  /**
   * True when the grid came from a calibration: in this round, or kept from an earlier round.
   * False for the standard grid. For the run report.
   */
  calibrated: boolean;
  /** Hand positions seen during the player's calibration. */
  reachSamples: Point[];
  /**
   * The grid the player had before the calibration in progress. A calibration with too little
   * reach gives it back. Null while the player does not calibrate.
   */
  gridBeforeReach: Rect | null;
  cues: Cue[];
  /** How many moves of each name `cues` holds. For the run report. */
  moves: Record<MoveName, number>;
  /** What makes the part of the chart that the round plays easy or hard. For the cue set ratings. */
  mix: ChartMix;
  /** Judging state of each cue, parallel to `cues`. */
  states: CueState[];
  /** What the tracker showed around each cue, parallel to `cues`. For the run report. */
  observations: CueObservation[];
  /**
   * The face cues of the chart, from the round's start. Empty when this player has faces off.
   * Each round and each replay decides again from these: see `faceCues`.
   */
  chartFaceCues: FaceCue[];
  /**
   * The face cues that the round plays: the chart's face cues, or none when the tracker had not
   * found the player's face in enough frames before play. See faceCheck.ts.
   */
  faceCues: FaceCue[];
  /** True when the round plays none of the chart's face cues, because the tracker had not found the face before play. */
  faceCuesDropped: boolean;
  /** Judging state of each face cue, parallel to `faceCues`. */
  faceStates: FaceCueState[];
  /** What the tracker showed around each face cue, parallel to `faceCues`. For the run report. */
  faceObservations: FaceObservation[];
  /** Where the tracker last found this player's face. Null until it finds one. */
  faceSeenAt: Point | null;
  /**
   * The frames in which the tracker found this player's face, of those the camera took since
   * the ready screen or the results last opened. At the start of play, a player with fewer than
   * `FACES.sightingsToKeep` gets no face cues. See faceCheck.ts.
   */
  faceSightings: number;
  score: Score;
  /** When the current hold in the Start cell began, in tracking-frame time. */
  holdStartMs: number | null;
  /** Progress of the hold in the Start cell, 0..1. */
  hold: number;
  /** When the current hold in the Calibrate cell began, in tracking-frame time. */
  calibrateHoldStartMs: number | null;
  /**
   * Progress of the hold in the Calibrate cell, 0..1. It stays at 1 while the player waits for
   * the calibration of the other player to end.
   */
  calibrateHold: number;
}

/** The mix of a chart with no cues: the mix of each player until a round makes their chart. */
export function noMix(): ChartMix {
  return { slides: 0, doubles: 0, offbeats: 0, cues: 0 };
}

export function createPlayers(settings: Settings): PlayerRun[] {
  const indices: PlayerIndex[] = settings.playerCount === 1 ? [0] : [0, 1];
  return indices.map((index) => ({
    index,
    level: settings.levels[index],
    shapes: settings.shapes[index] || LEVELS[settings.levels[index]].shapeOnEveryCue,
    faces: settings.faces[index],
    grid: defaultGrid(index, settings.playerCount),
    calibrated: false,
    reachSamples: [],
    gridBeforeReach: null,
    cues: [],
    moves: noMoves(),
    mix: noMix(),
    states: [],
    observations: [],
    chartFaceCues: [],
    faceCues: [],
    faceCuesDropped: false,
    faceStates: [],
    faceObservations: [],
    faceSeenAt: null,
    faceSightings: 0,
    score: freshScore(),
    holdStartMs: null,
    hold: 0,
    calibrateHoldStartMs: null,
    calibrateHold: 0,
  }));
}

export interface ChartSummary {
  /** Single taps outside slides. */
  taps: number;
  doubles: number;
  /** Slides, not their cells: a slide is three cues. */
  slides: number;
  /** Cues that ask for a hand shape, in one cell or in two. */
  gestures: number;
  faces: number;
}

/** Counts each kind of cue. A slide counts once, on its first cell. */
export function summariseChart(cues: readonly Cue[], faceCues: readonly FaceCue[]): ChartSummary {
  const summary: ChartSummary = { taps: 0, doubles: 0, slides: 0, gestures: 0, faces: faceCues.length };
  for (const cue of cues) {
    if (cue.slideStep === 1) summary.slides++;
    else if (cue.cells.length === 2) summary.doubles++;
    else if (cue.slideStep === undefined) summary.taps++;
    if (cue.shapes) summary.gestures++;
  }
  return summary;
}

/**
 * The share of cues at which a hand must make a shape other than the one it made before: how
 * often a player has to change hand shape. A chart with no cues gives 0.
 *
 * - Each cell of a cue goes to a hand by its side, as the two cells of a tap for two hands do:
 *   the left hand plays the left column, the right hand the right column. See `handFor`.
 * - A hand keeps the shape it made last through cues with no shape and cues of the other hand.
 * - A hand that has made no shape yet changes nothing, so the first cue is no change.
 * - A cue with no shape is no change.
 *
 * So a fist in both cells of a tap for two hands, then a fist in one cell, is no change. Two
 * shapes that swap hands are a change. An off-beat tap that keeps the shape of its own side is
 * no change.
 */
export function shapeChangeShare(cues: readonly Cue[]): number {
  if (cues.length === 0) return 0;
  const hands: HandShapes = { made: [undefined, undefined], playedAt: [-1, -1] };
  let changes = 0;
  cues.forEach((cue, i) => {
    if (cue.shapes && playShapes(hands, cue, cue.shapes, i)) changes++;
  });
  return changes / cues.length;
}

/** What each hand of a player did last, left hand first: the shape it made, and the cue it played. */
interface HandShapes {
  made: (GestureName | undefined)[];
  playedAt: number[];
}

/**
 * Plays the cells of one cue with shapes, the cue at `index`, and answers whether a hand had to
 * change its shape. The cells of the side columns take their hands first.
 */
function playShapes(hands: HandShapes, cue: Cue, shapes: readonly GestureName[], index: number): boolean {
  const { cells } = cue;
  const indices = cells.map((_, k) => k);
  const sideCells = indices.filter((k) => sideOf(cells[k]) !== null);
  const centreCells = indices.filter((k) => sideOf(cells[k]) === null);
  const used = [false, false];
  let changed = false;
  for (const k of [...sideCells, ...centreCells]) {
    const hand = handFor(hands, cells[k], shapes[k], used);
    const before = hands.made[hand];
    if (before !== undefined && before !== shapes[k]) changed = true;
    hands.made[hand] = shapes[k];
    hands.playedAt[hand] = index;
    used[hand] = true;
  }
  return changed;
}

/** The hand of a cell's side: 0 for the left column, 1 for the right column, null for the centre column. */
function sideOf(cell: number): number | null {
  const column = cell % 3;
  if (column === 0) return 0;
  if (column === 2) return 1;
  return null;
}

/**
 * The hand that plays a cell with a shape. A cell in a side column takes the hand of its side.
 * Either hand can play a centre cell: it takes a free hand that already makes its shape, when one
 * does, else the free hand that played longer ago.
 */
function handFor(hands: HandShapes, cell: number, shape: GestureName, used: readonly boolean[]): number {
  const side = sideOf(cell);
  if (side !== null && !used[side]) return side;
  const free = [0, 1].filter((hand) => !used[hand]);
  const making = free.find((hand) => hands.made[hand] === shape);
  if (making !== undefined) return making;
  const longestAgo = free.sort((a, b) => hands.playedAt[a] - hands.playedAt[b])[0];
  return longestAgo ?? 0;
}
