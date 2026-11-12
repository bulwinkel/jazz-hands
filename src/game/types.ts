import type { FaceExpression, GestureName } from '../tracking/types';

export type Level = 1 | 2 | 3 | 4;
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
 * How long a slide takes, counted in cue intervals (the time from one cue beat to the next):
 * fast is half an interval, normal is one, slow is two.
 */
export type SlideSpeed = 'fast' | 'normal' | 'slow';

/**
 * One action for one player.
 *
 * tap: `cells` holds 1 cell, or 2 cells for two hands at once. All are due at `timeSec`.
 * slide: `cells` is the path of one hand, each cell due at its own time in `times`.
 *   A fast or normal slide is [from, to]. A slow slide is [from, middle, to].
 */
export interface Cue {
  kind: 'tap' | 'slide';
  /** Slides only. */
  speed?: SlideSpeed;
  /** Due time of the first cell. */
  timeSec: number;
  /**
   * The beat the cue starts on. An off-beat tap sits halfway to the next cue beat: a half beat
   * in a song with a cue on every beat, a whole beat in a faster song.
   */
  beatIndex: number;
  /** Cell indices 0..8, row by row. 0 is top-left on screen. */
  cells: number[];
  /** Due time of each cell, parallel to `cells`. */
  times: number[];
  /** Required hand shape. Single-cell taps only. */
  gesture?: GestureName;
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
