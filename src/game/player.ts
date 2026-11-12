import { defaultGrid } from './geometry';
import type { CueState } from './judgment';
import { freshScore } from './scoring';
import type { Settings } from './settings';
import type { Cue, Level, PlayerIndex, Point, Rect, Score } from './types';

/** Everything the game tracks for one active player during a session. */
export interface PlayerRun {
  /** 0 is the left player, or the only player. 1 is the right player. */
  index: PlayerIndex;
  level: Level;
  /** Whether this player gets hand-shape cues. */
  shapes: boolean;
  grid: Rect;
  /** Hand positions seen during the reach fit. */
  reachSamples: Point[];
  cues: Cue[];
  /** Judging state of each cue, parallel to `cues`. */
  states: CueState[];
  score: Score;
  /** When the current hands-up hold began, in tracking-frame time. */
  holdStartMs: number | null;
  /** Progress of the hands-up hold, 0..1. */
  hold: number;
}

export function createPlayers(settings: Settings): PlayerRun[] {
  const indices: PlayerIndex[] = settings.playerCount === 1 ? [0] : [0, 1];
  return indices.map((index) => ({
    index,
    level: settings.levels[index],
    shapes: settings.shapes[index],
    grid: defaultGrid(index, settings.playerCount),
    reachSamples: [],
    cues: [],
    states: [],
    score: freshScore(),
    holdStartMs: null,
    hold: 0,
  }));
}

export interface ChartSummary {
  taps: number;
  doubles: number;
  slides: number;
  gestures: number;
}

/** Counts each kind of cue. `gestures` counts the single taps that ask for a hand shape. */
export function summariseChart(cues: readonly Cue[]): ChartSummary {
  const summary: ChartSummary = { taps: 0, doubles: 0, slides: 0, gestures: 0 };
  for (const cue of cues) {
    if (cue.kind === 'slide') summary.slides++;
    else if (cue.cells.length === 2) summary.doubles++;
    else summary.taps++;
    if (cue.gesture) summary.gestures++;
  }
  return summary;
}
