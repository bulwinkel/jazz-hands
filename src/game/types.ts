import type { FaceExpression, GestureName } from '../tracking/types';

export type Level = 1 | 2 | 3 | 4 | 5;
export type PlayerIndex = 0 | 1;
export type PlayerCount = 1 | 2;
export type SongLength = 'short' | 'full';

export interface Manifest {
  id: string;
  title: string;
  /** Path on this server. The game runs with no network. */
  audio: string;
  durationSec: number;
  /**
   * Where the Short round starts. Unset means the start of the song.
   * A song with a quiet opening sets this to a later bar start, where it has more to play.
   */
  shortStartSec?: number;
  bpm: number;
  beatsPerBar: number;
  /** Index into `beats` of the first bar start. */
  firstDownbeat: number;
  /** Time in seconds of every beat. Use these times, never bpm arithmetic. */
  beats: number[];
  /** Musical energy at each beat, 0..1. Same length as `beats`. */
  intensity: number[];
}

/**
 * The place of a cue in a slide: 1 is the start cell, 2 the middle cell, 3 the end cell. A
 * slide is three taps in a line, one on each of three cue beats in a row.
 */
export type SlideStep = 1 | 2 | 3;

/**
 * One tap for one player: `cells` holds 1 cell, or 2 cells for two hands at once. All are due
 * at `timeSec`.
 */
export interface Cue {
  /** Due time of the tap. */
  timeSec: number;
  /**
   * The beat the cue is on. An off-beat tap sits halfway to the next cue beat: a half beat in a
   * song with a cue on every beat, a whole beat in a faster song.
   */
  beatIndex: number;
  /** Cell indices 0..8, row by row. 0 is top-left on screen. All are due at `timeSec`. */
  cells: number[];
  /** Required hand shape, for every cell of the cue. */
  gesture?: GestureName;
  /** Set on the three cues of a slide only. The run report shows it, to compare slides with other taps. */
  slideStep?: SlideStep;
}

/**
 * One face to pull, for one player. Face cues are a list of their own, apart from the hand
 * cues, because a face cue can fall on the same beat as a hand cue.
 */
export interface FaceCue {
  timeSec: number;
  beatIndex: number;
  expression: FaceExpression;
}

/** All rectangles and points are fractions of the camera frame, in mirrored screen space. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export type Rating = 'perfect' | 'good' | 'miss';

export interface Score {
  score: number;
  combo: number;
  maxCombo: number;
  perfect: number;
  good: number;
  miss: number;
  total: number;
}

export type Phase = 'menu' | 'loading' | 'fit' | 'ready' | 'countdown' | 'play' | 'results' | 'error';
