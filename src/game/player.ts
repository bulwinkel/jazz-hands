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
   * The face cues that the round plays: the chart's face cues, or none when the camera had not
   * seen the player's face before play. See faceCheck.ts.
   */
  faceCues: FaceCue[];
  /** True when the round plays none of the chart's face cues, because the camera had not seen the face before play. */
  faceCuesDropped: boolean;
  /** Judging state of each face cue, parallel to `faceCues`. */
  faceStates: FaceCueState[];
  /** What the tracker showed around each face cue, parallel to `faceCues`. For the run report. */
  faceObservations: FaceObservation[];
  /** Where the tracker last found this player's face. Null until it finds one. */
  faceSeenAt: Point | null;
  /**
   * True once the tracker has found this player's face since the ready screen or the results
   * last opened. At the start of play, a player whose face it has not found gets no face cues.
   */
  faceSeenSinceScreen: boolean;
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
    faceSeenSinceScreen: false,
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
  /** Cues that ask for a hand shape. */
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
    if (cue.gesture) summary.gestures++;
  }
  return summary;
}
