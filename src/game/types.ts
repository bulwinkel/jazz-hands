import type { GestureName } from '../tracking/types';

export type Level = 1 | 2 | 3;
export type PlayerIndex = 0 | 1;
export type PlayerCount = 1 | 2;
export type SongLength = 'short' | 'full';

export interface Manifest {
  id: string;
  title: string;
  /** Path on this server. The game runs with no network. */
  audio: string;
  durationSec: number;
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
 * One action for one player.
 *
 * tap: `cells` holds 1 cell, or 2 cells for two hands at once. All are due at `timeSec`.
 * slide: `cells` is [from, to]. The hand is due in `from` at `times[0]` and in `to` at `times[1]`.
 */
export interface Cue {
  kind: 'tap' | 'slide';
  /** Due time of the first cell. */
  timeSec: number;
  beatIndex: number;
  /** Cell indices 0..8, row by row. 0 is top-left on screen. */
  cells: number[];
  /** Due time of each cell, parallel to `cells`. */
  times: number[];
  /** Required hand shape. Single-cell taps only. */
  gesture?: GestureName;
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
