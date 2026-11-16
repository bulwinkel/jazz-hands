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
  /** Hand positions seen during the reach fit. */
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
  /** Empty when this player has faces off. */
  faceCues: FaceCue[];
  /** Judging state of each face cue, parallel to `faceCues`. */
  faceStates: FaceCueState[];
  /** What the tracker showed around each face cue, parallel to `faceCues`. For the run report. */
  faceObservations: FaceObservation[];
  /** Where the tracker last found this player's face. Null until it finds one. */
  faceSeenAt: Point | null;
  score: Score;
  /** When the current hands-up hold began, in tracking-frame time. */
  holdStartMs: number | null;
  /** Progress of the hands-up hold, 0..1. */
  hold: number;
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
    reachSamples: [],
    cues: [],
    moves: noMoves(),
    mix: noMix(),
    states: [],
    observations: [],
    faceCues: [],
    faceStates: [],
    faceObservations: [],
    faceSeenAt: null,
    score: freshScore(),
    holdStartMs: null,
    hold: 0,
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
