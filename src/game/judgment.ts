import type { GestureName, TrackedHand } from '../tracking/types';
import { LEVELS } from './config';
import type { WindowMs } from './config';
import { cellRect, insideCell } from './geometry';
import type { Cue, Level, Rating, Rect } from './types';

/** How well one cell of a cue has been hit so far. */
export type CellMark = 'perfect' | 'good' | null;

export interface CueState {
  cue: Cue;
  /** Best mark so far for each cell, parallel to `cue.cells`. */
  marks: CellMark[];
  /** Set once the cue is final. A final cue never changes. */
  result?: Rating;
}

export const EPSILON_MS = 1e-6;

export function newCueState(cue: Cue): CueState {
  return { cue, marks: cue.cells.map(() => null) };
}

/**
 * The song time a tracking frame shows. The frame is older than "now" by its processing
 * time plus the camera delay, so a hand that was on the beat is judged on the beat.
 */
export function frameSongTime(
  songTimeNowSec: number,
  nowMs: number,
  frameTimeMs: number,
  inputLatencyMs: number,
): number {
  return songTimeNowSec - (nowMs - frameTimeMs) / 1000 - inputLatencyMs / 1000;
}

export function within(deltaMs: number, [early, late]: WindowMs): boolean {
  return deltaMs >= early - EPSILON_MS && deltaMs <= late + EPSILON_MS;
}

function handSatisfies(hand: TrackedHand, cell: Rect, gesture: GestureName | undefined): boolean {
  if (!insideCell(hand, cell)) return false;
  // 'unknown' means the tracker cannot read hand shapes. Judge such a hand on position alone.
  return gesture === undefined || hand.gesture === gesture || hand.gesture === 'unknown';
}

/**
 * Applies one tracking frame to one cue and returns the new state. Never mutates `state`.
 *
 * Each cell is judged against its own due time. A cell is Perfect when a hand is in it during
 * any frame inside the Perfect window, so arriving early and holding still is correct play.
 * The cue is Perfect as soon as every cell is. Otherwise it becomes final when the Good window
 * of its last cell closes: Miss if a cell was never hit, else Good.
 */
export function judgeFrame(
  state: CueState,
  level: Level,
  grid: Rect,
  hands: readonly TrackedHand[],
  timeSec: number,
): CueState {
  if (state.result) return state;
  const { perfectMs, goodMs } = LEVELS[level];
  const { cue } = state;

  const marks = state.marks.map((mark, k): CellMark => {
    if (mark === 'perfect') return mark;
    const deltaMs = (timeSec - cue.times[k]) * 1000;
    if (!within(deltaMs, goodMs)) return mark;
    const rect = cellRect(grid, cue.cells[k]);
    if (!hands.some((hand) => handSatisfies(hand, rect, cue.gesture))) return mark;
    // A Good mark is provisional: a hand that stays into the Perfect window upgrades it.
    return within(deltaMs, perfectMs) ? 'perfect' : 'good';
  });

  const next: CueState = { cue, marks };
  if (marks.every((mark) => mark === 'perfect')) {
    next.result = 'perfect';
    return next;
  }
  const lastDueSec = Math.max(...cue.times);
  const windowClosed = (timeSec - lastDueSec) * 1000 > goodMs[1] + EPSILON_MS;
  if (windowClosed) next.result = marks.includes(null) ? 'miss' : 'good';
  return next;
}
